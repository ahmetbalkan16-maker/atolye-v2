import fs from "node:fs";
import path from "node:path";
import {
  createRuntimeStorageContext,
  validateSafeAncestorChain,
  type RuntimeStorageContext,
} from "@/lib/runtime/RuntimeStoragePaths";
import { initialRuntimeAuthorityGeneration } from "@/lib/runtime/ProductionRuntimeOperationContext";
import { ProductionExecutionDurableRecoveryService } from "@/lib/production/ProductionExecutionPersistence";
import { verifyMigrationCandidate } from "@/lib/runtime/migration/RuntimeMigrationCandidateVerifier";
import {
  RuntimeAuthorityTransitionError,
  RuntimeAuthorityTransitionStore,
  isValidRuntimeAuthorityTransitionId,
  resolveRuntimeAuthorityTransitionKind,
  type RuntimeAuthorityTransitionRecord,
} from "./RuntimeAuthorityTransition";
import {
  beginGenesisTransition,
  beginRecoveryTransition,
  beginTransition,
  confirmQuiescence,
  failTransition,
  prepareTransition,
  publishTransition,
  quarantineSource,
  validateTarget,
} from "./RuntimeAuthorityTransitionCoordinator";
import {
  beginTokenAuthorizedRollback,
  finalizeOldRootQuarantine,
  publishRollback,
  quarantineFormerTarget,
  readRollbackAvailability,
  RuntimeAuthorityRollbackError,
  validateRollback,
} from "./RuntimeAuthorityRollback";
import { RuntimeAuthorityOldRootQuarantineError } from "./RuntimeAuthorityOldRootQuarantine";

/**
 * F2 — the operator entrypoint for the authority transition state machine
 * (`scripts/run-authority-transition.ts`). A strict, argument-validated wrapper
 * around `RuntimeAuthorityTransitionCoordinator` — it drives the control plane
 * and **never copies project data itself** (byte-exact materialization is a
 * separate `runtime:backup` + migration-candidate step).
 *
 * Every path argument is resolved, checked for `..`, and its ancestor chain is
 * validated (symlink / junction rejection). A wrong root / marker / generation /
 * binding / sequence fails closed through the coordinator + store.
 */

export interface RuntimeAuthorityTransitionCommandResult {
  readonly report: Record<string, unknown>;
  readonly exitCode: number;
}

const GEN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

