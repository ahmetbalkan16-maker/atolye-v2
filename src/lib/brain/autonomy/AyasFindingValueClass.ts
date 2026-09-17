/**
 * M20.1 — deterministic value classification, layered strictly ON TOP of
 * the existing (unmodified) SAFE/REVIEW_REQUIRED/FORBIDDEN_AUTONOMOUS domain
 * classifier (`BrainPatchSafety.classifyPatchSet`) and the MICRO_SAFE/
 * PRIORITY_SAFE/NOT_SAFE authority classifier (`AyasMicroClassifier`).
 *
 * This module is PURELY a categorization/labeling layer — "what kind of
 * value does this finding offer, so a human can see why it matters" — and
 * never an authority gate. Nothing here ever widens or narrows what a
 * candidate is allowed to do; a FORBIDDEN_AUTONOMOUS candidate stays
 * FORBIDDEN_AUTONOMOUS no matter what value class it's labeled. Critically,
 * classification is driven ONLY by structural facts (the target file
 * paths) — never by a generator's own prose (`objective`/`rationale`/etc.),
 * which a proposal could otherwise use to claim false importance.
 */
export type AyasFindingValueClass = "TEST_QUALITY" | "PRODUCT_BEHAVIOR" | "RELIABILITY_RECOVERY" | "OBSERVABILITY" | "PERFORMANCE";

interface ValueRule {
  readonly valueClass: AyasFindingValueClass;
  readonly test: (path: string) => boolean;
}

const norm = (p: string): string => String(p ?? "").replace(/\\/g, "/").replace(/^\.\//, "").trim();

/** Order matters: the FIRST matching rule wins. */
const RULES: readonly ValueRule[] = Object.freeze([
  { valueClass: "TEST_QUALITY", test: (p) => p.startsWith("scripts/smoke-") || p.endsWith(".test.ts") || p.endsWith(".spec.ts") },
  { valueClass: "OBSERVABILITY", test: (p) => p.startsWith("src/lib/brain/probe/") || p.includes("Probe") || p.includes("Telemetry") || p.includes("Diagnostic") },
  {
    valueClass: "RELIABILITY_RECOVERY",
    test: (p) =>
      p.startsWith("src/lib/video/") ||
      p.startsWith("src/lib/assembly/") ||
      p.startsWith("src/lib/animation/") ||
      p.startsWith("src/lib/audio/") ||
      p.startsWith("src/lib/visuals/") ||
      p.includes("Recovery") ||
      p.includes("Retry") ||
      p.includes("Resilience"),
  },
  { valueClass: "PERFORMANCE", test: (p) => p.includes("Performance") || p.includes("Cache") || p.includes("Throughput") },
  {
    valueClass: "PRODUCT_BEHAVIOR",
    test: (p) =>
      p.startsWith("src/lib/ayas/") ||
      p.startsWith("src/components/brain/") ||
      p.startsWith("app/") ||
      p === "src/components/brain/brainCore.ts" ||
      p === "src/lib/brain/ui/brainConversation.ts",
  },
]);

/**
 * Classifies a set of target files by their HIGHEST-signal single value
 * class: if every file is TEST_QUALITY, the finding is TEST_QUALITY; if any
 * file is outside TEST_QUALITY, the finding is classified by that file's
 * class (a finding touching one product file and one test file is about
 * the product, not the test). A path matching no rule defaults to
 * PRODUCT_BEHAVIOR (the least presumptive default — never silently
 * relabeled as something more impressive-sounding like RELIABILITY_RECOVERY).
 */
export function classifyAyasFindingValue(exactFiles: readonly string[]): AyasFindingValueClass {
  const classes = [...new Set(exactFiles.map(norm))].filter(Boolean).map((p) => {
    for (const rule of RULES) if (rule.test(p)) return rule.valueClass;
    return "PRODUCT_BEHAVIOR" as const;
  });
  if (classes.length === 0) return "TEST_QUALITY";
  const nonTestQuality = classes.find((c) => c !== "TEST_QUALITY");
  return nonTestQuality ?? "TEST_QUALITY";
}
