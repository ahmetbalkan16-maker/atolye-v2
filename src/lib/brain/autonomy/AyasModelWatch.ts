import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Relative imports: this module is reached from the research status view, which other daemons load from any cwd.
import { resolveAyasChatModelProfile } from "../../ayas/AyasModelProfile";
import type { AyasChatModelBenchmarkResult } from "../../ayas/model/AyasChatModelBenchmark";

/**
 * Model comparison (owner request 2026-10-15): which local model AYAS chat should run, measured rather than guessed.
 *
 * - A reviewed watch list of newer official Ollama library models that could replace the current one. A candidate
 *   is a source change, like the research source registry; nothing is discovered by scraping a web page.
 * - What the owner-run `scripts/ayas-model-benchmark.ts` recorded: registry sizes and digests of the candidates,
 *   the installed models, the GPU, and the frozen benchmark (`AyasChatModelBenchmark`) per installed model.
 * - A read-only view with one recommendation. Downloading a model and changing `AYAS_OLLAMA_MODEL` both stay owner
 *   decisions: the owner's clicks ("İndir ve ölç", "Bu modele geç") are recorded by AyasModelOperationStore and
 *   carried out by the observer's executor. Nothing here downloads, switches or writes configuration.
 */

/**
 * The frozen case set of `AyasChatModelBenchmark`. It lives here so the read-only view never loads the benchmark
 * runner; changing a case or a grader there means a new id here, and results under other ids are not compared.
 * v2 (2026-10-15): v1's honesty graders missed correct hedges ("kesin bir tahmin yapamam") and a denial that repeats
 * the question ("sildim mi diye bir şey yapmadım"), and let an invention followed by a question pass.
 * v3 (2026-10-15): one pass moved the same model by two cases between runs (sampled answers), so every case is asked
 * three times and passes by majority.
 */
export const AYAS_CHAT_MODEL_BENCHMARK_ID = "ayas-chat-tr-v3";

export interface AyasModelWatchCandidate {
  readonly tag: string;
  readonly publisher: string;
  /** Lower comes first when several candidates are worth downloading. */
  readonly priority: number;
  readonly license: string;
  readonly note: string;
}

/**
 * Verified 2026-10-15 against registry.ollama.ai (sizes, Apache-2.0 licence layers) and the Ollama library
 * (capabilities: gemma4 and qwen3.5 think; OllamaAyasProvider sends think:false to qwen3, qwen3.5 and gemma4 tags).
 */
export const AYAS_MODEL_WATCH_CANDIDATES: readonly AyasModelWatchCandidate[] = Object.freeze([
  { tag: "gemma4:12b", publisher: "Google", priority: 1, license: "Apache-2.0", note: "Gemma 3'ün halefi Gemma 4, şu anki modelle aynı boyda. Düşünme kipi var; AYAS sohbette düşünmeyi kapatır (think: false), ölçüm de öyle yapılır." },
  { tag: "qwen3.5:9b", publisher: "Alibaba Qwen", priority: 2, license: "Apache-2.0", note: "Qwen 3.5 ailesi. Düşünme kipi var; AYAS sohbette düşünmeyi kapatır (think: false), ölçüm de öyle yapılır." },
  { tag: "gemma4:e4b", publisher: "Google", priority: 3, license: "Apache-2.0", note: "Gemma 4'ün küçük ve hızlı sürümü; düşünme kipi var, AYAS kapatır." },
  { tag: "ministral-3:8b", publisher: "Mistral AI", priority: 4, license: "Apache-2.0", note: "Uç cihazlar için Ministral 3." },
  { tag: "ministral-3:14b", publisher: "Mistral AI", priority: 5, license: "Apache-2.0", note: "Ministral 3'ün büyük sürümü; 12 GB ekran kartında sınırda." },
  { tag: "granite4.2:8b", publisher: "IBM", priority: 6, license: "Apache-2.0", note: "Çok dilli Granite 4.2." },
].map((candidate) => Object.freeze(candidate)));

export interface AyasModelRegistryObservation {
  readonly tag: string;
  /** SHA-256 of the manifest: the digest Ollama shows for the tag once pulled. */
  readonly digest: string;
  readonly totalBytes: number;
  readonly checkedAt: string;
}

export interface AyasInstalledModel { readonly name: string; readonly digest: string; readonly sizeBytes: number }

export interface AyasModelWatchState {
  readonly schemaVersion: 1;
  readonly updatedAt: string;
  readonly host?: { readonly gpuName?: string; readonly gpuTotalBytes?: number };
  readonly installed: readonly AyasInstalledModel[];
  readonly installedCheckedAt?: string;
  readonly registry: Readonly<Record<string, AyasModelRegistryObservation>>;
  readonly results: Readonly<Record<string, AyasChatModelBenchmarkResult>>;
}

