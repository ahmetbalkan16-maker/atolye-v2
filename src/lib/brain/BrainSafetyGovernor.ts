/**
 * Atölye Brain — Safety Governor (sections 4 + 9 + 15 of the emir).
 *
 * A **pure** policy evaluator. It takes:
 *   1. a hardware profile (the machine), and
 *   2. a resource snapshot (the moment — GPU temp / load / power / VRAM /
 *      active inference / CPU / RAM / Ollama reachability / abnormal signals),
 * and returns a go / hold / abort verdict plus the strategy constraints the
 * rest of the Brain must respect.
 *
 * It never tunes anything. It never shells a process. The read-only host probe
 * that fills `BrainResourceSnapshot` is a separate, later, approved phase; this
 * module only decides what to do with a snapshot once it exists.
 *
 * Conservatism rules (carried verbatim from the running project's checkpoint
 * practice — this module must never loosen them):
 *  - Act **before** the thermal ceiling, never "wait for 80 °C".
 *  - `thermal-slowdown` / `driver-reset` / `tdr` / `bsod` / `fatal-whea` /
 *    `display-loss` / `gpu-fallen-off-bus` → immediate **abort**.
 *  - An **unavailable** snapshot is not "all clear" — it yields
 *    proceed-with-constraints with the full conservative bundle.
 *  - `qwen2.5:7b` and any large model are forbidden on a ≤ 5 GB-VRAM card
 *    (checkpoint: 7B is not viable on the GTX 1650 4 GB).
 */

import {
  brainSchemaVersion,
  type BrainAbnormalSignal,
  type BrainHardwareProfile,
  type BrainResourceSnapshot,
  type BrainSafetyDecision,
  type BrainSafetyVerdict,
  type BrainStrategyConstraint,
} from "@/types/brain";

/* ------------------------------------------------------------------------- *
 * Known machines
 * ------------------------------------------------------------------------- */

/**
 * The two machines the director alternates between (`AGENTS.md` — "iki farklı
 * bilgisayarda dönüşümlü çalışıyor"). `thermalCeilingC` is a *conservative
 * operating ceiling*, deliberately below any observed throttle point, not a
 * "safe until" value.
 */
export const DEFAULT_BRAIN_HARDWARE_PROFILES: Readonly<
  Record<string, BrainHardwareProfile>
> = Object.freeze({
  "gtx-1650-4gb": Object.freeze({
    id: "gtx-1650-4gb",
    label: "GTX 1650 4 GB workstation",
    gpuModel: "NVIDIA GeForce GTX 1650",
    vramGb: 4,
    gpuPowerLimitW: 50,
    // Checkpoint Sprint 176: sustained inference throttles this card at ~82 °C.
    // Hold/abort well below that.
    thermalCeilingC: 80,
    cpuThreads: 12,
    ramGb: 32,
    ollama: Object.freeze({
      reachableExpected: true,
      viableModels: Object.freeze(["qwen2.5:3b"]),
      nonViableModels: Object.freeze(["qwen2.5:7b", "qwen2.5:7b-instruct-q4_K_M"]),
    }),
    tools: Object.freeze({ ffmpeg: true, ffprobe: true, piper: true }),
    notes: Object.freeze([
      "7B does not fit 4 GB VRAM — 55/45 CPU/GPU split, request dropped ~305 s.",
      "qwen2.5:3b at OLLAMA_NUM_CTX=8192 uses ~2.3 GB — the safe local model.",
      "Batch renders need a cooldown pause between videos.",
    ]),
  }),
  "rtx-a2000-12gb": Object.freeze({
    id: "rtx-a2000-12gb",
    label: "RTX A2000 12 GB workstation",
    gpuModel: "NVIDIA RTX A2000 12GB",
    vramGb: 12,
    gpuPowerLimitW: 70,
    thermalCeilingC: 80,
    cpuThreads: 12,
    ramGb: 32,
    ollama: Object.freeze({
      reachableExpected: true,
      viableModels: Object.freeze(["qwen2.5:3b", "qwen2.5:7b"]),
      nonViableModels: Object.freeze([]),
    }),
    tools: Object.freeze({ ffmpeg: true, ffprobe: true, piper: true }),
    notes: Object.freeze([
      "12 GB VRAM fits a 7B model, but the ~70 W power cap still limits sustained token rate.",
      "Same conservative thermal ceiling — do not raise it without hardware testing (needs user approval).",
    ]),
  }),
});

