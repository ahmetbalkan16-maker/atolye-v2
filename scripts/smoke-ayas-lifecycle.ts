/**
 * Stage 15E — model and strategy lifecycle. Deterministic and offline: the
 * contract is pure, the registry of record is a constant, and identity checks
 * read repository files or TEMP fixtures. No model, no network, no install.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  AYAS_LIFECYCLE_KINDS, AYAS_LIFECYCLE_PROMOTION_CHECKS, AYAS_LIFECYCLE_STATES, AYAS_LIFECYCLE_TASK_CLASSES,
  auditAyasLifecycleEntry, auditAyasLifecycleRegistry, ayasLifecycleMayServe, decideAyasLifecycleRegression, evaluateAyasLifecyclePromotion,
  findAyasLifecycleFindings, isAyasLifecycleTransitionLegal,
  type AyasLifecycleEntry, type AyasLifecycleEvidence, type AyasLifecycleRecord, type AyasLifecycleState,
} from "../src/lib/ayas/lifecycle/AyasLifecycle";
import { AYAS_LIFECYCLE_REGISTRY, findAyasLifecycleEntry, findAyasLifecycleEntryForOllamaTag } from "../src/lib/ayas/lifecycle/AyasLifecycleRegistry";
import { computeAyasLifecycleSourceDigest, verifyAyasLifecycleIdentities } from "../src/lib/ayas/lifecycle/AyasLifecycleVerifier";
import { ayasLocalCodingCandidatePins } from "../src/lib/brain/autonomy/AyasLocalCodingPins";

const repo = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-lifecycle-"));
let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) { await test(); count++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

const SHA = "a".repeat(64);
const pass = (comparedTo?: string): AyasLifecycleEvidence => ({ result: "PASS", ref: "docs/fixture.md", summary: "fixture evidence", ...(comparedTo ? { comparedTo } : {}) });
const none: AyasLifecycleEvidence = { result: "NOT_MEASURED", ref: "", summary: "not measured" };
const fullRecord = (comparedTo?: string): AyasLifecycleRecord => ({ capability: pass(), regression: pass(comparedTo), security: pass(), hardwareFit: pass(), consistency: pass(), heldOut: pass(), resourceUse: pass() });
const emptyRecord: AyasLifecycleRecord = { capability: none, regression: none, security: none, hardwareFit: none, consistency: none, heldOut: none, resourceUse: none };
const CHAIN: readonly AyasLifecycleState[] = ["DISCOVERED", "PINNED", "QUALIFIED", "SHADOW", "CANARY", "ACTIVE"];
const historyTo = (state: AyasLifecycleState, month = "10") => CHAIN.slice(0, CHAIN.indexOf(state) + 1).map((step, index) => ({ state: step, on: `2026-${month}-0${index + 1}`, basis: "fixture" }));

/** The incumbent of the fixture role: promoted, active, first of its role. */
const incumbent: AyasLifecycleEntry = {
  id: "llm.fixture.old", kind: "llm", role: "fixture-role", label: "old model", identity: { type: "ollama-digest", tag: "old:1", digest: SHA },
  state: "ACTIVE", admission: "PROMOTED", compatibility: "fixture", record: fullRecord(), rollbackTarget: null, history: historyTo("ACTIVE", "09"), notes: "fixture",
};
/** A newer candidate with everything on record, compared against the incumbent. */
function candidate(state: AyasLifecycleState, over: Partial<AyasLifecycleEntry> = {}): AyasLifecycleEntry {
  const serving = ["SHADOW", "CANARY", "ACTIVE"].includes(state);
  return {
    id: "llm.fixture.new", kind: "llm", role: "fixture-role", label: "new model", identity: { type: "ollama-digest", tag: "new:1", digest: "b".repeat(64) },
    state, admission: serving ? "PROMOTED" : "NONE", compatibility: "fixture", record: fullRecord("llm.fixture.old"), rollbackTarget: "llm.fixture.old",
    history: historyTo(state), notes: "fixture", ...over,
  };
}
const codes = (entry: AyasLifecycleEntry): string[] => auditAyasLifecycleEntry(entry).map((violation) => violation.code);
const registryCodes = (registry: readonly AyasLifecycleEntry[]): string[] => auditAyasLifecycleRegistry(registry).map((violation) => `${violation.id}:${violation.code}`);