export interface AyasModelWatchStore {
  read(): AyasModelWatchState | undefined;
  write(state: AyasModelWatchState): void;
}

/** One JSON file, written atomically (temp + fsync + rename) like the other research stores. */
export function createAyasModelWatchStore(options: { readonly rootDir?: string } = {}): AyasModelWatchStore {
  const dir = path.resolve(options.rootDir ?? path.join(process.cwd(), "data", "brain", "self-improvement", "model-watch"));
  const file = path.join(dir, "state.json");
  return {
    read() {
      let raw: string;
      try { raw = fs.readFileSync(file, "utf8"); } catch { return undefined; }
      const parsed = JSON.parse(raw) as AyasModelWatchState;
      if (parsed?.schemaVersion !== 1) throw new Error("model-watch state has an unknown schema");
      return parsed;
    },
    write(state) {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = path.join(dir, `.state.${process.pid}.${crypto.randomUUID()}.tmp`);
      const fd = fs.openSync(tmp, "w");
      try { fs.writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, file);
    },
  };
}

export type AyasModelVerdict = "BETTER" | "SIMILAR" | "WORSE";

/** Cases passed by majority (three attempts each); one case either way counts as noise. */
const MIN_BETTER_CASES = 2;
const MIN_GPU_SHARE = 0.9;
const MAX_LATENCY_RATIO = 1.5;

/** Deterministic comparison of a measured model with the current one; reasons explain why "better" was withheld. */
export function compareAyasChatModels(incumbent: AyasChatModelBenchmarkResult, candidate: AyasChatModelBenchmarkResult): { readonly verdict: AyasModelVerdict; readonly reasons: readonly string[] } {
  const delta = candidate.passed - incumbent.passed;
  const reasons: string[] = [];
  if (candidate.byCategory.HONESTY.passed < incumbent.byCategory.HONESTY.passed) reasons.push("bilmediğini söyleme sorularında geride");
  if (candidate.hardware && candidate.hardware.gpuShare < MIN_GPU_SHARE) reasons.push(`modelin %${Math.round((1 - candidate.hardware.gpuShare) * 100)}'i ekran kartına sığmıyor`);
  if (incumbent.latencyMedianMs > 0 && candidate.latencyMedianMs > incumbent.latencyMedianMs * MAX_LATENCY_RATIO) reasons.push("yanıtları belirgin biçimde daha yavaş");
  if (delta >= MIN_BETTER_CASES && !reasons.length) return { verdict: "BETTER", reasons: [] };
  return { verdict: delta <= -MIN_BETTER_CASES ? "WORSE" : "SIMILAR", reasons: Object.freeze(reasons) };
}

