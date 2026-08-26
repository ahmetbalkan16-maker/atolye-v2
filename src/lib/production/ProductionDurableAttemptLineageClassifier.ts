import type { ProductionExecutionDurableAttemptRecord } from
  "@/types/productionExecutionDurableAttempt";
import type { ProductionExecutionDurableClaimRecord } from
  "@/types/productionExecutionDurableClaim";
import type { ProductionExecutionIdempotencyRecord } from
  "@/types/productionExecutionIdempotency";
import type { ProductionExecutionPersistenceAdapter } from
  "@/types/productionExecutionPersistence";
import type { ProductionExecutionDurableRecord } from
  "@/types/productionExecutionDurableStorage";
import type { ProductionStepKey } from "@/types/project";
import type { ProductionAcceptanceStageExecutionIdentity } from
  "./ProductionAcceptancePolicy";
import { validateProductionExecutionDurableAttempt } from "./ProductionExecutionDurableAttempt";
import { validateProductionExecutionDurableClaim } from "./ProductionExecutionDurableClaim";
import { AdapterBackedProductionExecutionDurableStorage,
  isProductionExecutionTerminalDurableRecordState } from
  "./ProductionExecutionDurableStorage";
import { buildProductionPipelineExecutionIdentity } from
  "./ProductionPipelineExecutionIdentity";
import type { ProductionDurableAttemptLineageBoundary } from
  "./ProductionDurableAttemptLineageBoundary";
import { isProductionExecutionTerminalAttemptState } from "./ProductionExecutionDurableAttempt";
import { listRegenerationExecutionBindings, listRegenerationExecutionBindingCandidates } from
  "./ProductionCompletedStageRegenerationStore";
import { resolveOrphanReservationTolerance } from "./ProductionOrphanReservationToleranceAuthority";
import { findSupersessionDecisionForCandidate } from "./ProductionSupersededDuplicateReservationAuthority";
import { type RuntimeStorageInput, resolveRuntimeStorageContext } from "@/lib/runtime/RuntimeStoragePaths";
import type { ProductionRegenerationBinding } from "@/types/productionRegeneration";

export type ProductionDurableAttemptLineageClassification =
  | { readonly status: "none"; readonly durableOrdinal: 0 }
  | {
    readonly status: "valid";
    readonly durableOrdinal: number;
    readonly maximumRecordAttempt: number;
    readonly latestAttempt: ProductionExecutionDurableAttemptRecord;
  }
  | { readonly status: "invalid"; readonly boundary: ProductionDurableAttemptLineageBoundary };

/**
 * @internal Shared read-only classifier for preparation and retry reconciliation.
 *
 * `runtimeInput` scopes the (optional) `ProductionOrphanReservationToleranceAuthority`
 * consultation used to exclude a trailing/interior orphan record from the pairing
 * requirement below (see the "position-independent orphan exclusion" comment further
 * down). When omitted, tolerance lookups fall back to the same default resolution
 * (`resolveRuntimeStorageContext()` / ambient runtime operation scope) every other
 * unscoped production caller already uses -- this parameter exists purely so isolated
 * tests can point it at a fixture root without touching any other call site.
 */
