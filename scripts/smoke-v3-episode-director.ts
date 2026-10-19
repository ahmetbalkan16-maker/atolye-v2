/**
 * V3 smoke: Turkish speech text, episode validator, costume SVG filter, timeline and director.
 * Pure (no FFmpeg/GPU/network). Run: npx tsx scripts/smoke-v3-episode-director.ts
 */
import assert from "node:assert/strict";
import path from "node:path";
import { toRenderCast } from "../src/lib/v3/costumes/CastMapper";
import { CostumePackError, costumesRoot, loadAccessories, svgBody } from "../src/lib/v3/costumes/CostumePackLoader";
import { autoSlots, buildRenderPlan, captionPages, normalizeCamera } from "../src/lib/v3/director/Director";
import type { Episode } from "../src/lib/v3/episode/EpisodeTypes";
import { validateEpisode } from "../src/lib/v3/episode/EpisodeValidator";
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

  console.log(`V3 episode/director smoke: PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
