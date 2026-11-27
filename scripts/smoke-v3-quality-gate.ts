/**
 * The Video Quality Gate (owner, 27 Nov 2026, the permanent quality standard): QC rows filed by stage and area, scores
 * from measures only, blockers for historical and technical errors, the middle and the ending measured, subtitles read
 * for a phone, text under the Shorts player found, and a blocked video kept from YouTube unless the director overrides.
 * Pure, no network, no model.
 */
import assert from "node:assert/strict";
import { detectAyasVideoIntent } from "../src/lib/ayas/AyasVideoOrder";
import { shortsUiCover, shortsUiFaults } from "../src/lib/v3/council/LayoutCheck";
import { closingTempoGaps, openingBeats, withOpeningBeats } from "../src/lib/v3/director/Director";
import type { V3RenderPlan } from "../src/lib/v3/render/RenderPlanTypes";
import { closingHoldS, GATE_TARGET, gateMarkdown, longestGapIn, parseFreezes, parseMomentary, parseSrt, speechMusicBalance, voiceOverBed, qcChecks, qcRowCheck, scoreGate, subtitleFaults, type GateCheck } from "../src/lib/v3/council/QualityGate";
import type { ProductionOrder } from "../src/lib/v3/orders/ProductionOrders";
import { approvePublish } from "../src/lib/v3/publish/PublishApproval";
import { mixGraph } from "../src/lib/v3/mix/Mixer";

let scenarios = 0;
function scenario(name: string, fn: () => void): void {
  fn();
  scenarios++;
  console.log(`  ✓ ${name}`);
}

const ok = (area: GateCheck["area"], text = area, extra: Partial<GateCheck> = {}): GateCheck => ({ stage: "kurgu", area, ok: true, text, ...extra });

scenario("every area passing is ready to publish at 10/10", () => {
  const r = scoreGate((["kanca", "hikaye", "dogruluk", "gorsel", "harita", "tempo", "ses", "altyazi", "tutma", "final"] as const).map((a) => ok(a)));
  assert.equal(r.verdict, "yayina_hazir", "assert.equal(r.verdict, \"yayina_hazir\")");
  assert.equal(r.total, 10, "assert.equal(r.total, 10)");
  assert.deepEqual(r.weak, [], "assert.deepEqual(r.weak, [])");
});

scenario("a historical blocker stops publishing however good the total", () => {
  const r = scoreGate([...(["kanca", "hikaye", "gorsel", "harita", "tempo", "ses", "altyazi", "tutma", "final"] as const).map((a) => ok(a)), { stage: "senaryo", area: "dogruluk", ok: false, weight: 1, block: "tarih", text: "Tarih doğrulaması: okunamadı" }]);
  assert.ok(r.total >= 9.5, "assert.ok(r.total >= 9.5)");
  assert.equal(r.verdict, "engelli", "assert.equal(r.verdict, \"engelli\")");
  assert.match(r.blockers[0]!, /^TARİH: /);
  assert.match(gateMarkdown("T", r), /Yayını durduran hatalar/);
});

scenario("an area under target asks for improvement; unmeasured checks score nothing", () => {
  const r = scoreGate([ok("kanca"), { stage: "kurgu", area: "final", ok: false, weight: 3, text: "Kapanış duruşu 12.0 sn" }, { stage: "ses", area: "ses", ok: false, unmeasured: true, text: "ölçülmedi" }]);
  assert.equal(r.areas.find((a) => a.area === "final")!.score, 7, "assert.equal(r.areas.find((a) => a.area === \"final\")!.score, 7)");
  assert.equal(r.areas.find((a) => a.area === "ses")!.score, undefined, "assert.equal(r.areas.find((a) => a.area === \"ses\")!.score, undefined)");
  assert.equal(r.verdict, "iyilestirme_gerekli", "assert.equal(r.verdict, \"iyilestirme_gerekli\")");
  assert.deepEqual(r.weak, ["final"], "assert.deepEqual(r.weak, [\"final\"])");
  assert.ok(7 < GATE_TARGET, "assert.ok(7 < GATE_TARGET)");
});