export async function classifyProductionDurableAttemptLineage(
  adapter: ProductionExecutionPersistenceAdapter,
  projectSlug: string,
  stage: string,
  expectedJobAttempt: number,
  mode: "preparation" | "exact" = "preparation",
  runtimeInput?: RuntimeStorageInput,
): Promise<ProductionDurableAttemptLineageClassification> {
  const [recordKeys, claimKeys, attemptKeys] = await Promise.all([
    adapter.listKeys("idempotency"),
    adapter.listKeys("claim"),
    adapter.listKeys("attempt"),
  ]);
  if (!recordKeys.ok) return invalid("idempotency-list");
  if (!claimKeys.ok) return invalid("claim-list");
  if (!attemptKeys.ok) return invalid("attempt-list");

  const storage = new AdapterBackedProductionExecutionDurableStorage(adapter);
  const records = new Map<string, Array<{ version: number;
    value: ProductionExecutionIdempotencyRecord }>>();
  const recordCount = await readApplicableRecords(
    adapter, storage, recordKeys.keys, projectSlug, stage, records,
  );
  if (typeof recordCount === "string") return invalid(recordCount);

  const claims = new Map<string, Array<{ version: number;
    value: ProductionExecutionDurableClaimRecord }>>();
  const attempts = new Map<string, Array<{ version: number;
    value: ProductionExecutionDurableAttemptRecord }>>();
  const scanLimit = Math.max(expectedJobAttempt + 3, recordKeys.keys.length + claimKeys.keys.length +
    attemptKeys.keys.length + 1);
  const plans = buildLineagePlans(projectSlug, stage as ProductionStepKey, scanLimit);
  const claimRead = await readApplicableClaims(adapter, claimKeys.keys, plans.claimIds, claims);
  if (claimRead) return invalid(claimRead);
  const attemptRead = await readApplicableAttempts(adapter, attemptKeys.keys, plans.attemptIds, attempts);
  if (attemptRead) return invalid(attemptRead);

  // Duplicate-ordinal supersession pre-filter -- runs here, BEFORE
  // `recordValues` is ever built, and operates directly on the `records` Map
  // `readApplicableRecords` just populated (never on `recordValues`, which
  // does not exist yet). This is deliberately upstream of the "Full-range
  // cardinality/topology proof" below: a genuine duplicate ordinal (two
  // recordIds sharing one `attempt`) fails that proof unconditionally and
  // always will -- this pre-filter's only job is to remove a record from
  // consideration BEFORE that proof runs, for the one narrow case where an
  // explicit, separately-published ProductionSupersededDuplicateReservationAuthority
  // decision has already resolved which of the two colliding identities is
  // superseded. See excludeSupersededDuplicateReservations() for the full,
  // independently fail-closed re-verification this performs before ever
  // deleting a key -- it never trusts a decision's cached proof at face
  // value, and it never touches `decision.canonicalRecordId`.
  await excludeSupersededDuplicateReservations(
    projectSlug, stage as ProductionStepKey, records, claims, attempts, runtimeInput,
  );

  if (records.size === 0) {
    if (claims.size > 0 || attempts.size > 0) return invalid("orphan-lineage");
    if (expectedJobAttempt !== 0) return invalid("no-applicable-lineage");
    return { status: "none", durableOrdinal: 0 };
  }

  const recordValues: ProductionExecutionIdempotencyRecord[] = [];
  for (const versions of records.values()) {
    const latest = exactLatestLineageVersion(versions, "version-contiguity");
    if (!latest.ok) return invalid(latest.boundary);
    recordValues.push(latest.value);
  }
  recordValues.sort((left, right) => left.attempt - right.attempt);

  // Full-range cardinality/topology proof FIRST, on the RAW, pre-exclusion
  // record set, before any orphan exclusion runs: `recordValues.length` must
  // equal the exact size of the ordinal range, AND every record's own
  // `attempt` must land on its exact sorted position. Together these prove
  // "exactly one record per ordinal, no gaps, no duplicates" unconditionally
  // -- an authority-tolerated orphan can NEVER relax this proof, because
  // exclusion (below) only ever runs on records that have already passed
  // through this gate untouched. A record sharing its ordinal with another
  // record -- regardless of whether one of the two is a cancelled,
  // claimless, attemptless, authority-backed orphan -- fails here, full
  // stop; resolving such a duplicate is a distinct, explicit reconciliation
  // decision (which of the two identities is canonical), never something an
  // orphan-reservation-tolerance authority is scoped to answer.
  const maximum = recordValues[recordValues.length - 1].attempt;
  const minimum = recordValues[0].attempt;
  const regenerationGap = minimum > 1 &&
    listRegenerationExecutionBindings(projectSlug, stage as ProductionStepKey)
      .some((item) => item.firstGlobalExecutionOrdinal === minimum - 1);
  const requiredOrdinalCount = regenerationGap ? maximum - minimum + 1 : maximum;
  if (recordValues.length !== requiredOrdinalCount) return invalid("lineage-cardinality");
  for (let index = 0; index < recordValues.length; index += 1) {
    if (recordValues[index].attempt !== minimum + index) return invalid("record-ordinal-topology");
  }

  const lineagePlans = new Map<string, { record: ProductionExecutionIdempotencyRecord;
    planned: ReturnType<typeof buildProductionPipelineExecutionIdentity> }>();
  for (const record of recordValues) {
    const runType = durableLineageRunType(record.operation);
    if (!runType) return invalid("record-operation-format");
    // Integrity check: this must NOT derive from `record`'s own recordId
    // (that would be circular and defeat the check). It instead searches
    // every regeneration that was ever historically eligible for this
    // record's ordinal -- not just the current maximum generation -- and
    // accepts the one whose computed identity exactly matches the persisted
    // record. Runs for every record, orphan-eligible or not: an orphan
    // candidate's own recordId is proven authentic here exactly like every
    // other record's.
    const planned = resolveHistoricalRecordIdentity(
      projectSlug, stage as ProductionStepKey, record, runType);
    if (!planned) return invalid("record-canonical-id");
    const recordBoundary = recordBindingBoundary(record, planned);
    if (recordBoundary) return invalid(recordBoundary);
    if (lineagePlans.has(planned.attemptId)) return invalid("duplicate-attempt-plan");
    lineagePlans.set(planned.attemptId, { record, planned });
  }

  // Position-independent orphan exclusion. Run only AFTER the integrity
  // proof above has already established that `recordValues` is a perfectly
  // contiguous, duplicate-free, identity-authentic 1-record-per-ordinal set
  // -- so excluding a record here can never mask a cardinality/topology/
  // identity defect, only carve a proven-inert record out of the claim/
  // attempt pairing requirement below. A record is excluded ONLY when ALL
  // of the following hold (see isAuthorityToleratedOrphan):
  //  1. state === "cancelled" (reconcileOrphanedReservationWithoutClaim()'s
  //     terminal state for a reservation that never became a real attempt);
  //  2. neither its claim nor its attempt exists anywhere in this scan's
  //     claim/attempt maps;
  //  3. a matching ProductionOrphanReservationToleranceAuthority record
  //     exists for its EXACT (project, stage, job, reservation, operation,
  //     attempt) tuple, whose content-fingerprint CAS still matches the
  //     reservation's current on-disk content, and whose own fresh
  //     claim/attempt re-scan (independent of this scan's maps) also finds
  //     nothing.
  // Condition 3 is never relaxed: a record satisfying only 1-2 stays a
  // survivor and must pair with a real claim+attempt below, exactly as if
  // this exclusion did not exist. This is deliberately no longer restricted
  // to the literal top of the range -- an orphan anywhere in the range
  // (including underneath a later, genuinely valid attempt) can now be
  // excluded, but only ever via an explicit, pre-issued, CAS-pinned
  // authority artifact -- never by position, and never by state alone.
  const survivors: Array<{ record: ProductionExecutionIdempotencyRecord;
    planned: ReturnType<typeof buildProductionPipelineExecutionIdentity> }> = [];
  const survivorOrdinalCounts = new Map<number, number>();
  for (const entry of lineagePlans.values()) {
    const tolerated = await isAuthorityToleratedOrphan(
      adapter, projectSlug, stage as ProductionStepKey, entry.record, claims, attempts, runtimeInput,
    );
    if (tolerated) continue;
    survivors.push(entry);
    survivorOrdinalCounts.set(entry.record.attempt, (survivorOrdinalCounts.get(entry.record.attempt) ?? 0) + 1);
  }
  // Defensive, fail-closed assertion only -- NOT the load-bearing duplicate
  // guard. The pre-exclusion cardinality/topology proof above already makes
  // it impossible for two `lineagePlans` entries to share an `attempt` value
  // by the time this loop runs: every record that ever reaches `survivors`
  // has already been proven (by raw record count + exact sorted position,
  // before any orphan was even considered for exclusion) to occupy a unique
  // ordinal slot. This check exists purely so that if a future change to
  // the proof above were ever weakened or bypassed, a duplicate surviving
  // into this loop still fails closed here instead of silently resolving --
  // under the current, correct proof above, this branch is expected to
  // never fire.
  for (const count of survivorOrdinalCounts.values()) {
    if (count > 1) return invalid("lineage-cardinality");
  }

  let latestAttempt: ProductionExecutionDurableAttemptRecord | undefined;
  let latestSurvivorOrdinal = 0;
  const lineageClaims = new Set<string>();
  const lineageAttempts = new Set<string>();
  for (const { record, planned } of survivors) {
    const claimVersions = claims.get(planned.claimId);
    if (!claimVersions) return invalid("claim-lineage-missing");
    const latestClaim = exactLatestLineageVersion(claimVersions, "version-contiguity");
    if (!latestClaim.ok) return invalid(latestClaim.boundary);
    const claim = latestClaim.value;
    if (!validateProductionExecutionDurableClaim(claim)) return invalid("claim-integrity");
    const claimBoundary = claimBindingBoundary(claim, record, planned);
    if (claimBoundary) return invalid(claimBoundary);
    lineageClaims.add(planned.claimId);

    const attemptVersions = attempts.get(planned.attemptId);
    if (!attemptVersions) return invalid("attempt-lineage-missing");
    const latest = exactLatestLineageVersion(attemptVersions, "version-contiguity");
    if (!latest.ok) return invalid(latest.boundary);
    const attempt = latest.value;
    if (!validateProductionExecutionDurableAttempt(attempt)) return invalid("attempt-integrity");
    const attemptBoundary = attemptBindingBoundary(attempt, record, planned);
    if (attemptBoundary) return invalid(attemptBoundary);
    lineageAttempts.add(planned.attemptId);
    if (record.attempt > latestSurvivorOrdinal) { latestSurvivorOrdinal = record.attempt; latestAttempt = attempt; }
  }

  if (!latestAttempt || lineageClaims.size !== survivors.length ||
    lineageAttempts.size !== survivors.length) return invalid("lineage-inventory");
  if (claims.size !== lineageClaims.size || attempts.size !== lineageAttempts.size) {
    return invalid("orphan-lineage");
  }
  const exactOrdinal = latestSurvivorOrdinal - 1;
  const nextRequired = latestAttempt.state === "failed" || latestAttempt.state === "cancelled" ||
    latestAttempt.state === "abandoned";
  const durableOrdinal = mode === "exact" ? exactOrdinal : nextRequired ? latestSurvivorOrdinal : exactOrdinal;
  if (expectedJobAttempt !== durableOrdinal) return invalid("expected-attempt-ordinal");
  return { status: "valid", durableOrdinal, maximumRecordAttempt: latestSurvivorOrdinal, latestAttempt };
}

