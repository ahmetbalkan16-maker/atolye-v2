/**
 * Atölye security brain ("Bekçi") — one watch round (owner 2026-11-26: "sistemimizi koruyacak, kendini geliştirecek").
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/ayas-security-watch.ts [--force]
 *
 * Run by the AYAS observer every tick (5 min) as an arm's-length child; it does real work only when a check is due:
 *   every 15 min  login records, passcode/gate, route protection
 *   hourly        listening ports, Windows firewall allow rules on the Public profile, live snapshot integrity
 *   on new HEAD   credential-shaped strings and tracked .env files in Git (at least daily); plus Gitleaks over the
 *                 whole history when the pinned, hash-checked program is installed (scripts/ayas-security-tools-install.ts)
 *   daily         known vulnerabilities of the shipped packages (osv.dev, names and versions only, via the existing CLI)
 *   daily/new HEAD the security research child (scripts/ayas-security-research.ts: GitHub advisories, Node.js
 *                 security-wg, release notes), never in the same round as the vulnerability audit (240 s round limit)
 *   weekly        the exam (seeded incidents must be caught, a clean machine must stay quiet)
 *
 * Local measurements only: no port scan, no LAN access, nothing sent anywhere except the daily osv.dev query the
 * existing vulnerability CLI already makes and the research child's GETs (package names and versions only, fixed
 * public hosts). It changes nothing on the machine; the only automatic defence (the
 * brute-force login lock) lives in the login route. Writes data/brain/security/{report,watch-state}.json and appends
 * the case library. Prints one JSON line.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { isProtectedPath, resolveAccessGate } from "../src/lib/auth/accessGate";

/**
 * The live snapshot folder the access supervisor serves (<studio>\private\AtolyeAyasAccess\published-application-v1.json).
 * Read here directly rather than through the autonomy modules, so the watcher reaches nothing owner-only.
 */
function readPublishedLiveRoot(repoRoot: string): string {
  const studio = path.resolve(repoRoot, "..", "..");
  const selector = JSON.parse(fs.readFileSync(path.join(studio, "private", "AtolyeAyasAccess", "published-application-v1.json"), "utf8")) as { schemaVersion?: number; applicationRoot?: unknown };
  if (selector.schemaVersion !== 1 || typeof selector.applicationRoot !== "string") throw new Error("published application selector is invalid");
  return path.resolve(selector.applicationRoot);
}
import {
  evaluateSecurityWatch, runSecurityExam, vetLearnedChecks, WATCHED_PORTS,
  type FirewallAllowRule, type ListeningPort, type Measured, type SecretHit, type SecretScannerFacts, type SecurityExamResult, type SecurityFinding, type SecurityWatchFacts, type VulnerabilityCount,
} from "../src/lib/brain/security/SecurityWatchModel";
import { LEARNED_SECURITY_CHECKS } from "../src/lib/security-watch/LearnedChecks";
import { deriveSecurityNeeds, graceApproveSecurityProposals, proposeSecurityImprovements } from "../src/lib/brain/security/SecurityWatchImprovement";
import { resolveV3Paths } from "../src/lib/v3/V3Paths";
import { readLoginFacts, readSecurityCases, readSecurityResearchState, readSecurityWatchReport, readWatchState, recordSecurityCases, writeSecurityWatchReport, writeWatchState } from "../src/lib/brain/security/SecurityWatchStore";
import { researchChildDue, researchFactsFromState, summarizeResearch, type ResearchChildRecord, type SecurityResearchFacts } from "../src/lib/brain/security/SecurityResearch";
import { GITLEAKS, gitleaksConfigToml, parseGitleaksReport, toolInstallDir, toolRunDecision } from "../src/lib/brain/security/SecurityTools";

const root = process.cwd();
const MIN = 60_000;
const ROUND_MS = 14 * MIN;
const HOURLY_MS = 60 * MIN;
const DAILY_MS = 24 * 60 * MIN;
const WEEKLY_MS = 7 * DAILY_MS;

/** Routes that must always need a session. */
const SENSITIVE_ROUTES = ["/", "/brain", "/brain/revenue", "/brain/constitution", "/studio", "/studio/office-preview", "/api/ayas/chat", "/api/pipeline", "/api/projects"];

