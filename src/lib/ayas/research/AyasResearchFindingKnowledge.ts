import type { AyasExternalResearchFinding } from "../../brain/autonomy/AyasExternalResearchStore";
import { applicationGate, type AtolyeStage, brainsOf, canonicalUrl, contentHash, type CostClass, type KnowledgeRecord, knowledgeId, loadKnowledge, looksLikeInjection, saveKnowledge, stagesOf } from "./AyasSharedKnowledge";

/**
 * Stage 8's recorded research findings in the shared knowledge (owner, 2026-11-05: what AYAS researched should be
 * findable by AYAS and the brains, not only by the discovery loop). Findings that say something — their problem text
 * is more than the capability keyword — become one sourced record per source page (a release's several findings are
 * that page's quotes), with the official-source flag, the licence/cost status and the Atölye gap note. A keyword-only
 * release match is left out; it would only add noise to a recall. Pure mapping plus one store write; nothing is
 * fetched, and a record never authorises anything.
 */

const COST: Readonly<Record<AyasExternalResearchFinding["licenseCostStatus"], CostClass>> = {
  "open-source": "ACIK_KAYNAK_YEREL", "free-tier-available": "UCRETSIZ_HESAPLI", "paid-only": "UCRETLI", unknown: "BILINMIYOR",
};
/** Stage 8's capability taxonomy (AyasCapabilityTaxonomy) onto the pipeline stages; agent/platform categories serve the developer brain only. */
const CATEGORY_STAGES: Readonly<Record<string, readonly AtolyeStage[]>> = {
  VOICE_AI: ["voice"], TTS: ["voice"], AUDIO_AI: ["audio"], AUDIO_CLEANUP: ["audio"], TRANSCRIPTION: ["assembly"], SUBTITLES: ["assembly"],
  VIDEO_EDITING: ["assembly"], EXPORT: ["assembly"], TRANSITIONS: ["scenes"], MOTION: ["animation"], VIDEO_AI: ["animation"],
  IMAGE_AI: ["visuals"], BROLL: ["visuals"], QUALITY_ASSURANCE: ["quality"], RESEARCH_AGENTS: ["research"],
};
const GAP: Readonly<Record<AyasExternalResearchFinding["atolyeGapStatus"], string>> ={ "already-supported": "Atölye'de zaten var", "partially-supported": "Atölye'de kısmen var", missing: "Atölye'de yok" };

export function isAyasFindingWorthKnowing(finding: Pick<AyasExternalResearchFinding, "problemSolved" | "capability" | "sourceUrl">): boolean {
  const text = String(finding.problemSolved ?? "").trim();
  if (text.length < 40 || text.toLowerCase() === String(finding.capability ?? "").trim().toLowerCase()) return false;
  try { return /^https?:$/.test(new URL(finding.sourceUrl).protocol); } catch { return false; }
}

const checkedAt = (finding: AyasExternalResearchFinding): string => finding.lastCheckedAt || finding.recordedAt;

/** One record for the findings of one source page (same canonical URL), newest check first. */
export function knowledgeFromResearchFindings(group: readonly AyasExternalResearchFinding[]): KnowledgeRecord {
  const sorted = [...group].sort((a, b) => checkedAt(b).localeCompare(checkedAt(a)));
  const first = sorted[0]!;
  const text = sorted.map((f) => [f.capability, f.problemSolved, f.licenseCostNotes, f.atolyeGapNotes].filter(Boolean).join("\n")).join("\n\n");
  const asamalar = [...new Set([...sorted.flatMap((f) => CATEGORY_STAGES[f.category ?? ""] ?? []), ...stagesOf(text)])];
  const known = sorted.find((f) => f.licenseCostStatus !== "unknown");
  const capabilities = [...new Set(sorted.map((f) => f.capability))];
  const base = {
    schemaVersion: 1 as const, id: knowledgeId(first.sourceUrl), url: canonicalUrl(first.sourceUrl),
    baslik: `${first.provider}: ${capabilities.slice(0, 3).join("; ")}${capabilities.length > 3 ? ` (+${capabilities.length - 3})` : ""}`.slice(0, 200),
    tur: /(^|\.)github\.com$/i.test(new URL(first.sourceUrl).hostname) ? "github" as const : "web" as const, yayinci: first.provider,
    ...(first.featureDate ? { yayinTarihi: first.featureDate } : {}), erisimTarihi: checkedAt(first),
    ...(known ? { lisans: { kanit: `Stage 8: ${known.licenseCostStatus}${known.licenseCostNotes ? ` — ${known.licenseCostNotes.slice(0, 160)}` : ""}` } } : {}),
    maliyet: { sinif: known ? COST[known.licenseCostStatus] : "BILINMIYOR" as CostClass, kanit: [...new Set(sorted.map((f) => f.licenseCostNotes).filter(Boolean))].slice(0, 3).map((n) => n.slice(0, 240)) },
    alintilar: sorted.map((f) => f.problemSolved.slice(0, 240)).slice(0, 8),
    ozet: `${sorted.map((f) => f.problemSolved).join(" · ").slice(0, 440)} (${[...new Set(sorted.map((f) => GAP[f.atolyeGapStatus] ?? GAP.missing))].join(", ")})`,
    kavramlar: asamalar,
    dogrulama: { durum: sorted.some((f) => f.isOfficialSource) ? "RESMI_KAYNAK" as const : "TEK_KAYNAK" as const, kaynaklar: [canonicalUrl(first.sourceUrl)], not: `AYAS Stage 8 araştırması (${sorted.length} bulgu)` },
    asamalar, beyinler: [...new Set([...brainsOf(asamalar), "gelistirici" as const])],
    firsatlar: sorted.every((f) => f.atolyeGapStatus === "already-supported") ? [] : asamalar.filter((s) => s !== "cost").map((s) => `${s} aşaması için değerlendir`),
    tekrarKontrol: new Date(Date.parse(checkedAt(first)) + 90 * 86_400_000).toISOString(),
    etiketler: ["stage8-arastirma", ...new Set(sorted.flatMap((f) => (f.category ? [f.category] : [])))],
    icerikHash: contentHash(text), enjeksiyonSuphesi: looksLikeInjection(text), otomatikUygulanabilir: false as const,
  };
  return { ...base, uygulamaEngeli: applicationGate(base) };
}

/**
 * Writes the source pages not yet in the store, or with a finding checked since; writes nothing when nothing is new
 * (the discovery child runs every tick). Returns how many records were written.
 */
export async function mirrorAyasResearchFindings(repoRoot: string, findings: readonly AyasExternalResearchFinding[], limit = 60): Promise<number> {
  const groups = new Map<string, AyasExternalResearchFinding[]>();
  for (const finding of findings.filter(isAyasFindingWorthKnowing)) {
    const id = knowledgeId(finding.sourceUrl);
    groups.set(id, [...(groups.get(id) ?? []), finding]);
  }
  const stored = new Map((await loadKnowledge(repoRoot)).map((record) => [record.id, record.erisimTarihi]));
  const fresh = [...groups.entries()].filter(([id, group]) => {
    const seen = stored.get(id);
    return seen === undefined || group.some((finding) => Date.parse(checkedAt(finding)) > Date.parse(seen));
  }).slice(0, limit);
  if (!fresh.length) return 0;
  await saveKnowledge(repoRoot, fresh.map(([, group]) => knowledgeFromResearchFindings(group)));
  return fresh.length;
}
