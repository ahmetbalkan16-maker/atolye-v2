/**
 * Atölye security brain ("Bekçi") — the pure judgement over measured facts.
 *
 * Owner 2026-11-26: "bizim güvenlik için bir yapay zekamız yok, sistemimizi koruyacak, kendini geliştirecek" — and,
 * accepting the proposal the same day: it watches from this machine only (no network scans), reports every finding
 * with its evidence, locks the passcode login by itself only on a brute-force run (reversible), and asks the owner
 * for everything else.
 *
 * This file decides; it never reads the machine. `scripts/ayas-security-watch.ts` gathers the facts and stores the
 * report. Every check is deterministic code, never a model. A fact that could not be measured is reported as such
 * ("ölçülemedi") instead of being counted as safe.
 *
 * Lives under `src/lib/brain/security/`, which `BrainPatchSafety` classifies FORBIDDEN_AUTONOMOUS: no automatic
 * development (and no grace auto-approval) can loosen these rules; only the owner can. The brain's own learning
 * goes into `src/lib/security-watch/LearnedChecks.ts`, vetted here (`vetLearnedChecks`).
 */

import type { LearnedSecurityCheck } from "../../security-watch/LearnedChecks";

export type SecuritySeverity = "kritik" | "yuksek" | "orta" | "dusuk";

export interface SecurityFinding {
  /** Stable id: the same problem keeps the same id across runs (the case library keys on it). */
  readonly id: string;
  readonly severity: SecuritySeverity;
  /** Turkish, one line, what is wrong. */
  readonly title: string;
  /** What was measured (never a secret value). */
  readonly evidence: string;
  /** Turkish, what to do. */
  readonly advice: string;
  /** True when only the owner may carry out the fix (closing a port, rotating a key…). */
  readonly ownerAction: boolean;
}

/** A measurement that may have failed: `null` value with a reason means "could not measure". */
export interface Measured<T> {
  readonly value: T | null;
  readonly at: string;
  readonly error?: string;
}

export interface ListeningPort {
  readonly port: number;
  readonly address: string;
  readonly process: string;
}

export interface FirewallAllowRule {
  readonly name: string;
  readonly ports: readonly string[];
  readonly profiles: string;
}

export interface SecretHit {
  readonly file: string;
  readonly kind: string;
}

export interface VulnerabilityCount {
  readonly critical: number;
  readonly high: number;
  readonly moderate: number;
  readonly low: number;
  /** Ids of the shipped (non-dev) critical/high ones, for the report. */
  readonly topIds: readonly string[];
}

export interface LoginFacts {
  readonly failuresLastHour: number;
  readonly failuresLastDay: number;
  readonly lastFailureAt: string | null;
  readonly lockedUntil: string | null;
  readonly locksLastDay: number;
}

export interface SecurityWatchFacts {
  readonly login: Measured<LoginFacts>;
  /** Listening TCP sockets on this machine. */
  readonly ports: Measured<readonly ListeningPort[]>;
  /** Enabled inbound allow rules that apply to the Public profile and name one of the watched ports. */
  readonly firewall: Measured<readonly FirewallAllowRule[]>;
  /** Credential-shaped strings in tracked files, and tracked `.env*` files. */
  readonly secrets: Measured<readonly SecretHit[]>;
  /** Known vulnerabilities in the app's shipped packages (dev tooling excluded). */
  readonly vulnerabilities: Measured<VulnerabilityCount>;
  /** Tracked files of the live snapshot that differ from its commit, and whether its HEAD matches its name. */
  readonly liveIntegrity: Measured<{ readonly snapshot: string; readonly modified: readonly string[]; readonly headMatches: boolean }>;
  /** Routes that must need a session; those that do not. */
  readonly openSensitiveRoutes: Measured<readonly string[]>;
  /** Length of the passcode (never the passcode), and whether the gate is enforced. */
  readonly accessKey: Measured<{ readonly length: number; readonly enforced: boolean }>;
}

/** Ports that must never face a network the owner does not control: the app, SMB/NetBIOS, RDP, Ollama. */
export const WATCHED_PORTS: Readonly<Record<number, string>> = { 3000: "AYAS uygulaması", 445: "dosya paylaşımı (SMB)", 139: "NetBIOS", 3389: "uzak masaüstü", 11434: "Ollama" };

