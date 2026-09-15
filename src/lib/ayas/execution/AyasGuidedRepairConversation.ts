import {
  createAyasGuidedRepairService, createAyasRepairProposal, diagnoseAyasRepair,
  type AyasGuidedRepairDeps, type AyasPatch, type AyasRepairAuthorization,
  type AyasRepairBounds, type AyasRepairEvidence, type AyasRepairOperation,
  type AyasRepairProposal, type AyasValidationAction,
} from "./AyasGuidedRepair";
import { runAyasDeveloperWorkflow, type AyasDeveloperWorkflow, type AyasWorkflowCheckpointPoint } from "./AyasDeveloperWorkflow";
import { planAyasDeveloperWorkflow } from "./AyasWorkflowPlanner";

export type AyasRepairProgress = "İnceliyorum" | "Onay bekleniyor" | "Düzeltme uygulanıyor" | "Final doğrulama" | "Tamamlandı" | "blocked";
export interface AyasGuidedDiagnosisPlan {
  readonly rootCause: string; readonly reproduced: boolean; readonly evidence: readonly AyasRepairEvidence[];
  readonly graphifyFindings: readonly string[]; readonly patches: readonly AyasPatch[]; readonly remediationPatches?: readonly AyasPatch[];
  readonly operationClasses: readonly AyasRepairOperation[]; readonly validationActions: readonly AyasValidationAction[];
  readonly expectedResult: string; readonly risk: string; readonly exclusions?: readonly string[]; readonly bounds: AyasRepairBounds;
}
type RepairOutcome = Awaited<ReturnType<ReturnType<typeof createAyasGuidedRepairService>["apply"]>>;
export interface AyasRepairConversationResult { readonly progress: AyasRepairProgress; readonly text: string; readonly proposal?: AyasRepairProposal; readonly authorization?: AyasRepairAuthorization; readonly repair?: RepairOutcome; }
export interface AyasGuidedRepairConversationDeps extends AyasGuidedRepairDeps {
  readonly diagnoseTurn: (input: { text: string; turnId: string; workspaceId: string }) => Promise<AyasGuidedDiagnosisPlan | { readonly clarification: string } | null>;
  readonly proposalTtlMs?: number;
  /**
   * Durable Workflow Persistence sprint — an OPTIONAL, additive hook. Called
   * every time `pending` changes (set, revised, or cleared) with the NEW
   * value (`undefined` on clear). A durable-session adapter uses this to
   * persist the conversation's pending state; omitting it is byte-for-byte
   * the pre-existing in-memory-only behaviour. Never awaited — a slow or
   * failing persistence write is the adapter's own concern, never blocks or
   * fails the conversation turn itself.
   */
  readonly onPendingChange?: (pending: AyasGuidedRepairPendingState | undefined) => void;
  /** Threaded straight into every `runAyasDeveloperWorkflow` call this conversation makes — see that function's own `onCheckpoint` doc comment. Optional/additive. */
  readonly onWorkflowCheckpoint?: (workflow: AyasDeveloperWorkflow, point: AyasWorkflowCheckpointPoint) => void | Promise<void>;
}
export interface AyasGuidedRepairPendingState { readonly proposal: AyasRepairProposal; readonly patches: readonly AyasPatch[]; readonly remediationPatches?: readonly AyasPatch[]; readonly workflow?: AyasDeveloperWorkflow; readonly createdAtMs: number; }
type PendingRepair = AyasGuidedRepairPendingState;
const APPROVAL_RE = /^(?:onaylıyorum|onayliyorum|onayla|evet,? uygula)\.?$/iu;
const REVISION_RE = /^ikinci dosyaya dokunma\.?$/iu;

/** Session-scoped product orchestrator. Evidence is untrusted data; only an
 * exact current user utterance can approve this instance's one pending plan. */
