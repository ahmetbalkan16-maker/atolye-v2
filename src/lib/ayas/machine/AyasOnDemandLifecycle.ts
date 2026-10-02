import crypto from "node:crypto";
import path from "node:path";
import { withAyasExecutionAuthorityLock } from "../../brain/autonomy/AyasExecutionAuthorityLock";
import type { AyasDurableTaskJournal } from "../../brain/autonomy/AyasDurableTaskJournal";
import type { AyasDurableTaskState } from "../../brain/autonomy/AyasDurableTask";
import { parseAyasLocalCodingTaskContract, type AyasLocalCodingTaskContract } from "../../brain/autonomy/AyasLocalCodingTaskContract";
import { parseAyasLocalCodingModelManifest, parseAyasLocalCodingRuntimeIdentity, ayasLocalCodingCandidatePins } from "../../brain/autonomy/AyasLocalCodingPins";
import { withAyasResourceCapacity, type AyasResourceCapacityDeps } from "./AyasResourceCapacity";
import { evaluateAyasResourceAdmission, type AyasResourceDecision, type AyasResourceRequest } from "./AyasResourceGovernor";

export const AYAS_ON_DEMAND_STATES = ["STOPPED", "STARTING", "READY", "BUSY", "DRAINING", "STOPPING", "ERROR"] as const;
export type AyasOnDemandState = typeof AYAS_ON_DEMAND_STATES[number];
export type AyasRuntimeAction = "START_MACHINE" | "LOAD_PINNED_MODEL" | "STOP_LLAMA_SERVER" | "REMOVE_TASK_CONTAINERS" | "RELEASE_MODEL_MEMORY" | "STOP_MACHINE";
export type AyasWorkOutcome = "TASK_FINISHED" | "TASK_DEFERRED" | "MODEL_FAILURE" | "RESOURCE_ABORT" | "OWNER_CANCELLED";
/** Host registry descriptor and required capability adapters; never derived from task/model text. No default CLI. */
export interface AyasOnDemandProfile {
  readonly machineName: string; readonly runtimeId: string; readonly modelManifest: unknown; readonly runtimeIdentity: unknown;
  readonly peakMemoryMb: number; readonly requiresGpu: boolean; readonly timeoutMs: number;
}
export interface AyasOnDemandSnapshot {
  readonly machineName: string; readonly runtimeId: string;
  readonly observedAtMs: number; readonly machineState: "RUNNING" | "STOPPED" | "UNKNOWN";
  readonly serverState: "RUNNING" | "STOPPED" | "UNKNOWN"; readonly modelMemoryReleased: boolean | null;
  readonly serverOwnerTaskId: string | null; readonly modelDigest: string | null; readonly taskContainerOwnerTaskId: string | null;
  /** Complete runtime-dependent task inventory. Missing/unreadable journal entries are unknown, never inactive. */
  readonly dependentTaskIds: readonly string[] | null; readonly taskContainerIds: readonly string[] | null;
  readonly foreignContainers: boolean | null; readonly demandPending: boolean | null; readonly lastDemandAtMs: number | null;
}
export interface AyasOnDemandReceipt {
  readonly taskId: string; readonly sequence: number; readonly taskDigest: string; readonly outcome: AyasWorkOutcome;
  readonly evidenceDigest: string; readonly checkpointDigest: string;
}
export interface AyasOnDemandPorts extends AyasResourceCapacityDeps {
  readonly journal: Pick<AyasDurableTaskJournal, "load">;
  readonly nowMs: () => number;
  readonly readRuntime: (profile: Readonly<AyasOnDemandProfile>) => Promise<AyasOnDemandSnapshot>;
  /** Must bind the real current owner/capability gate, engine/image pins and exact owned machine. TRUE is no resource grant. */
  readonly authorize: (action: AyasRuntimeAction | "RUN_TASK", profile: Readonly<AyasOnDemandProfile>, taskId: string | null) => Promise<boolean>;
  /** Read the existing durable lifecycle evidence. MISSING means verified absence; IO failure is UNAVAILABLE. */
  readonly readPhase: (taskId: string) => Promise<AyasOnDemandState | "MISSING" | "UNAVAILABLE">;
  readonly recordPhase: (phase: AyasOnDemandState, taskId: string | null) => Promise<void>;
  /** Closed action set, exact registered runtime and exact task containers; no shell/WSL/global prune surface. */
  readonly perform: (action: AyasRuntimeAction, profile: Readonly<AyasOnDemandProfile>, taskId: string | null, containerIds: readonly string[], signal: AbortSignal) => Promise<"CONFIRMED" | "UNKNOWN">;
  /** Persist journal before returning; deferred work may stay pending only after confirmed stop with no runtime dependency. */
  readonly runTask: (input: { readonly task: AyasLocalCodingTaskContract; readonly durableTaskId: string; readonly signal: AbortSignal; readonly boundary: () => Promise<AyasResourceDecision> }) => Promise<AyasWorkOutcome>;
  readonly persistEvidenceAndCheckpoint: (input: Omit<AyasOnDemandReceipt, "evidenceDigest" | "checkpointDigest">) => Promise<AyasOnDemandReceipt>;
  readonly readReceipt: (taskId: string) => Promise<AyasOnDemandReceipt | null>;
}
export interface AyasOnDemandResult {
  readonly state: AyasOnDemandState; readonly reason: string; readonly authority: "NONE";
  readonly workloadOutcome?: AyasWorkOutcome; readonly modelQualityFailure: boolean; readonly preserveTask: true;
  readonly phases: readonly AyasOnDemandState[]; readonly evidenceClass: "CONTROLLER_CONTRACT_NOT_HARDWARE_QUALIFICATION";
}
const HEX = /^[a-f0-9]{64}$/, TASK = /^ayas-task-[a-f0-9]{32}$/, ID = /^[a-z][a-z0-9-]{2,63}$/;
const digest = (v: unknown) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
async function boundedRuntimeCall<T>(timeoutMs: number, call: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([Promise.resolve().then(() => call(controller.signal)), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error("RUNTIME_CALL_UNCONFIRMED")); }, Math.min(timeoutMs, 30_000)); })]); }
  finally { if (timer) clearTimeout(timer); controller.abort(); }
}
function profileSnapshot(value: AyasOnDemandProfile): Readonly<AyasOnDemandProfile> {
  if (!value || Object.keys(value).sort().join("|") !== "machineName|modelManifest|peakMemoryMb|requiresGpu|runtimeId|runtimeIdentity|timeoutMs" || !ID.test(value.machineName) || !ID.test(value.runtimeId) || !Number.isFinite(value.peakMemoryMb) || value.peakMemoryMb <= 0 || value.peakMemoryMb > 1_000_000
    || typeof value.requiresGpu !== "boolean" || !Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 1 || value.timeoutMs > 1_800_000) throw Error("RUNTIME_PROFILE_INVALID");
  return Object.freeze({ ...value, modelManifest: parseAyasLocalCodingModelManifest(value.modelManifest), runtimeIdentity: parseAyasLocalCodingRuntimeIdentity(value.runtimeIdentity) });
}
function validSnapshot(s: AyasOnDemandSnapshot, now: number): boolean {
  const denseIds = (v: readonly string[] | null, re: RegExp): boolean => v === null || Array.isArray(v) && v.length <= 1_000 && Array.from(v).every(x => typeof x === "string" && re.test(x)) && new Set(v).size === v.length;
  return !!s && Number.isFinite(now) && Number.isFinite(s.observedAtMs) && now >= s.observedAtMs && now - s.observedAtMs <= 30_000
    && ID.test(s.machineName) && ID.test(s.runtimeId) && (s.serverOwnerTaskId === null || TASK.test(s.serverOwnerTaskId))
    && (s.modelDigest === null || HEX.test(s.modelDigest)) && (s.taskContainerOwnerTaskId === null || TASK.test(s.taskContainerOwnerTaskId))
    && ["RUNNING", "STOPPED", "UNKNOWN"].includes(s.machineState) && ["RUNNING", "STOPPED", "UNKNOWN"].includes(s.serverState)
    && [s.modelMemoryReleased, s.foreignContainers, s.demandPending].every(v => v === null || typeof v === "boolean")
    && (s.lastDemandAtMs === null || Number.isFinite(s.lastDemandAtMs) && s.lastDemandAtMs >= 0 && s.lastDemandAtMs <= now)
    && denseIds(s.dependentTaskIds, TASK) && denseIds(s.taskContainerIds, HEX);
}
function dependenciesSettled(s: AyasOnDemandSnapshot, ports: AyasOnDemandPorts, startingTask?: string): boolean {
  return s.dependentTaskIds !== null && s.dependentTaskIds.every(id => {
    const t = ports.journal.load(id);
    return !!t && (id === startingTask && t.status === "ACTIVE" || ["COMPLETED", "FAILED", "REJECTED", "CANCELLED"].includes(t.status));
  });
}
function taskSafeForUnload(task: AyasDurableTaskState, outcome: AyasWorkOutcome): boolean {
  return ["COMPLETED", "FAILED", "REJECTED", "CANCELLED"].includes(task.status) || task.status === "ACTIVE" && outcome === "TASK_DEFERRED"
    && !task.stepStates.some(s => ["RUNNING", "NEEDS_REREAD", "UNCERTAIN"].includes(s.status));
}
function result(phases: readonly AyasOnDemandState[], state: AyasOnDemandState, reason: string, outcome?: AyasWorkOutcome): AyasOnDemandResult {
  return Object.freeze({ state, reason, authority: "NONE", workloadOutcome: outcome, modelQualityFailure: outcome === "MODEL_FAILURE", preserveTask: true, phases: Object.freeze([...phases]), evidenceClass: "CONTROLLER_CONTRACT_NOT_HARDWARE_QUALIFICATION" });
}