/** Credential shapes; a match counts only if it also looks random (has digits), so prose like "sk-Scheduler-…" does not. */
const SECRET_PATTERNS: readonly { readonly kind: string; readonly re: string }[] = [
  { kind: "OpenAI anahtarı", re: "sk-(proj-)?[A-Za-z0-9_-]{32,}" },
  { kind: "AWS erişim anahtarı", re: "AKIA[0-9A-Z]{16}" },
  { kind: "Google API anahtarı", re: "AIza[0-9A-Za-z_-]{35}" },
  { kind: "özel anahtar (PEM)", re: "-----BEGIN [A-Z ]*PRIVATE KEY-----" },
  { kind: "GitHub token", re: "gh[pousr]_[A-Za-z0-9]{36}" },
  { kind: "Slack token", re: "xox[baprs]-[A-Za-z0-9-]{10,}" },
];
/** Test fixtures and docs carry fake keys on purpose. */
const SECRET_EXCLUDES = [":!scripts/smoke-*", ":!*.example", ":!*.md", ":!docs/**", ":!package-lock.json", ":!**/package-lock.json"];

interface WatchState {
  readonly schemaVersion: 1;
  readonly lastRoundAt?: string;
  readonly hourlyAt?: string;
  readonly secretsAt?: string;
  readonly secretsHead?: string;
  readonly vulnsAt?: string;
  readonly examAt?: string;
  readonly cache?: Partial<Pick<SecurityWatchFacts, "ports" | "firewall" | "liveIntegrity" | "secrets" | "vulnerabilities" | "secretScanner" | "publicShield">>;
  /** The last research child this round started (2026-11-27). */
  readonly research?: ResearchChildRecord;
  readonly exam?: SecurityExamResult;
}

const due = (last: string | undefined, everyMs: number, nowMs: number) => !last || nowMs - Date.parse(last) >= everyMs;
const failed = <T,>(at: string, error: unknown): Measured<T> => ({ value: null, at, error: (error instanceof Error ? error.message : String(error)).split(/\r?\n/)[0]!.slice(0, 200) });

