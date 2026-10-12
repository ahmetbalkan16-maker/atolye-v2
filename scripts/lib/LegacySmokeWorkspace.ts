import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRuntimeStorageContext } from "../../src/lib/runtime/RuntimeStoragePaths";
import { createProductionRuntimeOperationContext, initialRuntimeAuthorityGeneration, runWithProductionRuntimeOperationContext } from "../../src/lib/runtime/ProductionRuntimeOperationContext";
import { ProductionWorkerLifecycle } from "../../src/lib/production/ProductionWorkerLifecycle";
import { configureScopedProductionPipelineExecution } from "../../src/lib/production/ProductionPipelineExecutionConfiguration";
import { productionAcceptanceConfigurationFingerprint, productionAcceptanceRequestFingerprint } from "../../src/lib/production/ProductionAcceptancePolicy";
import { createProductionAcceptanceProjectSlug, normalizeProductionAcceptanceTopic, productionAcceptanceTopicFingerprint } from "../../src/lib/production/ProductionAcceptanceTopic";

export const historicalSmokeProjectSlug = "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5";

/**
 * Commits whose tracked copy of the Fatih sample project a historical suite was written against.
 * The live folder kept progressing after `788334e` untracked it, so its current state no longer
 * matches what these suites assert (e.g. "visuals is the next stage").
 */
export const historicalSmokeSnapshots = Object.freeze({
  /** Sprint 129.19: research/script/scenes done, visuals next; JSON only. */
  visualsNext: "65d376b5fc63ecc0cde95c3938afa2356847f1ec",
  /** Sprint 129.21: visuals done with six stored images, animation next. */
  animationNext: "6094cd8305ba957679dbb5211eb06e69af2ad63a",
  /** Sprint 129.26: animation done, audio next. */
  audioNext: "6286a7c53166d38d09cd09ad97b2188138ab5df1",
  /** Sprint 129.32 checkpoint: the audio retry lineage (ordinal four) the 129.36/129.41 suites replay. */
  audioRetryLineage: "2fc58f962c94763861d9e777772de935fd923d89",
});

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function requireTemporary(root: string) {
  const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(root));
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("LEGACY_SMOKE_WORKSPACE_NOT_TEMPORARY");
}

/**
 * Restores the sample project exactly as committed at `commit` into a TEMP target. Bytes come from
 * Git's object store and are checked against their object ids; nothing reads the owner's live folder.
 * Needs a clone with history (a `git archive` copy has none and fails closed).
 */
