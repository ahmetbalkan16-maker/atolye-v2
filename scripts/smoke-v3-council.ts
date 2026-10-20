/**
 * V3 smoke: the production council (findings, debates, report to AYAS's inbox) and the repair brain (known remedies,
 * the allowed-action whitelist, safe defaults). Fake providers only (no network, no GPU).
 * Run: npx tsx scripts/smoke-v3-council.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AIProvider, AIProviderResult } from "../src/lib/ai/providers/AIProvider";
import { CouncilLog, councilMarkdown, readInbox, writeCouncilReport } from "../src/lib/v3/council/Council";
import { qualityPrompt } from "../src/lib/v3/council/QualityBrain";
import { decideRepair, describeRepair, knownRemedy, parseRepair, type RepairContext } from "../src/lib/v3/council/RepairBrain";

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

class FakeModel implements AIProvider {
  calls = 0;
  constructor(private readonly answer: string | Error) {}
  async generate(): Promise<AIProviderResult> {
    this.calls++;
    if (this.answer instanceof Error) throw this.answer;
    return { content: this.answer, finishReason: "stop", refused: false, complete: true, truncated: false };
  }
}

const ctx = (error: string, extra: Partial<RepairContext> = {}): RepairContext => ({ step: "gorsel", error, attempt: 1, optional: false, env: {}, ...extra });

async function main() {
  await scenario("A known failures get their remedy without a model", () => {
    assert.equal(knownRemedy(ctx("COMMONS_DOWNLOAD_429"))?.tur, "bekle_tekrar");
    assert.equal(knownRemedy(ctx("RuntimeError: CUDA out of memory. Tried to allocate"))?.tur, "gpu_bosalt");
    assert.equal(knownRemedy(ctx("V3_GPU_TOO_HOT: GPU 80 °C"))?.tur, "bekle_tekrar");
    const cut = knownRemedy(ctx("V3_SCRIPT_INVALID: 3 onarımdan sonra: V3_SCRIPT_JSON_CUT: JSON yarıda", { step: "senaryo", env: { ATOLYE_V3_WRITER_MAX_TOKENS: "9640" } }));
    assert.deepEqual(cut && cut.tur === "ayar" ? [cut.anahtar, cut.deger] : [], ["ATOLYE_V3_WRITER_MAX_TOKENS", "14460"]);
    assert.equal(knownRemedy(ctx("V3_SCRIPT_JSON_CUT", { env: { ATOLYE_V3_WRITER_MAX_TOKENS: "16000" } }))?.tur, "dur");
    const render = knownRemedy(ctx("Error: Target closed", { step: "render" }));
    assert.deepEqual(render && render.tur === "ayar" ? [render.anahtar, render.deger] : [], ["ATOLYE_V3_RENDER_CONCURRENCY", "2"]);
    assert.equal(knownRemedy(ctx("Error: Target closed", { step: "render", env: { ATOLYE_V3_RENDER_CONCURRENCY: "1" } }))?.tur, "dur");
    assert.equal(knownRemedy(ctx("ENOSPC: no space left on device"))?.tur, "dur");
    assert.equal(knownRemedy(ctx("V3_BUDGET_EXCEEDED: parca-1", { step: "gardirop", optional: true }))?.tur, "atla");
    assert.equal(knownRemedy(ctx("TypeError: cannot read properties of undefined")), undefined);
  });

  await scenario("B an unknown failure goes to the model, which may only pick an allowed action", async () => {
    const c = ctx("TypeError: x is undefined", { step: "portre", optional: true });
    const pick = await decideRepair(c, new FakeModel('{"tur": "atla", "neden": "portre isteğe bağlı"}'));
    assert.deepEqual([pick.tur, pick.kaynak], ["atla", "model"]);
    assert.equal(parseRepair('{"tur": "ayar", "anahtar": "PATH", "deger": "C:/evil", "neden": "x"}', c), undefined, "izinli olmayan ayar reddedilir");
    assert.equal(parseRepair('{"tur": "kod_yaz", "neden": "x"}', c), undefined);
    assert.equal(parseRepair('{"tur": "atla"}', ctx("x", { optional: false })), undefined, "zorunlu adım atlanamaz");
    assert.equal(parseRepair('{"tur": "bekle_tekrar", "saniye": 9999}', c)?.tur, "bekle_tekrar");
    const capped = parseRepair('{"tur": "bekle_tekrar", "saniye": 9999}', c);
    assert.equal(capped && capped.tur === "bekle_tekrar" ? capped.saniye : -1, 300);
  });

  await scenario("C no usable answer: an optional step is skipped, a required one stops — never a guess", async () => {
    assert.deepEqual([(await decideRepair(ctx("weird", { optional: true }), new FakeModel("bilmiyorum"))).tur], ["atla"]);
    const stop = await decideRepair(ctx("weird"), new FakeModel(new Error("ollama kapalı")));
    assert.deepEqual([stop.tur, stop.kaynak], ["dur", "varsayilan"]);
    assert.match(describeRepair(stop), /üretim durdu/);
  });

  await scenario("D the council report: findings and debates reach AYAS's inbox (append-only), the markdown separates measures from developments", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "v3-kurul-"));
    const log = new CouncilLog();
    log.find({ beyin: "ortam", onem: "uyari", baslik: "dönem görseli bulunamadı", ayrinti: "s1", tur: "veri", yer: "s1" });
    log.find({ beyin: "kostum", onem: "eksik", baslik: "parça tasarlanamadı", ayrinti: "scutum", tur: "veri" });
    log.debate("kostum", "parça: scutum", [{ rol: "Tarihçi", metin: "kenar bronz olmalı" }, { rol: "Şef", metin: "revize" }]);
    log.debate("kostum", "boş", []);
    const plan = { ozet: "İyi.", onlemler: [{ baslik: "Arama adları", neden: "görsel yok", beyin: "ortam" as const }], gelistirmeler: [{ baslik: "Kalkan çizimi", neden: "tekrar eden ret", beyin: "kostum" as const }] };
    const file = await writeCouncilReport({ workDir: root, workRoot: root, bolum: "Test", log, plan });
    await writeCouncilReport({ workDir: root, workRoot: root, bolum: "Test 2", log });
    const report = JSON.parse(readFileSync(file, "utf8")) as { bulgular: unknown[]; tartismalar: unknown[] };
    assert.equal(report.bulgular.length, 2);
    assert.equal(report.tartismalar.length, 1, "boş tartışma kaydedilmez");
    const inbox = (await readInbox(root)) as { bolum: string; eksik: number; gelistirmeler: number }[];
    assert.deepEqual(inbox.map((l) => [l.bolum, l.eksik]), [["Test", 1], ["Test 2", 1]]);
    assert.equal(inbox[0]!.gelistirmeler, 1);
    const md = councilMarkdown("Test", log, plan);
    assert.ok(md.includes("Önlemler (Atölye kendisi alır, kod değişmez)") && md.includes("Geliştirme önerileri (owner onayı gerekir)") && md.includes("**Tarihçi:** kenar bronz olmalı"));
    assert.ok(qualityPrompt("49 BC").includes("49 BC"));
  });

  console.log(`V3 council smoke: PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
