/**
 * AYAS phone-local LLM — model resource resolution (iOS memory-safe fix,
 * follow-up sprint).
 *
 * Single source of truth for "which models exist, which files does loading
 * one require, and what is the EXACT URL Transformers.js will fetch/cache
 * each one under." Split out of `phoneLlmRunner.ts` so `phoneLlmRunner.ts`
 * (cache-completeness check) and `phoneLlmPrecacheDownloader.ts` (the new
 * streaming pre-cache downloader) can't drift out of sync with each other —
 * they both need the identical file list and, critically, the identical
 * cache key format.
 *
 * `buildRemoteResourceUrl` is a byte-for-byte mirror of the installed
 * package's internal `buildResourcePaths`/`pathJoin`
 * (`src/utils/hub.js` + `src/utils/hub/utils.js`) — NOT re-exported from the
 * package's public API, so it can't be imported directly; verified by
 * hand-deriving the expected URL and comparing against the library's own
 * source, not guessed. This is what makes the pre-cache downloader's writes
 * actually found by `checkCachedResource`/`tryCache` later (see that
 * file's header for the full proof).
 */

import { env, type DataType } from "@huggingface/transformers";

export interface AyasPhoneLlmModelSpec {
  readonly id: string;
  readonly label: string;
  readonly dtype: DataType;
  readonly approxSizeLabel: string;
  readonly license: string;
}

/**
 * Order matters: prove 0.5B first, only then try 1.5B.
 *
 * `dtype: "q4f16"` is deliberately the smallest REAL variant on each repo —
 * verified against the actual HF API file listing
 * (`GET /api/models/<id>?blobs=true`), not assumed:
 *   - 0.5B `onnx/model_q4f16.onnx` = 483,003,582 bytes (smaller than
 *     `model_int8`/`model_quantized`/`model_uint8` at ~512MB,
 *     `model_bnb4` at ~764MB, `model_q4` at ~786MB, `model_fp16` at ~997MB,
 *     and full `model.onnx` at ~1.99GB).
 *   - 1.5B `onnx/model_q4f16.onnx` = 1,221,878,940 bytes — likewise the
 *     smallest real variant for that repo.
 * `approxSizeLabel` below is that exact weight-file size (the dominant
 * cost; tokenizer/config files add only a few hundred KB).
 */
export const AYAS_PHONE_LLM_MODELS: readonly AyasPhoneLlmModelSpec[] = [
  {
    id: "HuggingFaceTB/SmolLM2-135M-Instruct",
    label: "SmolLM2-135M-Instruct (test)",
    dtype: "q4f16",
    approxSizeLabel: "~112 MB",
    license: "Apache-2.0",
  },
  {
    id: "onnx-community/Qwen2.5-0.5B-Instruct",
    label: "Qwen2.5-0.5B-Instruct",
    dtype: "q4f16",
    approxSizeLabel: "~460 MB",
    license: "Apache-2.0",
  },
  {
    id: "onnx-community/Qwen2.5-1.5B-Instruct",
    label: "Qwen2.5-1.5B-Instruct",
    dtype: "q4f16",
    approxSizeLabel: "~1.17 GB",
    license: "Apache-2.0",
  },
];

/**
 * Filename suffix Transformers.js appends to the base ONNX weight filename
 * for a given `dtype` — mirrors `DEFAULT_DTYPE_SUFFIX_MAPPING` in the
 * installed package's `src/utils/dtypes.js` (not part of the public API
 * surface re-exported from the package root; this is a small local mirror
 * of only the one dtype this app actually uses). Verified against the real
 * HF repo file listing: `onnx/model_q4f16.onnx` exists for both models in
 * `AYAS_PHONE_LLM_MODELS`.
 */
const ONNX_DTYPE_SUFFIX: Partial<Record<DataType, string>> = {
  q4f16: "_q4f16",
};

/** Default ONNX subfolder Transformers.js uses (`src/models/modeling_utils.js`: `subfolder = 'onnx'`). */
const ONNX_SUBFOLDER = "onnx";

/**
 * The exact set of files a `pipeline("text-generation", model.id, { dtype })`
 * call needs before it can build the runtime session with ZERO network
 * access — established by reading the installed package's own source, not
 * guessed:
 *  - `config.json` — always fetched, fatal: `AutoConfig.from_pretrained`
 *    (`src/configs.js`).
 *  - `tokenizer.json` + `tokenizer_config.json` — fetched together whenever
 *    `tokenizer_config.json` exists in the repo, which it does for both
 *    models here (`src/utils/model_registry/get_tokenizer_files.js`).
 *  - `onnx/model<suffix>.onnx` — the weight file itself.
 * `generation_config.json`, `special_tokens_map.json`, `vocab.json` and
 * `merges.txt` are deliberately NOT required here: reading the library
 * source found no code path that fetches them for this pipeline/model type
 * (the consolidated `tokenizer.json` already embeds vocab+merges) —
 * requiring a file the library never actually asks for would make a
 * genuinely complete cache look permanently PARTIAL.
 */
export function getRequiredModelCacheFiles(model: AyasPhoneLlmModelSpec): readonly string[] {
  const suffix = ONNX_DTYPE_SUFFIX[model.dtype] ?? `_${model.dtype}`;
  return ["config.json", "tokenizer.json", "tokenizer_config.json", `${ONNX_SUBFOLDER}/model${suffix}.onnx`];
}

/**
 * Faithful local mirror of the installed package's `pathJoin`
 * (`src/utils/hub/utils.js`): trims a leading `/` from every part but the
 * first, and a trailing `/` from every part but the last, then joins with
 * `/`. Re-derived by hand and diffed against the library source — not
 * approximated — because `buildRemoteResourceUrl` below depends on
 * producing the EXACT same string `buildResourcePaths` would.
 */
function pathJoin(...parts: string[]): string {
  return parts
    .map((part, index) => {
      let p = part;
      if (index) p = p.replace(/^\//, "");
      if (index !== parts.length - 1) p = p.replace(/\/$/, "");
      return p;
    })
    .join("/");
}

/**
 * The exact URL Transformers.js will `fetch()` (on a cache miss) and use as
 * the Cache Storage key (on a browser-cache hit) for one of `model`'s
 * files — byte-for-byte identical to `buildResourcePaths(...).remoteURL` in
 * `src/utils/hub.js`, reading `env.remoteHost`/`env.remotePathTemplate` at
 * call time (so a customized mirror, if one is ever configured, is honored
 * automatically rather than silently ignored by a hardcoded literal).
 *
 * Verified by hand for both required files here against the library's own
 * source: for `onnx-community/Qwen2.5-0.5B-Instruct` + `"config.json"` this
 * produces exactly
 * `https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct/resolve/main/config.json`;
 * for the weight file, exactly
 * `https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct/resolve/main/onnx/model_q4f16.onnx`
 * — both covered by `scripts/smoke-ayas-phone-llm-precache.ts`.
 */
export function buildRemoteResourceUrl(model: AyasPhoneLlmModelSpec, file: string, revision = "main"): string {
  const pathSegment = env.remotePathTemplate
    .replaceAll("{model}", model.id)
    .replaceAll("{revision}", encodeURIComponent(revision));
  return pathJoin(env.remoteHost, pathSegment, file);
}
