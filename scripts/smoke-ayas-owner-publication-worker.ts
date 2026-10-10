import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAyasApprovalInboxStore } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { createAyasAutonomyDaemon } from "../src/lib/brain/autonomy/AyasAutonomyDaemon";
import { reconcileAyasDevelopmentCenterFreshness } from "../src/lib/brain/autonomy/AyasDevelopmentCenterReconciliation";
import { AyasMicroBatchApprovalError } from "../src/lib/brain/autonomy/AyasMicroBatchApprovalService";
import { isAyasOwnerPublicationRunning, withAyasOwnerPublicationExclusive } from "../src/lib/brain/autonomy/AyasOwnerPublicationQueue";
import {
  AYAS_OWNER_PUBLICATION_INVALID_REQUEST,
  AYAS_OWNER_PUBLICATION_REPLY_PREFIX,
  AYAS_OWNER_PUBLICATION_WORKER_FAILED,
  AYAS_OWNER_PUBLICATION_WORKER_SCRIPT,
  ayasOwnerPublicationErrorReply,
  parseAyasOwnerPublicationRequest,
  readAyasOwnerPublicationReply,
  runAyasOwnerPublicationInWorker,
  settleAyasOwnerPublicationReply,
  type AyasOwnerPublicationRequest,
} from "../src/lib/brain/autonomy/AyasOwnerPublicationWorker";
import { AyasProposalApprovalError } from "../src/lib/brain/autonomy/AyasProposalApprovalService";
import { classifyAyasRuntimeImpactFile } from "../src/lib/brain/autonomy/AyasProposalRuntimeImpact";
import { classifyPatchTarget } from "../src/lib/brain/selfheal/BrainPatchSafety";

/**
 * The owner publication worker. ONAYLA VE UYGULA, BATCH ONAYLA VE UYGULA and
 * an executing owner APPROVE used to run their ~2.5 minute publication
 * (synchronous child processes throughout) on the Next server's event loop:
 * chat, the phone and the Access health probe all stalled for the whole run
 * (traces of 2026-10-10: 145 894 ms and 144 310 ms).
 *
 * Proves the queue keeps owner writes one at a time, the worker protocol
 * returns the service's result or its typed error unchanged, a worker that
 * fails is reported and frees the queue, the parent's event loop stays free
 * while a worker runs, the real worker script boots and runs the real
 * services, and a display refresh does not write the ledgers mid-run.
 *
 * Every worker runs in a TEMP directory with a minimal environment; nothing
 * reads or writes the repository's data/brain, git, the network or a model.
 */
let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const repo = process.cwd();
const temps: string[] = [];
function temp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}
/** No AYAS key, no model, no runtime root: only what Node and tsx need to start. */
const env: NodeJS.ProcessEnv = Object.fromEntries(
  ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "ComSpec", "WINDIR", "TEMP", "TMP", "USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA"]
    .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]),
);
env.NODE_ENV = "test";

const admission = { schema: "fixture-admission" } as unknown as AyasOwnerPublicationRequest["ownerAdmission"];
const proposalRequest = (proposalId = "ayas-proposal-fixture"): AyasOwnerPublicationRequest => ({ lane: "proposal", proposalId, proposalHash: "sha256:fixture", ownerAdmission: admission, executionOwnerAdmission: admission });

/** A stand-in worker: Node runs `body` with `reply(value)` and `busy(ms)` defined, and the request parsed from stdin as `request`. */
function fakeWorker(body: string): { readonly executable: string; readonly args: readonly string[] } {
  const prelude = [
    `const PREFIX = ${JSON.stringify(AYAS_OWNER_PUBLICATION_REPLY_PREFIX)};`,
    "const reply = (value) => process.stdout.write('\\n' + PREFIX + JSON.stringify({ kind: 'result', value }) + '\\n');",
    "const busy = (ms) => { const end = Date.now() + ms; while (Date.now() < end) { /* hold the worker's own thread */ } };",
    "let text = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (c) => { text += c; });",
    "process.stdin.on('end', () => { const request = JSON.parse(text);",
  ].join("\n");
  return { executable: process.execPath, args: ["-e", `${prelude}\n${body}\n});`] };
}

/** Largest gap between 20 ms ticks of this process's own event loop while `work` runs. */
async function largestEventLoopGap(work: () => Promise<unknown>): Promise<number> {
  let last = Date.now();
  let largest = 0;
  const timer = setInterval(() => { const now = Date.now(); largest = Math.max(largest, now - last); last = now; }, 20);
  try { await work(); } finally { clearInterval(timer); }
  return Math.max(largest, Date.now() - last);
}