scenario("QC rows are filed by their labels; a Short over its own target is a pacing fault, not a blocker (YouTube takes up to 180 s)", () => {
  const qc = [
    "- [x] Açılış sorusu: 0.2 sn'de anlatıcı soruyor",
    "- [ ] Tarih doğrulaması: hata, 0 düzeltme, 0 bildirim",
    "- [x] Ses seviyesi -14.1 LUFS",
    "- [ ] Süre 190.0 sn (Short: üst sınır 180 sn, en az 144 sn)",
    "- [x] Bambaşka yeni satır",
    "not a row",
  ].join("\n");
  const { checks, unknownRows } = qcChecks(qc, true);
  assert.equal(checks.length, 5, "assert.equal(checks.length, 5)");
  assert.equal(checks[0]!.area, "kanca", "assert.equal(checks[0]!.area, \"kanca\")");
  assert.equal(checks[1]!.block, "tarih", "assert.equal(checks[1]!.block, \"tarih\")");
  assert.equal(checks[3]!.block, undefined, "assert.equal(checks[3]!.block, undefined)");
  assert.equal(checks[3]!.area, "tempo", "assert.equal(checks[3]!.area, \"tempo\")");
  assert.deepEqual(unknownRows, ["Bambaşka yeni satır"], "assert.deepEqual(unknownRows, [\"Bambaşka yeni satır\"])");
  assert.equal(qcRowCheck("- [ ] Süre 700 sn (hedef 600 sn ±%10)", false)!.block, undefined, "assert.equal(qcRowCheck(\"- [ ] Süre 700 sn (hedef 600 sn ±%10)\", false)!.block, undefined)");
});

scenario("the middle's longest still stretch and the closing hold are measured from the events", () => {
  const events = [0, 1, 3, 5, 6, 20, 22, 48];
  const m = longestGapIn(events, 60);
  assert.equal(m.from, 22, "assert.equal(m.from, 22)");
  assert.equal(m.to, 42, "assert.equal(m.to, 42)");
  assert.equal(closingHoldS(events, 60), 12, "assert.equal(closingHoldS(events, 60), 12)");
  assert.equal(closingHoldS([], 10), 10, "assert.equal(closingHoldS([], 10), 10)");
});

scenario("subtitles: a phone-readable SRT passes, long/fast/overlapping cues fail", () => {
  const good = parseSrt("1\n00:00:00,000 --> 00:00:02,000\nWho blinks first?\n\n2\n00:00:02,100 --> 00:00:04,000\nThe night of the strikes.\n");
  assert.equal(good.length, 2, "assert.equal(good.length, 2)");
  assert.deepEqual(subtitleFaults(good, 5), [], "assert.deepEqual(subtitleFaults(good, 5), [])");
  const bad = parseSrt(`1\n00:00:00,000 --> 00:00:01,000\n${"x".repeat(90)}\n\n2\n00:00:00,500 --> 00:00:09,000\nlate\n`);
  const faults = subtitleFaults(bad, 5);
  assert.ok(faults.some((f) => /karakterden uzun/.test(f)), "assert.ok(faults.some((f) => /karakterden uzun/.test(f)))");
  assert.ok(faults.some((f) => /hızlı/.test(f)), "assert.ok(faults.some((f) => /hızlı/.test(f)))");
  assert.ok(faults.some((f) => /üstüne/.test(f)), "assert.ok(faults.some((f) => /üstüne/.test(f)))");
  assert.ok(faults.some((f) => /bitişinden sonra/.test(f)), "assert.ok(faults.some((f) => /bitişinden sonra/.test(f)))");
  assert.deepEqual(subtitleFaults([], 5), ["altyazı dosyası boş"], "assert.deepEqual(subtitleFaults([], 5), [\"altyazı dosyası boş\"])");
});

scenario("text under the Shorts player is found on a vertical frame only, and only when it lasts", () => {
  const bubble = { tur: "balon" as const, ad: "Trump", x: 200, y: 1600, w: 600, h: 200 };
  assert.equal(shortsUiCover(bubble, 1080, 1920), 1, "assert.equal(shortsUiCover(bubble, 1080, 1920), 1)");
  assert.equal(shortsUiCover({ ...bubble, y: 800 }, 1080, 1920), 0, "assert.equal(shortsUiCover({ ...bubble, y: 800 }, 1080, 1920), 0)");
  assert.equal(shortsUiCover(bubble, 1920, 1080), 0, "assert.equal(shortsUiCover(bubble, 1920, 1080), 0)");
  const frames = (n: number) => Array.from({ length: n }, (_, i) => ({ kare: i * 15, ogeler: [bubble] }));
  assert.equal(shortsUiFaults({ fps: 30, width: 1080, height: 1920, every: 15, kareler: frames(3) }).length, 1, "assert.equal(shortsUiFaults({ fps: 30, width: 1080, height: 1920, every: 15, kareler: frames(3) }).length, 1)");
  assert.equal(shortsUiFaults({ fps: 30, width: 1080, height: 1920, every: 15, kareler: frames(1) }).length, 0, "assert.equal(shortsUiFaults({ fps: 30, width: 1080, height: 1920, every: 15, kareler: frames(1) }).length, 0)");
  assert.equal(shortsUiFaults({ fps: 30, width: 1920, height: 1080, every: 15, kareler: frames(3) }).length, 0, "assert.equal(shortsUiFaults({ fps: 30, width: 1920, height: 1080, every: 15, kareler: frames(3) }).length, 0)");
});

