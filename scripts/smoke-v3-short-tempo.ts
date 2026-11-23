/**
 * V3 smoke: a Short's opening (owner, 23 Nov 2026) — a camera or an effect missing in its first two scenes is a fault
 * with a retouch fix, the same gap later a warning. Pure (no FFmpeg/GPU/network/model).
 * Run: npx tsx scripts/smoke-v3-short-tempo.ts
 */
import assert from "node:assert/strict";
import { applyOpeningFixes, openingFixes, openingFixLine, studioMade } from "../src/lib/v3/council/OpeningRetouch";
import { MAX_RETOUCH_ROUNDS, planRetouch, retouchDebate, withDirector } from "../src/lib/v3/council/RetouchBrain";
import type { Episode, EpisodeScene } from "../src/lib/v3/episode/EpisodeTypes";
import { OPENING_SCENES, openingPlanCheck, scenePlanCheck } from "../src/lib/v3/publish/ChannelGoals";
import type { V3Shot } from "../src/lib/v3/render/RenderPlanTypes";
import type { EpisodeTimeline } from "../src/lib/v3/timeline/Timeline";

let scenarios = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
  scenarios++;
}

/** A scene with everything the plan check asks for; `extra` takes pieces away. */
const full = (id: string, extra: Record<string, unknown> = {}) => ({ id, muzik_ruh_hali: "playful", satirlar: [{ jest: "point", sfx: "pop" }], kamera: [{ tip: "zoom", t: 0 }], gecis: "wipe", ...extra });

/** A five-scene Short script: Hannibal and Flaminius on a stage (s1), then a narrator scene each. */
function shortEpisode(): Episode {
  const line = (karakter: string, metin: string) => ({ karakter, metin, duygu: "notr" as const });
  const scene = (id: string, satirlar: EpisodeScene["satirlar"], extra: Partial<EpisodeScene> = {}): EpisodeScene => ({ id, sure_hedef: 8, mekan: "Lake Trasimene", arka_plan_sorgusu: { tr: "göl", en: "lake" }, duygu: "gerilim", muzik_ruh_hali: "tense", satirlar, ...extra }) as EpisodeScene;
  return {
    id: "kisa", baslik: "Trasimene", konu: "Lake Trasimene", donem: "217 BC", hedef_sure_sn: 150, ton: "mizahi", kaynaklar: [],
    oyuncu_kadrosu: [
      { id: "anlatici", ad: "Narrator", rol: "narrator", kostum_paketi: "", renk: "#111", ses_id: "a", konusma_tarzi: "", gorunur: false },
      { id: "hannibal", ad: "Hannibal", rol: "general", kostum_paketi: "x", renk: "#a00", ses_id: "h", konusma_tarzi: "", gorunur: true },
      { id: "flaminius", ad: "Flaminius", rol: "consul", kostum_paketi: "x", renk: "#00a", ses_id: "f", konusma_tarzi: "", gorunur: true },
    ],
    sahneler: [
      scene("s1-hook", [line("anlatici", "Fog over the lake."), line("hannibal", "Who needs fog machines when you have nature?")]),
      scene("s2-march", [line("anlatici", "Flaminius charges after him.")], { gecis: "kes" }),
      scene("s3", [line("anlatici", "Dawn.")], { gecis: "kes" }),
    ],
  } as unknown as Episode;
}

const timelineOf = (ep: Episode): EpisodeTimeline => {
  const scenes = ep.sahneler.map((_, i) => ({ sceneIndex: i, start: i * 8, end: i * 8 + 8 }));
  const lines = ep.sahneler.flatMap((sc, si) => sc.satirlar.map((l, li) => ({ sceneIndex: si, lineIndex: li, speaker: l.karakter, start: si * 8 + 0.3 + li * 3, end: si * 8 + 2.8 + li * 3, file: "x.wav", duration: 2.5, visemes: [], words: [], lipSync: "rms" as const })));
  return { scenes, lines, duration: ep.sahneler.length * 8 };
};

