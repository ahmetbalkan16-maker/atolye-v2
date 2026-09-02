/**
 * DIAGNOSIS ONLY (not a smoke test). Runs each LLM-backed production stage
 * against the REAL local Ollama server, one at a time, and reports a matrix:
 *
 *   Stage | Pass | JSON parse | Schema | Ollama calls (retries) | ~time | failure class
 *
 * Failure classes: TRUNCATED (done_reason=length / context-token limit),
 * NO_JSON (stop but not parseable), SCHEMA (valid JSON, wrong shape),
 * TIMEOUT, EMPTY, REQUEST_FAILED.
 *
 * Runs both the non-strict path (PipelineRunner.run) and the strict path
 * (production:acceptance:execute — fail-closed).
 *
 *   npm-less:  npx tsx scripts/diag-ollama-stage-matrix.ts [topic] [mode]
 *   mode = nonstrict | strict | both (default both)
 */
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { AIManager } from "../src/lib/ai/AIManager";
import { VisualManager } from "../src/lib/visuals/VisualManager";
import { AudioManager } from "../src/lib/audio/AudioManager";
import { AssemblyManager } from "../src/lib/assembly/AssemblyManager";
import { SEOManager } from "../src/lib/seo/SEOManager";
import { AnimationPromptGenerator } from "../src/lib/animation/prompts/AnimationPromptGenerator";
import { OllamaAnimationProvider } from "../src/lib/animation/providers/OllamaAnimationProvider";
import { OllamaYouTubeProvider } from "../src/lib/youtube/providers/OllamaYouTubeProvider";
import { strictGenerationExecutionPolicy } from "../src/lib/ai/GenerationExecutionPolicy";
import { resolveOllamaConfig } from "../src/lib/ai/OllamaConfig";
import type { ScriptData } from "../src/types/script";
import type { SceneData } from "../src/types/scene";
import type { VisualData, VisualScene } from "../src/types/visual";
import type { ResearchData } from "../src/types/research";

const topic = process.argv[2]?.trim() || "Kanuni Sultan Süleyman";
const wantMode = (process.argv[3]?.trim() || "both").toLowerCase();

// ---------------------------------------------------------------- fetch recorder
type ChatCall = {
  numPredict?: number;
  numCtx?: number;
  format?: unknown;
  promptChars: number;
  httpStatus?: number;
  doneReason?: string | null;
  promptEval?: number;
  evalCount?: number;
  contentChars: number;
  contentIsJson: boolean;
  threw?: string;
  ms: number;
};
let calls: ChatCall[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const u = String(url);
  if (!u.includes("/api/chat") && !u.includes("/v1/chat/completions")) {
    return realFetch(url, init);
  }
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(String(init?.body ?? "{}")); } catch { /* ignore */ }
  const opts = (body.options ?? {}) as Record<string, unknown>;
  const messages = (body.messages ?? []) as Array<{ content?: string }>;
  const promptChars = messages.reduce((s, m) => s + (m.content?.length ?? 0), 0);
  const started = Date.now();
  const rec: ChatCall = {
    numPredict: typeof opts.num_predict === "number" ? opts.num_predict : undefined,
    numCtx: typeof opts.num_ctx === "number" ? opts.num_ctx : undefined,
    format: body.format,
    promptChars,
    contentChars: 0,
    contentIsJson: false,
    ms: 0,
  };
  try {
    const res = await realFetch(url, init);
    rec.httpStatus = res.status;
    const text = await res.clone().text();
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(text); } catch { /* ignore */ }
    const msg = (payload.message ?? {}) as { content?: string };
    const choices = (payload.choices ?? []) as Array<{ message?: { content?: string } }>;
    const content = typeof msg.content === "string" ? msg.content : (choices[0]?.message?.content ?? "");
    rec.doneReason = (payload.done_reason as string | null | undefined) ?? null;
    rec.promptEval = typeof payload.prompt_eval_count === "number" ? payload.prompt_eval_count : undefined;
    rec.evalCount = typeof payload.eval_count === "number" ? payload.eval_count : undefined;
    rec.contentChars = content.length;
    try { const j = JSON.parse(content); rec.contentIsJson = j !== null && typeof j === "object"; } catch { rec.contentIsJson = false; }
    rec.ms = Date.now() - started;
    calls.push(rec);
    return res;
  } catch (error) {
    rec.threw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    rec.ms = Date.now() - started;
    calls.push(rec);
    throw error;
  }
}) as typeof fetch;