/** Owner 2026-11-26: brute force = this many failed passcodes inside one hour; the lock lasts LOCK_MINUTES. */
export const LOGIN_LOCK_FAILURES_PER_HOUR = 60;
export const LOGIN_LOCK_MINUTES = 60;

const isLoopback = (address: string) => address === "127.0.0.1" || address === "::1" || address.startsWith("127.");

function unmeasured(id: string, what: string, m: Measured<unknown>): SecurityFinding | null {
  if (m.value !== null) return null;
  return { id: `olculemedi:${id}`, severity: "dusuk", title: `${what} ölçülemedi`, evidence: m.error ?? "bilinmeyen hata", advice: "Bekçi bir sonraki turda yeniden dener; tekrar ederse ölçüm aracını kontrol et.", ownerAction: false };
}

export interface LearnedCheckVerdict {
  readonly id: string;
  /** aktif: in use · gereksiz: does not catch its own exam case · yanlis-alarm: fires on a clean machine · hatali: throws or claims "kritik". */
  readonly status: "aktif" | "gereksiz" | "yanlis-alarm" | "hatali";
  readonly learnedFrom: string;
}

/**
 * Owner 2026-11-26 ("gereksiz ve sisteme zararlı geliştirmeleri yapmaması lazım"): a learned check is used only when it
 * catches its own exam case AND stays silent on a clean machine AND does not claim "kritik". Anything else is switched
 * off here and shown to the owner — never silently trusted.
 */
export function vetLearnedChecks(checks: readonly LearnedSecurityCheck[]): { readonly active: readonly LearnedSecurityCheck[]; readonly verdicts: readonly LearnedCheckVerdict[] } {
  const active: LearnedSecurityCheck[] = [];
  const verdicts: LearnedCheckVerdict[] = [];
  const seen = new Set<string>();
  for (const check of checks) {
    let status: LearnedCheckVerdict["status"];
    try {
      if (seen.has(check.id) || !/^[a-z0-9-]{3,60}$/.test(check.id) || (check.severity as string) === "kritik") status = "hatali";
      else if (check.evaluate(CLEAN_FACTS) !== null) status = "yanlis-alarm";
      else if (check.evaluate({ ...CLEAN_FACTS, ...check.exam }) === null) status = "gereksiz";
      else status = "aktif";
    } catch {
      status = "hatali";
    }
    seen.add(check.id);
    verdicts.push({ id: check.id, status, learnedFrom: check.learnedFrom });
    if (status === "aktif") active.push(check);
  }
  return { active, verdicts };
}

/**
 * Grades the facts. Pure and deterministic: the same facts always give the same findings, most severe first.
 * Vetted learned checks may only add findings (prefixed `ogrenilen:`); they never touch the core ones.
 */