async function main() {
  await scenario("A a missing camera or effect in the first two scenes is a fault; the same gap in s5 only the warning row's", () => {
    assert.equal(OPENING_SCENES, 2);
    const ok = [full("s1"), full("s2"), full("s3"), full("s4"), full("s5")];
    assert.equal(openingPlanCheck(ok).ok, true);
    assert.match(openingPlanCheck(ok).text, /ilk 2 sahne\) kamera ve efekt: var/);
    // s1 without a camera: the fault row fails and names it.
    const noCam = [full("s1", { kamera: undefined }), ...ok.slice(1)];
    const fault = openingPlanCheck(noCam);
    assert.equal(fault.ok, false);
    assert.deepEqual(fault.eksik, [{ sahne: "s1", kamera: true, efekt: false }]);
    assert.match(fault.text, /EKSİK — kamera: s1 \(izleyici burada karar verir: rötuş turunda eklenir\)/);
    // s2 without an effect is a fault too; a map camera counts as a camera.
    const noFx = [full("s1", { kamera: undefined, harita: { kamera: [{}] } }), full("s2", { satirlar: [{ jest: "point" }] }), ...ok.slice(2)];
    assert.deepEqual(openingPlanCheck(noFx).eksik, [{ sahne: "s2", kamera: false, efekt: true }]);
    // s5 without a camera: no fault, only the plan row (a warning, as before).
    const late = [...ok.slice(0, 4), full("s5", { kamera: undefined })];
    assert.equal(openingPlanCheck(late).ok, true);
    assert.equal(scenePlanCheck(late).ok, false);
    assert.match(scenePlanCheck(late).text, /eksik — kamera: s5$/);
    // What the studio itself puts there fills the opening's gap (a Director cut, the Mixer's whoosh).
    assert.equal(openingPlanCheck(noCam, { kamera: new Set(["s1"]) }).ok, true);
    assert.equal(openingPlanCheck(noFx, { efekt: new Set(["s2"]) }).ok, true);
    assert.equal(openingPlanCheck(noFx, { efekt: new Set(["s5"]) }).ok, false, "a later scene's effect is not the opening's");
    // The plan row without `made` is the writer's plan, word for word as before.
    assert.match(scenePlanCheck(noCam).text, /^Sahne planı \(5 sahne\): eksik — kamera: s1$/);
  });

  await scenario("B studioMade reads the Director's visible camera changes and the Mixer's automatic effects", () => {
    const ep = shortEpisode();
    const tl = timelineOf(ep);
    const shot = (id: string, camera: V3Shot["camera"], extra: Partial<V3Shot> = {}) => ({ id, sceneId: id, start: 0, duration: 240, camera, ...extra }) as V3Shot;
    const plan = {
      width: 1920,
      shots: [
        shot("s1-hook", [{ frame: 0, zoom: 1, cx: 0.5, cy: 0.5 }, { frame: 100, zoom: 1.04, cx: 0.5, cy: 0.5, ease: "smooth" }]),
        shot("s2-march", [{ frame: 0, zoom: 1, cx: 0.5, cy: 0.5 }, { frame: 90, zoom: 1.6, cx: 0.4, cy: 0.58, ease: "cut" }]),
        shot("s3", [{ frame: 0, zoom: 1, cx: 0.5, cy: 0.5 }], { geoMap: { camera: [{ frame: 0, x: 900, y: 500, zoom: 0.55 }, { frame: 9, x: 900, y: 500, zoom: 0.55 }, { frame: 150, x: 1000, y: 560, zoom: 4.5 }] } as unknown as V3Shot["geoMap"] }),
      ],
    };
    const made = studioMade(plan, ep, tl);
    // A 4% drift is not a change; a cut is; a map moving to a new view is (its first key repeating the opening view is not).
    assert.deepEqual([...made.kamera!].sort(), ["s2-march", "s3"]);
    // A slide into s2 brings the Mixer's whoosh; a cut does not.
    assert.equal(made.efekt!.has("s2-march"), false);
    const slid = { ...ep, sahneler: ep.sahneler.map((s) => (s.id === "s2-march" ? { ...s, gecis: "kaydir" as const } : s)) };
    assert.equal(studioMade(plan, slid, tl).efekt!.has("s2-march"), true);
    assert.equal(studioMade(plan, slid, tl).efekt!.has("s1-hook"), false, "the whoosh just before s2 is s2's, not s1's");
  });

  await scenario("C the fault's fix goes into the next retouch round: a punch-in on who speaks, a sound on the first line; bounded rounds", () => {
    const ep = shortEpisode();
    const tl = timelineOf(ep);
    const check = openingPlanCheck(ep.sahneler);
    assert.deepEqual(check.eksik, [{ sahne: "s1-hook", kamera: true, efekt: true }, { sahne: "s2-march", kamera: true, efekt: true }]);
    const fixes = openingFixes(ep, tl, check.eksik);
    // s1: Hannibal speaks at 3.3 s (scene time): the zoom comes half a second into his line; a pop on its first line.
    // s2: no character on stage — no camera fix (nothing to frame), but its sound.
    assert.deepEqual(fixes, [
      { sahne: "s1-hook", kamera: { tip: "zoom", t: 3.8, hedef: "hannibal" }, sfx: { satir: 0, sfx: "pop" } },
      { sahne: "s2-march", sfx: { satir: 0, sfx: "whoosh" } },
    ]);
    assert.match(openingFixLine(fixes[0]!), /s1-hook: kamera hannibal yakın çekime 3\.8\. sn'de; s1-hook#0: pop efekti/);
    const fixed = applyOpeningFixes(ep, fixes);
    assert.deepEqual(fixed.sahneler[0]!.kamera, [{ tip: "zoom", t: 3.8, hedef: "hannibal" }]);
    assert.equal(fixed.sahneler[1]!.satirlar[0]!.sfx, "whoosh");
    assert.deepEqual(applyOpeningFixes(fixed, fixes), fixed, "applied twice it changes nothing");
    assert.deepEqual(openingPlanCheck(fixed.sahneler).eksik, [{ sahne: "s2-march", kamera: true, efekt: false }], "what remains has no fix: no further round for it");
    assert.deepEqual(openingFixes(fixed, tl, openingPlanCheck(fixed.sahneler).eksik), []);
    // A map scene's camera is never written by the fix.
    const mapped = { ...ep, sahneler: ep.sahneler.map((s, i) => (i === 0 ? { ...s, harita: { merkez: [12, 43], genislik_km: 40 } } : s)) } as Episode;
    assert.equal(openingFixes(mapped, tl, [{ sahne: "s1-hook", kamera: true, efekt: false }]).length, 0);

    // The retouch brain opens a round for the opening alone, from the render step; never past the last round.
    const none = { likenesses: [], sets: [] };
    assert.equal(planRetouch({ round: 0, ...none }), undefined);
    const plan = planRetouch({ round: 0, ...none, acilis: fixes })!;
    assert.equal(plan.tur, 1);
    assert.equal(plan.adim, "render");
    assert.deepEqual(plan.acilis, fixes);
    assert.equal(planRetouch({ round: MAX_RETOUCH_ROUNDS, ...none, acilis: fixes }), undefined, "the last round delivers the best one");
    // With a set under the bar the round starts where the set is drawn, and still carries the opening's fixes.
    const withSet = planRetouch({ round: 0, likenesses: [], sets: [{ sahne: "s3", esikAlti: true }], acilis: fixes })!;
    assert.equal(withSet.adim, "gorsel");
    assert.deepEqual(withSet.acilis, fixes);
    // AYAS's line fixes join the same round (earlier step) and keep the opening's.
    const joined = withDirector(plan, 0, { duzeltmeler: [{ tur: "satir", sahne: "s3", satir: 0, talimat: "shorter", neden: "x" }], yeniden: [], ozet: "x" } as never)!;
    assert.equal(joined.adim, "ses");
    assert.deepEqual(joined.acilis, fixes);
    assert.match(retouchDebate(plan).map((d) => d.metin).join("\n"), /Short açılışında kamera\/efekt eksik: s1-hook kamera \(hannibal yakın çekim, 3\.8\. sn\), s1-hook#0 pop efekti · s2-march#0 whoosh efekti[^]*Short açılışına 2 sahnede kamera\/efekt eklenecek; üretim "render" adımından/);
  });

  console.log(`V3 short tempo smoke: PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
