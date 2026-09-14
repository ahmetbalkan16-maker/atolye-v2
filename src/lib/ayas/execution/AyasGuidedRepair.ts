/**
 * AYAS Guided Code Repair — bounded, approval-gated source repair.
 *
 * This module is intentionally not a shell or generic agent executor.  It
 * offers semantic diagnosis/proposal/approval/patch/validation primitives;
 * every write is bound to the exact proposal, workspace and precondition hash.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type AyasRepairRootCauseStatus = "suspected" | "strongly-supported" | "reproduced";
export type AyasRepairLifecycle = "proposed" | "approved" | "active" | "validating" | "completed" | "revoked" | "expired" | "blocked" | "failed";
export type AyasRepairOperation = "patch-source" | "patch-test" | "create-regression" | "create-approved-source" | "patch-doc";
export type AyasValidationAction = "typecheck-project" | "lint-project" | "run-registered-smoke-test" | "run-registered-test-suite" | "graphify-update" | "graphify-explain" | "inspect-git-diff/status";

export interface AyasRepairEvidence { readonly kind: "source" | "test" | "log" | "graphify" | "validation"; readonly ref: string; readonly summary: string; readonly digest?: string; }
export interface AyasRepairBounds { readonly maxFiles: number; readonly maxNewFiles: number; readonly maxRepairCycles: number; readonly maxValidationCycles: number; readonly maxDurationMs: number; readonly allowFileCreation: boolean; }
export interface AyasRepairProposal {
  readonly schemaVersion: "1"; readonly proposalId: string; readonly issueFingerprint: string; readonly workspaceId: string;
  readonly createdAt: string; readonly rootCauseStatus: AyasRepairRootCauseStatus; readonly rootCause: string;
  readonly evidence: readonly AyasRepairEvidence[]; readonly graphifyFindings: readonly string[];
  readonly approvedFiles: readonly string[]; readonly operationClasses: readonly AyasRepairOperation[];
  readonly validationActions: readonly AyasValidationAction[]; readonly forbiddenOperations: readonly string[];
  readonly exclusions: readonly string[]; readonly expectedResult: string; readonly risk: string;
  readonly bounds: AyasRepairBounds; readonly proposalFingerprint: string; readonly status: "proposed";
}
export interface AyasRepairAuthorization {
  readonly authorizationId: string; readonly proposalId: string; readonly proposalFingerprint: string; readonly issueFingerprint: string;
  readonly workspaceId: string; readonly approvedFiles: readonly string[]; readonly operationClasses: readonly AyasRepairOperation[];
  readonly validationActions: readonly AyasValidationAction[]; readonly forbiddenOperations: readonly string[];
  readonly createdAt: string; readonly expiresAt: string; readonly status: "approved" | "revoked" | "expired"; readonly provenance: "explicit-user-approval";
}
export interface AyasPatch { readonly filePath: string; readonly operation: AyasRepairOperation; readonly expectedHash: string | null; readonly content: string; }
export interface AyasPatchProvenance { readonly repairId: string; readonly authorizationId: string; readonly file: string; readonly beforeHash: string | null; readonly afterHash: string | null; readonly operation: AyasRepairOperation; readonly success: boolean; readonly evidence: string; }
export interface AyasJournalEntry { readonly at: string; readonly event: string; readonly proposalId: string; readonly authorizationId?: string; readonly detail: string; readonly evidence?: readonly string[]; }
export interface AyasGuidedRepairDeps { readonly workspaceRoot?: string; readonly workspaceId?: string; readonly now?: () => Date; readonly ttlMs?: number; readonly journal?: (entry: AyasJournalEntry) => void; readonly validators?: Partial<Record<AyasValidationAction, () => Promise<unknown>>>; }
export interface AyasDiagnosisInput { readonly issue: string; readonly workspaceId: string; readonly evidence?: readonly AyasRepairEvidence[]; readonly graphifyFindings?: readonly string[]; readonly rootCause?: string; readonly reproduced?: boolean; }
export interface AyasDiagnosisResult { readonly issueFingerprint: string; readonly workspaceId: string; readonly rootCauseStatus: AyasRepairRootCauseStatus; readonly rootCause: string; readonly evidence: readonly AyasRepairEvidence[]; readonly graphifyFindings: readonly string[]; }

const ALLOWED_ROOTS = ["src/", "scripts/", "app/"];
const DOC_RE = /^(?:[A-Za-z0-9_.-]+\.md)$/;
const VALIDATIONS = new Set<AyasValidationAction>(["typecheck-project", "lint-project", "run-registered-smoke-test", "run-registered-test-suite", "graphify-update", "graphify-explain", "inspect-git-diff/status"]);
const OPS = new Set<AyasRepairOperation>(["patch-source", "patch-test", "create-regression", "create-approved-source", "patch-doc"]);

const digest = (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
const textHash = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
function proposalFingerprintOf(proposal: AyasRepairProposal): string { const unsigned = Object.fromEntries(Object.entries(proposal).filter(([key]) => key !== "proposalFingerprint")); return digest(unsigned); }
export function isAyasRepairProposalAuthentic(proposal: AyasRepairProposal): boolean { return proposalFingerprintOf(proposal) === proposal.proposalFingerprint; }

export function revokeAyasRepairAuthorization(auth: AyasRepairAuthorization): AyasRepairAuthorization {
  return { ...auth, status: "revoked" };
}

export type AyasScopeDecision = "same-scope" | "material-expansion";
const MATERIAL_SCOPE = /memory|schema|dependency|package|credential|secret|production|delete|deletion|git|architecture|unrelated|runtime/i;
export function classifyAyasRepairScope(paths: readonly string[], proposal: AyasRepairProposal): AyasScopeDecision {
  if (paths.length > proposal.bounds.maxFiles || paths.some((p) => MATERIAL_SCOPE.test(p)) || paths.some((p) => !proposal.approvedFiles.includes(p))) return "material-expansion";
  return "same-scope";
}

/** Safe diagnosis is data-only: callers provide read/Graphify/test evidence;
 * this function never accepts or executes an arbitrary command. */