const order = (extra: Partial<ProductionOrder> = {}): ProductionOrder => ({ id: "o1", konu: "Iran war night", donem: "2026", sure: "60sn", dil: "en", ton: "ciddi", kaynak: "ayas", olusturuldu: "2026-11-27T09:00:00Z", durum: "teslim", video: "D:/x/final.mp4", ...extra });

scenario("a blocked video is not approved for YouTube unless the director overrides; others are untouched", () => {
  const now = new Date("2026-11-27T12:00:00Z");
  const blocked = order({ kalite: { karar: "engelli", puan: 9.1, engeller: ["TARİH: Tarih doğrulaması: hata"], zayif: [] } });
  assert.throws(() => approvePublish(blocked, [], false, now), /YOUTUBE_QUALITY_BLOCKED: .*TARİH/);
  assert.equal(blocked.yayin, undefined, "assert.equal(blocked.yayin, undefined)");
  assert.equal(approvePublish(blocked, [], false, now, { zorla: true }).yayin?.durum, "onaylandi", "assert.equal(approvePublish(blocked, [], false, now, { zorla: true }).yayin?.durum, \"onaylandi\")");
  assert.equal(approvePublish(order({ kalite: { karar: "iyilestirme_gerekli", puan: 8.1, engeller: [], zayif: ["final"] } }), [], false, now).yayin?.durum, "onaylandi", "assert.equal(approvePublish(order({ kalite: { karar: \"iyilestirme_gerekli\", puan: 8.1, engeller: [], zayif: [\"final\"] } }), [], false, now).yayin?.durum, \"onaylandi\")");
  assert.equal(approvePublish(order(), [], true, now).yayin?.hemen, true, "assert.equal(approvePublish(order(), [], true, now).yayin?.hemen, true)");
});

scenario("AYAS hears the director's override in the chat", () => {
  const forced = detectAyasVideoIntent("Iran videosunu yine de yükle");
  assert.equal(forced?.kind, "publish", "assert.equal(forced?.kind, \"publish\")");
  assert.equal(forced?.kind === "publish" && forced.zorla, true, "assert.equal(forced?.kind === \"publish\" && forced.zorla, true)");
  assert.equal(forced?.kind === "publish" && forced.words, "ıran", "assert.equal(forced?.kind === \"publish\" && forced.words, \"ıran\")"); // Turkish lower-casing, as every chat topic is matched
  const plain = detectAyasVideoIntent("Iran videosunu yükle");
  assert.equal(plain?.kind === "publish" && plain.zorla, undefined, "assert.equal(plain?.kind === \"publish\" && plain.zorla, undefined)");
});

scenario("a still picture is read from freezedetect's log; one still at the end runs to the end", () => {
  const log = ["[freezedetect @ 0] lavfi.freezedetect.freeze_start: 10.5", "[freezedetect @ 0] lavfi.freezedetect.freeze_duration: 4.5", "[freezedetect @ 0] lavfi.freezedetect.freeze_end: 15", "[freezedetect @ 0] lavfi.freezedetect.freeze_start: 58"].join("\n");
  assert.deepEqual(parseFreezes(log, 64), [{ start: 10.5, end: 15 }, { start: 58, end: 64 }], "assert.deepEqual(parseFreezes(log, 64), [{ start: 10.5, end: 15 }, { start: 58, end: 64 }])");
  assert.deepEqual(parseFreezes("", 64), [], "assert.deepEqual(parseFreezes(\"\", 64), [])");
});

