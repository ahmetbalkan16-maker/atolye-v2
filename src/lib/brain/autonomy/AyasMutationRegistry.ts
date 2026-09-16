/**
 * The closed, server-owned mapping from a proposal's `mutationKind` to the
 * one reviewed implementation it may run. Every entry here is committed,
 * reviewed source code, written and tested BEFORE any proposal referencing
 * it can exist — a proposal's free-text fields are display-only explanation,
 * never a source of executable content or file paths. There is no `eval`,
 * no dynamic `import()`/`require()` of a variable path, no shell, and no
 * client-supplied callback anywhere in this module or its callers.
 */
export class AyasMutationRegistryError extends Error {
  constructor(readonly code: "AYAS_MUTATION_KIND_UNKNOWN" | "AYAS_MUTATION_SCOPE_MISMATCH", message: string) {
    super(message);
    this.name = "AyasMutationRegistryError";
    this.stack = undefined;
  }
}

export interface AyasMutationRunResult {
  readonly changedFiles: readonly string[];
  readonly testsRun: readonly string[];
  readonly testResults: readonly string[];
}

export interface AyasMutationImplementation {
  /** Must equal the referencing proposal's own `exactFiles` exactly (order-sensitive) — checked at resolution time, before anything runs. */
  readonly exactFiles: readonly string[];
  readonly run: (repoRoot: string) => Promise<AyasMutationRunResult>;
}

/**
 * Populated one entry at a time, by hand, only when a specific improvement
 * has already been implemented and reviewed. Never populated programmatically
 * or from any external input.
 */
const AYAS_MUTATION_REGISTRY: ReadonlyMap<string, AyasMutationImplementation> = new Map([
  // (intentionally empty for M15 — the first real proposal, once created,
  // references a `mutationKind` that does not resolve here yet; resolving
  // it is a separate, explicit follow-up once a human picks and reviews it.)
]);

function sameFileList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Fails closed before any reservation/gate/mutation activity — an unknown kind or a scope mismatch never reaches Package C's authority chain. `registry` defaults to the one real, closed registry above; tests pass their own isolated map instead of ever mutating the real one. */
export function resolveAyasMutation(mutationKind: string, expectedExactFiles: readonly string[], registry: ReadonlyMap<string, AyasMutationImplementation> = AYAS_MUTATION_REGISTRY): AyasMutationImplementation {
  const impl = registry.get(mutationKind);
  if (!impl) throw new AyasMutationRegistryError("AYAS_MUTATION_KIND_UNKNOWN", `no registered mutation implementation for "${mutationKind}"`);
  if (!sameFileList(impl.exactFiles, expectedExactFiles)) throw new AyasMutationRegistryError("AYAS_MUTATION_SCOPE_MISMATCH", `registered exactFiles for "${mutationKind}" do not match the proposal's exactFiles`);
  return impl;
}

export function isAyasMutationKindRegistered(mutationKind: string, registry: ReadonlyMap<string, AyasMutationImplementation> = AYAS_MUTATION_REGISTRY): boolean {
  return registry.has(mutationKind);
}
