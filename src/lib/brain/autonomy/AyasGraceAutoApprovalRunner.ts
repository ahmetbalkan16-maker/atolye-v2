import { createAyasApprovalInboxStore, isAyasProposalApprovalReady, type AyasApprovalInboxHandle } from "./AyasApprovalInboxStore";
import { createAyasCodeChangeStore, ayasCodeBuildDecisionOpen, decideAyasCodeChangeApply, type AyasCodeChangeStore } from "./AyasCodeChangeStore";
import { ayasCodeBuildHash, type AyasCodeBuild } from "./AyasCodeChangeLane";
import {
  ayasGraceFileExclusions, ayasGraceKey, ayasGraceProvenance, createAyasGraceStore, isAyasGracePublicationGateOpen, isAyasGraceV3File,
  planAyasGraceTick, resolveAyasGracePolicy, resolveAyasGraceRoot, sealAyasGraceReady, withAyasGraceEntry,
  type AyasGraceCandidate, type AyasGraceEntry, type AyasGraceOutcome, type AyasGracePolicy, type AyasGraceStore, type AyasGraceWait,
} from "./AyasGraceAutoApproval";
import { createAyasMicroBatchStore, type AyasMicroBatchStoreHandle } from "./AyasMicroBatch";
import { AYAS_PATCH_ARTIFACT_MUTATION_KIND } from "./AyasNovelPatchDiscovery";
import { mintAyasOwnerGraceAdmission, type AyasOwnerAdmission, type AyasOwnerAdmissionAction, type AyasOwnerAdmissionSubject } from "./AyasOwnerApprovalAdmission";
import { performAyasOwnerPublication, type AyasOwnerPublicationRequest } from "./AyasOwnerPublicationWorker";
import { isAyasInternalReviewDecisionReason } from "./AyasOwnerApprovalProvenance";
import { classifyAyasRuntimeImpact } from "./AyasProposalRuntimeImpact";
import { createAyasUpdateApprovalStore, decideAyasUpdateApply, listAyasUpdateApplyDecisions, listAyasUpdateApprovals, type AyasUpdateApprovalStore } from "./AyasUpdateApprovalStore";
import { createAyasUpdateTrialStore, isAyasUpdateTrialIntact, type AyasUpdateTrialStore } from "./AyasUpdateTrialStore";

/**
 * The executor side of grace auto-approval (owner instruction 2026-11-19, see AyasGraceAutoApproval). Called once per
 * update-executor run, after the owner's own clicks were carried out and while the executor holds its lock on a clean
 * tree. It gathers every item that waits for one of the four one-click approvals, lets the pure planner record ready
 * times and pick at most one due item, and approves that one through the very service the owner's click reaches:
 *   - micro-batch / proposal: `performAyasOwnerPublication`, the worker's own call (strict-admission stores, Package C,
 *     Graphify per item and after, TypeScript, exact staging, one commit, push, post-publication closure);
 *   - developer build: `decideAyasCodeChangeApply` (the build re-derived from the queue, its hash, the lane refusals),
 *     after which the existing CODE_APPLY job carries it out on a later run;
 *   - update trial: `decideAyasUpdateApply` (PASSED on this HEAD, artifacts intact, approval still active), after which
 *     the existing APPLY job carries it out.
 * The admission is a standing-grace one (`mintAyasOwnerGraceAdmission`), bound to the same id + hash. Live publish is
 * not part of it: the owner's batched go-live rule (AYAS_AUTO_LIVE_PUBLISH=0) decides that, in the executor.
 */

export interface AyasGraceRunnerDeps {
  readonly repoRoot: string;
  /** The canonical HEAD the executor just read. */
  readonly head: string;
  /** The access key the executor verified owner seals with. */
  readonly key: string;
  readonly env?: Record<string, string | undefined>;
  readonly now?: () => Date;
  readonly dryRun?: boolean;
  /** The development queue's ready builds (jobId → build), as the executor reads them for CODE_APPLY. */
  readonly codeBuilds: () => Promise<ReadonlyMap<string, AyasCodeBuild>>;
  /** Notes a recorded build decision on the job card, like the owner's click does. */
  readonly reportCode?: (jobId: string, reasons: readonly string[]) => Promise<void>;
  /** True while a V3 production runs or waits. */
  readonly v3Busy: () => Promise<boolean>;
  readonly ownerChatAt?: string;
  /* Test seams. Production uses the canonical stores under repoRoot and the worker's own publication call. */
  readonly store?: AyasGraceStore;
  readonly inbox?: AyasApprovalInboxHandle;
  readonly batchStore?: AyasMicroBatchStoreHandle;
  readonly codeStore?: AyasCodeChangeStore;
  readonly updateApprovals?: AyasUpdateApprovalStore;
  readonly trials?: AyasUpdateTrialStore;
  readonly publish?: (request: AyasOwnerPublicationRequest) => Promise<unknown>;
  readonly publicationActive?: () => boolean;
}

