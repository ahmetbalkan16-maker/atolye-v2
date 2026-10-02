/** Ordered migration readiness. Evidence metadata is advisory, never activation authority. */
import { assertAyasPortableBrain, portableBrainDigest, manifestAyasPortableBrain, type AyasPortableBrain } from "./AyasPortableBrain";

export const AYAS_MIGRATION_CHECKS = Object.freeze([
  "DEPENDENCIES", "PATH_REBIND", "ARTIFACT_HASHES", "GRAPHIFY", "HARDWARE_BENCHMARK", "DURABLE_RESTORE", "ON_DEMAND_STARTUP", "AUDIT",
] as const);
export type AyasMigrationCheck = typeof AYAS_MIGRATION_CHECKS[number];
export interface AyasMigrationEvidence {
  readonly check: AyasMigrationCheck; readonly state: "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN" | "DEGRADED";
  readonly evidenceClass: "LIVE_READ_ONLY" | "DETERMINISTIC_TEST";
  readonly manifestDigest: string; readonly destinationHead: string; readonly hardwareFingerprint: string;
  readonly evidenceDigest: string;
}
export interface AyasMigrationContext {
  readonly mode: "TEMP_DRILL" | "DESTINATION"; readonly destinationHead: string; readonly hardwareFingerprint: string;
  readonly expectedManifestDigest: string; readonly evidence: readonly AyasMigrationEvidence[];
}
/** A copied artifact, old benchmark, missing check, duplicate or test-only destination observation is never PASS. */
export function evaluateAyasPortableMigration(payload: unknown, context: AyasMigrationContext) {
  assertAyasPortableBrain(payload);
  const validHash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
  if (!context || !["TEMP_DRILL", "DESTINATION"].includes(context.mode) || !/^[a-f0-9]{40}$/.test(context.destinationHead)
    || !validHash(context.hardwareFingerprint) || !validHash(context.expectedManifestDigest) || !Array.isArray(context.evidence)
    || context.evidence.length > AYAS_MIGRATION_CHECKS.length || portableBrainDigest(manifestAyasPortableBrain(payload)) !== context.expectedManifestDigest) throw new Error("AYAS_PORTABLE_MIGRATION_CONTEXT_INVALID");
  const seen = new Set<string>();
  for (const e of context.evidence) {
    if (!e || Object.keys(e).sort().join("|") !== ["check", "state", "evidenceClass", "manifestDigest", "destinationHead", "hardwareFingerprint", "evidenceDigest"].sort().join("|")
      || !AYAS_MIGRATION_CHECKS.includes(e.check) || seen.has(e.check) || !["PASS", "FAIL", "BLOCKED", "NOT_RUN", "DEGRADED"].includes(e.state)
      || !["LIVE_READ_ONLY", "DETERMINISTIC_TEST"].includes(e.evidenceClass) || !validHash(e.evidenceDigest)) throw new Error("AYAS_PORTABLE_MIGRATION_EVIDENCE_INVALID");
    seen.add(e.check);
  }
  let predecessorHeld = false;
  const checks = AYAS_MIGRATION_CHECKS.map(check => {
    const e = context.evidence.find(x => x.check === check);
    let state: "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN" | "DEGRADED" = e?.state ?? "NOT_RUN";
    let reason = e ? "OBSERVED" : "EVIDENCE_MISSING";
    if (e && (e.manifestDigest !== context.expectedManifestDigest || e.destinationHead !== context.destinationHead || e.hardwareFingerprint !== context.hardwareFingerprint)) {
      state = "BLOCKED"; reason = "EVIDENCE_BINDING_STALE";
    }
    if (context.mode === "DESTINATION" && e?.evidenceClass === "DETERMINISTIC_TEST" && ["DEPENDENCIES", "PATH_REBIND", "ARTIFACT_HASHES", "GRAPHIFY", "HARDWARE_BENCHMARK", "ON_DEMAND_STARTUP"].includes(check)) {
      state = "BLOCKED"; reason = "REAL_DESTINATION_OBSERVATION_REQUIRED";
    }
    if (predecessorHeld && state === "PASS") { state = "BLOCKED"; reason = "PREDECESSOR_NOT_PASSED"; }
    if (state !== "PASS") predecessorHeld = true;
    return { check, state, reason };
  });
  const ready = checks.every(x => x.state === "PASS");
  return {
    schemaVersion: "1" as const, manifestDigest: context.expectedManifestDigest, destinationHead: context.destinationHead,
    hardwareFingerprint: context.hardwareFingerprint, checks,
    outcome: ready ? context.mode === "TEMP_DRILL" ? "TEMP_DRILL_READY_FOR_OWNER_REVIEW" : "DESTINATION_EVIDENCE_READY_FOR_OWNER_REVIEW" : "MIGRATION_BLOCKED",
    /** Neither readiness outcome grants approval or claims owner activation. */
    ownerActivation: "BLOCKED_OWNER_ACTION" as const, oldPcCleanup: "BLOCKED_OWNER_ACTION_AFTER_VERIFIED_MIGRATION" as const,
    grantsAuthority: false as const, liveActivationOccurred: false as const,
  };
}
/** Signed old-machine constitution material is not transplanted. The existing owner activation service signs anew. */
export function portableMigrationScope(payload: AyasPortableBrain) {
  assertAyasPortableBrain(payload);
  return { inertSections: payload.sections, runtimeArtifacts: payload.runtime.artifacts,
    activationRequirement: "DESTINATION_AUDIT_THEN_EXISTING_OWNER_SERVICES" as const,
    importedApprovalUse: "HISTORICAL_ONLY_NEVER_EXECUTABLE" as const, secretTransfer: "SEPARATE_OWNER_CONTROLLED_REBIND" as const };
}