/** Explicit lazy task demand only. No import-time activation, startup hook, daemon or registered production backend. */
export async function runAyasOnDemandTaskWith(input: { readonly trigger: "EXPLICIT_TASK_DEMAND"; readonly task: AyasLocalCodingTaskContract; readonly durableTaskId: string; readonly profile: AyasOnDemandProfile }, ports: AyasOnDemandPorts): Promise<AyasOnDemandResult> {
  const phases: AyasOnDemandState[] = [];
  let outcome: AyasWorkOutcome | undefined;
  const phase = async (s: AyasOnDemandState) => { await boundedRuntimeCall(30_000, () => ports.recordPhase(s, input.durableTaskId)); phases.push(s); };
  try {
    if (input.trigger !== "EXPLICIT_TASK_DEMAND" || !TASK.test(input.durableTaskId)) return result(phases, "STOPPED", "EXPLICIT_DURABLE_DEMAND_REQUIRED");
    const task = parseAyasLocalCodingTaskContract(input.task), profile = profileSnapshot(input.profile), taskId = input.durableTaskId;
    const priorPhase = await boundedRuntimeCall(profile.timeoutMs, () => ports.readPhase(taskId));
    if (!["MISSING", "STOPPED"].includes(priorPhase)) return result(phases, "ERROR", "PRIOR_LIFECYCLE_REQUIRES_CURRENT_STATE_REREAD");
    const initial = ports.journal.load(taskId);
    // Persisted exact task mapping, not an arbitrary runtime-task exemption supplied by the model.
    if (!initial || initial.status !== "ACTIVE" || initial.domain !== "SELF_DEVELOPMENT" || !initial.steps.some(s => s.kind === "ACTIVITY" && !!s.input && typeof s.input === "object" && !Array.isArray(s.input) && "codingContractSha256" in s.input && s.input.codingContractSha256 === digest(task))) return result(phases, "STOPPED", "DURABLE_TASK_MAPPING_REQUIRED");
    if (initial.stepStates.some(s => ["RUNNING", "NEEDS_REREAD", "UNCERTAIN"].includes(s.status) || s.status === "RETRY_WAIT" && (s.retryAtMs ?? Infinity) > ports.nowMs())) return result(phases, "STOPPED", "DURABLE_WORK_NOT_READY");
    const request: AyasResourceRequest = Object.freeze({ taskId, class: "HEAVY_LOCAL_AI", priority: "BACKGROUND", ownedActive: false, requiresGpu: profile.requiresGpu, peakMemoryMb: profile.peakMemoryMb, prewarm: false, measuredPrewarmBenefitMs: null });
    if (await boundedRuntimeCall(profile.timeoutMs, () => ports.authorize("RUN_TASK", profile, taskId)) !== true) return result(phases, "STOPPED", "CURRENT_CAPABILITY_AND_PINS_REQUIRED");
    const admitted = await withAyasResourceCapacity(request, { ...ports, readCurrent: () => boundedRuntimeCall(profile.timeoutMs, () => ports.readCurrent()) }, async () => {
      if (!["MISSING", "STOPPED"].includes(await boundedRuntimeCall(profile.timeoutMs, () => ports.readPhase(taskId)))) return result(phases, "ERROR", "PRIOR_LIFECYCLE_REQUIRES_CURRENT_STATE_REREAD");
      const current = ports.journal.load(taskId);
      if (!current || current.status !== "ACTIVE" || current.lastDigest !== initial.lastDigest) return result(phases, "STOPPED", "DURABLE_TASK_CHANGED");
      const read = async () => { const s = await boundedRuntimeCall(profile.timeoutMs, () => ports.readRuntime(profile)); if (!validSnapshot(s, ports.nowMs()) || s.machineName !== profile.machineName || s.runtimeId !== profile.runtimeId) throw Error("RUNTIME_INVENTORY_UNKNOWN"); return s; };
      const act = async (action: AyasRuntimeAction, ids: readonly string[] = []) => {
        if (await boundedRuntimeCall(profile.timeoutMs, () => ports.authorize(action, profile, taskId)) !== true) throw Error("CURRENT_CAPABILITY_REQUIRED");
        const fresh = await read();
        const activeTask = ports.journal.load(taskId);
        if ((action === "START_MACHINE" || action === "LOAD_PINNED_MODEL") && (!activeTask || activeTask.status !== "ACTIVE" || activeTask.lastDigest !== initial.lastDigest || !dependenciesSettled(fresh, ports, taskId) || fresh.serverState !== "STOPPED" || fresh.taskContainerIds?.length !== 0)) throw Error("START_DEPENDENCIES_CHANGED");
        if (action === "LOAD_PINNED_MODEL") { const v = await boundedRuntimeCall(profile.timeoutMs, () => ports.readCurrent()); if (!evaluateAyasResourceAdmission(v.telemetry, v.context, request, v.maxRamAdmissionPercent, v.nowMs).mayStart) throw Error("LOAD_RESOURCE_ADMISSION_CHANGED"); }
        if (["STOP_LLAMA_SERVER", "REMOVE_TASK_CONTAINERS", "RELEASE_MODEL_MEMORY"].includes(action)) {
          const t = ports.journal.load(taskId);
          if (!verifiedTaskDigest || !t || t.lastDigest !== verifiedTaskDigest || !taskSafeForUnload(t, outcome!) || !dependenciesSettled(fresh, ports) || fresh.taskContainerIds === null
            || fresh.serverState === "UNKNOWN" || fresh.serverState === "RUNNING" && (fresh.serverOwnerTaskId !== taskId || fresh.modelDigest !== ayasLocalCodingCandidatePins.model.sha256)
            || fresh.taskContainerIds.length > 0 && fresh.taskContainerOwnerTaskId !== taskId) throw Error("CLEANUP_DEPENDENCIES_CHANGED");
          if (action === "REMOVE_TASK_CONTAINERS") ids = fresh.taskContainerIds;
        }
        if (await boundedRuntimeCall(profile.timeoutMs, signal => ports.perform(action, profile, taskId, Object.freeze([...ids]), signal)) !== "CONFIRMED") throw Error("RUNTIME_EFFECT_UNCONFIRMED");
      };
      let s = await read();
      if (s.machineState === "UNKNOWN" || s.serverState !== "STOPPED" || s.modelMemoryReleased !== true || s.taskContainerIds === null || s.taskContainerIds.length !== 0 || !dependenciesSettled(s, ports, taskId)) return result(phases, "STOPPED", "START_DEPENDENCIES_UNMEASURED_OR_ACTIVE");
      await phase("STARTING");
      if (s.machineState === "STOPPED") { await act("START_MACHINE"); s = await read(); if (s.machineState !== "RUNNING") throw Error("MACHINE_START_NOT_OBSERVED"); }
      await act("LOAD_PINNED_MODEL"); s = await read(); if (s.serverState !== "RUNNING" || s.machineState !== "RUNNING" || s.serverOwnerTaskId !== taskId || s.modelDigest !== ayasLocalCodingCandidatePins.model.sha256) throw Error("PINNED_RUNTIME_NOT_READY");
      await phase("READY");
      if (await boundedRuntimeCall(profile.timeoutMs, () => ports.authorize("RUN_TASK", profile, taskId)) !== true) throw Error("CURRENT_CAPABILITY_REQUIRED");
      await phase("BUSY");
      const beforeWork = ports.journal.load(taskId), runtimeBeforeWork = await read();
      if (!beforeWork || beforeWork.status !== "ACTIVE" || beforeWork.lastDigest !== initial.lastDigest || !dependenciesSettled(runtimeBeforeWork, ports, taskId) || runtimeBeforeWork.serverOwnerTaskId !== taskId || runtimeBeforeWork.modelDigest !== ayasLocalCodingCandidatePins.model.sha256) throw Error("TASK_OR_RUNTIME_CHANGED_BEFORE_WORK");
      const controller = new AbortController(); let interrupted: AyasResourceDecision | undefined;
      const boundary = async () => { const v = await boundedRuntimeCall(profile.timeoutMs, () => ports.readCurrent()); const d = evaluateAyasResourceAdmission(v.telemetry, v.context, { ...request, ownedActive: true }, v.maxRamAdmissionPercent, v.nowMs); if (!d.mayContinue) { interrupted = d; controller.abort(); } return d; };
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await boundary();
        const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error("BOUNDED_TASK_UNCONFIRMED")); }, profile.timeoutMs); });
        outcome = await Promise.race([ports.runTask(Object.freeze({ task, durableTaskId: taskId, signal: controller.signal, boundary })), timeout]);
        if (!["TASK_FINISHED", "TASK_DEFERRED", "MODEL_FAILURE", "RESOURCE_ABORT", "OWNER_CANCELLED"].includes(outcome)) throw Error("WORK_OUTCOME_INVALID");
        if (interrupted) outcome = interrupted.action === "RESOURCE_ABORT" ? "RESOURCE_ABORT" : "TASK_DEFERRED";
      } finally { if (timer) clearTimeout(timer); controller.abort(); }
      await phase("DRAINING");
      const settled = ports.journal.load(taskId);
      if (!settled || !taskSafeForUnload(settled, outcome)) return result(phases, "ERROR", "DURABLE_TASK_UNSETTLED_NO_UNLOAD", outcome);
      if (settled.status === "FAILED" && outcome === "TASK_FINISHED") return result(phases, "ERROR", "WORK_OUTCOME_TASK_CONFLICT_NO_UNLOAD");
      if ((settled.status === "CANCELLED" || settled.status === "REJECTED") && outcome === "TASK_FINISHED") outcome = "OWNER_CANCELLED";
      const fact = Object.freeze({ taskId, sequence: settled.lastSequence, taskDigest: settled.lastDigest, outcome });
      const receipt = await boundedRuntimeCall(profile.timeoutMs, () => ports.persistEvidenceAndCheckpoint(fact)), back = await boundedRuntimeCall(profile.timeoutMs, () => ports.readReceipt(taskId));
      if (!receipt || receipt.taskId !== taskId || receipt.sequence !== fact.sequence || receipt.taskDigest !== fact.taskDigest || receipt.outcome !== outcome || !HEX.test(receipt.evidenceDigest) || !HEX.test(receipt.checkpointDigest) || !back || digest(back) !== digest(receipt)) return result(phases, "ERROR", "EVIDENCE_CHECKPOINT_NOT_VERIFIED_NO_UNLOAD", outcome);
      const verifiedTaskDigest = fact.taskDigest;
      // Re-read after persistence and before each destructive boundary. New/unmeasured dependencies block cleanup.
      const cleanup = async (action: AyasRuntimeAction) => {
        const fresh = await read(), t = ports.journal.load(taskId);
        if (!t || t.lastDigest !== fact.taskDigest || !taskSafeForUnload(t, outcome!) || !dependenciesSettled(fresh, ports) || fresh.taskContainerIds === null
          || fresh.serverState === "UNKNOWN" || fresh.serverState === "RUNNING" && (fresh.serverOwnerTaskId !== taskId || fresh.modelDigest !== ayasLocalCodingCandidatePins.model.sha256)
          || fresh.taskContainerIds.length > 0 && fresh.taskContainerOwnerTaskId !== taskId) throw Error("ACTIVE_UNCERTAIN_DEPENDENCY_NO_UNLOAD");
        await act(action, action === "REMOVE_TASK_CONTAINERS" ? fresh.taskContainerIds : []);
      };
      await phase("STOPPING");
      await cleanup("STOP_LLAMA_SERVER");
      s = await read(); if (s.serverState !== "STOPPED") throw Error("SERVER_STOP_NOT_OBSERVED");
      await cleanup("REMOVE_TASK_CONTAINERS");
      s = await read(); if (s.taskContainerIds?.length !== 0) throw Error("TASK_CONTAINERS_REMAIN");
      await cleanup("RELEASE_MODEL_MEMORY");
      s = await read(); if (s.modelMemoryReleased !== true) throw Error("MODEL_MEMORY_RELEASE_UNMEASURED");
      await phase("STOPPED"); // Model is stopped; Podman may stay idle until its separate 10-minute rule.
      return result(phases, "STOPPED", "TASK_PERSISTED_AND_OWN_MODEL_UNLOADED", outcome);
    });
    return admitted.executed ? admitted.result! : result(phases, "STOPPED", admitted.decision.reasonCode);
  } catch { try { await phase("ERROR"); } catch { phases.push("ERROR"); } return result(phases, "ERROR", "REQUIRES_CURRENT_STATE_REREAD_NO_AUTOMATIC_REPLAY", outcome); }
}

