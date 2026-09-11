/**
 * AYAS tool registry + phone/pc node capability smoke suite (Phase 2 · Phase D · §6-7).
 *
 * Deterministic, no model, no fs. Confirms the registry is DERIVED from the
 * existing `AYAS_EXECUTION_ALLOWLIST` / `AYAS_EXECUTION_RESERVED_ACTIONS`
 * (not a second, drifting source of truth), that permission checks fail
 * closed on anything unknown or gate-locked, and that node capability
 * metadata never implies phone execution authority.
 */

import assert from "node:assert/strict";

import { AYAS_EXECUTION_ALLOWLIST, AYAS_EXECUTION_RESERVED_ACTIONS } from "../src/lib/ayas/execution/AyasExecutionPolicy";
import {
  AYAS_TOOL_REGISTRY,
  findAyasTool,
  checkAyasToolPermission,
} from "../src/lib/ayas/reasoning/AyasToolRegistry";
import { AYAS_NODE_CAPABILITIES, resolveAyasNodeCapabilities } from "../src/lib/ayas/reasoning/AyasReasoningTypes";

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

async function run() {
  await scenario("registry — every AYAS_EXECUTION_ALLOWLIST entry is present, read-only", () => {
    for (const id of Object.keys(AYAS_EXECUTION_ALLOWLIST)) {
      const tool = findAyasTool(id);
      assert.ok(tool, `${id} missing from the tool registry`);
      assert.equal(tool!.readOnly, true);
      assert.equal(tool!.requiredPermission, "read-only");
      assert.equal(tool!.description, AYAS_EXECUTION_ALLOWLIST[id as keyof typeof AYAS_EXECUTION_ALLOWLIST].summary);
    }
  });

  await scenario("registry — every reserved (write-shaped) action is present, execution-gate-locked, NOT read-only", () => {
    for (const id of AYAS_EXECUTION_RESERVED_ACTIONS) {
      const tool = findAyasTool(id);
      assert.ok(tool, `${id} missing from the tool registry`);
      assert.equal(tool!.readOnly, false);
      assert.equal(tool!.requiredPermission, "execution-gate");
    }
  });

  await scenario("permission — a real read-only action is allowed", () => {
    const r = checkAyasToolPermission("inspect-project");
    assert.equal(r.known, true);
    assert.equal(r.allowed, true);
  });

  await scenario("permission — a reserved write action is denied, citing the closed gate", () => {
    const r = checkAyasToolPermission("resume-stage");
    assert.equal(r.known, true);
    assert.equal(r.allowed, false);
    assert.match(r.reason, /yürütme kapısı|kapalı/);
  });

  await scenario("permission — every reserved action is denied (WRITE / EXECUTE / git push / deploy, all covered)", () => {
    // run-pipeline-stage / resume-stage / retry-stage / regenerate-stage / publish-youtube
    // stand in for WRITE / EXECUTE / git-push / deploy: none may ever be `allowed`.
    for (const id of AYAS_EXECUTION_RESERVED_ACTIONS) {
      assert.equal(checkAyasToolPermission(id).allowed, false, `${id} must never be allowed`);
    }
  });

  await scenario("permission — an unknown / hallucinated / terminal-shaped id is denied, not silently accepted", () => {
    for (const fake of ["run-terminal-command", "git-push", "deploy-production", "rm -rf /", "sudo su"]) {
      const r = checkAyasToolPermission(fake);
      assert.equal(r.known, false);
      assert.equal(r.allowed, false);
    }
    assert.equal(findAyasTool("does-not-exist"), null);
  });

  await scenario("registry — frozen at every level (no runtime mutation)", () => {
    assert.ok(Object.isFrozen(AYAS_TOOL_REGISTRY));
    for (const t of AYAS_TOOL_REGISTRY) assert.ok(Object.isFrozen(t));
  });

  /* ---------------- phone / pc node capabilities (§7) — metadata only ---------------- */

  await scenario("node capabilities — phone has NO filesystem/terminal/git/gpu/selfheal", () => {
    const phone = resolveAyasNodeCapabilities("phone");
    for (const forbidden of ["filesystem", "terminal", "git", "gpu", "selfheal"]) {
      assert.ok(!phone.includes(forbidden), `phone must not list "${forbidden}"`);
    }
    assert.ok(phone.includes("chat") && phone.includes("voice") && phone.includes("reasoning") && phone.includes("cloud"));
    assert.ok(phone.includes("memory.read") && !phone.includes("memory"), "phone gets read-only memory, not full memory");
  });

  await scenario("node capabilities — pc has the full local capability set", () => {
    const pc = resolveAyasNodeCapabilities("pc");
    for (const expected of ["chat", "voice", "memory", "filesystem", "terminal", "git", "gpu", "ollama", "selfheal"]) {
      assert.ok(pc.includes(expected), `pc must list "${expected}"`);
    }
  });

  await scenario("node capabilities — unknown node → empty, never throws", () => {
    // @ts-expect-error deliberate invalid input
    assert.deepEqual(resolveAyasNodeCapabilities("tablet"), []);
  });

  await scenario("node capabilities — this is metadata only, not a grant (no field here implies execution authority)", () => {
    for (const n of AYAS_NODE_CAPABILITIES) {
      assert.ok(Array.isArray(n.capabilities));
      // capability strings are plain labels — none of them is a permission object,
      // an id from AYAS_EXECUTION_ALLOWLIST, or anything the gate reads.
      for (const c of n.capabilities) assert.equal(typeof c, "string");
    }
  });

  console.log(`AYAS tool registry smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-tool-registry", scenarios: count }));
}

run().catch((error) => {
  console.error("AYAS tool registry smoke FAILED:", error);
  process.exitCode = 1;
});
