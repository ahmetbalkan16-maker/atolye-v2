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
 * PERSISTENCE (Cache Storage blocker closure sprint): real iPhone testing
 * proved `Cache.put()` cannot reliably persist the ~460MB weight file
 * (`cache-put-timeout` at exactly the 180s bound, after DOWNLOAD had
 * already completed). Cache Storage is retired for model weights — this
 * module now sets `env.useCustomCache = true` / `env.customCache =
 * phoneLlmIdbCache` at module load (below), a real, public, documented
 * Transformers.js extension point (`src/utils/cache.js`'s `getCache()`
 * checks `useCustomCache` FIRST, before `useBrowserCache`/Cache Storage —
 * source-verified). `phoneLlmIdbCache.ts` is backed by
 * `phoneLlmIdbStorage.ts` — chunked IndexedDB, never one big write.
 * `env.useBrowserCache = false` is set explicitly too, so Cache Storage is
 * never touched for model files at all (it may still be used by the app
 * shell/SW for small static assets — unrelated, untouched). No fallback to
 * Cache Storage exists in this design on purpose.
 */

import {
  pipeline,
  TextStreamer,
  StoppingCriteria,
  StoppingCriteriaList,
  env,
  type Message,
  type ProgressInfo,
} from "@huggingface/transformers";

import { getRequiredModelCacheFiles, buildRemoteResourceUrl, type AyasPhoneLlmModelSpec } from "./phoneLlmModelResources";
import { recordPhoneLlmCheckpoint } from "./phoneLlmDiagnostics";
import { phoneLlmIdbCache } from "./phoneLlmIdbCache";
import { getFileIdbStatus, isIndexedDbAvailable } from "./phoneLlmIdbStorage";
import { withTimeout } from "./phoneLlmTiming";

export { AYAS_PHONE_LLM_MODELS, type AyasPhoneLlmModelSpec } from "./phoneLlmModelResources";

// Module-load-time wiring — see header comment. Must happen before any
// `pipeline()`/`getModelFile()` call; importing this module (which
// `PhoneLlmLabClient.tsx` does unconditionally) is early enough.
env.useCustomCache = true;
env.customCache = phoneLlmIdbCache;
env.useBrowserCache = false;

/** `pipeline()` (tokenizer construction + ONNX session/WebGPU init) must settle within this long — a NEW bound (closure sprint item 7's "runtime timeout"): previously unbounded. Generous: on a cache-only load (every file already verified present) this is local disk + GPU init, not network — real devices should finish in low tens of seconds, not minutes. */
const RUNTIME_LOAD_TIMEOUT_MS = 120_000;

/**
 * `status` widens `ProgressInfo["status"]` with a synthetic, UI-only phase
 * marker `phoneLlmPrecacheDownloader.ts` emits between the real library
 * statuses (which only ever cover "fetching" and "fully done" — they have
 * no notion of "now verifying what was written", introduced by the
 * closure-sprint state machine). `toLoadProgress` below (the ONLY producer
 * fed by the real library) never emits it — it exists purely so
 * `phoneLlmPrecacheDownloader.ts` can report its VERIFYING phase through
 * the same progress channel the UI already consumes. Real, chunk-granular
 * "progress" events now carry an accurate live percentage for the
 * download itself (each chunk is its own Range request/IndexedDB write —
 * see that file's header), unlike the old Cache-Storage-backed design.
 */
export interface AyasPhoneLlmLoadProgress {
  readonly status: ProgressInfo["status"] | "persisting" | "verifying";
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
  /** `pipeline()` neither resolved nor rejected within `RUNTIME_LOAD_TIMEOUT_MS` — bounds what would otherwise be an indefinite wait (closure sprint item 7). As with the pre-cache downloader's timeouts, the real `pipeline()` call may still be running in the background afterward; a retry's own cache-hit path is what makes giving up here safe rather than wasteful. */
  | "runtime-timeout"
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
      recordPhoneLlmCheckpoint("runtime:start", { modelId: model.id });
      this.generator = await withTimeout(
        pipeline("text-generation", model.id, {
          device: "webgpu",
          dtype: model.dtype,
          progress_callback: onProgress ? (info: ProgressInfo) => onProgress(toLoadProgress(info)) : undefined,
        }),
        RUNTIME_LOAD_TIMEOUT_MS,
        "pipeline() runtime init",
      );
      this.currentModelId = model.id;
      recordPhoneLlmCheckpoint("runtime:end", { modelId: model.id });
      return { ok: true };
    } catch (error) {
      this.generator = null;
      this.currentModelId = null;
      const detail = error instanceof Error ? error.message : String(error);
      const timedOut = detail.includes("timed out");
      return { ok: false, reason: timedOut ? "runtime-timeout" : classifyFailure(detail), detail };
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
    recordPhoneLlmCheckpoint("generation:start", { modelId: this.currentModelId });

    const streamer = new TextStreamer(this.generator.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (piece: string) => {
        if (firstTokenAt === null) {
          firstTokenAt = performance.now();
          recordPhoneLlmCheckpoint("generation:first-token", { modelId: this.currentModelId });
        }
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
      recordPhoneLlmCheckpoint("generation:end", { modelId: this.currentModelId });
      return {
        ok: true,
        text: text.trim(),
        tokenCount,
        firstTokenLatencyMs: firstTokenAt === null ? null : firstTokenAt - startedAt,
        totalLatencyMs,
        cancelled: options.signal?.aborted === true,
      };
    } catch (error) {
      recordPhoneLlmCheckpoint("generation:end", { modelId: this.currentModelId });
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

/** Tri-state storage readiness: "none" → nothing tried yet; "partial" → some but not all required files are fully downloaded+verified in IndexedDB (a previous attempt was cut off mid-way — safe to resume, unsafe to treat as ready); "complete" → every required file is verified present, so a `runner.load()` call will need zero network access. */
export type AyasPhoneLlmCacheStatus = "none" | "partial" | "complete";

/**
 * Does IndexedDB already hold EVERY file `model` needs, fully verified,
 * without downloading anything? Reads `phoneLlmIdbStorage.ts`'s meta
 * records (one per required file, keyed by that file's exact resolve URL —
 * the same key `phoneLlmPrecacheDownloader.ts` writes under and
 * `phoneLlmIdbCache.ts`'s `match()` reads from). A file only ever has
 * `complete: true` after every chunk was written AND verified (see that
 * module's VERIFYING phase) — this can never report "complete" for a
 * download cut off mid-way, the same guarantee the old Cache
 * Storage–backed version made, now backed by the storage layer that
 * replaced it.
 *
 * Never downloads, never mutates storage, never throws — a probe only.
 */
export async function getModelCacheStatus(model: AyasPhoneLlmModelSpec): Promise<AyasPhoneLlmCacheStatus> {
  if (!isIndexedDbAvailable()) return "none";
  try {
    const required = getRequiredModelCacheFiles(model);
    let presentCount = 0;
    for (const file of required) {
      const status = await getFileIdbStatus(buildRemoteResourceUrl(model, file));
      if (status === "complete") presentCount += 1;
    }
    if (presentCount === 0) return "none";
    return presentCount === required.length ? "complete" : "partial";
  } catch {
    return "none";
  }
}

/**
 * Convenience boolean wrapper around {@link getModelCacheStatus} for callers
 * that only care about the binary "safe to load with zero network access"
 * question. Prefer `getModelCacheStatus` directly when a PARTIAL cache needs
 * to be handled differently from no cache at all.
 */
export async function isModelCached(model: AyasPhoneLlmModelSpec): Promise<boolean> {
  return (await getModelCacheStatus(model)) === "complete";
}
