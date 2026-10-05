/** Operator-owned fixed read-only process probes. The audit core has no process capability. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { auditHead } from "../../src/lib/ayas/audit/AyasSystemAuditModel";
import type { AyasAuditCollectorDeps } from "../../src/lib/ayas/audit/AyasSystemAuditCollector";
export function createAyasAuditOperatorProbes(root: string): Pick<AyasAuditCollectorDeps, "repository" | "graph"> {
  if (!path.isAbsolute(root) || !fs.existsSync(root) || fs.lstatSync(root).isSymbolicLink()) throw Error("AUDIT_ROOT_INVALID");
  const cwd = fs.realpathSync.native(root);
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV ?? "test", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
  for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"])
    if (process.env[key]) env[key] = process.env[key];
  const git = (args: string[]) => { try { return execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.quotePath=false", ...args], { cwd, env, encoding: "utf8", windowsHide: true, timeout: 15000, maxBuffer: 2e6 }).trim(); } catch { return null; } };
  // Resolve the trusted operator's sibling, never executable code from --repo.
  const graphOperator = path.resolve(__dirname, "../ayas-graphify-status.ts");
  return {
    repository: () => { const head = git(["rev-parse", "--verify", "HEAD"]); return { head: auditHead(head) ? head : null, branch: git(["rev-parse", "--abbrev-ref", "HEAD"]) ?? "UNKNOWN" }; },
    graph: async () => JSON.parse(execFileSync(process.execPath, ["--import", pathToFileURL(require.resolve("tsx")).href, graphOperator, "--facts"], { cwd, env, encoding: "utf8", windowsHide: true, timeout: 120000, maxBuffer: 2e6 })),
  };
}