export async function runRuntimeAuthorityTransitionCommand(
  argv: readonly string[],
): Promise<RuntimeAuthorityTransitionCommandResult> {
  try {
    const [subcommand, ...rest] = argv;
    const args = parseArgs(rest);
    const authorityRoot = requireDirArg(args, "authority-root");
    const store = new RuntimeAuthorityTransitionStore({ authorityRoot });
    const generation = optionalArg(args, "generation") ?? initialRuntimeAuthorityGeneration;
    if (!GEN_PATTERN.test(generation)) {
      throw new CommandInputError("--generation is malformed");
    }
    const workspaceRoot = optionalDirArg(args, "workspace-root") ?? process.cwd();

    switch (subcommand) {
      case "status":
        return ok({
          activeAuthority: store.readActiveAuthority(),
          transitions: store.listTransitions().map(summarize),
        });

      case "begin-genesis": {
        const target = requireDirArg(args, "target");
        const transitionId = requireTransitionId(args);
        const record = beginGenesisTransition({
          store,
          transitionId,
          legacySourceContext: legacyContext(workspaceRoot, authorityRoot),
          authorityGeneration: generation,
          targetContext: externalContext(target, workspaceRoot, authorityRoot),
        });
        return ok({ started: summarize(record) });
      }

      case "begin-relocation": {
        const source = requireDirArg(args, "source");
        const target = requireDirArg(args, "target");
        const transitionId = requireTransitionId(args);
        const record = beginTransition({
          store,
          transitionId,
          sourceContext: externalContext(source, workspaceRoot, authorityRoot),
          sourceAuthorityGeneration: generation,
          targetContext: externalContext(target, workspaceRoot, authorityRoot),
          targetAuthorityGeneration: generation,
        });
        return ok({ started: summarize(record) });
      }

      case "begin-recovery": {
        const target = requireDirArg(args, "target");
        const transitionId = requireTransitionId(args);
        const reason = requireArg(args, "reason");
        const record = beginRecoveryTransition({
          store,
          transitionId,
          targetContext: externalContext(target, workspaceRoot, authorityRoot),
          targetAuthorityGeneration: generation,
          reason,
        });
        return ok({ started: summarize(record) });
      }

      case "quiesce": {
        const transitionId = requireTransitionId(args);
        if (!("assert-worker-stopped" in args)) {
          throw new CommandInputError(
            "--assert-worker-stopped is required — stop the production runtime first",
          );
        }
        const sourceProjects = optionalDirArg(args, "source-projects");
        const durableRecovery = sourceProjects
          ? await scanDurableRecovery(sourceProjects)
          : "clean";
        const record = confirmQuiescence({
          store,
          transitionId,
          workerLifecycleState: "stopped",
          durableRecovery,
        });
        return ok({ quiesced: summarize(record), durableRecovery });
      }

      case "prepare": {
        const transitionId = requireTransitionId(args);
        const sourceProjects = requireDirArg(args, "source-projects");
        const projectIdentities = optionalCandidateIdentities(args);
        const record = prepareTransition({
          store,
          transitionId,
          sourceProjectSlugs: projectSlugs(sourceProjects),
          sourceProjectsRoot: sourceProjects,
          ...(projectIdentities ? { projectIdentities } : {}),
        });
        return ok({
          prepared: summarize(record),
          fileCount: record.sourceFreeze?.fileCount ?? null,
          contentDigest: record.sourceFreeze?.contentDigest ?? null,
          projectIdentityCount: record.sourceFreeze?.projectIdentities?.length ?? 0,
          logicalContentDigest: record.sourceFreeze?.logicalContentDigest ?? null,
          logicalFileCount: record.sourceFreeze?.logicalFileCount ?? null,
        });
      }

      case "validate": {
        const transitionId = requireTransitionId(args);
        const target = requireDirArg(args, "target");
        const targetProjects = path.join(target, "projects");
        const projectIdentities = optionalCandidateIdentities(args);
        const record = validateTarget({
          store,
          transitionId,
          targetContext: externalContext(target, workspaceRoot, authorityRoot),
          targetAuthorityGeneration: generation,
          targetProjectSlugs: projectSlugs(targetProjects),
          targetProjectsRoot: targetProjects,
          ...(projectIdentities ? { projectIdentities } : {}),
        });
        return ok({
          validated: summarize(record),
          byteExact: record.targetValidation?.byteExact ?? false,
          identityMapped: Boolean(record.sourceFreeze?.projectIdentities),
        });
      }

      case "publish": {
        const transitionId = requireTransitionId(args);
        const target = requireDirArg(args, "target");
        const record = publishTransition({
          store,
          transitionId,
          targetContext: externalContext(target, workspaceRoot, authorityRoot),
          targetAuthorityGeneration: generation,
        });
        return ok({
          published: summarize(record),
          activeAuthority: store.readActiveAuthority(),
        });
      }

      case "quarantine": {
        const transitionId = requireTransitionId(args);
        const record = quarantineSource({ store, transitionId });
        return ok({ quarantined: summarize(record) });
      }

      case "fail": {
        const transitionId = requireTransitionId(args);
        const reason = requireArg(args, "reason");
        const record = failTransition({ store, transitionId, reason });
        return ok({ failed: summarize(record) });
      }

      /* ------------------------------------------------ C.2B.11 ------- */

      case "finalize-quarantine": {
        const transitionId = requireTransitionId(args);
        const oldRootProjects = path.join(requireDirArg(args, "old-root"), "projects");
        const result = finalizeOldRootQuarantine({
          store, transitionId, oldRootProjectsRoot: oldRootProjects,
        });
        return ok({ finalized: result });
      }

      case "rollback-status": {
        const transitionId = requireTransitionId(args);
        return ok({ rollback: readRollbackAvailability(store, transitionId) });
      }

      case "begin-rollback": {
        const rollbackTransitionId = requireArgTransitionId(args, "rollback-transition-id");
        const tokenId = requireArg(args, "token-id");
        const oldRoot = requireDirArg(args, "old-root");
        const target = requireDirArg(args, "target");
        const record = beginTokenAuthorizedRollback({
          store,
          rollbackTransitionId,
          tokenId,
          oldRootContext: externalContext(oldRoot, workspaceRoot, authorityRoot),
          oldRootAuthorityGeneration: generation,
          oldRootProjectsRoot: path.join(oldRoot, "projects"),
          formerTargetContext: externalContext(target, workspaceRoot, authorityRoot),
          formerTargetAuthorityGeneration: generation,
          formerTargetProjectsRoot: path.join(target, "projects"),
        });
        return ok({ rollbackStarted: summarize(record) });
      }

      case "validate-rollback": {
        const rollbackTransitionId = requireArgTransitionId(args, "rollback-transition-id");
        const record = validateRollback({
          store,
          rollbackTransitionId,
          oldRootProjectsRoot: path.join(requireDirArg(args, "old-root"), "projects"),
          formerTargetProjectsRoot: path.join(requireDirArg(args, "target"), "projects"),
        });
        return ok({ rollbackValidated: summarize(record) });
      }

      case "publish-rollback": {
        const rollbackTransitionId = requireArgTransitionId(args, "rollback-transition-id");
        const record = publishRollback({
          store,
          rollbackTransitionId,
          oldRootProjectsRoot: path.join(requireDirArg(args, "old-root"), "projects"),
        });
        return ok({
          rollbackPublished: summarize(record),
          activeAuthority: store.readActiveAuthority(),
        });
      }

      case "quarantine-former-target": {
        const rollbackTransitionId = requireArgTransitionId(args, "rollback-transition-id");
        const record = quarantineFormerTarget({
          store,
          rollbackTransitionId,
          formerTargetProjectsRoot: path.join(requireDirArg(args, "target"), "projects"),
        });
        return ok({ formerTargetQuarantined: summarize(record) });
      }

      default:
        throw new CommandInputError(
          `unknown subcommand ${JSON.stringify(subcommand ?? "")} — expected one of: status, begin-genesis, begin-relocation, begin-recovery, quiesce, prepare, validate, publish, quarantine, fail, finalize-quarantine, rollback-status, begin-rollback, validate-rollback, publish-rollback, quarantine-former-target`,
        );
    }
  } catch (error) {
    if (error instanceof CommandInputError) {
      return fail("AUTHORITY_TRANSITION_INPUT_INVALID", error.message);
    }
    if (
      error instanceof RuntimeAuthorityTransitionError ||
      error instanceof RuntimeAuthorityRollbackError ||
      error instanceof RuntimeAuthorityOldRootQuarantineError
    ) {
      return fail(error.code, error.message);
    }
    return fail(
      "AUTHORITY_TRANSITION_FAILED",
      error instanceof Error ? error.message : String(error),
    );
  }
}

