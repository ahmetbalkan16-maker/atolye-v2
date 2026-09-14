import assert from "node:assert/strict";
import { runAyasReadOnlyAction } from "../src/lib/ayas/execution/AyasActionRuntime";

let assertions = 0;
const check = (value: unknown, message: string) => { assertions += 1; assert.ok(value, message); };
const request = (action: string, plan: Record<string, unknown> = {}) => runAyasReadOnlyAction({ rawRequest: { schemaVersion: "1", action, requestedBy: "developer-actions-smoke", intent: "bounded developer evidence", plan } });

async function main() {
  const status = await request("inspect-repository-status");
  check(status.executed, "status executes through Action Runtime");
  if (status.executed) { check(Array.isArray(status.result.data.entries), "status entries are structured"); check(typeof status.result.data.clean === "boolean", "status exposes clean flag"); }

  const working = await request("inspect-repository-diff", { mode: "working" });
  check(working.executed, "working diff executes"); if (working.executed) { check(typeof working.result.data.diff === "string", "diff is bounded text"); check(typeof working.result.data.truncated === "boolean", "diff reports truncation"); }
  const file = await request("inspect-repository-diff", { mode: "file", filePath: "src/lib/ayas/execution/AyasExecutionPolicy.ts" });
  check(file.executed, "validated file diff executes");

  const log = await request("inspect-git-history", { operation: "log", count: 3 });
  check(log.executed, "bounded log executes"); if (log.executed) check((log.result.data.output as string).split(/\r?\n/u).filter(Boolean).length <= 3, "log count is bounded");
  const show = await request("inspect-git-history", { operation: "show", ref: "HEAD" });
  check(show.executed, "validated show executes"); if (show.executed) check(typeof show.result.data.truncated === "boolean", "show reports truncation");

  const source = await request("inspect-source-range", { filePath: "src/lib/ayas/execution/AyasActionRuntime.ts", startLine: 1, endLine: 12 });
  check(source.executed, "source range executes"); if (source.executed) { check(source.result.data.startLine === 1, "source start retained"); check((source.result.data.content as string).split("\n").length <= 12, "source line range bounded"); }

  const graph = await request("query-graphify", { symbol: "AyasActionRuntime" });
  check(graph.executed, "Graphify action returns structured outcome"); if (graph.executed) { check(["fresh", "stale", "unavailable", "failure", "timeout"].includes(graph.result.data.status as string), "Graphify status classified"); check(Array.isArray(graph.result.data.evidence) || typeof graph.result.data.evidence === "string", "Graphify evidence is bounded data"); }
  const validation = await request("run-developer-validation", { validationId: "typecheck" });
  check(validation.executed, "registered validation executes through Action Runtime"); if (validation.executed) { check(validation.result.data.status === "passed", "registered TypeScript validation passes"); check(typeof validation.result.data.durationMs === "number", "validation returns structured duration"); }

  const attacks: Array<[string, Record<string, unknown>, string]> = [
    ["inspect-repository-diff", { mode: "file", filePath: "../secret.ts" }, "traversal"],
    ["inspect-repository-diff", { mode: "working; git reset" }, "command chaining"],
    ["inspect-git-history", { operation: "log", count: 31 }, "oversized log count"],
    ["inspect-git-history", { operation: "show", ref: "--help" }, "flag-shaped ref"],
    ["inspect-git-history", { operation: "show", ref: "HEAD^" }, "revision expression"],
    ["inspect-source-range", { filePath: "C:/Windows/win.ini", startLine: 1, endLine: 2 }, "absolute path"],
    ["inspect-source-range", { filePath: "src/lib/ayas/execution/AyasActionRuntime.ts", startLine: 1, endLine: 999 }, "line range"],
    ["query-graphify", { symbol: "AyasActionRuntime;rm" }, "Graphify injection"],
    ["query-graphify", { symbol: "AyasActionRuntime", operation: "tree", depth: 99 }, "Graphify traversal bound"],
    ["run-developer-validation", { validationId: "arbitrary-script" }, "unknown validation"],
  ];
  for (const [action, plan, label] of attacks) { const outcome = await request(action, plan); check(!outcome.executed, `${label} rejected`); }
  const unknown = await request("shell", { command: "echo unsafe" }); check(!unknown.executed, "unknown shell action rejected");

  console.log(`AYAS developer actions smoke: PASS (${assertions} assertions)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-developer-actions", assertions }));
}
void main();
