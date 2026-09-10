/**
 * Atölye Brain — Autonomous v2: the auto-apply policy (pure, deterministic).
 *
 * Emir §2 / §12 / §26. v1 always stopped at AWAITING_APPROVAL. v2 may
 * auto-apply — to the working tree, STAGED, never committed / pushed / merged /
 * deployed — ONLY when EVERY one of these holds:
 *
 *   1. the feature is enabled (an operator opt-in; default OFF);
 *   2. every changed file is SAFE (BrainPatchSafety) — a single REVIEW_REQUIRED
 *      or FORBIDDEN target ⇒ AWAIT_APPROVAL / HALT;
 *   3. the review-area guard: voice / STT / TTS / PWA / SW / storage / auth /
 *      Graphify-write / execution are NEVER auto-applied even if a path rule
 *      slipped them into SAFE — an explicit second denylist;
 *   4. root-cause confidence ≥ the configured threshold;
 *   5. every required check + regression + security is PASS (no real failures);
 *   6. diff size / file count within the autonomous caps;
 *   7. this incident's signature has not just failed an auto-apply.
 *
 * The default answer is AWAIT_APPROVAL. Auto-apply is the narrow exception.
 */

import type { BrainIncident } from "./BrainIncident";
import { classifyPatchSet } from "./BrainPatchSafety";
import { BRAIN_SELFHEAL_LIMITS } from "./BrainSelfHealLimits";

export interface BrainAutoApplyConfig {
  /** Operator opt-in. Default false — the Brain stops at AWAITING_APPROVAL. */
  readonly enabled: boolean;
  /** Min root-cause confidence for an autonomous SAFE apply. */
  readonly confidenceThreshold: number;
  /** Max diff lines for an autonomous SAFE apply (≤ the hard limit). */
  readonly maxDiffLines: number;
  readonly maxFilesChanged: number;
}

export const DEFAULT_AUTO_APPLY_CONFIG: BrainAutoApplyConfig = Object.freeze({
  enabled: false,
  confidenceThreshold: 0.8,
  maxDiffLines: 120,
  maxFilesChanged: 4,
});

/**
 * A file that is NEVER auto-applied regardless of its BrainPatchSafety level —
 * even a test/doc change that touches these areas waits for a human, because a
 * mistake here is a user-facing or safety-relevant regression.
 */
const NEVER_AUTO_APPLY = [
  /(^|\/)voice\//,
  /wakeWordVoiceAdapter|useAyasVoice|ayasVoiceEngine|browserVoiceAdapter|openWakeWordRunner/,
  /AyasSttService|app\/api\//,
  /public\/sw\.js|PwaRegister|app\/manifest/,
  /accessGate|Csrf|session|auth\//,
  /GraphifyConsistency|AyasStudioContext|ProjectWriter|ProjectManager/,
  /src\/lib\/(production|pipeline|runtime|storage)\//,
  /src\/lib\/ayas\/execution\//,
  /BrainAutonomyPolicy|BrainSafetyGovernor|BrainRedaction|BrainSecurityPolicy/,
  /src\/lib\/brain\/selfheal\/BrainPatchSafety|BrainSelfHealLimits|BrainUntrustedInput|BrainSelfHealGuards|BrainSelfHealSandbox|BrainSelfHealRunner|BrainAutoApplyPolicy|BrainSelfHealGuards/,
];

export type BrainAutoApplyDecision = "AUTO_APPLY" | "AWAIT_APPROVAL" | "HALT";

export interface BrainAutoApplyVerdict {
  readonly decision: BrainAutoApplyDecision;
  readonly reason: string;
  readonly checklist: readonly { readonly name: string; readonly ok: boolean; readonly detail: string }[];
}

export interface BrainAutoApplyInput {
  readonly incident: BrainIncident;
  readonly config: BrainAutoApplyConfig;
  /** Signatures whose last auto-apply ended in HEAL_FAILED / ROLLED_BACK (no auto-retry). */
  readonly recentlyFailedSignatures?: readonly string[];
  readonly incidentSignature: string;
}