async function main(): Promise<void> {
  await scenario("the queue runs owner writes one at a time, in order, and a failure does not block the next", async () => {
    const events: string[] = [];
    assert.equal(isAyasOwnerPublicationRunning(), false);
    const job = (name: string, ms: number, fail = false) => withAyasOwnerPublicationExclusive(async () => {
      events.push(`start ${name}`);
      assert.equal(isAyasOwnerPublicationRunning(), true);
      await new Promise((resolve) => setTimeout(resolve, ms));
      events.push(`end ${name}`);
      if (fail) throw new Error(`fixture failure ${name}`);
      return name;
    });
    const results = await Promise.allSettled([job("a", 60), job("b", 10, true), job("c", 5)]);
    assert.deepEqual(events, ["start a", "end a", "start b", "end b", "start c", "end c"]);
    assert.deepEqual(results.map((r) => r.status), ["fulfilled", "rejected", "fulfilled"]);
    assert.equal(isAyasOwnerPublicationRunning(), false);
    assert.ok((globalThis as Record<symbol, unknown>)[Symbol.for("atolye.ayas.ownerPublicationQueue.v1")], "one queue per process, on globalThis");
  });

  await scenario("the reply line protocol: the last reply wins, noise and malformed lines are not replies", () => {
    const line = (value: unknown) => `${AYAS_OWNER_PUBLICATION_REPLY_PREFIX}${JSON.stringify(value)}`;
    assert.deepEqual(readAyasOwnerPublicationReply(["log", line({ kind: "result", value: 1 }), "more log", line({ kind: "result", value: 2 })].join("\r\n")), { kind: "result", value: 2 });
    assert.equal(readAyasOwnerPublicationReply("log only\n"), undefined);
    assert.equal(readAyasOwnerPublicationReply(`${AYAS_OWNER_PUBLICATION_REPLY_PREFIX}{not json`), undefined);
    assert.equal(readAyasOwnerPublicationReply(line({ kind: "other", value: 1 })), undefined);
    assert.equal(readAyasOwnerPublicationReply(line({ kind: "error" })), undefined, "an error reply needs its message");
  });

  await scenario("a reply settles exactly as the in-process call did: result as-is, each service error with its class and code", () => {
    const value = { ok: false, code: "AYAS_PROPOSAL_PUSH_FAILED", stage: "PUSH", message: "m", graphifyEvidenceItemIds: [] };
    assert.deepEqual(settleAyasOwnerPublicationReply({ kind: "result", value }), value);
    const roundTrip = (error: unknown) => { try { settleAyasOwnerPublicationReply(JSON.parse(JSON.stringify(ayasOwnerPublicationErrorReply(error)))); } catch (thrown) { return thrown; } assert.fail("must throw"); };
    const proposal = roundTrip(new AyasProposalApprovalError("PROPOSAL_HASH_MISMATCH", "changed"));
    assert.ok(proposal instanceof AyasProposalApprovalError); assert.equal(proposal.code, "PROPOSAL_HASH_MISMATCH"); assert.equal(proposal.message, "changed");
    const batch = roundTrip(new AyasMicroBatchApprovalError("NOT_READY", "batch moved"));
    assert.ok(batch instanceof AyasMicroBatchApprovalError); assert.equal(batch.code, "NOT_READY");
    const plain = roundTrip(new Error("OWNER_ADMISSION_REQUIRED"));
    assert.ok(plain instanceof Error && !(plain instanceof AyasProposalApprovalError)); assert.equal((plain as Error).message, "OWNER_ADMISSION_REQUIRED");
    assert.equal((roundTrip("bare string") as Error).message, "bare string");
  });

  await scenario("the worker accepts only the three lanes, with both admissions and non-empty subjects", () => {
    const text = (value: unknown) => JSON.stringify(value);
    assert.equal(parseAyasOwnerPublicationRequest(text(proposalRequest())).lane, "proposal");
    assert.equal(parseAyasOwnerPublicationRequest(text({ lane: "micro-batch", batchId: "b", batchHash: "h", ownerAdmission: {}, executionOwnerAdmission: {} })).lane, "micro-batch");
    assert.equal(parseAyasOwnerPublicationRequest(text({ lane: "owner-approve", binding: { proposalId: "p" }, ownerAdmission: {}, executionOwnerAdmission: {} })).lane, "owner-approve");
    for (const bad of ["{", text([]), text({ ...proposalRequest(), lane: "execute" }), text({ ...proposalRequest(), proposalId: " " }), text({ ...proposalRequest(), ownerAdmission: undefined }),
      text({ ...proposalRequest(), executionOwnerAdmission: [] }), text({ lane: "owner-approve", ownerAdmission: {}, executionOwnerAdmission: {} }), text({ lane: "micro-batch", batchId: "b", ownerAdmission: {}, executionOwnerAdmission: {} })]) {
      assert.throws(() => parseAyasOwnerPublicationRequest(bad), new RegExp(AYAS_OWNER_PUBLICATION_INVALID_REQUEST), bad);
    }
  });

  await scenario("the request reaches the worker intact on stdin, in the repository directory it was given", async () => {
    const cwd = temp("ayas-opw-cwd-");
    const request = proposalRequest("ayas-proposal-ünicode-ı");
    const result = await runAyasOwnerPublicationInWorker(request, { repoRoot: cwd, env, command: fakeWorker("reply({ request, cwd: process.cwd() });") }) as unknown as { request: unknown; cwd: string };
    assert.deepEqual(result.request, request);
    assert.equal(fs.realpathSync(result.cwd), fs.realpathSync(cwd));
  });

  await scenario("a worker error reply is rethrown as the service's own error, so the action maps its code as before", async () => {
    const command = fakeWorker(`process.stdout.write('\\n' + PREFIX + ${JSON.stringify(JSON.stringify({ kind: "error", errorClass: "AyasProposalApprovalError", code: "RUNTIME_IMPACT_NOT_PUBLISHABLE", message: "not here" }))} + '\\n');`);
    await assert.rejects(runAyasOwnerPublicationInWorker(proposalRequest(), { repoRoot: temp("ayas-opw-"), env, command }), (error: unknown) => error instanceof AyasProposalApprovalError && error.code === "RUNTIME_IMPACT_NOT_PUBLISHABLE");
  });

  await scenario("a worker that ends without a reply, or cannot start, is reported as one code and frees the queue", async () => {
    const quiet = console.error;
    const logged: string[] = [];
    console.error = (...parts: unknown[]) => { logged.push(parts.join(" ")); };
    try {
      await assert.rejects(runAyasOwnerPublicationInWorker(proposalRequest(), { repoRoot: temp("ayas-opw-"), env, command: fakeWorker("process.stderr.write('fixture crash'); process.exit(3);") }), new RegExp(`^Error: ${AYAS_OWNER_PUBLICATION_WORKER_FAILED}$`));
      await assert.rejects(runAyasOwnerPublicationInWorker(proposalRequest(), { repoRoot: temp("ayas-opw-"), env, command: { executable: path.join(temp("ayas-opw-missing-"), "no-such-node.exe"), args: [] } }), new RegExp(`^Error: ${AYAS_OWNER_PUBLICATION_WORKER_FAILED}$`));
    } finally {
      console.error = quiet;
    }
    assert.ok(logged.some((line) => line.includes("exit 3") && line.includes("fixture crash")), "the server log keeps the exit code and stderr tail");
    assert.equal(isAyasOwnerPublicationRunning(), false);
    const after = await runAyasOwnerPublicationInWorker(proposalRequest(), { repoRoot: temp("ayas-opw-"), env, command: fakeWorker("reply('next');") });
    assert.equal(after, "next", "the queue still runs the next click");
  });

  await scenario("a reply printed before a non-zero exit is still the outcome: the work it reports already happened", async () => {
    const result = await runAyasOwnerPublicationInWorker(proposalRequest(), { repoRoot: temp("ayas-opw-"), env, command: fakeWorker("reply({ ok: true, commitSha: 'abc' }); process.exitCode = 9;") });
    assert.deepEqual(result, { ok: true, commitSha: "abc" });
  });

  await scenario("two clicks at once run their workers one after the other, never overlapping", async () => {
    const command = fakeWorker("const start = Date.now(); busy(300); reply({ start, end: Date.now() });");
    const [first, second] = await Promise.all([
      runAyasOwnerPublicationInWorker(proposalRequest("one"), { repoRoot: temp("ayas-opw-"), env, command }),
      runAyasOwnerPublicationInWorker(proposalRequest("two"), { repoRoot: temp("ayas-opw-"), env, command }),
    ]) as unknown as { start: number; end: number }[];
    assert.ok(second!.start >= first!.end, `second started ${second!.start - first!.end} ms before the first ended`);
  });

  await scenario("while a worker holds its own thread for 1.5 s the server's event loop keeps ticking; the same hold in-process does not", async () => {
    const free = await largestEventLoopGap(() => runAyasOwnerPublicationInWorker(proposalRequest(), { repoRoot: temp("ayas-opw-"), env, command: fakeWorker("busy(1500); reply('done');") }));
    assert.ok(free < 500, `event loop stalled ${free} ms while the worker ran`);
    // Negative control: the measurement does see a synchronous hold, which is what the old in-process run was.
    const blocked = await largestEventLoopGap(async () => { execFileSync(process.execPath, ["-e", "const end = Date.now() + 1000; while (Date.now() < end) {}"], { windowsHide: true }); });
    assert.ok(blocked >= 900, `negative control saw only ${blocked} ms`);
  });

  await scenario("the real worker script boots under tsx and runs the real services: each lane answers for a subject that does not exist", async () => {
    const fixture = temp("ayas-opw-real-");
    const command = { executable: process.execPath, args: [path.join(repo, "node_modules", "tsx", "dist", "cli.mjs"), "--tsconfig", path.join(repo, "tsconfig.json"), path.join(repo, AYAS_OWNER_PUBLICATION_WORKER_SCRIPT)] };
    const started = Date.now();
    await assert.rejects(runAyasOwnerPublicationInWorker(proposalRequest("ayas-proposal-absent"), { repoRoot: fixture, env, command }), (error: unknown) => error instanceof AyasProposalApprovalError && error.code === "NOT_FOUND");
    const bootMs = Date.now() - started;
    await assert.rejects(runAyasOwnerPublicationInWorker({ lane: "micro-batch", batchId: "ayas-batch-absent", batchHash: "sha256:fixture", ownerAdmission: admission, executionOwnerAdmission: admission }, { repoRoot: fixture, env, command }), (error: unknown) => error instanceof Error && /NOT_FOUND|not found/i.test(`${(error as { code?: string }).code ?? ""} ${error.message}`));
    const binding = { proposalId: "ayas-proposal-absent", proposalHash: "sha256:fixture", baseHead: "1".repeat(40), exactFiles: ["scripts/smoke-fixture.ts"], safetyClassification: "SAFE" as const, boundAt: "2026-10-10T00:00:00.000Z" };
    const decided = await runAyasOwnerPublicationInWorker({ lane: "owner-approve", binding, ownerAdmission: admission, executionOwnerAdmission: admission }, { repoRoot: fixture, env, command });
    assert.equal(decided.executed, false);
    if (!decided.executed) assert.equal(decided.reason, "PROPOSAL_NOT_FOUND");
    await assert.rejects(runAyasOwnerPublicationInWorker({ lane: "proposal", proposalId: "x", proposalHash: "y" } as unknown as AyasOwnerPublicationRequest, { repoRoot: fixture, env, command }), new RegExp(`^Error: ${AYAS_OWNER_PUBLICATION_INVALID_REQUEST}$`));
    // Nothing was decided: the fixture holds no ledger and the repository's own is never in reach (cwd is the fixture).
    assert.equal(fs.existsSync(path.join(fixture, "data", "brain", "autonomy", "approval-inbox.json")), false);
    if (process.env.SMOKE_TRACE === "1") console.log(`real worker boot + NOT_FOUND: ${bootMs} ms`);
  });

  await scenario("a display refresh never writes the ledgers while an owner publication runs, and does afterwards", async () => {
    const brainRoot = temp("ayas-opw-reconcile-");
    const inbox = createAyasApprovalInboxStore({ rootDir: brainRoot });
    const observation = { now: "2026-10-10T08:00:00.000Z", branch: "wip/test", head: "1".repeat(40), repoClean: true, graphifyFresh: true, machineAction: "ALLOW" as const, gaps: [] as string[] };
    const candidate = { objective: "bounded evidence-backed regression coverage", currentProblem: "a deterministic fixture proves a missing lifecycle assertion", selectionReason: "the fixture is reproducible", expectedUserBenefit: "a regression is caught before release", expectedBehaviorChange: "one lifecycle invariant is checked", unchangedBehavior: "approval and execution remain owner-controlled", riskIfNotDone: "the regression can recur", technicalRisk: "low", productionImpact: "none before separate approval", rationale: "controlled local evidence", evidence: ["fixture:missing-lifecycle-assertion"], graphifyEvidence: ["bounded test-only dependency surface"], exactFiles: ["scripts/smoke-fixture.ts"], expectedDiffScope: "+1 deterministic assertion", testsPlanned: ["smoke fixture"], risk: "low", rank: 1, mutationKind: "test-fixture-mutation", discoverySource: "LOCAL_DISCOVERY" as const };
    const [created] = createAyasAutonomyDaemon({ inbox }).discover(observation, [candidate]);
    assert.ok(created);
    const at = { brainRoot, readHead: () => "2".repeat(40), now: () => "2026-10-10T09:00:00.000Z" };
    const revision = inbox.load().revision;
    assert.deepEqual(reconcileAyasDevelopmentCenterFreshness({ ...at, publicationRunning: () => true }).staleProposalIds, []);
    // Production wiring: inside the queue, with no seam, the running publication is seen.
    await withAyasOwnerPublicationExclusive(async () => { assert.deepEqual(reconcileAyasDevelopmentCenterFreshness(at).staleProposalIds, []); });
    assert.equal(inbox.load().revision, revision, "no write at all while a publication runs");
    assert.equal(inbox.load().proposals[0]?.status, "PENDING");
    assert.deepEqual(reconcileAyasDevelopmentCenterFreshness(at).staleProposalIds, [created.proposalId], "the first read after the run retires it");
    assert.equal(inbox.load().proposals[0]?.status, "STALE");
  });

  await scenario("wiring: the one-click actions hand their click to the worker; the other ledger writers wait in the same queue", () => {
    const actions = fs.readFileSync(path.join(repo, "app", "brain", "actions.ts"), "utf8");
    const body = (name: string) => { const start = actions.indexOf(`export async function ${name}(`); return actions.slice(start, actions.indexOf("\n}\n", start)); };
    assert.match(body("proposalOnaylaVeUygula"), /runAyasOwnerPublicationInWorker\(\{ lane: "proposal", proposalId: input\.proposalId, proposalHash: input\.proposalHash, ownerAdmission, executionOwnerAdmission \}\)/);
    assert.match(body("batchOnaylaVeUygula"), /runAyasOwnerPublicationInWorker\(\{ lane: "micro-batch", batchId: input\.batchId, batchHash: input\.batchHash, ownerAdmission, executionOwnerAdmission \}\)/);
    assert.match(body("ayasOwnerApprovalDecision"), /executionOwnerAdmission\s*\? await runAyasOwnerPublicationInWorker\(\{ lane: "owner-approve", binding: input\.binding, ownerAdmission, executionOwnerAdmission \}\)\s*: await withAyasOwnerPublicationExclusive\(/);
    assert.match(body("decideAyasApproval"), /return withAyasOwnerPublicationExclusive\(async \(\) => \{/);
    assert.match(body("executeAyasApprovedProposal"), /await withAyasOwnerPublicationExclusive\(\(\) => executeAyasApprovedProposalWith\(/);
    const code = actions.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /\b(?:approveAndExecuteAyasProposal|approveAndExecuteAyasMicroBatch)\(/, "no one-click publication runs on the server's event loop any more");
    const worker = fs.readFileSync(path.join(repo, "src", "lib", "brain", "autonomy", "AyasOwnerPublicationWorker.ts"), "utf8");
    assert.match(worker, /windowsHide: true/, "the worker never opens a console window");
    assert.doesNotMatch(worker.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""), /\.kill\(|detached:\s*true|shell:\s*true/, "the worker is never killed, detached or run through a shell");
  });

  await scenario("AYAS can never publish a change to the worker, its queue or its entry: authority class, never SAFE", () => {
    for (const file of ["src/lib/brain/autonomy/AyasOwnerPublicationWorker.ts", "src/lib/brain/autonomy/AyasOwnerPublicationQueue.ts", AYAS_OWNER_PUBLICATION_WORKER_SCRIPT]) {
      assert.equal(classifyAyasRuntimeImpactFile(file).impactClass, "AUTHORITY_OR_STORAGE", file);
      assert.notEqual(classifyPatchTarget(file).level, "SAFE", file);
    }
  });

  await scenario("Gelişim Merkezi names the worker failure in Turkish on all three one-click controls", () => {
    const src = fs.readFileSync(path.join(repo, "src", "components", "brain", "AyasDevelopmentCenter.tsx"), "utf8");
    for (const map of ["proposalOnaylaErrorLabel", "ayasOwnerDecisionErrorLabel", "batchOnaylaErrorLabel"]) {
      const start = src.indexOf(`const ${map}: Record<string, string> = {`);
      assert.ok(start >= 0, `${map} exists`);
      assert.match(src.slice(start, src.indexOf("};", start)), new RegExp(`${AYAS_OWNER_PUBLICATION_WORKER_FAILED}: "İşlem çalıştırıcısı`), map);
    }
  });

  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
  console.log(`AYAS owner publication worker smoke: PASS (${count} scenarios)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
