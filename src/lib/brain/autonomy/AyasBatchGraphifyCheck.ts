import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * M18 — a fast, AST-only Graphify structural check for ONE just-applied
 * batch-item file, run from inside the batch execution's atomic write
 * transaction (before it is accepted — see `AyasMicroBatchApprovalService`).
 *
 * Every current micro item is a deterministically-generated, single-file
 * regression test with a known, narrow shape (one import of the target
 * class + `node:assert/strict`). This check re-derives that file's real
 * import graph via Graphify's own AST extractor and confirms it matches
 * exactly what the generator declared (`expectedModules`) — catching any
 * unexpected dependency the write actually produced, independent of what
 * the (already-trusted) patch artifact claims. It never re-implements
 * Graphify's own parsing; it shells out to the same `@sentropic/graphify`
 * package the `/graphify` skill uses, so there is exactly one AST-extraction
 * implementation in this codebase's toolchain.
 *
 * Requires `@sentropic/graphify` on the global npm path (same convention
 * `scripts/ayas-access-daemon.ps1` already uses for this machine's local
 * environment specifics). A missing/broken install is a genuine execution
 * failure — "Graphify is fresh and verified for every applied change" is a
 * hard requirement of the M18 single-approval flow, never best-effort.
 *
 * Stage 10A — source truth over stored expectation. The declared count on a
 * frozen artifact is metadata; the AST of the bytes that actually landed is
 * the truth. A regex-derived declaration (`countDeclaredImportStatements`)
 * misses multi-line imports and re-exports, so a byte-exact, human-approved
 * mutation could fail here and be reverted as RECOVERY_REQUIRED on every
 * retry. A mismatch is therefore classified: when the landed bytes are the
 * approved artifact bytes, the declaration is STALE_EXPECTATION and is
 * reconciled (recorded, not failed); any other mismatch still fails closed.
 * Extraction runs on an isolated TEMP copy, so the check never writes a
 * Graphify cache into the repository and an empty extraction (no parser for
 * the language) is a failure, never "zero imports".
 */
export class AyasBatchGraphifyCheckError extends Error {
  constructor(readonly code: "AYAS_GRAPHIFY_UNAVAILABLE" | "AYAS_GRAPHIFY_UNEXPECTED_DEPENDENCY" | "AYAS_GRAPHIFY_EXTRACT_FAILED", message: string) {
    super(message);
    this.name = "AyasBatchGraphifyCheckError";
    this.stack = undefined;
  }
}

/**
 * EXPECTED_CHANGE — AST count equals the declaration.
 * STALE_EXPECTATION — they differ, but the landed bytes ARE the approved bytes: the declaration is stale; reconcile.
 * REAL_STRUCTURAL_REGRESSION — they differ and the landed bytes provably are NOT the approved bytes.
 * UNEXPECTED_CHANGE — they differ and no approved content was supplied to prove provenance.
 * EXTRACTION_FAILURE — Graphify produced nothing usable for the file.
 * (GRAPH_STALE never applies here: this check extracts the file itself and never reads `.graphify/graph.json`.)
 */
export type AyasDependencyExpectationVerdict = "EXPECTED_CHANGE" | "STALE_EXPECTATION" | "REAL_STRUCTURAL_REGRESSION" | "UNEXPECTED_CHANGE" | "EXTRACTION_FAILURE";

export interface AyasBatchGraphifyCheckResult {
  readonly filePath: string;
  readonly importEdgeCount: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly verdict: "EXPECTED_CHANGE" | "STALE_EXPECTATION";
  /** The declared count the result was compared against (differs from `importEdgeCount` only for STALE_EXPECTATION). */
  readonly declaredImportCount: number;
}