/* --------------------------------------------------------------- helpers --- */

class CommandInputError extends Error {}

function parseArgs(rest: readonly string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) {
      throw new CommandInputError(`unexpected argument ${JSON.stringify(token)}`);
    }
    const key = token.slice(2);
    if (!/^[a-z][a-z-]{1,40}$/.test(key)) {
      throw new CommandInputError(`malformed flag ${JSON.stringify(token)}`);
    }
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function requireArg(args: Record<string, string | true>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CommandInputError(`--${key} is required`);
  }
  return value;
}

function optionalArg(args: Record<string, string | true>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function requireDirArg(args: Record<string, string | true>, key: string): string {
  return resolveSafeExistingDir(requireArg(args, key), key);
}

function optionalDirArg(args: Record<string, string | true>, key: string): string | undefined {
  const raw = optionalArg(args, key);
  return raw === undefined ? undefined : resolveSafeExistingDir(raw, key);
}

function resolveSafeExistingDir(raw: string, key: string): string {
  if (raw.split(/[\\/]/).includes("..")) {
    throw new CommandInputError(`--${key} must not contain ".."`);
  }
  const resolved = path.resolve(raw);
  if (!path.isAbsolute(resolved)) {
    throw new CommandInputError(`--${key} must resolve to an absolute path`);
  }
  try {
    const link = fs.lstatSync(resolved);
    if (link.isSymbolicLink() || !link.isDirectory()) {
      throw new CommandInputError(`--${key} is not a real directory`);
    }
  } catch (error) {
    if (error instanceof CommandInputError) throw error;
    throw new CommandInputError(`--${key} directory does not exist: ${resolved}`);
  }
  validateSafeAncestorChain(resolved); // symlink / junction rejection in the chain
  return resolved;
}

function requireTransitionId(args: Record<string, string | true>): string {
  return requireArgTransitionId(args, "transition-id");
}

function requireArgTransitionId(args: Record<string, string | true>, key: string): string {
  const value = requireArg(args, key);
  if (!isValidRuntimeAuthorityTransitionId(value)) {
    throw new CommandInputError(`--${key} is malformed (8–128 chars, [A-Za-z0-9._:-])`);
  }
  return value;
}

function legacyContext(workspaceRoot: string, authorityRoot: string): RuntimeStorageContext {
  return createRuntimeStorageContext({ environment: {}, workspaceRoot, authorityRoot });
}

function externalContext(
  runtimeRoot: string,
  workspaceRoot: string,
  authorityRoot: string,
): RuntimeStorageContext {
  return createRuntimeStorageContext({
    environment: { ATOLYE_RUNTIME_ROOT: runtimeRoot },
    workspaceRoot,
    authorityRoot,
  });
}

function projectSlugs(projectsRoot: string): string[] {
  try {
    return fs
      .readdirSync(projectsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^[a-zA-Z0-9-_]+$/.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * F17-B — `--candidate-directory <…/candidates/c-<24hex>>` (optional). The
 * verified migration candidate manifest's `sourceProjectIdentities` is the
 * trusted `projectId ↔ projectSlug` map for the identity-aware `prepare` /
 * `validate` comparison. A bad / unverifiable candidate fails closed.
 */
function optionalCandidateIdentities(
  args: Record<string, string | true>,
): readonly { readonly projectId: string; readonly projectSlug: string }[] | undefined {
  if (!("candidate-directory" in args)) return undefined;
  const candidateDirectory = requireDirArg(args, "candidate-directory");
  let manifest;
  try {
    manifest = verifyMigrationCandidate(candidateDirectory).manifest;
  } catch {
    throw new CommandInputError("--candidate-directory did not verify as a migration candidate");
  }
  const identities = manifest.sourceBackup.sourceProjectIdentities;
  if (!identities || identities.length === 0) {
    throw new CommandInputError("candidate manifest carries no sourceProjectIdentities");
  }
  return identities.map((entry) => ({ projectId: entry.projectId, projectSlug: entry.projectSlug }));
}

async function scanDurableRecovery(
  projectsRoot: string,
): Promise<"clean" | "recovery-required" | "indeterminate"> {
  let worst: "clean" | "recovery-required" | "indeterminate" = "clean";
  for (const slug of projectSlugs(projectsRoot)) {
    const store = path.join(projectsRoot, slug, "production-execution");
    if (!fs.existsSync(store)) continue;
    const scan = await new ProductionExecutionDurableRecoveryService({
      trustedRootDirectory: store,
    }).scan();
    if (scan.decision === "recovery-required") return "recovery-required";
    if (scan.decision === "indeterminate") worst = "indeterminate";
  }
  return worst;
}

function summarize(record: RuntimeAuthorityTransitionRecord): Record<string, unknown> {
  return {
    transitionId: record.transitionId,
    kind: resolveRuntimeAuthorityTransitionKind(record),
    state: record.state,
    updatedAt: record.updatedAt,
  };
}

function ok(body: Record<string, unknown>): RuntimeAuthorityTransitionCommandResult {
  return { report: { ok: true, ...body }, exitCode: 0 };
}

function fail(code: string, detail: string): RuntimeAuthorityTransitionCommandResult {
  return { report: { ok: false, code, detail }, exitCode: 1 };
}
