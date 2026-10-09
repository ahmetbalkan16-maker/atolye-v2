import crypto from "node:crypto";
import path from "node:path";
import { resolveAccessGate } from "../../auth/accessGate";
import type { AyasInboxProposal, AyasInboxDecisionRecord } from "./AyasApprovalInboxStore";
import { isAyasApprovalDecisionOwnerAdmitted } from "./AyasOwnerApprovalAdmission";
import { createAyasPatchArtifactStore, type AyasPatchArtifactStore } from "./AyasPatchArtifact";
import { readAyasExactPreviewSource, verifyAyasExactProposalSafety } from "./AyasExactProposalSafety";
import { classifyPatchSet } from "../selfheal/BrainPatchSafety";
import { createAyasResearchExperimentStore, resolveAyasResearchImprovementRoot, type AyasResearchExperimentStore } from "./AyasResearchExperimentStore";
import type { AyasOwnerExactPreview, AyasOwnerExactPreviewBinding } from "./AyasOwnerExactPreviewContract";

const TTL_MS = 5 * 60 * 1000;
const sha = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function seal(binding: Omit<AyasOwnerExactPreviewBinding, "seal">): string {
  const gate = resolveAccessGate();
  if (gate.mode !== "enforced" || !gate.key) throw new Error("EXACT_PREVIEW_UNAVAILABLE");
  return crypto.createHmac("sha256", gate.key).update(`ayas-owner-exact-preview:v1\n${canonical(binding)}`).digest("hex");
}
export interface AyasOwnerExactPreviewOptions {
  readonly repoRoot?: string;
  readonly artifactStore?: AyasPatchArtifactStore;
  readonly experimentStore?: AyasResearchExperimentStore;
  readonly now?: number;
  /** Only the existing service's pre-write check accepts its reserved proposal. */
  readonly reserved?: boolean;
}