/** Pure decision table — the single place a declared/actual difference gets its meaning. */
export function classifyAyasDependencyExpectation(input: { readonly measuredImportCount: number | null; readonly nodeCount: number; readonly declaredImportCount: number; readonly landedMatchesApproved: boolean | null }): AyasDependencyExpectationVerdict {
  if (input.measuredImportCount === null || input.nodeCount === 0) return "EXTRACTION_FAILURE";
  if (input.measuredImportCount === input.declaredImportCount) return "EXPECTED_CHANGE";
  if (input.landedMatchesApproved === true) return "STALE_EXPECTATION";
  return input.landedMatchesApproved === false ? "REAL_STRUCTURAL_REGRESSION" : "UNEXPECTED_CHANGE";
}

/**
 * The global npm `node_modules` holding `@sentropic/graphify`. `AYAS_GRAPHIFY_GLOBAL_MODULES` wins; otherwise
 * npm's default global prefix for this platform (`%APPDATA%\npm` on Windows, `<node prefix>/lib` elsewhere).
 */
export function resolveAyasGraphifyGlobalModules(env: NodeJS.ProcessEnv = process.env): string {
  if (env.AYAS_GRAPHIFY_GLOBAL_MODULES) return env.AYAS_GRAPHIFY_GLOBAL_MODULES;
  if (process.platform === "win32" && env.APPDATA) return path.join(env.APPDATA, "npm", "node_modules");
  return path.join(path.dirname(path.dirname(process.execPath)), "lib", "node_modules");
}

const EXTRACT_SCRIPT = `
const path = require("path");
(async () => {
  try {
    const { collectFiles, extract } = require("@sentropic/graphify");
    const target = process.argv[1];
    const files = collectFiles(target);
    const result = await extract(files);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error("AYAS_GRAPHIFY_ERROR: " + (error && error.message ? error.message : String(error)));
    process.exit(1);
  }
})();
`;

interface RawExtraction {
  readonly nodes: readonly { readonly id: string }[];
  readonly edges: readonly { readonly source: string; readonly target: string; readonly relation: string }[];
}

/**
 * Runs Graphify's own AST extractor against ONE file's bytes, copied into a
 * private TEMP directory under its own base name (the extension selects the
 * grammar; the import-edge count does not depend on sibling files — verified
 * identical to in-tree extraction). Graphify's per-root cache lands in that
 * TEMP directory and is removed with it. Throws `AYAS_GRAPHIFY_UNAVAILABLE`
 * if the global `@sentropic/graphify` package cannot be loaded, and
 * `AYAS_GRAPHIFY_EXTRACT_FAILED` on any other extraction error.
 */
function runAyasGraphifyExtraction(content: Buffer, fileName: string): RawExtraction {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-graphify-extract-"));
  try {
    const copy = path.join(dir, path.basename(fileName));
    fs.writeFileSync(copy, content);
    let stdout: string;
    try {
      stdout = execFileSync(process.execPath, ["-e", EXTRACT_SCRIPT, "--", copy], {
        cwd: dir,
        encoding: "utf8",
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: 16_000_000,
        env: { ...process.env, NODE_PATH: resolveAyasGraphifyGlobalModules() },
      });
    } catch (error) {
      const stderr = error instanceof Error && "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "";
      if (stderr.includes("Cannot find module") || stderr.includes("MODULE_NOT_FOUND")) {
        throw new AyasBatchGraphifyCheckError("AYAS_GRAPHIFY_UNAVAILABLE", `@sentropic/graphify is not available on this machine's global npm path (${resolveAyasGraphifyGlobalModules()})`);
      }
      throw new AyasBatchGraphifyCheckError("AYAS_GRAPHIFY_EXTRACT_FAILED", stderr || (error instanceof Error ? error.message : String(error)));
    }
    try {
      return JSON.parse(stdout) as RawExtraction;
    } catch (error) {
      throw new AyasBatchGraphifyCheckError("AYAS_GRAPHIFY_EXTRACT_FAILED", `graphify extraction produced unparseable output: ${error instanceof Error ? error.message : String(error)}`);
    }
  } finally {
    // Best effort: a transient Windows lock (AV scan) on the TEMP copy must never mask the extraction outcome.
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* left for the OS TEMP cleaner */ }
  }
}