export function evaluateSecurityWatch(facts: SecurityWatchFacts, nowIso: string, learned: readonly LearnedSecurityCheck[] = []): readonly SecurityFinding[] {
  const out: SecurityFinding[] = [];
  for (const check of vetLearnedChecks(learned).active) {
    let evidence: string | null = null;
    try { evidence = check.evaluate(facts); } catch { evidence = null; }
    if (evidence !== null) out.push({ id: `ogrenilen:${check.id}`, severity: check.severity, title: check.title, evidence: evidence.slice(0, 400), advice: check.advice, ownerAction: true });
  }
  const now = Date.parse(nowIso);

  // Login: a brute-force run, an active lock, or a steady trickle of failures.
  const login = facts.login.value;
  if (login) {
    if (login.lockedUntil && Date.parse(login.lockedUntil) > now) {
      out.push({ id: "giris:kilitli", severity: "kritik", title: "Şifre girişi kilitlendi (kaba kuvvet denemesi)", evidence: `son 1 saatte ${login.failuresLastHour} hatalı şifre; kilit ${login.lockedUntil} saatine kadar`, advice: "Açık oturumların çalışmaya devam eder. Deneme sen değilsen şifreyi değiştir; sensen Güvenlik panelinden kilidi kaldır.", ownerAction: true });
    } else if (login.failuresLastHour >= 20) {
      out.push({ id: "giris:yogun-deneme", severity: "yuksek", title: "Kısa sürede çok sayıda hatalı şifre", evidence: `son 1 saatte ${login.failuresLastHour}, son 24 saatte ${login.failuresLastDay} hatalı deneme`, advice: `Saatte ${LOGIN_LOCK_FAILURES_PER_HOUR} denemede giriş kendiliğinden kilitlenir. Sen değilsen şifreyi değiştirmeyi düşün.`, ownerAction: false });
    } else if (login.failuresLastDay >= 30) {
      out.push({ id: "giris:surekli-deneme", severity: "orta", title: "Gün boyu süren hatalı şifre denemeleri", evidence: `son 24 saatte ${login.failuresLastDay} hatalı deneme`, advice: "Yavaş bir tahmin denemesi olabilir; şifre uzun ve tahmin edilemez olmalı.", ownerAction: false });
    }
    if (login.locksLastDay >= 2) {
      out.push({ id: "giris:tekrarlayan-kilit", severity: "yuksek", title: "Giriş bugün birden çok kez kilitlendi", evidence: `son 24 saatte ${login.locksLastDay} kilit`, advice: "Biri ısrarla deniyor. Şifreyi değiştir; tüneli geçici kapatmayı düşün.", ownerAction: true });
    }
  }

  // Passcode strength and gate mode.
  const key = facts.accessKey.value;
  if (key) {
    if (!key.enforced) out.push({ id: "anahtar:kapali", severity: "kritik", title: "Giriş kapısı zorunlu değil", evidence: "AYAS_ACCESS_KEY tanımsız ya da geçersiz", advice: "Canlı uygulamada şifre kapısı her zaman açık olmalı.", ownerAction: true });
    else if (key.length < 16) out.push({ id: "anahtar:kisa", severity: "orta", title: "Giriş şifresi kısa", evidence: `${key.length} karakter (önerilen en az 16)`, advice: "Daha uzun bir şifreye geç; kaba kuvvet süresi katlanarak uzar.", ownerAction: true });
  }

  // Ports listening on all interfaces.
  const ports = facts.ports.value;
  if (ports) {
    for (const [portText, label] of Object.entries(WATCHED_PORTS)) {
      const port = Number(portText);
      const open = ports.filter((p) => p.port === port && !isLoopback(p.address));
      if (open.length === 0) continue;
      const severity: SecuritySeverity = port === 3000 || port === 11434 ? "yuksek" : "orta";
      out.push({ id: `port:${port}`, severity, title: `${label} (port ${port}) bütün ağlara açık dinliyor`, evidence: open.map((p) => `${p.address}:${p.port} (${p.process})`).join(", "), advice: port === 3000 || port === 11434 ? "Yalnız 127.0.0.1'de dinlemeli; dış erişim zaten tünelden geliyor." : "Bu bilgisayar paylaşımlı ağda; bu hizmete ihtiyaç yoksa kapat ya da güvenlik duvarında yalnız Özel ağa izin ver.", ownerAction: true });
    }
  }

  // Firewall allow rules on the Public profile.
  const rules = facts.firewall.value;
  if (rules && rules.length > 0) {
    out.push({ id: "guvenlik-duvari:ortak-ag", severity: "orta", title: "Güvenlik duvarı Ortak ağda izlenen portlara izin veriyor", evidence: rules.slice(0, 6).map((r) => `${r.name} [${r.ports.join(",")}] ${r.profiles}`).join("; "), advice: "Ofis interneti komşu binadan geliyor (paylaşımlı ağ). Bu kuralları yalnız Özel profile daralt ya da kapat.", ownerAction: true });
  }

  // Secrets in Git.
  const secrets = facts.secrets.value;
  if (secrets && secrets.length > 0) {
    out.push({ id: "sir:git", severity: "kritik", title: "Git'e şifre/anahtar biçiminde bir şey girmiş", evidence: secrets.slice(0, 8).map((s) => `${s.file} (${s.kind})`).join(", "), advice: "Anahtarı hemen değiştir (eskisi artık açıkta sayılır), dosyadan çıkar.", ownerAction: true });
  }

  // Known vulnerabilities in shipped packages.
  const vulns = facts.vulnerabilities.value;
  if (vulns) {
    if (vulns.critical > 0) out.push({ id: "acik:kritik", severity: "kritik", title: `Uygulama paketlerinde ${vulns.critical} kritik açık`, evidence: vulns.topIds.join(", ") || "osv.dev", advice: "Güncelleme Radarı'ndan düzeltilmiş sürümü dene ve uygula.", ownerAction: true });
    else if (vulns.high > 0) out.push({ id: "acik:yuksek", severity: "yuksek", title: `Uygulama paketlerinde ${vulns.high} yüksek açık`, evidence: vulns.topIds.join(", ") || "osv.dev", advice: "Güncelleme Radarı'ndan düzeltilmiş sürümü dene ve uygula.", ownerAction: true });
  }

  // Live snapshot tampering.
  const live = facts.liveIntegrity.value;
  if (live) {
    if (live.modified.length > 0) out.push({ id: "canli:degismis", severity: "kritik", title: "Canlı sürümün dosyaları commit'ten farklı", evidence: `${live.snapshot}: ${live.modified.slice(0, 8).join(", ")}`, advice: "Canlı kopyaya dışarıdan dokunulmuş olabilir. Yeniden yayınla (ayas-publish-live) ve farkı incele.", ownerAction: true });
    if (!live.headMatches) out.push({ id: "canli:head", severity: "yuksek", title: "Canlı sürümün commit'i adıyla uyuşmuyor", evidence: live.snapshot, advice: "Canlı kopyada elle checkout yapılmış olabilir; yeniden yayınla.", ownerAction: true });
  }

  // Sensitive routes reachable without a session.
  const open = facts.openSensitiveRoutes.value;
  if (open && open.length > 0) {
    out.push({ id: "rota:acik", severity: "kritik", title: "Oturumsuz açılabilen hassas sayfa/uç var", evidence: open.join(", "), advice: "accessGate açık yol listesini düzelt.", ownerAction: true });
  }

  for (const [id, what, m] of [
    ["giris", "Giriş kayıtları", facts.login], ["port", "Açık portlar", facts.ports], ["guvenlik-duvari", "Güvenlik duvarı", facts.firewall],
    ["sir", "Şifre taraması", facts.secrets], ["acik", "Paket açıkları", facts.vulnerabilities], ["canli", "Canlı sürüm bütünlüğü", facts.liveIntegrity],
    ["rota", "Rota koruması", facts.openSensitiveRoutes], ["anahtar", "Giriş şifresi", facts.accessKey],
  ] as const) {
    const f = unmeasured(id, what, m);
    if (f) out.push(f);
  }

  const rank: Record<SecuritySeverity, number> = { kritik: 0, yuksek: 1, orta: 2, dusuk: 3 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.id.localeCompare(b.id));
}