/** Read-only derivation. Missing/corrupt/dirty/stale/unattributed inputs produce no preview. */
export function loadAyasOwnerExactPreview(proposal: AyasInboxProposal, approval: AyasInboxDecisionRecord | undefined,
  options: AyasOwnerExactPreviewOptions = {}): AyasOwnerExactPreview | undefined {
  try {
    const repoRoot = options.repoRoot ?? process.cwd();
    if (proposal.mutationKind !== "patch-artifact:v1" || proposal.safetyClassification !== "SAFE"
      || proposal.status !== (options.reserved ? "RESERVED" : "APPROVED") || !proposal.patchArtifactId || !proposal.patchHash
      || !/^[A-Za-z0-9_-]{1,200}$/.test(proposal.patchArtifactId) || !/^[0-9a-f]{64}$/.test(proposal.patchHash)
      || !/^[0-9a-f]{40}$/.test(proposal.baseHead)
      || !isAyasApprovalDecisionOwnerAdmitted(approval, proposal) || approval?.finalizedAt || approval?.authorizationConsumedAt
      || (!options.reserved && approval?.reservedAt)) return undefined;
    const store = options.artifactStore ?? createAyasPatchArtifactStore({ rootDir: path.join(repoRoot, "data/brain/self-improvement/patch-artifacts") });
    const artifact = store.loadVerified(proposal.patchArtifactId);
    if (artifact.artifactId !== proposal.patchArtifactId || artifact.patchHash !== proposal.patchHash || artifact.baseHead !== proposal.baseHead
      || artifact.safetyClassification !== "SAFE" || canonical(artifact.exactFiles) !== canonical(proposal.exactFiles)
      || !artifact.replacements.length || artifact.replacements.length !== proposal.exactFiles.length
      || artifact.replacements.some((file, i) => file.filePath !== proposal.exactFiles[i])
      || !artifact.validatorScripts.length || !artifact.sandboxValidationSummary.length || !artifact.graphifyEvidence.length
      || canonical(artifact.validatorScripts) !== canonical(proposal.testsPlanned)
      || artifact.graphifyEvidence.some(item => !proposal.graphifyEvidence.includes(item))) return undefined;
    const classification = classifyPatchSet(proposal.exactFiles).level;
    if (classification === "FORBIDDEN_AUTONOMOUS") return undefined;
    const experiments = options.experimentStore ?? createAyasResearchExperimentStore({ rootDir: resolveAyasResearchImprovementRoot(repoRoot) });
    const proof = proposal.exactPatchSafetyProof;
    if ((classification === "REVIEW_REQUIRED" || proof) && !verifyAyasExactProposalSafety(proposal, { repoRoot, artifactStore: store, experimentStore: experiments })) return undefined;
    const evidence = proof ? experiments.readEvidence(proof.evidenceHash) : { graphify: artifact.graphifyEvidence, sandbox: artifact.sandboxValidationSummary, validators: artifact.validatorScripts };
    const record = proof ? experiments.readExperiment(proof.experimentId) : null;
    if (!evidence) return undefined;
    const beforeContents = readAyasExactPreviewSource(repoRoot, proposal.baseHead, artifact.replacements);
    const files = artifact.replacements.map((file, i) => {
      const before = beforeContents[i]!;
      if (before !== null && sha(before) !== file.expectedHash) throw new Error("EXACT_PREVIEW_UNAVAILABLE");
      return { filePath: file.filePath, before, after: file.content };
    });
    const evidenceIdentity = proof ? proof.evidenceHash : sha(canonical(evidence));
    const proposalMaterial = Object.fromEntries(Object.entries(proposal).filter(([field]) => field !== "status" && field !== "lastUpdatedAt"));
    const snapshotDigest = sha(canonical({ artifact, files, evidence, record, proposal: proposalMaterial, proposalHash: proposal.proposalHash,
      baseHead: proposal.baseHead, exactFiles: proposal.exactFiles, scope: proposal.expectedDiffScope, evidenceIdentity,
      approval: { decisionId: approval!.decisionId, decidedAt: approval!.decidedAt, ownerDecisionSeal: approval!.ownerDecisionSeal } }));
    const issued = options.now ?? Date.now();
    const binding = { schema: "ayas-owner-exact-preview:v1" as const, proposalId: proposal.proposalId, proposalHash: proposal.proposalHash,
      artifactId: artifact.artifactId, patchHash: artifact.patchHash, baseHead: proposal.baseHead, snapshotDigest,
      issuedAt: new Date(issued).toISOString(), expiresAt: new Date(issued + TTL_MS).toISOString() };
    return { binding: { ...binding, seal: seal(binding) }, files, exactFiles: artifact.exactFiles, evidenceIdentity,
      evidenceStatus: "VERIFIED", validationSummary: artifact.sandboxValidationSummary };
  } catch { return undefined; }
}

export function assertAyasOwnerExactPreview(binding: AyasOwnerExactPreviewBinding | undefined, proposal: AyasInboxProposal,
  approval: AyasInboxDecisionRecord | undefined, options: AyasOwnerExactPreviewOptions = {}): void {
  const now = options.now ?? Date.now();
  if (!binding || binding.schema !== "ayas-owner-exact-preview:v1" || !/^[0-9a-f]{64}$/.test(binding.seal)
    || !Number.isFinite(Date.parse(binding.issuedAt)) || Date.parse(binding.issuedAt) > now
    || Date.parse(binding.expiresAt) !== Date.parse(binding.issuedAt) + TTL_MS || Date.parse(binding.expiresAt) <= now) throw new Error("EXACT_PREVIEW_REQUIRED");
  const { seal: suppliedSeal, ...material } = binding;
  if (!crypto.timingSafeEqual(Buffer.from(suppliedSeal, "hex"), Buffer.from(seal(material), "hex"))) throw new Error("EXACT_PREVIEW_CHANGED");
  const fresh = loadAyasOwnerExactPreview(proposal, approval, { ...options, now: Date.parse(binding.issuedAt) });
  if (!fresh || canonical(fresh.binding) !== canonical(binding)) throw new Error("EXACT_PREVIEW_CHANGED");
}
