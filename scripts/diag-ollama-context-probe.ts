/**
 * DIAGNOSIS ONLY (not a smoke test). Narrow probe that answers one question:
 * when a local model fails the strict script / scenes / seo / assembly stage, is
 * it a CONTEXT-WINDOW problem (prompt tokens ~ num_ctx, so the model never sees
 * the schema instructions) or a MODEL-CAPABILITY problem (it sees everything and
 * still emits the wrong shape)?
 *
 * For each stage it prints the real Ollama call telemetry:
 *   promptChars | prompt_eval_count (tokens) | num_predict | num_ctx |
 *   done_reason | eval_count | contentChars | JSON? | schema issues | ms
 * and, on failure, a head/tail preview of the raw model output.
 *
 *   npx tsx scripts/diag-ollama-context-probe.ts [model] [num_ctx]
 *     model   default qwen2.5:3b   (try qwen2.5:7b-instruct-q4_K_M)
 *     num_ctx default unset (Ollama server default, ~4096) — try 8192 / 16384
 */
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { AIManager } from "../src/lib/ai/AIManager";
import { SEOManager } from "../src/lib/seo/SEOManager";
import { AssemblyManager } from "../src/lib/assembly/AssemblyManager";
import { strictGenerationExecutionPolicy } from "../src/lib/ai/GenerationExecutionPolicy";
import { resolveOllamaConfig } from "../src/lib/ai/OllamaConfig";
import type { ScriptData } from "../src/types/script";
import type { SceneData } from "../src/types/scene";
import type { VisualData } from "../src/types/visual";
import type { ResearchData } from "../src/types/research";
import type { AudioData } from "../src/types/audio";
import type { ThumbnailData } from "../src/types/thumbnail";

const model = process.argv[2]?.trim() || "qwen2.5:3b";
const numCtxArg = process.argv[3]?.trim();
const topic = "Kanuni Sultan Süleyman";

type ChatCall = {
  promptChars: number;
  promptEval?: number;
  evalCount?: number;
  numPredict?: number;
  numCtx?: number;
  doneReason?: string | null;
  contentChars: number;
  contentIsJson: boolean;
  content: string;
  ms: number;
};
let calls: ChatCall[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const u = String(url);
  if (!u.includes("/api/chat") && !u.includes("/v1/chat/completions")) return realFetch(url, init);
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(String(init?.body ?? "{}")); } catch { /* ignore */ }
  const opts = (body.options ?? {}) as Record<string, unknown>;
  const messages = (body.messages ?? []) as Array<{ content?: string }>;
  const promptChars = messages.reduce((s, m) => s + (m.content?.length ?? 0), 0);
  const started = Date.now();
  const rec: ChatCall = {
    promptChars,
    numPredict: typeof opts.num_predict === "number" ? opts.num_predict : undefined,
    numCtx: typeof opts.num_ctx === "number" ? opts.num_ctx : undefined,
    contentChars: 0, contentIsJson: false, content: "", ms: 0,
  };
  try {
    const res = await realFetch(url, init);
    const text = await res.clone().text();
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(text); } catch { /* ignore */ }
    const msg = (payload.message ?? {}) as { content?: string };
    const content = typeof msg.content === "string" ? msg.content : "";
    rec.doneReason = (payload.done_reason as string | null | undefined) ?? null;
    rec.promptEval = typeof payload.prompt_eval_count === "number" ? payload.prompt_eval_count : undefined;
    rec.evalCount = typeof payload.eval_count === "number" ? payload.eval_count : undefined;
    rec.contentChars = content.length;
    rec.content = content;
    try { const j = JSON.parse(content); rec.contentIsJson = j !== null && typeof j === "object"; } catch { rec.contentIsJson = false; }
    rec.ms = Date.now() - started;
    calls.push(rec);
    return res;
  } catch (error) {
    rec.ms = Date.now() - started;
    calls.push(rec);
    throw error;
  }
}) as typeof fetch;

const research: ResearchData = {
  topic,
  summary:
    "Kanuni Sultan Süleyman (1494-1566), Osmanlı'nın onuncu padişahı, 46 yıl hüküm sürdü. " +
    "Belgrad (1521), Rodos (1522), Mohaç Meydan Muharebesi (1526), Birinci Viyana Kuşatması (1529). " +
    "Mimar Sinan ile Süleymaniye Camii. Hürrem Sultan ile evlilik. Barbaros Hayreddin Paşa ve Preveze (1538). " +
    "Kanunname düzenlemeleri nedeniyle 'Kanuni' unvanı. 1566'da Zigetvar kuşatmasında öldü.",
  historicalContext: "16. yüzyıl Osmanlı İmparatorluğu, Akdeniz ve Orta Avrupa.",
  timeline: ["1520 tahta çıkış", "1526 Mohaç", "1529 Viyana", "1538 Preveze", "1566 Zigetvar / ölüm"],
  characters: ["Kanuni Sultan Süleyman", "Hürrem Sultan", "Pargalı İbrahim Paşa", "Mimar Sinan", "Barbaros Hayreddin Paşa"],
  locations: ["İstanbul", "Mohaç", "Viyana", "Rodos", "Zigetvar"],
  keyEvents: ["Mohaç Meydan Muharebesi", "Birinci Viyana Kuşatması", "Preveze Deniz Muharebesi", "Süleymaniye Camii inşası"],
  strategies: [], controversies: ["Şehzade Mustafa'nın idamı (1553)"], interestingFacts: [],
  documentaryFlow: [], sceneIdeas: [], imagePrompts: [], animationPrompts: [], musicIdeas: [],
  soundEffects: [], thumbnailIdeas: [], youtubeTitles: [], sources: [],
  createdAt: new Date().toISOString(),
} as unknown as ResearchData;

