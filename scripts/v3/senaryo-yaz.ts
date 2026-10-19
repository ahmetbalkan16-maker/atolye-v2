/**
 * Atölye V3 — senaryo motoru: konudan doğrulanmış episode.json.
 *
 *   npx tsx scripts/v3/senaryo-yaz.ts --konu "Rumeli Hisarı'nın inşası" --donem "1452, Osmanlı" --sure 90sn
 *        [--ton mizahi|ciddi|epik] [--dil tr|en] [--saglayici openai|ollama] [--kaynaklar <banka.json>] [--cikti <klasör>]
 *
 * Sağlayıcı ve modeller `.env.v3.local`'dan (ATOLYE_V3_SCRIPT_PROVIDER, ATOLYE_V3_WRITER_MODEL, ATOLYE_V3_CHECKER_MODEL);
 * varsayılan yerel Ollama. OpenAI çağrıları video başına 1 $ tavanla sınırlıdır; tavanı aşacak çağrı yapılmaz,
 * yerine yerel model yazar. Çıktılar: episode.json, dogrulama.json, maliyet.json, rapor.md.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveOllamaConfig } from "../../src/lib/ai/OllamaConfig";
import { OllamaProvider } from "../../src/lib/ai/providers/OllamaProvider";
import { OpenAIProvider } from "../../src/lib/ai/providers/OpenAIProvider";
import { costumesRoot, packCatalog } from "../../src/lib/v3/costumes/CostumePackLoader";
import { EPISODE_TONES, type EpisodeTone } from "../../src/lib/v3/episode/EpisodeTypes";
import { type ScriptOutcome, writeScript } from "../../src/lib/v3/script/ScriptEngine";
import type { ScriptBrief, ScriptLanguage, SourceBank } from "../../src/lib/v3/script/ScriptPrompts";
import { V3Budget, type V3ModelChoice } from "../../src/lib/v3/script/V3Budget";
import { resolveV3Paths, v3Secret } from "../../src/lib/v3/V3Paths";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** "90", "90sn", "8dk", "8dk30sn" → seconds. */
function seconds(text: string): number {
  const m = /^(?:(\d+)\s*dk)?\s*(?:(\d+)\s*(?:sn)?)?$/i.exec(text.trim());
  const total = m ? Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0) : NaN;
  if (!Number.isFinite(total) || total < 20 || total > 1800) throw new Error(`--sure 20 sn ile 30 dk arasında olmalı: ${text}`);
  return total;
}

function slug(text: string): string {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };
  return text.toLocaleLowerCase("tr-TR").replace(/[çğıöşüâîû]/g, (c) => map[c] ?? c).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "bolum";
}

function readEnvFile(file: string): Promise<Record<string, string>> {
  return fs.readFile(file, "utf8").then(
    (text) => Object.fromEntries(text.split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])),
    () => ({}),
  );
}

function report(brief: ScriptBrief, out: ScriptOutcome, budget: V3Budget, planned: V3ModelChoice): string {
  const m = out.validation.metrics;
  const rows = budget.ledger.map((e) => `| ${e.step} | ${e.provider}${e.provider === "openai" ? ` / ${e.model}` : ""}${e.fellBackFrom ? ` (yerine: ${e.fellBackFrom})` : ""} | ${e.promptTokens ?? "–"} / ${e.completionTokens ?? "–"} | $${e.costUsd.toFixed(4)} |`);
  const claims = out.factCheck.iddialar.map((c) => `- \`${c.sahne}#${c.satir}\` **${c.karar}** → ${c.sonuc ?? "–"}${c.gerekce ? ` — ${c.gerekce}` : ""}${c.kaynak_onerisi ? ` (önerilen kaynak, doğrulanmadı: ${c.kaynak_onerisi})` : ""}`);
  return `# Senaryo raporu — ${out.episode.baslik}

- Konu: ${brief.konu} · Dönem: ${brief.donem} · Hedef: ${brief.hedefSureSn} sn · Ton: ${brief.ton} · Dil: ${brief.dil}
- Yazan: ${out.writerUsed.provider}${out.writerUsed.model ? ` / ${out.writerUsed.model}` : ""}${out.writerUsed.provider !== planned.provider ? " (bütçe tavanı nedeniyle yerel modele düşüldü)" : ""}; onarım turu: ${out.repairs}
- Sahne: ${m.sceneCount} · satır: ${m.lineCount} · diyaloglu sahne: %${Math.round(m.dialogueSceneRatio * 100)} (hedef ≥%30) · ortalama ${m.averageWordsPerLine.toFixed(1)} kelime/satır (hedef ≤14) · kaynaksız anlatıcı iddiası: ${m.narratorClaimsWithoutSource}
- Sahne süreleri toplamı: ${out.episode.sahneler.reduce((s, x) => s + x.sure_hedef, 0)} sn · konuşulan kelime: ${out.spokenWords} / hedef ~${out.targetWords} (uzunluk turu: ${out.lengthRounds})
- Kaynak bankası: ${brief.kaynakBankasi ? `${brief.kaynakBankasi.kaynaklar.length} doğrulanmış kaynak, ${brief.kaynakBankasi.olgular.length} olgu — başka kaynak gösterilemez` : "YOK — kaynaklar modelin yazdığıdır, owner doğrulamalı"}

## Tarih doğrulama (${out.factCheck.durum === "tamam" ? `${out.factCheck.uygulanan} düzeltme uygulandı` : "YANIT OKUNAMADI — bölüm doğrulanmamış sayılır"})

${claims.length ? claims.join("\n") : "- Sorunlu satır bildirilmedi."}
${out.factCheck.genel_not ? `\nGenel not: ${out.factCheck.genel_not}\n` : ""}
## Doğrulayıcı uyarıları

${out.validation.warnings.length ? out.validation.warnings.map((w) => `- \`${w.path}\` ${w.code}: ${w.message}`).join("\n") : "- Yok."}

