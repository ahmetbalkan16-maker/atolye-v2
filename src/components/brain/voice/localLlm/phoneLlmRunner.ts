/**
 * AYAS phone-local LLM — Transformers.js runner (Tier 2 prototype).
 *
 * A thin wrapper around `@huggingface/transformers`'s `pipeline("text-generation")`,
 * forced onto the `webgpu` device. This is the ONLY file that imports
 * `@huggingface/transformers` — the wake engine's `onnxruntime-web` import
 * (`openWakeWordRunner.ts`) is untouched and this file does not import it or
 * anything that does. `npm ls onnxruntime-web` confirms the two are already
 * separate package instances (`@huggingface/transformers` pins its own
 * `onnxruntime-web@1.26.0-dev...`, distinct from the top-level `1.29.0` the
 * wake engine uses) — so there is no shared `ort.env` global to fight over;
 * this was verified, not assumed.
 *
 * Tokenizer + generation loop are Transformers.js's own (spec: no hand-rolled
 * ONNX generation loop here). Model weights are fetched directly from the
 * Hugging Face CDN by Transformers.js — never staged in this repo, never
 * bundled into `public/`, never committed (matches "model ağırlıklarını
 * repository'ye commit etme").
 *
 * Fail-closed: every failure resolves to a typed, reasoned outcome. There is
 * no fallback inside this module — the caller (the prototype page) decides
 * what to show, and the spec is explicit that it must never silently reach
 * for the PC / Worker / OpenAI.
 *
 * Model re-use without network: verified in the installed package's own
 * source (`dist/transformers.web.js`) — `env.useBrowserCache` defaults to
 * `IS_WEB_CACHE_AVAILABLE` (true whenever the Cache API exists, which it does
 * in any browser that can run this PWA). Nothing here needs to force it on;
 * a model downloaded once is served from the browser's own Cache Storage on
 * every later `load()` of the same model id, offline included, with no
 * network attempt at all on a cache hit.
 */

import {
  pipeline,
  TextStreamer,
  StoppingCriteria,
  StoppingCriteriaList,
  env,
  type DataType,
  type Message,
  type ProgressInfo,
} from "@huggingface/transformers";

export interface AyasPhoneLlmModelSpec {
  readonly id: string;
  readonly label: string;
  readonly dtype: DataType;
  readonly approxSizeLabel: string;
  readonly license: string;
}

/** Order matters: item 3 of the spec — prove 0.5B first, only then try 1.5B. */
export const AYAS_PHONE_LLM_MODELS: readonly AyasPhoneLlmModelSpec[] = [
  {
    id: "onnx-community/Qwen2.5-0.5B-Instruct",
    label: "Qwen2.5-0.5B-Instruct",
    dtype: "q4f16",
    approxSizeLabel: "~300–400 MB",
    license: "Apache-2.0",
  },
  {
    id: "onnx-community/Qwen2.5-1.5B-Instruct",
    label: "Qwen2.5-1.5B-Instruct",
    dtype: "q4f16",
    approxSizeLabel: "~900 MB – 1 GB",
    license: "Apache-2.0",
  },
];

export interface AyasPhoneLlmLoadProgress {
  readonly status: ProgressInfo["status"];
  readonly file: string | null;
  /** 0–100, only meaningful for `status === "progress" | "progress_total"`. */
  readonly percent: number | null;
  readonly loadedBytes: number | null;
  readonly totalBytes: number | null;
}

function toLoadProgress(info: ProgressInfo): AyasPhoneLlmLoadProgress {
  const withFile = info as { file?: string };
  const withBytes = info as { progress?: number; loaded?: number; total?: number };
  return {
    status: info.status,
    file: typeof withFile.file === "string" ? withFile.file : null,
    percent: typeof withBytes.progress === "number" ? withBytes.progress : null,
    loadedBytes: typeof withBytes.loaded === "number" ? withBytes.loaded : null,
    totalBytes: typeof withBytes.total === "number" ? withBytes.total : null,
  };
}

export type AyasPhoneLlmFailureReason =
  /** Offline AND this exact model was never fully downloaded before — the
   *  one case that needs a distinct message (spec §C/§G): not a bug, just
   *  "bu model bu cihazda henüz indirilmemiş, önce çevrimiçiyken indir". Best-effort:
   *  inferred from `navigator.onLine === false` at the moment of failure, since
   *  Transformers.js does not expose a direct "is this cached?" query — a real
   *  cache hit never reaches the network and so never fails this way. */
  | "offline-no-cache"
  /** The failure message matched a GPU memory/allocation pattern (best-effort
   *  string match on the browser's own WebGPU error — not a guarantee). */
  | "webgpu-allocation-failed"
  | "load-failed"
  | "generation-failed"
  | "disposed";

function classifyFailure(message: string): AyasPhoneLlmFailureReason {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (offline) return "offline-no-cache";
  if (/out of memory|allocation|oom|device was lost|GPUDevice/i.test(message)) return "webgpu-allocation-failed";
  return "load-failed";
}

export type AyasPhoneLlmLoadOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: AyasPhoneLlmFailureReason; readonly detail: string };

export interface AyasPhoneLlmGenerateResult {
  readonly text: string;
  readonly tokenCount: number;
  readonly firstTokenLatencyMs: number | null;
  readonly totalLatencyMs: number;
  readonly cancelled: boolean;
}

