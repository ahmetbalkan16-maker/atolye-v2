/**
 * Stage 15Q operator CLI: what the resource governor sees on this host right now.
 *
 * Read-only by default: host telemetry (percentages and coarse process presence only — no command
 * lines, window titles, keystrokes or screen contents), the owner's RAM admission policy, the
 * host-common occupancy inventory, the governor's context and the decision each kind of workload
 * would get. Starts nothing, loads no model and grants no authority.
 *
 *   npx tsx scripts/ayas-resource-status.ts [--peak-mb <n>] [--prune-stale]
 *
 * `--peak-mb` is the projected peak memory of a hypothetical heavy local model start (unknown when omitted).
 * `--prune-stale` is the one write: it removes occupancy records older than ten minutes whose owning
 * process is confirmed gone. An UNCERTAIN local model record is never removed.
 */
import { evaluateAyasMachineHealth } from "../src/lib/ayas/machine/AyasMachineHealthGuard";
import { AYAS_ON_DEMAND_DEPLOYMENT } from "../src/lib/ayas/machine/AyasOnDemandLifecycle";
import { evaluateAyasResourceAdmission, type AyasResourceRequest } from "../src/lib/ayas/machine/AyasResourceGovernor";
import { ayasSharedOccupancyHold, pruneAyasStaleOccupancy, readAyasCurrentResourceState, readAyasResourceOccupancy, resolveAyasHostCapacityRoot } from "../src/lib/ayas/machine/AyasResourceOccupancy";

async function main(): Promise<void> {
  const args = process.argv.slice(2); let peakMemoryMb: number | null = null; let prune = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--prune-stale") prune = true;
    else if (args[i] === "--peak-mb" && /^[1-9]\d{0,6}$/.test(args[i + 1] ?? "")) peakMemoryMb = Number(args[++i]);
    else throw new Error("ARGUMENT_INVALID");
  }
  const root = process.cwd(), capacityRoot = resolveAyasHostCapacityRoot(root);
  const before = await readAyasResourceOccupancy(capacityRoot);
  const pruned = prune && before ? await pruneAyasStaleOccupancy(capacityRoot, before) : 0;
  const occupancy = pruned ? await readAyasResourceOccupancy(capacityRoot) : before;
  const { telemetry, context, nowMs, maxRamAdmissionPercent } = await readAyasCurrentResourceState(root);
  const health = evaluateAyasMachineHealth(telemetry, { stage: "video", ownedActive: false }, maxRamAdmissionPercent);
  const request = (patch: Partial<AyasResourceRequest>): AyasResourceRequest => ({ taskId: "status-probe", class: "HEAVY_LOCAL_AI", priority: "BACKGROUND", ownedActive: false, requiresGpu: false, peakMemoryMb, prewarm: false, measuredPrewarmBenefitMs: null, ...patch });
  const decide = (patch: Partial<AyasResourceRequest>) => { const d = evaluateAyasResourceAdmission(telemetry, context, request(patch), maxRamAdmissionPercent, nowMs); return { action: d.action, reasonCode: d.reasonCode }; };
  const held = (workload: "PRODUCTION_RENDER" | "SELF_EVOLUTION") => health.mayStart ? ayasSharedOccupancyHold(occupancy, workload) ?? { action: health.action, reasonCode: health.reasonCode } : { action: health.action, reasonCode: health.reasonCode };
  console.log(JSON.stringify({
    schemaVersion: "1", observedAt: telemetry.observedAt, authority: "NONE", evidenceClass: "LIVE_READ_ONLY_HOST_OBSERVATION",
    policy: { maxRamAdmissionPercent: Number.isFinite(maxRamAdmissionPercent) ? maxRamAdmissionPercent : "UNAVAILABLE" },
    telemetry,
    occupancy: occupancy
      ? { state: "READ", productionActive: occupancy.productionActive, records: occupancy.records.map((r) => ({ occupancyId: r.occupancyId, class: r.class, production: r.production, state: r.state, startedAt: r.startedAt })), prunedStale: pruned }
      : { state: "UNREADABLE", prunedStale: pruned },
    context,
    decisions: {
      interactive: decide({ class: "INTERACTIVE", priority: "OWNER_INTERACTIVE", peakMemoryMb: 0 }),
      productionRenderStage: held("PRODUCTION_RENDER"),
      heavySelfDevelopment: held("SELF_EVOLUTION"),
      heavyLocalModelStart: decide({}),
    },
    onDemand: AYAS_ON_DEMAND_DEPLOYMENT,
    unmeasured: ["ownerInteractive", "queueDepth", "modelFootprintMb", "thermalState", "hostProtection", "benchmarkedFingerprint"],
  }, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