// ---------------------------------------------------------------- fixtures
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
  // ~99 s / 5 chapters ~20 s each — matches the real completed videos and the
  // default legacy [60,120] s acceptance band. A 280 s fixture can never satisfy
  // the scene-total check and confounds the scenes/assembly strict result.
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

const visualScene: VisualScene = {
  sceneId: 1, visualPrompt: "Topkapı Sarayı taht odası, mum ışığı, Osmanlı minyatür stili",
  animationPrompt: "yavaş içeri kaydırma", style: "cinematic",
} as VisualScene;

const visualData: VisualData = {
  projectId: "diag", scenes: [visualScene, { ...visualScene, sceneId: 2 }],
  thumbnail: { title: script.title, prompt: "Kanuni portresi", composition: "merkez", mood: "görkemli" },
  createdAt: new Date().toISOString(),
} as unknown as VisualData;

const thumbnailData = {
  variants: [], titleIdea: script.title, concept: "Kanuni portresi + Mohaç savaşı",
  mainSubject: "Kanuni Sultan Süleyman", composition: "merkez portre, arka planda savaş",
  colorStyle: "sıcak altın tonlar", textSuggestion: "KANUNİ",
  imagePrompt: "Kanuni Sultan Süleyman portresi, arka planda Mohaç savaşı, sinematik",
  clickReason: "Osmanlı'nın en güçlü döneminin merakı",
  createdAt: new Date().toISOString(),
} as unknown as import("../src/types/thumbnail").ThumbnailData;

const audioData = {
  narrator: { style: "belgesel", tone: "sakin", language: "tr" },
  sections: script.chapters.map((c) => ({
    chapterId: c.id, title: c.title, duration: "00:20", emotion: c.emotion, emphasis: [],
    narrationNotes: "vurgulu", pacing: "orta", sourceText: c.narration,
  })),
  music: { mood: "sinematik", suggestion: "orkestra", intensity: "orta" },
  production: { targetFormat: "wav", sampleRate: 22050, estimatedTotalDuration: "01:39", generationStatus: "planned" },
  createdAt: new Date().toISOString(),
} as unknown as import("../src/types/audio").AudioData;

// ---------------------------------------------------------------- runner
type Row = {
  stage: string; mode: string; pass: boolean; jsonParse: string; schema: string;
  ollamaCalls: number; retries: number; ms: number; failure: string; detail: string;
};
const rows: Row[] = [];

function classify(mock: boolean, threwMsg: string | undefined): { failure: string; detail: string } {
  if (!mock && !threwMsg) return { failure: "-", detail: "" };
  const last = calls[calls.length - 1];
  if (threwMsg && /GenerationFallbackBlocked/.test(threwMsg)) {
    // strict path: the underlying reason is in the calls
  }
  if (calls.length === 0) return { failure: "NO_OLLAMA_CALL", detail: threwMsg ?? "" };
  if (last.threw) {
    if (/abort/i.test(last.threw)) return { failure: "TIMEOUT", detail: last.threw };
    return { failure: "REQUEST_FAILED", detail: last.threw };
  }
  if (last.httpStatus && last.httpStatus >= 400) return { failure: "HTTP_" + last.httpStatus, detail: "" };
  if (last.contentChars === 0) return { failure: "EMPTY", detail: `done_reason=${last.doneReason}` };
  if (last.doneReason === "length") {
    return { failure: "TRUNCATED", detail: `eval=${last.evalCount}/${last.numPredict} prompt_eval=${last.promptEval} num_ctx=${last.numCtx ?? "server"}` };
  }
  if (!last.contentIsJson) {
    return { failure: "NO_JSON", detail: `done_reason=${last.doneReason}, ${last.contentChars} chars not parseable` };
  }
  // valid JSON, clean finish, but stage still rejected it
  return { failure: "SCHEMA", detail: `valid JSON (${last.contentChars} chars) but failed stage validation` };
}

