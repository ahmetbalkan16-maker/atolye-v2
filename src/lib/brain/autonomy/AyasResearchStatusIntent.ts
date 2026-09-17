import type { AyasGoalDevelopmentView } from "./AyasGoalDevelopmentView";
import type { AyasResearchEngineStatusView } from "./AyasResearchEngineStatusView";

/**
 * AYAS CONTINUOUS EXTERNAL INTELLIGENCE sprint — "Natural Language Status"
 * (spec: "Son internette ne araştırdın?" / "Sonraki araştırma ne zaman?" /
 * "CapCut tarafında yeni ne buldun?" etc.). Same deterministic, Turkish-
 * aware, pre-model-call pattern `detectAyasReportIntent` /
 * `buildAyasReportSpokenAnswer` already established in
 * `BrainReportCenter.ts` for "AYAS, rapor ver" — answered directly from
 * real durable state, before any model call, so the answer can never
 * invent a source, a date, or a finding that was not actually recorded.
 */
export type AyasResearchStatusIntent =
  | { readonly kind: "digest" }
  | { readonly kind: "next-schedule" }
  | { readonly kind: "provider"; readonly providerQuery: string }
  | null;

function foldTurkish(text: string): string {
  return String(text ?? "")
    .toLocaleLowerCase("tr")
    .replace(/[İıI]/g, "i")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectAyasResearchStatusIntent(text: string): AyasResearchStatusIntent {
  const t = foldTurkish(text);
  if (!t) return null;

  const providerMatch = t.match(/\b([a-z0-9]+)\s+taraf(?:i|ı)nda\b.*\bbuldun\b/);
  if (providerMatch?.[1]) return { kind: "provider", providerQuery: providerMatch[1] };

  const nextSchedule =
    /\bsonraki arastirma ne zaman\b/.test(t) ||
    /\bbir sonraki (tarama|arastirma)\b/.test(t) ||
    /\bne zaman (arastir|tekrar arastir)\w*\b/.test(t);
  if (nextSchedule) return { kind: "next-schedule" };

  const digest =
    /\bson internette ne arastirdin\b/.test(t) ||
    /\bhangi.*platform\w*.*bakt\w*\b/.test(t) ||
    /\bson 24 saatte\b.*\b(ozellik|kesfet)\w*\b/.test(t) ||
    /\batolye icin ne ogrendin\b/.test(t) ||
    /\bkendini gelistirmek icin\b.*\bogrendin\b/.test(t) ||
    /\bne arastirdin\b/.test(t) ||
    /\bneler kesfettin\b/.test(t) ||
    /\barastirma (yaptin mi|var mi)\b/.test(t);
  if (digest) return { kind: "digest" };

  return null;
}

function formatSpokenTime(iso: string | undefined): string {
  if (!iso) return "henüz planlanmadı";
  const d = new Date(iso);
  return d.toLocaleString("tr-TR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

export function buildAyasResearchStatusSpokenAnswer(
  goalDevelopment: AyasGoalDevelopmentView,
  researchEngineStatus: AyasResearchEngineStatusView,
  intent: AyasResearchStatusIntent,
): string {
  if (!intent) return "";

  if (intent.kind === "next-schedule") {
    if (!researchEngineStatus.connected) return "Araştırma zamanlaması şu an okunamıyor.";
    return `Sıradaki hafif tarama ${formatSpokenTime(researchEngineStatus.nextLightAt)}, sıradaki derin analiz ${formatSpokenTime(researchEngineStatus.nextDeepAt)} tarihinde planlandı.`;
  }

  if (intent.kind === "provider") {
    if (!goalDevelopment.connected) return "Araştırma bulguları şu an okunamıyor.";
    const matches = goalDevelopment.research.filter((f) => f.provider.toLocaleLowerCase("tr").includes(intent.providerQuery));
    if (matches.length === 0) return `${intent.providerQuery} tarafında henüz kaydedilmiş bir bulgu yok.`;
    const top = matches[0]!;
    const extra = matches.length > 1 ? ` Toplam ${matches.length} bulgu var.` : "";
    return `${top.provider} tarafında son bulgu: ${top.capability}. ${top.problemSolved}${extra}`;
  }

  // digest
  if (!researchEngineStatus.connected) return "Araştırma motoru şu an okunamıyor.";
  const d = researchEngineStatus.digest;
  if (d.findingsLast24h === 0 && d.sourcesChangedLast24h === 0) {
    return `Son 24 saatte ${d.sourcesRegistered} kaynak izlendi ama yeni bir değişiklik ya da bulgu yoktu.`;
  }
  return `Son 24 saatte ${d.sourcesRegistered} kaynak izlendi, ${d.sourcesChangedLast24h} tanesi değişti ve ${d.findingsLast24h} yeni bulgu kaydedildi.`;
}