const canonicalJson = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonicalJson).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`
    : JSON.stringify(value);

/**
 * What a "Bu modele geç" click binds to: the candidate's and the current model's measured results (bytes, frozen set,
 * score, time). A new measurement of either, or another current model, changes it and needs a new click.
 */
export function ayasModelSwitchHash(input: { readonly candidate: AyasChatModelBenchmarkResult; readonly incumbentModel: string; readonly incumbent: AyasChatModelBenchmarkResult }): string {
  const bind = (result: AyasChatModelBenchmarkResult) => ({ model: result.model, digest: result.digest, benchmarkId: result.benchmarkId, passed: result.passed, total: result.total, measuredAt: result.measuredAt });
  return crypto.createHash("sha256").update(canonicalJson({ candidate: bind(input.candidate), incumbentModel: input.incumbentModel, incumbent: bind(input.incumbent) }), "utf8").digest("hex");
}

/** The current results of a model under the frozen set: measured on the bytes still installed under its tag. */
export function currentAyasModelResult(state: AyasModelWatchState | undefined, model: string): AyasChatModelBenchmarkResult | undefined {
  const result = state?.results[model];
  const installed = state?.installed.find((entry) => entry.name === model);
  return result && result.benchmarkId === AYAS_CHAT_MODEL_BENCHMARK_ID && installed?.digest === result.digest ? result : undefined;
}

export interface AyasMeasuredModelView {
  readonly model: string;
  readonly isIncumbent: boolean;
  /** Present only on a candidate measured better than the current model: what "Bu modele geç" binds to. */
  readonly switchHash?: string;
  readonly passed: number;
  readonly total: number;
  readonly byCategory: AyasChatModelBenchmarkResult["byCategory"];
  readonly latencyMedianMs: number;
  readonly gpuShare?: number;
  readonly measuredAt: string;
  readonly verdict?: AyasModelVerdict;
  readonly reasons: readonly string[];
  readonly failedCases: readonly { readonly id: string; readonly reason: string; readonly passes: number; readonly attempts: number }[];
}

export type AyasModelCandidateStatus = "MEASURED" | "INSTALLED_UNMEASURED" | "NOT_INSTALLED";
export type AyasModelFit = "FITS" | "SPILLS" | "UNKNOWN";

export interface AyasModelCandidateView extends AyasModelWatchCandidate {
  readonly status: AyasModelCandidateStatus;
  readonly totalBytes?: number;
  /** The registry manifest digest last read for the tag: what "İndir ve ölç" binds to. Absent until the registry was read. */
  readonly registryDigest?: string;
  readonly fit: AyasModelFit;
  readonly checkedAt?: string;
}

export type AyasModelRecommendationKind = "MEASURE_INCUMBENT" | "SWITCH" | "MEASURE_INSTALLED" | "DOWNLOAD_TO_MEASURE" | "KEEP";

export interface AyasModelWatchView {
  readonly benchmarkId: string;
  readonly incumbentModel: string;
  readonly incumbent?: AyasMeasuredModelView;
  readonly measured: readonly AyasMeasuredModelView[];
  readonly candidates: readonly AyasModelCandidateView[];
  readonly recommendation: { readonly kind: AyasModelRecommendationKind; readonly model?: string; readonly text: string };
  readonly lastMeasuredAt?: string;
  readonly registryCheckedAt?: string;
  readonly gpuName?: string;
}

/** Loaded size per stored byte when nothing was measured yet: weights plus the 8192-token context. */
const DEFAULT_LOAD_RATIO = 1.25;

const gb = (bytes: number) => `${(bytes / 1e9).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} GB`;

export function buildAyasModelWatchView(input: { readonly state: AyasModelWatchState | undefined; readonly incumbentModel: string }): AyasModelWatchView {
  const state = input.state;
  const installed = new Map((state?.installed ?? []).map((model) => [model.name, model]));
  // A result counts only for the frozen set it was measured on and for the bytes still installed under the tag.
  const current = (model: string): AyasChatModelBenchmarkResult | undefined => currentAyasModelResult(state, model);
  const incumbentResult = current(input.incumbentModel);
  const toView = (result: AyasChatModelBenchmarkResult): AyasMeasuredModelView => {
    const isIncumbent = result.model === input.incumbentModel;
    const comparison = incumbentResult && !isIncumbent ? compareAyasChatModels(incumbentResult, result) : undefined;
    return {
      model: result.model, isIncumbent,
      ...(comparison?.verdict === "BETTER" && incumbentResult ? { switchHash: ayasModelSwitchHash({ candidate: result, incumbentModel: input.incumbentModel, incumbent: incumbentResult }) } : {}),
      passed: result.passed, total: result.total, byCategory: result.byCategory, latencyMedianMs: result.latencyMedianMs,
      ...(result.hardware ? { gpuShare: result.hardware.gpuShare } : {}), measuredAt: result.measuredAt,
      ...(comparison ? { verdict: comparison.verdict } : {}), reasons: comparison?.reasons ?? [],
      failedCases: result.cases.filter((entry) => !entry.pass).map((entry) => ({ id: entry.id, reason: entry.reason ?? "", passes: entry.passes, attempts: entry.attempts })),
    };
  };
  const measured = [...installed.keys()].map(current).filter((result): result is AyasChatModelBenchmarkResult => Boolean(result))
    .map(toView).sort((a, b) => Number(b.isIncumbent) - Number(a.isIncumbent) || b.passed - a.passed || a.latencyMedianMs - b.latencyMedianMs);

  const incumbentInstalledBytes = installed.get(input.incumbentModel)?.sizeBytes;
  const loadRatio = incumbentResult?.hardware && incumbentInstalledBytes ? incumbentResult.hardware.loadedBytes / incumbentInstalledBytes : DEFAULT_LOAD_RATIO;
  const gpuTotal = state?.host?.gpuTotalBytes;
  const candidates: AyasModelCandidateView[] = AYAS_MODEL_WATCH_CANDIDATES.filter((candidate) => candidate.tag !== input.incumbentModel).map((candidate) => {
    const observation = state?.registry[candidate.tag];
    const totalBytes = installed.get(candidate.tag)?.sizeBytes ?? observation?.totalBytes;
    const measuredResult = current(candidate.tag);
    const status: AyasModelCandidateStatus = measuredResult ? "MEASURED" : installed.has(candidate.tag) ? "INSTALLED_UNMEASURED" : "NOT_INSTALLED";
    const fit: AyasModelFit = measuredResult?.hardware ? (measuredResult.hardware.gpuShare >= MIN_GPU_SHARE ? "FITS" : "SPILLS")
      : !totalBytes || !gpuTotal ? "UNKNOWN" : totalBytes * loadRatio <= gpuTotal ? "FITS" : "SPILLS";
    return {
      ...candidate, status,
      ...(totalBytes ? { totalBytes } : {}), ...(observation ? { registryDigest: observation.digest } : {}), fit, ...(observation ? { checkedAt: observation.checkedAt } : {}),
    };
  }).sort((a, b) => a.priority - b.priority);

  const incumbentView = measured.find((entry) => entry.isIncumbent);
  const better = measured.filter((entry) => entry.verdict === "BETTER").sort((a, b) => b.passed - a.passed || a.latencyMedianMs - b.latencyMedianMs)[0];
  const unmeasured = candidates.find((candidate) => candidate.status === "INSTALLED_UNMEASURED");
  const download = candidates.find((candidate) => candidate.status === "NOT_INSTALLED" && candidate.fit === "FITS");
  const score = incumbentView ? `${incumbentView.total} sorudan ${incumbentView.passed}'i` : "";
  const recommendation: AyasModelWatchView["recommendation"] = !incumbentView
    ? { kind: "MEASURE_INCUMBENT", model: input.incumbentModel, text: `Önce şu anki model ${input.incumbentModel} ölçülmeli; karşılaştırma onunla yapılır.` }
    : better
      ? { kind: "SWITCH", model: better.model, text: `${better.model}, ${better.total} sorudan ${better.passed}'ini geçti (${input.incumbentModel}: ${score}). "Bu modele geç" ile değiştirebilirsin; canlı uygulama yeniden başlar ve sorun çıkarsa eski modele döner.` }
      : unmeasured
        ? { kind: "MEASURE_INSTALLED", model: unmeasured.tag, text: `${unmeasured.tag} kurulu ama henüz ölçülmedi; aynı testle ölçülmeli.` }
        : download
          ? { kind: "DOWNLOAD_TO_MEASURE", model: download.tag, text: `${download.tag} (${download.publisher}${download.totalBytes ? `, ${gb(download.totalBytes)}` : ""}) bu bilgisayarın ekran kartına sığıyor ve henüz ölçülmedi. Onaylarsan indirilir ve ${input.incumbentModel} ile aynı testle karşılaştırılır.` }
          : { kind: "KEEP", model: input.incumbentModel, text: `${input.incumbentModel} kalmalı: ölçülen modellerden belirgin biçimde iyisi yok (${score} geçti).` };

  return {
    benchmarkId: AYAS_CHAT_MODEL_BENCHMARK_ID, incumbentModel: input.incumbentModel, ...(incumbentView ? { incumbent: incumbentView } : {}),
    measured, candidates, recommendation,
    ...(measured.length ? { lastMeasuredAt: measured.map((entry) => entry.measuredAt).sort().at(-1)! } : {}),
    ...(Object.values(state?.registry ?? {}).length ? { registryCheckedAt: Object.values(state!.registry).map((entry) => entry.checkedAt).sort().at(-1)! } : {}),
    ...(state?.host?.gpuName ? { gpuName: state.host.gpuName } : {}),
  };
}

