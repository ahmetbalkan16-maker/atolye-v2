import type { AyasGoalDevelopmentView } from "./AyasGoalDevelopmentView";
import { buildAyasModelWatchSpokenSummary } from "./AyasModelWatch";
import type { AyasResearchEngineStatusView } from "./AyasResearchEngineStatusView";
import type { AyasResearchHealth, AyasUpdateRadarItem } from "./AyasUpdateRadar";

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
  | { readonly kind: "updates" }
  | { readonly kind: "model" }
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

  // Questions about AYAS's own chat model (the Gelişim Merkezi model comparison). Question-shaped only, and never a
  // project question, so a production asset such as a 3D model stays with the project answers.
  const model =
    !/\bproje\w*\b/.test(t) && (
      /\b(?:daha iyi|yeni|guncel|baska) (?:bir )?(?:yapay zek[aâ] |yerel |dil )?model\w* (?:var mi|cikti mi|cikmis mi|onerir misin)\b/.test(t) ||
      /\bmodel (?:karsilastirma\w*|onerin\w*|onerisi\w*)\b/.test(t) ||
      /\b(?:yapay zek[aâ]|yerel) model\w* ne durumda\b/.test(t) ||
      /\bhangi model daha iyi\b/.test(t));
  if (model) return { kind: "model" };

  // Tool-update questions (the Gelişim Merkezi update radar). Question-shaped only, so a command such as
  // "Next.js'i güncelle" never matches, and a project's own updates stay with the project answers.
  const updates =
    !/\bproje\w*\b/.test(t) && (
      /\bguncelleme radar\w*\b/.test(t) ||
      /\bhangi guncelleme\w*\b/.test(t) ||
      /\bguncelleme\w* (var mi|ne durumda|neler|nedir)\b/.test(t) ||
      /\byeni (surum|versiyon)\w*\b.*\b(var mi|cikti mi|cikmis mi|neler)\b/.test(t));
  if (updates) return { kind: "updates" };

  const digest =
    // "AYAS, araştırma ne durumda?" — anchored, so "<proje> araştırması ne durumda" stays a project question.
    /^(?:ayas\W+)?(?:dis |internet |otomatik )?arastirma(?:lar)?(?:in|nin)? (?:ne durumda|durumu\w*|nasil gidiyor)\b/.test(t) ||
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

const MAX_SPOKEN_RADAR_ITEMS = 4;
const SPOKEN_BUMP: Readonly<Record<AyasUpdateRadarItem["bump"], string>> = { MAJOR: "ana sürüm", MINOR: "ara sürüm", PATCH: "yama" };

/** The update radar as one spoken sentence; undefined means the radar could not be built and says so. */
export function buildAyasUpdateRadarSpokenSummary(radar: readonly AyasUpdateRadarItem[] | undefined): string {
  if (!radar) return "Güncelleme radarı şu an okunamıyor.";
  if (!radar.length) return "Güncelleme radarında bekleyen yeni sürüm yok; izlenen araçlar güncel.";
  const items = radar.slice(0, MAX_SPOKEN_RADAR_ITEMS).map((item) => item.applyChannel === "OWNER_PINNED_RUNTIME"
    ? `${item.toolName} ${item.installedVersion} yerine ${item.latestVersion} (kurulumu sen yaparsın)`
    : `${item.toolName} ${item.installedVersion} yerine ${item.latestVersion} (${SPOKEN_BUMP[item.bump]})`);
  const more = radar.length > MAX_SPOKEN_RADAR_ITEMS ? ` ve ${radar.length - MAX_SPOKEN_RADAR_ITEMS} araç daha` : "";
  return `Güncelleme radarında ${radar.length} araç için yeni sürüm var: ${items.join(", ")}${more}. Hiçbiri kendiliğinden uygulanmaz; onaylarsan bir geliştirme oturumunda uygulanır, ayrıntılar Gelişim Merkezi'nde.`;
}

/** Only a degraded research engine is worth saying aloud; healthy and quiet states add nothing to the digest. */
function spokenResearchHealth(health: AyasResearchHealth | undefined): string {
  if (!health || health.status !== "DEGRADED") return "";
  return ` Araştırmada sorun var: ${health.reasons.join(" ")}`;
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

  if (intent.kind === "updates") {
    if (!researchEngineStatus.connected) return "Güncelleme radarı şu an okunamıyor.";
    return buildAyasUpdateRadarSpokenSummary(researchEngineStatus.updateRadar);
  }

  if (intent.kind === "model") {
    if (!researchEngineStatus.connected) return "Model karşılaştırması şu an okunamıyor.";
    return buildAyasModelWatchSpokenSummary(researchEngineStatus.modelWatch);
  }

  // digest
  if (!researchEngineStatus.connected) return "Araştırma motoru şu an okunamıyor.";
  const d = researchEngineStatus.digest;
  const activity = d.findingsLast24h === 0 && d.sourcesChangedLast24h === 0
    ? `Son 24 saatte ${d.sourcesRegistered} kaynak izlendi ama yeni bir değişiklik ya da bulgu yoktu.`
    : `Son 24 saatte ${d.sourcesRegistered} kaynak izlendi, ${d.sourcesChangedLast24h} tanesi değişti ve ${d.findingsLast24h} yeni bulgu kaydedildi.`;
  const model = buildAyasModelWatchSpokenSummary(researchEngineStatus.modelWatch, { actionableOnly: true });
  return `${activity}${spokenResearchHealth(researchEngineStatus.researchHealth)} ${buildAyasUpdateRadarSpokenSummary(researchEngineStatus.updateRadar)}${model ? ` ${model}` : ""}`;
}
