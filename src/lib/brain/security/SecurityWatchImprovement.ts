/**
 * How the security brain ("Bekçi") improves itself without doing harm (owner 2026-11-26):
 *
 *   "kendini geliştirmesi için 5 dakika beklesin sonra kendisi işleme alsın ama gereksiz ve sisteme zararlı gelecek
 *    geliştirmeleri yapmaması lazım" — and then: "ayasa önersin, ayas da kendisi kontrol etsin bize ne yararı var ne
 *    zararı var, sonra gelişim merkezindeki AYAS öneriyor'a düşsün".
 *
 * 1. Bekçi notices a need only from measured evidence in its case library and report (`deriveSecurityNeeds`):
 *    a finding that keeps coming back, or a learned check the core switched off.
 * 2. AYAS reviews each need (`ayasReviewSecurityNeed`, deterministic rules, no model): what it would gain, what it
 *    could break. It refuses what would need a protected file (the security rules, login/approval code, the
 *    homepage, configs), a need already proposed or rejected, and more than one new proposal a day or two open ones.
 * 3. What AYAS recommends lands in the Gelişim Merkezi as "AYAS ÖNERİYOR · Bekçi'den" (a main-AYAS development
 *    proposal). If the owner does not reject it within the grace period (AYAS_GRACE_AUTO_APPROVE_MS, 5 min) it is
 *    approved by itself (`graceApproveSecurityProposals`); the evening developer builds it; the finished build goes
 *    through the code lane's own refusals, tests and the existing 5-minute grace before anything is applied.
 *
 * The only file a security improvement may change is `src/lib/security-watch/LearnedChecks.ts` (additive checks,
 * vetted by the protected core). This module is protected itself (FORBIDDEN_AUTONOMOUS).
 */

import { decideProposal, listProposals, proposeDevelopment, type DevProposal } from "../../v3/council/SelfImprovement";
import type { LearnedCheckVerdict, SecurityWatchReport } from "./SecurityWatchModel";
import type { SecurityCase } from "./SecurityWatchStore";

export const SECURITY_PROPOSAL_SOURCE = "Bekçi (güvenlik beyni)";
const DAY_MS = 24 * 60 * 60_000;
/** Owner rule: at most one new proposal a day, at most two open (waiting or being built). */
export const MAX_NEW_PER_DAY = 1;
export const MAX_OPEN = 2;
/** A finding counts as recurring when it was seen this many times in the last week. */
export const RECURRING_TIMES = 3;

export interface SecurityNeed {
  /** Stable key, stored as the proposal's source (`bekci:<key>`) so it is never proposed twice. */
  readonly key: string;
  readonly kind: "tekrarlayan-bulgu" | "kapatilan-kontrol";
  readonly title: string;
  readonly evidence: string;
}

/** Needs backed by measurements only; nothing is "needed" because it might be nice. */
export function deriveSecurityNeeds(cases: readonly SecurityCase[], report: SecurityWatchReport | null, nowMs: number): readonly SecurityNeed[] {
  const needs: SecurityNeed[] = [];
  const week = cases.filter((c) => c.event === "goruldu" && nowMs - Date.parse(c.at) < 7 * DAY_MS && !c.id.startsWith("olculemedi:"));
  const byId = new Map<string, SecurityCase[]>();
  for (const c of week) byId.set(c.id, [...(byId.get(c.id) ?? []), c]);
  for (const [id, seen] of byId) {
    if (seen.length < RECURRING_TIMES) continue;
    needs.push({ key: `tekrar:${id}`, kind: "tekrarlayan-bulgu", title: `Tekrarlayan güvenlik bulgusu: ${seen[0]!.title}`, evidence: `son 7 günde ${seen.length} kez görüldü ve kayboldu (${id}); son kanıt: ${seen.at(-1)!.evidence}` });
  }
  for (const v of report?.learned ?? []) {
    if (v.status === "aktif") continue;
    needs.push({ key: `kontrol:${v.id}:${v.status}`, kind: "kapatilan-kontrol", title: `Öğrenilen güvenlik kontrolü kapatıldı: ${v.id}`, evidence: `${verdictText(v)} (öğrenildiği yer: ${v.learnedFrom})` });
  }
  return needs;
}

function verdictText(v: LearnedCheckVerdict): string {
  return v.status === "gereksiz" ? "kendi örnek vakasını yakalamıyor (gereksiz)" : v.status === "yanlis-alarm" ? "temiz makinede alarm veriyor (yanlış alarm)" : "hatalı (çöktü ya da kritik seviye istedi)";
}

export interface AyasSecurityReview {
  readonly verdict: "oneriyor" | "onermiyor";
  readonly yarar: string;
  readonly zarar: string;
  /** Why AYAS does not recommend it (when it does not). */
  readonly neden?: string;
  /** The task text for the developer, when recommended. */
  readonly gorev?: string;
}

/**
 * AYAS's own check of a need: benefit, harm, and a verdict. Deterministic. A need is never recommended when it was
 * already proposed (open, built or rejected — a rejection is final), or when the daily/open limits are reached.
 */