export type AyasGraceTickReport =
  | { readonly acted: false; readonly wait: AyasGraceWait | "DRY_RUN"; readonly waiting: number; readonly excluded: number; readonly nextDueAt?: string; readonly due?: string }
  | { readonly acted: true; readonly status: "GRACE_APPROVED" | "GRACE_FAILED"; readonly kind: AyasGraceCandidate["subject"]["kind"]; readonly id: string; readonly provenance: string; readonly outcome: AyasGraceOutcome };

const latest = (times: readonly (string | undefined)[]): string | undefined => times.filter((t): t is string => typeof t === "string").sort().at(-1);

/** Every item waiting for a one-click owner approval right now, with the reasons it may never be approved without the owner. */
export async function collectAyasGraceCandidates(deps: AyasGraceRunnerDeps): Promise<readonly AyasGraceCandidate[]> {
  const out: AyasGraceCandidate[] = [];
  const batchStore = deps.batchStore ?? createAyasMicroBatchStore();
  const inbox = deps.inbox ?? createAyasApprovalInboxStore();
  const codeStore = deps.codeStore ?? createAyasCodeChangeStore();
  const approvals = deps.updateApprovals ?? createAyasUpdateApprovalStore();
  const trials = deps.trials ?? createAyasUpdateTrialStore();

  const batches = batchStore.load();
  for (const batch of batches.batches) {
    // A batch on an older HEAD is not ready: Package C would refuse it, and its rebased version is a new item.
    if (batch.status !== "READY_FOR_REVIEW" || batch.baseHead !== deps.head) continue;
    const impact = classifyAyasRuntimeImpact(batch.exactFilesUnion);
    out.push({
      subject: { kind: "micro-batch", id: batch.batchId, hash: batch.batchHash },
      title: `Küçük geliştirme paketi (${batch.items.length} öğe)`,
      exclusions: [...(impact.publishable ? [] : [`çalışma etkisi ${impact.impactClass}: tek tıkla yayınlanamaz`]), ...ayasGraceFileExclusions(batch.exactFilesUnion)],
      touchedAt: latest(batches.decisions.filter((d) => d.batchId === batch.batchId && d.batchHash === batch.batchHash).map((d) => d.decidedAt)),
      v3: batch.exactFilesUnion.some(isAyasGraceV3File),
    });
  }

  const state = inbox.load();
  for (const proposal of state.proposals) {
    if (proposal.status !== "PENDING" || proposal.baseHead !== deps.head) continue;
    const decisions = state.decisions.filter((d) => d.proposalId === proposal.proposalId && d.proposalHash === proposal.proposalHash);
    const exclusions: string[] = [];
    if (proposal.safetyClassification !== "SAFE") exclusions.push(`güvenlik sınıfı ${proposal.safetyClassification}: yalnız sen onaylayabilirsin`);
    if (proposal.mutationKind !== AYAS_PATCH_ARTIFACT_MUTATION_KIND || !proposal.patchArtifactId) exclusions.push("yalnız donmuş yama dosyalı öneriler kendiliğinden onaylanır");
    if (proposal.exactPatchSafetyProof) exclusions.push("incelenmiş tam yama yalnız yerel yürütülür");
    if (!isAyasProposalApprovalReady(proposal)) exclusions.push("öneri bilgisi eksik");
    // The owner said "later" or "no" to this exact proposal once: it never goes ahead without the owner.
    if (decisions.some((d) => (d.decision === "LATER" || d.decision === "REJECT") && !isAyasInternalReviewDecisionReason(d.reason))) exclusions.push("bu öneriyi daha önce ertelemiş ya da reddetmiştin");
    const impact = classifyAyasRuntimeImpact(proposal.exactFiles);
    if (!impact.publishable) exclusions.push(`çalışma etkisi ${impact.impactClass}: tek tıkla yayınlanamaz`);
    exclusions.push(...ayasGraceFileExclusions(proposal.exactFiles));
    out.push({
      subject: { kind: "proposal", id: proposal.proposalId, hash: proposal.proposalHash },
      title: proposal.objective, exclusions, touchedAt: latest(decisions.map((d) => d.decidedAt)), v3: proposal.exactFiles.some(isAyasGraceV3File),
    });
  }

  const codeState = codeStore.load();
  for (const [jobId, build] of await deps.codeBuilds()) {
    const hash = ayasCodeBuildHash(build);
    if (!ayasCodeBuildDecisionOpen(codeState, jobId, hash)) continue;
    const files = build.files.map((file) => file.path);
    out.push({ subject: { kind: "code-apply", id: jobId, hash }, title: build.title, exclusions: [...ayasGraceFileExclusions(files)], v3: files.some(isAyasGraceV3File) });
  }

  const approvalState = approvals.load();
  const activeApprovals = new Set(listAyasUpdateApprovals({ decisions: approvalState.decisions, radar: [], repoRoot: deps.repoRoot }).filter((v) => v.status === "WAITING").map((v) => v.decisionId));
  const decided = new Set(listAyasUpdateApplyDecisions(approvalState).map((d) => d.trialId));
  for (const trial of trials.load().trials) {
    if (trial.status !== "PASSED" || !trial.trialHash || trial.baseHead !== deps.head || decided.has(trial.trialId) || !activeApprovals.has(trial.approvalDecisionId)) continue;
    if (!isAyasUpdateTrialIntact(trial, trials.readArtifacts(trial.trialId))) continue;
    const exclusions: string[] = [];
    if ((trial.vulnerabilities?.introduced.length ?? 0) > 0) exclusions.push(`yeni bilinen güvenlik açığı getiriyor (${trial.vulnerabilities!.introduced.length})`);
    out.push({
      subject: { kind: "update-apply", id: trial.trialId, hash: trial.trialHash },
      title: `${trial.toolName} ${trial.installedVersion} → ${trial.targetVersion}`, exclusions, v3: /remotion-v3/.test(trial.target),
    });
  }
  return out;
}