async function run(stage: string, mode: string, fn: () => Promise<{ mock: boolean; note?: string }>) {
  calls = [];
  const t0 = Date.now();
  let mock = true, threwMsg: string | undefined, note = "", schemaIssues = "";
  try {
    const r = await fn();
    mock = r.mock;
    note = r.note ?? "";
  } catch (error) {
    threwMsg = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    mock = true;
    const ev = (error as { evidence?: { issues?: Array<{ path: string; reason: string; expected?: string }> } }).evidence;
    if (ev?.issues?.length) {
      schemaIssues = ev.issues.slice(0, 6).map((i) => `${i.path}:${i.reason}${i.expected ? "(" + i.expected + ")" : ""}`).join(" ");
    }
  }
  const ms = Date.now() - t0;
  if (schemaIssues) note = schemaIssues;
  const lastJson = calls.length ? calls[calls.length - 1].contentIsJson : false;
  const anyJson = calls.some((c) => c.contentIsJson);
  const { failure, detail } = mock || threwMsg ? classify(mock, threwMsg) : { failure: "-", detail: note };
  rows.push({
    stage, mode,
    pass: !mock && !threwMsg,
    jsonParse: calls.length === 0 ? "n/a" : anyJson ? (lastJson ? "PASS" : "PASS(retry)") : "FAIL",
    schema: !mock && !threwMsg ? "PASS" : failure === "SCHEMA" ? "FAIL" : failure === "TRUNCATED" || failure === "NO_JSON" || failure === "EMPTY" ? "n/a" : "?",
    ollamaCalls: calls.length,
    retries: Math.max(0, calls.length - 1),
    ms,
    failure: threwMsg && failure === "-" ? "THREW" : failure,
    detail: schemaIssues || detail || note || threwMsg || "",
  });
  const tag = `${stage} [${mode}]`;
  console.log(
    `${tag.padEnd(30)} ${(!mock && !threwMsg ? "PASS" : "FAIL").padEnd(5)} ` +
    `calls=${calls.length} retries=${Math.max(0, calls.length - 1)} ${(ms / 1000).toFixed(0)}s  ${failure}${detail ? " — " + detail : ""}`,
  );
}

const isMockResearch = (r: ResearchData) => (r.summary ?? "").trim().toLowerCase() === "mock" || (r.keyEvents?.length ?? 0) === 0;
const isMockScript = (s: ScriptData) => s.subtitle === "mock" || s.conclusion === "mock" || s.chapters.length === 0;
const isMockScenes = (s: SceneData) => s.scenes.length <= 1;

const ctx = { projectSlug: "diag-stage-matrix" } as const;

