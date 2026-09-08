import fs from "node:fs";
import path from "node:path";
import {
  createRuntimeStorageContext,
  validateSafeAncestorChain,
  type RuntimeStorageContext,
} from "@/lib/runtime/RuntimeStoragePaths";
import { initialRuntimeAuthorityGeneration } from "@/lib/runtime/ProductionRuntimeOperationContext";
import { ProductionExecutionDurableRecoveryService } from "@/lib/production/ProductionExecutionPersistence";
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
        const record = prepareTransition({
          store,
          transitionId,
          sourceProjectSlugs: projectSlugs(sourceProjects),
          sourceProjectsRoot: sourceProjects,
        });
        return ok({
          prepared: summarize(record),
          fileCount: record.sourceFreeze?.fileCount ?? null,
          contentDigest: record.sourceFreeze?.contentDigest ?? null,
        });
      }

      case "validate": {
        const transitionId = requireTransitionId(args);
        const target = requireDirArg(args, "target");
        const targetProjects = path.join(target, "projects");
        const record = validateTarget({
          store,
          transitionId,
          targetContext: externalContext(target, workspaceRoot, authorityRoot),
          targetAuthorityGeneration: generation,
          targetProjectSlugs: projectSlugs(targetProjects),
          targetProjectsRoot: targetProjects,
        });
        return ok({ validated: summarize(record), byteExact: record.targetValidation?.byteExact ?? false });
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

      default:
        throw new CommandInputError(
          `unknown subcommand ${JSON.stringify(subcommand ?? "")} — expected one of: status, begin-genesis, begin-relocation, begin-recovery, quiesce, prepare, validate, publish, quarantine, fail`,
        );
    }
  } catch (error) {
    if (error instanceof CommandInputError) {
      return fail("AUTHORITY_TRANSITION_INPUT_INVALID", error.message);
    }
    if (error instanceof RuntimeAuthorityTransitionError) {
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
  const value = requireArg(args, "transition-id");
  if (!isValidRuntimeAuthorityTransitionId(value)) {
    throw new CommandInputError("--transition-id is malformed (8–128 chars, [A-Za-z0-9._:-])");
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