const OUTCOME_CODE = (value: unknown): AyasGraceOutcome => {
  if (value && typeof value === "object" && "ok" in value) {
    const v = value as { ok: boolean; code?: unknown; commitSha?: unknown; message?: unknown };
    return { ok: v.ok === true, ...(typeof v.code === "string" ? { code: v.code } : {}), ...(typeof v.commitSha === "string" ? { commitSha: v.commitSha } : {}),
      ...(typeof v.message === "string" && v.ok !== true ? { detail: v.message.slice(0, 300) } : {}) };
  }
  return { ok: false, code: "GRACE_UNEXPECTED_RESULT" };
};

/**
 * One grace tick: plan, then approve at most one due item through its own service. Writes the ledger before and
 * after the call (APPROVING, then APPROVED or FAILED), so an interrupted run is never retried blindly: the next run
 * marks a left-over APPROVING entry FAILED and the item waits for the owner.
 */
export async function runAyasGraceAutoApprovalTick(deps: AyasGraceRunnerDeps): Promise<AyasGraceTickReport> {
  const now = deps.now ?? (() => new Date());
  const policy: AyasGracePolicy = resolveAyasGracePolicy(deps.env ?? process.env);
  const store = deps.store ?? createAyasGraceStore({ rootDir: resolveAyasGraceRoot(deps.repoRoot) });
  let state = store.load();
  // The executor holds its lock, so an APPROVING entry belongs to a run that ended mid-call.
  for (const entry of state.entries.filter((e) => e.status === "APPROVING")) {
    state = withAyasGraceEntry(state, { ...entry, status: "FAILED", updatedAt: now().toISOString(), outcome: { ok: false, code: "GRACE_INTERRUPTED", detail: "onay yarıda kesildi; karar sende" } }, "FAILED", "yarıda kesildi");
  }
  const candidates = policy.enabled ? await collectAyasGraceCandidates(deps) : [];
  const plan = planAyasGraceTick({
    policy, now: now().toISOString(), state, holds: store.loadHolds().holds, candidates,
    sealReady: (subject, readyAt) => sealAyasGraceReady(deps.key, subject, readyAt),
    ...(deps.ownerChatAt ? { ownerChatAt: deps.ownerChatAt } : {}),
    v3Busy: candidates.some((c) => c.v3) ? await deps.v3Busy() : false,
    publicationActive: (deps.publicationActive ?? (() => isAyasGracePublicationGateOpen(deps.repoRoot)))(),
  });
  const waiting = plan.state.entries.filter((e) => e.status === "WAITING").length;
  const excluded = plan.state.entries.filter((e) => e.status === "EXCLUDED").length;
  if (deps.dryRun) return { acted: false, wait: "DRY_RUN", waiting, excluded, ...(plan.nextDueAt ? { nextDueAt: plan.nextDueAt } : {}), ...(plan.approve ? { due: ayasGraceKey(plan.approve.candidate.subject) } : {}) };
  store.save(plan.state);
  if (!plan.approve) return { acted: false, wait: plan.wait ?? "NOTHING_DUE", waiting, excluded, ...(plan.nextDueAt ? { nextDueAt: plan.nextDueAt } : {}) };

  const { candidate, entry } = plan.approve;
  // The owner's hold may have landed while this run planned: read it once more right before acting.
  if (store.loadHolds().holds.some((h) => h.key === entry.key)) return { acted: false, wait: "NOTHING_DUE", waiting, excluded };
  const startedMs = now().getTime();
  const elapsedMs = startedMs - Date.parse(entry.readyAt);
  const provenance = ayasGraceProvenance(elapsedMs, entry.readyAt);
  let current = withAyasGraceEntry(plan.state, { ...entry, status: "APPROVING", updatedAt: new Date(startedMs).toISOString(), provenance }, "APPROVING", provenance);
  store.save(current);

  const mint = (action: AyasOwnerAdmissionAction, subject: AyasOwnerAdmissionSubject): AyasOwnerAdmission =>
    mintAyasOwnerGraceAdmission({ key: deps.key, action, subject, readyAt: entry.readyAt, graceMs: policy.graceMs, now: now().getTime() });
  let outcome: AyasGraceOutcome;
  try {
    outcome = await approveOne(candidate, deps, mint, provenance, () => now().toISOString());
  } catch (error) {
    // A service refusal keeps its own code (BATCH_HASH_MISMATCH, CODE_APPLY_BUILD_CHANGED, UPDATE_APPLY_TRIAL_STALE, ...).
    const code = error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : "GRACE_APPROVAL_FAILED";
    outcome = { ok: false, code, detail: (error instanceof Error ? error.message : String(error)).slice(0, 300) };
  }
  const finishedAt = now().toISOString();
  const done: AyasGraceEntry = { ...entry, status: outcome.ok ? "APPROVED" : "FAILED", updatedAt: finishedAt, provenance, outcome, ...(outcome.ok ? { approvedAt: finishedAt } : {}) };
  current = withAyasGraceEntry(store.load(), done, outcome.ok ? "APPROVED" : "FAILED", outcome.ok ? provenance : `${outcome.code ?? "FAILED"} ${outcome.detail ?? ""}`.trim());
  store.save(current);
  return { acted: true, status: outcome.ok ? "GRACE_APPROVED" : "GRACE_FAILED", kind: candidate.subject.kind, id: candidate.subject.id, provenance, outcome };
}