const script: ScriptData = {
  topic, title: "Kanuni Sultan Süleyman: Osmanlı'nın Zirvesi", subtitle: "Bir imparatorluğun altın çağı",
  hook: "1526, Mohaç Ovası: iki saatte bir krallık yıkıldı.",
  introduction: "Kanuni Sultan Süleyman 1520'de tahta çıktığında Osmanlı zaten güçlüydü; onu efsane yapan 46 yıl sürecekti.",
  // Realistic band: the real completed videos are ~99 s, 5 chapters ~20 s each
  // (data/projects/*5be83a84*, *c0261ddc*). The default acceptance band is the
  // legacy [60,120] s / target 90 s — a 280 s fixture can NEVER satisfy the
  // scene-total check, which confounds the scenes/assembly strict result.
  chapters: [
    { id: 1, title: "Tahta Çıkış", narration: "Yavuz Sultan Selim'in ölümüyle 1520'de tek varis Süleyman tahta çıktı.", duration: 20, visualGoal: "Topkapı Sarayı, tahta çıkış töreni", emotion: "görkemli", transition: "Belgrad yoluna çıkış" },
    { id: 2, title: "Belgrad ve Rodos", narration: "1521'de Belgrad düştü, 1522'de Rodos şövalyeleri teslim oldu.", duration: 21, visualGoal: "Kale kuşatması, toplar", emotion: "gergin", transition: "Mohaç'a doğru" },
    { id: 3, title: "Mohaç", narration: "29 Ağustos 1526: Macar ordusu Mohaç Ovası'nda iki saatte yok edildi.", duration: 20, visualGoal: "Meydan muharebesi, süvari hücumu", emotion: "epik", transition: "Viyana kapılarına" },
    { id: 4, title: "Viyana Kuşatması", narration: "1529'da Süleyman Viyana önlerindeydi ama erken kış kuşatmayı bozdu.", duration: 19, visualGoal: "Kuşatma hatları, kar", emotion: "hüzünlü", transition: "denize dönüş" },
    { id: 5, title: "Sinan ve Miras", narration: "Mimar Sinan'ın Süleymaniye'si ve Kanunname'ler. Süleyman 1566'da Zigetvar'da öldü.", duration: 19, visualGoal: "Süleymaniye Camii, hat sanatı", emotion: "düşündürücü", transition: "kapanış" },
  ],
  conclusion: "Kanuni'nin ardından imparatorluk hâlâ büyüktü ama zirve geride kalmıştı.",
  callToAction: "Belgeseli beğendiyseniz abone olun.",
  estimatedDuration: 99, narrationWordCount: 90, targetAudience: "genel", language: "tr",
  voiceStyle: "belgesel", musicStyle: "sinematik", thumbnailIdea: "Kanuni portresi + Mohaç",
  seoKeywords: ["Kanuni Sultan Süleyman", "Mohaç", "Osmanlı", "Viyana Kuşatması"],
  createdAt: new Date().toISOString(),
};

const scenes: SceneData = {
  scenes: script.chapters.flatMap((c) => [
    { id: c.id * 2 - 1, chapterId: c.id, title: `${c.title} - açılış`, description: c.visualGoal, visualPrompt: `${c.visualGoal}, sinematik, tarihi`, duration: Math.round(c.duration / 2) } as never,
    { id: c.id * 2, chapterId: c.id, title: `${c.title} - kapanış`, description: c.visualGoal, visualPrompt: `${c.visualGoal}, geniş plan`, duration: Math.round(c.duration / 2) } as never,
  ]),
  createdAt: new Date().toISOString(),
} as SceneData;

const visualData: VisualData = {
  projectId: "diag",
  scenes: scenes.scenes.map((s) => ({
    sceneId: (s as { id: number }).id,
    visualPrompt: "Osmanlı minyatür stili, sinematik",
    animationPrompt: "yavaş içeri kaydırma", style: "cinematic",
  })),
  thumbnail: { title: script.title, prompt: "Kanuni portresi", composition: "merkez", mood: "görkemli" },
  createdAt: new Date().toISOString(),
} as unknown as VisualData;

