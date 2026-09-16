import { execFileSync } from "node:child_process";
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
 */
export class AyasBatchGraphifyCheckError extends Error {
  constructor(readonly code: "AYAS_GRAPHIFY_UNAVAILABLE" | "AYAS_GRAPHIFY_UNEXPECTED_DEPENDENCY" | "AYAS_GRAPHIFY_EXTRACT_FAILED", message: string) {
    super(message);
    this.name = "AyasBatchGraphifyCheckError";
    this.stack = undefined;
  }
}

export interface AyasBatchGraphifyCheckResult {
  readonly filePath: string;
  readonly importEdgeCount: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
}

const DEFAULT_GLOBAL_NODE_MODULES = "C:\\Users\\Metod\\AppData\\Roaming\\npm\\node_modules";

function globalNodeModulesPath(): string {
  return process.env.AYAS_GRAPHIFY_GLOBAL_MODULES ?? DEFAULT_GLOBAL_NODE_MODULES;
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
 * Runs Graphify's own AST extractor against ONE file. Throws
 * `AYAS_GRAPHIFY_UNAVAILABLE` if the global `@sentropic/graphify` package
 * cannot be loaded, and `AYAS_GRAPHIFY_EXTRACT_FAILED` on any other
 * extraction error.
 */
function runAyasGraphifyExtraction(repoRoot: string, filePath: string): RawExtraction {
  const absolute = path.join(repoRoot, filePath);
  let stdout: string;
  try {
    stdout = execFileSync(process.execPath, ["-e", EXTRACT_SCRIPT, "--", absolute], {
      cwd: repoRoot,
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
      env: { ...process.env, NODE_PATH: globalNodeModulesPath() },
    });
  } catch (error) {
    const stderr = error instanceof Error && "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "";
    if (stderr.includes("Cannot find module") || stderr.includes("MODULE_NOT_FOUND")) {
      throw new AyasBatchGraphifyCheckError("AYAS_GRAPHIFY_UNAVAILABLE", `@sentropic/graphify is not available on this machine's global npm path (${globalNodeModulesPath()})`);
    }
    throw new AyasBatchGraphifyCheckError("AYAS_GRAPHIFY_EXTRACT_FAILED", stderr || (error instanceof Error ? error.message : String(error)));
  }
  try {
    return JSON.parse(stdout) as RawExtraction;
  } catch (error) {
    throw new AyasBatchGraphifyCheckError("AYAS_GRAPHIFY_EXTRACT_FAILED", `graphify extraction produced unparseable output: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * The actual gate: extracts the just-applied file's real, AST-derived
 * `imports_from` edge count (one per distinct import statement, from
 * Graphify's own parser — not re-derived by string matching) and requires
 * it to equal exactly `expectedImportCount`. Every current micro-item
 * generator produces a fixed, known shape (`node:assert/strict` + one
 * target-class import — `expectedImportCount = 2`); any deviation, in
 * either direction, means the file that actually landed on disk does not
 * match what its generator declared, and execution must not proceed blindly.
 */
export function checkAyasBatchItemWithGraphify(repoRoot: string, filePath: string, expectedImportCount: number): AyasBatchGraphifyCheckResult {
  const raw = runAyasGraphifyExtraction(repoRoot, filePath);
  const rootNodeId = raw.nodes[0]?.id;
  const importEdges = raw.edges.filter((e) => e.relation === "imports_from" && e.source === rootNodeId);
  if (importEdges.length !== expectedImportCount) {
    throw new AyasBatchGraphifyCheckError(
      "AYAS_GRAPHIFY_UNEXPECTED_DEPENDENCY",
      `${filePath}: expected exactly ${expectedImportCount} import(s), Graphify's own AST extraction found ${importEdges.length} (targets: ${importEdges.map((e) => e.target).join(", ") || "none"})`,
    );
  }
  return { filePath, importEdgeCount: importEdges.length, nodeCount: raw.nodes.length, edgeCount: raw.edges.length };
}