export function diagnoseAyasRepair(input: AyasDiagnosisInput): AyasDiagnosisResult {
  if (!input.issue.trim() || !input.workspaceId.trim()) throw new Error("diagnosis requires issue and workspace");
  const evidence = clone(input.evidence ?? []); const graphifyFindings = clone(input.graphifyFindings ?? []);
  const rootCause = input.rootCause?.trim() || "root cause not yet established";
  const rootCauseStatus: AyasRepairRootCauseStatus = input.reproduced ? "reproduced" : input.rootCause ? (evidence.length > 0 ? "strongly-supported" : "suspected") : "suspected";
  return { issueFingerprint: digest({ issue: input.issue, evidence, graphifyFindings, workspaceId: input.workspaceId }), workspaceId: input.workspaceId, rootCauseStatus, rootCause, evidence, graphifyFindings };
}

function safeRelative(root: string, filePath: string): string {
  const n = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!n || n.includes("..") || n.includes("\0") || path.isAbsolute(n) || /^[A-Za-z]:/.test(n) || /(?:^|\/)(?:\.git|node_modules|data|secrets|\.env)(?:\/|$)/i.test(n)) throw new Error("repair path denied");
  if (!ALLOWED_ROOTS.some((r) => n.startsWith(r)) && !DOC_RE.test(n)) throw new Error("repair path outside allowlist");
  return n;
}

export function createAyasRepairProposal(input: Omit<AyasRepairProposal, "schemaVersion" | "proposalId" | "createdAt" | "proposalFingerprint" | "status"> & { proposalId?: string; createdAt?: string }): AyasRepairProposal {
  if (!input.rootCause || !input.workspaceId || input.approvedFiles.length === 0) throw new Error("incomplete repair proposal");
  if (input.approvedFiles.length > input.bounds.maxFiles || input.bounds.maxRepairCycles > 1 || input.bounds.maxValidationCycles < 0) throw new Error("repair bounds exceeded");
  input.approvedFiles.forEach((f) => safeRelative(process.cwd(), f));
  input.operationClasses.forEach((o) => { if (!OPS.has(o)) throw new Error("unknown repair operation"); });
  input.validationActions.forEach((v) => { if (!VALIDATIONS.has(v)) throw new Error("validation action is not registered"); });
  const base = { ...input, schemaVersion: "1" as const, proposalId: input.proposalId ?? `proposal-${crypto.randomUUID()}`, createdAt: input.createdAt ?? new Date().toISOString(), status: "proposed" as const };
  return { ...base, proposalFingerprint: digest(base) };
}