const thumbnailData = {
  variants: [], titleIdea: script.title, concept: "Kanuni portresi + Mohaç",
  mainSubject: "Kanuni Sultan Süleyman", composition: "merkez portre",
  colorStyle: "sıcak altın tonlar", textSuggestion: "KANUNİ",
  imagePrompt: "Kanuni portresi, sinematik", clickReason: "merak",
  createdAt: new Date().toISOString(),
} as unknown as ThumbnailData;

const audioData = {
  narrator: { style: "belgesel", tone: "sakin", language: "tr" },
  sections: script.chapters.map((c) => ({
    chapterId: c.id, title: c.title, duration: "00:20", emotion: c.emotion, emphasis: [],
    narrationNotes: "vurgulu", pacing: "orta", sourceText: c.narration,
  })),
  music: { mood: "sinematik", suggestion: "orkestra", intensity: "orta" },
  production: { targetFormat: "wav", sampleRate: 22050, estimatedTotalDuration: "01:39", generationStatus: "planned" },
  createdAt: new Date().toISOString(),
} as unknown as AudioData;

function preview(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= 700) return t;
  return `${t.slice(0, 350)}  …[${t.length - 700} chars]…  ${t.slice(-350)}`;
}

async function probe(stage: string, fn: () => Promise<void>) {
  calls = [];
  const t0 = Date.now();
  let threw = "";
  let issues = "";
  try {
    await fn();
  } catch (error) {
    threw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const ev = (error as { evidence?: { issues?: Array<{ path: string; reason: string; expected?: string }> } }).evidence;
    if (ev?.issues?.length) {
      issues = ev.issues.map((i) => `${i.path}:${i.reason}${i.expected ? `(${i.expected})` : ""}`).join("  ");
    }
  }
  const ms = Date.now() - t0;
  console.log(`\n### ${stage}  ${threw ? "FAIL" : "PASS"}  ${(ms / 1000).toFixed(0)}s  (${calls.length} call${calls.length === 1 ? "" : "s"})`);
  calls.forEach((c, i) => {
    const ctxUsed = c.promptEval !== undefined && c.evalCount !== undefined ? c.promptEval + c.evalCount : undefined;
    console.log(
      `  call ${i + 1}: promptChars=${c.promptChars} prompt_tok=${c.promptEval ?? "?"} ` +
      `num_predict=${c.numPredict ?? "?"} num_ctx=${c.numCtx ?? "server-default"} ` +
      `done=${c.doneReason ?? "null"} out_tok=${c.evalCount ?? "?"} ctx_used=${ctxUsed ?? "?"} ` +
      `outChars=${c.contentChars} json=${c.contentIsJson} ${(c.ms / 1000).toFixed(0)}s`,
    );
  });
  if (threw) {
    console.log(`  threw: ${threw}`);
    if (issues) console.log(`  schema issues: ${issues}`);
    const last = calls[calls.length - 1];
    if (last?.content) console.log(`  raw output: ${preview(last.content)}`);
  }
}

async function main() {
  const cfg = resolveOllamaConfig();
  console.log(`=== Ollama context probe — model=${cfg.model} num_ctx=${cfg.numCtx ?? "server-default"} ===`);
  const policy = strictGenerationExecutionPolicy;
  const ctx = { projectSlug: "diag-ctx-probe" };

  await probe("research [strict]", async () => {
    await AIManager.runResearch(topic, ctx, undefined, policy);
  });
  await probe("script [strict]", async () => {
    await AIManager.runScript(topic, ctx, undefined, policy, research);
  });
  await probe("scenes [strict]", async () => {
    await AIManager.runScenes(script, ctx, undefined, policy, research);
  });
  await probe("seo [strict]", async () => {
    await SEOManager.generateSEOData(topic, script, thumbnailData, ctx, { generationPolicy: policy });
  });
  await probe("assembly-plan [strict]", async () => {
    await AssemblyManager.generateAssemblyPlan(script, scenes, visualData, audioData, {}, ctx, { generationPolicy: policy });
  });

  console.log("\n=== read: prompt_tok near num_ctx  => context-window starvation (model never sees the schema).");
  console.log("    prompt_tok well under num_ctx + still wrong shape => model-capability limit.");
}

const env: Record<string, string | undefined> = {
  NODE_ENV: "development",
  AI_PROVIDER: "ollama",
  OLLAMA_HOST: process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434",
  OLLAMA_MODEL: model,
  OLLAMA_MAX_RETRIES: "3",
  ...(process.env.OLLAMA_TEMPERATURE ? { OLLAMA_TEMPERATURE: process.env.OLLAMA_TEMPERATURE } : {}),
  OPENAI_API_KEY: undefined,
};
if (numCtxArg) env.OLLAMA_NUM_CTX = numCtxArg;

void withCanonicalSmokeRuntime({ name: "diag-ctx-probe", environment: env }, main);