export class AyasGuidedRepairConversation {
  private pending?: PendingRepair;
  private readonly service: ReturnType<typeof createAyasGuidedRepairService>;
  private readonly now: () => Date;
  private readonly proposalTtlMs: number;
  constructor(private readonly deps: AyasGuidedRepairConversationDeps) {
    this.service = createAyasGuidedRepairService(deps); this.now = deps.now ?? (() => new Date()); this.proposalTtlMs = deps.proposalTtlMs ?? 10 * 60 * 1000;
  }
  private setPending(value: PendingRepair | undefined): void { this.pending = value; this.deps.onPendingChange?.(value); }
  getPendingProposal(): AyasRepairProposal | undefined { return this.pending?.proposal; }
  revokePending(): void { this.setPending(undefined); }
  /** Durable Workflow Persistence sprint — re-hydrates in-memory pending state recovered from durable storage. Never invoked mid-turn by this class itself; a durable session adapter calls it once, before the first `handleUserTurn` on a recovered session. */
  restorePending(pending: PendingRepair): void { this.pending = pending; }

  /**
   * Criterion 37 product wiring: every product-created workflow crosses the
   * schema-bound planner.  Keeping this helper inside the conversation makes
   * the two creation sites share one fail-closed contract and leaves the
   * planner with no execution authority of its own.
   */
  private planRepairWorkflow(goal: string, proposal: AyasRepairProposal, patches: readonly AyasPatch[]): AyasDeveloperWorkflow | undefined {
    const planned = planAyasDeveloperWorkflow({
      kind: "automatic-repair",
      goal,
      steps: [{ id: "authorized-repair", kind: "repair", proposal, patches, expectedEvidence: proposal.expectedResult }],
    });
    return planned.ok ? planned.workflow : undefined;
  }

  async handleUserTurn(text: string, turnId: string, workspaceId: string): Promise<AyasRepairConversationResult> {
    const normalized = text.trim();
    if (APPROVAL_RE.test(normalized)) return this.approveCurrentTurn(turnId, workspaceId);
    if (REVISION_RE.test(normalized) && this.pending) return this.revisePending();
    const plan = await this.deps.diagnoseTurn({ text: normalized, turnId, workspaceId });
    if (plan && "clarification" in plan) return { progress: "İnceliyorum", text: plan.clarification };
    if (!plan || plan.patches.length === 0) return { progress: "İnceliyorum", text: "Güvenli bir repair planı oluşturmak için dosya ve hata kanıtı gerekli." };
    const diagnosis = diagnoseAyasRepair({ issue: normalized, workspaceId, rootCause: plan.rootCause, reproduced: plan.reproduced, evidence: plan.evidence, graphifyFindings: plan.graphifyFindings });
    const proposal = createAyasRepairProposal({ issueFingerprint: diagnosis.issueFingerprint, workspaceId, rootCauseStatus: diagnosis.rootCauseStatus, rootCause: diagnosis.rootCause, evidence: diagnosis.evidence, graphifyFindings: diagnosis.graphifyFindings, approvedFiles: [...new Set(plan.patches.map((patch) => patch.filePath))], operationClasses: plan.operationClasses, validationActions: plan.validationActions, forbiddenOperations: ["shell", "delete", "git", "package", "production", "secrets"], exclusions: plan.exclusions ?? ["unrelated subsystems"], expectedResult: plan.expectedResult, risk: plan.risk, bounds: plan.bounds });
    const workflow = plan.remediationPatches ? undefined : this.planRepairWorkflow(normalized, proposal, plan.patches);
    if (!plan.remediationPatches && !workflow) return { progress: "blocked", text: "Repair workflow planner tarafından güvenli biçimde oluşturulamadı.", proposal };
    if (workflow) await runAyasDeveloperWorkflow(workflow, { applyRepair: this.service.apply, onCheckpoint: this.deps.onWorkflowCheckpoint });
    this.setPending({ proposal, patches: plan.patches, remediationPatches: plan.remediationPatches, workflow, createdAtMs: this.now().getTime() });
    return { progress: "Onay bekleniyor", text: `Hata ${proposal.rootCauseStatus === "reproduced" ? "yeniden üretildi" : "güçlü biçimde destekleniyor"}. Repair planı ${proposal.proposalId} hazır (${proposal.approvedFiles.join(", ")}; fingerprint ${proposal.proposalFingerprint.slice(0, 12)}; workspace ${proposal.workspaceId}). Onay bekleniyor.`, proposal };
  }

