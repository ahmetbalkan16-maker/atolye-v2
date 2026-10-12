/**
 * Graphify structural complement: the project-side parser for files Graphify 0.17.1 indexes but
 * cannot extract (PowerShell, CI workflows, the colliding asset routes), its by-id apply into
 * graph.json, and the collector rule that such nodes only count while the file still has the bytes
 * they were parsed from. Parses this repository read-only; every write goes to a run-owned TEMP dir.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { summarizeAyasGraphifyGraph, withoutStaleAttestedFiles } from "../src/lib/ayas/developer/AyasGraphifyStateCollector";
import { applyStructuralComplement, discoverComplementFiles } from "./graphify-structural-complement.mjs";

const repo = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "graphify-structural-complement-"));
const sha = (bytes: Buffer | string) => crypto.createHash("sha256").update(bytes).digest("hex");
let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) { await run(); passed += 1; process.stdout.write(`PASS ${passed}: ${name}\n`); }

const baseGraph = () => ({ directed: false, multigraph: false, graph: { built_from_commit: "a".repeat(40) },
  nodes: [{ id: "native_a", label: "a.ts", file_type: "code", source_file: "src/a.ts", community: 3 }],
  links: [], hyperedges: [] });

async function main() {
  const files: readonly string[] = discoverComplementFiles(repo);
  await scenario("discovery lists every PowerShell script, the workflow and both colliding routes", () => {
    for (const file of execFileSync("git", ["ls-files", "--", "*.ps1"], { cwd: repo, encoding: "utf8" }).split(/\r?\n/).filter(Boolean)) assert(files.includes(file), file);
    assert(files.includes(".github/workflows/ayas-safe-ci.yml"));
    assert(files.includes("app/api/assets/thumbnails/[slug]/[fileName]/route.ts"));
  });

  const graphPath = path.join(temp, "graph.json"), out = path.join(temp, "fragment.json"), receipt = path.join(temp, "receipt.json");
  fs.writeFileSync(graphPath, JSON.stringify(baseGraph(), null, 2));
  const runCli = () => execFileSync(process.execPath, [path.join(repo, "scripts", "graphify-structural-complement.mjs"), "--apply",
    "--root", repo, "--graph", graphPath, "--out", out, "--receipt", receipt], { cwd: repo, encoding: "utf8", windowsHide: true });
  runCli();
  const first = JSON.parse(fs.readFileSync(graphPath, "utf8"));
  const result = JSON.parse(fs.readFileSync(receipt, "utf8"));
  await scenario("complement covers every discovered file and applies without touching native nodes", () => {
    assert.equal(result.complete, true);
    assert.deepEqual(result.covered_files, [...files].sort());
    assert.deepEqual(first.nodes.find((node: { id: string }) => node.id === "native_a"), baseGraph().nodes[0]);
  });
  await scenario("fragment stays self-contained for `graphify build` validation", () => {
    const fragment = JSON.parse(fs.readFileSync(out, "utf8"));
    const ids = new Set(fragment.nodes.map((node: { id: string }) => node.id));
    assert(fragment.edges.every((edge: { source: string; target: string }) => ids.has(edge.source) && ids.has(edge.target)));
  });
  await scenario("re-apply replaces the earlier complement instead of stacking it", () => {
    runCli();
    const second = JSON.parse(fs.readFileSync(graphPath, "utf8"));
    assert.equal(second.nodes.length, first.nodes.length);
    assert.equal(second.links.length, first.links.length);
    assert.equal(JSON.parse(fs.readFileSync(receipt, "utf8")).applied.replacedNodes, result.nodes);
  });

  const summary = summarizeAyasGraphifyGraph(first);
  assert(summary);
  await scenario("graph stays structurally clean after apply", () => {
    const { duplicateIds, duplicateEdges, dangling, selfLoops } = summary.fact;
    assert.deepEqual({ duplicateIds, duplicateEdges, dangling, selfLoops }, { duplicateIds: 0, duplicateEdges: 0, dangling: 0, selfLoops: 0 });
  });
  await scenario("complement-only files are attested; native files are not", () => {
    assert(summary.attestedOnlyFiles.has("scripts/ayas-access-daemon.ps1"));
    assert(!summary.attestedOnlyFiles.has("src/a.ts"));
  });
  await scenario("current bytes keep every complement file covered", () => {
    const covered = withoutStaleAttestedFiles(repo, summary.filesWithNodes, summary.attestedOnlyFiles);
    for (const file of files) assert(covered.has(file.toLowerCase()), file);
  });

  const fixture = path.join(temp, "fixture");
  fs.mkdirSync(path.join(fixture, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(fixture, "scripts", "a.ps1"), "function A {}\n");
  const attested = (file: string, bytes: string) => ({ nodes: [{ id: `atolye_structural:${file}:file`, source_file: file, source_sha256: sha(bytes) }], links: [] });
  await scenario("edited source drops coverage until the complement runs again", () => {
    const s = summarizeAyasGraphifyGraph(attested("scripts/a.ps1", "function A {}\n"))!;
    assert(withoutStaleAttestedFiles(fixture, s.filesWithNodes, s.attestedOnlyFiles).has("scripts/a.ps1"));
    fs.writeFileSync(path.join(fixture, "scripts", "a.ps1"), "function A {}\nfunction B {}\n");
    assert(!withoutStaleAttestedFiles(fixture, s.filesWithNodes, s.attestedOnlyFiles).has("scripts/a.ps1"));
  });
  await scenario("deleted or escaping sources are never covered", () => {
    const gone = summarizeAyasGraphifyGraph(attested("scripts/gone.ps1", "x"))!;
    assert(!withoutStaleAttestedFiles(fixture, gone.filesWithNodes, gone.attestedOnlyFiles).has("scripts/gone.ps1"));
    const escape = summarizeAyasGraphifyGraph(attested("../outside.ps1", "x"))!;
    assert(!withoutStaleAttestedFiles(fixture, escape.filesWithNodes, escape.attestedOnlyFiles).has("../outside.ps1"));
  });
  await scenario("a dangling complement edge is refused before graph.json is written", () => {
    const target = path.join(temp, "dangling.json");
    fs.writeFileSync(target, JSON.stringify(baseGraph()));
    const before = fs.readFileSync(target);
    assert.throws(() => applyStructuralComplement(target, before, { nodes: [{ id: "atolye_structural:x:file", source_file: "x" }],
      edges: [{ source: "atolye_structural:x:file", target: "missing", relation: "calls" }] }), /COMPLEMENT_DANGLING_EDGE/);
    assert.deepEqual(fs.readFileSync(target), before);
  });
  process.stdout.write(`Graphify structural complement smoke: PASS (${passed} scenarios)\n`);
}

main().catch((error) => { process.stderr.write(`Graphify structural complement smoke FAILED: ${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; })
  .finally(() => fs.rmSync(temp, { recursive: true, force: true }));