export function copyHistoricalSmokeFixture(target: string, commit: string = historicalSmokeSnapshots.visualsNext) {
  fs.mkdirSync(path.dirname(target), { recursive: true }); requireTemporary(path.dirname(target));
  if (fs.existsSync(target) || path.basename(target) !== historicalSmokeProjectSlug) throw new Error("HISTORICAL_FIXTURE_TARGET_INVALID");
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("HISTORICAL_FIXTURE_COMMIT_INVALID");
  const prefix = `data/projects/${historicalSmokeProjectSlug}/`;
  const git = (args: string[], input?: string) => {
    try { return execFileSync("git", args, { cwd: repositoryRoot, input, maxBuffer: 512 * 1024 * 1024, windowsHide: true, stdio: ["pipe", "pipe", "ignore"] }); }
    catch { throw new Error("HISTORICAL_FIXTURE_REQUIRES_GIT_HISTORY"); }
  };
  const entries = git(["ls-tree", "-r", "-z", "--full-tree", commit, "--", prefix]).toString("utf8").split("\0").filter(Boolean).map((line) => {
    const tab = line.indexOf("\t"), [mode, type, oid] = line.slice(0, tab).split(" ");
    return { mode, type, oid, file: line.slice(tab + 1) };
  });
  if (!entries.length) throw new Error("HISTORICAL_FIXTURE_REQUIRES_GIT_HISTORY");
  for (const entry of entries) {
    const relative = entry.file.slice(prefix.length);
    if (entry.type !== "blob" || entry.mode !== "100644" || !entry.file.startsWith(prefix) || relative.split("/").some((s) => !s || s === "." || s === "..")) throw new Error("HISTORICAL_FIXTURE_PATH_INVALID");
  }
  const batch = git(["cat-file", "--batch"], entries.map((entry) => entry.oid).join("\n") + "\n");
  let offset = 0;
  for (const entry of entries) {
    const headerEnd = batch.indexOf(0x0a, offset);
    const [oid, type, size] = batch.subarray(offset, headerEnd).toString("utf8").split(" ");
    const bytes = batch.subarray(headerEnd + 1, headerEnd + 1 + Number(size));
    // Git's object id is the content hash; recompute it instead of trusting the transport.
    if (oid !== entry.oid || type !== "blob" || bytes.length !== Number(size) ||
      createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") !== entry.oid) throw new Error("HISTORICAL_FIXTURE_HASH_INVALID");
    offset = headerEnd + 1 + bytes.length + 1;
    const file = path.join(target, ...entry.file.slice(prefix.length).split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes, { flag: "wx" });
  }
}

/**
 * Moves one stage's durable lineage (idempotency record versions, its reservation, claims and
 * attempts) out of a TEMP fixture into `destination`. Pre-129.32 lineages were left half-written
 * (reserved record, attempt without an operation) and current reconciliation refuses them; a suite
 * that asserts that refusal first can then exercise a failure that never reached durable admission.
 */
export function setAsideHistoricalStageLineage(projectFolder: string, stage: string, destination: string): readonly string[] {
  requireTemporary(projectFolder); fs.mkdirSync(destination, { recursive: true }); requireTemporary(destination);
  const root = path.join(projectFolder, "production-execution");
  const read = (directory: string) => fs.existsSync(path.join(root, directory)) ? fs.readdirSync(path.join(root, directory)).filter((name) => name.endsWith(".json"))
    .map((name) => ({ relative: `${directory}/${name}`, value: JSON.parse(fs.readFileSync(path.join(root, directory, name), "utf8")) as Record<string, unknown> })) : [];
  const records = read("idempotency").filter((entry) => entry.value.stage === stage);
  const recordIds = new Set(records.map((entry) => String(entry.value.recordId)));
  const reservations = new Set(records.map((entry) => `reservations/${String(entry.value.identityFingerprint)}.json`));
  const linked = [...read("claims"), ...read("attempts")].filter((entry) => recordIds.has(String((entry.value.identity as { recordId?: unknown } | undefined)?.recordId)));
  const moved = [...records.map((entry) => entry.relative), ...reservations, ...linked.map((entry) => entry.relative)].sort();
  if (!records.length) throw new Error("HISTORICAL_STAGE_LINEAGE_ABSENT");
  for (const relative of moved) {
    const target = path.join(destination, ...relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.renameSync(path.join(root, ...relative.split("/")), target);
  }
  return moved;
}

/** A real scoped test worker; never binds a historical fixture to the live authority. */
export async function withLegacySmokeWorkspace<T>(workspace: string, run: () => Promise<T>): Promise<T> {
  requireTemporary(workspace);
  const storage = createRuntimeStorageContext({ workspaceRoot: workspace,
    environment: { NODE_ENV: "test", ATOLYE_RUNTIME_ROOT: path.join(workspace, "data"), ATOLYE_RUNTIME_AUTHORITY_ROOT: path.join(workspace, "authority") } });
  const context = createProductionRuntimeOperationContext({ operationId: `legacy-smoke-${randomUUID()}`, operationType: "legacy-smoke", authorityGeneration: initialRuntimeAuthorityGeneration, storageContext: storage });
  const worker = new ProductionWorkerLifecycle(); worker.bindRuntimeOperationContext(context);
  const now = new Date().toISOString();
  const started = await worker.start({ initialization: { schemaVersion: "1", ok: true, decision: "ready", reasonCode: "RUNTIME_INITIALIZED", initializedAt: now, writeFree: true, partialInitialization: false, projects: [], counts: { active: 0, running: 0, terminal: 0, orphaned: 0, "expired-lease": 0, replayable: 0 }, worker: worker.snapshot(), evidence: ["temporary-test-fixture"] } });
  if (!started.ok) throw new Error("LEGACY_SMOKE_WORKER_NOT_READY");
  const registration = configureScopedProductionPipelineExecution({ lifecycle: worker, runtimeOperationContext: context });
  try { return await runWithProductionRuntimeOperationContext(context, run); }
  finally { registration.restore(); await worker.stop(); }
}

/** Historical sample configuration is not portable. Rebuild only its TEMP test marker, not live reauthorization. */
export function refreshLegacySmokeMarker(projectFolder: string) {
  requireTemporary(projectFolder);
  const file = path.join(projectFolder, "production-acceptance.json"), old = JSON.parse(fs.readFileSync(file, "utf8"));
  const topic = normalizeProductionAcceptanceTopic(old.topic), runId = old.runId;
  if (createProductionAcceptanceProjectSlug(topic, runId) !== path.basename(projectFolder)) throw new Error("LEGACY_SMOKE_MARKER_IDENTITY_INVALID");
  const configurationFingerprint = productionAcceptanceConfigurationFingerprint();
  const marker = { schemaVersion: "2", runId, topic, topicFingerprint: productionAcceptanceTopicFingerprint(topic), requestFingerprint: productionAcceptanceRequestFingerprint({ topic, runId, configurationFingerprint }), strictProductionAcceptance: true, publishMode: "package-only", configurationFingerprint, createdAt: old.createdAt, acceptanceStatus: "prepared", productionReady: false, published: false };
  fs.writeFileSync(file, JSON.stringify(marker, null, 2));
}