async function main() {
  await scenario("eight states, one legal path forward, degraded returns only by re-qualification, retired is final", () => {
    assert.deepEqual([...AYAS_LIFECYCLE_STATES], ["DISCOVERED", "PINNED", "QUALIFIED", "SHADOW", "CANARY", "ACTIVE", "DEGRADED", "RETIRED"]);
    assert.deepEqual([...AYAS_LIFECYCLE_KINDS], ["llm", "coding-model", "speech-model", "media-helper", "prompt", "improvement-strategy", "evaluator"]);
    const legal: Record<string, string[]> = {
      DISCOVERED: ["PINNED", "RETIRED"], PINNED: ["QUALIFIED", "DEGRADED", "RETIRED"], QUALIFIED: ["SHADOW", "DEGRADED", "RETIRED"], SHADOW: ["CANARY", "DEGRADED", "RETIRED"],
      CANARY: ["ACTIVE", "DEGRADED", "RETIRED"], ACTIVE: ["DEGRADED", "RETIRED"], DEGRADED: ["QUALIFIED", "RETIRED"], RETIRED: [],
    };
    for (const from of AYAS_LIFECYCLE_STATES) for (const to of AYAS_LIFECYCLE_STATES) assert.equal(isAyasLifecycleTransitionLegal(from, to), legal[from]!.includes(to), `${from} -> ${to}`);
    for (const bogus of ["", "ACTIVE ", "active", "__proto__", "constructor"]) assert.equal(isAyasLifecycleTransitionLegal(bogus as AyasLifecycleState, "RETIRED"), false);
    assert.ok(Object.isFrozen(AYAS_LIFECYCLE_STATES) && Object.isFrozen(AYAS_LIFECYCLE_KINDS) && Object.isFrozen(AYAS_LIFECYCLE_TASK_CLASSES));
  });

  await scenario("an entry's state must be backed by what it records", () => {
    for (const state of CHAIN) assert.deepEqual(codes(candidate(state)), [], state);
    // A tag is not an identity: nothing unpinned gets past DISCOVERED.
    const unpinned = { type: "UNPINNED", reason: "mutable tag" } as const;
    assert.deepEqual(codes(candidate("DISCOVERED", { identity: unpinned, record: emptyRecord })), []);
    for (const state of ["PINNED", "QUALIFIED", "SHADOW", "CANARY", "ACTIVE"] as const) assert.ok(codes(candidate(state, { identity: unpinned })).includes("IDENTITY_REQUIRED"), state);
    // Each of the six checks is required from QUALIFIED on; PARTIAL, FAIL and NOT_MEASURED are not PASS.
    for (const check of AYAS_LIFECYCLE_PROMOTION_CHECKS) for (const result of ["PARTIAL", "FAIL", "NOT_MEASURED"] as const) for (const state of ["QUALIFIED", "SHADOW", "CANARY", "ACTIVE"] as const) {
      const record = { ...fullRecord("llm.fixture.old"), [check]: { result, ref: result === "NOT_MEASURED" ? "" : "docs/fixture.md", summary: "fixture" } };
      assert.deepEqual(codes(candidate(state, { record })), ["EVIDENCE_REQUIRED"], `${state} ${check} ${result}`);
    }
    assert.deepEqual(codes(candidate("PINNED", { record: emptyRecord })), []);
    // A claimed result needs a record to point at.
    assert.ok(codes(candidate("ACTIVE", { record: { ...fullRecord("llm.fixture.old"), security: { result: "PASS", ref: "", summary: "trust me" } } })).includes("EVIDENCE_REF_REQUIRED"));
    for (const ref of ["../outside.md", "C:/outside.md", "/etc/passwd", "docs\\x.md"]) assert.ok(codes(candidate("ACTIVE", { record: { ...fullRecord(), capability: { result: "PASS", ref, summary: "x" } } })).includes("ENTRY_SHAPE_INVALID"), ref);
  });

  await scenario("history is append-only evidence: it starts at DISCOVERED, each step is legal, and it ends at the state", () => {
    const step = (state: AyasLifecycleState, on: string) => ({ state, on, basis: "fixture" });
    assert.deepEqual(codes(candidate("ACTIVE", { history: [step("PINNED", "2026-10-01"), step("ACTIVE", "2026-10-02")] })), ["HISTORY_INVALID"]);
    assert.deepEqual(codes(candidate("ACTIVE", { history: [] })), ["HISTORY_INVALID"]);
    assert.deepEqual(codes(candidate("ACTIVE", { history: [step("DISCOVERED", "2026-10-02"), step("PINNED", "2026-10-01")] })), ["HISTORY_INVALID"]);
    assert.deepEqual(codes(candidate("ACTIVE", { history: [step("DISCOVERED", "yesterday")] })), ["HISTORY_INVALID"]);
    assert.deepEqual(codes(candidate("ACTIVE", { history: [{ state: "DISCOVERED", on: "2026-10-01", basis: "" }] })), ["HISTORY_INVALID"]);
    // Newer is not better: a model cannot jump from pinned to active.
    assert.deepEqual(codes(candidate("ACTIVE", { history: [step("DISCOVERED", "2026-10-01"), step("PINNED", "2026-10-02"), step("ACTIVE", "2026-10-03")] })), ["TRANSITION_ILLEGAL"]);
    assert.deepEqual(codes(candidate("ACTIVE", { history: historyTo("CANARY") })), ["STATE_HISTORY_MISMATCH"]);
    const retired = [...historyTo("ACTIVE"), step("RETIRED", "2026-10-07"), step("PINNED", "2026-10-08")];
    assert.ok(codes(candidate("PINNED", { admission: "NONE", history: retired })).includes("TRANSITION_ILLEGAL"));
  });

  await scenario("degraded needs a cause, promotion needs a serving state, retired is not used, shapes are closed", () => {
    const degraded = [...historyTo("ACTIVE"), { state: "DEGRADED" as const, on: "2026-10-07", basis: "regression" }];
    assert.deepEqual(codes(candidate("DEGRADED", { admission: "NONE", history: degraded })), ["DEGRADED_WITHOUT_CAUSE"]);
    assert.deepEqual(codes(candidate("DEGRADED", { admission: "NONE", history: degraded, record: { ...fullRecord(), capability: { result: "FAIL", ref: "docs/fixture.md", summary: "regressed" } } })), []);
    for (const state of ["DISCOVERED", "PINNED", "QUALIFIED"] as const) assert.deepEqual(codes(candidate(state, { admission: "PROMOTED" })), ["PROMOTED_BELOW_SHADOW"], state);
    const retired = [...historyTo("ACTIVE"), { state: "RETIRED" as const, on: "2026-10-07", basis: "replaced" }];
    assert.ok(codes(candidate("RETIRED", { admission: "OWNER_SELECTED", history: retired })).includes("RETIRED_STILL_ADMITTED"));
    assert.deepEqual(codes(candidate("RETIRED", { admission: "NONE", history: retired })), []);
    for (const over of [{ id: "X" }, { id: "" }, { kind: "agent" }, { role: "" }, { state: "LIVE" }, { admission: "AUTO" }, { rollbackTarget: "../x" }, { notes: "" }, { record: null }, { history: "none" }]) {
      assert.deepEqual(codes(candidate("ACTIVE", over as never)), ["ENTRY_SHAPE_INVALID"], JSON.stringify(over));
    }
    for (const identity of [{ type: "sha256-file", sha256: "short", sizeBytes: 1, locator: "x" }, { type: "sha256-file", sha256: SHA, sizeBytes: 0, locator: "x" }, { type: "ollama-digest", tag: "", digest: SHA },
      { type: "hf-revision", repository: "a/b", revision: "main", file: "f", sha256: SHA }, { type: "source-digest", files: [], sha256: SHA }, { type: "source-digest", files: ["../x.ts"], sha256: SHA },
      { type: "source-digest", files: ["a.ts", "a.ts"], sha256: SHA }, { type: "tag", value: "latest" }, { type: "UNPINNED", reason: "" }, null]) {
      assert.ok(codes(candidate("PINNED", { identity: identity as never })).includes("IDENTITY_INVALID"), JSON.stringify(identity));
    }
    assert.deepEqual(auditAyasLifecycleEntry(null as never).map((violation) => violation.code), ["ENTRY_SHAPE_INVALID"]);
  });

  await scenario("the registry: unique ids, a real rollback target, one active per role, and a comparison against the incumbent", () => {
    assert.deepEqual(registryCodes([incumbent, candidate("CANARY")]), []);
    assert.deepEqual(registryCodes([incumbent, incumbent]), ["llm.fixture.old:DUPLICATE_ID"]);
    // Two promoted ACTIVE entries for one role is one too many.
    assert.deepEqual(registryCodes([incumbent, candidate("ACTIVE")]).sort(), ["llm.fixture.new:MULTIPLE_ACTIVE_FOR_ROLE", "llm.fixture.old:MULTIPLE_ACTIVE_FOR_ROLE"]);
    const other = (over: Partial<AyasLifecycleEntry>): AyasLifecycleEntry => ({ ...incumbent, state: "PINNED", admission: "NONE", history: historyTo("PINNED"), ...over });
    for (const [label, registry] of Object.entries({
      missing: [candidate("CANARY")],
      self: [incumbent, candidate("CANARY", { rollbackTarget: "llm.fixture.new" })],
      otherRole: [other({ role: "other-role" }), candidate("CANARY")],
      otherKind: [other({ kind: "coding-model" }), candidate("CANARY")],
      retired: [other({ state: "RETIRED", history: [...historyTo("PINNED"), { state: "RETIRED", on: "2026-10-09", basis: "gone" }] }), candidate("CANARY")],
      unpinned: [other({ state: "DISCOVERED", history: historyTo("DISCOVERED"), identity: { type: "UNPINNED", reason: "tag" }, record: emptyRecord }), candidate("CANARY")],
    })) assert.ok(registryCodes(registry).includes("llm.fixture.new:ROLLBACK_TARGET_INVALID"), label);
    // Serving without a rollback target is allowed only for the first entry of a role.
    assert.deepEqual(registryCodes([incumbent, candidate("CANARY", { rollbackTarget: null })]), ["llm.fixture.new:ROLLBACK_TARGET_REQUIRED"]);
    assert.deepEqual(registryCodes([candidate("CANARY", { rollbackTarget: null })]), []);
    // A benchmark version is an evaluator this registry holds: an unknown, non-evaluator or retired one is not a benchmark.
    const evaluator: AyasLifecycleEntry = { ...incumbent, id: "evaluator.fixture", kind: "evaluator", role: "fixture-evaluator", state: "PINNED", admission: "OWNER_SELECTED", history: historyTo("PINNED", "09") };
    const measured = (measuredBy: string) => candidate("CANARY", { record: { ...fullRecord("llm.fixture.old"), capability: { result: "PASS", ref: "docs/fixture.md", summary: "fixture", measuredBy } } });
    assert.deepEqual(registryCodes([incumbent, evaluator, measured("evaluator.fixture")]), []);
    assert.deepEqual(registryCodes([incumbent, measured("evaluator.fixture")]), ["llm.fixture.new:EVALUATOR_UNKNOWN"]);
    assert.deepEqual(registryCodes([incumbent, evaluator, measured("llm.fixture.old")]), ["llm.fixture.new:EVALUATOR_UNKNOWN"]);
    assert.deepEqual(registryCodes([incumbent, { ...evaluator, state: "RETIRED", admission: "NONE", history: [...historyTo("PINNED", "09"), { state: "RETIRED", on: "2026-09-09", basis: "replaced" }] }, measured("evaluator.fixture")]), ["llm.fixture.new:EVALUATOR_UNKNOWN"]);
    assert.ok(codes(measured("Not An Id")).includes("ENTRY_SHAPE_INVALID"));
    // Newer is not better: evidence that does not name the incumbent is not a comparison.
    assert.deepEqual(registryCodes([incumbent, candidate("CANARY", { record: fullRecord() })]), ["llm.fixture.new:INCUMBENT_NOT_COMPARED"]);
    assert.deepEqual(registryCodes([incumbent, candidate("CANARY", { record: fullRecord("llm.fixture.other") })]), ["llm.fixture.new:INCUMBENT_NOT_COMPARED"]);
  });

  await scenario("promotion: one legal step at a time, only with evidence, and it changes nothing by itself", () => {
    const registry = Object.freeze([incumbent, candidate("PINNED")]);
    const before = JSON.stringify(registry);
    assert.deepEqual(evaluateAyasLifecyclePromotion(registry, "llm.fixture.new", "QUALIFIED", "2026-10-03", "benchmarks on record"), { allowed: true, from: "PINNED", to: "QUALIFIED" });
    for (const to of ["SHADOW", "CANARY", "ACTIVE", "DISCOVERED", "PINNED"] as const) {
      const refused = evaluateAyasLifecyclePromotion(registry, "llm.fixture.new", to, "2026-10-03", "skip");
      assert.equal(refused.allowed, false, to);
      if (!refused.allowed) assert.match(refused.reasons.join(), /TRANSITION_ILLEGAL/);
    }
    assert.deepEqual(evaluateAyasLifecyclePromotion(registry, "llm.unknown", "QUALIFIED", "2026-10-03", "x"), { allowed: false, reasons: ["UNKNOWN_ENTRY"] });
    assert.deepEqual(evaluateAyasLifecyclePromotion(registry, "llm.fixture.new", "LIVE" as never, "2026-10-03", "x"), { allowed: false, reasons: ["UNKNOWN_STATE"] });
    // A newer model with one check unmeasured does not qualify, whatever its other results.
    for (const check of AYAS_LIFECYCLE_PROMOTION_CHECKS) {
      const thin = [incumbent, candidate("PINNED", { record: { ...fullRecord("llm.fixture.old"), [check]: none } })];
      const refused = evaluateAyasLifecyclePromotion(thin, "llm.fixture.new", "QUALIFIED", "2026-10-03", "newer");
      assert.equal(refused.allowed, false, check);
      if (!refused.allowed) assert.ok(refused.reasons.some((reason) => reason.includes("EVIDENCE_REQUIRED") && reason.includes(check)), check);
    }
    // Reaching ACTIVE while the incumbent is still ACTIVE is refused: the incumbent is retired or degraded first.
    const atCanary = [incumbent, candidate("CANARY")];
    const blocked = evaluateAyasLifecyclePromotion(atCanary, "llm.fixture.new", "ACTIVE", "2026-10-06", "canary clean");
    assert.equal(blocked.allowed, false); if (!blocked.allowed) assert.match(blocked.reasons.join(), /MULTIPLE_ACTIVE_FOR_ROLE/);
    const incumbentDegraded: AyasLifecycleEntry = { ...incumbent, state: "DEGRADED", admission: "NONE", record: { ...fullRecord(), capability: { result: "PARTIAL", ref: "docs/fixture.md", summary: "superseded" } },
      history: [...historyTo("ACTIVE"), { state: "DEGRADED", on: "2026-10-07", basis: "superseded" }] };
    assert.deepEqual(evaluateAyasLifecyclePromotion([incumbentDegraded, candidate("CANARY")], "llm.fixture.new", "ACTIVE", "2026-10-08", "canary clean"), { allowed: true, from: "CANARY", to: "ACTIVE" });
    // A date before the last step, or no stated basis, is not a promotion record.
    assert.equal(evaluateAyasLifecyclePromotion(registry, "llm.fixture.new", "QUALIFIED", "2026-09-01", "x").allowed, false);
    assert.equal(evaluateAyasLifecyclePromotion(registry, "llm.fixture.new", "QUALIFIED", "2026-10-03", "").allowed, false);
    assert.equal(JSON.stringify(registry), before);
  });

  await scenario("a regression drafts a proposal: back to the last known good, or the role off", () => {
    assert.deepEqual(decideAyasLifecycleRegression([incumbent, candidate("ACTIVE")], "llm.fixture.new"), { action: "PROPOSE_ROLLBACK", degrade: "llm.fixture.new", restore: "llm.fixture.old" });
    assert.deepEqual(decideAyasLifecycleRegression([incumbent], "llm.fixture.old"), { action: "PROPOSE_DEGRADE_NO_TARGET", degrade: "llm.fixture.old" });
    assert.deepEqual(decideAyasLifecycleRegression([candidate("ACTIVE")], "llm.fixture.new"), { action: "PROPOSE_DEGRADE_NO_TARGET", degrade: "llm.fixture.new" });
    const retiredTarget: AyasLifecycleEntry = { ...incumbent, state: "RETIRED", admission: "NONE", history: [...historyTo("ACTIVE"), { state: "RETIRED", on: "2026-10-07", basis: "gone" }] };
    assert.deepEqual(decideAyasLifecycleRegression([retiredTarget, candidate("ACTIVE")], "llm.fixture.new").action, "PROPOSE_DEGRADE_NO_TARGET");
    assert.deepEqual(decideAyasLifecycleRegression([retiredTarget], "llm.fixture.old").action, "NONE");
    assert.deepEqual(decideAyasLifecycleRegression([incumbent, candidate("DISCOVERED", { admission: "NONE" })], "llm.fixture.new").action, "NONE");
    assert.deepEqual(decideAyasLifecycleRegression([], "llm.fixture.new"), { action: "NONE", reason: "UNKNOWN_ENTRY" });
  });

  await scenario("what an entry may serve: canary is internal only, shadow is compared only, owner selection is never an external write", () => {
    const serves = (entry: AyasLifecycleEntry): string[] => AYAS_LIFECYCLE_TASK_CLASSES.filter((task) => ayasLifecycleMayServe(entry, task));
    assert.deepEqual(serves(candidate("ACTIVE")), ["OWNER_INTERACTIVE", "INTERNAL_BOUNDED", "PRODUCTION_EXTERNAL_WRITE", "REVENUE_EXTERNAL_WRITE"]);
    assert.deepEqual(serves(candidate("ACTIVE", { kind: "coding-model" })), ["OWNER_INTERACTIVE", "INTERNAL_BOUNDED", "AUTONOMOUS_CODING", "PRODUCTION_EXTERNAL_WRITE", "REVENUE_EXTERNAL_WRITE"]);
    assert.deepEqual(serves(candidate("CANARY")), ["INTERNAL_BOUNDED"]);
    assert.deepEqual(serves(candidate("CANARY", { kind: "coding-model" })), ["INTERNAL_BOUNDED"]);
    assert.deepEqual(serves(candidate("SHADOW")), ["SHADOW_COMPARE"]);
    for (const state of ["DISCOVERED", "PINNED", "QUALIFIED"] as const) {
      assert.deepEqual(serves(candidate(state)), [], state);
      assert.deepEqual(serves(candidate(state, { admission: "OWNER_SELECTED", kind: "coding-model" })), ["OWNER_INTERACTIVE", "INTERNAL_BOUNDED"], state);
    }
    const degraded = { history: [...historyTo("ACTIVE"), { state: "DEGRADED" as const, on: "2026-10-07", basis: "regression" }], record: { ...fullRecord(), capability: { result: "FAIL" as const, ref: "docs/fixture.md", summary: "regressed" } } };
    assert.deepEqual(serves(candidate("DEGRADED", { ...degraded, admission: "NONE" })), []);
    assert.deepEqual(serves(candidate("DEGRADED", { ...degraded, admission: "OWNER_SELECTED" })), ["OWNER_INTERACTIVE"]);
    assert.deepEqual(serves(candidate("RETIRED", { admission: "NONE", history: [...historyTo("ACTIVE"), { state: "RETIRED", on: "2026-10-07", basis: "gone" }] })), []);
    // An entry whose own record does not hold serves nothing, whatever its state says.
    assert.deepEqual(serves(candidate("ACTIVE", { record: { ...fullRecord("llm.fixture.old"), heldOut: none } })), []);
    assert.deepEqual(serves(candidate("ACTIVE", { history: historyTo("PINNED") })), []);
    for (const task of ["", "PUBLISH", "owner_interactive", "__proto__"]) assert.equal(ayasLifecycleMayServe(candidate("ACTIVE"), task as never), false);
  });

  await scenario("the registry of record holds, covers every kind and claims no more than its evidence", () => {
    assert.deepEqual(auditAyasLifecycleRegistry(AYAS_LIFECYCLE_REGISTRY), []);
    assert.deepEqual([...new Set(AYAS_LIFECYCLE_REGISTRY.map((entry) => entry.kind))].sort(), [...AYAS_LIFECYCLE_KINDS].sort());
    // Nothing has been promoted or qualified: every entry is recorded, pinned or degraded.
    assert.deepEqual([...new Set(AYAS_LIFECYCLE_REGISTRY.map((entry) => entry.state))].sort(), ["DEGRADED", "DISCOVERED", "PINNED"]);
    assert.ok(AYAS_LIFECYCLE_REGISTRY.every((entry) => entry.admission !== "PROMOTED"));
    assert.throws(() => { (AYAS_LIFECYCLE_REGISTRY as AyasLifecycleEntry[]).push(incumbent); }, TypeError);
    assert.throws(() => { (AYAS_LIFECYCLE_REGISTRY[0] as { state: string }).state = "ACTIVE"; }, TypeError);
    assert.throws(() => { (AYAS_LIFECYCLE_REGISTRY[0]!.record.capability as { result: string }).result = "PASS"; }, TypeError);
    // Every claimed result points at a file that git tracks.
    const refs = [...new Set(AYAS_LIFECYCLE_REGISTRY.flatMap((entry) => Object.values(entry.record).map((item) => item.ref)).filter(Boolean))];
    assert.ok(refs.length >= 5);
    for (const ref of refs) assert.ok(fs.statSync(path.join(repo, ref)).isFile(), ref);
    // In a checkout they must also be tracked: an untracked local file is not a record another machine can read.
    if (fs.existsSync(path.join(repo, ".git"))) execFileSync("git", ["ls-files", "--error-unmatch", "--", ...refs], { cwd: repo, stdio: "ignore", windowsHide: true });
    // No owner-selected entry may write externally or code autonomously, and nothing unqualified is hidden.
    for (const entry of AYAS_LIFECYCLE_REGISTRY) for (const task of ["AUTONOMOUS_CODING", "PRODUCTION_EXTERNAL_WRITE", "REVENUE_EXTERNAL_WRITE", "SHADOW_COMPARE"] as const) assert.equal(ayasLifecycleMayServe(entry, task), false, `${entry.id} ${task}`);
    const findings = findAyasLifecycleFindings(AYAS_LIFECYCLE_REGISTRY);
    assert.deepEqual(findings.filter((finding) => finding.code === "OWNER_SELECTED_UNPINNED").map((finding) => finding.id), ["speech-model.narration-tts.hosted-provider", "speech-model.assistant-tts.browser-speech-synthesis"]);
    assert.equal(findings.filter((finding) => finding.code === "OWNER_SELECTED_NOT_QUALIFIED").length, AYAS_LIFECYCLE_REGISTRY.filter((entry) => entry.admission === "OWNER_SELECTED").length - 2);
    // Results that name their benchmark name a recorded evaluator version.
    const measuredBy = [...new Set(AYAS_LIFECYCLE_REGISTRY.flatMap((entry) => Object.values(entry.record).map((item) => item.measuredBy)).filter(Boolean))];
    assert.deepEqual(measuredBy, ["evaluator.cognitive-quality.2026-10-01"]);
    assert.equal(findAyasLifecycleEntry("llm.local-text.qwen2.5-7b")!.rollbackTarget, "llm.local-text.qwen2.5-3b");
    assert.equal(findAyasLifecycleEntryForOllamaTag("qwen2.5:3b")!.id, "llm.local-text.qwen2.5-3b");
    assert.equal(findAyasLifecycleEntryForOllamaTag("qwen2.5:latest"), undefined);
  });

  await scenario("the local coding model is recorded as it really is: pinned, then degraded by its own qualification run", () => {
    const entry = findAyasLifecycleEntry("coding-model.local-coding.qwen2.5-coder-14b-q4km")!;
    const pin = ayasLocalCodingCandidatePins.model;
    assert.deepEqual(entry.identity, { type: "hf-revision", repository: pin.repository, revision: pin.ref, file: pin.file, sha256: pin.sha256 });
    assert.deepEqual([entry.state, entry.admission, entry.rollbackTarget], ["DEGRADED", "NONE", null]);
    assert.deepEqual(entry.history.map((step) => step.state), ["DISCOVERED", "PINNED", "DEGRADED"]);
    assert.deepEqual([entry.record.capability.result, entry.record.heldOut.result, entry.record.consistency.result, entry.record.security.result], ["FAIL", "NOT_MEASURED", "NOT_MEASURED", "PASS"]);
    for (const task of AYAS_LIFECYCLE_TASK_CLASSES) assert.equal(ayasLifecycleMayServe(entry, task), false, task);
    // It cannot be talked back into service: re-qualification needs the checks it failed or never ran.
    const refused = evaluateAyasLifecyclePromotion(AYAS_LIFECYCLE_REGISTRY, entry.id, "QUALIFIED", "2026-10-02", "newer build");
    assert.equal(refused.allowed, false);
    if (!refused.allowed) for (const check of ["capability", "regression", "consistency", "heldOut", "hardwareFit"]) assert.ok(refused.reasons.some((reason) => reason.includes(check)), check);
    for (const to of ["ACTIVE", "CANARY", "SHADOW", "PINNED"] as const) assert.equal(evaluateAyasLifecyclePromotion(AYAS_LIFECYCLE_REGISTRY, entry.id, to, "2026-10-02", "x").allowed, false, to);
    assert.deepEqual(decideAyasLifecycleRegression(AYAS_LIFECYCLE_REGISTRY, entry.id).action, "NONE");
    // The closure record it cites says the same thing.
    const closure = JSON.parse(fs.readFileSync(path.join(repo, entry.record.capability.ref), "utf8")) as { readiness: string; qualified: boolean; engineRegistered: boolean; identities: { modelSha256: string } };
    assert.deepEqual([closure.readiness, closure.qualified, closure.engineRegistered, closure.identities.modelSha256], ["LOCAL_INDEPENDENCE_DEGRADED", false, false, pin.sha256]);
  });

  await scenario("identities: the recorded source digests match this HEAD, and a change is seen", () => {
    const checks = verifyAyasLifecycleIdentities(AYAS_LIFECYCLE_REGISTRY, { repoRoot: repo });
    const sourceEntries = AYAS_LIFECYCLE_REGISTRY.filter((entry) => entry.identity.type === "source-digest");
    assert.ok(sourceEntries.length >= 6);
    for (const entry of sourceEntries) assert.equal(checks.find((check) => check.id === entry.id)!.status, "MATCH", `${entry.id}: the source changed; record a new entry with the new digest and keep this one as its rollback target`);
    // Nothing on this machine contradicts a record; an artifact that is simply not here is not a mismatch.
    assert.deepEqual(checks.filter((check) => check.status === "MISMATCH"), []);
    // Line endings do not change a source digest; content does.
    fs.mkdirSync(path.join(temp, "src"));
    fs.writeFileSync(path.join(temp, "src", "a.ts"), "export const a = 1;\nexport const b = 2;\n");
    const lf = computeAyasLifecycleSourceDigest(temp, ["src/a.ts"]);
    fs.writeFileSync(path.join(temp, "src", "a.ts"), "export const a = 1;\r\nexport const b = 2;\r\n");
    assert.equal(computeAyasLifecycleSourceDigest(temp, ["src/a.ts"]), lf);
    fs.writeFileSync(path.join(temp, "src", "a.ts"), "export const a = 1;\nexport const b = 3;\n");
    assert.notEqual(computeAyasLifecycleSourceDigest(temp, ["src/a.ts"]), lf);
    fs.writeFileSync(path.join(temp, "src", "b.ts"), "export const a = 1;\nexport const b = 3;\n");
    assert.notEqual(computeAyasLifecycleSourceDigest(temp, ["src/b.ts"]), computeAyasLifecycleSourceDigest(temp, ["src/a.ts"]), "the path is part of the identity");
    const source = candidate("PINNED", { id: "prompt.fixture", identity: { type: "source-digest", files: ["src/a.ts"], sha256: lf } });
    assert.equal(verifyAyasLifecycleIdentities([source], { repoRoot: temp })[0]!.status, "MISMATCH");
    assert.equal(verifyAyasLifecycleIdentities([{ ...source, identity: { type: "source-digest", files: ["src/missing.ts"], sha256: lf } }], { repoRoot: temp })[0]!.status, "ABSENT");
  });

  await scenario("identities: files and served model digests are compared, never assumed", () => {
    const bytes = Buffer.from("fixture model bytes"); const file = path.join(temp, "model.bin"); fs.writeFileSync(file, bytes);
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const pinned = (identity: AyasLifecycleEntry["identity"], id = "speech-model.fixture"): AyasLifecycleEntry => candidate("PINNED", { id, identity });
    const status = (entry: AyasLifecycleEntry, options: Partial<Parameters<typeof verifyAyasLifecycleIdentities>[1]> = {}) => verifyAyasLifecycleIdentities([entry], { repoRoot: temp, ...options })[0]!.status;
    const local = pinned({ type: "sha256-file", sha256, sizeBytes: bytes.length, locator: "model.bin" });
    assert.equal(status(local), "MATCH");
    assert.equal(status(pinned({ type: "sha256-file", sha256: SHA, sizeBytes: bytes.length, locator: "model.bin" })), "MISMATCH");
    assert.equal(status(pinned({ type: "sha256-file", sha256, sizeBytes: bytes.length + 1, locator: "model.bin" })), "MISMATCH");
    assert.equal(status(pinned({ type: "sha256-file", sha256, sizeBytes: bytes.length, locator: "gone.bin" })), "ABSENT");
    // A large file is compared by size unless a deep check is asked for; a deep check hashes it.
    assert.equal(status(pinned({ type: "sha256-file", sha256: SHA, sizeBytes: bytes.length, locator: "model.bin" }), { hashLimitBytes: 4 }), "SIZE_MATCH");
    assert.equal(status(pinned({ type: "sha256-file", sha256: SHA, sizeBytes: bytes.length, locator: "model.bin" }), { hashLimitBytes: 4, deep: true }), "MISMATCH");
    // A locator that is not a repository path needs the caller to say where the file is.
    const external = pinned({ type: "sha256-file", sha256, sizeBytes: bytes.length, locator: "env:FFMPEG_PATH" });
    assert.equal(status(external), "NOT_CHECKABLE");
    assert.equal(status(external, { localFiles: { "speech-model.fixture": file } }), "MATCH");
    const hf = pinned({ type: "hf-revision", repository: "a/b", revision: "c".repeat(40), file: "model.gguf", sha256 });
    assert.equal(status(hf), "NOT_CHECKABLE");
    assert.equal(status(hf, { localFiles: { "speech-model.fixture": file } }), "MATCH");
    assert.equal(status(pinned({ type: "UNPINNED", reason: "tag" })), "NOT_CHECKABLE");
    // A tag that now serves other bytes is a mismatch, not the same model.
    const served = pinned({ type: "ollama-digest", tag: "new:1", digest: sha256 });
    assert.equal(status(served), "NOT_OBSERVED");
    assert.equal(status(served, { servedDigests: { "new:1": sha256 } }), "MATCH");
    assert.equal(status(served, { servedDigests: { "new:1": SHA } }), "MISMATCH");
    assert.equal(status(served, { servedDigests: { "other:1": sha256 } }), "ABSENT");
  });

  await scenario("the contract is pure and nothing in the application promotes", () => {
    const contract = fs.readFileSync(path.join(repo, "src/lib/ayas/lifecycle/AyasLifecycle.ts"), "utf8");
    assert.doesNotMatch(contract, /^import /m);
    assert.doesNotMatch(contract, /\bprocess\.|Date\.now|new Date\(|require\(/);
    const registry = fs.readFileSync(path.join(repo, "src/lib/ayas/lifecycle/AyasLifecycleRegistry.ts"), "utf8");
    assert.deepEqual([...registry.matchAll(/^import [^;]+ from "([^"]+)";/gm)].map((match) => match[1]), ["../../brain/autonomy/AyasLocalCodingPins", "./AyasLifecycle"]);
    const walk = (dir: string, out: string[] = []): string[] => { for (const item of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, item.name);
      if (item.isDirectory()) { if (item.name !== "node_modules" && !item.name.startsWith(".")) walk(full, out); } else if (/\.(?:ts|tsx)$/.test(item.name)) out.push(full); } return out; };
    const product = [...walk(path.join(repo, "src")), ...walk(path.join(repo, "app"))];
    const users = (pattern: RegExp): string[] => product.filter((file) => pattern.test(fs.readFileSync(file, "utf8"))).map((file) => path.relative(repo, file).split(path.sep).join("/")).sort();
    // The promotion evaluator is a precondition for a reviewed registry change; no route, daemon or tool calls it.
    assert.deepEqual(users(/evaluateAyasLifecyclePromotion|decideAyasLifecycleRegression/), ["src/lib/ayas/lifecycle/AyasLifecycle.ts"]);
    assert.deepEqual(users(/AYAS_LIFECYCLE_REGISTRY\s*(?:\.push|\.splice|\[[^\]]+\]\s*=)|Object\.assign\(AYAS_LIFECYCLE_REGISTRY/), []);
  });

  console.log(`Stage 15E lifecycle: PASS (${count} scenarios; ${AYAS_LIFECYCLE_REGISTRY.length} registry entries; offline; no model, network or install)`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(temp, { recursive: true, force: true }));
