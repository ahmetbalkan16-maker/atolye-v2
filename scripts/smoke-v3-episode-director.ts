/**
 * V3 smoke: Turkish speech text, episode validator, costume SVG filter, timeline and director.
 * Pure (no FFmpeg/GPU/network). Run: npx tsx scripts/smoke-v3-episode-director.ts
 */
import assert from "node:assert/strict";
import path from "node:path";
import { crowdCast, toRenderCast } from "../src/lib/v3/costumes/CastMapper";
import { CostumePackError, costumesRoot, loadAccessories, svgBody } from "../src/lib/v3/costumes/CostumePackLoader";
import { autoSlots, BODY_HALF, beats, buildRenderPlan, captionPages, cleanFrame, fillTempo, insertWindows, longestEmptyStretch, mapShotCamera, MAX_INSERT_S, normalizeCamera, placeCrowd, stageEmptyScenes } from "../src/lib/v3/director/Director";
import type { Episode, SceneMap } from "../src/lib/v3/episode/EpisodeTypes";
import { validateEpisode } from "../src/lib/v3/episode/EpisodeValidator";
import { backgroundStates, buildGeoMap, clipRing, declutterMap, labelLines, labelPoint, mapStageX, mapView, mapWorld, placeStateLabels, project, shiftFor, STATE_COLOURS } from "../src/lib/v3/maps/MapBuilder";
import { reliefSize } from "../src/lib/v3/maps/Relief";
import { atlasYear, isPolity, nearestSnapshots, snapshotFile, withAtlasYears } from "../src/lib/v3/maps/HistoricalBorders";
import { MIN_ZOOM_KM, withRouteZoom, zoomOnShortRoutes } from "../src/lib/v3/maps/RouteZoom";
import { ADMIN_QUANT_DEG, assignUnits, dissolve } from "../src/lib/v3/maps/AdminUnits";
import { checkMapPlaces, decidePlace, distanceKm } from "../src/lib/v3/maps/PlaceCheck";
import type { AIProvider } from "../src/lib/ai/providers/AIProvider";
import { CouncilLog } from "../src/lib/v3/council/Council";
import { normalizeDraft } from "../src/lib/v3/script/DraftNormalizer";
import { V3Budget } from "../src/lib/v3/script/V3Budget";
import { colourName, reviewCostumes } from "../src/lib/v3/wardrobe/WardrobeBrain";
import { buildTimeline, type LineAudio } from "../src/lib/v3/timeline/Timeline";
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
    const ep = sampleEpisode();
    const bad = validateEpisode({ ...ep, sahneler: [{ ...ep.sahneler[0]!, harita: { merkez: [200, 43], genislik_km: 5, bolgeler: [{ ad: "x", renk: "#ffffff" }] } }] });
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
    const bad = validateEpisode({ ...ep, sahneler: [{ ...ep.sahneler[0]!, harita: { merkez: [12.5, 43], genislik_km: 600, kamera: [{ satir: 99, merkez: [20, 41], genislik_km: 5 }], rozetler: [{ karakter: "yok", konum: [29, 40] }] } }] });
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