/**
 * @internal The single, narrow gate that lets `classifyProductionDurableAttemptLineage`
 * exclude a cancelled, claimless, attemptless record from the pairing requirement --
 * position-independent, but authority-gated (see the call site's comment for the full
 * condition list). Reuses `resolveOrphanReservationTolerance` unmodified (the same
 * function `ProductionExecutionRecoveryBootstrap.ts`'s `loadReservationAuthority`
 * already consults for the sibling "no idempotency record at all" orphan shape) --
 * this file never re-derives the CAS/fresh-rescan discipline itself.
 */
async function isAuthorityToleratedOrphan(
  adapter: ProductionExecutionPersistenceAdapter,
  projectSlug: string,
  stage: ProductionStepKey,
  record: ProductionExecutionIdempotencyRecord,
  claims: ReadonlyMap<string, Array<{ version: number; value: ProductionExecutionDurableClaimRecord }>>,
  attempts: ReadonlyMap<string, Array<{ version: number; value: ProductionExecutionDurableAttemptRecord }>>,
  runtimeInput: RuntimeStorageInput | undefined,
): Promise<boolean> {
  if (record.state !== "cancelled") return false;
  const runType = durableLineageRunType(record.operation);
  if (!runType) return false;
  const planned = resolveHistoricalRecordIdentity(projectSlug, stage, record, runType);
  if (!planned || claims.has(planned.claimId) || attempts.has(planned.attemptId)) return false;
  const reservationRead = await adapter.read("reservation", record.identityFingerprint);
  if (reservationRead.status !== "found") return false;
  return resolveOrphanReservationTolerance(adapter, reservationRead.value, {
    projectSlug, stage, jobId: `${projectSlug}-${stage}`, runtimeInput,
  });
}

