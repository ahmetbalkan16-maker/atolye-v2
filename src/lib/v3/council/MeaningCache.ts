import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { resolveOllamaConfig } from "../../ai/OllamaConfig";
import { cosine, type Embedder, ollamaEmbedder } from "./ExperienceMemory";

/**
 * Meaning vectors kept on disk for texts the studio compares again and again — past changes' tasks, proposal titles —
 * so a comparison embeds only what is new (qwen3-embedding on the CPU, ExperienceMemory's embedder). The cache file is
 * one per model, keyed by a hash of the text. Watcher processes only: the live server never imports this (it reaches
 * the network and writes files).
 */
const key = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 20);

/** The local embedder, or undefined when it is switched off (`ATOLYE_V3_EMBED_MODEL=0`). */
export function localEmbedder(): Embedder | undefined {
  return ollamaEmbedder(resolveOllamaConfig().baseUrl);
}

/** The cache file for one model inside `dir`. */
export const vectorFile = (dir: string, e: Pick<Embedder, "name">) => path.join(dir, `.anlam-${e.name.replace(/[^a-z0-9]+/gi, "-")}.json`);

/** Each text's vector (texts not yet in the cache are embedded 32 at a time, then the cache is written atomically). */
export async function cachedVectors(file: string, texts: readonly string[], e: Embedder): Promise<Map<string, number[]>> {
  const cache: Record<string, number[]> = existsSync(file) ? (JSON.parse(await fs.readFile(file, "utf8")) as Record<string, number[]>) : {};
  const missing = [...new Set(texts.filter((t) => !cache[key(t)]))];
  for (let i = 0; i < missing.length; i += 32) {
    const part = missing.slice(i, i + 32);
    (await e.embed(part)).forEach((v, j) => (cache[key(part[j]!)] = v));
  }
  if (missing.length) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(`${file}.tmp`, JSON.stringify(cache));
    await fs.rename(`${file}.tmp`, file);
  }
  return new Map(texts.map((t) => [t, cache[key(t)]!]));
}

/** The items most alike in meaning to `query`, best first, with their cosine. */
export function nearestByMeaning<T>(query: readonly number[], items: readonly { readonly item: T; readonly v: readonly number[] | undefined }[], k: number): { item: T; benzerlik: number }[] {
  return items
    .flatMap((x) => (x.v ? [{ item: x.item, benzerlik: cosine(query, x.v) }] : []))
    .sort((a, b) => b.benzerlik - a.benzerlik)
    .slice(0, k);
}

export { cosine };