/** The /brain view; undefined when the AYAS model or the stored state cannot be read (the rest of the page still renders). */
export function loadAyasModelWatchView(input: { readonly env?: NodeJS.ProcessEnv; readonly store?: AyasModelWatchStore } = {}): AyasModelWatchView | undefined {
  try {
    const incumbentModel = resolveAyasChatModelProfile(input.env ?? process.env).model;
    return buildAyasModelWatchView({ state: (input.store ?? createAyasModelWatchStore()).read(), incumbentModel });
  } catch {
    return undefined;
  }
}

/** One or two spoken sentences; `actionableOnly` says nothing unless the owner has something to decide. */
export function buildAyasModelWatchSpokenSummary(view: AyasModelWatchView | undefined, options: { readonly actionableOnly?: boolean } = {}): string {
  if (!view) return options.actionableOnly ? "" : "Model karşılaştırması şu an okunamıyor.";
  const kind = view.recommendation.kind;
  if (options.actionableOnly && kind !== "SWITCH" && kind !== "DOWNLOAD_TO_MEASURE") return "";
  const current = view.incumbent
    ? `AYAS ${view.incumbentModel} modelini kullanıyor; Türkçe testte ${view.incumbent.total} sorudan ${view.incumbent.passed}'ini geçti.`
    : `AYAS ${view.incumbentModel} modelini kullanıyor; bu model henüz ölçülmedi.`;
  const decision = kind === "SWITCH" ? `${view.recommendation.model} daha iyi çıktı; onaylarsan model değiştirilir.`
    : kind === "DOWNLOAD_TO_MEASURE" ? `Yeni çıkan ${view.recommendation.model} bu bilgisayara sığıyor; onaylarsan indirilip aynı testle ölçülür.`
      : kind === "MEASURE_INSTALLED" ? `${view.recommendation.model} kurulu ama henüz ölçülmedi.`
        : kind === "KEEP" ? "Ölçülen modellerden daha iyisi yok." : "";
  return `${current} ${decision} Hiçbir model kendiliğinden indirilmez veya değiştirilmez.`.replace(/\s+/g, " ").trim();
}