export interface SecurityWatchReport {
  readonly schemaVersion: 1;
  readonly checkedAt: string;
  readonly findings: readonly SecurityFinding[];
  /** When each fact was last measured (some run hourly or daily). */
  readonly measuredAt: Readonly<Record<keyof SecurityWatchFacts, string>>;
  readonly exam?: SecurityExamResult;
  /** Verdict on every learned check (switched-off ones are shown to the owner). */
  readonly learned?: readonly LearnedCheckVerdict[];
}

/** Turkish one-line status for the rail / Control Center. */
export function securityWatchLabel(report: SecurityWatchReport | null, nowIso: string): { readonly label: string; readonly level: "HEALTHY" | "WARNING" | "ACTION_REQUIRED" } {
  if (!report) return { label: "BEKÇİ HENÜZ ÇALIŞMADI", level: "WARNING" };
  if (Date.parse(nowIso) - Date.parse(report.checkedAt) > 45 * 60_000) return { label: "BEKÇİ ÇALIŞMIYOR", level: "WARNING" };
  if (report.findings.some((f) => f.id === "giris:kilitli")) return { label: "GİRİŞ KİLİTLİ", level: "ACTION_REQUIRED" };
  const serious = report.findings.filter((f) => f.severity === "kritik" || f.severity === "yuksek").length;
  if (serious > 0) return { label: `${serious} CİDDİ BULGU`, level: "ACTION_REQUIRED" };
  const minor = report.findings.length;
  return minor > 0 ? { label: `${minor} KÜÇÜK BULGU`, level: "WARNING" } : { label: "TEMİZ", level: "HEALTHY" };
}

// ---------------------------------------------------------------------------------------------------------------
// Self-improvement: the exam. Seeded incidents the watcher must catch; run weekly, the score is kept in the report.
// A new incident type learned from a real case is added here (by the owner's approval, this folder is protected).
// ---------------------------------------------------------------------------------------------------------------

