import { detectAyasReportIntent, type AyasReportIntent } from "@/lib/brain/selfheal/BrainReportCenter";
import { detectAyasResearchStatusIntent, type AyasResearchStatusIntent } from "@/lib/brain/autonomy/AyasResearchStatusIntent";
import { isAyasDevelopmentStatusQuery } from "./model/AyasComplexityRouter";
import { detectAyasLiveInfoIntent, type AyasLiveInfoIntent } from "./liveinfo/AyasLiveInfoIntent";

const GUIDED_REPAIR_TOKENS = new Set([
  "hata",
  "bug",
  "exception",
  "çalışmıyor",
  "çöktü",
  "düzelt",
]);

function isWithinOneEdit(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false;
  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) leftIndex += 1;
    else if (right.length > left.length) rightIndex += 1;
    else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }
  return edits + Number(leftIndex < left.length || rightIndex < right.length) <= 1;
}

/**
 * Token-aware guided-repair signal. Unicode letter/number runs are extracted
 * first, so Turkish casing is preserved correctly and ASCII `\b` semantics
 * cannot mistake the `bug` prefix in `Bugün` for the standalone word `bug`.
 */
export function isAyasGuidedRepairQuery(text: string): boolean {
  const tokens = String(text ?? "")
    .normalize("NFC")
    .toLocaleLowerCase("tr")
    .match(/[\p{L}\p{N}_]+/gu) ?? [];
  return tokens.some((token) =>
    GUIDED_REPAIR_TOKENS.has(token) ||
    (token.length >= 8 && [...GUIDED_REPAIR_TOKENS].some((known) => known.length >= 8 && isWithinOneEdit(token, known))),
  );
}

export type AyasPreReasoningIntent =
  | { readonly kind: "development-status" }
  | { readonly kind: "report-center"; readonly reportIntent: Exclude<AyasReportIntent, null> }
  | { readonly kind: "research-status"; readonly researchIntent: Exclude<AyasResearchStatusIntent, null> }
  | { readonly kind: "guided-repair" }
  | { readonly kind: "live-info"; readonly liveInfo: AyasLiveInfoIntent }
  | { readonly kind: "reasoning" };

/**
 * Resolves only the route-level intents that can otherwise intercept one
 * another before the normal AYAS reasoning/tool pipeline. Specificity wins:
 * AYAS self-development status, then explicit Report Center requests, then
 * external research status (answered as in the askAyas Server Action), then a
 * repair symptom, then a weather or news question (answered from fixed public
 * sources). The normal reasoning path handles everything else.
 */
export function resolveAyasPreReasoningIntent(text: string): AyasPreReasoningIntent {
  if (isAyasDevelopmentStatusQuery(text)) return { kind: "development-status" };
  const reportIntent = detectAyasReportIntent(text);
  if (reportIntent) return { kind: "report-center", reportIntent };
  const researchIntent = detectAyasResearchStatusIntent(text);
  if (researchIntent) return { kind: "research-status", researchIntent };
  if (isAyasGuidedRepairQuery(text)) return { kind: "guided-repair" };
  const liveInfo = detectAyasLiveInfoIntent(text);
  if (liveInfo) return { kind: "live-info", liveInfo };
  return { kind: "reasoning" };
}
