import crypto from "node:crypto";

/**
 * Stage 15O — golden benchmark and regression vault, the contract.
 *
 * A vault version is a fixed list of golden cases. Each case is one
 * deterministic, offline suite and the exact bytes of its grader and fixtures.
 * A change that improves its target but leaves one golden case red does not go
 * forward: `evaluateAyasGoldenRegression` answers that question and nothing else.
 *
 * Versions are append-only and chained by digest. A canonical domain that has
 * no golden case yet is a declared gap; a gap is reported with every decision
 * and never counted as held.
 *
 * Pure: no filesystem, no clock, no network. Evidence, never authority:
 * nothing here approves, promotes, schedules or executes anything.
 */
export const AYAS_GOLDEN_DOMAINS = Object.freeze(["CONVERSATION", "MEMORY_RETRIEVAL", "CODING_REPAIR", "SECURITY_ADVERSARIAL", "PRODUCTION_RECOVERY", "HISTORICAL_VIDEO", "REVENUE_DRY_RUN", "BRAIN_UI"] as const);
export type AyasGoldenDomain = (typeof AYAS_GOLDEN_DOMAINS)[number];

export interface AyasGoldenPin { readonly file: string; readonly sha256: string; }
export interface AyasGoldenCase {
  readonly id: string;
  readonly domain: AyasGoldenDomain;
  /** Run with no arguments; exit status 0 is the only pass. */
  readonly script: string;
  /** The script itself and every grader or fixture file under `scripts/` its result depends on. */
  readonly pins: readonly AyasGoldenPin[];
  readonly covers: string;
}
/** What a domain does not have yet, and what would change that. */
export interface AyasGoldenGap { readonly domain: AyasGoldenDomain; readonly missing: string; readonly reevaluateWhen: string; }
export interface AyasGoldenVault {
  readonly schemaVersion: "1";
  readonly version: number;
  /** Digest of the version before this one; null only for version 1. */
  readonly previousDigest: string | null;
  readonly cases: readonly AyasGoldenCase[];
  readonly gaps: readonly AyasGoldenGap[];
}

const HASH = /^[a-f0-9]{64}$/;
const CASE_ID = /^golden\.[a-z0-9]+(?:[.-][a-z0-9]+){1,8}$/;
const SCRIPT = /^scripts\/smoke-[a-z0-9-]+\.ts$/;
const PIN_FILE = /^scripts\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:ts|tsx|json)$/;
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const isDomain = (value: unknown): value is AyasGoldenDomain => (AYAS_GOLDEN_DOMAINS as readonly unknown[]).includes(value);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function isAyasGoldenVault(raw: unknown): raw is AyasGoldenVault {
  if (!plain(raw) || !exact(raw, ["schemaVersion", "version", "previousDigest", "cases", "gaps"]) || raw.schemaVersion !== "1"
    || !Number.isSafeInteger(raw.version) || (raw.version as number) < 1 || (raw.version as number) > 10_000
    || (raw.version === 1 ? raw.previousDigest !== null : typeof raw.previousDigest !== "string" || !HASH.test(raw.previousDigest))
    || !Array.isArray(raw.cases) || raw.cases.length === 0 || raw.cases.length > 200 || !Array.isArray(raw.gaps) || raw.gaps.length > AYAS_GOLDEN_DOMAINS.length) return false;
  const ids = new Set<string>(); const scripts = new Set<string>(); const covered = new Set<string>();
  for (const item of raw.cases) {
    if (!plain(item) || !exact(item, ["id", "domain", "script", "pins", "covers"]) || typeof item.id !== "string" || !CASE_ID.test(item.id) || ids.has(item.id)
      || !isDomain(item.domain) || typeof item.script !== "string" || !SCRIPT.test(item.script) || scripts.has(item.script)
      || !text(item.covers, 300) || !Array.isArray(item.pins) || item.pins.length === 0 || item.pins.length > 30) return false;
    const files = new Set<string>();
    for (const pin of item.pins) {
      if (!plain(pin) || !exact(pin, ["file", "sha256"]) || typeof pin.file !== "string" || !PIN_FILE.test(pin.file) || files.has(pin.file)
        || typeof pin.sha256 !== "string" || !HASH.test(pin.sha256)) return false;
      files.add(pin.file);
    }
    if (!files.has(item.script)) return false;
    ids.add(item.id); scripts.add(item.script); covered.add(item.domain);
  }
  const gapDomains = new Set<string>();
  for (const gap of raw.gaps) {
    if (!plain(gap) || !exact(gap, ["domain", "missing", "reevaluateWhen"]) || !isDomain(gap.domain) || gapDomains.has(gap.domain)
      || !text(gap.missing, 400) || !text(gap.reevaluateWhen, 400)) return false;
    gapDomains.add(gap.domain);
  }
  // No canonical domain may disappear: each one has a golden case, a declared gap, or both.
  return AYAS_GOLDEN_DOMAINS.every((domain) => covered.has(domain) || gapDomains.has(domain));
}