export function ayasReviewSecurityNeed(need: SecurityNeed, existing: readonly Pick<DevProposal, "kaynaklar" | "durum" | "tarih" | "ayasOneriyor">[], nowMs: number): AyasSecurityReview {
  const mine = existing.filter((p) => p.ayasOneriyor?.kaynak === SECURITY_PROPOSAL_SOURCE);
  const source = `bekci:${need.key}`;
  const harmNone = "Yalnız src/lib/security-watch/LearnedChecks.ts'e ekleme yapılır: hiçbir çekirdek kontrol, giriş/onay kodu, ana sayfa ya da ayar değişmez. Yeni kontrol temiz makinede alarm verirse ya da kendi örneğini yakalamazsa Bekçi onu kendisi kapatır.";
  if (existing.some((p) => p.kaynaklar.includes(source))) return { verdict: "onermiyor", yarar: "-", zarar: "-", neden: "Bu ihtiyaç daha önce önerildi (açık, yapıldı ya da reddedildi); tekrar önerilmez." };
  if (mine.filter((p) => nowMs - Date.parse(p.tarih) < DAY_MS).length >= MAX_NEW_PER_DAY) return { verdict: "onermiyor", yarar: "-", zarar: "-", neden: "Bugün zaten bir güvenlik önerisi yapıldı (günde en fazla bir)." };
  if (mine.filter((p) => p.durum === "bekliyor" || p.durum === "onaylandi" || p.durum === "yapiliyor" || p.durum === "hazir").length >= MAX_OPEN) return { verdict: "onermiyor", yarar: "-", zarar: "-", neden: "Açıkta iki güvenlik önerisi var; onlar bitmeden yenisi önerilmez." };
  if (need.kind === "tekrarlayan-bulgu") {
    return {
      verdict: "oneriyor",
      yarar: `Aynı sorun bir haftada ${RECURRING_TIMES}+ kez geri geldi; kökünü erken yakalayan bir kontrol, sorun büyümeden haber verir.`,
      zarar: harmNone,
      gorev: `${need.title}. Evidence: ${need.evidence}. Add ONE learned check to src/lib/security-watch/LearnedChecks.ts that catches the cause of this recurring finding earlier or more precisely (pure function of SecurityWatchFacts, its own exam case, severity at most "yuksek", Turkish title/advice). Change no other file except a new smoke scenario in scripts/smoke-ayas-security-watch-learned.ts. If no measured fact can catch it earlier, change nothing and say why.`,
    };
  }
  return {
    verdict: "oneriyor",
    yarar: "Kapatılan kontrol ya düzeltilir ya da listeden çıkarılır; Bekçi'nin raporu temiz ve anlamlı kalır.",
    zarar: harmNone,
    gorev: `${need.title}. ${need.evidence}. Fix this learned check in src/lib/security-watch/LearnedChecks.ts so it catches its exam case and stays silent on a clean machine, or remove that one learned check. Change no other file except scripts/smoke-ayas-security-watch-learned.ts.`,
  };
}

/** Grace period, the same switch and default as the Gelişim Merkezi's (AYAS_GRACE_AUTO_APPROVE_MS, min 60 s). */
export function securityGraceMs(env: NodeJS.ProcessEnv): number | null {
  if (env.AYAS_GRACE_AUTO_APPROVE === "0") return null;
  const raw = Number(env.AYAS_GRACE_AUTO_APPROVE_MS ?? 300_000);
  return Math.max(60_000, Number.isFinite(raw) ? raw : 300_000);
}

/**
 * Files what AYAS recommends into the Gelişim Merkezi. Returns what was filed and what AYAS refused (for the report).
 */
export async function proposeSecurityImprovements(workRoot: string, needs: readonly SecurityNeed[], env: NodeJS.ProcessEnv, now = new Date()): Promise<{ readonly filed: readonly string[]; readonly refused: readonly { readonly key: string; readonly neden: string }[] }> {
  const filed: string[] = [];
  const refused: { key: string; neden: string }[] = [];
  const grace = securityGraceMs(env);
  for (const need of needs) {
    const existing = (await listProposals(workRoot)).map((x) => x.proposal);
    const review = ayasReviewSecurityNeed(need, existing, now.getTime());
    if (review.verdict !== "oneriyor" || !review.gorev) { refused.push({ key: need.key, neden: review.neden ?? "önerilmedi" }); continue; }
    await proposeDevelopment(workRoot, {
      beyin: "sef", baslik: `Güvenlik: ${need.title}`.slice(0, 200), neden: review.gorev, kaynak: `bekci:${need.key}`, kaynakTuru: "olcum", kapsam: "ayas",
      ayasOneriyor: { kaynak: SECURITY_PROPOSAL_SOURCE, yarar: review.yarar, zarar: review.zarar, otomatikOnay: grace === null ? "kapalı" : new Date(now.getTime() + grace).toISOString() },
    }, now);
    filed.push(need.key);
  }
  return { filed, refused };
}

/**
 * Approves Bekçi's waiting proposals whose grace has passed without the owner's REDDET (a rejection changes the state,
 * so it is never overridden). Nothing is built or applied here; the developer and the code lane do that, with their
 * own refusals, tests and grace.
 */
export async function graceApproveSecurityProposals(workRoot: string, env: NodeJS.ProcessEnv, now = new Date()): Promise<readonly string[]> {
  const grace = securityGraceMs(env);
  if (grace === null) return [];
  const approved: string[] = [];
  for (const { proposal } of await listProposals(workRoot)) {
    if (proposal.durum !== "bekliyor" || proposal.ayasOneriyor?.kaynak !== SECURITY_PROPOSAL_SOURCE) continue;
    if (now.getTime() - Date.parse(proposal.tarih) < grace) continue;
    await decideProposal(workRoot, proposal.id, "onaylandi", `Bekçi önerisi; AYAS önerdi, sahip ${Math.round(grace / 60_000)} dakikada itiraz etmedi`, now);
    approved.push(proposal.id);
  }
  return approved;
}
