/**
 * Stage 15Q.3 — host-common workload occupancy.
 *
 * One advisory record per running workload, under one host-owned root that
 * every AYAS process started from this checkout resolves the same way.
 * Production publishes its stages here, heavy local work publishes itself
 * here, and each side reads the other before it starts. This is the source
 * the resource governor's context is read from.
 *
 * A record grants nothing. It can only make another workload wait: task,
 * capability, owner and approval authority stay with the callers' existing
 * gates. Nothing is written at import time.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ProductionStepKey } from "@/types/project";
import { isSameLiveProcess, readProcessStartEpochMs } from "../../brain/autonomy/AyasProcessLiveness";
import { readAyasOwnerConstitution } from "../governance/AyasOwnerConstitutionReader";
import { ayasStageIsGpuLikely, type AyasMachineHealthAction, type AyasMachineHealthDecision } from "./AyasMachineHealthGuard";
import { collectAyasMachineTelemetry, type AyasMachineTelemetry } from "./AyasMachineTelemetry";
import { AYAS_RESOURCE_CLASSES, type AyasResourceClass, type AyasResourceContext } from "./AyasResourceGovernor";

export const AYAS_OCCUPANCY_STALE_AFTER_MS = 10 * 60_000;
const MAX_RECORDS = 1_000;
const TASK_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;
const OCCUPANCY_ID = /^[a-f0-9]{32}$/;
const HEAVY: readonly AyasResourceClass[] = ["HEAVY_LOCAL_AI", "MEDIA_RENDER", "MAINTENANCE"];

export interface AyasOccupancyEntry { readonly taskId: string; readonly class: AyasResourceClass; readonly production: boolean; }
export interface AyasOccupancyHandle { readonly occupancyId: string; readonly release: () => Promise<void>; }
/**
 * RUNNING: the owning process is alive. STALE: it is gone and its in-process work with it.
 * UNCERTAIN: it is gone, but a local model runtime can outlive the process that started it.
 */
export interface AyasOccupancyRecord extends AyasOccupancyEntry {
  readonly occupancyId: string; readonly pid: number; readonly processStartEpochMs: number; readonly startedAt: string;
  readonly state: "RUNNING" | "UNCERTAIN" | "STALE";
}
export interface AyasResourceOccupancy { readonly productionActive: boolean; readonly records: readonly AyasOccupancyRecord[]; }

/** Same convention as the other gate roots: this checkout's ignored `data/brain/execution` tree. A TEMP clone resolves its own root. */
export function resolveAyasHostCapacityRoot(repoRoot: string = process.cwd()): string {
  return path.join(path.resolve(repoRoot), "data", "brain", "execution", "resource-capacity");
}

const usableRoot = (root: unknown): root is string => typeof root === "string" && path.isAbsolute(root) && !root.startsWith("\\\\");
let ownStart: Promise<number> | undefined;
const ownStartEpochMs = (): Promise<number> => ownStart ??= readProcessStartEpochMs(process.pid).catch(() => Date.now() - Math.floor(process.uptime() * 1000));