async function stagesFor(mode: "nonstrict" | "strict") {
  const policy = mode === "strict" ? strictGenerationExecutionPolicy : undefined;

  await run("research", mode, async () => {
    const r = await AIManager.runResearch(topic, ctx, undefined, policy);
    return { mock: isMockResearch(r), note: `keyEvents=${r.keyEvents?.length ?? 0} timeline=${r.timeline?.length ?? 0}` };
  });
  await run("script", mode, async () => {
    const s = await AIManager.runScript(topic, ctx, undefined, policy, research);
    return { mock: isMockScript(s), note: `chapters=${s.chapters.length} narrationChars=${s.chapters.reduce((a, c) => a + c.narration.length, 0)}` };
  });
  await run("scenes", mode, async () => {
    const s = await AIManager.runScenes(script, ctx, undefined, policy, research);
    return { mock: isMockScenes(s), note: `scenes=${s.scenes.length}` };
  });
  await run("visual-plan", mode, async () => {
    const v = await VisualManager.generateVisualData({ projectSlug: "diag-stage-matrix", scenes, generationPolicy: policy });
    const mock = !Array.isArray(v.scenes) || v.scenes.length === 0 || v.scenes.every((sc) => !sc.visualPrompt || sc.visualPrompt.length < 5);
    return { mock, note: `visualScenes=${v.scenes?.length ?? 0}` };
  });
  await run("audio-plan", mode, async () => {
    const a = await AudioManager.generateAudioData(script, ctx, { generationPolicy: policy });
    const mock = !Array.isArray(a.sections) || a.sections.length === 0 ||
      a.sections.every((s) => (s.narrationNotes ?? "").toLowerCase() === "mock" || !s.sourceText);
    return { mock, note: `sections=${a.sections?.length ?? 0}` };
  });
  await run("assembly-plan", mode, async () => {
    const p = await AssemblyManager.generateAssemblyPlan(script, scenes, visualData, audioData, {}, ctx, { generationPolicy: policy });
    const mock = !Array.isArray(p.scenes) || (p.scenes.length === 0 && script.chapters.length > 0);
    return { mock, note: `assemblyScenes=${p.scenes?.length ?? 0}` };
  });
  await run("seo", mode, async () => {
    const seo = await SEOManager.generateSEOData(topic, script, thumbnailData, ctx, { generationPolicy: policy });
    const mock = !seo.tags || seo.tags.length === 0 || (seo.description ?? "").trim().toLowerCase() === "mock";
    return { mock, note: `tags=${seo.tags?.length ?? 0} keywords=${seo.keywords?.length ?? 0}` };
  });
  await run("animation-prompt", mode, async () => {
    const a = await AnimationPromptGenerator.generateAnimationSceneData({ projectSlug: "diag-stage-matrix", scenes, visual: visualScene, generationPolicy: policy });
    const mock = !a.animationPrompt || a.animationPrompt.length < 8;
    return { mock, note: `promptChars=${a.animationPrompt?.length ?? 0}` };
  });
}

async function coreStages(mode: "nonstrict" | "strict") {
  const policy = mode === "strict" ? strictGenerationExecutionPolicy : undefined;
  await run("research", mode, async () => {
    const r = await AIManager.runResearch(topic, ctx, undefined, policy);
    return { mock: isMockResearch(r) };
  });
  await run("script", mode, async () => {
    const s = await AIManager.runScript(topic, ctx, undefined, policy, research);
    return { mock: isMockScript(s), note: `ch=${s.chapters.length}` };
  });
  await run("scenes", mode, async () => {
    const s = await AIManager.runScenes(script, ctx, undefined, policy, research);
    return { mock: isMockScenes(s), note: `sc=${s.scenes.length}` };
  });
}

async function animationMotionPlan() {
  await run("animation-motion-plan", "provider", async () => {
    const p = new OllamaAnimationProvider();
    const r = await p.generateAnimation({ sceneId: 1, animationPrompt: "Mohaç Ovası'nda süvari hücumu, toz ve mızraklar", sourceImageAssetId: "img-abc123", durationSeconds: 8 });
    return { mock: r.success !== true, note: r.success === true ? `motionType=${r.motionType} transition=${r.transition}` : `err=${(r as { error?: string }).error}` };
  });
}

async function youtubePackage() {
  await run("youtube-package", "provider", async () => {
    process.env.YOUTUBE_PROVIDER = "ollama";
    const p = new OllamaYouTubeProvider();
    const r = await p.generatePublishingPackage({
      title: script.title, videoDurationSeconds: 280,
      assembly: { scenes: scenes.scenes.slice(0, 6).map((s) => ({ sceneId: (s as { id: number }).id, duration: 10, notes: "" })) } as never,
      thumbnail: { textSuggestion: "Kanuni" } as never,
      seo: { titleSuggestions: [script.title], description: script.introduction, tags: script.seoKeywords, hashtags: ["#tarih"] } as never,
    } as never);
    return { mock: r.success !== true, note: r.success === true ? `title="${r.draft.title?.slice(0, 40)}"` : `err=${(r as { error?: string }).error}` };
  });
}

