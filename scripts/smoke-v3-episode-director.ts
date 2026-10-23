/**
 * V3 smoke: Turkish speech text, episode validator, costume SVG filter, timeline and director.
 * Pure (no FFmpeg/GPU/network). Run: npx tsx scripts/smoke-v3-episode-director.ts
 */
import assert from "node:assert/strict";
import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";
import { episodeSummary, loadSeries, recordEpisode, seriesBrief, seriesLabel, seriesText } from "../src/lib/v3/script/Series";
import { productionCommand } from "../src/lib/v3/orders/ProductionOrders";
import { topicPrompt } from "../src/lib/v3/research/SourceResearch";
import { rowCells, STILL_ROW_MAX } from "../src/lib/v3/costumes/PartDesigner";
import { traditionalPortrait } from "../src/lib/v3/faces/PortraitFaces";
import { previewUrls } from "../src/lib/v3/backgrounds/CommonsProvider";
import { cpuThrottled, healthLine, healthVerdict, waitForPcHealth } from "../src/lib/v3/util/PcHealth";
import { crowdCast, toRenderCast } from "../src/lib/v3/costumes/CastMapper";
import { CostumePackError, costumesRoot, loadAccessories, svgBody } from "../src/lib/v3/costumes/CostumePackLoader";
import { autoSlots, BODY_HALF, beats, buildRenderPlan, infoCardsOf, photoSequence, pictureShares, withPictures, rallyingCry, captionPages, cleanFrame, fillTempo, insertWindows, longestEmptyStretch, mapShotCamera, MAX_INSERT_S, normalizeCamera, placeCrowd, stageEmptyScenes } from "../src/lib/v3/director/Director";
import type { Episode, SceneMap } from "../src/lib/v3/episode/EpisodeTypes";
import type { V3Insert } from "../src/lib/v3/render/RenderPlanTypes";
import { momentDesign, momentText } from "../src/lib/v3/backgrounds/BackgroundDesigner";
import { maxDesignedPictures } from "../src/lib/v3/backgrounds/MomentPictures";
import { validateEpisode } from "../src/lib/v3/episode/EpisodeValidator";
import { backgroundStates, buildGeoMap, clipRing, deepFront, formationPoints, lineKm, routScatter, shipLook, strengthValue, declutterMap, labelLines, labelPoint, mapStageX, mapView, mapWorld, placeStateLabels, project, shiftFor, STATE_COLOURS, cutRoute, overlandStretches, throughBreach, windingRoad, withCoast } from "../src/lib/v3/maps/MapBuilder";
import { cameraStops, nameBox } from "../src/lib/v3/maps/CloseLabels";
import { castleRing, castleStyleFor, fitWall, joinPieces, kmBetween, roundness, stripCentreline } from "../src/lib/v3/maps/CastleShapes";
import { placeWall, prepareCloseMaps, siteFromNominatim, siteFromOverpass } from "../src/lib/v3/maps/CloseSite";
import { mapProblems, shareProblems } from "../src/lib/v3/script/MapRules";
import { mapSpeakers, sideStems } from "../src/lib/v3/maps/MapSpeakers";
import { closeTiles, reliefSize } from "../src/lib/v3/maps/Relief";
import { assembleLand, chainWays, simplifyLine } from "../src/lib/v3/maps/CloseCoast";
import { atlasYear, isPolity, nearestSnapshots, snapshotFile, withAtlasYears } from "../src/lib/v3/maps/HistoricalBorders";
import { CLOSE_MIN_ZOOM_KM, MIN_ZOOM_KM, withRouteZoom, zoomOnShortRoutes } from "../src/lib/v3/maps/RouteZoom";
import { ADMIN_QUANT_DEG, assignUnits, coastEdges, dissolve, unitsIn } from "../src/lib/v3/maps/AdminUnits";
import { separateTokens } from "../remotion-v3/src/scene/unitLayout";
import { chartLayout } from "../remotion-v3/src/scene/chartLayout";
import { checkMapPlaces, decidePlace, distanceKm, placeToleranceKm } from "../src/lib/v3/maps/PlaceCheck";
import type { AIProvider } from "../src/lib/ai/providers/AIProvider";
import { CouncilLog } from "../src/lib/v3/council/Council";
import { normalizeDraft } from "../src/lib/v3/script/DraftNormalizer";
import { V3Budget } from "../src/lib/v3/script/V3Budget";
import { colourName, reviewCostumes } from "../src/lib/v3/wardrobe/WardrobeBrain";
import { buildTimeline, DEFAULT_TIMELINE, type LineAudio } from "../src/lib/v3/timeline/Timeline";
import { normalizeForSpeech, numberToTurkish, ordinalTurkish } from "../src/lib/v3/tts/TurkishText";

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

const castBase = {
  kostum_paketi: "ottoman-1453",
  renk: "#b3263a",
  konusma_tarzi: "test",
  gorunur: true,
  kostum: { giysi: "kaftan" as const, renkler: { ana: "#b3263a", ikincil: "#e8b23a", ic: "#f3d27a", sus: "#e8b23a" }, bas: "padisah-kavugu", ayakkabi: "sari-mest" },
};

function sampleEpisode(): Episode {
  return {
    id: "test-bolum",
    baslik: "Test",
    konu: "Test konusu",
    donem: "1452",
    hedef_sure_sn: 60,
    ton: "mizahi",
    kaynaklar: [{ id: "tdv-rumeli", kunye: "TDV İslâm Ansiklopedisi, Rumeli Hisarı", url: "https://islamansiklopedisi.org.tr/rumeli-hisari" }],
    oyuncu_kadrosu: [
      { id: "anlatici", ad: "Anlatıcı", rol: "anlatıcı", kostum_paketi: "", renk: "#1d1b26", ses_id: "anlatici", konusma_tarzi: "samimi", gorunur: false },
      { ...castBase, id: "mehmed", ad: "II. Mehmed", rol: "padişah", ses_id: "mehmed" },
      { ...castBase, id: "halil", ad: "Halil Paşa", rol: "sadrazam", ses_id: "halil", kostum: { ...castBase.kostum, giysi: "cubbe", bas: "vezir-sarigi", sakal: "sakal-beyaz" } },
    ],
    sahneler: [
      {
        id: "acilis",
        sure_hedef: 10,
        mekan: "Edirne Sarayı",
        arka_plan_sorgusu: { tr: "saray", en: "palace" },
        duygu: "merak",
        muzik_ruh_hali: "merak",
        satirlar: [
          { karakter: "anlatici", metin: "Yıl 1452. Genç bir padişah büyük bir karar veriyor.", duygu: "notr", kaynak: ["tdv-rumeli"] },
          { karakter: "mehmed", metin: "Konstantiniyye'yi alacağım!", duygu: "kararli", jest: "isaret_et", hedef: "halil" },
          { karakter: "halil", metin: "Sultanım, o surlar bin yıldır aşılamadı!", duygu: "saskin", efekt: "unlem" },
          { karakter: "mehmed", metin: "Ben de kimse değilim, Halil Paşa.", duygu: "sinsi", kurgu: true },
        ],
      },
    ],
  };
}

function fakeAudio(duration: number): LineAudio {
  return { file: "x.wav", duration, visemes: [{ t: 0, v: "B" }, { t: 0.2, v: "D" }, { t: duration - 0.1, v: "X" }], words: [], lipSync: "rms" };
}