/**
 * @internal Position-independent, authority-gated exclusion of a record that
 * a separately-published ProductionSupersededDuplicateReservationAuthority
 * decision names as a superseded duplicate. Mutates `records` in place
 * (deletes excluded keys) -- called once, before `recordValues` is built, so
 * an excluded record never enters the cardinality/topology proof at all.
 *
 * Every step is independently fail-closed: any missing, ambiguous,
 * malformed, or now-stale fact leaves the record untouched. The decision's
 * own `proof` fields are NEVER trusted at face value -- every load-bearing
 * fact (candidate identity, canonical identity, generation ordering,
 * canonical's CURRENT active/max membership, candidate's CURRENT claim/
 * attempt absence) is independently re-derived here, fresh, from the SAME
 * `records`/`claims`/`attempts` this call already read -- never from
 * `decision.proof`. `decision.canonicalRecordId` is read only to confirm
 * that record is still part of this scan; it is never a candidate for
 * exclusion here -- the exclusion predicate below only ever matches
 * `candidateRecordId`.
 */
async function excludeSupersededDuplicateReservations(
  projectSlug: string,
  stage: ProductionStepKey,
  records: Map<string, Array<{ version: number; value: ProductionExecutionIdempotencyRecord }>>,
  claims: ReadonlyMap<string, Array<{ version: number; value: ProductionExecutionDurableClaimRecord }>>,
  attempts: ReadonlyMap<string, Array<{ version: number; value: ProductionExecutionDurableAttemptRecord }>>,
  runtimeInput: RuntimeStorageInput | undefined,
): Promise<void> {
  // Resolved ONCE, explicitly, rather than relying on each regeneration-store
  // call's own no-argument default: `resolveHistoricalRecordIdentity` (used
  // elsewhere in this file) calls `listRegenerationExecutionBindingCandidates`
  // with no context, which is only correct because every OTHER call site
  // relies on ambient/default runtime-root resolution. This function accepts
  // an explicit `runtimeInput` (the same parameter `classifyProductionDurableAttemptLineage`
  // already threads through for tolerance-authority lookups), so it must
  // resolve and pass a concrete context to every regeneration-store call it
  // makes -- otherwise an isolated caller's own runtime root would be
  // silently ignored here even though it is honored everywhere else in this
  // new code path.
  const context = resolveRuntimeStorageContext(runtimeInput ?? {});
  const toExclude: string[] = [];
  for (const candidateRecordId of [...records.keys()]) {
    const discovery = findSupersessionDecisionForCandidate(
      projectSlug, stage, candidateRecordId, context);
    if (discovery.status !== "found") continue; // "none"/"ambiguous"/"invalid" -> never excludes
    const decision = discovery.decision;

    // The decision's named canonical must still be part of THIS scan -- a
    // decision whose canonical has since vanished from view is stale/
    // unactionable, not evidence to act on.
    const canonicalVersions = records.get(decision.canonicalRecordId);
    if (!canonicalVersions) continue;
    const candidateVersions = records.get(candidateRecordId);
    if (!candidateVersions) continue;
    const candidateLatest = exactLatestLineageVersion(candidateVersions, "version-contiguity");
    const canonicalLatest = exactLatestLineageVersion(canonicalVersions, "version-contiguity");
    if (!candidateLatest.ok || !canonicalLatest.ok) continue;
    const candidateRecord = candidateLatest.value;
    const canonicalRecord = canonicalLatest.value;

    const candidateRunType = durableLineageRunType(candidateRecord.operation);
    const canonicalRunType = durableLineageRunType(canonicalRecord.operation);
    if (!candidateRunType || !canonicalRunType) continue;

    const candidateResolved = resolveDuplicateSupersessionRegeneration(
      projectSlug, stage, candidateRecord, candidateRunType, context);
    const canonicalResolved = resolveDuplicateSupersessionRegeneration(
      projectSlug, stage, canonicalRecord, canonicalRunType, context);
    // A record resolving to "no regeneration" is out of scope for this
    // mechanism (that shape is the existing single-record orphan-tolerance
    // exclusion's domain, not this one's) -- treated the same as any other
    // unresolvable identity: leave the record untouched.
    if (!candidateResolved || !canonicalResolved) continue;

    if (!(candidateResolved.binding.generationOrdinal < canonicalResolved.binding.generationOrdinal)) continue;
    if (!listRegenerationExecutionBindings(projectSlug, stage, context)
      .some((item) => item.binding.regenerationId === canonicalResolved.binding.regenerationId)) continue;

    // Fresh execution-asymmetry re-check -- the load-bearing safety
    // guarantee. Never exclude based on the decision's cached judgment
    // alone: this scan's OWN, just-read claims/attempts maps decide.
    if (claims.has(candidateResolved.planned.claimId) ||
      attempts.has(candidateResolved.planned.attemptId)) continue;
    if (candidateRecord.result || candidateRecord.failure) continue;

    toExclude.push(candidateRecordId);
  }
  for (const recordId of toExclude) records.delete(recordId);
}

