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

import { AYAS_GOLDEN_VAULT_MODULE_DIR, AYAS_GOLDEN_VAULT_PINNED_FILES } from "../../ayas/golden/AyasGoldenVaultRegistry";

export type BrainPatchSafetyLevel = "SAFE" | "REVIEW_REQUIRED" | "FORBIDDEN_AUTONOMOUS";

interface Rule {
  readonly level: BrainPatchSafetyLevel;
  readonly test: (path: string) => boolean;
  readonly why: string;
}

const norm = (p: string): string => String(p ?? "").replace(/\\/g, "/").replace(/^\.\//, "").trim();

/**
 * The yardstick an improvement is measured with (Stage 15O): the golden vault, every grader and fixture any of its
 * versions pins, its operator script and suites, and the eval manifest with its validator and runner. Compared without
 * case, so another spelling of the same file on a case-insensitive disk is the same file.
 */
const YARDSTICK_FILES: ReadonlySet<string> = new Set([
  ...AYAS_GOLDEN_VAULT_PINNED_FILES,
  "scripts/ayas-golden-vault.ts",
  "scripts/lib/AyasGoldenVaultFiles.ts",
  "scripts/smoke-ayas-golden-vault.ts",
  "scripts/smoke-ayas-golden-vault-mutations.ts",
  "scripts/smoke-ayas-golden-vault-operator.ts",
  "scripts/smoke-ayas-golden-vault-run.ts",
  "scripts/fixtures/ayas-golden-fixtures.ts",
  "scripts/smoke-ayas-golden-experiment-gate.ts",
  "scripts/smoke-ayas-golden-experiment-gate-mutations.ts",
  "scripts/smoke-ayas-golden-sandbox-run.ts",
  "scripts/smoke-ayas-golden-video-projects-mutations.ts",
  "scripts/ayas-source-evidence.ts",
  "scripts/smoke-ayas-source-evidence.ts",
  "scripts/smoke-ayas-source-evidence-mutations.ts",
  "scripts/smoke-ayas-resource-governor.ts",
  "scripts/smoke-ayas-resource-governor-mutations.ts",
  "scripts/smoke-ayas-on-demand-lifecycle.ts",
  "scripts/smoke-ayas-on-demand-lifecycle-mutations.ts",
  "scripts/ayas-resource-status.ts",
  "scripts/smoke-ayas-resource-occupancy.ts",
  "scripts/smoke-ayas-resource-occupancy-mutations.ts",
  "scripts/ayas-safe-mode.ts",
  "scripts/smoke-ayas-safe-mode.ts",
  "scripts/smoke-ayas-safe-mode-mutations.ts",
  "scripts/ayas-executive-alerts.ts",
  "scripts/smoke-ayas-executive-briefing.ts",
  "scripts/smoke-ayas-executive-briefing-mutations.ts",
  "scripts/smoke-ayas-revenue-adapter-standard.ts",
  "scripts/smoke-ayas-revenue-adapter-standard-mutations.ts",
  "scripts/fixtures/ayas-revenue-fake-adapter.ts",
  "scripts/smoke-ayas-revenue-account-boundary.ts",
  "scripts/smoke-ayas-revenue-account-boundary-mutations.ts",
  "scripts/smoke-ayas-revenue-spend-policy.ts",
  "scripts/smoke-ayas-revenue-spend-policy-mutations.ts",
  "scripts/smoke-ayas-revenue-ledger.ts",
  "scripts/smoke-ayas-revenue-ledger-mutations.ts",
  "scripts/fixtures/ayas-revenue-ledger-fixture.ts",
  "scripts/fixtures/ayas-revenue-ledger-worker.ts",
  "scripts/smoke-ayas-revenue-free-first-validation.ts",
  "scripts/smoke-ayas-revenue-free-first-validation-mutations.ts",
  "scripts/fixtures/ayas-revenue-free-first-fixture.ts",
  "scripts/smoke-ayas-revenue-offer-factory.ts",
  "scripts/smoke-ayas-revenue-offer-factory-mutations.ts",
  "scripts/fixtures/ayas-revenue-offer-fixture.ts",
  "scripts/smoke-ayas-revenue-fulfillment-gate.ts",
  "scripts/smoke-ayas-revenue-fulfillment-gate-mutations.ts",
  "scripts/fixtures/ayas-revenue-fulfillment-fixture.ts",
  "scripts/smoke-ayas-revenue-etsy-adapter.ts",
  "scripts/smoke-ayas-revenue-etsy-adapter-mutations.ts",
  "scripts/fixtures/ayas-revenue-etsy-fixture.ts",
  "scripts/smoke-ayas-revenue-upwork-adapter.ts",
  "scripts/smoke-ayas-revenue-upwork-adapter-mutations.ts",
  "scripts/fixtures/ayas-revenue-upwork-fixture.ts",
  "scripts/smoke-ayas-revenue-fiverr-adapter.ts",
  "scripts/smoke-ayas-revenue-fiverr-adapter-mutations.ts",
  "scripts/fixtures/ayas-revenue-fiverr-fixture.ts",
  "scripts/smoke-ayas-revenue-udemy-adapter.ts",
  "scripts/smoke-ayas-course-production-plan.ts",
  "scripts/smoke-ayas-revenue-udemy-course-mutations.ts",
  "scripts/fixtures/ayas-udemy-fixture.ts",
  "scripts/fixtures/ayas-course-fixture.ts",
  "scripts/ayas-portable-brain.ts",
  "scripts/smoke-ayas-portable-brain.ts",
  "scripts/smoke-ayas-portable-brain-mutations.ts",
  "scripts/ayas-eval-baseline.ts",
  "src/lib/ayas/observability/AyasEvalGovernance.ts",
  "docs/ayas-execution/2026-09-27-master/03_STAGE15_BASE/hardening/15F/EVAL_MANIFEST.json",
].map((file) => file.toLowerCase()));

/** Order matters: the FIRST matching rule wins, and FORBIDDEN rules come first. */
const RULES: readonly Rule[] = Object.freeze([
  // ---- FORBIDDEN_AUTONOMOUS -------------------------------------------------
  {
    level: "FORBIDDEN_AUTONOMOUS",
    why: "the revenue platform standard (operation effects, owner-required writes, non-autonomous money) cannot rewrite itself",
    test: (p) => p.toLowerCase().startsWith("src/lib/ayas/revenue/") || p.toLowerCase() === "docs/ayas_revenue_adapter_standard.md" || p.toLowerCase() === "docs/ayas_revenue_spend_policy.md" || p.toLowerCase() === "docs/ayas_revenue_unit_economics.md" || p.toLowerCase() === "docs/ayas_revenue_free_first_validation.md" || p.toLowerCase() === "docs/ayas_revenue_offer_factory.md" || p.toLowerCase() === "docs/ayas_revenue_fulfillment_gate.md" || p.toLowerCase() === "docs/ayas_revenue_etsy_adapter.md" || p.toLowerCase() === "docs/ayas_revenue_upwork_adapter.md" || p.toLowerCase() === "docs/ayas_revenue_fiverr_adapter.md" || p.toLowerCase() === "docs/ayas_revenue_udemy_atolye.md",
  },
  {
    level: "FORBIDDEN_AUTONOMOUS",
    why: "owner notification priority, durable acknowledgement and delivery cannot rewrite themselves",
    test: (p) => p.toLowerCase() === "src/components/brain/ayasexecutivebriefingpanel.tsx" || ["src/lib/ayas/briefing/", "app/brain/briefing/", "data/brain/execution/owner-alerts"].some(prefix => p.toLowerCase().startsWith(prefix)),
  },
  {
    level: "FORBIDDEN_AUTONOMOUS",
    why: "portable private state and migration qualification cannot export or activate themselves",
    test: (p) => p.toLowerCase().startsWith("src/lib/ayas/migration/"),
  },
  {
    level: "FORBIDDEN_AUTONOMOUS",
    why: "the contextual source-trust policy and evidence boundary cannot review or rewrite itself",
    test: (p) => p.toLowerCase().startsWith("src/lib/ayas/trust/"),
  },
  {
    level: "FORBIDDEN_AUTONOMOUS",
    why: "the owner constitution: its modules and its activation page (only the owner changes the root of trust)",
    test: (p) => p.toLowerCase().startsWith("src/lib/ayas/governance/") || p.toLowerCase().startsWith("app/brain/constitution/"),
  },
  {
    level: "FORBIDDEN_AUTONOMOUS",
    why: "the global SAFE_READ_ONLY mode: its modules, its owner page and its event log (only the owner leaves the mode)",
    test: (p) => ["src/lib/ayas/safety/", "app/brain/safe-mode/", "data/brain/execution/safe-mode"].some((prefix) => p.toLowerCase().startsWith(prefix)),
  },
  {
    level: "FORBIDDEN_AUTONOMOUS",
    why: "the golden regression vault or the eval yardstick (a change may not rewrite what it is measured with)",
    test: (p) => p.toLowerCase().startsWith(AYAS_GOLDEN_VAULT_MODULE_DIR.toLowerCase()) || YARDSTICK_FILES.has(p.toLowerCase()),
  },
  {
    level: "FORBIDDEN_AUTONOMOUS",
    why: "AYAS zero-cost policy or machine-health protection boundary",
    test: (p) => p.toLowerCase().startsWith("src/lib/ayas/policy/") || p.toLowerCase().startsWith("src/lib/ayas/machine/"),
  },
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
      p === "src/lib/brain/selfheal/BrainSelfHealRunner.ts" ||
      p === "src/lib/brain/selfheal/AyasExactPatchSafety.ts" ||
      p === "src/lib/brain/autonomy/AyasExactProposalSafety.ts",
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
