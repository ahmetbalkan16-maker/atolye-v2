/** Reproducible post-freeze 15C negative controls. Only copied modules in a TEMP overlay change; the overlay is also the working directory. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repo = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-context-budget-audit-"));
const test = "scripts/smoke-ayas-context-budget.ts";
const copied = new Set<string>();
/** Copies a module and everything it imports by relative path or by the `@/` alias, so no import of the overlay reaches the repository's own source. */
function copy(file: string) {
  if (copied.has(file)) return;
  copied.add(file);
  const text = fs.readFileSync(path.join(repo, file), "utf8");
  const target = path.join(temp, file);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text);
  if (file.endsWith(".json")) return;
  for (const match of text.matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+|@\/[^'"]+)['"]/g)) {
    const specifier = match[1]!;
    const base = specifier.startsWith("@/") ? path.join(repo, "src", specifier.slice(2)) : path.resolve(path.dirname(path.join(repo, file)), specifier);
    const found = [base, base + ".ts", base + ".tsx", base + ".json", path.join(base, "index.ts")].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (found) { const relative = path.relative(repo, found); assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative)); copy(relative); }
  }
}

const budget = "src/lib/ayas/context/AyasContextBudget.ts";
const chat = "src/lib/ayas/AyasChatStream.ts";
const mutants: readonly (readonly [string, string, string, string])[] = [
  ["output-reserve-ignored", budget, "if (tokens + input.outputReserve > input.ceiling) return unsafe(tokens);", "if (tokens > input.ceiling) return unsafe(tokens);"],
  ["quarantined-entry-admitted", budget, 'const reason = item.trust === "QUARANTINED" ? "QUARANTINED" :', 'const reason = false ? "QUARANTINED" :'],
  ["untrusted-entry-made-mandatory", budget, '(mandatory(item) && item.trust !== "TRUSTED") ||', "false ||"],
  ["low-trust-posing-as-trusted-class", budget, '(item.class !== "EXTERNAL_DATA" && item.trust === "LOW_TRUST")) return unsafe(input.mandatoryTokens);', "false) return unsafe(input.mandatoryTokens);"],
  ["exact-rendering-unchecked", budget, "if (estimatedPromptTokens + input.outputReserve <= planned.ceiling) return { prompt, evidence:", "if (true) return { prompt, evidence:"],
  ["dense-characters-undercounted", budget, "else single += 1;", "else merged += 1;"],
  ["unknown-window-guessed", budget, 'if (raw === undefined || raw === "") return null;', 'if (raw === undefined || raw === "") return 8192;'],
  ["measured-overrun-accepted", budget, "if (ceiling === null || measuredPromptTokens + outputReserve > ceiling) {", "if (false) {"],
  ["reply-outranks-owner-turn", budget, 'class: turn.role === "user" ? "VERIFIED_RETRIEVAL" as const : "TRUSTED_MEMORY" as const', 'class: turn.role !== "user" ? "VERIFIED_RETRIEVAL" as const : "TRUSTED_MEMORY" as const'],
  ["older-turn-outranks-newer", budget, "relevance: 0, recency: index,", "relevance: 0, recency: -index,"],
  ["protected-memory-shed", "src/components/brain/brainCore.ts", "memoryLines: memory.filter((line, index) => protectedMemory.has(line) || selected.has(`memory:${index}`)),", "memoryLines: memory.filter((_line, index) => selected.has(`memory:${index}`)),"],
  ["local-transport-admits-any-prompt", "src/lib/ayas/model/OllamaAyasProvider.ts", "assertAyasPromptFits(req.prompt, ceiling, req.maxTokens);", "void ceiling;"],
  ["cloud-billed-without-window", "src/lib/ayas/model/CloudAyasProvider.ts", 'assertAyasPromptFits(req.prompt, resolveAyasContextCeiling("cloud", env), req.maxTokens);', "void 0;"],
  ["reasoning-unbudgeted", "src/lib/ayas/reasoning/AyasReasoningCore.ts", "if (input.contextCeiling === undefined) {", "if (true) {"],
  ["unknown-window-not-refused", chat, "if (!route || !route.provider || contextCeiling === null) {", "if (!route || !route.provider) {"],
  ["chat-prompt-unbudgeted", chat, "if (contextCeiling === undefined) {", "if (true) {"],
  ["measured-overrun-treated-as-transport-fault", chat, "if (error instanceof AyasContextBudgetError) {", "if (false) {"],
  ["budget-not-traced", chat, 'providerSpan?.end("ok", contextBudget ? { ...ayasContextBudgetTraceMetadata(contextBudget), ...(promptTokens !== undefined ? { promptTokens } : {}) } : undefined);', 'providerSpan?.end("ok");'],
  ["memory-envelope-unwired", chat, "contentCharBudget: ayasMemoryContentBudget(text.length + ctx.trace.recentHistoryChars +", "contentCharBudget: ayasMemoryContentBudget(0 * text.length + 0 * ctx.trace.recentHistoryChars +"],
];

const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[key]) env[key] = process.env[key];
const run = () => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env, encoding: "utf8", windowsHide: true, timeout: 60_000 });
try {
  copy(test);
  fs.copyFileSync(path.join(repo, "tsconfig.json"), path.join(temp, "tsconfig.json"));
  fs.writeFileSync(path.join(temp, "package.json"), JSON.stringify({ type: "module" }));
  fs.symlinkSync(path.join(repo, "node_modules"), path.join(temp, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const baseline = run(); assert.equal(baseline.status, 0, baseline.stderr);
  for (const [id, file, before, after] of mutants) {
    const target = path.join(temp, file); const original = fs.readFileSync(target, "utf8");
    assert.equal(original.split(before).length - 1, 1, `${id}: exact mutation`);
    fs.writeFileSync(target, original.replace(before, () => after)); const result = run(); fs.writeFileSync(target, original);
    assert.equal(result.signal, null, `${id}: timeout`); assert.notEqual(result.status, 0, `${id}: survived`);
    assert.match(result.stderr, /AssertionError/, `${id}: must fail an assertion, not imports or syntax`);
  }
  for (const [, file] of mutants) assert.equal(fs.readFileSync(path.join(temp, file), "utf8"), fs.readFileSync(path.join(repo, file), "utf8"), "the repository source was read, never written");
  console.log(`Post-freeze 15C context budget mutation audit: PASS (${mutants.length}/${mutants.length} caught; ${copied.size} files in TEMP overlay)`);
} finally {
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("ayas-context-budget-audit-"));
  fs.rmSync(temp, { recursive: true, force: true });
}