export function approveAyasRepair(proposal: AyasRepairProposal, approval: { proposalId: string; proposalFingerprint: string; issueFingerprint: string; workspaceId: string; approvedByUser: boolean; userTurnId?: string; currentTurnId?: string; now?: string; ttlMs?: number }): AyasRepairAuthorization {
  if (!isAyasRepairProposalAuthentic(proposal) || !approval.approvedByUser || !approval.userTurnId || approval.userTurnId !== approval.currentTurnId || approval.proposalId !== proposal.proposalId || approval.proposalFingerprint !== proposal.proposalFingerprint || approval.issueFingerprint !== proposal.issueFingerprint || approval.workspaceId !== proposal.workspaceId || proposal.status !== "proposed") throw new Error("repair approval provenance mismatch");
  const now = approval.now ?? new Date().toISOString();
  return { authorizationId: `repair-authz-${crypto.randomUUID()}`, proposalId: proposal.proposalId, proposalFingerprint: proposal.proposalFingerprint, issueFingerprint: proposal.issueFingerprint, workspaceId: proposal.workspaceId, approvedFiles: clone(proposal.approvedFiles), operationClasses: clone(proposal.operationClasses), validationActions: clone(proposal.validationActions), forbiddenOperations: clone(proposal.forbiddenOperations), createdAt: now, expiresAt: new Date(Date.parse(now) + (approval.ttlMs ?? 5 * 60 * 1000)).toISOString(), status: "approved", provenance: "explicit-user-approval" };
}

export async function runAyasRegisteredValidation(action: AyasValidationAction, validators: AyasGuidedRepairDeps["validators"] = {}): Promise<{ action: AyasValidationAction; ok: boolean; result?: unknown; detail?: string }> {
  if (!VALIDATIONS.has(action)) return { action, ok: false, detail: "validation action is not registered" };
  const fn = validators[action];
  if (!fn) return { action, ok: false, detail: "validation adapter unavailable" };
  try { return { action, ok: true, result: await fn() }; } catch (e) { return { action, ok: false, detail: e instanceof Error ? e.message : String(e) }; }
}