  private async revisePending(): Promise<AyasRepairConversationResult> {
    const current = this.pending!; const patches = current.patches.filter((_, index) => index !== 1);
    if (patches.length === current.patches.length) return { progress: "blocked", text: "Teklifte ikinci bir dosya yok." };
    const p = current.proposal;
    const proposal = createAyasRepairProposal({ issueFingerprint: p.issueFingerprint, workspaceId: p.workspaceId, rootCauseStatus: p.rootCauseStatus, rootCause: p.rootCause, evidence: p.evidence, graphifyFindings: p.graphifyFindings, approvedFiles: patches.map((patch) => patch.filePath), operationClasses: [...new Set(patches.map((patch) => patch.operation))], validationActions: p.validationActions, forbiddenOperations: p.forbiddenOperations, exclusions: [...p.exclusions, "user excluded second file"], expectedResult: p.expectedResult, risk: p.risk, bounds: { ...p.bounds, maxFiles: patches.length } });
    const remediationPatches = current.remediationPatches?.filter((patch) => proposal.approvedFiles.includes(patch.filePath));
    const workflow = remediationPatches ? undefined : this.planRepairWorkflow(proposal.rootCause, proposal, patches);
    if (!remediationPatches && !workflow) return { progress: "blocked", text: "Revize repair workflow planner tarafından güvenli biçimde oluşturulamadı.", proposal };
    if (workflow) await runAyasDeveloperWorkflow(workflow, { applyRepair: this.service.apply, onCheckpoint: this.deps.onWorkflowCheckpoint });
    this.setPending({ proposal, patches, remediationPatches, workflow, createdAtMs: this.now().getTime() });
    return { progress: "Onay bekleniyor", text: `Teklif revize edildi: ${proposal.proposalId}. Onay bekleniyor.`, proposal };
  }

  private async approveCurrentTurn(turnId: string, workspaceId: string): Promise<AyasRepairConversationResult> {
    const pending = this.pending;
    if (!pending) return { progress: "blocked", text: "Onay bekleyen bir repair teklifi yok." };
    if (this.now().getTime() - pending.createdAtMs >= this.proposalTtlMs) { this.setPending(undefined); return { progress: "blocked", text: "Repair teklifi süresi doldu; yeniden tanı gerekli." }; }
    if (workspaceId !== pending.proposal.workspaceId) return { progress: "blocked", text: "Onay farklı bir workspace için kullanılamaz." };
    try {
      const authorization = this.service.approve(pending.proposal, { proposalId: pending.proposal.proposalId, proposalFingerprint: pending.proposal.proposalFingerprint, issueFingerprint: pending.proposal.issueFingerprint, workspaceId, approvedByUser: true, userTurnId: turnId, currentTurnId: turnId });
      let repair: RepairOutcome;
      if (pending.remediationPatches) repair = await this.service.applyWithBoundedRemediation(pending.proposal, authorization, pending.patches, async () => pending.remediationPatches ?? []);
      else if (pending.workflow) {
        const workflow = pending.workflow;
        await runAyasDeveloperWorkflow(workflow, { applyRepair: this.service.apply, onCheckpoint: this.deps.onWorkflowCheckpoint }, { authorizations: { "authorized-repair": authorization } });
        repair = workflow.steps[0]!.result as RepairOutcome;
      } else repair = await this.service.apply(pending.proposal, authorization, pending.patches);
      if (!repair.ok) return { progress: repair.lifecycle === "blocked" ? "blocked" : "Final doğrulama", text: `Repair tamamlanmadı: ${repair.reason}`, proposal: pending.proposal, authorization, repair };
      this.setPending(undefined);
      const validated = repair.validations.length > 0 && repair.validations.every((value) => Boolean((value as { ok?: boolean }).ok));
      const patched = repair.provenance.filter((entry) => entry.success).length;
      return { progress: "Tamamlandı", text: `${patched} yetkili dosya düzeltildi.${validated ? " Doğrulamalar geçti." : " Doğrulama kanıtı eksik."}`, proposal: pending.proposal, authorization, repair };
    } catch (error) { return { progress: "blocked", text: `Onay uygulanamadı: ${error instanceof Error ? error.message : String(error)}`, proposal: pending.proposal }; }
  }
}