/**
 * @internal Narrow sibling of `resolveHistoricalRecordIdentity`, used only by
 * `excludeSupersededDuplicateReservations`. Same non-circular, historically-
 * exhaustive search, but returns the matched `ProductionRegenerationBinding`
 * itself (needed for the generationOrdinal comparison and active/max-
 * generation membership check) alongside the built identity -- deliberately
 * a separate function rather than changing `resolveHistoricalRecordIdentity`'s
 * own return shape, which the two pre-existing call sites elsewhere in this
 * file depend on unchanged. Deliberately never tries the `undefined` ("no
 * regeneration") candidate: a record with no regeneration is out of scope
 * for this mechanism by construction, not merely unresolved.
 */
function resolveDuplicateSupersessionRegeneration(
  projectSlug: string,
  stage: ProductionStepKey,
  record: ProductionExecutionIdempotencyRecord,
  runType: ProductionAcceptanceStageExecutionIdentity["runType"],
  context: ReturnType<typeof resolveRuntimeStorageContext>,
): { readonly binding: ProductionRegenerationBinding;
    readonly planned: ReturnType<typeof buildProductionPipelineExecutionIdentity> } | undefined {
  const ordinal = record.attempt - 1;
  const jobId = `${projectSlug}-${stage}`;
  const candidateBindings = listRegenerationExecutionBindingCandidates(projectSlug, stage, context)
    .filter((item) => item.firstGlobalExecutionOrdinal <= ordinal)
    .map((item) => item.binding);
  for (const binding of candidateBindings) {
    const planned = buildProductionPipelineExecutionIdentity(
      { projectSlug, stage, runType, regeneration: binding },
      { id: jobId, attempts: ordinal },
    );
    if (planned.recordId === record.recordId) return { binding, planned };
  }
  return undefined;
}