/** Atomic publication (temp file, fsync, rename). The caller releases the record when its workload ends. */
export async function publishAyasResourceOccupancy(root: string, entry: AyasOccupancyEntry): Promise<AyasOccupancyHandle> {
  if (!usableRoot(root)) throw new Error("AYAS_OCCUPANCY_ROOT_INVALID");
  if (!entry || typeof entry.taskId !== "string" || !TASK_ID.test(entry.taskId) || !AYAS_RESOURCE_CLASSES.includes(entry.class) || typeof entry.production !== "boolean") throw new Error("AYAS_OCCUPANCY_ENTRY_INVALID");
  const dir = path.join(root, "occupancy"), occupancyId = crypto.randomUUID().replace(/-/g, "");
  const file = path.join(dir, `${occupancyId}.json`), tmp = path.join(dir, `.${occupancyId}.tmp`);
  const record = { schemaVersion: "1", occupancyId, taskId: entry.taskId, class: entry.class, production: entry.production, pid: process.pid, processStartEpochMs: await ownStartEpochMs(), startedAt: new Date().toISOString() };
  await fs.mkdir(dir, { recursive: true });
  try {
    const handle = await fs.open(tmp, "wx");
    try { await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(tmp, file);
  } catch (error) { await fs.rm(tmp, { force: true }).catch(() => undefined); throw error; }
  let released = false;
  return { occupancyId, release: async () => { if (released) return; released = true; await fs.rm(file, { force: true, maxRetries: 3, retryDelay: 50 }); } };
}

function parseRecord(bytes: string, name: string): Omit<AyasOccupancyRecord, "state"> | undefined {
  try {
    const v = JSON.parse(bytes) as Partial<AyasOccupancyRecord> & { readonly schemaVersion?: unknown };
    if (!v || typeof v !== "object" || v.schemaVersion !== "1" || typeof v.occupancyId !== "string" || !OCCUPANCY_ID.test(v.occupancyId) || name !== `${v.occupancyId}.json`
      || typeof v.taskId !== "string" || !TASK_ID.test(v.taskId) || !AYAS_RESOURCE_CLASSES.includes(v.class as AyasResourceClass) || typeof v.production !== "boolean"
      || !Number.isSafeInteger(v.pid) || (v.pid ?? 0) <= 0 || !Number.isSafeInteger(v.processStartEpochMs) || typeof v.startedAt !== "string" || !Number.isFinite(Date.parse(v.startedAt))) return undefined;
    return { occupancyId: v.occupancyId, taskId: v.taskId, class: v.class as AyasResourceClass, production: v.production, pid: v.pid as number, processStartEpochMs: v.processStartEpochMs as number, startedAt: v.startedAt };
  } catch { return undefined; }
}

/**
 * The current inventory, or null when it cannot be read. An unreadable or malformed record is an
 * unknown workload, never an absent one. Read-only: nothing is repaired or removed here.
 */
export async function readAyasResourceOccupancy(root: string): Promise<AyasResourceOccupancy | null> {
  try {
    if (!usableRoot(root)) return null;
    const dir = path.join(root, "occupancy");
    let names: string[];
    try { names = (await fs.readdir(dir)).filter((name) => name.endsWith(".json")).sort(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return Object.freeze({ productionActive: false, records: Object.freeze([]) }); return null; }
    if (names.length > MAX_RECORDS) return null;
    const own = await ownStartEpochMs(), records: AyasOccupancyRecord[] = [];
    for (const name of names) {
      let bytes: string;
      try { bytes = await fs.readFile(path.join(dir, name), "utf8"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; return null; } // released between the listing and the read
      const record = parseRecord(bytes, name);
      if (!record) return null;
      const live = record.pid === process.pid && Math.abs(record.processStartEpochMs - own) <= 1_000 || await isSameLiveProcess(record.pid, record.processStartEpochMs);
      records.push(Object.freeze({ ...record, state: live ? "RUNNING" : record.class === "HEAVY_LOCAL_AI" ? "UNCERTAIN" : "STALE" }));
    }
    return Object.freeze({ productionActive: records.some((record) => record.production && record.state === "RUNNING"), records: Object.freeze(records) });
  } catch { return null; }
}

/** Removes old records whose owning process is confirmed gone. An UNCERTAIN local model record is never removed here. */
export async function pruneAyasStaleOccupancy(root: string, occupancy: AyasResourceOccupancy, nowMs: number = Date.now()): Promise<number> {
  let removed = 0;
  if (!usableRoot(root)) return removed;
  for (const record of occupancy.records) {
    if (record.state !== "STALE" || !OCCUPANCY_ID.test(record.occupancyId) || nowMs - Date.parse(record.startedAt) <= AYAS_OCCUPANCY_STALE_AFTER_MS) continue;
    try { await fs.rm(path.join(root, "occupancy", `${record.occupancyId}.json`)); removed++; } catch { /* best effort */ }
  }
  return removed;
}

export type AyasSharedWorkload = "PRODUCTION_RENDER" | "PRODUCTION_LIGHT" | "SELF_EVOLUTION";
export interface AyasSharedOccupancyHold { readonly action: Extract<AyasMachineHealthAction, "PAUSE" | "BLOCK NEW HEAVY WORK">; readonly reasonCode: string; }

/**
 * What the shared inventory adds to a Machine Health decision. Production has explicit priority: it never
 * waits on an unreadable inventory, and only a render stage is held, by a loaded or unconfirmed local model.
 * Heavy self-development waits for production, for any other heavy workload and for an unknown inventory.
 */
export function ayasSharedOccupancyHold(occupancy: AyasResourceOccupancy | null, workload: AyasSharedWorkload): AyasSharedOccupancyHold | undefined {
  if (workload === "PRODUCTION_LIGHT") return undefined;
  const present = occupancy?.records.filter((record) => record.state !== "STALE") ?? [];
  if (workload === "PRODUCTION_RENDER") {
    const models = present.filter((record) => record.class === "HEAVY_LOCAL_AI");
    if (models.some((record) => record.state === "UNCERTAIN")) return { action: "BLOCK NEW HEAVY WORK", reasonCode: "RESOURCE_UNCERTAIN_MODEL_DEPENDENCY" };
    return models.length ? { action: "BLOCK NEW HEAVY WORK", reasonCode: "RESOURCE_MODEL_RENDER_OVERLAP" } : undefined;
  }
  if (!occupancy) return { action: "PAUSE", reasonCode: "RESOURCE_OCCUPANCY_UNKNOWN" };
  if (occupancy.productionActive) return { action: "PAUSE", reasonCode: "RESOURCE_PRODUCTION_PRIORITY" };
  const heavy = present.filter((record) => HEAVY.includes(record.class));
  if (heavy.some((record) => record.state === "UNCERTAIN")) return { action: "PAUSE", reasonCode: "RESOURCE_UNCERTAIN_DEPENDENCY" };
  return heavy.length ? { action: "PAUSE", reasonCode: "RESOURCE_ONE_HEAVY_AT_A_TIME" } : undefined;
}

/** Existing Machine Health consumers keep their decision shape; shared occupancy can only tighten an admitted one. */
export function applyAyasSharedOccupancy(health: AyasMachineHealthDecision, occupancy: AyasResourceOccupancy | null, workload: AyasSharedWorkload): AyasMachineHealthDecision {
  if (!health.mayStart) return health;
  const hold = ayasSharedOccupancyHold(occupancy, workload);
  return hold ? Object.freeze({ action: hold.action, reasonCode: hold.reasonCode, telemetry: health.telemetry, mayStart: false }) : health;
}

export class AyasResourceOccupancyBlockedError extends Error {
  readonly code: string;
  constructor(readonly hold: AyasSharedOccupancyHold) { super("Resource occupancy blocked heavy workload admission."); this.name = "AyasResourceOccupancyBlockedError"; this.code = hold.reasonCode; this.stack = undefined; }
}

/**
 * Publishes one production stage for its whole run. Publish first, then look: a heavy local model that
 * starts at the same moment publishes and looks the same way, so at least one side sees the other.
 * Publication is advisory for production — a stage is never refused because its record could not be written.
 */
export async function withAyasProductionStageOccupancy<T>(stage: ProductionStepKey, operation: () => Promise<T>, root: string = resolveAyasHostCapacityRoot()): Promise<T> {
  const render = ayasStageIsGpuLikely(stage);
  let handle: AyasOccupancyHandle | undefined;
  try { handle = await publishAyasResourceOccupancy(root, { taskId: `production:${stage}:${crypto.randomUUID()}`, class: render ? "MEDIA_RENDER" : "LIGHT_BACKGROUND", production: true }); }
  catch { /* unpublished: heavy local work still sees the render through telemetry and pressure */ }
  try {
    const hold = render ? ayasSharedOccupancyHold(await readAyasResourceOccupancy(root), "PRODUCTION_RENDER") : undefined;
    if (hold) throw new AyasResourceOccupancyBlockedError(hold);
    return await operation();
  } finally { await handle?.release().catch(() => undefined); }
}

/** CPU, core count, RAM and platform. GPU identity is not part of it yet; a benchmark must be bound to it before it gates anything. */
export function ayasHardwareFingerprint(): string {
  const cpus = os.cpus();
  return crypto.createHash("sha256").update(JSON.stringify({ platform: process.platform, arch: os.arch(), cpuModel: cpus[0]?.model ?? null, logicalCores: cpus.length, totalRamBytes: os.totalmem() })).digest("hex");
}

/**
 * The governor's context as this host can measure it today. Production activity and heavy workloads come
 * from the shared inventory; owner interaction, queue depth, loaded-model footprint, thermal state and
 * host-protection events have no measured source here and stay null/UNKNOWN, so a new heavy local model
 * start is deferred rather than admitted on a guess.
 */
export async function collectAyasResourceContext(root: string): Promise<AyasResourceContext> {
  const occupancy = await readAyasResourceOccupancy(root);
  const heavy = new Map<string, { readonly taskId: string; readonly class: AyasResourceClass; readonly state: "RUNNING" | "UNCERTAIN" }>();
  for (const record of occupancy?.records ?? []) {
    if (record.state === "STALE" || !HEAVY.includes(record.class)) continue;
    if (heavy.get(record.taskId)?.state !== "UNCERTAIN") heavy.set(record.taskId, { taskId: record.taskId, class: record.class, state: record.state });
  }
  return Object.freeze({
    ownerInteractive: null, productionActive: occupancy ? occupancy.productionActive : null,
    heavyWorkloads: occupancy ? Object.freeze([...heavy.values()]) : null,
    queueDepth: null, modelFootprintMb: null, thermalState: "UNKNOWN", hostProtection: "UNKNOWN",
    hardwareFingerprint: ayasHardwareFingerprint(), benchmarkedFingerprint: null,
  });
}

/** The host provider for `AyasResourceCapacityDeps.readCurrent`: fresh telemetry, context and owner policy. Read-only. */
export async function readAyasCurrentResourceState(repoRoot: string = process.cwd()): Promise<{ readonly telemetry: AyasMachineTelemetry; readonly context: AyasResourceContext; readonly nowMs: number; readonly maxRamAdmissionPercent: number }> {
  const policy = readAyasOwnerConstitution(repoRoot);
  const [telemetry, context] = await Promise.all([collectAyasMachineTelemetry({ cwd: repoRoot }), collectAyasResourceContext(resolveAyasHostCapacityRoot(repoRoot))]);
  return { telemetry, context, nowMs: Date.now(), maxRamAdmissionPercent: policy.state === "ACTIVE" ? policy.policy.rules.maxRamAdmissionPercent : policy.state === "MISSING" ? 90 : NaN };
}
