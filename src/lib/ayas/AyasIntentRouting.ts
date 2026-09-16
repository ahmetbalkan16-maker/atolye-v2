import { detectAyasReportIntent, type AyasReportIntent } from "@/lib/brain/selfheal/BrainReportCenter";
import { isAyasDevelopmentStatusQuery } from "./model/AyasComplexityRouter";

const GUIDED_REPAIR_TOKENS = new Set([
  "hata",
  "bug",
  "exception",
  "çalışmıyor",
  "çöktü",
  "düzelt",
]);

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
  return tokens.some((token) => GUIDED_REPAIR_TOKENS.has(token));
}

export type AyasPreReasoningIntent =
  | { readonly kind: "development-status" }
  | { readonly kind: "report-center"; readonly reportIntent: Exclude<AyasReportIntent, null> }
  | { readonly kind: "guided-repair" }
  | { readonly kind: "reasoning" };

/**
 * Resolves only the route-level intents that can otherwise intercept one
 * another before the normal AYAS reasoning/tool pipeline. Specificity wins:
 * AYAS self-development status, then explicit Report Center requests, then a
 * repair symptom. The normal reasoning path handles everything else.
 */
export function resolveAyasPreReasoningIntent(text: string): AyasPreReasoningIntent {
  if (isAyasDevelopmentStatusQuery(text)) return { kind: "development-status" };
  const reportIntent = detectAyasReportIntent(text);
  if (reportIntent) return { kind: "report-center", reportIntent };
  if (isAyasGuidedRepairQuery(text)) return { kind: "guided-repair" };
  return { kind: "reasoning" };
}
