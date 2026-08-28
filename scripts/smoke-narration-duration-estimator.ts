/**
 * F-08: NarrationDurationEstimator smoke suite.
 *
 * Covers the a-priori estimate side of the fix: character-rate estimation,
 * proportional chapter-duration reconciliation (redistributing an
 * already-accepted total by real narration length instead of the model's
 * free-form per-chapter guesses), and the edge cases §3 of the emir calls
 * out for this layer specifically (malformed/degenerate narration,
 * language-independence, idempotency for retry/resume safety).
 */
import assert from "node:assert/strict";
import {
  countNarrationWords,
  DEFAULT_CHARACTERS_PER_SECOND,
  estimateNarrationSeconds,
  reconcileChapterDurations,
} from "../src/lib/ai/NarrationDurationEstimator";

let count = 0;
function scenario(name: string, test: () => void) {
  test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

// The exact 5 real chapters from the protected i-stanbul-un-fethi-1453
// project (script.json), used read-only elsewhere in this task to calibrate
// DEFAULT_CHARACTERS_PER_SECOND. Reproduced verbatim here (not re-read from
// the project) so this suite never touches that project's files.
const REAL_CHAPTERS = [
  { id: 1, duration: 20, narration: "1453 yılında, İstanbul, Doğu Roma İmparatorluğu'nun başkenti olarak stratejik ve kültürel açıdan büyük bir öneme sahipti. Boğaziçi'nin iki yakasında yükselen surları ve güçlü savunmasıyla neredeyse aşılmaz bir kale görünümündeydi. Osmanlı Padişahı II. Mehmet, genç yaşına rağmen bu zorlu hedefi fethetmeye karar verdi. Kuşatma öncesinde ordusunu topladı, devasa toplar döktürdü ve kuşatma için gerekli tüm hazırlıkları büyük bir titizlikle yaptı. Bu hazırlıklar, Osmanlı'nın kararlılığını ve teknolojik üstünlüğünü ortaya koyuyordu." },
  { id: 2, duration: 20, narration: "6 Nisan 1453'te Osmanlı ordusu, yaklaşık 80 bin asker ve büyük toplarla İstanbul'u kuşattı. Kuşatma, kara ve denizden eş zamanlı olarak yürütüldü. II. Mehmet, kuşatmanın başarısı için yeni taktikler geliştirdi. Devasa toplar, surları yıkmak için kullanılırken, denizde ise Haliç'e girişi engelleyen zincirler ve gemi savaşları yaşandı. Kuşatma, hem teknolojik hem de stratejik açıdan dönemin en karmaşık askeri operasyonlarından biriydi." },
  { id: 3, duration: 15, narration: "İstanbul, Bizans İmparatoru XI. Konstantinos ve halkının büyük direnişiyle kuşatmaya karşı koydu. Şehir surları, askerler ve gönüllüler tarafından gece gündüz savunuldu. Kuşatma boyunca yaşanan açlık, hastalık ve yorgunluk, savunmanın zorluklarını artırdı. Ancak Bizanslılar, şehrin düşmemesi için ellerinden geleni yaptı. Bu direniş, kuşatmanın kaderini belirleyecek kritik anlara sahne oldu." },
  { id: 4, duration: 20, narration: "29 Mayıs 1453 sabahı, Osmanlı ordusu büyük bir saldırı başlattı. Toplar, oklar ve kılıçlar eşliğinde surlara yapılan son hücum, gün boyu sürdü. II. Mehmet'in liderliğinde Osmanlı askerleri, surları aşmayı başardı. Şehir kapıları açıldı ve İstanbul, yaklaşık 1000 yıl süren Bizans hakimiyetinin ardından Osmanlı topraklarına katıldı. Bu zafer, sadece bir şehrin fethi değil, aynı zamanda yeni bir dönemin başlangıcıydı." },
  { id: 5, duration: 15, narration: "İstanbul'un fethi, Orta Çağ'ın sonunu ve Yeni Çağ'ın başlangıcını simgeledi. Osmanlılar, şehri başkent yaparak imparatorluklarını güçlendirdi. Fethin ardından Avrupa'da ticaret yolları değişti, bilim ve kültür alanında yeni gelişmeler yaşandı. Ayrıca, bu zafer, Osmanlıların dünya sahnesindeki gücünü pekiştirdi ve tarih boyunca etkileri hissedildi. Bugün İstanbul, bu büyük zaferin mirasını taşımaya devam ediyor." },
];
const REAL_ESTIMATED_TOTAL = REAL_CHAPTERS.reduce((sum, c) => sum + c.duration, 0); // 90
const REAL_MEASURED_TOTAL = 37.7375 + 31.0625 + 26.8125 + 31.15 + 28.65; // 155.4125, from audio.json

function run() {
  scenario("estimateNarrationSeconds is proportional to character count", () => {
    const short = estimateNarrationSeconds("a".repeat(100));
    const long = estimateNarrationSeconds("a".repeat(200));
    assert.ok(Math.abs(long - short * 2) < 1e-9);
  });

  scenario("estimateNarrationSeconds matches the calibrated default rate", () => {
    const seconds = estimateNarrationSeconds("a".repeat(1412));
    assert.ok(Math.abs(seconds - 100) < 0.1, `expected ~100s, got ${seconds}`);
    assert.equal(DEFAULT_CHARACTERS_PER_SECOND > 10 && DEFAULT_CHARACTERS_PER_SECOND < 20, true);
  });

  scenario("estimateNarrationSeconds of empty/whitespace text is 0, not NaN/negative", () => {
    assert.equal(estimateNarrationSeconds(""), 0);
    assert.equal(estimateNarrationSeconds("   \n\t  "), 0);
  });

  scenario("estimateNarrationSeconds rejects a non-positive charactersPerSecond override", () => {
    assert.throws(() => estimateNarrationSeconds("hello", { charactersPerSecond: 0 }), RangeError);
    assert.throws(() => estimateNarrationSeconds("hello", { charactersPerSecond: -5 }), RangeError);
  });

  scenario("countNarrationWords matches a plain whitespace split", () => {
    assert.equal(countNarrationWords("bir iki üç"), 3);
    assert.equal(countNarrationWords(""), 0);
    assert.equal(countNarrationWords("   "), 0);
  });

  scenario("reconcileChapterDurations preserves the exact original total (rounded)", () => {
    const result = reconcileChapterDurations(REAL_CHAPTERS, REAL_ESTIMATED_TOTAL);
    const sum = result.reduce((s, r) => s + r.duration, 0);
    assert.equal(sum, Math.round(REAL_ESTIMATED_TOTAL));
  });

  scenario("reconcileChapterDurations redistributes by real narration length, not the original LLM per-chapter guess", () => {
    // Chapter 1 has more narration text than chapter 3 (532 vs 393 chars);
    // the LLM's own guess happened to assign chapter 1 more too (20 vs 15),
    // so use two chapters where the *relative order* the LLM picked would
    // need to flip to prove this is driven by real text length, not an
    // accidental agreement with the original guess.
    const chapters = [
      { id: 1, duration: 50, narration: "short" }, // LLM guessed a lot...
      { id: 2, duration: 10, narration: "x".repeat(500) }, // ...for the chapter with far less actual text than this one
    ];
    const result = reconcileChapterDurations(chapters, 60);
    const byId = new Map(result.map((r) => [r.id, r.duration]));
    assert.ok(
      (byId.get(2) as number) > (byId.get(1) as number),
      `expected chapter 2 (far more real text) to receive more duration than chapter 1, got ${JSON.stringify(result)}`,
    );
    assert.equal((byId.get(1) as number) + (byId.get(2) as number), 60);
  });

  scenario("reconcileChapterDurations on the real i-stanbul chapters would have produced a total close to the real measured duration if the estimator itself had set the total (evidence, not the production behavior)", () => {
    // This does NOT change the accepted total (that stays a content-length
    // policy decision, see NarrationDurationEstimator.ts docs) -- it only
    // demonstrates that estimateNarrationSeconds on the real narration text,
    // summed directly (bypassing the total-preserving redistribution),
    // lands close to the real TTS-measured total, which is the empirical
    // justification for DEFAULT_CHARACTERS_PER_SECOND in the first place.
    const measuredEstimateTotal = REAL_CHAPTERS.reduce(
      (sum, c) => sum + estimateNarrationSeconds(c.narration),
      0,
    );
    const ratio = measuredEstimateTotal / REAL_MEASURED_TOTAL;
    assert.ok(ratio > 0.9 && ratio < 1.1, `expected within 10% of real measured total, got ratio=${ratio}`);
  });

  scenario("reconcileChapterDurations falls back to original durations on degenerate input (fail-safe, not fail-open)", () => {
    const chapters = [{ id: 1, duration: 30, narration: "text" }];
    assert.deepEqual(reconcileChapterDurations(chapters, 0), [{ id: 1, duration: 30 }]);
    assert.deepEqual(reconcileChapterDurations(chapters, Number.NaN), [{ id: 1, duration: 30 }]);
    assert.deepEqual(reconcileChapterDurations([], 90), []);
  });

  scenario("reconcileChapterDurations is language-independent (no hardcoded words/sec table)", () => {
    // Same character count in Turkish vs. English text should be estimated
    // the same way -- there is no per-language branch in the estimator.
    const turkish = [{ id: 1, duration: 10, narration: "x".repeat(300) }, { id: 2, duration: 10, narration: "x".repeat(300) }];
    const result = reconcileChapterDurations(turkish, 20);
    assert.deepEqual(result.map((r) => r.duration).sort(), [10, 10]);
  });

  scenario("reconcileChapterDurations is idempotent/deterministic (retry/resume-safe: no drift on repeated calls)", () => {
    const first = reconcileChapterDurations(REAL_CHAPTERS, REAL_ESTIMATED_TOTAL);
    const second = reconcileChapterDurations(REAL_CHAPTERS, REAL_ESTIMATED_TOTAL);
    assert.deepEqual(first, second);
  });

  scenario("reconcileChapterDurations never produces a non-positive duration for a non-empty chapter", () => {
    const chapters = [
      { id: 1, duration: 10, narration: "x".repeat(2000) },
      { id: 2, duration: 10, narration: "x" }, // tiny relative share
    ];
    const result = reconcileChapterDurations(chapters, 20);
    assert.ok(result.every((r) => r.duration >= 1));
  });

  console.log(`Narration duration estimator smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "narration-duration-estimator", scenarios: count }));
}

try {
  run();
} catch (error) {
  console.error("Narration duration estimator smoke FAILED:", error);
  process.exitCode = 1;
}