export function ayasGoldenVaultDigest(vault: AyasGoldenVault): string {
  return crypto.createHash("sha256").update(`AYAS_GOLDEN_VAULT_V1\n${canonical(vault)}`, "utf8").digest("hex");
}

export type AyasGoldenChainProblem = "CHAIN_EMPTY" | "VERSION_INVALID" | "VERSION_NOT_CONTIGUOUS" | "PREVIOUS_DIGEST_MISMATCH" | "CASE_REMOVED_WITHOUT_RECORD" | "RETIREMENT_RECORD_INVALID";

/**
 * Every version ever published, oldest first. A later version may add cases, re-pin files and close gaps.
 * A case that was golden once leaves only by name: `retired[version]` lists the ids that version drops and why.
 */
export function auditAyasGoldenVaultChain(versions: readonly AyasGoldenVault[], retired: Readonly<Record<number, Readonly<Record<string, string>>>> = {}): readonly AyasGoldenChainProblem[] {
  if (!Array.isArray(versions) || versions.length === 0) return ["CHAIN_EMPTY"];
  const problems = new Set<AyasGoldenChainProblem>();
  let prior: AyasGoldenVault | undefined;
  versions.forEach((vault, index) => {
    if (!isAyasGoldenVault(vault)) { problems.add("VERSION_INVALID"); prior = undefined; return; }
    if (vault.version !== index + 1) problems.add("VERSION_NOT_CONTIGUOUS");
    if (index === 0 ? vault.previousDigest !== null : !prior || vault.previousDigest !== ayasGoldenVaultDigest(prior)) problems.add("PREVIOUS_DIGEST_MISMATCH");
    const named = retired[vault.version] ?? {};
    const now = new Set(vault.cases.map((item) => item.id));
    const before = new Set(prior ? prior.cases.map((item) => item.id) : []);
    // A retirement names a case of the version before it, gives a reason, and the case is really gone.
    if (Object.entries(named).some(([id, reason]) => !before.has(id) || now.has(id) || !text(reason, 400))) problems.add("RETIREMENT_RECORD_INVALID");
    if ([...before].some((id) => !now.has(id) && !Object.hasOwn(named, id))) problems.add("CASE_REMOVED_WITHOUT_RECORD");
    prior = vault;
  });
  if (Object.keys(retired).some((version) => !versions.some((vault) => plain(vault) && String(vault.version) === version))) problems.add("RETIREMENT_RECORD_INVALID");
  return [...problems].sort();
}

/** Every pinned file whose bytes differ from the vault, sorted. An unreadable file is a drifted file. */
export function verifyAyasGoldenVaultPins(vault: AyasGoldenVault, read: (file: string) => Uint8Array): readonly string[] {
  if (!isAyasGoldenVault(vault)) return ["VAULT_INVALID"];
  const drift = new Set<string>();
  for (const item of vault.cases) for (const pin of item.pins) {
    try { if (crypto.createHash("sha256").update(read(pin.file)).digest("hex") !== pin.sha256) drift.add(pin.file); }
    catch { drift.add(pin.file); }
  }
  return [...drift].sort();
}

export interface AyasGoldenCaseResult { readonly id: string; readonly pass: boolean; readonly timedOut: boolean; }
/** One run of the whole vault against one tree. */
export interface AyasGoldenRun {
  readonly vaultDigest: string;
  /** Pinned files that did not match in the tree the cases ran in. */
  readonly pinDrift: readonly string[];
  readonly results: readonly AyasGoldenCaseResult[];
}
export type AyasGoldenDecision = "GOLDEN_HELD" | "PROMOTION_STOPPED" | "GOLDEN_NOT_MEASURED" | "GOLDEN_VAULT_CHANGED";
export interface AyasGoldenRegressionResult {
  readonly decision: AyasGoldenDecision;
  readonly vaultVersion: number | null;
  readonly vaultDigest: string | null;
  readonly cases: number;
  /** Not golden in the candidate tree. */
  readonly failingCaseIds: readonly string[];
  /** Of those, the ones a supplied baseline result shows were golden before the change. Empty without a baseline. */
  readonly regressedCaseIds: readonly string[];
  /** Canonical domains with a declared gap. Reported with every decision; never part of "held". */
  readonly gapDomains: readonly AyasGoldenDomain[];
  readonly reasonCodes: readonly string[];
  readonly authority: "NONE";
}

function measured(vault: AyasGoldenVault, run: AyasGoldenRun): Map<string, AyasGoldenCaseResult> | null {
  if (!Array.isArray(run.results) || run.results.length !== vault.cases.length) return null;
  const byId = new Map<string, AyasGoldenCaseResult>();
  for (const result of run.results as readonly unknown[]) {
    if (!plain(result) || typeof result.id !== "string" || typeof result.pass !== "boolean" || typeof result.timedOut !== "boolean" || byId.has(result.id)) return null;
    byId.set(result.id, { id: result.id, pass: result.pass, timedOut: result.timedOut });
  }
  return vault.cases.every((item) => byId.has(item.id)) ? byId : null;
}
/**
 * A baseline may cover any part of the vault: it is only asked about the cases that are red in the candidate tree.
 * Each result is well-formed and names its case once, or the baseline says nothing at all. A result for a case this
 * vault does not have is never looked up, so it explains nothing.
 */
