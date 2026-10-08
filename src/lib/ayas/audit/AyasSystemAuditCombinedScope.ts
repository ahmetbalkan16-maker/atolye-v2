/**
 * Opt-in combined protected inventory — Stage 17 protected-scope review
 * (STAGE17_PROTECTED_SCOPE_INTEGRATION_REVIEW_fde898f.md), steps 1–3, with the
 * F98 conditions of the independent budget review
 * (STAGE17_COMBINED_BUDGET_INDEPENDENT_REVIEW.md).
 *
 * Measures the fixed repository protected roots together with the explicit
 * external runtime and authority roots under one coverage manifest, so one
 * audit interval can be bounded by two inventories of the same scope. Paths
 * are only resolved and validated: nothing is created, no authority is
 * acquired, no state is bootstrapped and no env/credential body is opened.
 * The default local collector, its budgets and its frozen tests are unchanged.
 *
 * Fail-closed: an invalid or missing external root, external roots that the
 * active published authority does not name, overlapping roots, a link or
 * hardlink, a changed root identity, an unreadable or changing entry, an
 * exceeded budget or any credential exclusion leaves the inventory incomplete
 * with an explicit reason. Completeness covers this manifest only; it binds
 * no TEST/LIVE slot, attributes no change and grants nothing.
 *
 * Owner policy 2026-10-08 (F98): a missing required root or store is an
 * incompleteness reason, never coverage. A root proven optional carries a
 * recorded exception (scope and reason); its absence is still a reason, so an
 * exception never counts toward a full-scope PASS.
 */
import fs from "node:fs";
import path from "node:path";

import { initialRuntimeAuthorityGeneration } from "../../runtime/ProductionRuntimeOperationContext";
import { createRuntimeStorageContext, validateSafeAncestorChain } from "../../runtime/RuntimeStoragePaths";
import { isMarkerShape, describeRuntimeAuthorityIdentity } from "../../runtime/security/RuntimeAuthorityGenerationMarker";
import { isActiveRecord, isTransitionRecord, runtimeAuthorityTransitionInProgressStates } from "../../runtime/security/RuntimeAuthorityTransition";
import { AYAS_AUDIT_CREDENTIAL_PATH, auditAncestry, auditDigest, auditReadFile } from "./AyasSystemAuditCollector";
import { freezeAudit } from "./AyasSystemAuditModel";
import { AYAS_AUDIT_PROTECTED_ROOTS } from "./AyasSystemAuditRegistry";

export const AYAS_AUDIT_COMBINED_SCOPE = "COMBINED_REPOSITORY_RUNTIME_AUTHORITY_V1" as const;

/**
 * Budget for the combined scope. Measured 2026-10-08: repository roots 6,580
 * files / 626 MB, runtime 2,374 files / 611 MB (largest file 12.6 MB),
 * authority 4 files. Per-file and depth limits stay those of the streaming
 * local mode; files, bytes and time are raised for the larger scope only here.
 */
export const AYAS_AUDIT_COMBINED_BUDGET = freezeAudit({
  id: "combined-budget-v1" as const,
  maxFiles: 40_000,
  maxBytes: 2 * 1024 * 1024 * 1024,
  maxFileBytes: 16 * 1024 * 1024,
  maxDepth: 20,
  deadlineMs: 300_000,
});

const BUDGET_LIMITS = ["maxFiles", "maxBytes", "maxFileBytes", "maxDepth", "deadlineMs"] as const;
type AyasAuditCombinedBudgetLimit = (typeof BUDGET_LIMITS)[number];

export interface AyasAuditCombinedBudget extends Readonly<Record<AyasAuditCombinedBudgetLimit, number>> {
  readonly id: string;
}

export interface AyasAuditCombinedOptions {
  /** Limits may only be tightened below the reviewed budget (boundary tests); a looser value is refused. */
  readonly budget?: Partial<Record<AyasAuditCombinedBudgetLimit, number>>;
}

