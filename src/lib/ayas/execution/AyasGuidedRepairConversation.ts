import {
  createAyasGuidedRepairService, createAyasRepairProposal, diagnoseAyasRepair,
  type AyasGuidedRepairDeps, type AyasPatch, type AyasRepairAuthorization,
  type AyasRepairBounds, type AyasRepairEvidence, type AyasRepairOperation,
  type AyasRepairProposal, type AyasValidationAction,
} from "./AyasGuidedRepair";

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
}
interface PendingRepair { readonly proposal: AyasRepairProposal; readonly patches: readonly AyasPatch[]; readonly remediationPatches?: readonly AyasPatch[]; readonly createdAtMs: number; }
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
  getPendingProposal(): AyasRepairProposal | undefined { return this.pending?.proposal; }
  revokePending(): void { this.pending = undefined; }

  async handleUserTurn(text: string, turnId: string, workspaceId: string): Promise<AyasRepairConversationResult> {
    const normalized = text.trim();
    if (APPROVAL_RE.test(normalized)) return this.approveCurrentTurn(turnId, workspaceId);
    if (REVISION_RE.test(normalized) && this.pending) return this.revisePending();
    const plan = await this.deps.diagnoseTurn({ text: normalized, turnId, workspaceId });
    if (plan && "clarification" in plan) return { progress: "İnceliyorum", text: plan.clarification };
    if (!plan || plan.patches.length === 0) return { progress: "İnceliyorum", text: "Güvenli bir repair planı oluşturmak için dosya ve hata kanıtı gerekli." };
    const diagnosis = diagnoseAyasRepair({ issue: normalized, workspaceId, rootCause: plan.rootCause, reproduced: plan.reproduced, evidence: plan.evidence, graphifyFindings: plan.graphifyFindings });
    const proposal = createAyasRepairProposal({ issueFingerprint: diagnosis.issueFingerprint, workspaceId, rootCauseStatus: diagnosis.rootCauseStatus, rootCause: diagnosis.rootCause, evidence: diagnosis.evidence, graphifyFindings: diagnosis.graphifyFindings, approvedFiles: [...new Set(plan.patches.map((patch) => patch.filePath))], operationClasses: plan.operationClasses, validationActions: plan.validationActions, forbiddenOperations: ["shell", "delete", "git", "package", "production", "secrets"], exclusions: plan.exclusions ?? ["unrelated subsystems"], expectedResult: plan.expectedResult, risk: plan.risk, bounds: plan.bounds });
    this.pending = { proposal, patches: plan.patches, remediationPatches: plan.remediationPatches, createdAtMs: this.now().getTime() };
    return { progress: "Onay bekleniyor", text: `Hata ${proposal.rootCauseStatus === "reproduced" ? "yeniden üretildi" : "güçlü biçimde destekleniyor"}. Repair planı ${proposal.proposalId} hazır (${proposal.approvedFiles.join(", ")}; fingerprint ${proposal.proposalFingerprint.slice(0, 12)}; workspace ${proposal.workspaceId}). Onay bekleniyor.`, proposal };
  }

  private revisePending(): AyasRepairConversationResult {
    const current = this.pending!; const patches = current.patches.filter((_, index) => index !== 1);
    if (patches.length === current.patches.length) return { progress: "blocked", text: "Teklifte ikinci bir dosya yok." };
    const p = current.proposal;
    const proposal = createAyasRepairProposal({ issueFingerprint: p.issueFingerprint, workspaceId: p.workspaceId, rootCauseStatus: p.rootCauseStatus, rootCause: p.rootCause, evidence: p.evidence, graphifyFindings: p.graphifyFindings, approvedFiles: patches.map((patch) => patch.filePath), operationClasses: [...new Set(patches.map((patch) => patch.operation))], validationActions: p.validationActions, forbiddenOperations: p.forbiddenOperations, exclusions: [...p.exclusions, "user excluded second file"], expectedResult: p.expectedResult, risk: p.risk, bounds: { ...p.bounds, maxFiles: patches.length } });
    this.pending = { proposal, patches, remediationPatches: current.remediationPatches?.filter((patch) => proposal.approvedFiles.includes(patch.filePath)), createdAtMs: this.now().getTime() };
    return { progress: "Onay bekleniyor", text: `Teklif revize edildi: ${proposal.proposalId}. Onay bekleniyor.`, proposal };
  }

  private async approveCurrentTurn(turnId: string, workspaceId: string): Promise<AyasRepairConversationResult> {
    const pending = this.pending;
    if (!pending) return { progress: "blocked", text: "Onay bekleyen bir repair teklifi yok." };
    if (this.now().getTime() - pending.createdAtMs >= this.proposalTtlMs) { this.pending = undefined; return { progress: "blocked", text: "Repair teklifi süresi doldu; yeniden tanı gerekli." }; }
    if (workspaceId !== pending.proposal.workspaceId) return { progress: "blocked", text: "Onay farklı bir workspace için kullanılamaz." };
    try {
      const authorization = this.service.approve(pending.proposal, { proposalId: pending.proposal.proposalId, proposalFingerprint: pending.proposal.proposalFingerprint, issueFingerprint: pending.proposal.issueFingerprint, workspaceId, approvedByUser: true, userTurnId: turnId, currentTurnId: turnId });
      const repair = pending.remediationPatches ? await this.service.applyWithBoundedRemediation(pending.proposal, authorization, pending.patches, async () => pending.remediationPatches ?? []) : await this.service.apply(pending.proposal, authorization, pending.patches);
      if (!repair.ok) return { progress: repair.lifecycle === "blocked" ? "blocked" : "Final doğrulama", text: `Repair tamamlanmadı: ${repair.reason}`, proposal: pending.proposal, authorization, repair };
      this.pending = undefined;
      const validated = repair.validations.length > 0 && repair.validations.every((value) => Boolean((value as { ok?: boolean }).ok));
      const patched = repair.provenance.filter((entry) => entry.success).length;
      return { progress: "Tamamlandı", text: `${patched} yetkili dosya düzeltildi.${validated ? " Doğrulamalar geçti." : " Doğrulama kanıtı eksik."}`, proposal: pending.proposal, authorization, repair };
    } catch (error) { return { progress: "blocked", text: `Onay uygulanamadı: ${error instanceof Error ? error.message : String(error)}`, proposal: pending.proposal }; }
  }
}