export class BrainHardwareProfileError extends Error {
  readonly code = "BRAIN_HARDWARE_PROFILE_UNKNOWN";
  constructor(readonly requested: string) {
    super(
      `Unknown Brain hardware profile "${requested}". ` +
        `Known: ${Object.keys(DEFAULT_BRAIN_HARDWARE_PROFILES).join(", ")}.`,
    );
    this.name = "BrainHardwareProfileError";
    this.stack = undefined;
  }
}

/** Fail-closed profile lookup — an unknown id throws rather than defaulting. */
export function resolveBrainHardwareProfile(
  id: string,
  profiles: Readonly<
    Record<string, BrainHardwareProfile>
  > = DEFAULT_BRAIN_HARDWARE_PROFILES,
): BrainHardwareProfile {
  const profile = profiles[id];
  if (!profile) throw new BrainHardwareProfileError(id);
  return profile;
}

/* ------------------------------------------------------------------------- *
 * Thresholds
 * ------------------------------------------------------------------------- */

/** Signals that stop a production the instant they are seen. */
export const BRAIN_ABORT_SIGNALS: readonly BrainAbnormalSignal[] = Object.freeze([
  "thermal-slowdown",
  "driver-reset",
  "tdr",
  "bsod",
  "fatal-whea",
  "display-loss",
  "gpu-fallen-off-bus",
]);

/** Signals that are recoverable — hold and let the operator fix them. */
export const BRAIN_HOLD_SIGNALS: readonly BrainAbnormalSignal[] = Object.freeze([
  "ollama-unreachable",
  "out-of-memory",
]);

export interface BrainThermalThresholds {
  readonly warnC: number;
  readonly holdC: number;
  readonly abortC: number;
}

/** Derived from the profile ceiling — warn early, hold close, abort at the ceiling. */
export function brainThermalThresholds(
  profile: BrainHardwareProfile,
): BrainThermalThresholds {
  const abortC = profile.thermalCeilingC;
  return Object.freeze({
    warnC: abortC - 12,
    holdC: abortC - 4,
    abortC,
  });
}

const CONSERVATIVE_BUNDLE: readonly BrainStrategyConstraint[] = Object.freeze([
  "serialize-stages",
  "cooldown-between-stages",
  "single-inference-at-a-time",
  "assume-shared-gpu",
]);

const VRAM_HEADROOM_GB = 0.7;

/* ------------------------------------------------------------------------- *
 * The evaluator
 * ------------------------------------------------------------------------- */

function rank(decision: BrainSafetyDecision): number {
  return { proceed: 0, "proceed-with-constraints": 1, hold: 2, abort: 3 }[decision];
}

function worse(
  a: BrainSafetyDecision,
  b: BrainSafetyDecision,
): BrainSafetyDecision {
  return rank(a) >= rank(b) ? a : b;
}

/**
 * The core policy. Pure and deterministic: same profile + snapshot + planned
 * constraints always yield the same verdict.
 */