/** Cleanup admission does not launch heavy work. Same host-common mutex; fresh complete dependencies under lock. */
export async function stopAyasOnDemandIdleWith(value: AyasOnDemandProfile, ports: AyasOnDemandPorts): Promise<AyasOnDemandResult> {
  const phases: AyasOnDemandState[] = [];
  try {
    const profile = profileSnapshot(value);
    if (typeof ports.hostCapacityRoot !== "string" || !path.isAbsolute(ports.hostCapacityRoot) || ports.hostCapacityRoot.startsWith("\\\\")) return result(phases, "ERROR", "HOST_COMMON_CAPACITY_ROOT_REQUIRED");
    return await withAyasExecutionAuthorityLock(ports.hostCapacityRoot, async () => {
      const s = await boundedRuntimeCall(profile.timeoutMs, () => ports.readRuntime(profile)), now = ports.nowMs();
      if (!validSnapshot(s, now) || s.machineName !== profile.machineName || s.runtimeId !== profile.runtimeId || s.machineState !== "RUNNING" || s.serverState !== "STOPPED" || s.modelMemoryReleased !== true || s.foreignContainers !== false || s.taskContainerIds?.length !== 0 || s.demandPending !== false || s.lastDemandAtMs === null || now - s.lastDemandAtMs < 600_000 || !dependenciesSettled(s, ports)) return result(phases, "STOPPED", "IDLE_STOP_DEFERRED");
      if (await boundedRuntimeCall(profile.timeoutMs, () => ports.authorize("STOP_MACHINE", profile, null)) !== true) return result(phases, "STOPPED", "CURRENT_OWNED_MACHINE_CAPABILITY_REQUIRED");
      await boundedRuntimeCall(profile.timeoutMs, () => ports.recordPhase("STOPPING", null)); phases.push("STOPPING");
      const latest = await boundedRuntimeCall(profile.timeoutMs, () => ports.readRuntime(profile)), latestNow = ports.nowMs();
      if (!validSnapshot(latest, latestNow) || latest.machineName !== profile.machineName || latest.runtimeId !== profile.runtimeId || latest.machineState !== "RUNNING" || latest.serverState !== "STOPPED" || latest.modelMemoryReleased !== true || latest.foreignContainers !== false || latest.taskContainerIds?.length !== 0 || latest.demandPending !== false || latest.lastDemandAtMs === null || latestNow - latest.lastDemandAtMs < 600_000 || !dependenciesSettled(latest, ports)) return result(phases, "STOPPED", "IDLE_DEMAND_CHANGED");
      if (await boundedRuntimeCall(profile.timeoutMs, signal => ports.perform("STOP_MACHINE", profile, null, [], signal)) !== "CONFIRMED") throw Error("MACHINE_STOP_UNCONFIRMED");
      const after = await boundedRuntimeCall(profile.timeoutMs, () => ports.readRuntime(profile));
      if (!validSnapshot(after, ports.nowMs()) || after.machineName !== profile.machineName || after.runtimeId !== profile.runtimeId || after.machineState !== "STOPPED") throw Error("MACHINE_STOP_NOT_OBSERVED");
      await boundedRuntimeCall(profile.timeoutMs, () => ports.recordPhase("STOPPED", null)); phases.push("STOPPED"); return result(phases, "STOPPED", "EXACT_IDLE_MACHINE_STOPPED");
    }, { acquireRetryLimit: 0 });
  } catch { return result(phases, "ERROR", "IDLE_STOP_REQUIRES_CURRENT_STATE_REREAD"); }
}

/** Selected pins are candidates. No registered live backend is installed by this source controller. */
export const AYAS_ON_DEMAND_DEPLOYMENT = Object.freeze({ status: "NOT_WIRED_ENGINE_UNREGISTERED", activation: "REQUIRES_EXISTING_OWNER_CAPABILITY_AND_PINNED_BACKEND", modelDigest: ayasLocalCodingCandidatePins.model.sha256, lazyDefault: true, startupPreload: false, automaticGlobalWslShutdown: false });
