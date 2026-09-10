/**
 * Atölye Brain — Self-Healing: patch-target safety classifier (pure).
 *
 * Emir §8. Every file a candidate patch would touch is classified:
 *
 *   SAFE                 UI, telemetry, tests, diagnostics, logging, perf
 *                        instrumentation, sandbox code, docs — a bad change
 *                        here cannot widen authority or break security.
 *   REVIEW_REQUIRED      voice lifecycle, STT/TTS, Graphify, storage adapters,
 *                        API routes, auth, session, service worker, PWA — a
 *                        patch may be *drafted* but never auto-applied.
 *   FORBIDDEN_AUTONOMOUS the execution gate, authority, secrets, deploy,
 *                        network security, the self-healing safety kernel
 *                        itself — a patch may be drafted for a human, but the
 *                        Brain can never apply it and never auto-approve it.
 *
 * A file that matches no rule defaults to REVIEW_REQUIRED (fail safe).
 */

export type BrainPatchSafetyLevel = "SAFE" | "REVIEW_REQUIRED" | "FORBIDDEN_AUTONOMOUS";

interface Rule {
  readonly level: BrainPatchSafetyLevel;
  readonly test: (path: string) => boolean;
  readonly why: string;
}

const norm = (p: string): string => String(p ?? "").replace(/\\/g, "/").replace(/^\.\//, "").trim();

/** Order matters: the FIRST matching rule wins, and FORBIDDEN rules come first. */
const RULES: readonly Rule[] = Object.freeze([
  // ---- FORBIDDEN_AUTONOMOUS -------------------------------------------------
  {
    level: "FORBIDDEN_AUTONOMOUS",
    why: "the AYAS execution control plane (gate / policy / authorization / bridge)",
    test: (p) => p.startsWith("src/lib/ayas/execution/"),
  },
  {
    level: "FORBIDDEN_AUTONOMOUS",
    why: "an environment / secret file",
    test: (p) => /(^|\/)\.env($|\.)/.test(p) || p.endsWith(".pem") || p.endsWith(".key"),
  },
  {
    level: "FORBIDDEN_AUTONOMOUS",
    why: "deployment / reverse-proxy / network config",
    test: (p) => p.startsWith("deploy/") || /(^|\/)Caddyfile/.test(p) || p.includes("firewall") || p.includes("tailscale"),
  },
  {
    level: "FORBIDDEN_AUTONOMOUS",
    why: "the self-healing safety kernel itself (a self-modifying safety boundary)",
    test: (p) =>
      p === "src/lib/brain/selfheal/BrainPatchSafety.ts" ||
      p === "src/lib/brain/selfheal/BrainSelfHealLimits.ts" ||
      p === "src/lib/brain/selfheal/BrainUntrustedInput.ts" ||
      p === "src/lib/brain/selfheal/BrainSelfHealGuards.ts" ||
      p === "src/lib/brain/selfheal/BrainSelfHealSandbox.ts" ||
      p === "src/lib/brain/selfheal/BrainSelfHealRunner.ts",
  },
  {
    level: "FORBIDDEN_AUTONOMOUS",
    why: "the Brain autonomy / security policy tables",
    test: (p) =>
      p === "src/lib/brain/worker/BrainAutonomyPolicy.ts" ||
      p.startsWith("src/lib/brain/security/") ||
      p === "src/lib/brain/BrainSafetyGovernor.ts" ||
      p === "src/lib/brain/BrainRedaction.ts",
  },
  {
    level: "FORBIDDEN_AUTONOMOUS",
    why: "production execution / durable production state",
    test: (p) => p.startsWith("src/lib/production/") || p.startsWith("src/lib/pipeline/"),
  },
  {
    level: "FORBIDDEN_AUTONOMOUS",
    why: "runtime storage authority resolution",
    test: (p) => p.startsWith("src/lib/runtime/") || p.startsWith("src/lib/storage/"),
  },
  {
    level: "FORBIDDEN_AUTONOMOUS",
    why: "CI / git / package manifests / lockfiles",
    test: (p) =>
      p.startsWith(".github/") ||
      p === "package.json" ||
      p === "package-lock.json" ||
      p === "pnpm-lock.yaml" ||
      p.startsWith(".husky/"),
  },

  // ---- REVIEW_REQUIRED ----------------------------------------------------
  {
    level: "REVIEW_REQUIRED",
    why: "authentication / access-gate / CSRF",
    test: (p) => p.startsWith("src/lib/auth/") || p.includes("accessGate") || p.includes("Csrf") || p.includes("session"),
  },
  {
    level: "REVIEW_REQUIRED",
    why: "an API route (request/response behaviour)",
    test: (p) => /^app\/api\/.+\/route\.ts$/.test(p),
  },
  {
    level: "REVIEW_REQUIRED",
    why: "the service worker / PWA lifecycle",
    test: (p) => p === "public/sw.js" || p.includes("PwaRegister") || p === "app/manifest.ts",
  },
  {
    level: "REVIEW_REQUIRED",
    why: "the voice engine / wake / STT / TTS runtime",
    test: (p) =>
      p.startsWith("src/components/brain/voice/") ||
      p === "src/components/brain/ayasVoice.ts" ||
      p === "src/components/brain/useAyasVoice.ts" ||
      p.startsWith("src/lib/ayas/stt/") ||
      p.startsWith("src/lib/ayas/intake/"),
  },
  {
    level: "REVIEW_REQUIRED",
    why: "Graphify consistency / studio-context reads",
    test: (p) => p.includes("GraphifyConsistency") || p.includes("AyasStudioContext") || p.startsWith("src/lib/projects/"),
  },
  {
    level: "REVIEW_REQUIRED",
    why: "a durable Brain store / worker cycle",
    test: (p) =>
      p.startsWith("src/lib/brain/store/") ||
      p.startsWith("src/lib/brain/worker/") ||
      p.startsWith("src/lib/brain/autonomy/") ||
      p.includes("Store.ts"),
  },
  {
    level: "REVIEW_REQUIRED",
    why: "the chat / model / conversation path",
    test: (p) =>
      p === "src/components/brain/brainCore.ts" ||
      p === "src/lib/brain/ui/brainConversation.ts" ||
      p.startsWith("src/lib/ayas/") ||
      p === "src/components/brain/ayasChatStreamClient.ts",
  },

  // ---- SAFE -------------------------------------------------------------
  { level: "SAFE", why: "a test / smoke script", test: (p) => p.startsWith("scripts/smoke-") || p.endsWith(".test.ts") || p.endsWith(".spec.ts") },
  { level: "SAFE", why: "documentation", test: (p) => p.startsWith("docs/") || p.endsWith(".md") },
  {
    level: "SAFE",
    why: "self-healing observability / view models / non-kernel logic",
    test: (p) =>
      (p.startsWith("src/lib/brain/selfheal/") &&
        !p.endsWith("BrainPatchSafety.ts") &&
        !p.endsWith("BrainSelfHealLimits.ts") &&
        !p.endsWith("BrainUntrustedInput.ts") &&
        !p.endsWith("BrainSelfHealGuards.ts")) ||
      p === "src/lib/brain/ui/brainLifecycle.ts" ||
      p.startsWith("src/lib/brain/probe/") ||
      p === "src/components/brain/useBrainLifecycle.ts",
  },
  {
    level: "SAFE",
    why: "a presentational Brain UI component / stylesheet (no engine logic)",
    test: (p) =>
      (p.startsWith("src/components/brain/") &&
        p.endsWith(".tsx") &&
        !p.includes("/voice/") &&
        p !== "src/components/brain/BrainCoreConsole.tsx" &&
        p !== "src/components/brain/useAyasVoice.ts") ||
      p === "src/components/brain/BrainCore.css",
  },
]);

export interface BrainPatchTargetVerdict {
  readonly path: string;
  readonly level: BrainPatchSafetyLevel;
  readonly why: string;
}

export function classifyPatchTarget(path: string): BrainPatchTargetVerdict {
  const p = norm(path);
  for (const rule of RULES) {
    if (rule.test(p)) return { path: p, level: rule.level, why: rule.why };
  }
  return { path: p, level: "REVIEW_REQUIRED", why: "no rule matched — defaulting to review (fail safe)" };
}

const RANK: Readonly<Record<BrainPatchSafetyLevel, number>> = Object.freeze({
  SAFE: 0,
  REVIEW_REQUIRED: 1,
  FORBIDDEN_AUTONOMOUS: 2,
});

export interface BrainPatchSetVerdict {
  readonly level: BrainPatchSafetyLevel;
  readonly targets: readonly BrainPatchTargetVerdict[];
  readonly forbidden: readonly BrainPatchTargetVerdict[];
  readonly review: readonly BrainPatchTargetVerdict[];
  /** True only when EVERY target is SAFE — the sole case the Brain may auto-apply (still via the operator loop). */
  readonly autoApplicable: boolean;
  readonly summary: string;
}

export function classifyPatchSet(paths: readonly string[]): BrainPatchSetVerdict {
  const targets = [...new Set(paths.map(norm))].filter(Boolean).map(classifyPatchTarget);
  const level = targets.reduce<BrainPatchSafetyLevel>(
    (worst, t) => (RANK[t.level] > RANK[worst] ? t.level : worst),
    "SAFE",
  );
  const forbidden = targets.filter((t) => t.level === "FORBIDDEN_AUTONOMOUS");
  const review = targets.filter((t) => t.level === "REVIEW_REQUIRED");
  const autoApplicable = targets.length > 0 && level === "SAFE";
  const summary =
    forbidden.length > 0
      ? `FORBIDDEN — ${forbidden.length} target(s) in a never-autonomous area: ${forbidden.map((t) => t.path).join(", ")}`
      : review.length > 0
        ? `REVIEW_REQUIRED — ${review.length} sensitive target(s); a patch may be drafted but not auto-applied`
        : autoApplicable
          ? "SAFE — every target is in a low-risk area; eligible for the operator auto-apply loop"
          : "empty patch set";
  return { level, targets, forbidden, review, autoApplicable, summary };
}

/** The risk label surfaced in the incident report. */
export function patchRisk(level: BrainPatchSafetyLevel, diffLines: number, filesChanged: number): "LOW" | "MEDIUM" | "HIGH" {
  if (level === "FORBIDDEN_AUTONOMOUS") return "HIGH";
  if (level === "REVIEW_REQUIRED") return diffLines > 120 || filesChanged > 4 ? "HIGH" : "MEDIUM";
  return diffLines > 200 || filesChanged > 6 ? "MEDIUM" : "LOW";
}