async function main() {
  const cfg = resolveOllamaConfig();
  console.log(`\n=== Ollama stage matrix — topic: "${topic}" ===`);
  console.log(`model=${cfg.model} | num_ctx=${cfg.numCtx ?? "server-default"} | maxTokens=${cfg.maxTokens} | temp=${cfg.temperature} | timeoutMs=${cfg.timeoutMs} | maxRetries=${cfg.maxRetries}\n`);

  await withCanonicalSmokeRuntime({
    name: "diag-ollama-stage-matrix",
    projectSlug: "diag-stage-matrix",
    environment: {
      NODE_ENV: "development",
      AI_PROVIDER: "ollama",
      ANIMATION_PROVIDER: "ollama",
      YOUTUBE_PROVIDER: "ollama",
      OLLAMA_HOST: process.env.OLLAMA_HOST || "http://127.0.0.1:11434",
      OLLAMA_MODEL: process.env.OLLAMA_MODEL || "qwen2.5:3b",
      OLLAMA_MAX_RETRIES: process.env.OLLAMA_MAX_RETRIES || "3",
      ...(process.env.OLLAMA_TEMPERATURE ? { OLLAMA_TEMPERATURE: process.env.OLLAMA_TEMPERATURE } : {}),
      ...(process.env.OLLAMA_NUM_CTX ? { OLLAMA_NUM_CTX: process.env.OLLAMA_NUM_CTX } : {}),
      ...(process.env.OLLAMA_TIMEOUT_MS ? { OLLAMA_TIMEOUT_MS: process.env.OLLAMA_TIMEOUT_MS } : {}),
      OPENAI_API_KEY: undefined,
    },
  }, async () => {
    const repeat = Math.max(1, Number(process.argv[4] || "1"));
    if (repeat > 1) {
      // Reliability sampling: only the core text stages, N times, chosen mode(s).
      console.log(`--- RELIABILITY SAMPLE (${repeat}x core stages) ---`);
      for (let i = 0; i < repeat; i += 1) {
        console.log(`\n  # sample ${i + 1}/${repeat}`);
        if (wantMode !== "strict") await coreStages("nonstrict");
        if (wantMode !== "nonstrict") await coreStages("strict");
      }
    } else {
      if (wantMode === "nonstrict" || wantMode === "both") {
        console.log("--- NON-STRICT (PipelineRunner.run path) ---");
        await stagesFor("nonstrict");
      }
      if (wantMode === "strict" || wantMode === "both") {
        console.log("\n--- STRICT (production:acceptance:execute path, fail-closed) ---");
        await stagesFor("strict");
      }
      console.log("\n--- PROVIDER-DIRECT (ANIMATION_PROVIDER / YOUTUBE_PROVIDER = ollama) ---");
      await animationMotionPlan();
      await youtubePackage();
    }
  });

  console.log("\n\n=== MATRIX ===");
  console.log("| Stage | Mode | Pass | JSON | Schema | Calls | Retries | ~time | Failure | Detail |");
  console.log("|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    console.log(`| ${r.stage} | ${r.mode} | ${r.pass ? "PASS" : "FAIL"} | ${r.jsonParse} | ${r.schema} | ${r.ollamaCalls} | ${r.retries} | ${(r.ms / 1000).toFixed(0)}s | ${r.failure} | ${r.detail.slice(0, 60)} |`);
  }
  const strictRows = rows.filter((r) => r.mode === "strict");
  const nonstrictRows = rows.filter((r) => r.mode === "nonstrict");
  const rate = (rs: Row[]) => rs.length ? `${rs.filter((r) => r.pass).length}/${rs.length}` : "n/a";
  console.log(`\nnon-strict pass: ${rate(nonstrictRows)}  |  strict pass: ${rate(strictRows)}  |  provider-direct pass: ${rate(rows.filter((r) => r.mode === "provider"))}`);
}

void main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.stack : e);
  process.exitCode = 1;
});