function invalid(
  boundary: ProductionDurableAttemptLineageBoundary,
): ProductionDurableAttemptLineageClassification {
  return { status: "invalid", boundary };
}

async function readApplicableRecords(
  adapter: ProductionExecutionPersistenceAdapter,
  storage: AdapterBackedProductionExecutionDurableStorage,
  keys: readonly string[],
  projectSlug: string,
  stage: string,
  records: Map<string, Array<{ version: number; value: ProductionExecutionIdempotencyRecord }>>,
): Promise<number | ProductionDurableAttemptLineageBoundary> {
  let count = 0;
  for (const key of keys) {
    const read = await adapter.read("idempotency", key);
    if (read.status !== "found") {
      return read.status === "failed" && read.errorCode === "PERSISTENCE_RECORD_CORRUPT"
        ? "record-integrity"
        : "record-read";
    }
    const record = read.value;
    if (record.projectSlug !== projectSlug || record.stage !== stage) continue;
    count += 1;
    if (!storage.validateRecord(record as ProductionExecutionDurableRecord).ok) {
      return "record-integrity";
    }
    if (!Number.isSafeInteger(record.attempt) || record.attempt < 1) {
      return "record-ordinal-format";
    }
    const parsed = parseVersionedLineageKey(key);
    if (!parsed || parsed.identity !== record.recordId ||
      parsed.version !== record.integrity.version) return "record-key-binding";
    const versions = records.get(record.recordId) ?? [];
    versions.push({ version: parsed.version, value: record });
    records.set(record.recordId, versions);
  }
  return count;
}

async function readApplicableClaims(
  adapter: ProductionExecutionPersistenceAdapter,
  keys: readonly string[],
  claimIds: ReadonlySet<string>,
  claims: Map<string, Array<{ version: number; value: ProductionExecutionDurableClaimRecord }>>,
): Promise<ProductionDurableAttemptLineageBoundary | undefined> {
  for (const key of keys) {
    const read = await adapter.read("claim", key);
    if (read.status !== "found") {
      return read.status === "failed" && read.errorCode === "PERSISTENCE_RECORD_CORRUPT"
        ? "claim-integrity"
        : "claim-read";
    }
    const claim = read.value;
    if (!claimIds.has(claim.identity.claimId)) continue;
    const parsed = parseVersionedLineageKey(key);
    if (!parsed || parsed.identity !== claim.identity.claimId ||
      parsed.version !== claim.claimVersion) return "claim-key-binding";
    const versions = claims.get(claim.identity.claimId) ?? [];
    versions.push({ version: parsed.version, value: claim });
    claims.set(claim.identity.claimId, versions);
  }
  return undefined;
}

