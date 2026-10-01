/**
 * Reproducible post-freeze section 8 negative controls: barge-in and the real tool-action state.
 * Only copied modules in a TEMP overlay change; the overlay is also the working directory.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repo = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-turn-state-audit-"));
const copied = new Set<string>();
/** Copies a module and everything it imports by relative path or by the `@/` alias. */
function copy(file: string) {
  if (copied.has(file)) return;
  copied.add(file);
  const text = fs.readFileSync(path.join(repo, file), "utf8");
  const target = path.join(temp, file);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text);
  if (!/\.tsx?$/.test(file)) return;
  for (const match of text.matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+|@\/[^'"]+)['"]/g)) {
    const specifier = match[1]!;
    const base = specifier.startsWith("@/") ? path.join(repo, "src", specifier.slice(2)) : path.resolve(path.dirname(path.join(repo, file)), specifier);
    const found = [base, base + ".ts", base + ".tsx", base + ".json", path.join(base, "index.ts")].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (found) { const relative = path.relative(repo, found); assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative)); copy(relative); }
  }
}
/** The console suite reads its components' source and stylesheet from disk as well as importing them. */
function copyDirectory(directory: string) {
  for (const entry of fs.readdirSync(path.join(repo, directory), { withFileTypes: true })) {
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) copyDirectory(relative); else copy(relative);
  }
}

const voice = "scripts/smoke-ayas-voice.ts";
const reasoning = "scripts/smoke-ayas-reasoning.ts";
const client = "scripts/smoke-ayas-chat-stream-client.ts";
const consoleUi = "scripts/smoke-brain-core-ui.ts";
const engine = "src/components/brain/voice/ayasVoiceEngine.ts";
const chat = "src/lib/ayas/AyasChatStream.ts";
const streamClient = "src/components/brain/ayasChatStreamClient.ts";
/** id, mutated file, exact text, replacement, the suite that must catch it. */
const mutants: readonly (readonly [string, string, string, string, string])[] = [
  ["barge-in-outside-speech", engine, 'if (this.disposed || this._state !== "speaking") return false;', "if (this.disposed) return false;", voice],
  ["barge-in-leaves-speech-playing", engine, 'this.safeCancelSpeech();\n    this.transition("speak-end");\n    if (!this._listening', 'this.transition("speak-end");\n    if (!this._listening', voice],
  ["barge-in-opens-mic-with-voice-off", engine, "if (!this._listening || !this.capability.stt) return true;", "if (!this.capability.stt) return true;", voice],
  ["barge-in-still-needs-wake-word", engine, "// Already addressed: the next utterance is the command.\n    this.woke = true;", "// Already addressed: the next utterance is the command.\n    this.woke = false;", voice],
  ["tool-state-without-a-dispatch", chat, 'if (planned) yield { type: "state", state: "tool-action", tool: planned.toolId };', 'yield { type: "state", state: "tool-action", tool: planned?.toolId };', reasoning],
  ["tool-state-never-withdrawn", chat, 'if (planned) yield { type: "state", state: "thinking" };', 'if (false) yield { type: "state", state: "thinking" };', reasoning],
  ["unknown-state-reaches-ui", streamClient, '(event.state === "tool-action" || event.state === "thinking")', "(true)", client],
  ["unchecked-tool-id-reaches-ui", streamClient, 'typeof event.tool === "string" && /^[a-z][a-z0-9.-]{1,63}$/.test(event.tool) ? event.tool : undefined', 'typeof event.tool === "string" ? event.tool : undefined', client],
  ["state-after-terminal-delivered", streamClient, "if (terminal) return;", "if (false) return;", client],
  ["tool-shown-without-a-turn", "src/components/brain/brainCore.ts", 'return input.toolActive && input.chatPending ? "tool" : "thinking";', 'return input.toolActive ? "tool" : "thinking";', consoleUi],
  ["barge-in-offered-when-not-speaking", "src/components/brain/BrainConsoleView.tsx", '{voice.state === "speaking" && voice.onInterruptSpeech ? (', "{voice.onInterruptSpeech ? (", consoleUi],
  ["tool-line-shown-while-only-thinking", "src/components/brain/BrainConsoleView.tsx", "const toolRunning = Boolean(props.chatPending) && props.turnTool !== null && props.turnTool !== undefined;", "const toolRunning = Boolean(props.chatPending);", consoleUi],
];

const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[key]) env[key] = process.env[key];
const run = (suite: string) => spawnSync(process.execPath, ["--import", "tsx", suite], { cwd: temp, env, encoding: "utf8", windowsHide: true, timeout: 90_000 });
try {
  const suites = [...new Set(mutants.map((mutant) => mutant[4]))];
  for (const suite of suites) copy(suite);
  copyDirectory("src/components/brain");
  copyDirectory("app/brain");
  // The reasoning suite dispatches real read-only tools: they read these documents and ask Git for the status of the
  // working directory, so the overlay is a repository of its own with one commit.
  for (const file of ["tsconfig.json", "package.json", "CHANGELOG.md", "ROADMAP.md", "ATOLYE_CHECKPOINT.md"]) fs.copyFileSync(path.join(repo, file), path.join(temp, file));
  fs.writeFileSync(path.join(temp, ".gitignore"), "node_modules\n");
  fs.symlinkSync(path.join(repo, "node_modules"), path.join(temp, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const git = (...args: string[]) => {
    const result = spawnSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], { cwd: temp, env, encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, `git ${args[0]}: ${result.stderr}`);
  };
  git("init", "--quiet"); git("add", "--all"); git("commit", "--quiet", "--message", "overlay fixture");
  for (const suite of suites) { const baseline = run(suite); assert.equal(baseline.status, 0, `${suite}: ${baseline.stderr}`); }
  for (const [id, file, before, after, suite] of mutants) {
    const target = path.join(temp, file); const original = fs.readFileSync(target, "utf8");
    assert.equal(original.split(before).length - 1, 1, `${id}: exact mutation`);
    fs.writeFileSync(target, original.replace(before, () => after)); const result = run(suite); fs.writeFileSync(target, original);
    assert.equal(result.signal, null, `${id}: timeout`); assert.notEqual(result.status, 0, `${id}: survived`);
    assert.match(result.stderr + result.stdout, /AssertionError/, `${id}: must fail an assertion, not imports or syntax`);
  }
  for (const [, file] of mutants) assert.equal(fs.readFileSync(path.join(temp, file), "utf8"), fs.readFileSync(path.join(repo, file), "utf8"), "the repository source was read, never written");
  console.log(`Post-freeze voice and turn-state mutation audit: PASS (${mutants.length}/${mutants.length} caught; ${copied.size} files in TEMP overlay)`);
} finally {
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("ayas-turn-state-audit-"));
  fs.rmSync(temp, { recursive: true, force: true });
}