export type AyasAuditCombinedRootKind = "REPOSITORY" | "RUNTIME" | "AUTHORITY";

/** Stores the review requires the combined scope to cover; each must exist and lie inside exactly one measured root. */
export const AYAS_AUDIT_COMBINED_STORES = freezeAudit([
  { store: "private-memory", kind: "REPOSITORY", relative: "data/brain/memory" },
  { store: "approvals", kind: "REPOSITORY", relative: "data/brain/autonomy" },
  { store: "revenue", kind: "REPOSITORY", relative: "data/brain/revenue" },
  { store: "production-projects", kind: "RUNTIME", relative: "projects" },
  { store: "runtime-authority", kind: "AUTHORITY", relative: "." },
] as const);

/**
 * Repository protected roots proven optional (F98, 2026-10-08). Scope: absence
 * only; a present root is measured like any other. No source module resolves
 * or writes these paths: the legacy in-repository runtime is `data/` (measured
 * as `data/projects`), and the configured runtime and authority are the bound
 * external roots. An exception that `requires` the external binding applies
 * only while that binding is verified. Absence remains an incompleteness reason.
 */
export const AYAS_AUDIT_COMBINED_ROOT_EXCEPTIONS = freezeAudit([
  { id: "repository:runtime", scope: "ABSENCE_ONLY", requires: "EXTERNAL_BINDING_ACTIVE_MATCH", reason: "not a runtime root in any resolver mode; the configured runtime is the bound external root" },
  { id: "repository:authority", scope: "ABSENCE_ONLY", requires: "EXTERNAL_BINDING_ACTIVE_MATCH", reason: "the configured authority is the bound external root; no source module writes an in-repository authority" },
  { id: "repository:projects", scope: "ABSENCE_ONLY", requires: null, reason: "no resolver or writer targets <repository>/projects; production projects live in the runtime projects store" },
  { id: "repository:.atolye", scope: "ABSENCE_ONLY", requires: null, reason: "no source module references <repository>/.atolye" },
] as const);

export interface AyasAuditCombinedRootsInput {
  readonly repository: string;
  readonly runtime: string;
  readonly authority: string;
  /** Trusted operator configuration, separate from the roots under audit. Missing either root always leaves coverage incomplete. */
  readonly configured?: { readonly runtime?: string; readonly authority?: string };
}

export interface AyasAuditCombinedRootRow {
  readonly id: string;
  readonly kind: AyasAuditCombinedRootKind;
  readonly state: "MEASURED" | "ABSENT" | "INVALID" | "UNREADABLE";
  readonly requirement: "REQUIRED" | "DECLARED_OPTIONAL";
  readonly exception: { readonly scope: string; readonly reason: string; readonly applied: boolean } | null;
  readonly files: number;
  readonly bytes: number;
}

export interface AyasAuditCombinedExternalBinding {
  /** ACTIVE_MATCH: the active published authority names exactly this workspace/runtime/authority binding and the runtime marker matches it. */
  readonly authorityControlPlane: "ACTIVE_MATCH" | "UNBOUND" | "UNREADABLE" | "NOT_EVALUATED";
  readonly bindingDigest: string | null;
  readonly configuredRuntime: "MATCH" | "MISMATCH" | "NOT_PROVIDED";
  readonly configuredAuthority: "MATCH" | "MISMATCH" | "NOT_PROVIDED";
}

export type AyasAuditCombinedCoverage = "FULL" | "INCOMPLETE_DECLARED_EXCEPTIONS_ONLY" | "INCOMPLETE";