export function evaluateBrainSafety(
  profile: BrainHardwareProfile,
  snapshot: BrainResourceSnapshot,
  plannedConstraints: readonly BrainStrategyConstraint[] = [],
): BrainSafetyVerdict {
  const thresholds = brainThermalThresholds(profile);
  const reasons: string[] = [];
  const constraints = new Set<BrainStrategyConstraint>(plannedConstraints);
  let decision: BrainSafetyDecision = "proceed";

  const signals = snapshot.abnormalSignals ?? [];
  const abortSignals = signals.filter((signal) => BRAIN_ABORT_SIGNALS.includes(signal));
  const holdSignals = signals.filter((signal) => BRAIN_HOLD_SIGNALS.includes(signal));

  if (abortSignals.length > 0) {
    return {
      schemaVersion: brainSchemaVersion,
      observedAt: snapshot.observedAt,
      decision: "abort",
      constraints: [...constraints].sort(),
      reasons: [`abnormal hardware signal(s): ${abortSignals.join(", ")} — stop immediately`],
      snapshotSource: snapshot.source,
      triggeredSignals: abortSignals,
    };
  }

  // A ≤ 5 GB card can never run a 7B model regardless of the live snapshot.
  if (profile.vramGb <= 5) {
    constraints.add("forbid-large-model");
    reasons.push(`${profile.vramGb} GB VRAM — large models (7B+) forbidden on this machine`);
  }

  if (holdSignals.length > 0) {
    decision = worse(decision, "hold");
    reasons.push(`recoverable hardware signal(s): ${holdSignals.join(", ")} — hold until cleared`);
  }

  if (snapshot.source === "unavailable") {
    decision = worse(decision, "proceed-with-constraints");
    for (const item of CONSERVATIVE_BUNDLE) constraints.add(item);
    constraints.add("small-work-units");
    reasons.push(
      "resource snapshot unavailable — assuming a shared, thermally-constrained GPU (conservative bundle)",
    );
  } else if (snapshot.source === "assumed") {
    decision = worse(decision, "proceed-with-constraints");
    constraints.add("serialize-stages");
    constraints.add("cooldown-between-stages");
    reasons.push("resource snapshot is an assumption, not a measurement — serialising with cooldowns");
  }

  // Thermal
  if (typeof snapshot.gpuTempC === "number") {
    if (snapshot.gpuTempC >= thresholds.abortC) {
      decision = worse(decision, "abort");
      reasons.push(
        `GPU ${snapshot.gpuTempC} °C ≥ abort ceiling ${thresholds.abortC} °C`,
      );
    } else if (snapshot.gpuTempC >= thresholds.holdC) {
      decision = worse(decision, "hold");
      constraints.add("cooldown-between-stages");
      reasons.push(
        `GPU ${snapshot.gpuTempC} °C ≥ hold threshold ${thresholds.holdC} °C — cool down before the next GPU stage`,
      );
    } else if (snapshot.gpuTempC >= thresholds.warnC) {
      decision = worse(decision, "proceed-with-constraints");
      constraints.add("cooldown-between-stages");
      constraints.add("serialize-stages");
      reasons.push(
        `GPU ${snapshot.gpuTempC} °C ≥ warn threshold ${thresholds.warnC} °C — serialise + cooldown`,
      );
    }
  }

  // VRAM
  if (
    typeof snapshot.vramUsedGb === "number" &&
    typeof snapshot.vramTotalGb === "number"
  ) {
    const free = snapshot.vramTotalGb - snapshot.vramUsedGb;
    if (free <= VRAM_HEADROOM_GB) {
      decision = worse(decision, "proceed-with-constraints");
      constraints.add("forbid-large-model");
      constraints.add("reduce-context-window");
      reasons.push(
        `only ${free.toFixed(1)} GB VRAM free — forbid large model, reduce context window`,
      );
    }
  }

  // Another inference already running
  if (snapshot.activeInference === true) {
    decision = worse(decision, "proceed-with-constraints");
    constraints.add("single-inference-at-a-time");
    constraints.add("serialize-stages");
    reasons.push("another inference is active — one inference at a time, serialise stages");
  }

  // CPU / RAM pressure
  if (typeof snapshot.cpuLoadPct === "number" && snapshot.cpuLoadPct >= 90) {
    decision = worse(decision, "proceed-with-constraints");
    constraints.add("serialize-stages");
    constraints.add("cooldown-between-stages");
    reasons.push(`CPU load ${snapshot.cpuLoadPct}% — serialise CPU-bound stages (FFmpeg / Piper)`);
  }
  if (
    typeof snapshot.ramUsedGb === "number" &&
    typeof snapshot.ramTotalGb === "number" &&
    snapshot.ramTotalGb - snapshot.ramUsedGb <= 1.5
  ) {
    decision = worse(decision, "hold");
    reasons.push(
      `only ${(snapshot.ramTotalGb - snapshot.ramUsedGb).toFixed(1)} GB RAM free — hold to avoid swapping`,
    );
  }

  // Ollama expected but unreachable
  if (
    profile.ollama.reachableExpected &&
    snapshot.ollamaReachable === false &&
    !holdSignals.includes("ollama-unreachable")
  ) {
    decision = worse(decision, "hold");
    reasons.push("Ollama expected on this machine but not reachable — hold");
  }

  if (decision === "proceed" && reasons.length === 0) {
    reasons.push("all observed metrics within safe range");
  }

  return {
    schemaVersion: brainSchemaVersion,
    observedAt: snapshot.observedAt,
    decision,
    constraints: [...constraints].sort(),
    reasons,
    snapshotSource: snapshot.source,
    triggeredSignals: [...abortSignals, ...holdSignals],
  };
}

/** Human-readable one-liner + bullet reasons. */
export function describeBrainSafetyVerdict(verdict: BrainSafetyVerdict): string {
  const head =
    verdict.decision === "proceed"
      ? "SAFE — proceed"
      : verdict.decision === "proceed-with-constraints"
        ? "PROCEED WITH CONSTRAINTS"
        : verdict.decision === "hold"
          ? "HOLD — do not start / pause production"
          : "ABORT — stop production now";
  const lines = [
    `${head} (snapshot: ${verdict.snapshotSource})`,
    ...verdict.reasons.map((reason) => `  - ${reason}`),
  ];
  if (verdict.constraints.length) {
    lines.push(`  constraints: ${verdict.constraints.join(", ")}`);
  }
  return lines.join("\n");
}
