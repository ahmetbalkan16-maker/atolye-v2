/**
 * Atölye Brain — security + memory smoke suite.
 *
 * Pure, deterministic, GPU-free. Covers:
 *  A. Redaction — every secret class is scrubbed; deterministic.
 *  B. Shell allowlist — allowlisted execs pass, denied fragments block.
 *  C. Path containment — traversal / absolute / UNC rejected; writable prefixes.
 *  D. Request classification — safe / review / block.
 *  E. Security posture — local vs internet-facing grading + approval flags.
 *  F. Memory model — secret leak rejected, redaction, recall ordering + expiry.
 */

import assert from "node:assert/strict";
import {
  redactBrainText,
  containsBrainSecret,
  checkBrainShellCommand,
  isBrainPathContained,
  isBrainWritablePath,
  classifyBrainRequest,
  BRAIN_SECURITY_CATALOG,
  evaluateBrainSecurityPosture,
  buildBrainMemoryRecord,
  validateBrainMemoryRecord,
  recallBrainMemory,
} from "../src/lib/brain";
import type { BrainMemoryRecord, BrainSecurityPostureInput } from "../src/lib/brain";

let count = 0;
function scenario(name: string, test: () => void) {
  test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const T0 = "2026-09-08T00:00:00.000Z";
const T1 = "2026-09-08T06:00:00.000Z";

function run() {
  /* ------------------------------- A. Redaction ---------------------- */

  scenario("every secret class is scrubbed", () => {
    const cases: [string, RegExp][] = [
      ["key sk-proj-abcdefghij0123456789abcdefghij here", /\[redacted:openai-key\]/],
      ["anthropic sk-ant-api03-abcdefghij0123456789 x", /\[redacted:anthropic-key\]/],
      [`google AIza${"D9x_kQ2mP7vR4tYuI0oLzA3sJ6hG1bN5cWe".slice(0, 35)} y`, /\[redacted:google-key\]/],
      ["aws AKIAIOSFODNN7EXAMPLE z", /\[redacted:aws-key\]/],
      ["gh ghp_0123456789abcdefghijABCDEFGHIJ0123 w", /\[redacted:github-token\]/],
      ["Authorization: Bearer abcdef.ghijkl.mnopqr123456", /\[redacted:bearer-token\]/],
      ["jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N", /\[redacted:jwt\]/],
      ["OPENAI_API_KEY=verysecretvalue123", /\[redacted:env-secret-assignment\]/],
      ["db postgres://user:pass@host:5432/db now", /\[redacted:connection-string\]/],
      ["path C:\\Users\\Metod\\secret.txt end", /\[redacted:absolute-path\]/],
    ];
    for (const [input, expected] of cases) {
      const result = redactBrainText(input);
      assert.equal(result.redacted, true, input);
      assert.match(result.text, expected, input);
      // determinism
      assert.equal(redactBrainText(input).text, result.text);
    }
    assert.equal(containsBrainSecret("just a normal sentence about the 1453 siege"), false);
  });

  /* ------------------------------- B. Shell allowlist ---------------- */

  scenario("shell allowlist: allowed vs denied", () => {
    assert.equal(checkBrainShellCommand("npx tsc --noEmit").allowed, true);
    assert.equal(checkBrainShellCommand("npx tsx scripts/smoke-brain-foundation.ts").allowed, true);
    assert.equal(checkBrainShellCommand("graphify update .").allowed, true);
    assert.equal(checkBrainShellCommand("git status").allowed, true);
    // not on allowlist
    assert.equal(checkBrainShellCommand("python evil.py").allowed, false);
    assert.equal(checkBrainShellCommand("powershell -c whoami").allowed, false);
    // allowlisted exec but denied fragment
    assert.equal(checkBrainShellCommand("git push origin main").allowed, false);
    assert.equal(checkBrainShellCommand("git reset --hard HEAD").allowed, false);
    assert.equal(checkBrainShellCommand("npm publish").allowed, false);
    assert.equal(checkBrainShellCommand("node -e \"require('fs')\" > out.txt").allowed, false);
    assert.equal(checkBrainShellCommand("nvidia-smi -pl 90").allowed, false);
  });

  /* ------------------------------- C. Path containment --------------- */

  scenario("path containment rejects traversal / absolute / UNC", () => {
    assert.equal(isBrainPathContained("data/brain/experience/2026-09.json"), true);
    assert.equal(isBrainPathContained("docs/brain/architecture.md"), true);
    assert.equal(isBrainPathContained("../etc/passwd"), false);
    assert.equal(isBrainPathContained("data/../../secret"), false);
    assert.equal(isBrainPathContained("C:\\Windows\\System32"), false);
    assert.equal(isBrainPathContained("/etc/shadow"), false);
    assert.equal(isBrainPathContained("\\\\server\\share"), false);
    assert.equal(isBrainPathContained("data/brain/x\0.json"), false);
  });

  scenario("writable prefixes: only brain + graphify areas", () => {
    assert.equal(isBrainWritablePath("data/brain/state.json"), true);
    assert.equal(isBrainWritablePath("docs/brain/notes.md"), true);
    assert.equal(isBrainWritablePath(".graphify/graph.json"), true);
    assert.equal(isBrainWritablePath("data/projects/istanbul-1453/manifest.json"), false);
    assert.equal(isBrainWritablePath(".env.local"), false);
    assert.equal(isBrainWritablePath("src/lib/pipeline/PipelineRunner.ts"), false);
  });

  /* ------------------------------- D. Request classification --------- */

  scenario("request classification: safe / review / block", () => {
    assert.equal(classifyBrainRequest({ action: "read", target: "src/lib/brain/index.ts" }).risk, "safe");
    assert.equal(classifyBrainRequest({ action: "write", target: "docs/brain/notes.md" }).risk, "review");
    assert.equal(classifyBrainRequest({ action: "modify", target: ".env.local" }).risk, "review");
    assert.equal(classifyBrainRequest({ action: "delete", target: "data/projects/istanbul-1453" }).risk, "block");
    assert.equal(classifyBrainRequest({ action: "disable", target: "authentication middleware" }).risk, "block");
  });

  /* ------------------------------- E. Security posture --------------- */

  const localStudio: BrainSecurityPostureInput = {
    hasAuthMiddleware: false, hasAuthorizationChecks: false, hasRateLimiting: false,
    secretsOnlyInEnv: true, envFilesGitIgnored: true, hasAuditLog: false,
    hasHealthEndpoint: true, hasDependencyAuditScript: false, hasBackupTooling: true,
    pathContainmentEnforced: true, shellExecutionAllowlisted: true,
    internetFacing: false, observedAt: T0,
  };

  scenario("catalog has all 18 controls with deterministic checks", () => {
    assert.equal(BRAIN_SECURITY_CATALOG.length, 18);
    assert.ok(BRAIN_SECURITY_CATALOG.every((c) => c.deterministicCheck.length > 10));
    assert.ok(BRAIN_SECURITY_CATALOG.some((c) => c.id === "path-traversal" && c.currentStatus === "enforced-in-code"));
  });

  scenario("local studio posture: gaps are medium/low, not blocking; deterministic", () => {
    const a = evaluateBrainSecurityPosture(localStudio);
    const b = evaluateBrainSecurityPosture(localStudio);
    assert.deepEqual(a, b);
    assert.equal(a.readyForInternetExposure, false);
    assert.ok(a.findings.some((f) => f.controlId === "authentication"));
    // auth finding needs approval, and for a local studio it is not 'critical'
    const auth = a.findings.find((f) => f.controlId === "authentication")!;
    assert.equal(auth.requiresUserApproval, true);
    assert.notEqual(auth.severity, "critical");
  });

  scenario("internet-facing posture escalates auth to critical", () => {
    const posture = evaluateBrainSecurityPosture({ ...localStudio, internetFacing: true });
    const auth = posture.findings.find((f) => f.controlId === "authentication")!;
    assert.equal(auth.severity, "critical");
    assert.equal(posture.overall, "critical");
    assert.ok(posture.prioritizedBacklog[0] === "authentication");
  });

  /* ------------------------------- F. Memory model ------------------ */

  scenario("memory rejects a record that still holds a secret after redaction path", () => {
    // buildBrainMemoryRecord redacts; validate confirms nothing leaked
    const record = buildBrainMemoryRecord({
      kind: "environment-note",
      title: "ollama host",
      body: "OLLAMA_HOST is 127.0.0.1:11434 and the key is OPENAI_API_KEY=sk-proj-abcdefghij0123456789",
      importance: "normal", confidence: "observed", tags: ["ollama"],
      observedAt: T0, links: [],
    });
    assert.equal(record.redacted, true);
    assert.ok(!/sk-proj-abcdefghij/.test(record.body));
    assert.equal(validateBrainMemoryRecord(record).valid, true);
  });

  scenario("memory recall: importance desc, then recency; expiry drops non-pinned", () => {
    const mk = (over: Partial<Parameters<typeof buildBrainMemoryRecord>[0]>) =>
      buildBrainMemoryRecord({
        kind: "decision", title: "t", body: "b", importance: "normal",
        confidence: "observed", tags: ["x"], observedAt: T0, links: [], ...over,
      });
    const records: BrainMemoryRecord[] = [
      mk({ title: "old-normal", observedAt: "2026-09-01T00:00:00.000Z" }),
      mk({ title: "new-normal", observedAt: "2026-09-08T00:00:00.000Z" }),
      mk({ title: "pinned", importance: "pinned", observedAt: "2026-01-01T00:00:00.000Z" }),
      mk({ title: "expired", importance: "transient", observedAt: T0, expiresAt: "2026-09-05T00:00:00.000Z" }),
    ];
    const recall = recallBrainMemory(records, { tags: ["x"] }, T1);
    assert.equal(recall.droppedExpired, 1);
    assert.equal(recall.records[0].title, "pinned");
    assert.equal(recall.records[1].title, "new-normal");
    assert.equal(recall.records[2].title, "old-normal");
    assert.ok(recall.records.every((r) => r.title !== "expired"));
  });

  scenario("memory validation fails closed on bad timestamp / empty body", () => {
    const ok = buildBrainMemoryRecord({ kind: "decision", title: "t", body: "b", importance: "normal", confidence: "observed", tags: [], observedAt: T0, links: [] });
    assert.equal(validateBrainMemoryRecord({ ...ok, observedAt: "not-a-date" }).reasonCode, "BRAIN_MEMORY_TIMESTAMP_INVALID");
    assert.equal(validateBrainMemoryRecord({ ...ok, body: "  " }).reasonCode, "BRAIN_MEMORY_EMPTY_BODY");
  });

  console.log(`Atölye Brain security smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "brain-security", scenarios: count }));
}

try {
  run();
} catch (error) {
  console.error("Atölye Brain security smoke FAILED:", error);
  process.exitCode = 1;
}