async function main() {
  await scenario("A numbers", () => {
    assert.equal(numberToTurkish(1453), "bin dört yüz elli üç");
    assert.equal(numberToTurkish(1000), "bin");
    assert.equal(numberToTurkish(2023), "iki bin yirmi üç");
    assert.equal(numberToTurkish(0), "sıfır");
    assert.equal(numberToTurkish(100), "yüz");
    assert.equal(numberToTurkish(1100), "bin yüz");
    assert.equal(numberToTurkish(700), "yedi yüz");
    assert.equal(ordinalTurkish(11), "on birinci");
    assert.equal(ordinalTurkish(2), "ikinci");
  });

  await scenario("B speech text", () => {
    assert.equal(normalizeForSpeech("II. Mehmed 1453'te kuşattı."), "İkinci Mehmed bin dört yüz elli üç'te kuşattı.");
    assert.equal(normalizeForSpeech("XI. Konstantinos geldi."), "On birinci Konstantinos geldi.");
    assert.equal(normalizeForSpeech("15. yüzyıl"), "on beşinci yüzyıl");
    assert.equal(normalizeForSpeech("Giustiniani geldi.", { kelimeler: { Giustiniani: "Custiniyani" } }), "Custiniyani geldi.");
    // Whole words only: a lexicon key inside a longer word is left alone.
    assert.equal(normalizeForSpeech("Urbanlar", { kelimeler: { Urban: "Orban" } }), "Urbanlar");
  });

  await scenario("C validator accepts the sample", () => {
    const v = validateEpisode(sampleEpisode());
    assert.equal(v.ok, true, JSON.stringify(v.errors));
    assert.equal(v.metrics.lineCount, 4);
    assert.equal(v.metrics.dialogueSceneRatio, 1);
    assert.equal(v.metrics.narratorClaimsWithoutSource, 0);
  });

  await scenario("D validator refusals and warnings", () => {
    const bad = structuredClone(sampleEpisode()) as unknown as { sahneler: { satirlar: Record<string, unknown>[] }[] };
    bad.sahneler[0]!.satirlar.push({ karakter: "yok", metin: "Merhaba", duygu: "notr" });
    bad.sahneler[0]!.satirlar.push({ karakter: "halil", metin: "Ulan bu ne!", duygu: "kizgin" });
    bad.sahneler[0]!.satirlar.push({ karakter: "anlatici", metin: "Kuşatma tam 53 gün sürdü.", duygu: "notr" });
    bad.sahneler[0]!.satirlar.push({ karakter: "anlatici", metin: "Paşa rüşvet aldı.", duygu: "notr", rivayet: true, kaynak: ["tdv-rumeli"] });
    const v = validateEpisode(bad);
    assert.equal(v.ok, false);
    const codes = v.errors.map((e) => e.code);
    assert.ok(codes.includes("SATIR_KARAKTER"));
    assert.ok(codes.includes("USLUP_ARGO"));
    const warnings = v.warnings.map((w) => w.code);
    assert.ok(warnings.includes("KAYNAK_YOK"));
    assert.ok(warnings.includes("RIVAYET_IFADESI"));
    assert.equal(validateEpisode(null).ok, false);
  });

  await scenario("E costume SVG filter", () => {
    assert.equal(svgBody('<svg viewBox="0 0 1 1"><path d="M0 0" style="fill:#fff"/></svg>', "t"), '<path d="M0 0" style="fill:#fff"/>');
    for (const evil of ['<svg><script>alert(1)</script></svg>', '<svg><image href="x.png"/></svg>', '<svg><path style="fill:url(#a)"/></svg>', '<svg><path onload="x()"/></svg>', "<g/>"]) {
      assert.throws(() => svgBody(evil, "t"), CostumePackError);
    }
  });

  await scenario("F costume packs load for the Fatih cast", async () => {
    const ep = sampleEpisode();
    const cast = toRenderCast(ep.oyuncu_kadrosu, "kukla");
    assert.deepEqual(cast.map((c) => c.id), ["mehmed", "halil"]);
    const acc = await loadAccessories(costumesRoot(path.resolve(__dirname, "..")), cast);
    assert.deepEqual(acc.map((a) => a.id).sort(), ["ottoman-1453/padisah-kavugu", "ottoman-1453/sakal-beyaz", "ottoman-1453/vezir-sarigi"]);
    await assert.rejects(loadAccessories(costumesRoot(path.resolve(__dirname, "..")), [{ ...cast[0]!, costume: { ...cast[0]!.costume, head: "fes" } }]), CostumePackError);
    // A sword is gripped (the fist never opens around it); a map is not.
    const held = await loadAccessories(costumesRoot(path.resolve(__dirname, "..")), [{ ...cast[0]!, costume: { ...cast[0]!.costume, handBack: "kilic", handFront: "harita" } }]);
    assert.equal(held.find((a) => a.id === "ottoman-1453/kilic")?.grip, true);
    assert.equal(held.find((a) => a.id === "ottoman-1453/harita")?.grip, undefined);
  });

  await scenario("G timeline gaps", () => {
    const ep = sampleEpisode();
    const tl = buildTimeline(ep, [[fakeAudio(2), fakeAudio(1.5), fakeAudio(2), fakeAudio(1.8)]]);
    assert.equal(tl.lines.length, 4);
    assert.ok(Math.abs(tl.lines[0]!.start - 0.3) < 1e-9);
    assert.ok(Math.abs(tl.lines[1]!.start - (0.3 + 2 + 0.28)) < 1e-9, "reply gap");
    assert.ok(Math.abs(tl.duration - (tl.lines[3]!.end + 0.45)) < 1e-9);
  });

  await scenario("H director plan", () => {
    const ep = sampleEpisode();
    const tl = buildTimeline(ep, [[fakeAudio(2.4), fakeAudio(1.5), fakeAudio(2), fakeAudio(1.8)]]);
    const cast = toRenderCast(ep.oyuncu_kadrosu, "kukla");
    const plan = buildRenderPlan({ episode: ep, timeline: tl, cast, accessories: [], backgrounds: [{ src: "bg/a.png", kind: "set" }], fps: 30, width: 1920, height: 1080, showCaptions: true });
    assert.equal(plan.durationInFrames, Math.round(tl.duration * 30));
    assert.equal(plan.shots.length, 1);
    const shot = plan.shots[0]!;
    assert.equal(shot.dramatized, true);
    assert.equal(shot.performers.length, 2);
    for (let i = 1; i < shot.camera.length; i++) assert.ok(shot.camera[i]!.frame > shot.camera[i - 1]!.frame, "camera keys strictly increasing");
    const mehmed = shot.performers.find((p) => p.castId === "mehmed")!;
    assert.ok(mehmed.gestures.some((g) => g.gesture === "isaret_et" && g.toward !== undefined));
    assert.equal(mehmed.speaking.length, 2);
    const halil = shot.performers.find((p) => p.castId === "halil")!;
    assert.ok(halil.effects.some((e) => e.effect === "unlem"));
    assert.ok(shot.shakes.length >= 1, "punchline shake");
    assert.ok(plan.captions.length >= 4);
    for (const page of plan.captions) assert.ok(page.words.length <= 9);
  });

  await scenario("I helpers", () => {
    assert.deepEqual(autoSlots(1), [0.5]);
    assert.deepEqual(autoSlots(2).map((x) => Math.round(x * 100)), [27, 73]);
    const keys = normalizeCamera([{ frame: 10, zoom: 1, cx: 0.5, cy: 0.5 }, { frame: 5, zoom: 1, cx: 0.5, cy: 0.5 }, { frame: 10, zoom: 2, cx: 0.5, cy: 0.5 }]);
    assert.deepEqual(keys.map((k) => [k.frame, k.zoom]), [[5, 1], [10, 2]]);
    const pages = captionPages({ file: "", duration: 4, visemes: [], words: [], lipSync: "rms", sceneIndex: 0, lineIndex: 0, speaker: "x", start: 1, end: 5 }, 30, ["surlar"], "Bir iki üç dört beş altı yedi sekiz dokuz on surlar");
    assert.equal(pages.length, 2);
    assert.ok(pages[1]!.words.some((w) => w.emphasis));
  });

  await scenario("J tempo: a long uneventful stretch gets gentle camera pushes so no gap passes 5 s; busy shots stay untouched", () => {
    const cam = fillTempo([{ frame: 0, zoom: 1, cx: 0.5, cy: 0.5 }], [0], 600, 30);
    const frames = beats([...cam.map((k) => k.frame), 600], 30);
    for (let i = 1; i < frames.length; i++) assert.ok(frames[i]! - frames[i - 1]! <= 150, `boşluk ${(frames[i]! - frames[i - 1]!) / 30} sn`);
    assert.ok(cam.slice(1).every((k) => k.ease === "smooth" && Math.abs(k.zoom - 1.05) < 1e-9));
    const busy = [{ frame: 0, zoom: 1, cx: 0.5, cy: 0.5 }];
    assert.deepEqual(fillTempo(busy, [0, 90, 180, 270], 300, 30), busy);
    // A gesture and the expression starting with it are one beat.
    assert.deepEqual(beats([0, 5, 10, 30], 30), [0, 30]);
  });

  await scenario("K speech text and name tags: only on visible speakers' lines with a balon, one at a time; each character introduced once", () => {
    const base = sampleEpisode();
    const scene = base.sahneler[0]!;
    const ep: Episode = { ...base, sahneler: [{ ...scene, satirlar: scene.satirlar.map((l, i) => (i === 1 ? { ...l, balon: "Konstantiniyye benim!" } : i === 2 ? { ...l, balon: "Bin yıl!" } : l)) }, { ...scene, id: "ikinci" }] };
    const tl = buildTimeline(ep, [[fakeAudio(2.4), fakeAudio(1.5), fakeAudio(2), fakeAudio(1.8)], [fakeAudio(2), fakeAudio(1), fakeAudio(1), fakeAudio(1)]]);
    const plan = buildRenderPlan({ episode: ep, timeline: tl, cast: toRenderCast(ep.oyuncu_kadrosu, "kukla"), accessories: [], backgrounds: [{ src: "bg/a.png", kind: "set" }, { src: "bg/a.png", kind: "set" }], fps: 30, width: 1920, height: 1080, showCaptions: false, language: "en" });
    assert.equal(plan.language, "en");
    assert.equal(plan.showCaptions, false);
    const [first, second] = plan.shots;
    assert.deepEqual(first!.bubbles!.map((b) => [b.castId, b.text]), [["mehmed", "Konstantiniyye benim!"], ["halil", "Bin yıl!"]]);
    assert.ok(first!.bubbles![0]!.end < first!.bubbles![1]!.start, "aynı anda tek balon");
    assert.deepEqual(first!.nameTags!.map((t) => [t.castId, t.name, t.role]), [["mehmed", "II. Mehmed", "padişah"], ["halil", "Halil Paşa", "sadrazam"]]);
    assert.equal(second!.nameTags!.length, 0, "ikinci sahnede yeniden tanıtılmaz");
    assert.equal(second!.bubbles!.length, 0, "balonsuz satır yazı göstermez");
  });

  await scenario("L period cutaways: narrator stretches become inserts; a silent-acting scene cuts away only for its first narrator line", () => {
    const fps = 30;
    const lines = [{ start: 0, end: 60, onScreen: false }, { start: 70, end: 100, onScreen: false }, { start: 110, end: 150, onScreen: true }, { start: 160, end: 230, onScreen: false }];
    assert.deepEqual(insertWindows(lines, 300, fps), [{ start: 0, end: 108 }, { start: 155, end: 238 }]);
    assert.deepEqual(insertWindows(lines.filter((l) => !l.onScreen), 300, fps, false), [{ start: 0, end: 300 }], "sahnede kimse yok: tüm sahne");
    assert.deepEqual(insertWindows(lines.filter((l) => !l.onScreen), 300, fps, true), [{ start: 0, end: 68 }], "sessiz oyun: yalnız ilk satır");
    assert.deepEqual(insertWindows([{ start: 0, end: 20, onScreen: false }], 300, fps), [], "1,5 sn'den kısa ara plan yok");
    const long = [{ start: 0, end: 400, onScreen: false }, { start: 420, end: 480, onScreen: true }];
    assert.deepEqual(insertWindows(long, 500, fps), [{ start: 0, end: Math.round(MAX_INSERT_S * fps) }], "karakterler varken tablo en fazla MAX_INSERT_S");
    assert.deepEqual(insertWindows(long.slice(0, 1), 500, fps, false), [{ start: 0, end: 500 }], "sahnede kimse yoksa tablo tüm sahne");
    const ep = sampleEpisode();
    const tl = buildTimeline(ep, [[fakeAudio(2.4), fakeAudio(1.5), fakeAudio(2), fakeAudio(1.8)]]);
    const plan = buildRenderPlan({ episode: ep, timeline: tl, cast: toRenderCast(ep.oyuncu_kadrosu, "kukla"), accessories: [], backgrounds: [{ src: "bg/a.png", kind: "set" }], inserts: [{ src: "bg/donem.jpg", caption: "Buondelmonti, 1430" }], fps, width: 1920, height: 1080, showCaptions: false });
    const ins = plan.shots[0]!.inserts!;
    assert.equal(ins.length, 1);
    assert.equal(ins[0]!.start, 0);
    assert.equal(ins[0]!.caption, "Buondelmonti, 1430");
    assert.ok(ins[0]!.end <= Math.round(tl.lines[1]!.start * fps), "karakter konuşmadan önce sete dönülür");
    // A living set (owner, 22 Oct 2026): its first line shows where we are, and a narrator line told while the crowd
    // marches stays on the march — the benchmark hid the legion's wading behind an engraving.
    const living: Episode = {
      ...ep,
      sahneler: [
        {
          ...ep.sahneler[0]!,
          ortam: { zaman: "gece", manzara: "nehir_gecidi", uslup: "roma" },
          kalabalik: [{ ad: "Legio", kostum_paketi: "ottoman-1453", kostum: castBase.kostum, sayi: 6, duzen: "ordu", taraf: "sol", hareket: { tur: "yuru", satir: 3 } }],
          satirlar: [...ep.sahneler[0]!.satirlar.slice(0, 3), { karakter: "anlatici", metin: "And the legion waded across.", duygu: "notr" }, { karakter: "anlatici", metin: "Rome would never be the same.", duygu: "notr" }],
        },
      ],
    };
    const tl3 = buildTimeline(living, [[fakeAudio(2.4), fakeAudio(1.5), fakeAudio(2), fakeAudio(2.2), fakeAudio(2.6)]]);
    const drawnPlan = buildRenderPlan({ episode: living, timeline: tl3, cast: [...toRenderCast(living.oyuncu_kadrosu, "kukla"), ...crowdCast(living, "kukla")], accessories: [], backgrounds: [{ src: "", kind: "drawn", drawn: { zaman: "gece", manzara: "nehir_gecidi", uslup: "roma", tohum: 1 } }], inserts: [{ src: "bg/donem.jpg" }], fps, width: 1920, height: 1080, showCaptions: false });
    const cut = drawnPlan.shots[0]!.inserts ?? [];
    const lineFrames = (i: number) => [Math.round(tl3.lines[i]!.start * fps), Math.round(tl3.lines[i]!.end * fps)] as const;
    assert.ok(!cut.some((w) => w.start < lineFrames(0)[1]), "the first line shows the living set, not the engraving");
    assert.ok(!cut.some((w) => w.start < lineFrames(3)[1] && w.end > lineFrames(3)[0]), "the march's line stays on the march");
    assert.equal(cut.length, 0, "the column is still wading through the last line: it stays on screen too");
    // Without the march, the later narrator lines cut away as before.
    const still: Episode = { ...living, sahneler: [{ ...living.sahneler[0]!, kalabalik: [{ ...living.sahneler[0]!.kalabalik![0]!, hareket: undefined }] }] };
    // Horses (owner, 22 Oct 2026): a rider is marked for the renderer, framed higher, and cannot also sit on a throne.
    const mounted: Episode = { ...living, sahneler: [{ ...living.sahneler[0]!, sahne_duzeni: [{ karakter: "mehmed", x: 0.42, yon: "sag", binek: "at" }] }] };
    assert.equal(validateEpisode(mounted).ok, true, JSON.stringify(validateEpisode(mounted).errors.slice(0, 2)));
    assert.equal(validateEpisode({ ...mounted, sahneler: [{ ...mounted.sahneler[0]!, sahne_duzeni: [{ karakter: "mehmed", x: 0.42, binek: "at", oturuyor: true }] }] }).ok, false, "a rider does not sit on a throne too");
    assert.equal(validateEpisode({ ...mounted, sahneler: [{ ...mounted.sahneler[0]!, sahne_duzeni: [{ karakter: "mehmed", x: 0.42, binek: "deve" }] }] } as never).ok, false, "only horses for now");
    const ridePlan = buildRenderPlan({ episode: mounted, timeline: tl3, cast: [...toRenderCast(mounted.oyuncu_kadrosu, "kukla"), ...crowdCast(mounted, "kukla")], accessories: [], backgrounds: [{ src: "", kind: "drawn", drawn: { zaman: "gece", manzara: "nehir_gecidi", uslup: "roma", tohum: 1 } }], fps, width: 1920, height: 1080, showCaptions: false });
    const rider = ridePlan.shots[0]!.performers.find((p) => p.castId === "mehmed")!;
    assert.equal(rider.mount, "at");
    assert.equal(rider.turns?.length ?? 0, 0, "a rider does not turn his horse round to face whoever speaks (benchmark 3)");
    const walkerPlan = buildRenderPlan({ episode: living, timeline: tl3, cast: [...toRenderCast(living.oyuncu_kadrosu, "kukla"), ...crowdCast(living, "kukla")], accessories: [], backgrounds: [{ src: "", kind: "drawn", drawn: { zaman: "gece", manzara: "nehir_gecidi", uslup: "roma", tohum: 1 } }], fps, width: 1920, height: 1080, showCaptions: false });
    const closeY = (plan: typeof ridePlan) => Math.min(...plan.shots[0]!.camera.filter((c) => c.zoom > 1.3).map((c) => c.cy));
    assert.ok(closeY(ridePlan) < closeY(walkerPlan), "a rider's close shot is framed higher than a walker's");
    // A crowd that lives (owner, 22 Oct 2026): soldiers grip, and the legion cheers at the leader's rallying cry.
    assert.ok(rallyingCry({ metin: "The die is cast!", duygu: "kararli" }) && !rallyingCry({ metin: "Right behind you, sir!", duygu: "korkmus" }) && !rallyingCry({ metin: "We cross.", duygu: "kararli" }));
    const legionExtras = drawnPlan.shots[0]!.extras!;
    assert.ok(legionExtras.every((e) => e.grip), "an army block grips");
    const shouts = living.sahneler[0]!.satirlar.map((l, i) => ({ l, i })).filter((x) => x.l.karakter !== "anlatici" && rallyingCry(x.l));
    if (shouts.length) assert.ok(legionExtras.every((e) => (e.cheers?.length ?? 0) === shouts.length), "every soldier cheers at each rallying cry");
    const stillPlan = buildRenderPlan({ episode: still, timeline: tl3, cast: [...toRenderCast(still.oyuncu_kadrosu, "kukla"), ...crowdCast(still, "kukla")], accessories: [], backgrounds: [{ src: "", kind: "drawn", drawn: { zaman: "gece", manzara: "nehir_gecidi", uslup: "roma", tohum: 1 } }], inserts: [{ src: "bg/donem.jpg" }], fps, width: 1920, height: 1080, showCaptions: false });
    assert.equal(stillPlan.shots[0]!.inserts!.length, 1, "a narrator stretch told while nothing moves still cuts away");
  });

  await scenario("M clean framing: no character is left half in shot at a frame edge", () => {
    const cut = (zoom: number, cx: number, xs: readonly number[]) => {
      const half = 0.5 / zoom;
      return xs.some((x) => (x - BODY_HALF < cx - half && x + BODY_HALF > cx - half) || (x - BODY_HALF < cx + half && x + BODY_HALF > cx + half));
    };
    // The pilot's close-up: speaker at 0.35, neighbour at 0.65 straddling the right edge.
    assert.ok(cut(1.48, 0.35, [0.65]));
    const c = cleanFrame(1.48, 0.35, [0.35], [0.65]);
    assert.ok(!cut(c.zoom, c.cx, [0.65]) && !cut(c.zoom, c.cx, [0.35]), JSON.stringify(c));
    assert.ok(Math.abs(c.cx - 0.35) < 0.12 && c.zoom > 1.3, "küçük bir kaydırma yeter");
    // Three in a row: whatever the frame, nobody is cut and the speaker stays in.
    for (const sx of [0.18, 0.5, 0.82]) {
      const others = [0.18, 0.5, 0.82].filter((x) => x !== sx);
      const f = cleanFrame(1.56, sx, [sx], others);
      assert.ok(!cut(f.zoom, f.cx, [sx, ...others]), `${sx}: ${JSON.stringify(f)}`);
    }
    assert.deepEqual(cleanFrame(1, 0.5, [], [0.12, 0.88]), { zoom: 1, cx: 0.5 });
  });

  await scenario("N crowds: extras stand behind the actors, deterministic, on their side, an army facing across", () => {
    const g = { ad: "yeniçeriler", kostum_paketi: "ottoman-1453", kostum: castBase.kostum, sayi: 20, duzen: "ordu" as const, taraf: "sol" as const, ruh_hali: "coskulu" as const };
    const a = placeCrowd([g], "s1");
    assert.deepEqual(a, placeCrowd([g], "s1"), "aynı dizilim");
    assert.equal(a.length, 20);
    assert.ok(a.every((e) => e.depth >= 0.72 && e.depth <= 1 && e.x >= 0.03 && e.x <= 0.42 && e.facing === "right" && e.mood === "coskulu" && e.castId === "kalabalik-s1-0"));
    assert.ok(new Set(a.map((e) => e.depth)).size >= 3, "ordu birkaç sıra");
    const row = placeCrowd([{ ...g, sayi: 6, duzen: "sira", taraf: "tum", ruh_hali: undefined }], "s2");
    assert.equal(new Set(row.map((e) => e.depth)).size, 1);
    assert.ok(row.every((e) => e.mood === "notr" && e.facing === (e.x < 0.5 ? "right" : "left")));
    const ep = sampleEpisode();
    const withCrowd: Episode = { ...ep, sahneler: [{ ...ep.sahneler[0]!, kalabalik: [g] }] };
    assert.equal(validateEpisode(withCrowd).ok, true, JSON.stringify(validateEpisode(withCrowd).errors));
    assert.equal(crowdCast(withCrowd, "kukla")[0]!.id, "kalabalik-acilis-0");
    const bad = validateEpisode({ ...ep, sahneler: [{ ...ep.sahneler[0]!, kalabalik: [{ ...g, sayi: 90 }], satirlar: [{ ...ep.sahneler[0]!.satirlar[0]!, balon: "anlatıcıya balon" }] }] });
    assert.ok(bad.errors.some((e) => e.path.endsWith("kalabalik[0].sayi")));
    assert.ok(bad.errors.some((e) => e.code === "BALON_ANLATICI"));
  });

  await scenario("O drawn maps: projection, coast clipping, territories by outline or ISO code, timed by the line that names them", () => {
    const v = mapView([12.5, 43], 1300, 1920, 1080);
    const [cx, cy] = project(v, 12.5, 43);
    assert.ok(Math.abs(cx - 960) < 1e-6 && Math.abs(cy - 540) < 1e-6, "merkez kare ortasında");
    assert.ok(project(v, 13, 43)[0] > 960 && project(v, 12.5, 44)[1] < 540, "doğu sağda, kuzey yukarıda");
    assert.equal(clipRing([[-10, -10], [10, -10], [10, 10], [-10, 10]], 0, 0, 5, 5).length, 4, "kare dikdörtgene kırpılır");
    assert.equal(clipRing([[100, 100], [110, 100], [110, 110]], 0, 0, 5, 5).length, 0, "dışarıdaki halka düşer");
    const square = [[[10, 40], [15, 40], [15, 46], [10, 46], [10, 40]] as const] as const;
    const data = { land: [square], lakes: [], rivers: [[[11, 41], [12, 42], [13, 43]] as const], countries: new Map([["ITA", [square]]]) };
    const map: SceneMap = { merkez: [12.5, 43], genislik_km: 1300, bolgeler: [{ ad: "Rome", renk: "#b8283a", noktalar: [[11, 41], [14, 41], [14, 44]], satir: 1 }, { ad: "Italy", renk: "#2f6fb0", ulkeler: ["ita"] }], sehirler: [{ ad: "Roma", konum: [12.5, 41.9] }], oklar: [{ noktalar: [[12, 44], [12.5, 42]], satir: 0 }] };
    const geo = buildGeoMap(map, data as never, 1920, 1080, (i, order) => (i !== undefined ? i * 100 : 1000 + order));
    assert.ok(geo.land.startsWith("M") && geo.rivers.startsWith("M"));
    assert.deepEqual(geo.territories.map((t) => [t.label, t.start, t.d.length > 0]), [["Rome", 100, true], ["Italy", 1001, true]], "ISO kodu büyük/küçük harf duyarsız");
    assert.equal(geo.arrows[0]!.start, 0);
    assert.equal(geo.cities[0]!.label, "Roma");
    // A close battle map may be 3 km across; 2 is too close for anything to read.
    const ep = sampleEpisode();
    const bad = validateEpisode({ ...ep, sahneler: [{ ...ep.sahneler[0]!, harita: { merkez: [200, 43], genislik_km: 2, bolgeler: [{ ad: "x", renk: "#ffffff" }] } }] });
    assert.ok(bad.errors.some((e) => e.code === "HARITA_KONUM") && bad.errors.some((e) => e.path.endsWith("genislik_km")) && bad.errors.some((e) => e.code === "HARITA_BOLGE"));
    // Real historical borders: the atlas polygon by name and snapshot year, case-insensitive; no outline needed.
    const withAtlas = { ...data, historical: new Map([[-100, new Map([["roman republic", [square]]])]]) };
    const atlas = buildGeoMap({ merkez: [12.5, 43], genislik_km: 1300, bolgeler: [{ ad: "Roman Republic", renk: "#b8283a", tarihi: { ad: "Roman Republic", yil: -100 } }, { ad: "Unknown", renk: "#2f6fb0", tarihi: { ad: "Atlantis", yil: -100 } }] }, withAtlas as never, 1920, 1080, () => 0);
    assert.deepEqual(atlas.territories.map((t) => [t.label, t.d.length > 0]), [["Roman Republic", true], ["Unknown", false]], "a name the atlas lacks draws nothing, never a wrong place");
    const okAtlas = validateEpisode({ ...ep, sahneler: [{ ...ep.sahneler[0]!, harita: { merkez: [12.5, 43], genislik_km: 1300, bolgeler: [{ ad: "Rome", renk: "#b8283a", tarihi: { ad: "Roman Republic", yil: -100 } }] } }] });
    assert.ok(!okAtlas.errors.some((e) => e.code === "HARITA_BOLGE"), "tarihi alone is a valid territory");
    assert.deepEqual(nearestSnapshots(-49), [-100, -1]);
    assert.deepEqual(nearestSnapshots(1453), [1400, 1492]);
    assert.deepEqual(nearestSnapshots(1914), [1914]);
    assert.equal(snapshotFile(-100), "world_bc100.geojson");
    assert.equal(snapshotFile(1453), "world_1453.geojson");
  });

  await scenario("O2 map narration: a world over every camera view, camera keys by line, badges and battles, a border change", () => {
    const square = [[[10, 40], [15, 40], [15, 46], [10, 46], [10, 40]] as const] as const;
    const data = { land: [square], lakes: [], rivers: [], countries: new Map() };
    const map: SceneMap = {
      merkez: [12.5, 43], genislik_km: 600,
      kamera: [{ satir: 1, merkez: [20, 41], genislik_km: 2400 }, { satir: 2, merkez: [28.9, 41], genislik_km: 600 }],
      bolgeler: [{ ad: "Old", renk: "#b8283a", noktalar: [[11, 41], [14, 41], [14, 44]], satir: 0, bitis_satir: 2 }, { ad: "New", renk: "#2f6fb0", noktalar: [[11, 41], [16, 41], [16, 45]], satir: 2 }],
      rozetler: [{ karakter: "osman", konum: [29.06, 40.18], satir: 1, yol: [[29.5, 40.5], [29.9, 40.8]] }],
      savaslar: [{ ad: "Bapheus", konum: [29.4, 40.7], satir: 2 }],
    };
    const world = mapWorld(map, 1920, 1080);
    assert.equal(world.keys.length, 3);
    assert.ok(world.bounds.west < 12.5 - 2 && world.bounds.east > 28.9 + 2, "the world spans every view with a margin");
    const geo = buildGeoMap(map, data as never, 1920, 1080, (i) => (i ?? 0) * 100, { relief: "bg/zemin.jpg", castName: (id) => (id === "osman" ? "Osman Gazi" : undefined) });
    assert.ok(geo.world && geo.world.width > 1920 && geo.world.width <= 16_000, "a moving map draws a world larger than the frame");
    assert.deepEqual(geo.camera!.map((c) => c.frame), [0, 100, 200]);
    // Both 600 km views: the one at 41° spans fewer degrees of longitude than the one at 43°, so it is the closest.
    assert.equal(Math.max(...geo.camera!.map((c) => c.zoom)), 1, "the closest view fills the frame");
    assert.ok(geo.camera![0]!.zoom > 0.95 && geo.camera![0]!.zoom < 1);
    assert.ok(geo.camera![1]!.zoom < 0.3 && geo.camera![1]!.zoom > 0.2, "four times wider is a quarter zoom");
    assert.ok(geo.camera![2]!.x > geo.camera![0]!.x, "the camera moves east");
    assert.equal(geo.relief, "bg/zemin.jpg");
    assert.deepEqual(geo.territories.map((t) => [t.label, t.start, t.end]), [["Old", 0, 200], ["New", 200, undefined]], "the old border goes as the new one comes");
    assert.deepEqual([geo.badges![0]!.label, geo.badges![0]!.start, geo.badges![0]!.path.length], ["Osman Gazi", 100, 3]);
    assert.deepEqual([geo.battles![0]!.label, geo.battles![0]!.start], ["Bapheus", 200]);
    const still = buildGeoMap({ merkez: [12.5, 43], genislik_km: 1300 }, data as never, 1920, 1080, () => 0);
    assert.ok(!still.world && !still.camera && !still.relief && !still.badges, "a map without keys is drawn as before");
    // The relief image keeps the world's aspect at the source's own resolution (60 px a degree, x by cos latitude).
    const size = reliefSize(world);
    assert.ok(Math.abs(size.width / size.height - world.view.width / world.view.height) < 0.01 && size.width <= 4096);
    const ep = sampleEpisode();
    const cast = ep.oyuncu_kadrosu[0]!.id;
    const ok = validateEpisode({ ...ep, sahneler: [{ ...ep.sahneler[0]!, harita: { merkez: [12.5, 43], genislik_km: 600, kamera: [{ satir: 0, merkez: [20, 41], genislik_km: 2400 }], rozetler: [{ karakter: cast, konum: [29, 40] }], savaslar: [{ ad: "x", konum: [29, 40] }] } }] });
    assert.ok(!ok.errors.some((e) => e.code.startsWith("HARITA")), JSON.stringify(ok.errors));
    const bad = validateEpisode({ ...ep, sahneler: [{ ...ep.sahneler[0]!, harita: { merkez: [12.5, 43], genislik_km: 600, kamera: [{ satir: 99, merkez: [20, 41], genislik_km: 2 }], rozetler: [{ karakter: "yok", konum: [29, 40] }] } }] });
    assert.ok(bad.errors.some((e) => e.code === "HARITA_SATIR") && bad.errors.some((e) => e.path.endsWith("kamera[0].genislik_km")) && bad.errors.some((e) => e.code === "HARITA_ROZET"));
  });

  await scenario("O3 map like the reference (owner, 21 Oct 2026): the period's other states coloured, names placed and sized, campaigns set off with their line, a map shot's gentle camera", () => {
    // Other states of the atlas year: named ones and non-states left out, touching ones never the same colour.
    const box = (w: number, s: number, e: number, n: number) => [[[w, s], [e, s], [e, n], [w, n], [w, s]] as const] as const;
    const snapshot = new Map([["ottoman empire", [box(26, 38, 32, 42)]], ["serbia", [box(19, 42, 23, 45)]], ["bosnia", [box(16, 43, 19.5, 45)]], ["minor states", [box(20, 40, 21, 41)]], ["far away", [box(100, 10, 101, 11)]]]);
    const others = backgroundStates(snapshot as never, { west: 15, east: 35, south: 35, north: 47 }, [{ name: "Ottoman Empire", color: "#3fae3a", polys: snapshot.get("ottoman empire")! as never }], isPolity);
    assert.deepEqual(others.map((o) => o.name).sort(), ["bosnia", "serbia"]);
    assert.notEqual(others[0]!.color, others[1]!.color, "touching neighbours get different colours");
    assert.ok(others.every((o) => STATE_COLOURS.includes(o.color)));
    // A crescent's name sits inside it, sized to the shape; long names go on two lines.
    const v = mapView([20, 40], 2000, 1920, 1080);
    const crescent = [[[16, 36], [24, 36], [24, 44], [16, 44], [16, 42], [22, 42], [22, 38], [16, 38], [16, 36]] as const] as const;
    const at = labelPoint(v, [crescent as never], "Kingdom of Hungary")!;
    const [cx0] = project(v, 22, 40);
    assert.ok(at.x > cx0, `the name is inside the bar of the C, not in its hollow: ${JSON.stringify(at)}`);
    assert.ok(at.size >= 20 && at.size <= 50, `${at.size}`);
    // A name never runs into the next state: in a long narrow state it gets smaller until its whole box is inside.
    const strip: [number, number][] = [[200, 500], [500, 500], [500, 580], [200, 580]];
    const fitted = placeStateLabels({ land: "", lakes: "", rivers: "", territories: [{ d: "", color: "#9a6a34", label: "Kingdom of Hungary", labelX: 350, labelY: 540, labelSize: 50, start: 0 }], cities: [], armies: [], arrows: [] }, 1920, 1080, 1, [strip]).territories[0]!;
    const fs = fitted.labelSize!;
    assert.ok(fs < 50, `smaller than full size: ${fs}`);
    const half = { w: (10 * 0.58 * fs) / 2, h: fs };
    assert.ok(fitted.labelX! - half.w >= 200 && fitted.labelX! + half.w <= 500 && fitted.labelY! - half.h >= 500 && fitted.labelY! + half.h <= 580, `inside the strip: ${JSON.stringify(fitted)}`);
    assert.deepEqual(labelLines("Kingdom of Hungary"), ["Kingdom of", "Hungary"]);
    assert.deepEqual(labelLines("Byzantium"), ["Byzantium"]);
    // Names stay in the picture and off cities; a state written twice under one name keeps one place; an arrow's
    // name moves off a city.
    const placed = placeStateLabels({ land: "", lakes: "", rivers: "", territories: [{ d: "", color: "#3fae3a", label: "Ottoman Empire", labelX: 900, labelY: 10, labelSize: 60, start: 0 }, { d: "", color: "#7a64b8", label: "Vidin", labelX: 400, labelY: 500, labelSize: 30, start: 0 }, { d: "", color: "#3fae3a", label: "Vidin", labelX: 420, labelY: 520, labelSize: 30, start: 90 }], cities: [{ x: 380, y: 500, label: "Vidin" }, { x: 600, y: 300, label: "Belgrade" }], armies: [], arrows: [{ points: [{ x: 500, y: 340 }, { x: 700, y: 340 }], color: "#d7263d", label: "Crusaders", start: 0 }] }, 1920, 1080, 1);
    const [ott, vid1, vid2] = placed.territories;
    assert.ok(ott!.labelY! - 60 >= 0, "the top name is pulled into the picture");
    assert.ok(Math.abs(vid1!.labelY! - 500) > 16 || Math.abs(vid1!.labelX! - 400) > 60, "Vidin's name moved off the city of Vidin");
    assert.deepEqual([vid2!.labelX, vid2!.labelY], [vid1!.labelX, vid1!.labelY], "the state changing hands keeps its name's place");
    assert.deepEqual([placed.arrows[0]!.labelX, placed.arrows[0]!.labelY], [600, 380], "Belgrade is above the short arrow: its name goes below the line");
    // A campaign sets off with its line; a map shot keeps a quarter of the scene camera's push.
    const ep = sampleEpisode();
    const cast = ep.oyuncu_kadrosu[1]!.id;
    const map: SceneMap = { merkez: [26, 42], genislik_km: 1500, rozetler: [{ karakter: cast, konum: [26.56, 41.68], satir: 0, yol: [[25.6, 43.1], [24.9, 43.6]], yol_satir: 2 }] };
    const square = [[[15, 35], [35, 35], [35, 48], [15, 48], [15, 35]] as const] as const;
    const geo = buildGeoMap(map, { land: [square], lakes: [], rivers: [], countries: new Map() } as never, 1920, 1080, (i) => (i ?? 0) * 100);
    assert.deepEqual([geo.badges![0]!.start, geo.badges![0]!.moveStart, geo.badges![0]!.path.length], [0, 200, 3]);
    assert.ok(validateEpisode({ ...ep, sahneler: [{ ...ep.sahneler[0]!, harita: map }] }).errors.every((e) => !e.code.startsWith("HARITA")));
    assert.ok(validateEpisode({ ...ep, sahneler: [{ ...ep.sahneler[0]!, harita: { ...map, rozetler: [{ ...map.rozetler![0]!, yol_satir: 99 }] } }] }).errors.some((e) => e.code === "HARITA_SATIR" && e.path.endsWith("yol_satir")));
    const gentle = mapShotCamera([{ frame: 0, zoom: 1, cx: 0.5, cy: 0.5 }, { frame: 100, zoom: 1.2, cx: 0.42, cy: 0.5 }]);
    assert.deepEqual([gentle[1]!.zoom, gentle[1]!.cx], [1.05, 0.48]);
    // A one-scene preview has no subscribe card.
    const tl = buildTimeline(ep, [[fakeAudio(2), fakeAudio(1.5), fakeAudio(2), fakeAudio(1.8)]]);
    const preview = buildRenderPlan({ episode: ep, timeline: tl, cast: toRenderCast(ep.oyuncu_kadrosu, "kukla"), accessories: [], backgrounds: [{ src: "bg/a.png", kind: "set" }], fps: 30, width: 1920, height: 1080, showCaptions: false, endCard: false });
    assert.ok(preview.shots.every((s) => s.titleCards.every((c) => c.style !== "abone")));
  });

  await scenario("O4 realistic borders from provinces, sea names, scale and the main state (owner, 21 Oct 2026: 'not straight, more realistic')", () => {
    // Three provinces on the grid (units of ADMIN_QUANT_DEG): two side by side in state A, one in state B.
    const sq = (x: number, y: number, w: number) => [x, y, x + w, y, x + w, y + w, x, y + w];
    const unit = (name: string, x: number, y: number) => ({ name, rings: [sq(x, y, 50)], box: { west: x * ADMIN_QUANT_DEG, east: (x + 50) * ADMIN_QUANT_DEG, south: y * ADMIN_QUANT_DEG, north: (y + 50) * ADMIN_QUANT_DEG }, centre: [(x + 25) * ADMIN_QUANT_DEG, (y + 25) * ADMIN_QUANT_DEG] as const });
    const units = [unit("a1", 1000, 2000), unit("a2", 1050, 2000), unit("b1", 1100, 2000)];
    const outlineA = [[[[19.9, 39.9], [22.05, 39.9], [22.05, 41.1], [19.9, 41.1], [19.9, 39.9]]]] as never;
    const outlineB = [[[[22.05, 39.9], [23.2, 39.9], [23.2, 41.1], [22.05, 41.1], [22.05, 39.9]]]] as never;
    const got = assignUnits(units, [[], [{ key: 0, polys: outlineA }], [{ key: 1, polys: outlineB }]], { west: 15, east: 30, south: 35, north: 45 });
    assert.deepEqual([got.get(0)!.map((u) => u.name), got.get(1)!.map((u) => u.name)], [["a1", "a2"], ["b1"]]);
    const a = dissolve(got.get(0)!);
    assert.equal(a.rings.length, 1, "two provinces make one outline");
    const xs = a.rings[0]!.map((p) => p[0]);
    assert.deepEqual([Math.min(...xs), Math.max(...xs)], [20, 22], "the shared edge at 21° is gone, the outline spans both");
    assert.ok(!a.rings[0]!.some((p) => p[0] === 21 && p[1] > 40 && p[1] < 41), "no point inside on the inner edge");
    // The built map: provinces fill the state, its border is the dissolved outline; sea names in the narration's
    // language (Turkish capitals keep their dotted İ), a scale, the first named state is the main one.
    const land = [[[[15, 35], [30, 35], [30, 45], [15, 45], [15, 35]]]];
    const seaPoly = [[[[24, 36], [29, 36], [29, 39], [24, 39], [24, 36]]]];
    const geo = buildGeoMap({ merkez: [22, 40], genislik_km: 1200, bolgeler: [{ ad: "A", renk: "#3fae3a", tarihi: { ad: "a", yil: 1400 } }] }, { land, lakes: [], rivers: [], countries: new Map(), historical: new Map([[1400, new Map([["a", outlineA]])]]), admin: units, seas: [{ name: "Aegean Sea", nameTr: "Ege Denizi", polys: seaPoly }] } as never, 1920, 1080, () => 0, { relief: "bg/zemin.jpg", language: "tr" });
    const t = geo.territories[geo.mainTerritory!]!;
    assert.equal(t.label, "A");
    assert.ok(t.border && t.border.length > 10, "the state carries its own outline");
    assert.ok((t.d.match(/M/g) ?? []).length === 2, "filled with its two provinces");
    assert.deepEqual(geo.seas?.map((s) => s.label), ["EGE DENİZİ"]);
    assert.ok(geo.kmPerPx! > 0.5 && geo.kmPerPx! < 0.7, `1200 km across 1920 px: ${geo.kmPerPx}`);
    // The grid's coast (edges of one province only) is no border: A's border is where it meets B, its coast is padded
    // out to the coastline (map trial, 22 Oct 2026: stepped borders and bare land along every coast up close).
    const coast = coastEdges(units);
    assert.equal(coast.size, 8, "the strip's outer edges: 3 + 3 along, 1 + 1 at the ends");
    assert.equal(dissolve(got.get(0)!, (e) => !coast.has(e)).lines.length, 1, "A's land border: its one edge with B");
    assert.deepEqual(dissolve(got.get(0)!, (e) => !coast.has(e)).lines[0]!.map((p) => p[0]), [22, 22]);
    assert.ok(t.coast && (t.coast.match(/M/g) ?? []).length >= 1, "A's coast is carried separately");
    assert.ok(t.border!.length < t.coast!.length, "the border is only the short edge with B");
    assert.ok(geo.coastPad! > 4 && geo.coastPad! < 6, `3.2 km at ~0.63 km a pixel: ${geo.coastPad}`);
    assert.deepEqual(unitsIn(units, { west: 21.5, east: 30, south: 35, north: 45 }).map((u) => u.name), ["a2", "b1"]);
  });

  await scenario("O8 units on the map (owner, 22 Oct 2026, the reference channel's WW2 map narration): fronts, clusters and sieges of tokens, losses, spacing, the era", () => {
    // Formations: a front evenly along its line, a siege ring that keeps to the land, a cluster on land first.
    assert.deepEqual(formationPoints({ cephe: [[20, 40], [22, 40]] }, 3), [[20, 40], [21, 40], [22, 40]]);
    const westIsLand = (p: [number, number]) => p[0] < 22;
    const ring = formationPoints({ kusatma: [22, 40], km: 40 }, 6, westIsLand);
    assert.equal(ring.length, 6);
    assert.ok(ring.every((p) => p[0] < 22), `a coastal city's siege ring keeps to the land: ${JSON.stringify(ring)}`);
    const lats = ring.map((p) => p[1]);
    assert.ok(Math.max(...lats) > 40.25 && Math.min(...lats) < 39.75, "laid out end to end over the land arc");
    assert.ok(formationPoints({ kusatma: [22, 40], km: 40 }, 6).some((p) => p[0] > 22), "with no land test, the full ring");
    assert.ok(formationPoints({ kusatma: [22, 40], km: 40 }, 4, () => false).some((p) => p[0] > 22), "an island fort (no land round it): the full ring");
    const cluster = formationPoints({ kume: [22, 40], km: 30 }, 5, westIsLand);
    assert.ok(cluster.filter((p) => p[0] < 22).length === 5, "a cluster on the coast stands on its land places");
    // Spacing on screen: tokens given one place part to a full gap; tokens already apart stay where they are.
    const parted = separateTokens(Array.from({ length: 6 }, () => ({ x: 100, y: 100 })), 50);
    for (let a = 0; a < parted.length; a++) for (let b = a + 1; b < parted.length; b++) assert.ok(Math.hypot(parted[a]!.x - parted[b]!.x, parted[a]!.y - parted[b]!.y) >= 49.9, "no two tokens on each other");
    assert.deepEqual(parted, separateTokens(Array.from({ length: 6 }, () => ({ x: 100, y: 100 })), 50), "the same every frame");
    assert.deepEqual(separateTokens([{ x: 0, y: 0 }, { x: 80, y: 0 }], 50), [{ x: 0, y: 0 }, { x: 80, y: 0 }]);
    // The built map: steps in line order, starting with their line; losses carried forward; letters cut to three.
    const land = [[[[15, 35], [30, 35], [30, 45], [15, 45], [15, 35]]]];
    const map: SceneMap = {
      merkez: [22, 40],
      genislik_km: 1200,
      birlikler: [
        { taraf: "Ottomans", renk: "#c0392b", amblem: "hilal", sayi: 4, yerler: [{ satir: 2, kusatma: [22, 40], km: 30, kayip: 1 }, { satir: 0, kume: [20, 40] }] },
        { taraf: "Allies", renk: "#3f6fb5", amblem: "harf", harf: "ABCD", sayi: 3, yerler: [{ satir: 1, cephe: [[23, 39], [23, 41]] }, { satir: 2, cephe: [[23, 39], [23, 41]], kayip: 2 }, { satir: 3, cephe: [[23, 39], [23, 41]], kayip: 5 }] },
      ],
    };
    const geo = buildGeoMap(map, { land, lakes: [], rivers: [], countries: new Map() } as never, 1920, 1080, (i) => (i ?? 0) * 100, { relief: "bg/zemin.jpg", era: "erken-modern" });
    assert.equal(geo.era, "erken-modern");
    const [ott, allies] = geo.units!;
    assert.deepEqual(ott!.steps.map((s) => [s.start, s.points.length, s.alive]), [[0, 4, 4], [200, 4, 3]], "the gathering first, then the siege with one lost");
    assert.deepEqual(allies!.steps.map((s) => s.alive), [3, 1, 0], "losses add up and never go below none");
    assert.equal(allies!.letters, "ABC");
    assert.equal(ott!.emblem, "hilal");
    assert.ok(allies!.steps[0]!.points[0]!.y > allies!.steps[0]!.points[2]!.y, "a front laid from its first point (south) to its last (north)");
    // Validation.
    const ep = sampleEpisode();
    const withMap = (h: unknown) => validateEpisode({ ...ep, sahneler: [{ ...ep.sahneler[0]!, harita: h }] } as never);
    const ok = { merkez: [22, 40], genislik_km: 1200, birlikler: [{ taraf: "A", renk: "#c0392b", amblem: "kartal", sayi: 4, yerler: [{ satir: 0, kume: [20, 40] }] }] };
    assert.equal(withMap(ok).ok, true, JSON.stringify(withMap(ok).errors.slice(0, 2)));
    const bad = (u: Record<string, unknown>) => withMap({ ...ok, birlikler: [{ ...ok.birlikler[0], ...u }] }).ok;
    assert.equal(bad({ amblem: "ejderha" }), false, "an emblem from the list");
    assert.equal(bad({ amblem: "harf" }), false, "a letter emblem needs its letters");
    assert.equal(bad({ sayi: 30 }), false, "at most 24 tokens");
    assert.equal(bad({ yerler: [] }), false, "at least one formation");
    assert.equal(bad({ yerler: [{ satir: 0, kume: [20, 40], cephe: [[20, 40], [21, 40]] }] }), false, "one formation a step");
    assert.equal(bad({ yerler: [{ kume: [20, 40] }] }), false, "a step needs its line");
    assert.equal(bad({ yerler: [{ satir: 0, kusatma: [20, 40], km: 0.2 }] }), false, "a siege ring of at least 300 m (a close map's)");
  });

  await scenario("O10 the close battle map (owner, 22 Oct 2026, after DFT Tarih): OSM coast closed into land, elevation tiles, walls, settlements, fights one by one, the chain", () => {
    // Coastline ways with the land on their left: a shore across the box (land to the north), an island, a lagoon.
    const box = { west: 0, east: 10, south: 0, north: 10 };
    const shore: [number, number][] = [[-1, 5], [4, 5], [11, 5]];
    const island: [number, number][] = [[2, 1], [4, 1], [4, 3], [2, 3], [2, 1]];
    const lagoon: [number, number][] = [[6, 7], [6, 8], [8, 8], [8, 7], [6, 7]];
    assert.deepEqual(chainWays([shore.slice(0, 2), shore.slice(1)]), [shore], "ways joined end to start");
    assert.equal(simplifyLine(shore, 0.01).length, 2, "a straight shore keeps its ends");
    const coast = assembleLand([shore, island, lagoon], box, false);
    const area = (ring: readonly (readonly [number, number])[]) => Math.abs(ring.reduce((a, p, i) => a + p[0] * ring[(i + 1) % ring.length]![1] - ring[(i + 1) % ring.length]![0] * p[1], 0) / 2);
    assert.deepEqual(coast.land.map((p) => Math.round(area(p[0]!))).sort((a, b) => a - b), [4, 50], "the north half closed along the box's edge, and the island");
    assert.equal(coast.water.length, 1, "the lagoon is water");
    assert.equal(assembleLand([island], box, true).land.length, 2, "no shore across the box: the box is land (its centre says so), with the island");
    // Elevation tiles for a 24 km box round Constantinople: close tiles, never too many.
    const t = closeTiles({ west: 28.81, east: 29.1, south: 40.96, north: 41.08 }, 1920);
    assert.ok(t.z >= 12 && t.z <= 13 && (t.x1 - t.x0 + 1) * (t.y1 - t.y0 + 1) <= 160, JSON.stringify(t));
    // The close map's ground from the script.
    const land = [[[[28, 40], [30, 40], [30, 42], [28, 42], [28, 40]]]];
    const map: SceneMap = {
      merkez: [28.95, 41.02],
      genislik_km: 20,
      surlar: [{ ad: "Walls", noktalar: [[28.92, 41.04], [28.92, 41.0]], kapilar: [[28.92, 41.02]], gedik: { konum: [28.92, 41.03], satir: 1 } }],
      yerlesimler: [{ tur: "sehir", ad: "City", konum: [28.96, 41.02], km: 2 }, { tur: "ordugah", konum: [28.89, 41.02], km: 1.5, satir: 0 }],
      yapilar: [{ tur: "otag", ad: "Sultan", konum: [28.89, 41.03] }],
      yollar: [{ noktalar: [[28.85, 41.02], [28.92, 41.02]] }],
      arazi: [{ tur: "tepe", konum: [29.0, 41.06] }],
      cizgiler: [{ ad: "The chain", noktalar: [[28.97, 41.01], [28.97, 41.02]], stil: "zincir" }],
      birlikler: [
        { taraf: "A", renk: "#c0392b", amblem: "hilal", sayi: 4, yerler: [{ satir: 0, cephe: [[28.91, 41.04], [28.91, 41.0]] }] },
        { taraf: "B", renk: "#7a3fa0", amblem: "kartal", sayi: 3, yerler: [{ satir: 0, cephe: [[28.93, 41.04], [28.93, 41.0]] }, { satir: 1, cephe: [[28.93, 41.04], [28.93, 41.0]], kayip: 2 }] },
      ],
    };
    const geo = buildGeoMap(map, { land, lakes: [], rivers: [], countries: new Map() } as never, 1920, 1080, (i) => (i ?? 0) * 100, { relief: "bg/yakin.jpg" });
    const close = geo.close!;
    assert.ok(close.unit >= 9, "a house never smaller than 9 px");
    assert.ok(close.walls[0]!.towers.length > 4 && close.walls[0]!.gates.length === 1);
    assert.equal(close.walls[0]!.breach!.start, 100, "the breach opens with its line");
    const [city, camp] = close.settlements;
    assert.ok(city!.items.length > 50 && camp!.items.length > 10 && camp!.items.every((it) => it.angle === 0), `${city!.items.length} houses, ${camp!.items.length} tents in rows`);
    assert.ok(close.ground.some((g) => g.kind === "tepe") && close.ground.every((g) => Math.hypot(g.x - city!.x, g.y - city!.y) > 20), "the named hill, and no wood or field in the city");
    assert.equal(geo.lines![0]!.chain, true);
    assert.deepEqual(geo.units![1]!.steps[1]!.losses, [2.4, 3.4], "two tokens fall one after the other");
    assert.deepEqual(geo.fights, [{ start: 100, durationS: 4.6 }]);
    assert.equal(buildGeoMap({ ...map, genislik_km: 500 }, { land, lakes: [], rivers: [], countries: new Map() } as never, 1920, 1080, () => 0).close, undefined, "a wide map has no close ground");
    // Validation: the close map's ground only on a close map; the chain style is known.
    const ep = { ...sampleEpisode(), donem: "1453" };
    const withMap = (h: unknown) => validateEpisode({ ...ep, sahneler: [{ ...ep.sahneler[0]!, harita: h }] } as never);
    assert.equal(withMap(map).ok, true, JSON.stringify(withMap(map).errors.slice(0, 2)));
    assert.deepEqual([...new Set(withMap({ ...map, genislik_km: 500 }).errors.map((e) => e.code))], ["HARITA_YAKIN"]);
    assert.equal(withMap({ ...map, yapilar: [{ tur: "piramit", konum: [28.9, 41] }] }).ok, false);
    assert.equal(withMap({ ...map, cizgiler: [{ ad: "x", noktalar: [[28.9, 41], [28.91, 41]], stil: "duvar" }] }).ok, false);
  });

  await scenario("O11 the close map's names clear of each other and of the tokens (owner, 23 Oct 2026: wall name on the battle's, the chain's at Galata's foot), winding named roads, fire from the breach", () => {
    const land = [[[[28, 40], [30, 40], [30, 42], [28, 42], [28, 40]]]];
    const data = { land, lakes: [], rivers: [], countries: new Map() } as never;
    const map: SceneMap = {
      merkez: [28.95, 41.02],
      genislik_km: 20,
      kamera: [{ satir: 1, merkez: [28.93, 41.02], genislik_km: 10 }],
      surlar: [{ ad: "Theodosian Walls", noktalar: [[28.92, 41.04], [28.92, 41.0]], kapilar: [[28.92, 41.02]], gedik: { konum: [28.92, 41.02], satir: 1 } }],
      yerlesimler: [{ tur: "sehir", noktalar: [[28.925, 41.035], [28.96, 41.035], [28.96, 41.005], [28.925, 41.005]], yanma_satir: 1 }, { tur: "sehir", ad: "Galata", konum: [28.97, 41.03], km: 0.8 }],
      yollar: [{ ad: "Road to Edirne", noktalar: [[28.85, 41.03], [28.92, 41.02]] }],
      cizgiler: [{ ad: "The chain", noktalar: [[28.97, 41.024], [28.97, 41.034]], stil: "zincir" }],
      // The battle at the breach, right where the wall's name would go; the Ottoman front just outside the wall.
      savaslar: [{ ad: "Gate of St. Romanus", konum: [28.92, 41.02], satir: 1 }],
      birlikler: [{ taraf: "Ottomans", renk: "#c0392b", amblem: "hilal", sayi: 6, yerler: [{ satir: 0, cephe: [[28.912, 41.04], [28.912, 41.0]] }] }],
    };
    const geo = buildGeoMap(map, data, 1920, 1080, (i) => (i ?? 0) * 100, { relief: "bg/yakin.jpg" });
    const close = geo.close!;
    // Every named thing has its place, and no two names cover each other at any camera stop they share.
    const named = [
      ...geo.battles!.map((b) => ({ spot: b.labelSpot!, box: nameBox(b.label, 30, true), start: b.start })),
      ...geo.lines!.map((l) => ({ spot: l.labelSpot!, box: nameBox(l.label, 30, true), start: l.start })),
      ...close.walls.map((w) => ({ spot: w.labelSpot!, box: nameBox(w.label!, 26, true), start: 0 })),
      ...close.settlements.filter((s) => s.label).map((s) => ({ spot: s.labelSpot!, box: nameBox(s.label!, 30, true), start: s.start })),
    ];
    assert.ok(named.every((n) => n.spot), "every name placed");
    const stops = cameraStops(geo, 1920, 1080);
    assert.equal(stops.length, 2);
    const rect = (n: (typeof named)[number], k: number) => ({ x0: n.spot.x + (n.spot.dx - n.box.w / 2) * k, x1: n.spot.x + (n.spot.dx + n.box.w / 2) * k, y0: n.spot.y + (n.spot.dy - n.box.h / 2) * k, y1: n.spot.y + (n.spot.dy + n.box.h / 2) * k });
    const hit = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    for (const st of stops)
      named.forEach((a, i) =>
        named.forEach((b, j) => {
          if (j > i && Math.max(a.start, b.start) < st.to) assert.ok(!hit(rect(a, st.k), rect(b, st.k)), `names ${i} and ${j} overlap at the stop from ${st.from}`);
        }),
      );
    // The wall's name is clear of the front's tokens while they stand there.
    const wall = named[2]!;
    for (const p of geo.units![0]!.steps[0]!.points) {
      const r = rect(wall, stops[0]!.k);
      assert.ok(!(p.x > r.x0 - 23 * stops[0]!.k && p.x < r.x1 + 23 * stops[0]!.k && p.y > r.y0 - 23 * stops[0]!.k && p.y < r.y1 + 23 * stops[0]!.k), "the wall's name is not under a token");
    }
    // The road bends between its points but still starts and ends on them; it is named along its way.
    const road = close.roads[0]!;
    const [a, b] = [road[0]!, road[road.length - 1]!];
    assert.ok(road.length > 4, `${road.length} points`);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const off = Math.max(...road.map((p) => Math.abs(((b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x) / len)));
    assert.ok(off > len * 0.01 && off < len * 0.08, `bends ${Math.round((off / len) * 1000) / 10}% of the stretch`);
    assert.deepEqual(windingRoad([a, b], 1, 10, () => false), [a, ...Array.from({ length: Math.ceil(len / 10) - 1 }, (_, j) => ({ x: Math.round((a.x + ((b.x - a.x) * (j + 1)) / Math.ceil(len / 10)) * 10) / 10, y: Math.round((a.y + ((b.y - a.y) * (j + 1)) / Math.ceil(len / 10)) * 10) / 10 })), b], "a bend into the sea stays straight");
    assert.equal(close.roadNames![0]!.label, "Road to Edirne");
    assert.ok(Math.abs(close.roadNames![0]!.angle) <= 90 && close.roadNames![0]!.labelSpot);
    // The burning city catches fire at the breach; Galata (no fire) has none.
    assert.deepEqual(close.settlements[0]!.burnFrom, { x: close.walls[0]!.breach!.x, y: close.walls[0]!.breach!.y });
    assert.equal(close.settlements[1]!.burnFrom, undefined);
    // A wide map is left as it was; a road's name is checked like any name.
    const wide = buildGeoMap({ merkez: [28.95, 41.02], genislik_km: 500, savaslar: [{ ad: "X", konum: [28.95, 41.02] }] }, data, 1920, 1080, () => 0);
    assert.equal(wide.battles![0]!.labelSpot, undefined);
    const ep = { ...sampleEpisode(), donem: "1453" };
    assert.equal(validateEpisode({ ...ep, sahneler: [{ ...ep.sahneler[0]!, harita: { ...map, yollar: [{ ad: "x".repeat(41), noktalar: [[28.85, 41.03], [28.92, 41.02]] }] } }] } as never).ok, false);
  });

  await scenario("O12 the 1453 moments (owner, 23 Oct 2026: 'no movement at all for the ships hauled over land'): a ship's land stretch, tokens through the breach, the camera on a fleet and on a fight", () => {
    // Land is everything west of 29.0 — a route from the sea at 29.05 over land to 28.95 and back to sea at 29.02.
    const onLand = (p: [number, number]) => p[0] < 29.0;
    const toPx = (p: readonly [number, number]) => ({ x: (p[0] - 28.9) * 10000, y: (41.1 - p[1]) * 10000 });
    const haul = overlandStretches([[29.05, 41.04], [29.0, 41.04], [28.98, 41.04]], toPx, onLand);
    assert.equal(haul.length, 1);
    assert.ok(Math.abs(haul[0]!.from - 0.714) < 0.02 && haul[0]!.to === 1, JSON.stringify(haul));
    assert.deepEqual(overlandStretches([[29.05, 41.04], [29.1, 41.04]], toPx, onLand), [], "all at sea");
    assert.deepEqual(overlandStretches([[29.0005, 41.04], [29.1, 41.04]], toPx, onLand), [], "leaving from the shore is no haul");
    const land = [[[[28, 40], [29, 40], [29, 42], [28, 42], [28, 40]]]];
    const geo = buildGeoMap(
      {
        merkez: [28.98, 41.03],
        genislik_km: 20,
        araclar: [{ tur: "gemi", renk: "#c0392b", sayi: 5, konum: [29.03, 41.04], satir: 1, yol: [[28.99, 41.045], [28.97, 41.04]] }],
        surlar: [{ noktalar: [[28.95, 41.05], [28.95, 41.0]], gedik: { konum: [28.95, 41.025], satir: 2 } }],
        birlikler: [{ taraf: "A", renk: "#c0392b", amblem: "hilal", sayi: 3, yerler: [{ satir: 0, cephe: [[28.94, 41.04], [28.94, 41.01]] }, { satir: 1, cephe: [[28.942, 41.04], [28.942, 41.01]] }, { satir: 2, kume: [28.96, 41.025], km: 0.5 }] }],
      },
      withCoast({ land: [], lakes: [], rivers: [], countries: new Map() } as never, { land: land as never, water: [] }),
      1920,
      1080,
      (i) => (i ?? 0) * 100,
      { relief: "bg/yakin.jpg", year: 1453 },
    );
    assert.equal(geo.vehicles![0]!.kind, "kadirga");
    // A route that ends on land is the writer pointing at the shore's far side: the ships stop at the shore, no haul.
    const shoreX = geo.vehicles![0]!.path[geo.vehicles![0]!.path.length - 1]!.x;
    assert.equal(geo.vehicles![0]!.overland, undefined, JSON.stringify(geo.vehicles![0]!.overland));
    assert.ok(geo.vehicles![0]!.path.length >= 2 && shoreX < geo.vehicles![0]!.path[0]!.x && shoreX > geo.vehicles![0]!.path[0]!.x - 400, `the route kept to the water (ends at ${shoreX})`);
    // A haul goes from water to water: over a strip of land with the sea on both sides.
    const strip = [[[[28.98, 40], [29.0, 40], [29.0, 42], [28.98, 42], [28.98, 40]]]];
    const hauled = buildGeoMap({ merkez: [28.99, 41.04], genislik_km: 20, araclar: [{ tur: "gemi", renk: "#c0392b", sayi: 3, konum: [29.03, 41.04], satir: 1, yol: [[28.99, 41.045], [28.95, 41.04]] }] }, withCoast({ land: [], lakes: [], rivers: [], countries: new Map() } as never, { land: strip as never, water: [] }), 1920, 1080, () => 0, { year: 1453 });
    const dragged = hauled.vehicles![0]!.overland!;
    assert.ok(dragged.length === 1 && dragged[0]!.from > 0.2 && dragged[0]!.to < 0.8, JSON.stringify(dragged));
    // A fleet whose first point stands just up the shore starts in the water beside it and is hauled from the shore (the
    // 1453 haul); far inland, it starts afloat.
    const coastData = withCoast({ land: [], lakes: [], rivers: [], countries: new Map() } as never, { land: strip as never, water: [] });
    const fromShore = buildGeoMap({ merkez: [28.99, 41.04], genislik_km: 20, araclar: [{ tur: "gemi", renk: "#c0392b", konum: [28.9985, 41.04], satir: 1, yol: [[28.99, 41.045], [28.95, 41.04]] }] }, coastData, 1920, 1080, () => 0, { year: 1453 });
    const putOff = fromShore.vehicles![0]!.overland?.[0];
    assert.ok(putOff && putOff.from < 0.06 && putOff.to > 0.3, JSON.stringify(fromShore.vehicles![0]!.overland));
    // A ship the writer set on land (Belgrade: the fleet "at Belgrade" in the fields) stands in the nearest water; one
    // pointed at from 4 km inland stays where it was put.
    const moored = buildGeoMap({ merkez: [28.99, 41.04], genislik_km: 20, araclar: [{ tur: "gemi", renk: "#c0392b", konum: [28.993, 41.04], satir: 0 }] }, coastData, 1920, 1080, () => 0, { year: 1453 });
    const ashore = buildGeoMap({ merkez: [28.99, 41.04], genislik_km: 20, araclar: [{ tur: "top", renk: "#c0392b", konum: [28.993, 41.04], satir: 0 }] }, coastData, 1920, 1080, () => 0, { year: 1453 });
    const [shipX, gunX] = [moored.vehicles![0]!.path[0]!.x, ashore.vehicles![0]!.path[0]!.x];
    assert.ok(shipX > gunX + 20, `the ship moves east off the strip into the water (${gunX} → ${shipX}); a gun stays`);
    // Fire aimed at the ship's written place follows it into the water.
    const duel = buildGeoMap({ merkez: [28.99, 41.04], genislik_km: 20, araclar: [{ tur: "gemi", renk: "#c0392b", konum: [28.993, 41.04], satir: 0 }, { tur: "gemi", renk: "#2e6b3a", konum: [29.02, 41.05], satir: 0, hedef: [28.993, 41.04], ates_satir: 0 }] }, coastData, 1920, 1080, () => 0, { year: 1453 });
    assert.deepEqual(duel.vehicles![1]!.target, duel.vehicles![0]!.path[0], "the shots fall on the moored ship");
    const wide = [[[[28.9, 40], [29.0, 40], [29.0, 42], [28.9, 42], [28.9, 40]]]];
    const inland = buildGeoMap({ merkez: [28.95, 41.04], genislik_km: 20, araclar: [{ tur: "gemi", renk: "#c0392b", konum: [28.95, 41.04], satir: 1, yol: [[29.03, 41.04]] }] }, withCoast({ land: [], lakes: [], rivers: [], countries: new Map() } as never, { land: wide as never, water: [] }), 1920, 1080, () => 0, { year: 1453 });
    assert.equal(inland.vehicles![0]!.overland, undefined, "pointed from 4 km inland: no haul");
    const deep = buildGeoMap({ merkez: [28.95, 41.04], genislik_km: 20, araclar: [{ tur: "gemi", renk: "#c0392b", konum: [28.95, 41.04], satir: 0 }] }, withCoast({ land: [], lakes: [], rivers: [], countries: new Map() } as never, { land: wide as never, water: [] }), 1920, 1080, () => 0, { year: 1453 });
    assert.equal(deep.vehicles![0]!.path[0]!.x, 960, "4 km inland: left where the writer put it");
    assert.deepEqual(cutRoute([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }], 0, 0.75), [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 15, y: 0 }]);
    // Only where the water is known: on Natural Earth's coast (no OpenStreetMap coast or rivers) a route over land is no haul.
    const unknown = buildGeoMap({ merkez: [28.98, 41.03], genislik_km: 20, araclar: [{ tur: "gemi", renk: "#c0392b", konum: [29.03, 41.04], satir: 1, yol: [[28.99, 41.045], [28.97, 41.04]] }] }, { land, lakes: [], rivers: [], countries: new Map() } as never, 1920, 1080, () => 0, { year: 1453 });
    assert.equal(unknown.vehicles![0]!.overland, undefined);
    // OpenStreetMap rivers are water on the close map, drawn as wide as they are.
    const river = buildGeoMap({ merkez: [28.98, 41.03], genislik_km: 20, yerlesimler: [{ tur: "koy", konum: [28.98, 41.03], km: 3 }] }, withCoast({ land, lakes: [], rivers: [], countries: new Map() } as never, { land: [], water: [], rivers: [{ line: [[28.9, 41.03], [29.06, 41.03]], km: 0.4 }] }), 1920, 1080, () => 0, {});
    assert.ok(river.close!.rivers![0]!.width > 30 && river.close!.settlements[0]!.items.every((it) => Math.abs(it.y - 540) > river.close!.rivers![0]!.width / 2), "no house in the river");
    // Line 1: the breach is not open yet — no way through; line 2: every token crosses the wall through it.
    const steps = geo.units![0]!.steps;
    assert.equal(steps[1]!.via, undefined);
    assert.deepEqual(steps[2]!.through, [0, 1, 2]);
    assert.deepEqual(steps[2]!.via, { x: geo.close!.walls[0]!.breach!.x, y: geo.close!.walls[0]!.breach!.y });
    assert.deepEqual(throughBreach([{ x: 0, y: 0 }], [{ x: 5, y: 0 }], 10, [{ points: [{ x: 9, y: -5 }, { x: 9, y: 5 }], towers: [], gates: [], breach: { x: 9, y: 0, start: 0 } }]), {}, "a move that does not cross the wall goes straight");
    // The camera: a fleet's short haul on a wide close view is followed; a fight away from the view gets the camera.
    const fleet = zoomOnShortRoutes({ merkez: [28.95, 41.02], genislik_km: 22, araclar: [{ tur: "gemi", renk: "#c0392b", konum: [29.006, 41.041], satir: 2, yol: [[28.99, 41.047], [28.972, 41.041], [28.957, 41.029]] }] });
    const key = fleet.map.kamera!.find((k) => k.satir === 2)!;
    assert.ok(key.genislik_km >= CLOSE_MIN_ZOOM_KM && key.genislik_km < 22, `fleet followed at ${key.genislik_km} km, never the wide map's 150 km floor`);
    const fight = zoomOnShortRoutes({
      merkez: [28.95, 41.02],
      genislik_km: 22,
      kamera: [{ satir: 2, merkez: [28.98, 41.036], genislik_km: 6.5 }],
      birlikler: [{ taraf: "B", renk: "#7a3fa0", amblem: "kartal", sayi: 4, yerler: [{ satir: 0, cephe: [[28.94, 41.03], [28.93, 41.01]] }, { satir: 3, cephe: [[28.94, 41.03], [28.93, 41.01]], kayip: 1 }] }],
    });
    assert.deepEqual(fight.map.kamera!.find((k) => k.satir === 3), { satir: 3, merkez: [28.935, 41.02], genislik_km: 6.5 }, "the camera pans to the fight at the same width");
    assert.equal(zoomOnShortRoutes({ ...fight.map }).zoomed, 0, "once on it, it stays");
  });

  await scenario("O13 close maps anywhere (owner, 23 Oct 2026: 'our brains must make these maps for any event on Earth — the close map, the castle'): castles by period, OSM walls fitted to the writer's line, layered sources, walled towns, close-map checks", async () => {
    // Castles drawn in the period's manner: closed rings of about the size asked.
    assert.deepEqual([castleStyleFor(1100), castleStyleFor(1529), castleStyleFor(1683), castleStyleFor(1916), castleStyleFor(undefined)], ["halka", "yildiz", "yildiz", "halka", "halka"]);
    for (const style of ["halka", "kare", "yildiz"] as const) {
      const ring = castleRing([20.45, 44.82], 0.8, style);
      assert.deepEqual(ring[0], ring[ring.length - 1], `${style} is closed`);
      const span = Math.max(...ring.map((p) => kmBetween([20.45, 44.82], p)));
      assert.ok(span > 0.3 && span < 0.65, `${style}: ${span.toFixed(2)} km from the centre`);
      assert.deepEqual(castleRing([20.45, 44.82], 0.8, style), ring, "the same place gives the same castle");
    }
    assert.ok(roundness(castleRing([20.45, 44.82], 0.8, "halka")) > 0.7, "a ring is round");
    // A wall mapped as a thin strip: its centre line; pieces joined across a gate; the real walls along the writer's line.
    const strip: [number, number][] = [[28.92, 41.0], [28.92, 41.02], [28.9203, 41.02], [28.9203, 41.0], [28.92, 41.0]];
    assert.ok(roundness(strip) < 0.08);
    const mid = stripCentreline(strip);
    assert.ok(mid.length >= 3 && mid.every((p) => Math.abs(p[0] - 28.92015) < 0.0001), JSON.stringify(mid.slice(0, 2)));
    const joined = joinPieces([[[28.92, 41.0], [28.92, 41.01]], [[28.92, 41.021], [28.92, 41.012]]], 0.25);
    assert.equal(joined.length, 1, "two pieces 220 m apart join");
    assert.equal(joinPieces([[[28.92, 41.0], [28.92, 41.01]], [[28.92, 41.02], [28.92, 41.03]]], 0.25).length, 2, "1 km apart they stay two");
    const real: [number, number][] = [[28.9205, 41.04], [28.921, 41.02], [28.9205, 41.0], [28.93, 40.98]];
    const fit = fitWall([[28.918, 41.035], [28.918, 41.005]], [real, [[28.99, 41.0], [28.99, 41.03]]])!;
    assert.ok(fit && fit.every((p) => p[0] > 28.919 && p[0] < 28.922) && fit[0]![1] > fit[fit.length - 1]![1], "the real wall along the line, in the writer's order, the far one left out");
    assert.equal(fitWall([[28.918, 41.035], [28.918, 41.005]], [[[28.99, 41.0], [28.99, 41.03]]]), undefined, "no real wall near: the writer's line stays");
    // OSM answers: wall ways chained, a castle outline, a gate; Nominatim: only fortifications, never the district.
    const ring = castleRing([20.45, 44.82], 0.8, "halka");
    const way = (tags: Record<string, string>, pts: [number, number][]) => ({ type: "way", tags, geometry: pts.map(([lon, lat]) => ({ lon, lat })) });
    const fromOsm = siteFromOverpass([
      way({ barrier: "city_wall" }, [[28.92, 41.04], [28.921, 41.02]]),
      way({ historic: "citywalls" }, [[28.921, 41.02], [28.92, 41.0]]),
      way({ historic: "castle", name: "Belgrade Fortress" }, ring),
      { type: "node", lon: 28.921, lat: 41.02, tags: { barrier: "city_gate", name: "Topkapı" } },
    ]);
    assert.equal(fromOsm.walls.length, 1, "the two wall ways chain into one");
    assert.equal(fromOsm.castles[0]!.name, "Belgrade Fortress");
    assert.equal(fromOsm.gates[0]!.name, "Topkapı");
    const fromName = siteFromNominatim([
      { category: "boundary", type: "administrative", name: "Rumelihisarı Mahallesi", geojson: { type: "Polygon", coordinates: [ring] } },
      { category: "historic", type: "castle", name: "Belgrade Fortress", geojson: { type: "Polygon", coordinates: [ring] } },
      { category: "building", type: "yes", name: "Walls of Constantinople", geojson: { type: "MultiPolygon", coordinates: [[strip]] } },
    ]);
    assert.equal(fromName.castles.length, 1, "the district is not a castle");
    assert.equal(fromName.walls.length, 1, "the wall strip became a wall line");
    // The preparer: a castle takes its real outline, one OSM lacks is drawn, a wall takes the real trace and its gates.
    const site = { walls: [real], castles: [{ ring, name: "Belgrade Fortress" }], gates: [{ at: [28.921, 41.02] as [number, number], name: "Topkapı" }] };
    const castle = placeWall({ ad: "Belgrade Fortress", kale: { merkez: [20.4505, 44.8203], km: 0.8 } }, site, 1456);
    assert.equal(castle.note.kaynak, "osm");
    assert.ok(castle.wall.noktalar!.length >= 6);
    assert.equal(placeWall({ ad: "Lost Castle", kale: { merkez: [12, 47], km: 0.4 } }, site, 1456).note.kaynak, "kale");
    const wall = placeWall({ ad: "Theodosian Walls", noktalar: [[28.918, 41.035], [28.918, 41.005]] }, site, 1453);
    assert.equal(wall.note.kaynak, "osm");
    assert.deepEqual(wall.wall.kapilar, [[28.921, 41.02]], "the real gate on it");
    assert.equal(placeWall({ ad: "X", noktalar: [[28.918, 41.035], [28.918, 41.005]] }, undefined, 1453).note.kaynak, "yazar");
    const ep: Episode = { ...sampleEpisode(), donem: "1456" };
    const asked: string[][] = [];
    const prepared = await prepareCloseMaps(
      { ...ep, sahneler: [{ ...ep.sahneler[0]!, harita: { merkez: [20.45, 44.82], genislik_km: 6, sehirler: [{ ad: "Belgrade", konum: [20.46, 44.82] }], surlar: [{ ad: "Belgrade Fortress", kale: { merkez: [20.4505, 44.8203], km: 0.8 } }] } }] },
      async (_box, names) => (asked.push([...names]), { site, sources: ["test"] }),
      1456,
    );
    assert.deepEqual(asked[0], ["Belgrade Fortress", "Walls of Belgrade", "Belgrade city walls"]);
    assert.ok(prepared.episode.sahneler[0]!.harita!.surlar![0]!.noktalar!.length >= 6 && prepared.sources[0] === "test");
    assert.equal((await prepareCloseMaps(ep, async () => { throw new Error("no map scene asks"); }, 1456)).notes.length, 0);
    // A walled town fills its walls only; a castle with no points is drawn round its centre.
    const land = [[[[28, 40], [30, 40], [30, 42], [28, 42], [28, 40]]]];
    const walled = buildGeoMap(
      { merkez: [28.95, 41.02], genislik_km: 12, surlar: [{ noktalar: [[28.94, 41.06], [28.94, 40.98]] }, { ad: "Castle", kale: { merkez: [28.9, 41.0], km: 0.6 } }], yerlesimler: [{ tur: "sehir", konum: [28.95, 41.02], km: 5, sur_ici: true }] },
      { land, lakes: [], rivers: [], countries: new Map() } as never,
      1920,
      1080,
      () => 0,
      { relief: "bg/yakin.jpg", year: 1300 },
    );
    const wallX = walled.close!.walls[0]!.points[0]!.x;
    assert.ok(walled.close!.settlements[0]!.items.length > 30 && walled.close!.settlements[0]!.items.every((it) => it.x > wallX), "every house on the town's side of the wall");
    assert.ok(walled.close!.walls[1]!.points.length > 20 && walled.close!.walls[1]!.towers.length > 3, "the drawn castle with its towers");
    // A close map's places: a building checked by its name (a share of the map's width), never moved to the nearest article.
    const placed = await checkMapPlaces("y", { merkez: [28.95, 41.02], genislik_km: 20, yapilar: [{ tur: "kilise", ad: "Hagia Sophia", konum: [28.99, 41.0] }], savaslar: [{ ad: "Gate of St. Romanus", konum: [28.9255, 41.0202] }] }, async (q) =>
      q === "Hagia Sophia" ? [{ title: "Hagia Sophia", lon: 28.98, lat: 41.0086 }] : [{ title: "Fall of Constantinople", lon: 28.98, lat: 41.01 }],
    );
    assert.deepEqual(placed.map.yapilar![0]!.konum, [28.98, 41.0086], "Hagia Sophia 1.3 km off moves to Wikipedia's spot");
    assert.deepEqual(placed.map.savaslar![0]!.konum, [28.9255, 41.0202], "the gate's fight stays where the writer put it");
    assert.equal(placeToleranceKm({ merkez: [0, 0], genislik_km: 20 }), 0.8);
    // The writer's close-map checks: no armies; a fight with the enemy 1.5 km off; a siege told without walls.
    const closeScene = (h: SceneMap, line = "The army reaches the walls and lays siege.") => ({ sahneler: [{ ...ep.sahneler[0]!, id: "y", satirlar: [{ karakter: "anlatici", metin: line, duygu: "notr" }], harita: h }] });
    const lone = mapProblems(closeScene({ merkez: [28.95, 41.02], genislik_km: 20, kamera: [{ satir: 0, merkez: [28.95, 41.02], genislik_km: 10 }] }));
    assert.ok(lone.some((p) => p.includes("has no armies")) && lone.some((p) => p.includes("draws none")), JSON.stringify(lone));
    const apart = mapProblems(closeScene({ merkez: [28.95, 41.02], genislik_km: 20, surlar: [{ noktalar: [[28.92, 41.04], [28.92, 41.0]] }], birlikler: [
      { taraf: "A", renk: "#c0392b", amblem: "hilal", sayi: 4, yerler: [{ satir: 0, cephe: [[28.9, 41.04], [28.9, 41.0]] }] },
      { taraf: "B", renk: "#7a3fa0", amblem: "kartal", sayi: 4, yerler: [{ satir: 0, cephe: [[28.93, 41.04], [28.93, 41.0]], kayip: 1 }] },
    ] }));
    assert.ok(apart.some((p) => p.includes('"B" loses tokens on line 0')), JSON.stringify(apart));
    // A rout: losses on the way back to camp, the enemy at the walls the fleeing side left (Belgrade's fourth trial).
    const rout = (campLat: number) => mapProblems(closeScene({ merkez: [28.95, 41.02], genislik_km: 20, surlar: [{ noktalar: [[28.92, 41.04], [28.92, 41.0]] }], birlikler: [
      { taraf: "A", renk: "#c0392b", amblem: "hilal", sayi: 6, yerler: [{ satir: 0, cephe: [[28.917, 41.03], [28.917, 41.01]] }, { satir: 1, kume: [28.85, campLat], km: 1, kayip: 2 }] },
      { taraf: "B", renk: "#7a3fa0", amblem: "kartal", sayi: 4, yerler: [{ satir: 0, cephe: [[28.923, 41.03], [28.923, 41.01]] }] },
    ] }, "The besiegers storm the walls and are thrown back."));
    assert.ok(!rout(41.02).some((p) => p.includes("loses tokens")), "losses as they flee from the walls");
    const fine = mapProblems(closeScene({ merkez: [28.95, 41.02], genislik_km: 20, surlar: [{ noktalar: [[28.92, 41.04], [28.92, 41.0]] }], birlikler: [
      { taraf: "A", renk: "#c0392b", amblem: "hilal", sayi: 4, yerler: [{ satir: 0, cephe: [[28.917, 41.04], [28.917, 41.0]] }] },
      { taraf: "B", renk: "#7a3fa0", amblem: "kartal", sayi: 4, yerler: [{ satir: 0, cephe: [[28.923, 41.04], [28.923, 41.0]], kayip: 1 }] },
    ] }));
    assert.deepEqual(fine, []);
    // Validation: a castle ring instead of points; a walled town's flag.
    const v = (h: unknown) => validateEpisode({ ...ep, sahneler: [{ ...ep.sahneler[0]!, harita: { merkez: [20.45, 44.82], genislik_km: 6, ...(h as object) } }] } as never);
    assert.equal(v({ surlar: [{ ad: "Belgrade Fortress", kale: { merkez: [20.45, 44.82], km: 0.8, bicim: "yildiz" } }] }).ok, true);
    assert.equal(v({ surlar: [{ ad: "X" }] }).ok, false, "a wall needs a line or a castle");
    assert.equal(v({ surlar: [{ kale: { merkez: [20.45, 44.82], km: 0.8, bicim: "piramit" } }] }).ok, false);
    assert.equal(v({ yerlesimler: [{ tur: "sehir", konum: [20.45, 44.82], sur_ici: "evet" }] }).ok, false);
  });

  await scenario("O14 the battle itself on the close map (owner, 23 Oct 2026, after the Belgrade trial): speakers talk from their badges at their side's tokens, the map stays wide, the climax is asked for on the close map", () => {
    const ep = sampleEpisode();
    const cast: Episode["oyuncu_kadrosu"] = [
      ep.oyuncu_kadrosu[0]!,
      { ...castBase, id: "mehmed", ad: "Mehmed II", rol: "Ottoman Sultan, age 24", renk: "#b3263a", ses_id: "mehmed" },
      { ...castBase, id: "szilagyi", ad: "Michael Szilágyi", rol: "Defender of Belgrade", renk: "#4e4eb7", ses_id: "szilagyi" },
      { ...castBase, id: "envoy", ad: "Papal Envoy", rol: "Messenger from Rome", renk: "#b7b74e", ses_id: "envoy" },
    ];
    const sides: SceneMap["birlikler"] = [
      { taraf: "Ottomans", renk: "#c0392b", amblem: "hilal", sayi: 8, yerler: [{ satir: 0, kusatma: [20.45, 44.82], km: 2 }] },
      { taraf: "Hungarians", renk: "#2e6b3a", amblem: "kartal", sayi: 3, yerler: [{ satir: 0, kume: [20.451, 44.821], km: 0.6 }] },
    ];
    const siege: Episode["sahneler"][number] = {
      ...ep.sahneler[0]!,
      id: "y-belgrad",
      mekan: "Close battle map: Belgrade Fortress",
      harita: { merkez: [20.45, 44.82], genislik_km: 18, birlikler: sides, surlar: [{ ad: "Belgrade Fortress", kale: { merkez: [20.4505, 44.8203], km: 0.8 } }] },
      satirlar: [
        { karakter: "anlatici", metin: "Mehmed's cannons thunder.", duygu: "notr" },
        { karakter: "mehmed", metin: "If at first you don't succeed, fire 21 more cannons.", duygu: "kararli", balon: "21 more cannons!" },
        { karakter: "szilagyi", metin: "We call this Hungarian hospitality.", duygu: "sinsi", balon: "Hungarian hospitality" },
      ],
    };
    assert.deepEqual([sideStems("Ottomans"), sideStems("Kingdom of Hungary"), sideStems("Bizans")], [["ottoma"], ["hungar"], ["bizan"]]);
    const plan0 = mapSpeakers(siege, cast);
    assert.deepEqual([...plan0.badged].sort(), ["mehmed", "szilagyi"]);
    assert.deepEqual(plan0.sideBadges.map((b) => [b.karakter, b.taraf, b.satir]), [["mehmed", 0, 1], ["szilagyi", 1, 2]], "the sultan by his role, the defender as the side left");
    // On a wide map only a writer's badge speaks; a speaker without one still stands on the map as before.
    const wide = { ...siege, harita: { merkez: [22, 43] as [number, number], genislik_km: 1600, rozetler: [{ karakter: "mehmed", konum: [26.56, 41.68] as [number, number], satir: 0 }] } };
    assert.deepEqual([[...mapSpeakers(wide, cast).badged], mapSpeakers(wide, cast).sideBadges.length], [["mehmed"], 0]);
    // A third speaker of no side on the close map: two speakers for the one side left is no answer, the writer is asked
    // for their badges.
    const crowded = { ...siege, satirlar: [...siege.satirlar, { karakter: "envoy", metin: "The Pope sends his regards.", duygu: "notr" as const }] };
    assert.deepEqual(mapSpeakers(crowded, cast).unplaced, ["szilagyi", "envoy"]);
    assert.ok(mapProblems({ ...ep, oyuncu_kadrosu: cast, sahneler: [crowded] }).some((p) => p.includes('"envoy" speaks on the map but has no badge')));

    // The render plan: no one on the stage, two talking badges at the tokens, the bubbles from the badges, the map wide.
    const square = [[[19, 44], [22, 44], [22, 46], [19, 46], [19, 44]] as const] as const;
    const data = { land: [square], lakes: [], rivers: [], countries: new Map() };
    const episode: Episode = { ...ep, donem: "1456", oyuncu_kadrosu: cast, sahneler: [siege] };
    const tl = buildTimeline(episode, [[fakeAudio(2), fakeAudio(2.5), fakeAudio(2)]]);
    const plan = buildRenderPlan({ episode, timeline: tl, cast: toRenderCast(cast, "kukla"), accessories: [], backgrounds: [{ src: "bg/harita-zemin.png", kind: "archival" }], mapData: data as never, fps: 30, width: 1920, height: 1080, showCaptions: false });
    const shot = plan.shots.find((s) => s.id === "y-belgrad")!;
    assert.equal(shot.performers.length, 0, "the speakers are not drawn over the battle");
    const badges = shot.geoMap!.badges!;
    assert.deepEqual(badges.map((b) => b.castId), ["mehmed", "szilagyi"]);
    const tokens = shot.geoMap!.units!;
    for (const [bi, side] of [[0, 0], [1, 1]] as const) assert.ok(tokens[side]!.steps[0]!.points.some((p) => p.x === badges[bi]!.path[0]!.x && p.y === badges[bi]!.path[0]!.y), `${badges[bi]!.castId} stands at a token of his side`);
    const lines = tl.lines.filter((l) => l.sceneIndex === 0);
    const local = (sec: number) => Math.round(sec * 30) - shot.start;
    assert.deepEqual(badges[0]!.talk!.speaking, [{ start: local(lines[1]!.start), end: local(lines[1]!.end) }], "the sultan's badge speaks on his line only");
    assert.ok(badges[0]!.talk!.visemes.length >= 3 && badges[0]!.talk!.faces.some((f) => f.emotion === "kararli"));
    assert.equal(badges[0]!.start, local(lines[1]!.start), "his badge comes with his first line");
    assert.deepEqual(shot.bubbles!.map((b) => [b.castId, b.text]), [["mehmed", "21 more cannons!"], ["szilagyi", "Hungarian hospitality"]]);
    assert.ok(shot.camera.every((c) => c.zoom <= 1.06), `the map stays wide while they speak: ${shot.camera.map((c) => c.zoom)}`);
    assert.equal((shot.nameTags ?? []).length, 0, "the badge carries the name");
    // A writer's badge set on its own side's tokens (Belgrade's fourth trial: Mehmed over his retreating army) moves a
    // little off them; on a wide map it stays where the writer put it.
    const onTokens: SceneMap = { merkez: [20.45, 44.82], genislik_km: 10, birlikler: [{ taraf: "Ottomans", renk: "#c0392b", amblem: "hilal", sayi: 6, yerler: [{ satir: 0, kume: [20.44, 44.8], km: 0.4 }] }], rozetler: [{ karakter: "mehmed", konum: [20.44, 44.8], satir: 0 }] };
    const nudged = buildGeoMap(onTokens, data as never, 1920, 1080, () => 0, { year: 1456 });
    const camp = nudged.units![0]!.steps[0]!.points;
    const centre = { x: camp.reduce((a, p) => a + p.x, 0) / camp.length, y: camp.reduce((a, p) => a + p.y, 0) / camp.length };
    const hidden = (p: { x: number; y: number }) => camp.filter((q) => Math.abs(q.x - p.x) < 75 && q.y > p.y - 140 && q.y < p.y + 6).length;
    const pin = nudged.badges![0]!.path[0]!;
    assert.ok(hidden(pin) < hidden(centre) && Math.hypot(pin.x - centre.x, pin.y - centre.y) <= 3 * 55 * Math.SQRT2 + 2, `off its tokens, beside the camp: ${hidden(centre)} → ${hidden(pin)} at ${JSON.stringify(pin)}`);
    // A cluster or a ring without its "km" takes the close map's own scale (at the wide map's 30–40 km, a 10 km map's
    // defenders stood off it).
    const loose = buildGeoMap({ merkez: [20.45, 44.82], genislik_km: 10, birlikler: [{ taraf: "H", renk: "#2e6b3a", amblem: "kartal", sayi: 6, yerler: [{ satir: 0, kume: [20.45, 44.82] }, { satir: 1, kusatma: [20.45, 44.82] }] }] }, data as never, 1920, 1080, (i) => (i ?? 0) * 100, { year: 1456 });
    assert.ok(loose.units![0]!.steps.every((st) => st.points.every((p) => p.x > 0 && p.x < 1920 && p.y > 0 && p.y < 1080)), JSON.stringify(loose.units![0]!.steps.map((st) => st.points)));
    const kept = buildGeoMap({ ...onTokens, genislik_km: 300 }, data as never, 1920, 1080, () => 0, { year: 1456 });
    const army = kept.units![0]!.steps[0]!.points;
    const there = { x: army.reduce((a, p) => a + p.x, 0) / army.length, y: army.reduce((a, p) => a + p.y, 0) / army.length };
    assert.ok(Math.hypot(kept.badges![0]!.path[0]!.x - there.x, kept.badges![0]!.path[0]!.y - there.y) < 3, "a wide map's badge stays on its place");

    // The climax told off the map (Belgrade: the storming of the breach in a character scene) is asked for on it.
    const breach: Episode["sahneler"][number] = { ...ep.sahneler[0]!, id: "s6", ortam: { zaman: "gun", manzara: "sur_onu", uslup: "ortacag" }, satirlar: [{ karakter: "anlatici", metin: "The Ottomans storm the breach. The defenders push them back.", duygu: "korkmus" }] };
    const told = mapProblems({ ...episode, sahneler: [siege, breach] });
    assert.ok(told.some((p) => p.includes('climax is never seen on the close map "y-belgrad"') && p.includes('scene "s6" line 0')), JSON.stringify(told));
    const fought: Episode["sahneler"][number] = { ...siege, harita: { ...siege.harita!, birlikler: [sides[0]!, { ...sides[1]!, yerler: [...sides[1]!.yerler, { satir: 2, kume: [20.451, 44.821], km: 0.6, kayip: 1 }] }] } };
    assert.ok(!mapProblems({ ...episode, sahneler: [fought, breach] }).some((p) => p.includes("climax")), "losses on the close map: the reaction scene may follow");
    assert.ok(!mapProblems({ ...episode, sahneler: [siege] }).some((p) => p.includes("climax")), "no fight told: no climax asked for");
    // Belgrade's second trial: the Danube battle fought on a close map with no walls, the storming of the walls in a
    // character scene — the assault is asked for on a close map of the walls.
    const danube: Episode["sahneler"][number] = { ...siege, id: "y-tuna", harita: { merkez: [20.45, 44.82], genislik_km: 25, birlikler: sides, araclar: [{ tur: "gemi", renk: "#c0392b", sayi: 4, konum: [20.45, 44.82], satir: 0, kayip: 3, kayip_satir: 1 }] } };
    const walls: Episode["sahneler"][number] = { ...breach, satirlar: [{ karakter: "anlatici", metin: "The Ottomans storm the walls.", duygu: "korkmus" }] };
    const assault = mapProblems({ ...episode, sahneler: [danube, walls] });
    assert.ok(assault.some((p) => p.includes("assault on the walls is never seen") && p.includes('scene "s6" line 0')), JSON.stringify(assault));
    assert.ok(!assault.some((p) => p.includes("climax is never seen")), "the ships lost are the close map's fight");
    assert.ok(!mapProblems({ ...episode, sahneler: [{ ...danube, harita: { ...danube.harita!, birlikler: undefined } }] }).some((p) => p.includes("has no armies")), "a fleet battle's map may have only its ships");
    assert.ok(!mapProblems({ ...episode, sahneler: [danube, fought, walls] }).some((p) => p.includes("assault")), "the walls fought over on a close map: the scene is the reaction");
  });

  await scenario("O15 the owner's shares after DFT Tarih (23 Oct 2026): a map scene's period picture over its marked line, the video's map / stage / picture shares, the chapter's share asks", () => {
    const ep = sampleEpisode();
    const narrate = (metin: string) => ({ karakter: "anlatici", metin, duygu: "notr" as const });
    const map: Episode["sahneler"][number] = { ...ep.sahneler[0]!, id: "m1", mekan: "Map: the Balkans", harita: { merkez: [22, 43], genislik_km: 1600, kamera: [{ satir: 1, merkez: [20.45, 44.82], genislik_km: 900 }] }, ara_goruntu_satir: 1, satirlar: [narrate("The army marches north."), narrate("At Belgrade the walls wait."), narrate("The siege begins.")] };
    const stage: Episode["sahneler"][number] = { ...ep.sahneler[0]!, id: "c1", ortam: { zaman: "gun", manzara: "ordugah", uslup: "osmanli" } };
    const episode: Episode = { ...ep, sahneler: [map, stage] };
    const square = [[[[15, 38], [30, 38], [30, 48], [15, 48], [15, 38]]]];
    const tl = buildTimeline(episode, [[fakeAudio(3), fakeAudio(4), fakeAudio(3)], [fakeAudio(2), fakeAudio(1.5), fakeAudio(2), fakeAudio(1.8)]]);
    const plan = buildRenderPlan({ episode, timeline: tl, cast: toRenderCast(ep.oyuncu_kadrosu, "kukla"), accessories: [], backgrounds: [{ src: "bg/harita-zemin.png", kind: "archival" }, { src: "", kind: "drawn", drawn: { zaman: "gun", manzara: "ordugah", uslup: "osmanli", tohum: 1 } }], inserts: [{ src: "bg/m1-donem.jpg", caption: "Belgrade, 1456" }, undefined], mapData: { land: square, lakes: [], rivers: [], countries: new Map() } as never, fps: 30, width: 1920, height: 1080, showCaptions: false });
    const shot = plan.shots.find((s) => s.id === "m1")!;
    const line = tl.lines.find((l) => l.sceneIndex === 0 && l.lineIndex === 1)!;
    const local = (sec: number) => Math.round(sec * 30) - shot.start;
    assert.equal(shot.inserts!.length, 1, "one picture, over its marked line only");
    assert.ok(shot.inserts![0]!.start >= local(line.start) && shot.inserts![0]!.end <= local(line.start) + 6 * 30 && shot.inserts![0]!.caption === "Belgrade, 1456", JSON.stringify(shot.inserts));
    const shares = pictureShares(plan);
    assert.ok(Math.abs(shares.harita + shares.sahne + shares.gorsel - 1) < 0.01 && shares.gorsel > 0 && shares.harita > shares.gorsel, JSON.stringify(shares));
    // Without a marked line the map has no cutaway (the picture was not searched for).
    const unmarked = buildRenderPlan({ episode: { ...episode, sahneler: [{ ...map, ara_goruntu_satir: undefined }, stage] }, timeline: tl, cast: toRenderCast(ep.oyuncu_kadrosu, "kukla"), accessories: [], backgrounds: [{ src: "bg/harita-zemin.png", kind: "archival" }, { src: "", kind: "drawn", drawn: { zaman: "gun", manzara: "ordugah", uslup: "osmanli", tohum: 1 } }], inserts: [{ src: "bg/m1-donem.jpg" }, undefined], mapData: { land: square, lakes: [], rivers: [], countries: new Map() } as never, fps: 30, width: 1920, height: 1080, showCaptions: false });
    assert.equal(unmarked.shots.find((s) => s.id === "m1")!.inserts!.length, 0);
    // A chapter mostly on the stage, a map chapter with no picture moment: asked for; the owner's mix passes.
    const sized = (s: Episode["sahneler"][number], sure: number) => ({ ...s, sure_hedef: sure });
    assert.ok(shareProblems({ ...episode, sahneler: [sized(map, 40), sized(stage, 80)] }).some((p) => p.includes("character scenes take 67%")));
    assert.ok(shareProblems({ ...episode, sahneler: [sized({ ...map, ara_goruntu_satir: undefined }, 100), sized(stage, 20)] }).some((p) => p.includes('no map scene marks "ara_goruntu_satir"')));
    assert.deepEqual(shareProblems({ ...episode, sahneler: [sized(map, 100), sized(stage, 20)] }), []);
    assert.deepEqual(shareProblems({ ...episode, sahneler: [sized(map, 20), sized(stage, 40)] }), [], "a short video is told on the stage freely");
    // Validation: the marked line must be one of the scene's.
    assert.equal(validateEpisode(episode).ok, true, JSON.stringify(validateEpisode(episode).errors.slice(0, 2)));
    assert.equal(validateEpisode({ ...episode, sahneler: [{ ...map, ara_goruntu_satir: 3 }, stage] }).ok, false);
  });

  await scenario("O16 marks over the map after DFT Tarih (owner, 23 Oct 2026): strength bar with its numbers, white flag, flames, a glowing state and a ring, the date stamp, a red X over a beaten ruler's badge", () => {
    assert.deepEqual(["15,000–25,000", "1.000", "80 000", "c. 7,000 men", "2.5 million", "11 legions, 47,000 men", "none"].map(strengthValue), [20000, 1000, 80000, 7000, 2500000, 47000, 0]);
    const land = [[[[15, 35], [30, 35], [30, 45], [15, 45], [15, 35]]]];
    const map: SceneMap = {
      merkez: [22, 40],
      genislik_km: 1200,
      bolgeler: [{ ad: "Hungary", renk: "#c0392b", noktalar: [[18, 41], [24, 41], [24, 44], [18, 44]], satir: 0 }],
      rozetler: [{ karakter: "mehmed", konum: [21, 40], satir: 0, x_satir: 3 }],
      guc: [{ satir: 1, taraflar: [{ ad: "Ottomans", renk: "#3fae3a", sayi: "80,000" }, { ad: "Hungarians", renk: "#c0392b", sayi: "15,000–25,000" }] }, { satir: 3, taraflar: [{ ad: "Ottomans", renk: "#3fae3a", sayi: "60,000" }, { ad: "Hungarians", renk: "#c0392b", sayi: "20,000" }] }],
      teslim: [{ konum: [20.45, 42.8], satir: 3, ad: "Belgrade surrenders" }],
      yanginlar: [{ konum: [21, 42], satir: 2 }, { konum: [22, 42], satir: 2, km: 60, bitis_satir: 3 }],
      vurgular: [{ bolge: "hungary", satir: 1 }, { konum: [20.45, 42.8], km: 80, satir: 2, bitis_satir: 3 }],
      tarih: [{ satir: 2, metin: "29 August 1521" }, { satir: 0, metin: "1521" }],
    };
    const lineEnd = (i: number) => (i < 4 ? i * 100 + 80 : undefined);
    const geo = buildGeoMap(map, { land, lakes: [], rivers: [], countries: new Map() } as never, 1920, 1080, (i) => (i ?? 0) * 100, { lineEnd, fps: 30, castName: () => "Suleiman" });
    assert.deepEqual(geo.strength!.map((s) => [s.start, s.sides[0].value, s.sides[1].value, s.sides[1].count]), [[100, 80000, 20000, "15,000–25,000"], [300, 60000, 20000, "20,000"]]);
    assert.deepEqual([geo.flags!.length, geo.flags![0]!.start, geo.flags![0]!.label], [1, 300, "Belgrade surrenders"]);
    assert.deepEqual(geo.fires!.map((f) => [f.start, f.end]), [[200, undefined], [200, 300]]);
    assert.ok(geo.fires![1]!.size > geo.fires![0]!.size, "a 60 km fire is drawn wider than the default");
    // The glow names the state by its bolgeler name (any case), and lasts at least its line or GLOW_MIN_S.
    const hungary = geo.territories.findIndex((t) => t.label === "Hungary");
    assert.deepEqual([geo.glows![0]!.territory, geo.glows![0]!.start, geo.glows![0]!.end], [hungary, 100, 195]);
    assert.ok(geo.glows![1]!.x !== undefined && geo.glows![1]!.r! > 0 && geo.glows![1]!.end === 300 && geo.glows![1]!.territory === undefined);
    assert.deepEqual(geo.dates, [{ start: 0, text: "1521" }, { start: 200, text: "29 August 1521" }], "dates in line order");
    assert.equal(geo.badges![0]!.crossed, 300);
    // Validation: two sides with numbers, a glow names a state of this map or a place, every mark has its line.
    const ep = { ...sampleEpisode(), donem: "1521" };
    const four = Array.from({ length: 4 }, (_, i) => ({ karakter: "anlatici", metin: `Line ${i}.`, duygu: "notr" as const }));
    const withMap = (h: SceneMap) => validateEpisode({ ...ep, sahneler: [{ ...ep.sahneler[0]!, harita: h, satirlar: four }] } as never);
    assert.equal(withMap(map).ok, true, JSON.stringify(withMap(map).errors.slice(0, 3)));
    assert.equal(withMap({ ...map, guc: [{ satir: 1, taraflar: [map.guc![0]!.taraflar[0]] as never }] }).ok, false, "a bar needs both sides");
    assert.equal(withMap({ ...map, guc: [{ satir: 1, taraflar: [map.guc![0]!.taraflar[0], { ad: "X", renk: "#000000", sayi: "many" }] }] }).ok, false, "a number in digits");
    assert.equal(withMap({ ...map, vurgular: [{ bolge: "Serbia", satir: 1 }] }).ok, false, "a glow names a state on this map");
    assert.equal(withMap({ ...map, vurgular: [{ bolge: "Hungary", konum: [20, 42], satir: 1 }] }).ok, false, "a state or a place, not both");
    assert.equal(withMap({ ...map, teslim: [{ konum: [20, 42], satir: 9 }] }).ok, false, "the flag's line exists");
    assert.equal(withMap({ ...map, rozetler: [{ ...map.rozetler![0]!, x_satir: 7 }] }).ok, false);
  });

  await scenario("O17 info cards over the darkened picture after DFT Tarih: a chart box by box with portraits, a list line by line, a counter — timed by their lines, laid out as a tree, validated", () => {
    const lines = [0, 1, 2, 3, 4].map((i) => ({ lineIndex: i, start: i * 90, end: i * 90 + 80 }));
    const cards = infoCardsOf({
      bilgi_kartlari: [
        { tur: "sema", baslik: "Rome's two camps", satir: 1, dugumler: [{ ad: "Roman Senate" }, { ad: "Optimates", ust: 0, renk: "#3f6fb5", karakterler: ["halil"] }, { ad: "Populares", ust: 0, karakterler: ["mehmed"], satir: 2 }] },
        { tur: "liste", baslik: "Advantages", satir: 3, maddeler: [{ metin: "Veteran legions", satir: 3 }, { metin: "Speed", satir: 4 }] },
        { tur: "sayac", satir: 0, deger: 1_000_000, etiket: "killed", bitis_satir: 1 },
        { tur: "sayac", satir: 9, deger: 5, etiket: "a line that does not exist" },
      ],
    }, lines, 30, 1000);
    assert.equal(cards.length, 3, "a card on a missing line is dropped");
    const [chart, list, counter] = cards;
    assert.deepEqual(chart!.nodes!.map((n) => [n.label, n.parent, n.start, n.castIds?.[0]]), [["Roman Senate", undefined, 108, undefined], ["Optimates", 0, 144, "halil"], ["Populares", 0, 180, "mehmed"]], "unlined boxes 1.2 s apart, a lined one at its line");
    assert.deepEqual([chart!.start, chart!.end], [90, 284], "until a beat after the last line it names");
    assert.deepEqual(list!.items!.map((x) => x.start), [270, 360]);
    assert.deepEqual([counter!.start, counter!.end, counter!.value], [0, 120, 1_000_000], "at least INFO_CARD_MIN_S even when bitis_satir comes sooner");
    // The chart is a tree: children under their parent, the parent centred over them.
    const at = chartLayout(chart!.nodes!, 1920, 300, 720);
    assert.ok(at[1]!.y > at[0]!.y && at[1]!.y === at[2]!.y && Math.abs(at[0]!.x - (at[1]!.x + at[2]!.x) / 2) < 1 && at[1]!.x < at[2]!.x, JSON.stringify(at));
    // The director puts them on the shot.
    const ep = sampleEpisode();
    const withCards: Episode = { ...ep, sahneler: [{ ...ep.sahneler[0]!, bilgi_kartlari: [{ tur: "liste", baslik: "Why", satir: 0, maddeler: [{ metin: "One" }, { metin: "Two" }] }] }] };
    const tl = buildTimeline(withCards, [ep.sahneler[0]!.satirlar.map(() => fakeAudio(2))]);
    const plan = buildRenderPlan({ episode: withCards, timeline: tl, cast: toRenderCast(ep.oyuncu_kadrosu, "kukla"), accessories: [], backgrounds: [{ src: "bg/a.png", kind: "set" }], fps: 30, width: 1920, height: 1080, showCaptions: false });
    assert.equal(plan.shots.find((s) => s.id === ep.sahneler[0]!.id)!.infoCards!.length, 1);
    // Validation.
    const v = (c: unknown) => validateEpisode({ ...ep, sahneler: [{ ...ep.sahneler[0]!, bilgi_kartlari: [c] }] } as never);
    assert.equal(v(withCards.sahneler[0]!.bilgi_kartlari![0]).ok, true, JSON.stringify(v(withCards.sahneler[0]!.bilgi_kartlari![0]).errors.slice(0, 2)));
    assert.equal(v({ tur: "liste", satir: 0, maddeler: [{ metin: "One" }, { metin: "Two" }] }).ok, false, "a list needs its title");
    assert.equal(v({ tur: "sema", satir: 0, dugumler: [{ ad: "A", ust: 1 }, { ad: "B" }] }).ok, false, "a box hangs from an earlier one");
    assert.equal(v({ tur: "sema", satir: 0, dugumler: [{ ad: "A" }, { ad: "B", ust: 0, karakterler: ["anlatici"] }] }).ok, false, "portraits of visible cast only");
    assert.equal(v({ tur: "sayac", satir: 0, deger: 100 }).ok, false, "a counter needs its label");
    assert.equal(v({ tur: "harita", satir: 0 }).ok, false);
  });

  await scenario("O18 close-map tactics after DFT Tarih's Pharsalus: blocks by kind with strength labels, a front three lines deep away from the enemy, plan arrows that go, the named unit framed, a rout that scatters, siege lines with their length", () => {
    // Three lines deep: the front line first and fullest, each rear line further from the enemy (east here), staggered.
    const front: [number, number][] = [[22, 40], [22, 40.2]];
    const deep = deepFront(front, 8, 3, 1, [22.5, 40.1]);
    assert.equal(deep.length, 8);
    assert.ok(deep.slice(0, 3).every((p) => Math.abs(p[0] - 22) < 1e-9), "the front line stays on the writer's line");
    assert.ok(deep.slice(3, 6).every((p) => p[0] < 22 - 0.005) && deep.slice(6).every((p) => p[0] < deep[3]![0] - 0.005), "rear lines step back, away from the enemy");
    assert.ok(Math.abs(deep[3]![1] - deep[0]![1]) > 1e-4, "the second line is staggered");
    assert.deepEqual(formationPoints({ cephe: front, hatlar: 3 }, 8, undefined, undefined, { gapKm: 1 }), deepFront(front, 8, 3, 1), "formationPoints builds the deep front");
    assert.equal(lineKm([[0, 0], [0, 1]]).toFixed(1), "110.6");
    const scattered = routScatter([[22, 40], [22, 40]], 2, 1);
    assert.ok(scattered[0]![0] !== scattered[1]![0] && Math.abs(scattered[0]![0] - 22) < 0.05, "a rout scatters each token its own way, near the place given");
    const land = [[[[15, 35], [30, 35], [30, 45], [15, 45], [15, 35]]]];
    const map: SceneMap = {
      merkez: [22.2, 40.1],
      genislik_km: 40,
      birlikler: [
        { taraf: "Caesar", renk: "#c0392b", amblem: "kartal", sayi: 9, tur: "piyade", etiket: "22,000 men", vurgu: [1], yerler: [{ satir: 0, cephe: front, hatlar: 3 }, { satir: 2, cephe: [[22.2, 40], [22.2, 40.2]], hatlar: 3 }] },
        { taraf: "Pompey", renk: "#3f6fb5", amblem: "kartal", sayi: 6, tur: "suvari", yerler: [{ satir: 0, kume: [22.5, 40.1] }, { satir: 2, cephe: [[22.25, 40], [22.25, 40.2]], kayip: 2 }, { satir: 3, kume: [22.9, 40.3], bozgun: true, etiket: "Routed" }] },
      ],
      oklar: [{ noktalar: [[22.5, 40.25], [22.3, 40.35], [22.1, 40.3]], stil: "plan", satir: 1, bitis_satir: 2 }, { noktalar: [[21, 40], [22, 40]], satir: 0 }],
      kusatma_hatlari: [{ ad: "Siege line", noktalar: [[22, 40.3], [22.2, 40.3]], satir: 1 }, { noktalar: [[22.2, 40.3], [22.2, 40.31]], satir: 2, sure_sn: 3 }],
    };
    const geo = buildGeoMap(map, { land, lakes: [], rivers: [], countries: new Map() } as never, 1920, 1080, (i) => (i ?? 0) * 100, { fps: 30, lineEnd: (i) => i * 100 + 80 });
    const [caesar, pompey] = geo.units!;
    assert.deepEqual([caesar!.kind, caesar!.label, caesar!.highlights], ["piyade", "22,000 men", [{ start: 100, end: 195 }]]);
    assert.ok(caesar!.steps[0]!.points[3]!.x < caesar!.steps[0]!.points[0]!.x, "Caesar's rear lines stand west of his front, away from Pompey");
    assert.deepEqual([pompey!.kind, pompey!.steps[2]!.rout, pompey!.steps[2]!.label, pompey!.steps[1]!.rout], ["suvari", true, "Routed", undefined]);
    assert.deepEqual(geo.arrows.map((a) => [a.plan, a.end, a.color]), [[true, 200, "#3fae3a"], [undefined, undefined, "#e0283c"]], "a plan arrow is green by default and goes with its line");
    assert.deepEqual(geo.siegeLines!.map((s) => [s.start, s.durationS, s.label]), [[100, 6, "Siege line · 17 km"], [200, 3, "1.1 km"]]);
    // Validation: kinds from the list, lines deep only on a front, a rout not where the side first stands.
    const ep = { ...sampleEpisode(), donem: "MÖ 48" };
    const four = Array.from({ length: 4 }, (_, i) => ({ karakter: "anlatici", metin: `Line ${i}.`, duygu: "notr" as const }));
    const withMap = (h: SceneMap) => validateEpisode({ ...ep, sahneler: [{ ...ep.sahneler[0]!, harita: h, satirlar: four }] } as never);
    assert.equal(withMap(map).ok, true, JSON.stringify(withMap(map).errors.slice(0, 3)));
    const side = (patch: object) => ({ ...map, birlikler: [{ ...map.birlikler![0]!, ...patch }, map.birlikler![1]!] });
    assert.equal(withMap(side({ tur: "tank" })).ok, false);
    assert.equal(withMap(side({ yerler: [{ satir: 0, kume: [22, 40], hatlar: 2 }] })).ok, false, "hatlar only on a front");
    assert.equal(withMap(side({ yerler: [{ satir: 0, kume: [22, 40], bozgun: true }] })).ok, false, "no rout on the first formation");
    assert.equal(withMap(side({ vurgu: [7] })).ok, false, "a highlight on a line of the scene");
    assert.equal(withMap({ ...map, oklar: [{ noktalar: front, stil: "cizgi" as never }] }).ok, false);
    assert.equal(withMap({ ...map, kusatma_hatlari: [{ noktalar: [[22, 40]], satir: 0 }] }).ok, false, "a siege line needs two points");
    // The normalizer drops the writer's usual slips instead of spending a repair round.
    const draft = normalizeDraft({ ...ep, sahneler: [{ ...ep.sahneler[0]!, harita: side({ yerler: [{ satir: 0, kume: [22, 40], hatlar: 2, bozgun: true }] }), satirlar: four }] }, []);
    assert.equal(validateEpisode(draft.value).ok, true, JSON.stringify(validateEpisode(draft.value).errors.slice(0, 2)));
  });

  await scenario("O19 pictures of the moment and the photo documentary after DFT Tarih: further pictures over their lines (film too), a photo scene that is pictures end to end with headline strips, designed pictures labelled, validated", () => {
    // Further pictures over their lines, never overlapping, film kept as film.
    const lines = [0, 1, 2].map((i) => ({ start: i * 4, end: i * 4 + 3.5 }));
    const lineAt = (i: number) => lines[i];
    const local = (s: number) => Math.round(s * 30);
    const own: V3Insert[] = [{ src: "bg/a.jpg", start: 60, end: 160, kenBurns: { fromZoom: 1, toZoom: 1.1, fromX: 0, toX: 0 } }];
    const merged = withPictures(own, [{ satir: 1, src: "bg/b.png", caption: "designed" }, { satir: 2, src: "bg/c-film.mp4", video: true }, { satir: 9, src: "bg/x.png" }], lineAt, local, 400, 30, 6);
    assert.deepEqual(merged.map((w) => [w.src, w.start, w.end, w.video]), [["bg/a.jpg", 60, 126, undefined], ["bg/b.png", 126, 233, undefined], ["bg/c-film.mp4", 246, 353, true]], "the earlier cutaway gives way, a missing line is dropped");
    // A photo scene: its own picture from the start, each further one until the next, the last to the end.
    const seq = photoSequence({ src: "bg/own.jpg", caption: "Baghdad, 1990" }, [{ satir: 2, src: "bg/p2.jpg" }, { satir: 1, src: "bg/p1.jpg" }], lineAt, local, 400, 30);
    assert.deepEqual(seq.map((w) => [w.src, w.start, w.end]), [["bg/own.jpg", 0, 117], ["bg/p1.jpg", 117, 237], ["bg/p2.jpg", 237, 400]]);
    assert.ok(seq[0]!.kenBurns.toZoom > seq[0]!.kenBurns.fromZoom && seq[1]!.kenBurns.toZoom < seq[1]!.kenBurns.fromZoom, "pictures in a row drift in turn");
    // The director: a photo scene puts no one on stage, its strips come with their lines.
    const ep = sampleEpisode();
    const narrate = (metin: string, serit?: string) => ({ karakter: "anlatici", metin, duygu: "notr" as const, kaynak: ["tdv-rumeli"], ...(serit ? { serit } : {}) });
    const photoScene: Episode["sahneler"][number] = { ...ep.sahneler[0]!, id: "f1", kip: "fotograf", sahne_duzeni: undefined, satirlar: [narrate("August 1990.", "Kuwait's waters are heating up"), narrate("The tanks roll south."), narrate("The world watches.", "The West takes sides")], gorseller: [{ satir: 1, en: "Iraqi tanks Kuwait 1990", film: true }] };
    const episode: Episode = { ...ep, donem: "1990", sahneler: [photoScene] };
    assert.equal(validateEpisode(episode).ok, true, JSON.stringify(validateEpisode(episode).errors.slice(0, 3)));
    const tl = buildTimeline(episode, [[fakeAudio(3), fakeAudio(3), fakeAudio(3)]]);
    const plan = buildRenderPlan({ episode, timeline: tl, cast: toRenderCast(ep.oyuncu_kadrosu, "kukla"), accessories: [], backgrounds: [{ src: "bg/fotograf-zemin.png", kind: "archival" }], inserts: [{ src: "bg/f1-donem.jpg" }], pictures: [[{ satir: 1, src: "bg/f1-g1-film.mp4", video: true }]], fps: 30, width: 1920, height: 1080, showCaptions: false });
    const shot = plan.shots.find((s) => s.id === "f1")!;
    assert.deepEqual([shot.performers.length, shot.inserts!.length, shot.inserts![1]!.video, shot.inserts![1]!.end, shot.strips!.map((s) => s.text)], [0, 2, true, shot.duration, ["Kuwait's waters are heating up", "The West takes sides"]]);
    assert.ok(pictureShares(plan).gorsel > 0.9, "a photo scene counts as pictures");
    assert.equal(stageEmptyScenes(episode).fixes.length, 0, "no stand-in actor on a photo scene");
    // Validation: no character speaks in a photo scene, no photo mode on a map, a picture needs its line and search.
    const v = (s: object) => validateEpisode({ ...episode, sahneler: [{ ...photoScene, ...s }] } as never);
    assert.equal(v({ satirlar: [...photoScene.satirlar, { karakter: "mehmed", metin: "Hi.", duygu: "notr" }] }).ok, false);
    assert.equal(v({ harita: { merkez: [44, 30], genislik_km: 900 } }).ok, false);
    assert.equal(v({ gorseller: [{ satir: 5, en: "x" }] }).ok, false);
    assert.equal(v({ gorseller: [{ satir: 0 }] }).ok, false);
    assert.equal(v({ satirlar: [narrate("Long.", "x".repeat(71))] }).ok, false, "a strip is a headline");
    // The designed picture's prompt: a period painting, never photo-real, never text.
    const d = momentDesign(momentText(undefined, "Siege of Troy", "The Greeks hide in the horse."), { donem: "MÖ 1180" });
    assert.ok(/oil painting/.test(d.prompt) && /photorealistic/.test(d.negative) && /text/.test(d.negative) && /church/.test(d.negative) && d.prompt.includes("Siege of Troy"));
    assert.equal(momentText("Achilles drags Hector's body", "x", "y"), "Achilles drags Hector's body");
    assert.deepEqual([maxDesignedPictures(90), maxDesignedPictures(1200)], [4, 20]);
  });

  await scenario("O21 the first AYAS trial (23 Oct 2026): a Turkish battle name means the battle Turkish books mean; a battle told with no close map is asked for one", () => {
    const prompt = topicPrompt("Kosava savaşı", "konunun geçtiği dönem");
    assert.ok(prompt.includes('"Kosova Savaşı" (or "Kosava") is the Battle of Kosovo of 1389') && prompt.includes("Choose a modern conflict only when"));
    const ep = sampleEpisode();
    const narrate = (metin: string) => ({ karakter: "anlatici", metin, duygu: "notr" as const });
    const still: Episode["sahneler"][number] = { ...ep.sahneler[0]!, id: "m1", mekan: "Map: the Balkans", harita: { merkez: [21, 42.6], genislik_km: 900, bolgeler: [{ ad: "Serbia", renk: "#c0392b", noktalar: [[20, 42], [22, 42], [22, 44], [20, 44]], satir: 1 }] }, satirlar: [narrate("June 1389."), narrate("The Battle of Kosovo begins."), narrate("The Serbian line is routed.")] };
    assert.ok(mapProblems({ ...ep, sahneler: [still] }).some((p) => p.includes("no close battle map shows it")), "a battle told on a regional map only");
    const close: Episode["sahneler"][number] = { ...still, id: "m2", harita: { merkez: [21.1, 42.7], genislik_km: 20, birlikler: [{ taraf: "Ottomans", renk: "#3fae3a", amblem: "hilal", sayi: 6, tur: "piyade", yerler: [{ satir: 0, cephe: [[21.05, 42.65], [21.05, 42.75]] }, { satir: 2, cephe: [[21.1, 42.65], [21.1, 42.75]] }] }, { taraf: "Serbs", renk: "#c0392b", amblem: "kartal", sayi: 6, tur: "piyade", yerler: [{ satir: 0, cephe: [[21.15, 42.65], [21.15, 42.75]] }, { satir: 2, cephe: [[21.12, 42.65], [21.12, 42.75]], kayip: 3 }] }] } };
    assert.ok(!mapProblems({ ...ep, sahneler: [still, close] }).some((p) => p.includes("no close battle map")), "a close map with the armies is enough");
    assert.ok(!mapProblems({ ...ep, sahneler: [{ ...still, satirlar: [narrate("The Serbs and the Ottomans trade."), narrate("Caravans come and go.")] }] }).some((p) => p.includes("close battle map")), "no battle, no close map asked");
  });

  await scenario("O22 PC health beyond the card (owner, 23 Oct 2026): a nearly full disk stops, short RAM or a throttling processor rests, low disks warn", async () => {
    const ok = { gpuC: 60, cpu: { performance: 145, load: 80 }, freeRamGb: 12, disks: [{ path: "D:", freeGb: 600 }, { path: "C:", freeGb: 240 }] };
    assert.deepEqual(healthVerdict(ok), { warnings: [] });
    assert.ok(healthVerdict({ ...ok, disks: [{ path: "D:", freeGb: 8 }] }).stop?.includes("D: sürücüsünde 8 GB boş"));
    assert.deepEqual(healthVerdict({ ...ok, disks: [{ path: "C:", freeGb: 20 }] }).warnings, ["C: sürücüsünde yalnız 20 GB boş"]);
    assert.ok(healthVerdict({ ...ok, freeRamGb: 2 }).wait?.startsWith("RAM 2 GB"));
    assert.ok(healthVerdict({ ...ok, cpu: { performance: 60, load: 95 } }).wait?.includes("işlemci yavaşlıyor"));
    assert.equal(cpuThrottled({ performance: 60, load: 20 }), false, "an idle processor at a low clock is resting, not throttling");
    assert.equal(cpuThrottled(undefined), false, "an unreadable processor never blocks");
    assert.equal(healthLine(ok), "GPU 60 °C · işlemci hız %145 yük %80 · RAM 12 GB boş · D: 600 GB boş · C: 240 GB boş");
    // The waiting: RAM first freed (Ollama unloaded), then fit; a full disk throws V3_DISK_LOW.
    let freed = 0;
    const lines: string[] = [];
    const h = await waitForPcHealth([os.tmpdir()], (s) => lines.push(s), { free: async () => void freed++, sleepMs: 1 });
    assert.ok(h.freeRamGb >= 0 && h.disks.length === 1 && freed <= 1);
  });

  await scenario("O23 costume fittings (the first AYAS trial: 16 puppets in one row, every head crop cut at the collar): at most three a still, 640 px cells", () => {
    assert.equal(STILL_ROW_MAX, 3);
    assert.deepEqual(rowCells(3), { cell: 640, centres: [320, 960, 1600] });
    assert.deepEqual(rowCells(1), { cell: 1920, centres: [960] });
    // Sixteen parts are fitted in six stills, never a 120 px cell again.
    const rows = Array.from({ length: Math.ceil(16 / STILL_ROW_MAX) }, (_, r) => Math.min(STILL_ROW_MAX, 16 - r * STILL_ROW_MAX));
    assert.deepEqual(rows, [3, 3, 3, 3, 3, 1]);
    assert.ok(rows.every((n) => rowCells(n).cell >= 640));
  });

  await scenario("O24 portraits of medieval people (Kosovo 1389 trial): a known later portrait is taken when none from their lifetime passes; a rate-limited preview tries other widths", () => {
    const v = (puan: number, donem: number | undefined, extra: object = {}) => ({ title: `p${puan}-${donem}`, puan, donem, gosterilen: "", sorun: "", tur: "eser" as const, ...extra });
    const murad = [v(7, 4), v(0, 0, { tur: "harita" }), v(9, 2), v(10, 1, { modern: true })];
    assert.equal(traditionalPortrait(murad, 1389)?.title, "p9-2", "Veronese's Murad I: subject 9, the only later portrait the judge is sure of");
    assert.equal(traditionalPortrait(murad, 1914), undefined, "after 1500 a lifetime likeness is expected");
    assert.equal(traditionalPortrait([v(7, 2), v(9, 1, { okunamadi: true })], 1389), undefined, "not sure enough, or unreadable");
    assert.equal(traditionalPortrait([v(9, 3, { tur: "fotograf" })], -44), undefined, "a photograph of a statue's copy is not a portrait");
    assert.deepEqual(previewUrls("https://upload.wikimedia.org/x/thumb/a/ab/F.jpg/500px-F.jpg"), ["https://upload.wikimedia.org/x/thumb/a/ab/F.jpg/500px-F.jpg", "https://upload.wikimedia.org/x/thumb/a/ab/F.jpg/330px-F.jpg", "https://upload.wikimedia.org/x/thumb/a/ab/F.jpg/250px-F.jpg", "https://upload.wikimedia.org/x/thumb/a/ab/F.jpg/960px-F.jpg", "https://upload.wikimedia.org/x/thumb/a/ab/F.jpg/640px-F.jpg"]);
    assert.deepEqual(previewUrls("https://images.metmuseum.org/a.jpg"), ["https://images.metmuseum.org/a.jpg"]);
  });

  await scenario("O20 format after DFT Tarih: 25–45 minute episodes, a series whose next episode knows what was told, the series on the cover, the chapter card as a parchment that stays a little longer", async () => {
    const ep = sampleEpisode();
    assert.equal(validateEpisode({ ...ep, hedef_sure_sn: 1800 }).ok, true, "30 minutes");
    assert.equal(validateEpisode({ ...ep, hedef_sure_sn: 1801 }).ok, false, "no 45-minute episodes for now");
    assert.equal(validateEpisode({ ...ep, hedef_sure_sn: 90 }).ok, true, "a 90-second trial");
    assert.equal(validateEpisode({ ...ep, dizi: { ad: "Fatih", no: 6 } }).ok, true);
    assert.equal(validateEpisode({ ...ep, dizi: { ad: "Fatih", no: 0 } }).ok, false);
    // The series file: episodes in order, a remake replaces its own number, the brief has only the earlier ones.
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "v3-dizi-"));
    try {
      const chapter = (metin: string): Episode["sahneler"][number] => ({ ...ep.sahneler[0]!, yazi_karti: [{ metin, alt_metin: "Chapter 1", stil: "bolum" }] });
      await recordEpisode(root, "Fatih", { no: 2, konu: "Rumelihisarı", baslik: "The Throat Cutter", ozet: episodeSummary({ konu: "Rumelihisarı", sahneler: [chapter("A fortress in 139 days"), chapter("The toll")] }) });
      await recordEpisode(root, "Fatih", { no: 1, konu: "The young sultan", baslik: "A Boy on the Throne", ozet: "first" });
      await recordEpisode(root, "Fatih", { no: 1, konu: "The young sultan", baslik: "A Boy on the Throne (remake)", ozet: "again" });
      const record = await loadSeries(root, "Fatih");
      assert.deepEqual(record.bolumler.map((b) => [b.no, b.baslik]), [[1, "A Boy on the Throne (remake)"], [2, "The Throat Cutter"]]);
      assert.equal(record.bolumler[1]!.ozet, "Rumelihisarı: A fortress in 139 days → The toll");
      const brief = seriesBrief(record, 3);
      assert.deepEqual([brief.no, brief.onceki.map((b) => b.no)], [3, [1, 2]]);
      assert.ok(seriesText(brief).includes('episode 3 of the series "Fatih"') && seriesText(brief).includes("The Throat Cutter") && seriesText(seriesBrief(record, 1)).includes("first episode"));
      assert.equal(seriesLabel({ ad: "Fatih", no: 6 }), "Fatih 06");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
    // The cover carries the series; a chapter card holds 3 s.
    const withCard: Episode = { ...ep, dizi: { ad: "Fatih", no: 6 }, sahneler: [{ ...ep.sahneler[0]!, yazi_karti: [{ metin: "The Red Apple", alt_metin: "Chapter 3", stil: "bolum" }] }] };
    const tl = buildTimeline(withCard, [ep.sahneler[0]!.satirlar.map(() => fakeAudio(2.5))], { ...DEFAULT_TIMELINE, introS: 3.5 });
    const plan = buildRenderPlan({ episode: withCard, timeline: tl, cast: toRenderCast(ep.oyuncu_kadrosu, "kukla"), accessories: [], backgrounds: [{ src: "bg/a.png", kind: "set" }], fps: 30, width: 1920, height: 1080, showCaptions: false });
    assert.equal(plan.shots[0]!.titleCards[0]!.subtext, "Fatih 06 · 1452");
    const card = plan.shots[1]!.titleCards.find((c) => c.style === "bolum")!;
    assert.equal(card.end - card.start, 90);
    // An order can be a series episode: the producer gets the flags.
    const cmd = productionCommand("R", { id: "x", konu: "Fall of Constantinople", donem: "1453", sure: "40dk", dil: "en", ton: "epik", kaynak: "owner", olusturuldu: "", durum: "bekliyor", dizi: { ad: "Fatih", no: 6 } }, "out", "openai");
    assert.deepEqual(cmd.args.slice(cmd.args.indexOf("--dizi"), cmd.args.indexOf("--dizi") + 4), ["--dizi", "Fatih", "--dizi-no", "6"]);
  });

  await scenario("O9 vehicles on the map: a ship looks like its period's, only what the period had, routes and fire timed by their lines", () => {
    assert.deepEqual([shipLook(-480), shipLook(1453), shipLook(1571), shipLook(1805), shipLook(1916), shipLook(undefined)], ["kadirga", "kadirga", "kadirga", "yelkenli", "gemi", "gemi"]);
    const land = [[[[15, 35], [30, 35], [30, 45], [15, 45], [15, 35]]]];
    const map: SceneMap = {
      merkez: [22, 40],
      genislik_km: 1200,
      araclar: [
        { tur: "gemi", renk: "#c0392b", sayi: 9, konum: [20, 39], satir: 0, yol: [[22, 39.5]], yol_satir: 1, bitis_satir: 3 },
        { tur: "top", renk: "#c0392b", sayi: 2, konum: [21, 40], satir: 1, hedef: [22, 40], ates_satir: 2 },
      ],
    };
    const geo = buildGeoMap(map, { land, lakes: [], rivers: [], countries: new Map() } as never, 1920, 1080, (i) => (i ?? 0) * 100, { year: 1453 });
    const [fleet, guns] = geo.vehicles!;
    assert.deepEqual([fleet!.kind, fleet!.count, fleet!.start, fleet!.moveStart, fleet!.end, fleet!.path.length], ["kadirga", 6, 0, 100, 300, 2], "1453's fleet is galleys, at most six drawn");
    assert.deepEqual([guns!.kind, guns!.start, guns!.fireStart, guns!.moveStart], ["top", 100, 200, undefined]);
    assert.ok(guns!.target!.x > guns!.path[0]!.x, "the target east of the guns");
    // Validation: a tank in 1453 is no history; the period's own vehicles pass.
    const ep = { ...sampleEpisode(), donem: "1453" };
    const withMap = (h: unknown, donem = "1453") => validateEpisode({ ...ep, donem, sahneler: [{ ...ep.sahneler[0]!, harita: h }] } as never);
    assert.equal(withMap(map).ok, false, "at most six travel together");
    const six: SceneMap = { ...map, araclar: map.araclar!.map((a) => ({ ...a, sayi: Math.min(6, a.sayi ?? 1) })) };
    assert.equal(withMap(six).ok, true, JSON.stringify(withMap(six).errors.slice(0, 2)));
    const tank = withMap({ ...map, araclar: [{ tur: "tank", renk: "#c0392b", konum: [21, 40], satir: 0 }] });
    assert.deepEqual(tank.errors.map((e) => e.code), ["HARITA_ARAC_DONEM"]);
    assert.equal(withMap({ ...map, araclar: [{ tur: "tank", renk: "#c0392b", konum: [21, 40], satir: 0 }] }, "1916–1918").ok, true, "tanks from the Somme on");
    assert.equal(withMap({ ...map, araclar: [{ tur: "top", renk: "#c0392b", konum: [21, 40], satir: 0 }] }, "MÖ 49").ok, false, "no cannon at the Rubicon");
    assert.equal(withMap({ ...map, araclar: [{ tur: "fil", renk: "#c0392b", konum: [21, 40], satir: 0 }] }, "MÖ 218").ok, true, "Hannibal's elephants");
    assert.equal(withMap({ ...map, araclar: [{ tur: "gemi", renk: "#c0392b", konum: [21, 40] }] }).ok, false, "a vehicle needs its line");
    assert.equal(withMap({ ...map, araclar: [{ tur: "araba", renk: "#c0392b", konum: [21, 40], satir: 0 }] }).ok, false, "a kind from the list");
    // Losses (the Belgrade trial: the broken flotilla): lost one by one at the tokens' pace, the group's last first.
    const sinking = buildGeoMap({ ...map, araclar: [{ tur: "gemi", renk: "#c0392b", sayi: 4, konum: [20, 39], satir: 0, kayip: 2, kayip_satir: 2 }, { tur: "top", renk: "#c0392b", sayi: 2, konum: [21, 40], satir: 0, kayip: 5, kayip_satir: 1 }] }, { land, lakes: [], rivers: [], countries: new Map() } as never, 1920, 1080, (i) => (i ?? 0) * 100, { year: 1456 });
    assert.deepEqual([sinking.vehicles![0]!.lossStart, sinking.vehicles![0]!.losses], [200, [2.4, 3.4]]);
    assert.deepEqual(sinking.vehicles![1]!.losses, [2.4, 3.4], "no more lost than there are");
    assert.equal(withMap({ ...six, araclar: [{ tur: "gemi", renk: "#c0392b", konum: [21, 40], satir: 0, kayip: 1, kayip_satir: 0 }] }).ok, true);
    assert.equal(withMap({ ...six, araclar: [{ tur: "gemi", renk: "#c0392b", konum: [21, 40], satir: 0, kayip: 1 }] }).ok, false, "a loss needs its line");
  });

  await scenario("O7 the living map (owner, 22 Oct 2026): a conquest sweeps from where the army came, the old owner's name goes as the front passes, armies march, lines glow, the camera follows a march", () => {
    // Four provinces in a row from west to east (1° each, centres 20.5…23.5), all in the conquered land.
    const sq = (x: number, y: number, w: number) => [x, y, x + w, y, x + w, y + w, x, y + w];
    const unit = (name: string, x: number) => ({ name, rings: [sq(x, 2000, 50)], box: { west: x * ADMIN_QUANT_DEG, east: (x + 50) * ADMIN_QUANT_DEG, south: 40, north: 41 }, centre: [(x + 25) * ADMIN_QUANT_DEG, 40.5] as const });
    const units = [unit("p1", 1000), unit("p2", 1050), unit("p3", 1100), unit("p4", 1150)];
    const land = [[[[15, 35], [30, 35], [30, 45], [15, 45], [15, 35]]]];
    const all: [number, number][] = [[19.9, 39.9], [24.1, 39.9], [24.1, 41.1], [19.9, 41.1]];
    const map: SceneMap = {
      merkez: [22, 40.5],
      genislik_km: 1200,
      bolgeler: [
        { ad: "Senate", renk: "#3f6fb5", noktalar: all, etiket_konum: [23.5, 40.5], satir: 0 },
        { ad: "Caesar", renk: "#c0392b", noktalar: all, yayilma: { satir: 1, kaynak: [20, 40.5] } },
      ],
      ordular: [{ ad: "Caesar", konum: [20, 40.5], renk: "#c0392b", yol: [[22, 40.5], [24, 40.5]], yol_satir: 1 }],
      cizgiler: [{ ad: "Rubicon", noktalar: [[20.2, 40], [20.2, 41]], satir: 0 }],
    };
    const geo = buildGeoMap(map, { land, lakes: [], rivers: [], countries: new Map(), admin: units } as never, 1920, 1080, (i) => (i ?? 0) * 100, { relief: "bg/zemin.jpg" });
    const caesar = geo.territories.find((t) => t.spread)!;
    assert.equal(caesar.start, 100, "the sweep starts with its line");
    const delays = caesar.spread!.map((b) => b.delay);
    assert.equal(delays.length, 4, "one band per distance step here");
    assert.ok(delays[0] === 0 && delays[3] === 1 && delays.every((d, i) => i === 0 || d > delays[i - 1]!), `nearest province first, the farthest last: ${delays}`);
    assert.equal(caesar.sweepScale, undefined, "the march reaches past the last province: the front keeps the army's own pace");
    const shortMarch = buildGeoMap({ ...map, ordular: [{ ...map.ordular![0]!, yol: [[21, 40.5]] }] }, { land, lakes: [], rivers: [], countries: new Map(), admin: units } as never, 1920, 1080, (i) => (i ?? 0) * 100, { relief: "bg/zemin.jpg" });
    assert.equal(shortMarch.territories.find((t) => t.spread)!.sweepScale, 2.2, "land far beyond a short march falls after the army arrives (capped)");
    const senate = geo.territories.find((t) => t.label === "Senate")!;
    assert.deepEqual(senate.covered, { start: 100, delay: 1 }, "its name (in the easternmost province) goes when the front reaches it");
    assert.equal(geo.armies[0]!.path!.length, 3);
    assert.equal(geo.armies[0]!.moveStart, 100);
    assert.equal(geo.lines![0]!.label, "Rubicon");
    // A second region under a state's name (its conquest) carries no second name.
    const twice = buildGeoMap({ ...map, bolgeler: [{ ad: "Caesar", renk: "#c0392b", noktalar: all }, { ad: "Caesar", renk: "#c0392b", noktalar: [[25, 40], [26, 40], [26, 41]] }] }, { land, lakes: [], rivers: [], countries: new Map() } as never, 1920, 1080, () => 0, { relief: "bg/zemin.jpg" });
    assert.deepEqual(twice.territories.filter((t) => t.label).map((t) => t.label), ["Caesar"]);
    // Validation of the new fields.
    const ep = sampleEpisode();
    const withMap = (h: unknown) => validateEpisode({ ...ep, sahneler: [{ ...ep.sahneler[0]!, harita: h }] } as never);
    assert.equal(withMap(map).ok, true, JSON.stringify(withMap(map).errors.slice(0, 2)));
    assert.equal(withMap({ ...map, cizgiler: [{ ad: "x", noktalar: [[1, 1]] }] }).ok, false, "a line needs two points");
    assert.equal(withMap({ ...map, ordular: [{ ...map.ordular![0]!, yol_satir: 9 }] }).ok, false, "a march's line must exist");
    assert.equal(withMap({ ...map, bolgeler: [{ ...map.bolgeler![1]!, yayilma: { kaynak: [20, 40.5] } }] }).ok, false, "a sweep needs its line");
    // The camera: Pompey's flight far from where it looks is followed; a march already in view is not.
    const pompey: SceneMap = { merkez: [13.4, 43.6], genislik_km: 545, kamera: [{ satir: 0, merkez: [13.4, 43.6], genislik_km: 545 }], rozetler: [{ karakter: "pompey", konum: [12.5, 41.9], yol: [[17.94, 40.63]], yol_satir: 1 }] };
    const followed = zoomOnShortRoutes(pompey);
    assert.equal(followed.zoomed, 1);
    assert.equal(followed.map.kamera![1]!.satir, 1);
    const inView: SceneMap = { merkez: [12.5, 43], genislik_km: 1300, ordular: [{ ad: "a", konum: [9.2, 44.5], renk: "#c0392b", yol: [[15.8, 41.4]], yol_satir: 0 }] };
    assert.equal(zoomOnShortRoutes(inView).zoomed, 0, "a ~620 km march across the middle of a 1300 km map is seen as it is");
    const small: SceneMap = { ...inView, ordular: [{ ad: "a", konum: [12.2, 44.4], renk: "#c0392b", yol: [[13.84, 42.12]], yol_satir: 0 }] };
    assert.equal(zoomOnShortRoutes(small).zoomed, 1, "a 300 km march on a 1300 km map: the camera moves in to follow it");
  });

  await scenario("O5 places checked against Wikipedia, maps across the Pacific, a city named by its battle once", async () => {
    // A far-off city moves to Wikipedia's place and takes the badge and route points on it along; a near one stays;
    // a failed lookup is reported, never taken for confirmed.
    const wiki: Record<string, { title: string; lon: number; lat: number }[]> = {
      Persepolis: [{ title: "Persepolis", lon: 52.89, lat: 29.935 }],
      Athens: [{ title: "Athens", lon: 23.727, lat: 37.984 }, { title: "Athens, Georgia", lon: -83.38, lat: 33.95 }],
      "Battle of Thermopylae": [{ title: "Battle of Thermopylae", lon: 22.536, lat: 38.796 }],
    };
    const lookup = async (q: string) => {
      if (q === "Sardis") throw new Error("offline");
      return wiki[q] ?? [];
    };
    const map: SceneMap = {
      merkez: [38, 35], genislik_km: 4000,
      sehirler: [{ ad: "Persepolis", konum: [45, 35] }, { ad: "Athens", konum: [23.75, 38.0] }, { ad: "Sardis", konum: [28.04, 38.49] }],
      savaslar: [{ ad: "Thermopylae 480 BC", konum: [24.5, 40.2] }],
      rozetler: [{ karakter: "xerxes", konum: [45, 35], yol: [[40, 37], [45, 35]] }],
    };
    const r = await checkMapPlaces("s1", map, lookup);
    assert.deepEqual(r.fixes.map((x) => [x.ad, x.to, x.kaynak]), [["Persepolis", [52.89, 29.935], "Wikipedia: Persepolis"], ["Thermopylae 480 BC", [22.536, 38.796], "Wikipedia: Battle of Thermopylae"]]);
    assert.deepEqual(r.map.sehirler!.find((c) => c.ad === "Athens")!.konum, [23.75, 38.0], "Athens was right (and never Athens, Georgia)");
    assert.deepEqual(r.map.rozetler![0]!.konum, [52.89, 29.935], "the badge on the old spot moved with the city");
    assert.deepEqual(r.map.rozetler![0]!.yol, [[40, 37], [52.89, 29.935]]);
    assert.deepEqual(r.unchecked, ["Sardis"]);
    assert.ok(distanceKm([28.98, 41.01], [29.06, 40.19]) > 80 && distanceKm([28.98, 41.01], [29.06, 40.19]) < 100, "Istanbul–Bursa ~91 km");
    assert.equal(decidePlace("Tokyo", [139.7, 35.7], [{ title: "Tokyo", lon: 139.69, lat: 35.69 }]), undefined, "within 40 km: kept");
    // Japan to Hawaii: the camera crosses the Pacific (Hawaii at 202°), not the world; the world runs past 180°.
    const pacific: SceneMap = { merkez: [172, 31], genislik_km: 8500, kamera: [{ satir: 0, merkez: [140, 37], genislik_km: 3200 }, { satir: 1, merkez: [-157.9, 21.6], genislik_km: 2000 }] };
    const world = mapWorld(pacific, 1920, 1080);
    assert.ok(world.bounds.west < 140 && world.bounds.east > 202 && world.bounds.east - world.bounds.west < 120, JSON.stringify(world.bounds));
    assert.equal(shiftFor({ lon0: 172 }, -157.9), 360);
    assert.equal(shiftFor({ lon0: 20 }, 28), 0, "a map away from 180° never shifts");
    const sea = [[[[100, 0], [180, 0], [180, 60], [100, 60], [100, 0]]], [[[-180, 0], [-120, 0], [-120, 60], [-180, 60], [-180, 0]]]];
    const geo = buildGeoMap({ ...pacific, sehirler: [{ ad: "Tokyo", konum: [139.69, 35.69] }, { ad: "Pearl Harbor", konum: [-157.95, 21.35] }], savaslar: [{ ad: "Pearl Harbor", konum: [-157.95, 21.35] }] }, { land: sea, lakes: [], rivers: [], countries: new Map() } as never, 1920, 1080, () => 0);
    assert.deepEqual(geo.cities.map((c) => c.label), ["Tokyo"], "Pearl Harbor is written once, by its battle");
    assert.ok(geo.battles![0]!.x > geo.cities[0]!.x, "Hawaii is drawn east of Tokyo across the Pacific");
    assert.ok((geo.land.match(/M/g) ?? []).length === 2 && !geo.land.includes("NaN"));
  });

  await scenario("P draft normaliser: narrator never visible, English garment names, made-up parts become orders", () => {
    const ep = sampleEpisode();
    const draft = JSON.parse(JSON.stringify(ep)) as { oyuncu_kadrosu: Record<string, unknown>[]; sahneler: Record<string, unknown>[] };
    draft.oyuncu_kadrosu[0] = { ...draft.oyuncu_kadrosu[0], gorunur: true, kostum: { giysi: "tunic" } };
    (draft.oyuncu_kadrosu[1]!.kostum as Record<string, unknown>).giysi = "Military Uniform";
    (draft.oyuncu_kadrosu[1]!.kostum as Record<string, unknown>).sakal = "sakal-koyu";
    (draft.oyuncu_kadrosu[2]!.kostum as Record<string, unknown>).bas = "none";
    (draft.oyuncu_kadrosu[2]!.kostum as Record<string, unknown>).el_on = "legionary-shield";
    draft.sahneler[0] = { ...draft.sahneler[0], sahne_duzeni: [{ karakter: "anlatici", x: 0.5 }, { karakter: "mehmed", x: 0.3 }] };
    const catalog = [{ pack: "ottoman-1453", title: "o", items: { head: ["padisah-kavugu"], beard: ["sakal-beyaz"] } }, { pack: "byzantine-1453", title: "b", items: { beard: ["sakal-koyu"] } }];
    const { value, fixes } = normalizeDraft(draft, catalog);
    const v = value as Episode;
    assert.equal(v.oyuncu_kadrosu[0]!.gorunur, false);
    assert.equal(v.oyuncu_kadrosu[0]!.kostum, undefined);
    assert.equal(v.oyuncu_kadrosu[1]!.kostum!.giysi, "uniforma");
    assert.equal(v.oyuncu_kadrosu[1]!.kostum!.sakal, "byzantine-1453/sakal-koyu");
    assert.equal(v.oyuncu_kadrosu[2]!.kostum!.bas, undefined);
    assert.equal(v.oyuncu_kadrosu[2]!.kostum!.el_on, "yeni:legionary shield");
    assert.deepEqual(v.sahneler[0]!.sahne_duzeni!.map((b) => b.karakter), ["mehmed"]);
    assert.ok(fixes.length >= 6);
    assert.equal(validateEpisode(value).ok, true, JSON.stringify(validateEpisode(value).errors.slice(0, 3)));
  });

  await scenario("P2 draft normaliser: emotions and gestures outside the rig's lists (the Rubicon's dropped length rounds) map to the nearest, never fail the script", () => {
    const ep = sampleEpisode();
    const draft = JSON.parse(JSON.stringify(ep)) as { sahneler: { satirlar: Record<string, unknown>[] }[] };
    const lines = draft.sahneler[0]!.satirlar;
    Object.assign(lines[0]!, { duygu: "amused", jest: "shrug" });
    Object.assign(lines[1]!, { duygu: "şaşkın", jest: "facepalm" });
    if (lines[2]) Object.assign(lines[2], { duygu: "wistful", jest: "dramatic flourish" });
    const { value, fixes } = normalizeDraft(draft, []);
    const v = value as Episode;
    assert.deepEqual([v.sahneler[0]!.satirlar[0]!.duygu, v.sahneler[0]!.satirlar[0]!.jest], ["mutlu", "omuz_silk"]);
    assert.deepEqual([v.sahneler[0]!.satirlar[1]!.duygu, v.sahneler[0]!.satirlar[1]!.jest], ["saskin", "yuz_avucla"]);
    if (lines[2]) assert.deepEqual([v.sahneler[0]!.satirlar[2]!.duygu, v.sahneler[0]!.satirlar[2]!.jest], ["notr", undefined], "unknown: neutral, gesture left out");
    assert.ok(fixes.some((f) => f.includes('"amused" → mutlu')));
    assert.equal(validateEpisode(value).ok, true, JSON.stringify(validateEpisode(value).errors.slice(0, 3)));
    const clean = normalizeDraft(JSON.parse(JSON.stringify(ep)), []);
    assert.ok(!clean.fixes.some((f) => /duygu|jest/.test(f)), "valid values are left alone");
  });

  await scenario("P3 costume review: the historian reads colours by name; a part set to null, or a hat left out when hair is given, is removed (the Rubicon's legionary and Cicero)", async () => {
    assert.equal(colourName("#7a64b8"), "purple", "the 13th Legionary's tunic");
    assert.equal(colourName("#b22222"), "red");
    assert.equal(colourName("#e8b23a"), "yellow/gold");
    assert.equal(colourName("#e8e8e8"), "white");
    assert.equal(colourName("#22406a"), "dark blue");
    assert.equal(colourName("purple"), "purple", "not a hex code: as it is");
    const ep = sampleEpisode();
    const prompts: string[] = [];
    const answer = JSON.stringify({
      sorunlar: [{ kim: "mehmed", sorun: "x" }, { kim: "halil", sorun: "y" }],
      duzeltmeler: [
        { kim: "mehmed", kostum: { ...castBase.kostum, renkler: { ...castBase.kostum.renkler, ana: "#b22222" }, bas: null } },
        { kim: "halil", kostum: { sac: { stil: "kisa", renk: "#333333" } } },
      ],
    });
    const model: AIProvider = {
      generate: async (p: string) => {
        prompts.push(p);
        return { content: answer, finishReason: "stop", refused: false, complete: true, truncated: false };
      },
    };
    const reviewed = await reviewCostumes(ep, [], { cacheDir: "", judge: model, budget: new V3Budget({ providers: { ollama: model } }), critic: { provider: "ollama" }, council: new CouncilLog(), log: () => {} });
    assert.match(prompts[0]!, /mehmed: ana #b3263a = red, ikincil #e8b23a = yellow\/gold/);
    assert.match(prompts[0]!, /purple was for emperors/);
    const [mehmed, halil] = [reviewed.oyuncu_kadrosu[1]!, reviewed.oyuncu_kadrosu[2]!];
    assert.equal(mehmed.kostum!.bas, undefined, '"bas": null removes the hat (it used to break the episode and the fix was dropped)');
    assert.equal(mehmed.kostum!.renkler.ana, "#b22222");
    assert.equal(halil.kostum!.bas, undefined, "hair given without a hat: the hat goes");
    assert.equal(halil.kostum!.sakal, "sakal-beyaz", "a part the correction does not name stays");
    assert.equal(validateEpisode(reviewed).ok, true);
  });

  await scenario("Q opening cover and closing subscribe card: everything shifts by the cover, the title shows on it, the last seconds carry the card", () => {
    const ep = sampleEpisode();
    const audio = [[fakeAudio(2.4), fakeAudio(1.5), fakeAudio(2), fakeAudio(1.8)]];
    const plain = buildTimeline(ep, audio);
    const tl = buildTimeline(ep, audio, { sceneLead: 0.3, sceneTail: 0.45, replyGap: 0.28, sameSpeakerGap: 0.16, introS: 3.5 });
    assert.equal(tl.intro, 3.5);
    assert.ok(Math.abs(tl.lines[0]!.start - (plain.lines[0]!.start + 3.5)) < 1e-9 && Math.abs(tl.duration - (plain.duration + 3.5)) < 1e-9);
    const plan = buildRenderPlan({ episode: ep, timeline: tl, cast: toRenderCast(ep.oyuncu_kadrosu, "kukla"), accessories: [], backgrounds: [{ src: "bg/a.png", kind: "set" }], inserts: [{ src: "bg/donem.jpg" }], language: "en", fps: 30, width: 1920, height: 1080, showCaptions: false });
    const [cover, scene] = plan.shots;
    assert.deepEqual([cover!.id, cover!.start, cover!.duration, cover!.background.src], ["kapak", 0, 105, "bg/donem.jpg"]);
    assert.deepEqual(cover!.titleCards.map((c) => [c.style, c.text, c.subtext]), [["kapak", "Test", "1452"]]);
    assert.equal(scene!.start, 105, "ilk sahne kapaktan sonra başlar");
    const card = scene!.titleCards.find((c) => c.style === "abone")!;
    assert.deepEqual([card.text, card.end, card.end - card.start], ["SUBSCRIBE", scene!.duration, Math.min(scene!.duration, 150)]);
    const noCover = buildRenderPlan({ episode: ep, timeline: plain, cast: [], accessories: [], backgrounds: [{ src: "bg/a.png", kind: "set" }], fps: 30, width: 1920, height: 1080, showCaptions: false });
    assert.equal(noCover.shots[0]!.id, ep.sahneler[0]!.id, "kapak yoksa ilk çekim sahnedir");
    assert.equal(noCover.shots[0]!.titleCards.find((c) => c.style === "abone")!.text, "ABONE OL");
  });

  await scenario("R map readability (owner review of the Rubicon map): no name twice, no army on a city, a lone character off the names", () => {
    const base = { land: "", lakes: "", rivers: "", territories: [], cities: [{ x: 960, y: 300, label: "Ariminum" }, { x: 960, y: 900, label: "Rome" }] };
    const m = declutterMap({ ...base, armies: [{ x: 961, y: 302, label: "Caesar", color: "#b8283a", start: 0 }], arrows: [{ points: [{ x: 900, y: 320 }, { x: 960, y: 900 }], color: "#b8283a", label: "CAESAR ", start: 0 }, { points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], color: "#000000", label: "Pompey", start: 0 }] }, 1080);
    assert.equal(m.arrows[0]!.label, undefined, "the arrow repeats the army's name: its label goes");
    assert.equal(m.arrows[1]!.label, "Pompey", "a different name stays");
    assert.ok(m.armies[0]!.x < 960 - 60 && m.armies[0]!.y === 300, `the army moves left of the city, whose name is on its right: ${JSON.stringify(m.armies[0])}`);
    const edge = declutterMap({ ...base, cities: [{ x: 40, y: 500, label: "Brundisium" }], armies: [{ x: 40, y: 500, label: "Pompey", color: "#2f6fb0", start: 0 }], arrows: [] }, 1080);
    assert.ok(edge.armies[0]!.x === 40 && edge.armies[0]!.y < 500, "no room on the left: the army goes above");
    const far = declutterMap({ ...base, armies: [{ x: 300, y: 300, label: "Caesar", color: "#b8283a", start: 0 }], arrows: [] }, 1080);
    assert.deepEqual(far.armies[0], { x: 300, y: 300, label: "Caesar", color: "#b8283a", start: 0 }, "an army away from cities stays");
    // The Rubicon map: Rome low in the middle of the frame; the lone character moves aside.
    assert.notEqual(mapStageX({ ...base, cities: [{ x: 960, y: 900, label: "Rome" }], armies: [], arrows: [] }, 1920, 1080), 0.5);
    assert.equal(mapStageX({ ...base, cities: [{ x: 960, y: 200, label: "Rome" }], armies: [], arrows: [] }, 1920, 1080), 0.5, "names high in the frame: the middle stays");
    const ep = sampleEpisode();
    const mapScene: Episode = { ...ep, sahneler: [{ ...ep.sahneler[0]!, harita: { merkez: [12.5, 43], genislik_km: 700, sehirler: [{ ad: "Rome", konum: [12.5, 42.2] }] }, satirlar: [ep.sahneler[0]!.satirlar[0]!, ep.sahneler[0]!.satirlar[1]!] }] };
    const square = [[[5, 35], [20, 35], [20, 50], [5, 50], [5, 35]] as const] as const;
    const data = { land: [square], lakes: [], rivers: [], countries: new Map() };
    const tl = buildTimeline(mapScene, [[fakeAudio(2), fakeAudio(1.5)]]);
    const plan = buildRenderPlan({ episode: mapScene, timeline: tl, cast: toRenderCast(mapScene.oyuncu_kadrosu, "kukla"), accessories: [], backgrounds: [{ src: "bg/harita-zemin.png", kind: "archival" }], mapData: data as never, fps: 30, width: 1920, height: 1080, showCaptions: false });
    const mehmed = plan.shots[0]!.performers.find((p) => p.castId === "mehmed")!;
    assert.notEqual(mehmed.x, 0.5, "the lone speaker on the map does not stand on Rome");
  });

  await scenario("S an empty narrated scene gets the lead as a silent actor, who acts the narration out; the QC measures empty stretches", () => {
    const ep = sampleEpisode();
    const outro = { ...ep.sahneler[0]!, id: "kapanis", satirlar: [{ karakter: "anlatici", metin: "Ve böylece her şey değişti.", duygu: "uzgun" as const, kaynak: ["tdv-rumeli"] }, { karakter: "anlatici", metin: "Abone olmayı unutmayın, bir dahaki sefere görüşürüz!", duygu: "mutlu" as const, kurgu: true }] };
    const withOutro: Episode = { ...ep, sahneler: [ep.sahneler[0]!, outro] };
    const { episode: staged, fixes } = stageEmptyScenes(withOutro);
    assert.deepEqual(staged.sahneler[1]!.sahne_duzeni, [{ karakter: "mehmed", x: 0.5 }], "the lead (most lines) stands in");
    assert.equal(fixes.length, 1);
    assert.equal(staged.sahneler[0], withOutro.sahneler[0], "a scene with someone on stage is untouched");
    assert.equal(stageEmptyScenes(staged).fixes.length, 0, "a second pass changes nothing");
    assert.ok(validateEpisode(staged).ok, JSON.stringify(validateEpisode(staged).errors));
    for (const keep of [{ harita: { merkez: [12, 43] as [number, number], genislik_km: 500 } }, { kalabalik: [{ ad: "halk", kostum_paketi: "ottoman-1453", kostum: castBase.kostum, sayi: 6, duzen: "sira" as const }] }]) {
      assert.equal(stageEmptyScenes({ ...withOutro, sahneler: [ep.sahneler[0]!, { ...outro, ...keep }] }).fixes.length, 0, "maps and crowd scenes are left alone");
    }
    const tl = buildTimeline(staged, [[fakeAudio(2.4), fakeAudio(1.5), fakeAudio(2), fakeAudio(1.8)], [fakeAudio(2.5), fakeAudio(3)]]);
    const input = { timeline: tl, cast: toRenderCast(staged.oyuncu_kadrosu, "kukla"), accessories: [], backgrounds: [{ src: "bg/a.png", kind: "set" as const }, { src: "bg/b.png", kind: "set" as const }], inserts: [undefined, { src: "bg/donem.jpg" }], fps: 30, width: 1920, height: 1080, showCaptions: false };
    const plan = buildRenderPlan({ ...input, episode: staged });
    const shot = plan.shots[1]!;
    const lead = shot.performers.find((p) => p.castId === "mehmed")!;
    assert.ok(lead, "the lead is on stage in the outro");
    assert.deepEqual(lead.gestures.map((g) => g.gesture), ["isaret_et", "el_salla"], "a gesture on the longer line, a wave on the episode's last");
    assert.ok(lead.faces.some((x) => x.emotion === "uzgun") && lead.faces.some((x) => x.emotion === "mutlu"), "faces follow the narration");
    assert.ok(shot.inserts!.length === 1 && shot.inserts![0]!.end - shot.inserts![0]!.start <= Math.round(MAX_INSERT_S * 30), "the period picture is a short cutaway");
    assert.ok(longestEmptyStretch(plan) <= MAX_INSERT_S + 0.01, `${longestEmptyStretch(plan)}`);
    // Before the fix: the outro was one picture with nobody, the whole scene long.
    const before = buildRenderPlan({ ...input, episode: withOutro, backgrounds: [{ src: "bg/a.png", kind: "set" }, { src: "bg/donem.jpg", kind: "archival" }], inserts: [undefined, undefined] });
    assert.ok(Math.abs(longestEmptyStretch(before) - before.shots[1]!.duration / 30) < 0.01, "an empty shot counts whole");
    assert.equal(before.shots[0]!.performers.length > 0 && before.shots[1]!.performers.length, 0);
    // The scene where someone speaks keeps its own acting.
    assert.ok(!plan.shots[0]!.performers.some((p) => p.gestures.some((g) => g.gesture === "el_salla")));
  });

  await scenario("O6 the first AYAS order's map: an atlas year the atlas lacks moves to the nearest snapshot with the state; a route too short to see brings the camera in", async () => {
    // Snapshots: -100 has the Roman Republic, -1 (closer to -49) has only the Roman Empire.
    const atlas = new Map<number, Set<string>>([[-100, new Set(["roman republic", "parthia"])], [-1, new Set(["roman empire", "parthia"])]]);
    const has = async (y: number, name: string) => atlas.get(y)?.has(name) ?? false;
    assert.equal(await atlasYear(-49, "Roman Republic", has), -100, "the nearest snapshot that has the state");
    assert.equal(await atlasYear(-49, "Parthia", has), -1, "both have it: the closer one");
    assert.equal(await atlasYear(-49, "Atlantis", has), -1, "none has it: the nearest snapshot, so the other states keep their colours");
    assert.equal(await atlasYear(-100, "Atlantis", async () => false), -100, "a snapshot year stays");
    const rubicon: SceneMap = { merkez: [12.5, 44], genislik_km: 1800, bolgeler: [{ ad: "Roman Republic", renk: "#e8b23a", tarihi: { ad: "Roman Republic", yil: -49 }, satir: 1 }], oklar: [{ noktalar: [[12.3, 44], [12.6, 44.1]], renk: "#b3263a", etiket: "Caesar", satir: 2 }] };
    const ep = sampleEpisode();
    const withMap: Episode = { ...ep, sahneler: [{ ...ep.sahneler[0]!, harita: rubicon }, ...ep.sahneler.slice(1)] };
    const fixed = await withAtlasYears(withMap, has);
    assert.deepEqual(fixed.moved, [{ sahne: ep.sahneler[0]!.id, ad: "Roman Republic", from: -49, to: -100 }]);
    assert.equal(fixed.episode.sahneler[0]!.harita!.bolgeler![0]!.tarihi!.yil, -100);
    assert.equal(withMap.sahneler[0]!.harita!.bolgeler![0]!.tarihi!.yil, -49, "the input is not changed");
    assert.equal((await withAtlasYears(fixed.episode, has)).moved.length, 0, "a second run changes nothing");
    // The 25 km crossing on 1,800 km: the camera moves in on the arrow's middle with the arrow's line.
    const z = zoomOnShortRoutes(rubicon);
    assert.equal(z.zoomed, 1);
    const key = z.map.kamera![0]!;
    assert.equal(key.satir, 2);
    assert.ok(Math.abs(key.merkez[0] - 12.45) < 1e-9 && Math.abs(key.merkez[1] - 44.05) < 1e-9);
    assert.equal(key.genislik_km, MIN_ZOOM_KM, "a 25 km arrow fills a third of a city-wide view");
    assert.equal(zoomOnShortRoutes(z.map).zoomed, 0, "once the camera is in, the arrow is long enough");
    const long = zoomOnShortRoutes({ ...rubicon, oklar: [{ noktalar: [[12.3, 44], [12.5, 41.9]], satir: 1 }] });
    assert.equal(long.zoomed, 0, "Ariminum to Rome (~230 km) is seen on 1,800 km");
    const own = zoomOnShortRoutes({ ...rubicon, kamera: [{ satir: 2, merkez: [12, 44], genislik_km: 900 }] });
    assert.equal(own.zoomed, 0, "the writer's own camera move on that line is kept");
    const longer = zoomOnShortRoutes({ ...rubicon, oklar: [{ noktalar: [[12.0, 44.3], [12.6, 44.1], [12.5, 43.6]], satir: 0 }] });
    assert.ok(longer.map.kamera![0]!.genislik_km > MIN_ZOOM_KM && distanceKm([12.0, 44.3], [12.6, 44.1]) > 40);
    assert.deepEqual(withRouteZoom(withMap).scenes, [ep.sahneler[0]!.id]);
  });

  console.log(`V3 episode/director smoke: PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