export interface AyasAuditCombinedInventory {
  readonly digest: string;
  readonly complete: boolean;
  readonly coverage: AyasAuditCombinedCoverage;
  readonly files: number;
  readonly scope: typeof AYAS_AUDIT_COMBINED_SCOPE;
  readonly coverageManifestDigest: string;
  readonly budgetId: string;
  readonly budget: AyasAuditCombinedBudget;
  readonly bytesHashed: number;
  readonly externalRuntimeQualified: boolean;
  readonly externalBinding: AyasAuditCombinedExternalBinding;
  readonly roots: readonly AyasAuditCombinedRootRow[];
  readonly stores: readonly { readonly store: string; readonly coveredBy: string | null; readonly presence: "PRESENT" | "ABSENT" | "INVALID" | "UNKNOWN" }[];
  readonly exclusions: { credentialFiles: number; sizeOrByteBudgetFiles: number; linkOrSpecialEntries: number; depthOrFileLimitStops: number; unreadableRoots: number };
  readonly incompleteReasons: readonly string[];
}

interface MeasuredRoot {
  readonly id: string;
  readonly kind: AyasAuditCombinedRootKind;
  /** Ancestry base: no component between it and `target` may be a link. */
  readonly base: string;
  readonly target: string;
}

const contained = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const identityOf = (real: string): string => {
  const stat = fs.statSync(real);
  return `${stat.dev}:${stat.ino}`;
};