export function decideAutoApply(input: BrainAutoApplyInput): BrainAutoApplyVerdict {
  const { incident, config } = input;
  const patch = incident.patch;
  const checklist: { name: string; ok: boolean; detail: string }[] = [];
  const add = (name: string, ok: boolean, detail: string) => checklist.push({ name, ok, detail });

  if (!patch) {
    return halt("no patch on the incident", checklist);
  }

  const setVerdict = classifyPatchSet(patch.changedFiles);
  const forbidden = setVerdict.forbidden.length > 0;
  add("no FORBIDDEN target", !forbidden, forbidden ? setVerdict.forbidden.map((f) => f.path).join(", ") : "ok");
  if (forbidden) return halt(`patch touches a FORBIDDEN_AUTONOMOUS area: ${setVerdict.forbidden.map((f) => f.path).join(", ")}`, checklist);

  const allSafe = setVerdict.level === "SAFE";
  add("every file SAFE", allSafe, allSafe ? "ok" : `${setVerdict.level} — ${setVerdict.review.map((r) => r.path).join(", ")}`);

  const neverAuto = patch.changedFiles.filter((f) => NEVER_AUTO_APPLY.some((re) => re.test(f.replace(/\\/g, "/"))));
  add("no never-auto-apply area", neverAuto.length === 0, neverAuto.length ? neverAuto.join(", ") : "ok");

  const conf = incident.hypotheses[0]?.confidence ?? 0;
  const confOk = conf >= config.confidenceThreshold;
  add(`confidence ≥ ${config.confidenceThreshold}`, confOk, conf.toFixed(2));

  const realFailures = incident.checks.filter((c) => c.status === "FAIL" && !c.baseline);
  const requiredKinds = new Set(incident.checks.map((c) => c.kind));
  const haveRequired = ["typecheck", "lint", "build", "smoke"].every((k) => requiredKinds.has(k as never));
  const haveRegression = incident.checks.some((c) => c.kind === "regression" && c.status === "PASS");
  const haveSecurity = incident.checks.some((c) => c.kind === "security" && c.status === "PASS");
  add("all checks PASS", realFailures.length === 0, realFailures.length ? realFailures.map((c) => c.name).join(", ") : "ok");
  add("required checks ran", haveRequired, haveRequired ? "ok" : "missing typecheck/lint/build/smoke");
  add("regression PASS", haveRegression, haveRegression ? "ok" : "not green");
  add("security PASS", haveSecurity, haveSecurity ? "ok" : "not green");

  const diffOk = patch.diffLines <= Math.min(config.maxDiffLines, BRAIN_SELFHEAL_LIMITS.maxDiffLines);
  const filesOk = patch.changedFiles.length <= Math.min(config.maxFilesChanged, BRAIN_SELFHEAL_LIMITS.maxFilesChanged);
  add(`diff ≤ ${config.maxDiffLines} lines`, diffOk, `${patch.diffLines}`);
  add(`≤ ${config.maxFilesChanged} files`, filesOk, `${patch.changedFiles.length}`);

  const sigFailed = (input.recentlyFailedSignatures ?? []).includes(input.incidentSignature);
  add("signature not recently failed", !sigFailed, sigFailed ? "an auto-apply of this signature just failed" : "ok");

  const loop = (incident.causedIncidentIds?.length ?? 0) > 0;
  add("not in a self-heal loop", !loop, loop ? `this incident's patch already caused ${incident.causedIncidentIds!.length} more` : "ok");

  const gateOk = config.enabled;
  add("auto-apply enabled", gateOk, gateOk ? "operator opt-in on" : "opt-in OFF (default)");

  const blockers = checklist.filter((c) => !c.ok);
  if (!allSafe || neverAuto.length > 0) {
    return {
      decision: "AWAIT_APPROVAL",
      reason: `not all-SAFE / touches a review area (${blockers.map((b) => b.name).join(", ")}) — a human must approve`,
      checklist,
    };
  }
  if (blockers.length > 0) {
    return {
      decision: "AWAIT_APPROVAL",
      reason: `SAFE but ${blockers.map((b) => `${b.name} (${b.detail})`).join("; ")} — awaiting approval`,
      checklist,
    };
  }
  return { decision: "AUTO_APPLY", reason: "SAFE, high-confidence, all checks + regression + security green, within caps — auto-applying (staged, not pushed)", checklist };
}

function halt(reason: string, checklist: { name: string; ok: boolean; detail: string }[]): BrainAutoApplyVerdict {
  return { decision: "HALT", reason, checklist };
}