/**
 * Graphify's AST `imports_from` edge count for content that is (or will be) at `fileName`. The same measurement
 * the check applies after landing, so a count measured here at artifact-freeze time is source truth by
 * construction. An extraction with no nodes means no parser handled the file — never "zero imports".
 */
export function measureAyasGraphifyImportCount(content: string | Buffer, fileName: string): { readonly importEdgeCount: number; readonly nodeCount: number; readonly edgeCount: number } {
  const raw = runAyasGraphifyExtraction(Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8"), fileName);
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges) || raw.nodes.length === 0) {
    throw new AyasBatchGraphifyCheckError("AYAS_GRAPHIFY_EXTRACT_FAILED", `${fileName}: Graphify produced no nodes (no parser for this file type, or the parse failed) — an empty extraction is never read as zero imports`);
  }
  const rootNodeId = raw.nodes[0]!.id;
  const importEdgeCount = raw.edges.filter((e) => e.relation === "imports_from" && e.source === rootNodeId).length;
  return { importEdgeCount, nodeCount: raw.nodes.length, edgeCount: raw.edges.length };
}

const sha256 = (value: Buffer): string => crypto.createHash("sha256").update(value).digest("hex");

/**
 * The actual gate: extracts the just-applied file's real, AST-derived
 * `imports_from` edge count (one per distinct import statement, from
 * Graphify's own parser — not re-derived by string matching) and requires
 * it to equal exactly `expectedImportCount`. Every current micro-item
 * generator produces a fixed, known shape (`node:assert/strict` + one
 * target-class import — `expectedImportCount = 2`); any deviation, in
 * either direction, means the file that actually landed on disk does not
 * match what its generator declared, and execution must not proceed blindly.
 *
 * `approvedContent` (the frozen artifact's replacement for this file) lets a
 * deviation be classified instead of guessed: byte-identical landed content
 * reconciles a stale declaration (`STALE_EXPECTATION`); anything else still
 * throws `AYAS_GRAPHIFY_UNEXPECTED_DEPENDENCY`. Without it the check is as
 * strict as before. Callers pass it ONLY when the expected count was itself
 * derived from that content — never for an independent shape contract.
 */
export function checkAyasBatchItemWithGraphify(repoRoot: string, filePath: string, expectedImportCount: number, options: { readonly approvedContent?: string } = {}): AyasBatchGraphifyCheckResult {
  let landed: Buffer;
  try {
    landed = fs.readFileSync(path.join(repoRoot, filePath));
  } catch (error) {
    throw new AyasBatchGraphifyCheckError("AYAS_GRAPHIFY_EXTRACT_FAILED", `${filePath}: cannot read the landed file (${error instanceof Error ? error.message : String(error)})`);
  }
  const measured = measureAyasGraphifyImportCount(landed, filePath);
  const landedMatchesApproved = options.approvedContent === undefined ? null : sha256(landed) === sha256(Buffer.from(options.approvedContent, "utf8"));
  const verdict = classifyAyasDependencyExpectation({ measuredImportCount: measured.importEdgeCount, nodeCount: measured.nodeCount, declaredImportCount: expectedImportCount, landedMatchesApproved });
  if (verdict !== "EXPECTED_CHANGE" && verdict !== "STALE_EXPECTATION") {
    throw new AyasBatchGraphifyCheckError(
      "AYAS_GRAPHIFY_UNEXPECTED_DEPENDENCY",
      `${filePath}: expected exactly ${expectedImportCount} import(s), Graphify's own AST extraction found ${measured.importEdgeCount} — ${verdict}${landedMatchesApproved === false ? " (landed content differs from the approved artifact)" : landedMatchesApproved === null ? " (no approved content supplied to prove provenance)" : ""}`,
    );
  }
  return { filePath, ...measured, verdict, declaredImportCount: expectedImportCount };
}