export function createAyasGuidedRepairService(deps: AyasGuidedRepairDeps = {}) {
  const root = path.resolve(deps.workspaceRoot ?? process.cwd()); const now = deps.now ?? (() => new Date()); const ttl = deps.ttlMs ?? 5 * 60 * 1000;
  const consumedAuthorizations = new Set<string>();
  const journal = (e: AyasJournalEntry) => deps.journal?.(e);
  async function applyInternal(proposal: AyasRepairProposal, auth: AyasRepairAuthorization, patches: readonly AyasPatch[], consumeAuthorization: boolean): Promise<{ ok: true; lifecycle: "completed"; repairId: string; files: readonly string[]; validations: readonly unknown[]; provenance: readonly AyasPatchProvenance[] } | { ok: false; lifecycle: "blocked" | "failed"; reason: string; repairId?: string; provenance?: readonly AyasPatchProvenance[] }> {
    const repairId = `repair-${crypto.randomUUID()}`;
    const startedAt = now().getTime();
    if (auth.status !== "approved" || Date.parse(auth.expiresAt) <= now().getTime()) return { ok: false, lifecycle: "blocked", reason: "authorization expired or revoked", repairId };
    if (consumeAuthorization && consumedAuthorizations.has(auth.authorizationId)) return { ok: false, lifecycle: "blocked", reason: "authorization replay denied", repairId };
    if (!isAyasRepairProposalAuthentic(proposal) || auth.proposalId !== proposal.proposalId || auth.proposalFingerprint !== proposal.proposalFingerprint || auth.issueFingerprint !== proposal.issueFingerprint || auth.workspaceId !== proposal.workspaceId) return { ok: false, lifecycle: "blocked", reason: "proposal authorization mismatch", repairId };
    if (patches.length > proposal.bounds.maxFiles || classifyAyasRepairScope(patches.map((p) => p.filePath), proposal) === "material-expansion") return { ok: false, lifecycle: "blocked", reason: "scope expansion requires a new proposal", repairId };
    if (proposal.validationActions.length > proposal.bounds.maxValidationCycles) return { ok: false, lifecycle: "blocked", reason: "validation cycle bound exceeded", repairId };
    const files: string[] = []; const before: Array<{ abs: string; old: string | null; patch: AyasPatch }> = []; const provenance: AyasPatchProvenance[] = [];
    try {
      let newFileCount = 0;
      for (const patch of patches) {
        if (!auth.approvedFiles.includes(patch.filePath)) throw new Error("file is outside approved scope");
        if (!auth.operationClasses.includes(patch.operation)) throw new Error("operation is outside approved scope");
        const rel = safeRelative(root, patch.filePath); const abs = path.resolve(root, rel); const exists = fs.existsSync(abs); const old = exists ? fs.readFileSync(abs, "utf8") : null;
        if (!exists && (!proposal.bounds.allowFileCreation || !["create-regression", "create-approved-source"].includes(patch.operation))) throw new Error("file creation is not approved");
        if (!exists && ++newFileCount > proposal.bounds.maxNewFiles) throw new Error("new-file bound exceeded");
        if (exists && patch.expectedHash !== textHash(old!)) throw new Error("precondition hash mismatch");
        if (!exists && patch.expectedHash !== null) throw new Error("new file must use null precondition");
        before.push({ abs, old, patch });
      }
      if (consumeAuthorization) consumedAuthorizations.add(auth.authorizationId);
      journal({ at: now().toISOString(), event: "repair-started", proposalId: proposal.proposalId, authorizationId: auth.authorizationId, detail: "bounded patch" });
      for (const item of before) { fs.mkdirSync(path.dirname(item.abs), { recursive: true }); fs.writeFileSync(item.abs, item.patch.content, "utf8"); files.push(item.patch.filePath); provenance.push({ repairId, authorizationId: auth.authorizationId, file: item.patch.filePath, beforeHash: item.old === null ? null : textHash(item.old), afterHash: textHash(item.patch.content), operation: item.patch.operation, success: true, evidence: `bounded replacement (${item.patch.content.length} chars)` }); }
      const validations = []; for (const action of proposal.validationActions) { if (now().getTime() - startedAt > proposal.bounds.maxDurationMs) throw new Error("repair duration bound exceeded"); validations.push(await runAyasRegisteredValidation(action, deps.validators)); }
      const failed = validations.find((v) => !(v as { ok?: boolean }).ok); if (failed) throw new Error(`validation failed: ${JSON.stringify(failed)}`);
      journal({ at: now().toISOString(), event: "repair-completed", proposalId: proposal.proposalId, authorizationId: auth.authorizationId, detail: "validated", evidence: files });
      return { ok: true, lifecycle: "completed", repairId, files, validations, provenance };
    } catch (e) {
      for (let i = before.length - 1; i >= 0; i--) { const item = before[i]!; try { const current = fs.existsSync(item.abs) ? fs.readFileSync(item.abs, "utf8") : null; if (current !== item.patch.content) continue; if (item.old === null) fs.rmSync(item.abs, { force: true }); else fs.writeFileSync(item.abs, item.old, "utf8"); } catch { /* fail closed; journal records failure */ } }
      const reason = e instanceof Error ? e.message : String(e); journal({ at: now().toISOString(), event: "repair-failed", proposalId: proposal.proposalId, authorizationId: auth.authorizationId, detail: reason }); return { ok: false, lifecycle: "failed", reason, repairId, provenance };
    }
  }
  const apply = (proposal: AyasRepairProposal, auth: AyasRepairAuthorization, patches: readonly AyasPatch[]) => applyInternal(proposal, auth, patches, true);
  async function applyWithBoundedRemediation(proposal: AyasRepairProposal, auth: AyasRepairAuthorization, first: readonly AyasPatch[], remediation: () => Promise<readonly AyasPatch[]>): Promise<Awaited<ReturnType<typeof apply>>> {
    const initial = await applyInternal(proposal, auth, first, true); if (initial.ok || proposal.bounds.maxRepairCycles < 1) return initial;
    const next = await remediation();
    if (classifyAyasRepairScope(next.map((p) => p.filePath), proposal) !== "same-scope") return { ok: false, lifecycle: "blocked", reason: "remediation requires scope-expansion proposal" };
    return applyInternal(proposal, auth, next, false);
  }
  return { workspaceRoot: root, createProposal: createAyasRepairProposal, diagnose: diagnoseAyasRepair, approve: (p: AyasRepairProposal, a: Omit<Parameters<typeof approveAyasRepair>[1], "now" | "ttlMs">) => approveAyasRepair(p, { ...a, now: now().toISOString(), ttlMs: ttl }), revoke: revokeAyasRepairAuthorization, classifyScope: classifyAyasRepairScope, apply, applyWithBoundedRemediation, validate: (a: AyasValidationAction) => runAyasRegisteredValidation(a, deps.validators) };
}

export const AyasGuidedRepair = createAyasGuidedRepairService;
