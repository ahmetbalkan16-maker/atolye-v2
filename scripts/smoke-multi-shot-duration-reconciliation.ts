/**
 * Documentary pipeline V2 (Faz 2a): multi-shot scene-duration reconciliation.
 *
 * Root cause of test #3's failure: gpt-4.1-mini cannot make ~15 per-shot
 * durations sum to both each chapter's duration AND the grand
 * estimatedDuration. Fix (same principle as F-08 reconcileChapterDurations):
 * after structural validation, redistribute each chapter's authoritative
 * duration across its scenes deterministically - the model's numbers are only
 * relative weights. No API call.
 */
import assert from "node:assert/strict";
import type { ScriptData } from "../src/types/script";
import type { SceneData } from "../src/types/scene";
import { AIResponseError } from "../src/lib/ai/AIResponseError";
import {
  parseStrictScenesResponse,
  reconcileSceneDurations,
  validateProviderScenes,
} from "../src/lib/ai/SceneStructuredOutput";

let count = 0;
function scenario(name: string, fn: () => void) {
  fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

/** 5 chapters, F-08-style: chapter durations sum exactly to estimatedDuration. */
function script(chapterDurations = [20, 19, 21, 20, 20]): ScriptData {
  const estimatedDuration = chapterDurations.reduce((s, d) => s + d, 0);
  return {
    topic: "Fatih",
    title: "Fetih",
    subtitle: "s",
    hook: "h",
    introduction: "i",
    chapters: chapterDurations.map((duration, index) => ({
      id: index + 1,
      title: `Bölüm ${index + 1}`,
      narration: "x".repeat(280),
      duration,
      visualGoal: "g",
      emotion: "e",
      transition: "t",
    })),
    conclusion: "c",
    callToAction: "cta",
    estimatedDuration,
    narrationWordCount: 200,
    targetAudience: "a",
    language: "tr",
    voiceStyle: "v",
    musicStyle: "m",
    thumbnailIdea: "ti",
    seoKeywords: ["k"],
    createdAt: "2026-08-29T00:00:00.000Z",
  };
}

/** shots per chapter, each with a caller-controlled (possibly nonsense) duration. */
function scenesRaw(
  shotsPerChapter: number,
  durationFor: (chapterId: number, shot: number) => number,
) {
  const scenes: Array<Record<string, unknown>> = [];
  let id = 1;
  for (let chapterId = 1; chapterId <= 5; chapterId += 1) {
    for (let shot = 0; shot < shotsPerChapter; shot += 1) {
      scenes.push({
        id,
        chapterId,
        title: `Bölüm ${chapterId} çekim ${shot + 1}`,
        description: "d".repeat(20),
        visualPrompt: `Sahne ${id} tek kare`,
        duration: durationFor(chapterId, shot),
      });
      id += 1;
    }
  }
  return { scenes };
}

function reconciled(raw: unknown, s: ScriptData): SceneData["scenes"] {
  return (reconcileSceneDurations(raw, s) as { scenes: SceneData["scenes"] }).scenes;
}

function chapterSum(scenes: SceneData["scenes"], chapterId: number): number {
  return scenes.filter((x) => x.chapterId === chapterId).reduce((sum, x) => sum + (x.duration ?? 0), 0);
}

function run() {
  scenario("wildly wrong model durations -> every chapter sum EXACT, grand total EXACT", () => {
    const s = script();
    // model gives nonsense: 99s for every shot
    const out = reconciled(scenesRaw(3, () => 99), s);
    for (const ch of s.chapters) {
      assert.equal(chapterSum(out, ch.id), ch.duration, `chapter ${ch.id}`);
    }
    assert.equal(
      out.reduce((sum, x) => sum + (x.duration ?? 0), 0),
      s.estimatedDuration,
      "grand total must equal estimatedDuration exactly",
    );
    // and the full authoritative validator now passes
    assert.equal(validateProviderScenes({ scenes: out }, s), undefined);
  });

  scenario("integer partition with residual to the largest scene (20s / 3 -> 7+7+6)", () => {
    const s = script([20, 20, 20, 20, 20]);
    const out = reconciled(scenesRaw(3, () => 6), s); // equal weights
    const c1 = out.filter((x) => x.chapterId === 1).map((x) => x.duration);
    assert.equal(c1.reduce((a, b) => a! + b!, 0), 20);
    assert.ok(c1.every((d) => Number.isInteger(d) && (d as number) >= 1));
  });

  scenario("0 / negative / NaN model weights -> equal split, sum still exact", () => {
    const s = script();
    const out = reconciled(
      scenesRaw(3, (_c, shot) => (shot === 0 ? 0 : shot === 1 ? -5 : Number.NaN)),
      s,
    );
    for (const ch of s.chapters) assert.equal(chapterSum(out, ch.id), ch.duration);
    assert.ok(out.every((x) => (x.duration ?? 0) >= 1));
  });

  scenario("shot count is preserved (reconciliation never adds/removes scenes)", () => {
    const s = script();
    const raw = scenesRaw(4, () => 10);
    const out = reconciled(raw, s);
    assert.equal(out.length, 20);
    assert.deepEqual(out.map((x) => x.id), raw.scenes.map((x) => x.id));
    assert.deepEqual(out.map((x) => x.chapterId), raw.scenes.map((x) => x.chapterId));
  });

  scenario("single scene per chapter -> scene gets exactly the chapter duration (backward compatible)", () => {
    const s = script([18, 22, 20, 19, 21]);
    const out = reconciled(scenesRaw(1, () => 999), s);
    assert.deepEqual(out.map((x) => x.duration), [18, 22, 20, 19, 21]);
    assert.equal(validateProviderScenes({ scenes: out }, s), undefined);
  });

  scenario("never produces a duration < 1 even when a chapter has more scenes than seconds", () => {
    const s = script([4, 20, 20, 20, 20]); // chapter 1 = 4s
    const out = reconciled(scenesRaw(6, () => 1), s); // 6 shots in a 4s chapter
    const c1 = out.filter((x) => x.chapterId === 1);
    assert.ok(c1.every((x) => (x.duration ?? 0) >= 1));
    // within the validator's 5s tolerance for the chapter
    assert.ok(Math.abs(chapterSum(out, 1) - 4) <= 5);
  });

  scenario("parseStrictScenesResponse: a plan that FAILS the old arithmetic now PASSES", () => {
    const s = script();
    // model's per-shot durations do NOT sum to chapters or the total
    const bad = scenesRaw(3, (chapterId, shot) => 5 + chapterId + shot);
    const out = parseStrictScenesResponse(JSON.stringify(bad), s, () => "2026-08-29T00:00:00.000Z");
    for (const ch of s.chapters) assert.equal(chapterSum(out.scenes, ch.id), ch.duration);
    assert.equal(out.scenes.reduce((sum, x) => sum + (x.duration ?? 0), 0), s.estimatedDuration);
    assert.equal(out.createdAt, "2026-08-29T00:00:00.000Z");
  });

  scenario("reconciliation does NOT mask a structural defect (duplicate id) -> still fails closed", () => {
    const s = script();
    const raw = scenesRaw(3, () => 6);
    (raw.scenes[5] as { id: number }).id = 1; // duplicate
    assert.throws(
      () => parseStrictScenesResponse(JSON.stringify(raw), s),
      (e) => e instanceof AIResponseError && e.code === "AI_RESPONSE_SCHEMA_INVALID",
    );
  });

  scenario("reconciliation does NOT mask an oversized visualPrompt -> still fails closed", () => {
    const s = script();
    const raw = scenesRaw(3, () => 6);
    (raw.scenes[0] as { visualPrompt: string }).visualPrompt = "x".repeat(2500);
    assert.throws(
      () => parseStrictScenesResponse(JSON.stringify(raw), s),
      (e) => e instanceof AIResponseError && e.code === "AI_RESPONSE_SCHEMA_INVALID",
    );
  });

  scenario("unreconcilable shape returned unchanged -> parse still fails closed", () => {
    const s = script();
    // scene with a chapterId that does not exist
    const raw = scenesRaw(3, () => 6);
    (raw.scenes[7] as { chapterId: number }).chapterId = 99;
    assert.deepEqual(reconcileSceneDurations(raw, s), raw); // unchanged
    assert.throws(
      () => parseStrictScenesResponse(JSON.stringify(raw), s),
      (e) => e instanceof AIResponseError,
    );
  });

  scenario("model duration values are NOT the authority: different weights, same totals", () => {
    const s = script([20, 20, 20, 20, 20]);
    const a = reconciled(scenesRaw(3, () => 6), s); // equal weights
    const b = reconciled(scenesRaw(3, (_c, shot) => (shot === 0 ? 100 : 1)), s); // skewed weights
    // both partition each chapter to exactly 20 and total to 100
    for (const ch of s.chapters) {
      assert.equal(chapterSum(a, ch.id), 20);
      assert.equal(chapterSum(b, ch.id), 20);
    }
    assert.equal(a.reduce((x, y) => x + (y.duration ?? 0), 0), 100);
    assert.equal(b.reduce((x, y) => x + (y.duration ?? 0), 0), 100);
    // but the skewed weights DO shift the split within a chapter (weights respected)
    const b1 = b.filter((x) => x.chapterId === 1).map((x) => x.duration);
    assert.ok((b1[0] as number) > (b1[1] as number), "the heavily-weighted shot got more time");
  });

  scenario("deterministic: same input -> same output", () => {
    const s = script();
    const raw = scenesRaw(3, (c, shot) => 4 + c + shot);
    assert.deepEqual(reconciled(raw, s), reconciled(raw, s));
  });

  scenario("FAIL-CLOSED: a non-finite / negative / missing authoritative chapter duration is rejected", () => {
    const raw = scenesRaw(3, () => 6);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -20, 0, undefined]) {
      const s = script();
      (s.chapters[2] as { duration: unknown }).duration = bad;
      assert.throws(
        () => parseStrictScenesResponse(JSON.stringify(raw), s),
        (e) =>
          e instanceof AIResponseError && e.code === "AI_RESPONSE_SCHEMA_INVALID",
        `chapter duration ${String(bad)} must fail closed`,
      );
      // reconciliation itself stays fail-SAFE (returns the value unchanged) -
      // the guard in parseStrictScenesResponse is what fails closed.
      assert.deepEqual(reconcileSceneDurations(raw, s), raw);
    }
  });

  scenario("FAIL-CLOSED: a non-finite authoritative estimatedDuration is rejected", () => {
    const raw = scenesRaw(3, () => 6);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) {
      const s = script();
      (s as { estimatedDuration: unknown }).estimatedDuration = bad;
      assert.throws(
        () => parseStrictScenesResponse(JSON.stringify(raw), s),
        (e) =>
          e instanceof AIResponseError && e.code === "AI_RESPONSE_SCHEMA_INVALID",
        `estimatedDuration ${String(bad)} must fail closed`,
      );
    }
  });

  scenario("FAIL-CLOSED: a script with no chapters is rejected before reconciliation", () => {
    const s = script();
    (s as { chapters: unknown }).chapters = [];
    assert.throws(
      () => parseStrictScenesResponse(JSON.stringify(scenesRaw(3, () => 6)), s),
      (e) => e instanceof AIResponseError,
    );
  });

  console.log(`Multi-shot duration reconciliation smoke: PASS (${count} scenarios)`);
  console.log(
    JSON.stringify({ status: "PASS", suite: "multi-shot-duration-reconciliation", scenarios: count }),
  );
}

try {
  run();
} catch (error) {
  console.error("Multi-shot duration reconciliation smoke FAILED:", error);
  process.exitCode = 1;
}
