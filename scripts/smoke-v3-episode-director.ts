/**
 * V3 smoke: Turkish speech text, episode validator, costume SVG filter, timeline and director.
 * Pure (no FFmpeg/GPU/network). Run: npx tsx scripts/smoke-v3-episode-director.ts
 */
import assert from "node:assert/strict";
import path from "node:path";
import { crowdCast, toRenderCast } from "../src/lib/v3/costumes/CastMapper";
import { CostumePackError, costumesRoot, loadAccessories, svgBody } from "../src/lib/v3/costumes/CostumePackLoader";
import { autoSlots, BODY_HALF, beats, buildRenderPlan, captionPages, cleanFrame, fillTempo, insertWindows, normalizeCamera, placeCrowd } from "../src/lib/v3/director/Director";
import type { Episode, SceneMap } from "../src/lib/v3/episode/EpisodeTypes";
import { validateEpisode } from "../src/lib/v3/episode/EpisodeValidator";
import { buildGeoMap, clipRing, mapView, project } from "../src/lib/v3/maps/MapBuilder";
import { normalizeDraft } from "../src/lib/v3/script/DraftNormalizer";
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
    const ep = sampleEpisode();
    const tl = buildTimeline(ep, [[fakeAudio(2.4), fakeAudio(1.5), fakeAudio(2), fakeAudio(1.8)]]);
    const plan = buildRenderPlan({ episode: ep, timeline: tl, cast: toRenderCast(ep.oyuncu_kadrosu, "kukla"), accessories: [], backgrounds: [{ src: "bg/a.png", kind: "set" }], inserts: [{ src: "bg/donem.jpg", caption: "Buondelmonti, 1430" }], fps, width: 1920, height: 1080, showCaptions: false });
    const ins = plan.shots[0]!.inserts!;
    assert.equal(ins.length, 1);
    assert.equal(ins[0]!.start, 0);
    assert.equal(ins[0]!.caption, "Buondelmonti, 1430");
    assert.ok(ins[0]!.end <= Math.round(tl.lines[1]!.start * fps), "karakter konuşmadan önce sete dönülür");
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

  console.log(`V3 episode/director smoke: PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