function powershellJson<T>(script: string): T[] {
  const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${script}`], { encoding: "utf8", windowsHide: true, timeout: 60_000, maxBuffer: 4_000_000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  if (!out) return [];
  const parsed = JSON.parse(out) as T | T[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

function measurePorts(at: string): Measured<readonly ListeningPort[]> {
  try {
    const rows = powershellJson<{ p: number; a: string; n: string | null }>(
      "Get-NetTCPConnection -State Listen | ForEach-Object { [pscustomobject]@{ p = $_.LocalPort; a = $_.LocalAddress; n = (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName } } | ConvertTo-Json -Compress",
    );
    return { value: rows.map((r) => ({ port: Number(r.p), address: String(r.a), process: r.n ?? "?" })), at };
  } catch (error) { return failed(at, error); }
}

function measureFirewall(at: string): Measured<readonly FirewallAllowRule[]> {
  const watched = Object.keys(WATCHED_PORTS).map((p) => `'${p}'`).join(",");
  try {
    const rows = powershellJson<{ n: string; p: string[] | string; f: string }>(
      "$pf = @{}; Get-NetFirewallPortFilter -All -ErrorAction SilentlyContinue | ForEach-Object { $pf[$_.InstanceID] = @($_.LocalPort) }; " +
      "Get-NetFirewallRule -Enabled True -Direction Inbound -Action Allow | Where-Object { [string]$_.Profile -match 'Public|Any' } | ForEach-Object { " +
      `$ports = $pf[$_.Name]; if ($ports | Where-Object { $_ -in @(${watched}) }) { [pscustomobject]@{ n = $_.DisplayName; p = @($ports | ForEach-Object { [string]$_ }); f = [string]$_.Profile } } } | ConvertTo-Json -Compress`,
    );
    return { value: rows.map((r) => ({ name: r.n, ports: Array.isArray(r.p) ? r.p : [r.p], profiles: r.f })), at };
  } catch (error) { return failed(at, error); }
}

/**
 * The Public profile's effective block-all switch (owner 2026-11-27: the office network stays Public, nobody on it may
 * see this machine). Read from the active store, so a group policy counts too; needs no admin rights.
 */
function measurePublicShield(at: string): Measured<{ blocksAllInbound: boolean; defaultInbound: string }> {
  try {
    const [row] = powershellJson<{ a: string; d: string }>("Get-NetFirewallProfile -Profile Public -PolicyStore ActiveStore | ForEach-Object { [pscustomobject]@{ a = [string]$_.AllowInboundRules; d = [string]$_.DefaultInboundAction } } | ConvertTo-Json -Compress");
    if (!row) throw new Error("Ortak profil okunamadı");
    return { value: { blocksAllInbound: row.a === "False", defaultInbound: row.d }, at };
  } catch (error) { return failed(at, error); }
}

function measureLiveIntegrity(at: string): Measured<{ snapshot: string; modified: string[]; headMatches: boolean }> {
  try {
    const live = readPublishedLiveRoot(root);
    const snapshot = path.basename(live);
    const modified = execFileSync("git", ["-C", live, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8", windowsHide: true, timeout: 120_000 })
      .split(/\r?\n/).filter(Boolean).map((line) => line.slice(3));
    const head = execFileSync("git", ["-C", live, "rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim();
    const named = /^ayas-live-([0-9a-f]{7,40})$/.exec(snapshot)?.[1];
    return { value: { snapshot, modified, headMatches: named ? head.startsWith(named) : false }, at };
  } catch (error) { return failed(at, error); }
}

function measureSecrets(at: string): Measured<readonly SecretHit[]> {
  try {
    const hits: SecretHit[] = [];
    for (const { kind, re } of SECRET_PATTERNS) {
      let out = "";
      try {
        out = execFileSync("git", ["grep", "-I", "-o", "-E", "-e", re, "--", ".", ...SECRET_EXCLUDES], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 60_000, maxBuffer: 8_000_000 });
      } catch (error) {
        // git grep exits 1 when nothing matched.
        if ((error as { status?: number }).status === 1) continue;
        throw error;
      }
      for (const line of out.split(/\r?\n/).filter(Boolean)) {
        const at2 = line.indexOf(":");
        const file = line.slice(0, at2);
        const token = line.slice(at2 + 1);
        if (kind !== "özel anahtar (PEM)" && !/\d.*\d/.test(token)) continue;
        if (!hits.some((h) => h.file === file && h.kind === kind)) hits.push({ file, kind });
      }
    }
    const envFiles = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 16_000_000 })
      .split(/\r?\n/).filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith(".example"));
    for (const file of envFiles) hits.push({ file, kind: "Git'te .env dosyası" });
    return { value: hits, at };
  } catch (error) { return failed(at, error); }
}

/**
 * Gitleaks over the whole Git history (owner 2026-11-27: "GitHub'ta bir şey varsa entegre edebilirsin"). Full scans
 * only: 1651 commits took 18 s on this machine, so an incremental mode is not worth its edge cases. The program is
 * hashed before every run and never executed when the hash differs from the pin; the report is read for file, rule,
 * line and commit only (`--redact`), written to a fresh temp folder that is removed afterwards.
 */
function runGitleaks(): { readonly hits: readonly SecretHit[]; readonly scanner: SecretScannerFacts } {
  const exe = path.join(root, ...toolInstallDir(GITLEAKS).split("/"), GITLEAKS.exe);
  const exists = fs.existsSync(exe);
  const decision = toolRunDecision(GITLEAKS, { exists, ...(exists ? { sha256: createHash("sha256").update(fs.readFileSync(exe)).digest("hex") } : {}) });
  if (!decision.run) return { hits: [], scanner: { tool: "yerlesik", version: null, reason: decision.reason } };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bekci-gitleaks-"));
  try {
    const config = path.join(dir, "gitleaks.toml");
    const report = path.join(dir, "report.json");
    fs.writeFileSync(config, gitleaksConfigToml());
    execFileSync(exe, ["git", ".", "--config", config, "--report-format", "json", "--report-path", report, "--redact", "--no-banner", "--exit-code", "0", "--log-level", "error"], { cwd: root, windowsHide: true, timeout: 90_000, maxBuffer: 4_000_000, stdio: ["ignore", "ignore", "pipe"] });
    const hits = parseGitleaksReport(JSON.parse(fs.readFileSync(report, "utf8")) as unknown)
      .map((h): SecretHit => ({ file: h.file, kind: h.rule, ...(h.line !== null ? { line: h.line } : {}), ...(h.commit ? { commit: h.commit } : {}) }));
    return { hits, scanner: { tool: "gitleaks", version: GITLEAKS.version, mode: "tam" } };
  } catch (error) {
    const reason = `Gitleaks çalışırken hata: ${(error instanceof Error ? error.message : String(error)).split(/\r?\n/)[0]!.slice(0, 160)}`;
    return { hits: [], scanner: { tool: "yerlesik", version: null, reason } };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The research child (scripts/ayas-security-research.ts): it decides itself whether a run is due; 150 s limit. */
function runResearchChild(): { readonly ok: boolean; readonly summary: string } {
  const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
  try {
    const out = execFileSync(process.execPath, [tsxCli, path.join(root, "scripts", "ayas-security-research.ts")], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 150_000, maxBuffer: 4_000_000, stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, summary: out.trim().split(/\r?\n/).at(-1) ?? "" };
  } catch (error) {
    return { ok: false, summary: (error instanceof Error ? error.message : String(error)).split(/\r?\n/)[0]!.slice(0, 200) };
  }
}

function measureVulnerabilities(at: string): Measured<VulnerabilityCount> {
  try {
    const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
    const out = execFileSync(process.execPath, [tsxCli, path.join(root, "scripts", "ayas-dependency-vulnerabilities.ts"), "--json"], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 150_000, maxBuffer: 16_000_000 });
    const report = JSON.parse(out.trim().split(/\r?\n/).at(-1) ?? "{}") as { locks?: { lock: string; vulnerabilities: { id: string; severity: string; dev: boolean }[] }[] };
    const shipped = (report.locks ?? []).filter((l) => l.lock === "package-lock.json").flatMap((l) => l.vulnerabilities).filter((v) => !v.dev);
    const count = (s: string) => shipped.filter((v) => v.severity.toLowerCase() === s).length;
    return { value: { critical: count("critical"), high: count("high"), moderate: count("moderate") + count("medium"), low: count("low"), topIds: shipped.filter((v) => /critical|high/i.test(v.severity)).map((v) => v.id).slice(0, 6) }, at };
  } catch (error) { return failed(at, error); }
}

async function main(): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const force = process.argv.includes("--force");
  const state: WatchState = readWatchState<WatchState>(root) ?? { schemaVersion: 1 };
  if (!force && !due(state.lastRoundAt, ROUND_MS, nowMs)) {
    console.log(JSON.stringify({ status: "NOT_DUE", lastRoundAt: state.lastRoundAt }));
    return;
  }
  const cache = { ...(state.cache ?? {}) };
  const head = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).trim(); } catch { return ""; } })();
  const ran: string[] = ["giris"];

  const hourly = force || due(state.hourlyAt, HOURLY_MS, nowMs);
  if (hourly) {
    cache.ports = measurePorts(nowIso);
    cache.firewall = measureFirewall(nowIso);
    cache.publicShield = measurePublicShield(nowIso);
    cache.liveIntegrity = measureLiveIntegrity(nowIso);
    ran.push("port", "guvenlik-duvari", "canli");
  }
  const secretsDue = force || due(state.secretsAt, DAILY_MS, nowMs) || state.secretsHead !== head;
  if (secretsDue) {
    // The built-in patterns see the working tree, Gitleaks the whole history; both together, Gitleaks reported apart.
    const builtIn = measureSecrets(nowIso);
    const gitleaks = runGitleaks();
    cache.secrets = builtIn.value ? { value: [...builtIn.value, ...gitleaks.hits], at: nowIso } : builtIn;
    cache.secretScanner = { value: gitleaks.scanner, at: nowIso };
    ran.push("sir");
  }
  const vulnsDue = force || due(state.vulnsAt, DAILY_MS, nowMs);
  if (vulnsDue) { cache.vulnerabilities = measureVulnerabilities(nowIso); ran.push("acik"); }
  // Internet research (owner 2026-11-27: "internete bağla, araştırsın sürekli"), never in the round of the slow audit.
  let researchChild: ResearchChildRecord = state.research ?? {};
  let researchSummary: string | undefined;
  const researchGate = researchChildDue({ state: (() => { try { return readSecurityResearchState(root); } catch { return null; } })(), child: researchChild, head, heavyRoundAlready: vulnsDue && !force, nowMs });
  if (researchGate.due) {
    const r = runResearchChild();
    researchChild = { startedAt: nowIso, ok: r.ok, head, ...(r.ok ? {} : { error: r.summary }) };
    researchSummary = r.summary;
    ran.push("arastirma");
  }
  const examDue = force || due(state.examAt, WEEKLY_MS, nowMs);
  const exam = examDue ? runSecurityExam(nowIso) : state.exam;
  if (examDue) ran.push("sinav");

  let login: Measured<ReturnType<typeof readLoginFacts>>;
  try { login = { value: readLoginFacts(nowMs, root), at: nowIso }; } catch (error) { login = failed(nowIso, error); }
  const gate = resolveAccessGate(process.env);
  const keyLength = (process.env.AYAS_ACCESS_KEY ?? "").length;
  const notYet = <T,>(): Measured<T> => ({ value: null, at: nowIso, error: "henüz ölçülmedi" });
  const facts: SecurityWatchFacts = {
    login,
    accessKey: { value: { length: keyLength, enforced: gate.mode === "enforced" }, at: nowIso },
    openSensitiveRoutes: { value: SENSITIVE_ROUTES.filter((r) => !isProtectedPath(r)), at: nowIso },
    ports: cache.ports ?? notYet(),
    firewall: cache.firewall ?? notYet(),
    ...(cache.publicShield ? { publicShield: cache.publicShield } : {}),
    liveIntegrity: cache.liveIntegrity ?? notYet(),
    secrets: cache.secrets ?? notYet(),
    vulnerabilities: cache.vulnerabilities ?? notYet(),
    // The research child's stored answer; a child that crashed or timed out is reported as its own unmeasured source
    // until a later one succeeds (the cached lists stay, so a known threat does not vanish).
    research: (() => {
      try {
        const s = readSecurityResearchState(root);
        if (!s) return researchChild.ok === false ? failed<SecurityResearchFacts>(nowIso, `araştırma süreci: ${researchChild.error ?? "başarısız"}`) : notYet<SecurityResearchFacts>();
        const f = researchFactsFromState(s, nowMs);
        const child = researchChild.ok === false ? [{ id: "cocuk" as const, ok: false, at: researchChild.startedAt ?? nowIso, error: researchChild.error ?? "başarısız" }] : [];
        return { value: { ...f, sources: [...f.sources, ...child] }, at: s.lastAttemptAt };
      } catch (error) { return failed<SecurityResearchFacts>(nowIso, error); }
    })(),
    secretScanner: cache.secretScanner ?? notYet(),
  };
  const findings = evaluateSecurityWatch(facts, nowIso, LEARNED_SECURITY_CHECKS);
  const learned = vetLearnedChecks(LEARNED_SECURITY_CHECKS).verdicts;
  let previous: readonly SecurityFinding[] = [];
  try { previous = readSecurityWatchReport(root)?.findings ?? []; } catch { previous = []; }
  const cases = recordSecurityCases(previous, findings, nowIso, root);
  const measuredAt = Object.fromEntries(Object.entries(facts).map(([k, m]) => [k, (m as Measured<unknown>).at])) as Record<keyof SecurityWatchFacts, string>;
  const report = {
    schemaVersion: 1 as const, checkedAt: nowIso, findings, measuredAt, learned, ...(exam ? { exam } : {}),
    ...(facts.research.value ? { research: summarizeResearch(facts.research.value, facts.research.at) } : {}),
    ...(facts.secretScanner.value ? { scanner: facts.secretScanner.value } : {}),
  };
  writeSecurityWatchReport(report, root);
  // Self-improvement: measured needs → AYAS's review → Gelişim Merkezi ("AYAS ÖNERİYOR · Bekçi'den") → grace approval.
  let improvement: unknown = null;
  try {
    const workRoot = resolveV3Paths(root).workRoot;
    const needs = deriveSecurityNeeds(readSecurityCases(400, root), report, nowMs);
    const proposed = await proposeSecurityImprovements(workRoot, needs, process.env, now);
    const approved = await graceApproveSecurityProposals(workRoot, process.env, now);
    improvement = { needs: needs.length, filed: proposed.filed.length, refused: proposed.refused.length, approved: approved.length };
  } catch (error) {
    improvement = { error: (error instanceof Error ? error.message : String(error)).slice(0, 200) };
  }
  writeWatchState({
    schemaVersion: 1, lastRoundAt: nowIso,
    hourlyAt: hourly ? nowIso : state.hourlyAt,
    secretsAt: secretsDue ? nowIso : state.secretsAt, secretsHead: secretsDue ? head : state.secretsHead,
    vulnsAt: vulnsDue ? nowIso : state.vulnsAt,
    examAt: examDue ? nowIso : state.examAt,
    cache, ...(exam ? { exam } : {}), research: researchChild,
  } satisfies WatchState, root);
  console.log(JSON.stringify({ status: "WATCHED", ran, findings: findings.length, serious: findings.filter((f) => f.severity === "kritik" || f.severity === "yuksek").length, newCases: cases.length, improvement, exam: exam ? `${exam.passed}/${exam.total}` : null, scanner: facts.secretScanner.value?.tool ?? null, research: researchSummary ? researchSummary.slice(0, 300) : researchGate.reason }));
}

main().catch((error: unknown) => {
  console.error(`Güvenlik turu yapılamadı: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

