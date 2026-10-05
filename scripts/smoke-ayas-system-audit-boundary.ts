/** Supplemental operator boundary and protected exclusion checks; historical graders stay frozen. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectAyasSystemAudit, createLocalAyasAuditCollector, inventoryAyasAuditProtectedRoots } from "../src/lib/ayas/audit/AyasSystemAuditCollector";
import { createAyasAuditOperatorProbes } from "./lib/AyasSystemAuditProbes";
import { auditGraphFixture, AUDIT_HEAD, AUDIT_NOW } from "./fixtures/ayas-system-audit-fixture";
async function main() {
  const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "ayas-audit-boundary-"));
  let checks = 0;
  try {
    assert.throws(() => createLocalAyasAuditCollector(root, undefined as never), /AUDIT_PROBES_REQUIRED/); checks++;
    const deps = createLocalAyasAuditCollector(root, { repository: () => ({ head: AUDIT_HEAD, branch: "codex/fixture" }), graph: async () => auditGraphFixture() });
    deps.clock = () => AUDIT_NOW; deps.declaredSuites = 166; deps.readSource = () => Buffer.from("source fixture");
    const empty = await collectAyasSystemAudit(deps);
    assert.equal(empty.report.closure, "STATIC_AUDIT_COMPLETE");
    assert.equal(empty.input.coverage.executed, 0);
    assert.equal(empty.input.evidence.filter(e => e.state === "NOT_RUN").length, 30); checks++;
    assert.throws(() => createLocalAyasAuditCollector(root, { ...deps }).readSource("arbitrary-file"), /AUDIT_SOURCE_NOT_REGISTERED/); checks++;
    const brain = path.join(root, "data/brain"); fs.mkdirSync(brain, { recursive: true });
    const credential = path.join(brain, "secret-canary.json"); fs.writeFileSync(credential, "synthetic canary");
    const originalOpen = fs.openSync;
    fs.openSync = ((file: Parameters<typeof fs.openSync>[0], ...args: [Parameters<typeof fs.openSync>[1], Parameters<typeof fs.openSync>[2]?]) => {
      assert.notEqual(String(file), credential, "CREDENTIAL_BODY_MUST_NOT_OPEN"); return originalOpen(file, ...args);
    }) as typeof fs.openSync;
    try { const inv = inventoryAyasAuditProtectedRoots(root); assert.equal(inv.complete, false); assert.equal(inv.exclusions?.credentialFiles, 1); } finally { fs.openSync = originalOpen; } checks++;
    const media = path.join(brain, "large-media.bin"), fd = fs.openSync(media, "w");
    try { fs.ftruncateSync(fd, 16 * 1024 * 1024 + 1); } finally { fs.closeSync(fd); }
    const inv = inventoryAyasAuditProtectedRoots(root); assert.equal(inv.exclusions?.sizeOrByteBudgetFiles, 1); assert.equal(inv.complete, false); checks++;
    const excluded = await collectAyasSystemAudit(deps);
    assert.equal(excluded.report.closure, "BLOCKED"); assert.deepEqual(excluded.protectedExclusionsBefore, excluded.protectedExclusionsAfter); checks++;
    let probes = 0; deps.repository = () => ({ head: ++probes === 1 ? AUDIT_HEAD : "2".repeat(40), branch: "codex/fixture" });
    const drift = await collectAyasSystemAudit(deps); assert.equal(drift.branchOrHeadChanged, true); assert.equal(drift.report.closure, "BLOCKED"); checks++;
    fs.mkdirSync(path.join(root, "scripts"));
    fs.writeFileSync(path.join(root, "scripts/ayas-graphify-status.ts"), 'throw Error("UNTRUSTED_REPO_CODE_RAN")');
    const facts = await createAyasAuditOperatorProbes(root).graph(); assert.equal(facts.sourceHead, null); checks++;
    const current = createAyasAuditOperatorProbes(process.cwd()).repository(); assert.match(current.head ?? "", /^[a-f0-9]{40}$/); checks++;
    const currentGraph = await createAyasAuditOperatorProbes(process.cwd()).graph(); assert.equal(currentGraph.sourceHead, current.head); checks++;
    console.log(JSON.stringify({ status: "PASS", checks, scope: "TEMP_FIXED_READ_ONLY_PROBES_NO_AUTHORITY_NO_CREDENTIAL_BODY", sourceExistenceDoesNotQualifyTestOrLive: true }));
  } finally {
    assert.equal(path.dirname(fs.realpathSync.native(root)).toLowerCase(), fs.realpathSync.native(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(root).startsWith("ayas-audit-boundary-")); fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