scenario("music against the narrator: speech louder than music-only moments, unmeasured without enough music-only time", () => {
  const log = Array.from({ length: 100 }, (_, i) => `[Parsed_ebur128_0 @ 0] t: ${(i / 10).toFixed(1)}  TARGET:-23 LUFS    M: ${i < 50 ? "-14.0" : "-24.0"} S: -20.0     I: -16.0 LUFS`).join("\n");
  const pts = parseMomentary(log);
  assert.equal(pts.length, 100, "assert.equal(pts.length, 100)");
  const b = speechMusicBalance(pts, [{ start: 0, end: 4.9 }]);
  assert.deepEqual(b && [b.speech, b.music, b.diff], [-14, -24, 10], "assert.deepEqual(b && [b.speech, b.music, b.diff], [-14, -24, 10])");
  assert.equal(speechMusicBalance(pts, [{ start: 0, end: 9.5 }]), undefined, "assert.equal(speechMusicBalance(pts, [{ start: 0, end: 9.5 }]), undefined)");
});

scenario("the closing tempo: a Short's last 10 s get a picture change at least every 3 s, the gate reports a held ending", () => {
  // From frame 300 of a 600-frame shot at 30 fps with no change: beats at 300, then every 2.5 s.
  assert.deepEqual(openingBeats([0], 600, 600, 30, 300), [300, 375, 450, 525], "assert.deepEqual(openingBeats([0], 600, 600, 30, 300), [300, 375, 450, 525])");
  assert.deepEqual(openingBeats([0], 600, 600, 30), openingBeats([0], 600, 600, 30, 0), "the opening is unchanged");
  const still = { fps: 30, width: 1920, height: 1080, shots: [{ id: "s5-payoff", start: 0, duration: 600, camera: [{ frame: 0, zoom: 1, cx: 0.5, cy: 0.5 }] }] } as unknown as V3RenderPlan;
  assert.deepEqual(closingTempoGaps(still), [{ from: 10, to: 20, shot: "s5-payoff" }], "assert.deepEqual(closingTempoGaps(still), [{ from: 10, to: 20, shot: \"s5-payoff\" }])");
  const cut = { ...still, shots: [{ ...still.shots[0]!, camera: withOpeningBeats(still.shots[0]!.camera, [], [], 600, 600, 30, undefined, 300) }] } as unknown as V3RenderPlan;
  assert.deepEqual(closingTempoGaps(cut), [], "the Director's closing beats close the held ending");
  assert.deepEqual(withOpeningBeats(still.shots[0]!.camera, [], [], 600, 600, 30, undefined, 600), still.shots[0]!.camera, "nothing before `from`");
});

scenario("the narrator over the music, from the mixer's stems: the dialogue-muted bed and the median gap where someone speaks", () => {
  const voice = Array.from({ length: 50 }, (_, i) => ({ t: i / 10, m: i < 40 ? -16 : -80 }));
  const quiet = voiceOverBed(voice, voice.map((p) => ({ t: p.t, m: -30 })));
  assert.deepEqual(quiet, { farkLu: 14, yakinPay: 0, konusmaSn: 4 }, "assert.deepEqual(quiet, { farkLu: 14, yakinPay: 0, konusmaSn: 4 })");
  const loud = voiceOverBed(voice, voice.map((p) => ({ t: p.t, m: -18 })));
  assert.equal(loud!.farkLu, 2, "assert.equal(loud!.farkLu, 2)");
  assert.equal(loud!.yakinPay, 1, "assert.equal(loud!.yakinPay, 1)");
  assert.equal(voiceOverBed(voice.slice(0, 5), []), undefined, "assert.equal(voiceOverBed(voice.slice(0, 5), []), undefined)");
  // The muted graph keeps every duck keyed by the voices and only silences them in the final sum.
  const g = { beds: ["[2:a]anull[m0]"], ambience: [], duration: 10 };
  const muted = mixGraph(g, { muteDialogue: true });
  assert.ok(muted.includes("[dlg]volume=0[dlgm]"), "assert.ok(muted.includes(\"[dlg]volume=0[dlgm]\"))");
  assert.ok(muted.at(-1)!.startsWith("[dlgm][ducked][fx]amix"), "assert.ok(muted.at(-1)!.startsWith(\"[dlgm][ducked][fx]amix\"))");
  assert.deepEqual(mixGraph(g).filter((c) => !c.includes("dlgm")), mixGraph(g), "the normal mix is unchanged");
});

console.log(`PASS (${scenarios} scenarios)`);
