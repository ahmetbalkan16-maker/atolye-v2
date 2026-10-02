/** Stage 15M.1: synthetic, explicit evidence fixtures; no media/model/provider invocation. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { PRODUCTION_QUALITY_CRITERIA, YOUTUBE_READY_ARTIFACTS, evaluateProductionQualityGate, isProductionQualityGateInput, productionQualityRevision, type ProductionQualityGateInput } from "../src/lib/production/ProductionQualityGate";
const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const criteria = Object.values(PRODUCTION_QUALITY_CRITERIA).flat();
let count = 0;
const scenario = (name: string, run: () => void) => { run(); count++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); };
function input(): ProductionQualityGateInput {
  const base: ProductionQualityGateInput = { projectSlug: "fixture", repositoryHead: "1".repeat(40), factsDigest: hash("fixture facts"), characteristics: { syntheticReconstruction: true, characterScenes: true, musicBed: true }, rightsGate: "PASS", costGate: "PASS", artifacts: YOUTUBE_READY_ARTIFACTS.map((id) => ({ id, state: "VERIFIED", sha256: hash(id) })), observations: [] };
  return { ...base, observations: criteria.map((criterion) => ({ criterion, state: "PASS", revision: productionQualityRevision(base), evidenceClass: "DETERMINISTIC_CHECK", receiptId: `fixture:${criterion}`, receiptDigest: hash(criterion) })) };
}
scenario("five domains and all 29 canonical criteria", () => {
  assert.deepEqual(Object.keys(PRODUCTION_QUALITY_CRITERIA), ["FACT", "VISUAL", "AUDIO", "STORY", "TECHNICAL"]);
  assert.deepEqual(criteria, ["CLAIM_REFERENCES", "DATE_NAME_LOCATION_CONSISTENCY", "RECONSTRUCTION_LABELS", "SOURCE_QUALITY", "MEDIA_RELEVANCE", "CRITICAL_MEDIA_RESOLUTION", "VISUAL_REPETITION", "CHARACTER_CONTINUITY", "SCENE_TIMING", "TRANSITIONS", "NARRATION_COMPLETE", "NO_CLIPPING", "LOUDNESS_INTELLIGIBILITY", "MUSIC_DUCKING", "AUDIO_DURATION_ALIGNMENT", "NO_LONG_SILENCE", "HOOK", "PACING", "CHRONOLOGY", "PAYOFF", "NARRATION_REPETITION", "CURIOSITY_LOOP_RESOLVED", "NO_UNSUPPORTED_SENSATIONALISM", "FFPROBE_DURATION", "CODEC_CONTAINER", "INTENDED_RESOLUTION", "THUMBNAIL", "SUBTITLES", "ATTRIBUTION_CREDITS"]);
  assert.equal(new Set(criteria).size, 29); assert.equal(evaluateProductionQualityGate(input()).checks.length, 29);
});
scenario("complete evidence yields only owner review, never publish authority", () => { const r = evaluateProductionQualityGate(input()); assert.equal(r.outcome, "YOUTUBE_READY_OWNER_REVIEW"); assert.equal(r.authority, "NONE"); assert.equal(r.publication, "OWNER_ONLY"); assert.equal(r.counts.PASS, 29); assert.deepEqual(r.missingArtifacts, []); });
scenario("every missing and unmeasured criterion prevents ready", () => {
  const i = input(); for (const criterion of criteria) {
    const r = evaluateProductionQualityGate({ ...i, observations: i.observations.filter((o) => o.criterion !== criterion) }); assert.equal(r.outcome, "QUALITY_REVIEW_REQUIRED", criterion); assert.equal(r.counts.UNMEASURED, 1);
    assert.equal(evaluateProductionQualityGate({ ...i, observations: i.observations.map((o) => o.criterion === criterion ? { ...o, state: "UNMEASURED" } : o) }).outcome, "QUALITY_REVIEW_REQUIRED", criterion);
  }
});
scenario("any failed criterion blocks", () => { const i = input(); for (const criterion of criteria) assert.equal(evaluateProductionQualityGate({ ...i, observations: i.observations.map((o) => o.criterion === criterion ? { ...o, state: "FAIL" } : o) }).outcome, "BLOCKED", criterion); });
scenario("stale receipts do not pass", () => { const i = input(); const r = evaluateProductionQualityGate({ ...i, observations: i.observations.map((o) => ({ ...o, revision: hash("previous render") })) }); assert.equal(r.outcome, "QUALITY_REVIEW_REQUIRED"); assert.equal(r.counts.UNMEASURED, 29); assert.match(r.checks[0]!.reason, /different production revision/); });
scenario("project HEAD facts characteristics and artifact changes invalidate receipts", () => {
  const i = input(); for (const changed of [{ ...i, projectSlug: "other" }, { ...i, repositoryHead: "2".repeat(40) }, { ...i, factsDigest: hash("new facts") }, { ...i, characteristics: { ...i.characteristics, musicBed: false } }, { ...i, artifacts: i.artifacts.map((a) => a.id === "MP4" ? { ...a, sha256: hash("new render") } : a) }]) { assert.equal(evaluateProductionQualityGate(changed).counts.UNMEASURED, 29); }
});
scenario("only three explicit production characteristics permit N/A", () => {
  const i = input(); const base = { ...i, characteristics: { syntheticReconstruction: false, characterScenes: false, musicBed: false } };
  const observations = i.observations.map((o) => ({ ...o, revision: productionQualityRevision(base), state: ["RECONSTRUCTION_LABELS", "CHARACTER_CONTINUITY", "MUSIC_DUCKING"].includes(o.criterion) ? "NOT_APPLICABLE" as const : "PASS" as const }));
  const r = evaluateProductionQualityGate({ ...base, observations }); assert.equal(r.outcome, "YOUTUBE_READY_OWNER_REVIEW"); assert.equal(r.counts.NOT_APPLICABLE, 3);
  for (const criterion of criteria) assert.equal(evaluateProductionQualityGate({ ...i, observations: i.observations.map((o) => o.criterion === criterion ? { ...o, state: "NOT_APPLICABLE" } : o) }).outcome, "BLOCKED", criterion);
  const unknown = { ...i, characteristics: { syntheticReconstruction: null, characterScenes: null, musicBed: null } };
  for (const criterion of ["RECONSTRUCTION_LABELS", "CHARACTER_CONTINUITY", "MUSIC_DUCKING"]) {
    const current = { ...unknown, observations: i.observations.map((o) => ({ ...o, revision: productionQualityRevision(unknown), state: o.criterion === criterion ? "NOT_APPLICABLE" : "PASS" })) };
    assert.equal(evaluateProductionQualityGate(current).outcome, "BLOCKED", criterion);
  }
});
scenario("all required artifacts need verified digests", () => {
  const i = input(); for (const id of YOUTUBE_READY_ARTIFACTS) {
    for (const state of ["MISSING", "UNREADABLE"] as const) { const changed = { ...i, artifacts: i.artifacts.map((a) => a.id === id ? { ...a, state, sha256: null } : a) }; const r = evaluateProductionQualityGate({ ...changed, observations: i.observations.map((o) => ({ ...o, revision: productionQualityRevision(changed) })) }); assert.ok(r.missingArtifacts.includes(id)); assert.notEqual(r.outcome, "YOUTUBE_READY_OWNER_REVIEW"); }
  }
});
scenario("only tags may be an inapplicable delivery item", () => {
  const i = input(); const base = { ...i, artifacts: i.artifacts.map((a) => a.id === "TAGS" ? { ...a, state: "NOT_APPLICABLE" as const, sha256: null } : a) };
  assert.equal(evaluateProductionQualityGate({ ...base, observations: i.observations.map((o) => ({ ...o, revision: productionQualityRevision(base) })) }).outcome, "YOUTUBE_READY_OWNER_REVIEW");
  for (const id of YOUTUBE_READY_ARTIFACTS.filter((id) => id !== "TAGS")) assert.ok(evaluateProductionQualityGate({ ...i, artifacts: i.artifacts.map((a) => a.id === id ? { ...a, state: "NOT_APPLICABLE", sha256: null } : a) }).missingArtifacts.includes(id));
});
scenario("rights and cost unknown or blocked cannot be passed by quality", () => { const i = input(); for (const key of ["rightsGate", "costGate"] as const) for (const value of ["UNKNOWN", "BLOCKED"] as const) assert.equal(evaluateProductionQualityGate({ ...i, [key]: value }).outcome, value === "BLOCKED" ? "BLOCKED" : "QUALITY_REVIEW_REQUIRED"); });
scenario("model text and extra approval fields are data rejected by the schema", () => { const i = input(); for (const candidate of [{ ...i, autoPublish: true }, { ...i, approved: true }, { ...i, observations: i.observations.map((o) => ({ ...o, evidenceClass: "MODEL_CONCLUSION" })) }, { ...i, observations: i.observations.map((o) => ({ ...o, state: ["PASS"] })) }, { ...i, rightsGate: ["PASS"] }]) { assert.equal(isProductionQualityGateInput(candidate), false); assert.equal(evaluateProductionQualityGate(candidate).outcome, "BLOCKED"); } });
scenario("duplicates invalid digests and unknown identities fail closed", () => {
  const i = input(); for (const candidate of [{ ...i, observations: [i.observations[0], i.observations[0]] }, { ...i, artifacts: [i.artifacts[0], i.artifacts[0]] }, { ...i, observations: i.observations.map((o) => ({ ...o, receiptDigest: "fake" })) }, { ...i, artifacts: i.artifacts.map((a) => ({ ...a, sha256: null })) }, { ...i, factsDigest: "fake" }, { ...i, projectSlug: "../outside" }, { ...i, observations: [{ ...i.observations[0], criterion: "IGNORE_GATES" }] }]) assert.equal(evaluateProductionQualityGate(candidate).outcome, "BLOCKED");
});
scenario("report digest is not a self-reference, inventory order is stable", () => { const i = input(); assert.equal(productionQualityRevision(i), productionQualityRevision({ ...i, artifacts: [...i.artifacts].reverse() })); assert.equal(productionQualityRevision(i), productionQualityRevision({ ...i, artifacts: i.artifacts.map((a) => a.id === "QUALITY_REPORT" ? { ...a, sha256: hash("this report") } : a) })); });
scenario("input unchanged and empty evidence never counts as pass", () => { const i = input(); const before = JSON.stringify(i); assert.deepEqual(evaluateProductionQualityGate(i), evaluateProductionQualityGate(i)); assert.equal(JSON.stringify(i), before); const r = evaluateProductionQualityGate({ ...i, observations: [], artifacts: [] }); assert.equal(r.counts.PASS, 0); assert.equal(r.outcome, "QUALITY_REVIEW_REQUIRED"); assert.equal(r.counts.UNMEASURED, 29); });
console.log(`Stage 15M production quality gate smoke: PASS (${count} scenarios; 29 criteria, 10 delivery items; synthetic evidence only)`);