## Maliyet (tavan $${budget.capUsd.toFixed(2)})

| Adım | Sağlayıcı | Token (girdi / çıktı) | Maliyet |
| --- | --- | --- | --- |
${rows.join("\n")}
| **Toplam** | | | **$${budget.spentUsd.toFixed(4)}** |
`;
}

async function main() {
  const konu = arg("--konu");
  const donem = arg("--donem");
  if (!konu || !donem) throw new Error('Kullanım: --konu "…" --donem "…" [--sure 90sn] [--ton mizahi] [--dil tr]');
  const ton = (arg("--ton") ?? "mizahi") as EpisodeTone;
  if (!EPISODE_TONES.includes(ton)) throw new Error(`--ton şunlardan biri olmalı: ${EPISODE_TONES.join(", ")}`);
  const dil = (arg("--dil") ?? "tr") as ScriptLanguage;
  if (dil !== "tr" && dil !== "en") throw new Error("--dil tr ya da en olmalı");
  const bankFile = arg("--kaynaklar");
  const bank = bankFile ? (JSON.parse(await fs.readFile(bankFile, "utf8")) as SourceBank) : undefined;
  const brief: ScriptBrief = { konu, donem, hedefSureSn: seconds(arg("--sure") ?? "90"), ton, dil, ...(bank ? { kaynakBankasi: bank } : {}) };

  const paths = resolveV3Paths();
  const local = await readEnvFile(path.join(paths.repoRoot, ".env.v3.local"));
  const setting = (key: string, fallback: string) => process.env[key] || local[key] || fallback;
  const providerName = (arg("--saglayici") ?? setting("ATOLYE_V3_SCRIPT_PROVIDER", "ollama")) as "openai" | "ollama";
  if (providerName !== "openai" && providerName !== "ollama") throw new Error("--saglayici openai ya da ollama olmalı");

  // The OpenAI provider refuses to run unless activated explicitly; this run is that activation, for this process only.
  if (providerName === "openai") {
    const key = v3Secret("OPENAI_API_KEY", paths.repoRoot);
    if (!key) throw new Error("OPENAI_API_KEY bulunamadı: .env.v3.local içinde ATOLYE_V3_SECRETS_ENV'i ayarlayın");
    process.env.OPENAI_API_KEY = key;
    process.env.AI_PROVIDER = "openai";
  }
  const ollamaModel = setting("ATOLYE_V3_OLLAMA_MODEL", "gemma4:12b");
  // Measured on gemma4:12b (RTX A2000): with thinking on and the server's small default window the whole output
  // budget went to thinking and no JSON came back; thinking off + a 16k window + plain JSON mode wrote a valid
  // 90 s episode in ~70 s. The full schema is not sent as a grammar: the validator and repair rounds check shape.
  const ollama = new OllamaProvider(fetch, () => ({ ...resolveOllamaConfig(), model: ollamaModel, timeoutMs: 1_200_000, numCtx: 16_384, format: "json" as const, think: false }));
  const writer: V3ModelChoice = providerName === "openai" ? { provider: "openai", model: setting("ATOLYE_V3_WRITER_MODEL", "gpt-4.1") } : { provider: "ollama" };
  const checker: V3ModelChoice = providerName === "openai" ? { provider: "openai", model: setting("ATOLYE_V3_CHECKER_MODEL", "gpt-4.1") } : { provider: "ollama" };
  const budget = new V3Budget({ providers: { openai: new OpenAIProvider(), ollama }, fallback: { provider: "ollama" } });

  const catalog = await packCatalog(costumesRoot(paths.repoRoot));
  const outDir = arg("--cikti") ?? path.join(paths.workRoot, "bolumler", `${slug(konu)}-${dil}`);
  await fs.mkdir(outDir, { recursive: true });

  const t0 = Date.now();
  console.log(`senaryo: ${writer.provider}${writer.model ? `/${writer.model}` : `/${ollamaModel}`} · ${brief.hedefSureSn} sn · ${dil} · tavan $${budget.capUsd.toFixed(2)}`);
  try {
    const out = await writeScript({ brief, catalog, writer, checker, budget });
    await fs.writeFile(path.join(outDir, "episode.json"), `${JSON.stringify(out.episode, null, 2)}\n`);
    await fs.writeFile(path.join(outDir, "dogrulama.json"), `${JSON.stringify(out.factCheck, null, 2)}\n`);
    await fs.writeFile(path.join(outDir, "rapor.md"), report(brief, out, budget, writer));
    console.log(`episode: ${path.join(outDir, "episode.json")} (${out.validation.metrics.sceneCount} sahne, ${out.validation.metrics.lineCount} satır, ${Math.round((Date.now() - t0) / 1000)} sn)`);
    console.log(`doğrulama: ${out.factCheck.durum}, ${out.factCheck.uygulanan} düzeltme · uyarı: ${out.validation.warnings.length}`);
  } finally {
    await fs.writeFile(path.join(outDir, "maliyet.json"), `${JSON.stringify({ tavanUsd: budget.capUsd, toplamUsd: budget.spentUsd, adimlar: budget.ledger }, null, 2)}\n`);
    console.log(`maliyet: $${budget.spentUsd.toFixed(4)} / $${budget.capUsd.toFixed(2)}`);
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  // exitCode, not exit(): an immediate exit while fetch handles close aborts Node on Windows.
  process.exitCode = 1;
});