function baselineResults(vault: AyasGoldenVault, run: AyasGoldenRun): Map<string, AyasGoldenCaseResult> | null {
  if (!Array.isArray(run.results) || run.results.length > vault.cases.length) return null;
  const byId = new Map<string, AyasGoldenCaseResult>();
  for (const result of run.results as readonly unknown[]) {
    if (!plain(result) || typeof result.id !== "string" || typeof result.pass !== "boolean" || typeof result.timedOut !== "boolean" || byId.has(result.id)) return null;
    byId.set(result.id, { id: result.id, pass: result.pass, timedOut: result.timedOut });
  }
  return byId;
}
const golden = (result: AyasGoldenCaseResult | undefined) => result !== undefined && result.pass === true && result.timedOut === false;

/**
 * Is the candidate tree still golden? Ordered and fail-closed: a moved yardstick, then a missing measurement, then a
 * case that is not golden. Only when none of those holds is the answer GOLDEN_HELD.
 *
 * The decision rests on the candidate run alone: a vault case that fails in the candidate tree stops promotion whether
 * the change broke it or it was already broken. A baseline run, when one is supplied, only says which of the two it was.
 */
export function evaluateAyasGoldenRegression(input: { readonly vault: AyasGoldenVault; readonly candidate: AyasGoldenRun | null; readonly baseline?: AyasGoldenRun | null }): AyasGoldenRegressionResult {
  const none = { failingCaseIds: [], regressedCaseIds: [], authority: "NONE" as const };
  if (!isAyasGoldenVault(input.vault)) return { decision: "GOLDEN_VAULT_CHANGED", vaultVersion: null, vaultDigest: null, cases: 0, gapDomains: [], reasonCodes: ["VAULT_INVALID"], ...none };
  const vault = input.vault; const digest = ayasGoldenVaultDigest(vault);
  const shared = { vaultVersion: vault.version, vaultDigest: digest, cases: vault.cases.length, gapDomains: vault.gaps.map((gap) => gap.domain) };
  const { candidate, baseline } = input;
  if (!plain(candidate)) return { decision: "GOLDEN_NOT_MEASURED", ...shared, reasonCodes: ["CANDIDATE_NOT_RUN"], ...none };
  const moved: string[] = [];
  if (candidate.vaultDigest !== digest || (plain(baseline) && baseline.vaultDigest !== digest)) moved.push("VAULT_DIGEST_MISMATCH");
  if (!Array.isArray(candidate.pinDrift) || candidate.pinDrift.length > 0) moved.push("CANDIDATE_PIN_DRIFT");
  if (plain(baseline) && (!Array.isArray(baseline.pinDrift) || baseline.pinDrift.length > 0)) moved.push("BASELINE_PIN_DRIFT");
  if (moved.length > 0) return { decision: "GOLDEN_VAULT_CHANGED", ...shared, reasonCodes: moved, ...none };
  const after = measured(vault, candidate);
  if (!after) return { decision: "GOLDEN_NOT_MEASURED", ...shared, reasonCodes: ["CANDIDATE_RESULTS_INCOMPLETE"], ...none };
  const failing = vault.cases.filter((item) => !golden(after.get(item.id)));
  if (failing.length === 0) return { decision: "GOLDEN_HELD", ...shared, reasonCodes: ["ALL_GOLDEN_CASES_HELD"], ...none };
  const before = plain(baseline) ? baselineResults(vault, baseline) : null;
  const regressed = failing.filter((item) => golden(before?.get(item.id)));
  const redBefore = failing.filter((item) => before?.has(item.id) === true && !golden(before.get(item.id)));
  const reasonCodes = [
    ...(failing.some((item) => after.get(item.id)?.timedOut === true) ? ["GOLDEN_CASE_TIMEOUT"] : []),
    ...(failing.some((item) => after.get(item.id)?.timedOut !== true) ? ["GOLDEN_CASE_FAILED"] : []),
    ...(regressed.length + redBefore.length < failing.length ? ["BASELINE_NOT_SUPPLIED"] : []),
    ...(redBefore.length > 0 ? ["NOT_GOLDEN_AT_BASELINE"] : []),
    ...(regressed.length > 0 ? ["REGRESSED_BY_CHANGE"] : []),
  ];
  return { decision: "PROMOTION_STOPPED", ...shared, reasonCodes, authority: "NONE", failingCaseIds: failing.map((item) => item.id), regressedCaseIds: regressed.map((item) => item.id) };
}