async function readApplicableAttempts(
  adapter: ProductionExecutionPersistenceAdapter,
  keys: readonly string[],
  attemptIds: ReadonlySet<string>,
  attempts: Map<string, Array<{ version: number; value: ProductionExecutionDurableAttemptRecord }>>,
): Promise<ProductionDurableAttemptLineageBoundary | undefined> {
  for (const key of keys) {
    const read = await adapter.read("attempt", key);
    if (read.status !== "found") {
      return read.status === "failed" && read.errorCode === "PERSISTENCE_RECORD_CORRUPT"
        ? "attempt-integrity"
        : "attempt-read";
    }
    const attempt = read.value;
    if (!attemptIds.has(attempt.identity.attemptId)) continue;
    const parsed = parseVersionedLineageKey(key);
    if (!parsed || parsed.identity !== attempt.identity.attemptId ||
      parsed.version !== attempt.attemptVersion) return "attempt-key-binding";
    const versions = attempts.get(attempt.identity.attemptId) ?? [];
    versions.push({ version: parsed.version, value: attempt });
    attempts.set(attempt.identity.attemptId, versions);
  }
  return undefined;
}

/**
 * Prospective ID-guessing for the initial claim/attempt file scan, so a
 * genuine orphan (a claim/attempt with NO matching idempotency record at
 * all) is still detected even when `records` is empty. Unlike the old
 * version of this function, it is exhaustive over every regeneration binding
 * that was EVER historically eligible for each ordinal (via
 * `listRegenerationExecutionBindingCandidates`), not just the current
 * maximum generation -- so it casts the same wide net regardless of which
 * generation exists today. `runType`/`undefined` do not affect claimId/
 * attemptId (only `executionFingerprint` depends on `runType`), so a fixed
 * placeholder is fine here.
 */
function buildLineagePlans(projectSlug: string, stage: ProductionStepKey, maximumOrdinal: number) {
  const claimIds = new Set<string>();
  const attemptIds = new Set<string>();
  const candidateBindings = listRegenerationExecutionBindingCandidates(projectSlug, stage);
  for (let ordinal = 0; ordinal <= maximumOrdinal; ordinal += 1) {
    const runType = ordinal === 0 ? "initial" : "retry";
    const eligible = candidateBindings
      .filter((item) => item.firstGlobalExecutionOrdinal <= ordinal)
      .map((item) => item.binding);
    for (const regeneration of [undefined, ...eligible]) {
      const planned = buildProductionPipelineExecutionIdentity(
        { projectSlug, stage, runType, regeneration },
        { id: `${projectSlug}-${stage}`, attempts: ordinal },
      );
      claimIds.add(planned.claimId);
      attemptIds.add(planned.attemptId);
    }
  }
  return { claimIds, attemptIds };
}

/**
 * Resolves the identity that must have produced `record` at the time it was
 * created, by searching every regeneration binding that was historically
 * eligible for its ordinal (`firstGlobalExecutionOrdinal <= record.attempt -
 * 1`) -- across the FULL history, not filtered down to the current maximum
 * generation -- plus the "no regeneration" case for legacy pre-regeneration
 * records. Accepts the first (and, by construction, only) candidate whose
 * computed `recordId` matches `record.recordId` exactly. Returns `undefined`
 * if no candidate matches (record-canonical-id boundary, same as before this
 * change for a genuinely malformed/foreign record).
 *
 * This is intentionally NOT derived from `record`'s own recordId (unlike
 * `deriveCanonicalIdentityFromRecord`): the whole point of this check is to
 * independently prove the record's `recordId` really was produced by an
 * authorized regeneration lineage, which a self-referential derivation could
 * never disprove.
 */
function resolveHistoricalRecordIdentity(
  projectSlug: string,
  stage: ProductionStepKey,
  record: ProductionExecutionIdempotencyRecord,
  runType: ProductionAcceptanceStageExecutionIdentity["runType"],
): ReturnType<typeof buildProductionPipelineExecutionIdentity> | undefined {
  const ordinal = record.attempt - 1;
  const jobId = `${projectSlug}-${stage}`;
  const candidateBindings = listRegenerationExecutionBindingCandidates(projectSlug, stage)
    .filter((item) => item.firstGlobalExecutionOrdinal <= ordinal)
    .map((item) => item.binding);
  for (const regeneration of [undefined, ...candidateBindings]) {
    const planned = buildProductionPipelineExecutionIdentity(
      { projectSlug, stage, runType, regeneration },
      { id: jobId, attempts: ordinal },
    );
    if (planned.recordId === record.recordId) return planned;
  }
  return undefined;
}

function recordBindingBoundary(
  record: ProductionExecutionIdempotencyRecord,
  planned: ReturnType<typeof buildProductionPipelineExecutionIdentity>,
): ProductionDurableAttemptLineageBoundary | undefined {
  if (record.recordId !== planned.recordId) return "record-canonical-id";
  if (record.requestId !== planned.requestId) return "record-request-binding";
  if (record.idempotencyKey !== planned.idempotencyKey) return "record-idempotency-binding";
  if (record.executionFingerprint !== planned.executionFingerprint) {
    return "record-execution-fingerprint";
  }
  return undefined;
}