/** The entry itself, never its link target; null only when nothing exists at the path. */
function entryOrNull(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function resolveBudget(tighter: AyasAuditCombinedOptions["budget"]): AyasAuditCombinedBudget {
  const reviewed = AYAS_AUDIT_COMBINED_BUDGET;
  if (tighter === undefined) return reviewed;
  if (!tighter || typeof tighter !== "object" || Object.keys(tighter).some((key) => !(BUDGET_LIMITS as readonly string[]).includes(key))) throw Error("AUDIT_BUDGET_INVALID");
  const values = Object.fromEntries(BUDGET_LIMITS.map((key) => {
    const value = tighter[key] ?? reviewed[key];
    if (!Number.isSafeInteger(value) || value < 0 || value > reviewed[key]) throw Error("AUDIT_BUDGET_INVALID");
    return [key, value];
  })) as Record<AyasAuditCombinedBudgetLimit, number>;
  const same = BUDGET_LIMITS.every((key) => values[key] === reviewed[key]);
  return freezeAudit({ id: same ? reviewed.id : `${reviewed.id}+tightened`, ...values });
}

/** An explicit external root: existing, link-free ancestor chain, a real directory. Never created. */
function resolveExternalRoot(kind: "RUNTIME" | "AUTHORITY", value: unknown, reasons: Set<string>): string | null {
  if (typeof value !== "string" || !path.isAbsolute(value) || /[\0\r\n]/.test(value)) {
    reasons.add(`${kind}_ROOT_INVALID`);
    return null;
  }
  try {
    const nearest = validateSafeAncestorChain(value);
    if (path.relative(nearest, path.resolve(value)) !== "") {
      reasons.add(`${kind}_ROOT_ABSENT`);
      return null;
    }
    const stat = fs.lstatSync(value);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error("AUDIT_ROOT_INVALID");
    return fs.realpathSync.native(value);
  } catch {
    reasons.add(`${kind}_ROOT_INVALID`);
    return null;
  }
}

/**
 * Read-only binding of the external roots to the configured ones: the active
 * published authority must name exactly this workspace/runtime/authority
 * binding, the runtime marker must match it, and the recovery gate (not
 * quarantined, no transition in progress) must pass. Nothing is written.
 */
function bindExternalRoots(repository: string, runtime: string, authority: string, budget: AyasAuditCombinedBudget, deadline: number, clock: () => number): { state: AyasAuditCombinedExternalBinding["authorityControlPlane"]; digest: string | null } {
  try {
    const context = createRuntimeStorageContext({ environment: { ATOLYE_RUNTIME_ROOT: runtime, ATOLYE_RUNTIME_AUTHORITY_ROOT: authority }, workspaceRoot: repository });
    const expected = describeRuntimeAuthorityIdentity(context, initialRuntimeAuthorityGeneration);
    let readFiles = 0, readBytes = 0;
    // These audit reads must never use production readFileSync readers: they can enumerate credential-named transitions before the inventory excludes them.
    const read = (base: string, relative: string, limit: number): unknown => {
      if (clock() > deadline || AYAS_AUDIT_CREDENTIAL_PATH.test(relative)) throw Error("AUDIT_BINDING_UNSAFE");
      const file = path.join(base, relative);
      validateSafeAncestorChain(path.dirname(file));
      const stat = fs.lstatSync(file);
      readFiles += 1; readBytes += stat.size;
      if (readFiles > budget.maxFiles || readBytes > budget.maxBytes) throw Error("AUDIT_BINDING_BOUND");
      const body = auditReadFile(base, file, stat, Math.min(limit, budget.maxFileBytes), true).body;
      if (!body) throw Error("AUDIT_BINDING_INVALID");
      return JSON.parse(body.toString("utf8"));
    };
    const active = read(authority, "authority-transition-v1/active-authority.json", 128 * 1024);
    const marker = read(runtime, "projects/.runtime-authority-generation.json", 16 * 1024);
    if (!isActiveRecord(active) || !isMarkerShape(marker)) throw Error("AUDIT_BINDING_INVALID");
    const bound = active.resolverBindingIdentity === expected.resolverBindingIdentity && active.authorityIdentity === expected.authorityIdentity && active.authorityGeneration === initialRuntimeAuthorityGeneration && Object.entries(expected).every(([key, value]) => marker[key as keyof typeof marker] === value);
    if (!bound) return { state: "UNBOUND", digest: null };
    const quarantine = path.join(authority, "authority-transition-v1/quarantine", expected.resolverBindingIdentity + ".json");
    validateSafeAncestorChain(path.dirname(quarantine));
    // A quarantine mark (including rollback/lift) needs a separate qualification; never grant an audit exception from it.
    if (entryOrNull(quarantine) !== null) return { state: "UNBOUND", digest: null };
    const directory = path.join(authority, "authority-transition-v1/transitions");
    validateSafeAncestorChain(directory);
    const directoryStat = entryOrNull(directory);
    if (directoryStat !== null) {
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw Error("AUDIT_BINDING_UNSAFE");
      const names = fs.readdirSync(directory).sort();
      if (names.length > budget.maxFiles) throw Error("AUDIT_BINDING_BOUND");
      for (const name of names) {
        if (clock() > deadline || AYAS_AUDIT_CREDENTIAL_PATH.test("authority-transition-v1/transitions/" + name)) throw Error("AUDIT_BINDING_UNSAFE");
        const match = /^([a-zA-Z0-9][a-zA-Z0-9._:-]{7,127})\.json$/.exec(name);
        if (!match) continue;
        const record = read(authority, "authority-transition-v1/transitions/" + name, 128 * 1024);
        if (!isTransitionRecord(record) || record.transitionId !== match[1]) throw Error("AUDIT_BINDING_INVALID");
        if (record.source.resolverBindingIdentity === expected.resolverBindingIdentity && runtimeAuthorityTransitionInProgressStates.has(record.state)) return { state: "UNBOUND", digest: null };
      }
    }
    return { state: "ACTIVE_MATCH", digest: expected.resolverBindingIdentity };
  } catch {
    return { state: "UNBOUND", digest: null };
  }
}

function configuredState(value: unknown, real: string | null): AyasAuditCombinedExternalBinding["configuredRuntime"] {
  if (value === undefined || value === "") return "NOT_PROVIDED";
  try {
    if (typeof value !== "string" || !path.isAbsolute(value) || real === null || fs.lstatSync(value).isSymbolicLink()) return "MISMATCH";
    validateSafeAncestorChain(value);
    const configured = fs.realpathSync.native(value);
    return configured === real && identityOf(configured) === identityOf(real) ? "MATCH" : "MISMATCH";
  } catch {
    return "MISMATCH";
  }
}

export function inventoryAyasAuditCombinedScope(input: AyasAuditCombinedRootsInput, clock: () => number = Date.now, options: AyasAuditCombinedOptions = {}): AyasAuditCombinedInventory {
  if (!input || typeof input !== "object") throw Error("AUDIT_COMBINED_ROOTS_INVALID");
  const repositoryInput = input.repository;
  if (typeof repositoryInput !== "string" || !path.isAbsolute(repositoryInput) || !fs.existsSync(repositoryInput) || fs.lstatSync(repositoryInput).isSymbolicLink()) {
    throw Error("AUDIT_ROOT_INVALID");
  }
  const budget = resolveBudget(options?.budget);
  const reasons = new Set<string>();
  const repository = fs.realpathSync.native(repositoryInput);
  const runtime = resolveExternalRoot("RUNTIME", input.runtime, reasons);
  const authority = resolveExternalRoot("AUTHORITY", input.authority, reasons);
  const baseOf = (kind: AyasAuditCombinedRootKind): string | null => (kind === "REPOSITORY" ? repository : kind === "RUNTIME" ? runtime : authority);

  const deadline = clock() + budget.deadlineMs;
  const bound = runtime && authority ? bindExternalRoots(repository, runtime, authority, budget, deadline, clock) : { state: "NOT_EVALUATED" as const, digest: null };
  if (bound.state === "UNBOUND" || bound.state === "NOT_EVALUATED") reasons.add("EXTERNAL_ROOTS_UNBOUND");
  else if (bound.state === "UNREADABLE") reasons.add("EXTERNAL_ROOTS_BINDING_UNREADABLE");
  const externalBinding: AyasAuditCombinedExternalBinding = {
    authorityControlPlane: bound.state,
    bindingDigest: bound.digest,
    configuredRuntime: configuredState(input.configured?.runtime, runtime),
    configuredAuthority: configuredState(input.configured?.authority, authority),
  };
  if (externalBinding.configuredRuntime !== "MATCH") reasons.add("RUNTIME_ROOT_NOT_CONFIGURED");
  if (externalBinding.configuredAuthority !== "MATCH") reasons.add("AUTHORITY_ROOT_NOT_CONFIGURED");

  const measured: MeasuredRoot[] = [
    ...AYAS_AUDIT_PROTECTED_ROOTS.map((relative) => ({ id: `repository:${relative}`, kind: "REPOSITORY" as const, base: repository, target: path.join(repository, relative) })),
    ...(runtime ? [{ id: "runtime", kind: "RUNTIME" as const, base: runtime, target: runtime }] : []),
    ...(authority ? [{ id: "authority", kind: "AUTHORITY" as const, base: authority, target: authority }] : []),
  ];

  // Overlapping roots would measure the same bytes twice or hide one root inside another.
  for (let i = 0; i < measured.length; i += 1) {
    for (let j = i + 1; j < measured.length; j += 1) {
      const a = measured[i]!, b = measured[j]!;
      if (contained(a.target, b.target) || contained(b.target, a.target)) reasons.add(`ROOT_OVERLAP:${a.id}|${b.id}`);
    }
  }

  const stores = AYAS_AUDIT_COMBINED_STORES.map(({ store, kind, relative }) => {
    const base = baseOf(kind);
    const target = base ? path.join(base, relative) : null;
    const covering = target ? measured.filter((root) => root.kind === kind && contained(root.target, target)) : [];
    if (covering.length !== 1) reasons.add(`STORE_UNCOVERED:${store}`);
    // A store is covered only when it exists as a real directory inside its root; an absent store is a reason, never coverage.
    let presence: "PRESENT" | "ABSENT" | "INVALID" | "UNKNOWN" = "UNKNOWN";
    if (base && target) {
      try {
        const entry = entryOrNull(target);
        presence = entry === null ? "ABSENT" : entry.isDirectory() && !entry.isSymbolicLink() && auditAncestry(base, target) ? "PRESENT" : "INVALID";
      } catch {
        presence = "INVALID";
      }
      if (presence === "ABSENT") reasons.add(`STORE_ABSENT:${store}`);
      else if (presence === "INVALID") reasons.add(`STORE_INVALID:${store}`);
    }
    return { store, coveredBy: covering.length === 1 ? covering[0]!.id : null, presence };
  });

  const identities = new Map<string, string>();
  for (const [kind, real] of [["REPOSITORY", repository], ["RUNTIME", runtime], ["AUTHORITY", authority]] as const) {
    if (!real) continue;
    try {
      identities.set(kind, identityOf(real));
    } catch {
      reasons.add(`${kind}_ROOT_INVALID`);
    }
  }
  const exceptionOf = (id: string) => AYAS_AUDIT_COMBINED_ROOT_EXCEPTIONS.find((item) => item.id === id) ?? null;
  const coverageManifestDigest = auditDigest(JSON.stringify({
    scope: AYAS_AUDIT_COMBINED_SCOPE,
    budget,
    roots: measured.map(({ id, kind }) => ({ id, kind, exception: exceptionOf(id) })),
    stores: AYAS_AUDIT_COMBINED_STORES,
    identities: (["REPOSITORY", "RUNTIME", "AUTHORITY"] as const).map((kind) => {
      const real = baseOf(kind), identity = identities.get(kind);
      return real && identity ? auditDigest(`${kind}\n${real}\n${identity}`) : null;
    }),
    externalBinding,
  }));

  const exclusions = { credentialFiles: 0, sizeOrByteBudgetFiles: 0, linkOrSpecialEntries: 0, depthOrFileLimitStops: 0, unreadableRoots: 0 };
  const parts: string[] = [`scope:${AYAS_AUDIT_COMBINED_SCOPE}`, `manifest:${coverageManifestDigest}`];
  const rows: AyasAuditCombinedRootRow[] = [];
  let files = 0, total = 0, timedOut = false;

  for (const root of measured) {
    const exception = exceptionOf(root.id);
    const row = {
      id: root.id, kind: root.kind, state: "MEASURED" as AyasAuditCombinedRootRow["state"],
      requirement: (exception ? "DECLARED_OPTIONAL" : "REQUIRED") as AyasAuditCombinedRootRow["requirement"],
      exception: exception ? { scope: exception.scope, reason: exception.reason, applied: false } : null,
      files: 0, bytes: 0,
    };
    rows.push(row);
    const visit = (file: string, depth: number): void => {
      if (timedOut) return;
      if (clock() > deadline) {
        timedOut = true;
        reasons.add("TIME_BUDGET_EXCEEDED");
        return;
      }
      if (depth > budget.maxDepth || files >= budget.maxFiles) {
        exclusions.depthOrFileLimitStops += 1;
        reasons.add("FILE_OR_DEPTH_BUDGET_EXCEEDED");
        return;
      }
      if (!auditAncestry(root.base, file)) {
        exclusions.linkOrSpecialEntries += 1;
        reasons.add(`LINK_OR_SPECIAL_ENTRY:${root.id}`);
        return;
      }
      const stat = fs.lstatSync(file);
      if (stat.isDirectory()) {
        for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name), depth + 1);
        return;
      }
      if (!stat.isFile() || stat.nlink !== 1) {
        exclusions.linkOrSpecialEntries += 1;
        reasons.add(`LINK_OR_SPECIAL_ENTRY:${root.id}`);
        return;
      }
      files += 1;
      row.files += 1;
      const relative = path.relative(root.base, file).replace(/\\/g, "/");
      const label = `${root.kind}:${relative}`;
      // Credentials are never opened; an excluded credential keeps the scope incomplete.
      if (AYAS_AUDIT_CREDENTIAL_PATH.test(relative)) {
        exclusions.credentialFiles += 1;
        reasons.add(`CREDENTIAL_EXCLUDED:${root.id}`);
        parts.push(`${label}:UNMEASURED:${stat.size}:${stat.mtimeMs}`);
        return;
      }
      if (stat.size > budget.maxFileBytes || total + stat.size > budget.maxBytes) {
        exclusions.sizeOrByteBudgetFiles += 1;
        reasons.add("SIZE_OR_BYTE_BUDGET_EXCEEDED");
        parts.push(`${label}:UNMEASURED:${stat.size}:${stat.mtimeMs}`);
        return;
      }
      const result = auditReadFile(root.base, file, stat, Math.min(budget.maxFileBytes, budget.maxBytes - total));
      total += stat.size;
      row.bytes += stat.size;
      parts.push(`${label}:${result.digest}`);
    };
    try {
      const entry = entryOrNull(root.target);
      if (entry === null) {
        row.state = "ABSENT";
        parts.push(`${root.id}:ABSENT`);
        const applied = exception !== null && (exception.requires === null || (externalBinding.authorityControlPlane === "ACTIVE_MATCH" && externalBinding.configuredRuntime === "MATCH" && externalBinding.configuredAuthority === "MATCH"));
        row.exception = row.exception ? { ...row.exception, applied } : null;
        // An absent root is never coverage: a required one is a gap, an excepted one is recorded but still incomplete.
        reasons.add(applied ? `ROOT_ABSENT_DECLARED_OPTIONAL:${root.id}` : `ROOT_ABSENT:${root.id}`);
      } else if (entry.isSymbolicLink() || !entry.isDirectory()) {
        // A link (dangling or not) or a non-directory root is neither absent nor measurable.
        row.state = "INVALID";
        exclusions.linkOrSpecialEntries += 1;
        reasons.add(`LINK_OR_SPECIAL_ENTRY:${root.id}`);
        parts.push(`${root.id}:INVALID`);
      } else visit(root.target, 0);
    } catch {
      row.state = "UNREADABLE";
      exclusions.unreadableRoots += 1;
      reasons.add(`UNREADABLE_OR_CHANGED:${root.id}`);
      parts.push(`${root.id}:UNREADABLE`);
    }
  }
  if (!runtime) rows.push({ id: "runtime", kind: "RUNTIME", state: "INVALID", requirement: "REQUIRED", exception: null, files: 0, bytes: 0 });
  if (!authority) rows.push({ id: "authority", kind: "AUTHORITY", state: "INVALID", requirement: "REQUIRED", exception: null, files: 0, bytes: 0 });

  // A root replaced or re-pointed while it was measured supplies no qualified digest.
  for (const [kind, original, real] of [["REPOSITORY", repositoryInput, repository], ["RUNTIME", input.runtime, runtime], ["AUTHORITY", input.authority, authority]] as const) {
    if (!real) continue;
    try {
      if (fs.lstatSync(original).isSymbolicLink() || fs.realpathSync.native(original) !== real || identityOf(real) !== identities.get(kind)) reasons.add(`ROOT_IDENTITY_CHANGED:${kind}`);
    } catch {
      reasons.add(`ROOT_IDENTITY_CHANGED:${kind}`);
    }
  }

  const complete = reasons.size === 0;
  const declaredOnly = !complete && [...reasons].every((reason) => reason.startsWith("ROOT_ABSENT_DECLARED_OPTIONAL:"));
  return freezeAudit({
    digest: auditDigest(parts.join("\n")),
    complete,
    coverage: complete ? "FULL" : declaredOnly ? "INCOMPLETE_DECLARED_EXCEPTIONS_ONLY" : "INCOMPLETE",
    files,
    scope: AYAS_AUDIT_COMBINED_SCOPE,
    coverageManifestDigest,
    budgetId: budget.id,
    budget,
    bytesHashed: total,
    externalRuntimeQualified: complete,
    externalBinding,
    roots: rows,
    stores,
    exclusions,
    incompleteReasons: [...reasons].sort(),
  });
}
