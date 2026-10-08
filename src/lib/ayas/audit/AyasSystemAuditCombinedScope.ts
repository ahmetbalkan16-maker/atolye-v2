/**
 * Opt-in combined protected inventory — Stage 17 protected-scope review
 * (STAGE17_PROTECTED_SCOPE_INTEGRATION_REVIEW_fde898f.md), steps 1–3.
 *
 * Measures the fixed repository protected roots together with the explicit
 * external runtime and authority roots under one coverage manifest, so one
 * audit interval can be bounded by two inventories of the same scope. Paths
 * are only resolved and validated: nothing is created, no authority is
 * acquired, no state is bootstrapped and no env/credential body is opened.
 * The default local collector, its budgets and its frozen tests are unchanged.
 *
 * Fail-closed: an invalid or missing external root, overlapping roots, a link
 * or hardlink, a changed root identity, an unreadable or changing entry, an
 * exceeded budget or any credential exclusion leaves the inventory incomplete
 * with an explicit reason. Completeness covers this manifest only; it binds
 * no TEST/LIVE slot, attributes no change and grants nothing.
 */
import fs from "node:fs";
import path from "node:path";

import { validateSafeAncestorChain } from "../../runtime/RuntimeStoragePaths";
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

export type AyasAuditCombinedRootKind = "REPOSITORY" | "RUNTIME" | "AUTHORITY";

/** Stores the review requires the combined scope to cover; each must lie inside exactly one measured root. */
export const AYAS_AUDIT_COMBINED_STORES = freezeAudit([
  { store: "private-memory", kind: "REPOSITORY", relative: "data/brain/memory" },
  { store: "approvals", kind: "REPOSITORY", relative: "data/brain/autonomy" },
  { store: "revenue", kind: "REPOSITORY", relative: "data/brain/revenue" },
  { store: "production-projects", kind: "RUNTIME", relative: "projects" },
  { store: "runtime-authority", kind: "AUTHORITY", relative: "." },
] as const);

export interface AyasAuditCombinedRootsInput {
  readonly repository: string;
  readonly runtime: string;
  readonly authority: string;
}

export interface AyasAuditCombinedRootRow {
  readonly id: string;
  readonly kind: AyasAuditCombinedRootKind;
  readonly state: "MEASURED" | "ABSENT" | "INVALID" | "UNREADABLE";
  readonly files: number;
  readonly bytes: number;
}

export interface AyasAuditCombinedInventory {
  readonly digest: string;
  readonly complete: boolean;
  readonly files: number;
  readonly scope: typeof AYAS_AUDIT_COMBINED_SCOPE;
  readonly coverageManifestDigest: string;
  readonly budgetId: typeof AYAS_AUDIT_COMBINED_BUDGET.id;
  readonly bytesHashed: number;
  readonly externalRuntimeQualified: boolean;
  readonly roots: readonly AyasAuditCombinedRootRow[];
  readonly stores: readonly { readonly store: string; readonly coveredBy: string | null }[];
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

export function inventoryAyasAuditCombinedScope(input: AyasAuditCombinedRootsInput, clock: () => number = Date.now): AyasAuditCombinedInventory {
  if (!input || typeof input !== "object") throw Error("AUDIT_COMBINED_ROOTS_INVALID");
  const repositoryInput = input.repository;
  if (typeof repositoryInput !== "string" || !path.isAbsolute(repositoryInput) || !fs.existsSync(repositoryInput) || fs.lstatSync(repositoryInput).isSymbolicLink()) {
    throw Error("AUDIT_ROOT_INVALID");
  }
  const budget = AYAS_AUDIT_COMBINED_BUDGET;
  const reasons = new Set<string>();
  const repository = fs.realpathSync.native(repositoryInput);
  const runtime = resolveExternalRoot("RUNTIME", input.runtime, reasons);
  const authority = resolveExternalRoot("AUTHORITY", input.authority, reasons);
  const baseOf = (kind: AyasAuditCombinedRootKind): string | null => (kind === "REPOSITORY" ? repository : kind === "RUNTIME" ? runtime : authority);

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
    return { store, coveredBy: covering.length === 1 ? covering[0]!.id : null };
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
  const coverageManifestDigest = auditDigest(JSON.stringify({
    scope: AYAS_AUDIT_COMBINED_SCOPE,
    budget,
    roots: measured.map(({ id, kind }) => ({ id, kind })),
    stores: AYAS_AUDIT_COMBINED_STORES,
    identities: (["REPOSITORY", "RUNTIME", "AUTHORITY"] as const).map((kind) => {
      const real = baseOf(kind), identity = identities.get(kind);
      return real && identity ? auditDigest(`${kind}\n${real}\n${identity}`) : null;
    }),
  }));

  const exclusions = { credentialFiles: 0, sizeOrByteBudgetFiles: 0, linkOrSpecialEntries: 0, depthOrFileLimitStops: 0, unreadableRoots: 0 };
  const parts: string[] = [`scope:${AYAS_AUDIT_COMBINED_SCOPE}`, `manifest:${coverageManifestDigest}`];
  const rows: AyasAuditCombinedRootRow[] = [];
  const deadline = clock() + budget.deadlineMs;
  let files = 0, total = 0, timedOut = false;

  for (const root of measured) {
    const row = { id: root.id, kind: root.kind, state: "MEASURED" as AyasAuditCombinedRootRow["state"], files: 0, bytes: 0 };
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
      if (fs.existsSync(root.target)) visit(root.target, 0);
      else {
        row.state = "ABSENT";
        parts.push(`${root.id}:ABSENT`);
      }
    } catch {
      row.state = "UNREADABLE";
      exclusions.unreadableRoots += 1;
      reasons.add(`UNREADABLE_OR_CHANGED:${root.id}`);
      parts.push(`${root.id}:UNREADABLE`);
    }
  }
  if (!runtime) rows.push({ id: "runtime", kind: "RUNTIME", state: "INVALID", files: 0, bytes: 0 });
  if (!authority) rows.push({ id: "authority", kind: "AUTHORITY", state: "INVALID", files: 0, bytes: 0 });

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
  return freezeAudit({
    digest: auditDigest(parts.join("\n")),
    complete,
    files,
    scope: AYAS_AUDIT_COMBINED_SCOPE,
    coverageManifestDigest,
    budgetId: budget.id,
    bytesHashed: total,
    externalRuntimeQualified: complete,
    roots: rows,
    stores,
    exclusions,
    incompleteReasons: [...reasons].sort(),
  });
}