function claimBindingBoundary(
  claim: ProductionExecutionDurableClaimRecord,
  record: ProductionExecutionIdempotencyRecord,
  planned: ReturnType<typeof buildProductionPipelineExecutionIdentity>,
): ProductionDurableAttemptLineageBoundary | undefined {
  if (claim.identity.claimId !== planned.claimId) return "claim-canonical-id";
  if (claim.identity.recordId !== planned.recordId) return "claim-record-binding";
  if (claim.identity.reservationId !== record.identityFingerprint) return "claim-reservation-binding";
  if (claim.identity.requestId !== planned.requestId) return "claim-request-binding";
  if (claim.identity.idempotencyKey !== planned.idempotencyKey) return "claim-idempotency-binding";
  if (claim.identity.leaseId !== planned.leaseId) return "claim-lease-binding";
  if (claim.identity.executionFingerprint !== planned.executionFingerprint) {
    return "claim-execution-fingerprint";
  }
  if (claim.identity.operation !== undefined && claim.identity.operation !== record.operation) {
    return "claim-record-operation-binding";
  }
  return undefined;
}

function attemptBindingBoundary(
  attempt: ProductionExecutionDurableAttemptRecord,
  record: ProductionExecutionIdempotencyRecord,
  planned: ReturnType<typeof buildProductionPipelineExecutionIdentity>,
): ProductionDurableAttemptLineageBoundary | undefined {
  if (attempt.identity.attemptId !== planned.attemptId) return "attempt-canonical-id-topology";
  if (attempt.identity.recordId !== planned.recordId) return "attempt-record-binding";
  if (attempt.identity.claimId !== planned.claimId) return "attempt-claim-binding";
  if (attempt.identity.leaseId !== planned.leaseId) return "attempt-lease-binding";
  if (attempt.identity.reservationId !== record.identityFingerprint) {
    return "attempt-reservation-binding";
  }
  if (attempt.identity.requestId !== planned.requestId) return "attempt-request-binding";
  if (attempt.identity.idempotencyKey !== planned.idempotencyKey) {
    return "attempt-idempotency-binding";
  }
  if (attempt.identity.executionFingerprint !== planned.executionFingerprint) {
    return "attempt-execution-fingerprint";
  }
  return durableAttemptOperationBindingBoundary(attempt, record);
}

function durableAttemptOperationBindingBoundary(
  attempt: ProductionExecutionDurableAttemptRecord,
  record: ProductionExecutionIdempotencyRecord,
): ProductionDurableAttemptLineageBoundary | undefined {
  const operation = attempt.identity.operation;
  if (Object.prototype.hasOwnProperty.call(attempt.identity, "operation")) {
    if (typeof operation !== "string") return "attempt-operation-presence";
    return operation === record.operation ? undefined : "attempt-record-operation-binding";
  }
  return isProductionExecutionTerminalAttemptState(attempt.state) &&
    isProductionExecutionTerminalDurableRecordState(record.state)
    ? undefined
    : "terminal-legacy-operation-compatibility";
}

function durableLineageRunType(
  operation: string,
): ProductionAcceptanceStageExecutionIdentity["runType"] | undefined {
  const match = /^pipeline\.stage\.(initial|resume|retry)$/.exec(operation);
  return match ? match[1] as ProductionAcceptanceStageExecutionIdentity["runType"] : undefined;
}

function parseVersionedLineageKey(key: string): { identity: string; version: number } | undefined {
  const match = /^(.*)-v([1-9][0-9]*)$/.exec(key);
  if (!match) return undefined;
  const version = Number(match[2]);
  return Number.isSafeInteger(version) ? { identity: match[1], version } : undefined;
}

function exactLatestLineageVersion<T>(
  versions: Array<{ version: number; value: T }>,
  boundary: ProductionDurableAttemptLineageBoundary,
): { ok: true; value: T } | { ok: false; boundary: ProductionDurableAttemptLineageBoundary } {
  versions.sort((left, right) => left.version - right.version);
  for (let index = 0; index < versions.length; index += 1) {
    if (versions[index].version !== index + 1) return { ok: false, boundary };
  }
  return { ok: true, value: versions[versions.length - 1].value };
}
