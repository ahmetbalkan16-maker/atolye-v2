/**
 * Documentary media effort — Faz 6: the single, auditable set of flags that
 * govern the real-media + cost-guard behaviour in a production run.
 *
 * Default policy (no env var set):
 *  - **enabled** when a real OpenAI key is present AND `NODE_ENV !== "test"` —
 *    i.e. an actual production render — so real-media discovery, the selection
 *    ladder and the `$1` cost guard are *on* by default for the real pipeline.
 *  - **disabled** otherwise — every e2e / production smoke runs with
 *    `NODE_ENV=test` and no key (see `withCanonicalSmokeRuntime`), so mock
 *    behaviour and zero network calls are preserved, and `5be83a84` stays
 *    reproducible.
 *
 * An explicit env var (`on`/`true`/`1` or `off`/`false`/`0`) always wins. The
 * explicit form is also what enters the acceptance configuration fingerprint
 * (conditional block in `ProductionAcceptanceConfigurationFingerprint`); the
 * logic default does not, so a marker prepared without the env var keeps its
 * fingerprint whether or not the default later resolves to enabled.
 */

import { isRealProductionEnvironment } from "@/lib/runtime/ProductionModeDetection";

function explicit(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "on" || normalized === "true" || normalized === "1") return true;
  if (normalized === "off" || normalized === "false" || normalized === "0") return false;
  return undefined;
}

/**
 * Research-stage discovery of real media candidates from a live source client
 * (Wikimedia Commons). Off -> the research stage produces no `mediaCandidates`
 * and makes no network call.
 */
export function isRealMediaDiscoveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return explicit(env.ATOLYE_REAL_MEDIA_DISCOVERY) ?? isRealProductionEnvironment(env);
}

/**
 * Visuals-stage selection ladder (admissible real video > admissible real photo
 * > AI image) — the deterministic per-scene plan that turns into
 * `VisualAssetPipeline` overrides. Off -> the visuals stage keeps its Faz 1
 * behaviour (real-photo provider when `IMAGE_PROVIDER=real`, else AI, capped at
 * `maxAiImages`).
 */
export function isRealMediaSelectionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return explicit(env.ATOLYE_REAL_MEDIA_SELECTION) ?? isRealProductionEnvironment(env);
}

/**
 * The `$1` per-video AI cost budget guard (pre-dispatch fail-closed + the
 * acceptance pre-run gate + the post-run receipt gate). Mirrors
 * `isAiCostGuardEnabled` in `@/lib/ai/AiCostBudget`, re-exported here so all the
 * Faz 6 activation lives in one module.
 */
export function isCostBudgetGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return explicit(env.ATOLYE_AI_COST_GUARD) ?? isRealProductionEnvironment(env);
}