const at = "2026-11-26T12:00:00.000Z";
const ok = <T,>(value: T): Measured<T> => ({ value, at });
/** Facts of a clean, well-configured machine; each exam case breaks exactly one thing. */
export const CLEAN_FACTS: SecurityWatchFacts = {
  login: ok({ failuresLastHour: 0, failuresLastDay: 1, lastFailureAt: null, lockedUntil: null, locksLastDay: 0 }),
  ports: ok([{ port: 3000, address: "127.0.0.1", process: "node" }, { port: 11434, address: "127.0.0.1", process: "ollama" }]),
  firewall: ok([]),
  secrets: ok([]),
  vulnerabilities: ok({ critical: 0, high: 0, moderate: 2, low: 1, topIds: [] }),
  liveIntegrity: ok({ snapshot: "ayas-live-abc", modified: [], headMatches: true }),
  openSensitiveRoutes: ok([]),
  accessKey: ok({ length: 32, enforced: true }),
};

export interface SecurityExamCase {
  readonly name: string;
  readonly facts: Partial<SecurityWatchFacts>;
  /** The finding id that must appear. */
  readonly expect: string;
}

export const SECURITY_EXAM_CASES: readonly SecurityExamCase[] = [
  { name: "kaba kuvvet kilidi", facts: { login: ok({ failuresLastHour: 75, failuresLastDay: 80, lastFailureAt: at, lockedUntil: "2026-11-26T13:00:00.000Z", locksLastDay: 1 }) }, expect: "giris:kilitli" },
  { name: "yoğun deneme", facts: { login: ok({ failuresLastHour: 25, failuresLastDay: 25, lastFailureAt: at, lockedUntil: null, locksLastDay: 0 }) }, expect: "giris:yogun-deneme" },
  { name: "uygulama tüm ağlarda", facts: { ports: ok([{ port: 3000, address: "0.0.0.0", process: "node" }]) }, expect: "port:3000" },
  { name: "SMB açık", facts: { ports: ok([{ port: 445, address: "0.0.0.0", process: "System" }]) }, expect: "port:445" },
  { name: "Ortak ağ kuralı", facts: { firewall: ok([{ name: "Node.js", ports: ["3000"], profiles: "Public" }]) }, expect: "guvenlik-duvari:ortak-ag" },
  { name: "Git'te anahtar", facts: { secrets: ok([{ file: "src/x.ts", kind: "OpenAI anahtarı" }]) }, expect: "sir:git" },
  { name: "kritik paket açığı", facts: { vulnerabilities: ok({ critical: 1, high: 0, moderate: 0, low: 0, topIds: ["GHSA-x"] }) }, expect: "acik:kritik" },
  { name: "canlı dosya değişmiş", facts: { liveIntegrity: ok({ snapshot: "ayas-live-abc", modified: ["app/page.tsx"], headMatches: true }) }, expect: "canli:degismis" },
  { name: "açık hassas rota", facts: { openSensitiveRoutes: ok(["/api/ayas/chat"]) }, expect: "rota:acik" },
  { name: "kapı kapalı", facts: { accessKey: ok({ length: 0, enforced: false }) }, expect: "anahtar:kapali" },
  { name: "ölçülemeyen port", facts: { ports: { value: null, at, error: "powershell yok" } }, expect: "olculemedi:port" },
];

export interface SecurityExamResult {
  readonly at: string;
  readonly passed: number;
  readonly total: number;
  readonly missed: readonly string[];
  /** A clean machine must produce no finding (no false alarm). */
  readonly falseAlarms: number;
}

/** Runs the exam: every seeded incident must be caught, and the clean machine must stay quiet. */
export function runSecurityExam(nowIso: string): SecurityExamResult {
  const missed: string[] = [];
  for (const c of SECURITY_EXAM_CASES) {
    const found = evaluateSecurityWatch({ ...CLEAN_FACTS, ...c.facts }, "2026-11-26T12:00:00.000Z");
    if (!found.some((f) => f.id === c.expect)) missed.push(c.name);
  }
  const falseAlarms = evaluateSecurityWatch(CLEAN_FACTS, "2026-11-26T12:00:00.000Z").length;
  return { at: nowIso, passed: SECURITY_EXAM_CASES.length - missed.length, total: SECURITY_EXAM_CASES.length, missed, falseAlarms };
}
