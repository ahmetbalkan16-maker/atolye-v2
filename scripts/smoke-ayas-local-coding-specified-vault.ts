import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";

import { AYAS_LOCAL_CODING_MAX_ACCEPTANCE_CRITERIA, AYAS_LOCAL_CODING_MAX_MULTI_EDITS, buildAyasLocalCodingModelRequest, parseAyasLocalCodingPatch,
  type AyasLocalCodingPatchEdit } from "../src/lib/brain/autonomy/AyasLocalCodingModelAdapter";
import type { AyasLocalCodingTaskContract } from "../src/lib/brain/autonomy/AyasLocalCodingTaskContract";
import { AYAS_LOCAL_CODING_ACCEPTANCE_CRITERIA } from "./fixtures/ayas-local-coding-qualification-criteria";
import { AYAS_LOCAL_CODING_QUALIFICATION_VAULT, projectAyasLocalCodingQualificationTask } from "./fixtures/ayas-local-coding-qualification-vault";
import { AYAS_LOCAL_CODING_RETRIEVAL_CASE, projectAyasLocalCodingRetrievalTask } from "./fixtures/ayas-local-coding-qualification-retrieval-case";

// Host-side only: reads frozen history from git; no model, engine, container or evaluator run. Owner protocol v3 (2026-10-15).
const git = (...args: string[]): string => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64_000_000 });
const sha = (text: string): string => crypto.createHash("sha256").update(text, "utf8").digest("hex");
const cases = [
  ...AYAS_LOCAL_CODING_QUALIFICATION_VAULT.filter((item) => item.caseId !== "historical-windows-graphify-launch")
    .map((item) => ({ ...item, task: projectAyasLocalCodingQualificationTask(item) })),
  { ...AYAS_LOCAL_CODING_RETRIEVAL_CASE, task: projectAyasLocalCodingRetrievalTask() },
];

/**
 * The historical fix as multi-edit patch edits: one region per diff hunk (an unchanged anchor line where the hunk only
 * inserts or deletes), widened until its search is unique; regions that overlap or touch while widening are merged.
 */
function historicalEdits(base: string, fix: string, file: string): AyasLocalCodingPatchEdit[] {
  const before = git("show", `${base}:${file}`); const after = git("show", `${fix}:${file}`);
  const a = before.split("\n"); const b = after.split("\n");
  type Region = { from: number; to: number; replace: string[] };
  let regions: Region[] = [];
  for (const header of git("diff", "-U0", base, fix, "--", file).split("\n").filter((line) => line.startsWith("@@"))) {
    const [, s0, c0, t0, d0] = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header)!;
    const s = Number(s0); const c = c0 === undefined ? 1 : Number(c0); const t = Number(t0); const d = d0 === undefined ? 1 : Number(d0);
    const added = b.slice(t - 1, t - 1 + d);
    if (c > 0 && d > 0) regions.push({ from: s - 1, to: s - 2 + c, replace: added });
    else if (c > 0) regions.push(s >= 2 ? { from: s - 2, to: s - 2 + c, replace: [a[s - 2]!] } : { from: 0, to: c, replace: [a[c]!] });
    else regions.push(s >= 1 ? { from: s - 1, to: s - 1, replace: [a[s - 1]!, ...added] } : { from: 0, to: 0, replace: [...added, a[0]!] });
  }
  const merge = (left: Region, right: Region): Region => ({ from: left.from, to: right.to,
    replace: [...left.replace, ...a.slice(left.to + 1, right.from), ...right.replace] });
  const unique = (region: Region): boolean => { const search = a.slice(region.from, region.to + 1).join("\n"); return before.indexOf(search) === before.lastIndexOf(search); };
  for (let changed = true; changed;) {
    changed = false;
    regions.sort((x, y) => x.from - y.from);
    for (let i = 1; i < regions.length; i += 1) {
      if (regions[i]!.from <= regions[i - 1]!.to + 1 && !changed) { regions.splice(i - 1, 2, merge(regions[i - 1]!, regions[i]!)); changed = true; }
    }
    if (changed) continue;
    const ambiguous = regions.find((region) => !unique(region));
    if (!ambiguous) break;
    if (ambiguous.from > 0) { ambiguous.from -= 1; ambiguous.replace = [a[ambiguous.from]!, ...ambiguous.replace]; }
    else { ambiguous.to += 1; ambiguous.replace = [...ambiguous.replace, a[ambiguous.to]!]; }
    changed = true;
  }
  regions = regions.sort((x, y) => x.from - y.from);
  return regions.map((region) => ({ path: file, beforeSha256: sha(before), search: a.slice(region.from, region.to + 1).join("\n"), replace: region.replace.join("\n") }));
}