async function approveOne(
  candidate: AyasGraceCandidate,
  deps: AyasGraceRunnerDeps,
  mint: (action: AyasOwnerAdmissionAction, subject: AyasOwnerAdmissionSubject) => AyasOwnerAdmission,
  provenance: string,
  nowIso: () => string,
): Promise<AyasGraceOutcome> {
  const { kind, id, hash } = candidate.subject;
  const publish = deps.publish ?? performAyasOwnerPublication;
  switch (kind) {
    case "micro-batch":
      // The same two admissions the owner's click mints, in the same order, for the same worker call.
      return OUTCOME_CODE(await publish({
        lane: "micro-batch", batchId: id, batchHash: hash,
        ownerAdmission: mint("batchOnaylaVeUygula", { kind: "micro-batch", batchId: id, batchHash: hash, decision: "APPROVE" }),
        executionOwnerAdmission: mint("executeAyasApprovedMicroBatch", { kind: "micro-batch", batchId: id, batchHash: hash, decision: "EXECUTE" }),
      }));
    case "proposal":
      return OUTCOME_CODE(await publish({
        lane: "proposal", proposalId: id, proposalHash: hash,
        ownerAdmission: mint("proposalOnaylaVeUygula", { kind: "proposal", proposalId: id, proposalHash: hash, decision: "APPROVE" }),
        executionOwnerAdmission: mint("executeAyasApprovedProposal", { kind: "proposal", proposalId: id, proposalHash: hash, decision: "EXECUTE" }),
      }));
    case "code-apply": {
      const record = await decideAyasCodeChangeApply({ jobId: id, buildHash: hash }, {
        store: deps.codeStore ?? createAyasCodeChangeStore(),
        build: async () => (await deps.codeBuilds()).get(id),
        admit: async (subject) => mint("applyAyasCodeChange", subject), now: nowIso,
      });
      await deps.reportCode?.(id, [provenance]).catch(() => undefined);
      return { ok: true, code: "CODE_APPLY_DECIDED", detail: record.decisionId };
    }
    case "update-apply": {
      const record = await decideAyasUpdateApply({ trialId: id, trialHash: hash }, {
        approvals: deps.updateApprovals ?? createAyasUpdateApprovalStore(), trials: deps.trials ?? createAyasUpdateTrialStore(), head: deps.head,
        admit: async (subject) => mint("applyAyasUpdate", subject), now: nowIso,
      });
      return { ok: true, code: "UPDATE_APPLY_DECIDED", detail: record.decisionId };
    }
  }
}