export type AyasPhoneLlmGenerateOutcome =
  | ({ readonly ok: true } & AyasPhoneLlmGenerateResult)
  | { readonly ok: false; readonly reason: AyasPhoneLlmFailureReason; readonly detail: string };

/** A `StoppingCriteria` driven by an external flag — the AbortSignal wiring for cancel(). */
class FlagStoppingCriteria extends StoppingCriteria {
  private stopped = false;
  trigger(): void {
    this.stopped = true;
  }
  _call(input_ids: number[][]): boolean[] {
    return input_ids.map(() => this.stopped);
  }
}

type LoadedGenerator = Awaited<ReturnType<typeof pipeline<"text-generation">>>;

export class AyasPhoneLlmRunner {
  private generator: LoadedGenerator | null = null;
  private currentModelId: string | null = null;
  private disposed = false;

  get loadedModelId(): string | null {
    return this.currentModelId;
  }

  async load(model: AyasPhoneLlmModelSpec, onProgress?: (p: AyasPhoneLlmLoadProgress) => void): Promise<AyasPhoneLlmLoadOutcome> {
    if (this.disposed) return { ok: false, reason: "disposed", detail: "runner dispose edildi, yeniden kullanılamaz." };
    try {
      // A previously-loaded model is disposed first — only one resident at a time.
      if (this.generator) {
        await this.generator.dispose().catch(() => {});
        this.generator = null;
        this.currentModelId = null;
      }
      this.generator = await pipeline("text-generation", model.id, {
        device: "webgpu",
        dtype: model.dtype,
        progress_callback: onProgress ? (info: ProgressInfo) => onProgress(toLoadProgress(info)) : undefined,
      });
      this.currentModelId = model.id;
      return { ok: true };
    } catch (error) {
      this.generator = null;
      this.currentModelId = null;
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: classifyFailure(detail), detail };
    }
  }

  /**
   * One prompt in, streamed text out via `onDelta`. `signal` aborted →
   * generation is asked to stop at the next token boundary (best-effort —
   * Transformers.js has no hard mid-token cancel; this sets a
   * `StoppingCriteria` flag, checked between generation steps).
   */
  async generate(
    prompt: string,
    options: { readonly onDelta?: (text: string) => void; readonly signal?: AbortSignal; readonly maxNewTokens?: number } = {},
  ): Promise<AyasPhoneLlmGenerateOutcome> {
    if (this.disposed || !this.generator) {
      return { ok: false, reason: "disposed", detail: "model yüklü değil — önce load() çağrılmalı." };
    }

    const messages: Message[] = [{ role: "user", content: prompt }];
    const stopFlag = new FlagStoppingCriteria();
    const stoppingCriteria = new StoppingCriteriaList();
    stoppingCriteria.push(stopFlag);
    const onAbort = () => stopFlag.trigger();
    options.signal?.addEventListener("abort", onAbort);

    let tokenCount = 0;
    let firstTokenAt: number | null = null;
    let text = "";
    const startedAt = performance.now();

    const streamer = new TextStreamer(this.generator.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (piece: string) => {
        if (firstTokenAt === null) firstTokenAt = performance.now();
        text += piece;
        options.onDelta?.(piece);
      },
      token_callback_function: (tokens: bigint[]) => {
        tokenCount += tokens.length;
      },
    });

    try {
      await this.generator(messages, {
        max_new_tokens: options.maxNewTokens ?? 200,
        do_sample: false,
        streamer,
        stopping_criteria: stoppingCriteria,
      });
      const totalLatencyMs = performance.now() - startedAt;
      return {
        ok: true,
        text: text.trim(),
        tokenCount,
        firstTokenLatencyMs: firstTokenAt === null ? null : firstTokenAt - startedAt,
        totalLatencyMs,
        cancelled: options.signal?.aborted === true,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: error instanceof Error && /out of memory|allocation|oom|device was lost/i.test(detail) ? "webgpu-allocation-failed" : "generation-failed", detail };
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.generator) {
      await this.generator.dispose().catch(() => {});
      this.generator = null;
      this.currentModelId = null;
    }
  }
}

/**
 * Does the browser already have `model`'s weights, without downloading
 * anything? Reads `@huggingface/transformers`'s OWN Cache Storage bucket
 * (`env.cacheKey`, default `"transformers-cache"`, populated because
 * `env.useBrowserCache` defaults to `true` whenever the Cache API exists —
 * verified in `dist/transformers.web.js`, not assumed) — never a second,
 * parallel cache of our own.
 *
 * A cache entry's key is the file's full resolve URL, built from
 * `env.remoteHost` + `env.remotePathTemplate` + the model id + the filename
 * (`buildResourcePaths` in the library — confirmed by reading the source,
 * not guessed). So a cached entry whose URL contains BOTH `model.id` and
 * ends in `.onnx` is the model's weight file specifically — the largest,
 * last-written artifact of a real download (a response is only ever stored
 * after its fetch fully resolves, so a present `.onnx` entry means the
 * download actually completed, not that it merely started).
 *
 * Never downloads, never mutates the cache, never throws — a probe only.
 */
export async function isModelCached(model: AyasPhoneLlmModelSpec): Promise<boolean> {
  if (typeof caches === "undefined" || !env.useBrowserCache) return false;
  try {
    const cache = await caches.open(env.cacheKey);
    const keys = await cache.keys();
    return keys.some((request) => request.url.includes(model.id) && request.url.endsWith(".onnx"));
  } catch {
    return false;
  }
}