let scenarios = 0;
const check = (name: string, fn: () => void): void => { fn(); scenarios += 1; void name; };
const sourcesAt = (rev: string, task: AyasLocalCodingTaskContract) => task.exactFiles.map((file) => ({ path: file, content: git("show", `${rev}:${file}`) }));

for (const item of cases) {
  check(`${item.caseId}: the historical fix is expressible in the multi-edit format within the budget`, () => {
    const sources = sourcesAt(item.baseHead, item.task);
    const edits = item.task.exactFiles.flatMap((file) => historicalEdits(item.baseHead, item.fixHead, file));
    const parsed = parseAyasLocalCodingPatch({ schemaVersion: "1", edits }, item.task, sources, "multi-edit");
    for (const source of parsed.sources) assert.equal(source.content, git("show", `${item.fixHead}:${source.path}`), `${source.path} must equal the fix`);
    assert.ok(edits.length <= AYAS_LOCAL_CODING_MAX_MULTI_EDITS && parsed.changedLines <= item.task.maxChangedLines, "assert.ok(edits.length <= AYAS_LOCAL_CODING_MAX_MULTI_EDITS && parsed.changedLines <= item.task.maxChangedLines)");
    console.log(`${item.caseId}: edits=${edits.length} changedLines=${parsed.changedLines}/${item.task.maxChangedLines}`);
    // The defect this format repairs: the same fix cannot be submitted in the original one-edit-per-file format.
    assert.throws(() => parseAyasLocalCodingPatch({ schemaVersion: "1", edits }, item.task, sources), /PATCH_(?:SCHEMA_INVALID|SCOPE_OR_SCHEMA_INVALID)/);
  });
}
const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
const LEAK_FRAGMENT_CHARS = 24;
/** Lines the model must never be shown: those the historical fix adds and every frozen evaluator line. */
function protectedLines(item: (typeof cases)[number]): string[] {
  const fixAdded = item.task.exactFiles.flatMap((file) => {
    const base = new Set(git("show", `${item.baseHead}:${file}`).split("\n").map(normalize));
    return git("show", `${item.fixHead}:${file}`).split("\n").map(normalize).filter((line) => !base.has(line));
  });
  return [...fixAdded, ...git("cat-file", "blob", item.evaluatorBlob).split("\n").map(normalize)].filter((line) => line.length >= LEAK_FRAGMENT_CHARS);
}
const quoted = (text: string, lines: readonly string[]): string | undefined => lines.find((line) => normalize(text).includes(line.slice(0, LEAK_FRAGMENT_CHARS)));
check("the leak check itself catches a quoted fix line and a quoted evaluator line", () => {
  const item = cases[0]!; const lines = protectedLines(item);
  const fixLine = lines[0]!; const evaluatorLine = lines.find((line) => line.startsWith("assert."))!;
  assert.ok(quoted(`Please ${fixLine}`, lines), "assert.ok(quoted(`Please ${fixLine}`, lines))"); assert.ok(quoted(`Note: ${evaluatorLine}`, lines), "assert.ok(quoted(`Note: ${evaluatorLine}`, lines))");
  assert.equal(quoted("A later explicit decision supersedes the earlier one.", lines), undefined, "assert.equal(quoted(\"A later explicit decision supersedes the earlier one.\", lines), undefined)");
});
for (const item of cases) {
  check(`${item.caseId}: acceptance criteria are bounded and carry no fix code, evaluator line or hidden case identity`, () => {
    const criteria = AYAS_LOCAL_CODING_ACCEPTANCE_CRITERIA[item.caseId];
    assert.ok(Array.isArray(criteria) && criteria.length >= 1 && criteria.length <= AYAS_LOCAL_CODING_MAX_ACCEPTANCE_CRITERIA && Object.isFrozen(criteria), "assert.ok(Array.isArray(criteria) && criteria.length >= 1 && criteria.length <= AYAS_LOCAL_CODING_MAX_ACCEPTANCE_CRITERIA && Object.isFrozen(criteria))");
    const text = normalize(criteria.join(" "));
    const leak = quoted(text, protectedLines(item));
    assert.equal(leak, undefined, `criterion quotes a fix or evaluator line: ${leak?.slice(0, 60)}`);
    const script = item.evaluatorScript.split("/").pop()!.replace(/\.ts$/, "");
    for (const hidden of [item.fixHead, item.fixHead.slice(0, 7), item.baseHead, item.evaluatorBlob, item.evaluatorScript, script, item.caseId, item.split, "HELD_OUT", "qualification-vault"]) {
      assert.ok(!text.includes(hidden), `criterion names hidden case identity: ${hidden}`);
    }
    const request = buildAyasLocalCodingModelRequest(item.task, sourcesAt(item.baseHead, item.task), "qwen3-coder:30b", { patchFormat: "multi-edit", acceptanceCriteria: criteria }) as { messages: { content: string }[] };
    assert.deepEqual(JSON.parse(request.messages[1]!.content).acceptanceCriteria, criteria, "assert.deepEqual(JSON.parse(request.messages[1]!.content).acceptanceCriteria, criteria)");
    assert.match(request.messages[0]!.content, /acceptanceCriteria state the required behavior/);
  });
}
check("every evaluable case has criteria and no other key exists", () => {
  assert.deepEqual(Object.keys(AYAS_LOCAL_CODING_ACCEPTANCE_CRITERIA).sort(), cases.map((item) => item.caseId).sort(), "assert.deepEqual(Object.keys(AYAS_LOCAL_CODING_ACCEPTANCE_CRITERIA).sort(), cases.map((item) => item.caseId).sort())");
  assert.ok(Object.isFrozen(AYAS_LOCAL_CODING_ACCEPTANCE_CRITERIA), "assert.ok(Object.isFrozen(AYAS_LOCAL_CODING_ACCEPTANCE_CRITERIA))");
});
check("without criteria the context has no acceptanceCriteria key", () => {
  const item = cases[0]!;
  const request = buildAyasLocalCodingModelRequest(item.task, sourcesAt(item.baseHead, item.task), "qwen3-coder:30b") as { messages: { content: string }[] };
  assert.equal("acceptanceCriteria" in JSON.parse(request.messages[1]!.content), false, "assert.equal(\"acceptanceCriteria\" in JSON.parse(request.messages[1]!.content), false)");
  for (const bad of [[], Array.from({ length: AYAS_LOCAL_CODING_MAX_ACCEPTANCE_CRITERIA + 1 }, () => "x"), ["a\nb"], ["x".repeat(401)], [""]]) {
    assert.throws(() => buildAyasLocalCodingModelRequest(item.task, sourcesAt(item.baseHead, item.task), "qwen3-coder:30b", { acceptanceCriteria: bad }), /REQUEST_OPTIONS_INVALID/);
  }
});
check("the multi-edit schema and rule appear only when requested", () => {
  const item = cases[0]!; const sources = sourcesAt(item.baseHead, item.task);
  const plain = buildAyasLocalCodingModelRequest(item.task, sources, "qwen3-coder:30b") as { messages: { content: string }[]; response_format: { json_schema: { schema: { properties: { edits: { maxItems: number } } } } } };
  const multi = buildAyasLocalCodingModelRequest(item.task, sources, "qwen3-coder:30b", { patchFormat: "multi-edit" }) as typeof plain;
  assert.equal(plain.response_format.json_schema.schema.properties.edits.maxItems, 2, "assert.equal(plain.response_format.json_schema.schema.properties.edits.maxItems, 2)");
  assert.equal(multi.response_format.json_schema.schema.properties.edits.maxItems, AYAS_LOCAL_CODING_MAX_MULTI_EDITS, "assert.equal(multi.response_format.json_schema.schema.properties.edits.maxItems, AYAS_LOCAL_CODING_MAX_MULTI_EDITS)");
  assert.doesNotMatch(plain.messages[0]!.content, /must not overlap/); assert.match(multi.messages[0]!.content, /edits in one file must not overlap/);
});
check("multi-edit refuses overlap, non-unique or stale searches, scope escape, too many edits and a shared budget overrun", () => {
  const task: AyasLocalCodingTaskContract = { schemaVersion: "1", taskId: "ayas-coding-11111111-2222-3333-4444-555555555555",
    baseHead: "a".repeat(40), objective: "Repair the bounded example expressions.", exactFiles: ["src/example.ts"], maxChangedLines: 6 };
  const content = "const a = 1;\nconst b = 2;\nconst c = 3;\nconst a2 = 1;\n";
  const sources = [{ path: "src/example.ts", content }];
  const edit = (search: string, replace: string, extra: Partial<AyasLocalCodingPatchEdit> = {}) => ({ path: "src/example.ts", beforeSha256: sha(content), search, replace, ...extra });
  const ok = parseAyasLocalCodingPatch({ schemaVersion: "1", edits: [edit("const c = 3;", "const c = 30;"), edit("const b = 2;", "const b = 20;")] }, task, sources, "multi-edit");
  assert.equal(ok.sources[0]!.content, "const a = 1;\nconst b = 20;\nconst c = 30;\nconst a2 = 1;\n", "assert.equal(ok.sources[0]!.content, \"const a = 1;\\nconst b = 20;\\nconst c = 30;\\nconst a2 = 1;\\n\")"); assert.equal(ok.changedLines, 4, "assert.equal(ok.changedLines, 4)");
  const refuse = (edits: unknown[], pattern: RegExp) => assert.throws(() => parseAyasLocalCodingPatch({ schemaVersion: "1", edits }, task, sources, "multi-edit"), pattern);
  refuse([edit("const b = 2;\nconst c", "x"), edit("c = 3;", "y")], /PATCH_BASE_OR_UNIQUE_SEARCH_MISMATCH/);
  refuse([edit("const b = 2;", "x"), edit("const b = 2;", "y")], /PATCH_BASE_OR_UNIQUE_SEARCH_MISMATCH/);
  refuse([edit(" = 1;", "x")], /PATCH_BASE_OR_UNIQUE_SEARCH_MISMATCH/);
  refuse([edit("const b = 2;", "x", { beforeSha256: "0".repeat(64) })], /PATCH_BASE_OR_UNIQUE_SEARCH_MISMATCH/);
  refuse([edit("const b = 2;", "x", { path: "src/other.ts" })], /PATCH_SCOPE_OR_SCHEMA_INVALID/);
  refuse(Array.from({ length: AYAS_LOCAL_CODING_MAX_MULTI_EDITS + 1 }, (_, index) => edit(`const ${"abc"[index % 3]}`, "x")), /PATCH_SCHEMA_INVALID/);
  refuse([edit("const a = 1;\nconst b = 2;", "a\nb"), edit("const c = 3;\nconst a2 = 1;", "c\nd")], /PATCH_LINE_BUDGET_EXCEEDED/);
});

console.log(`Local coding specified vault: ${scenarios}/${scenarios} PASS; host oracle only, model runs 0.`);
