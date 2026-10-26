import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { BrainId } from "./Council";
import type { RepairAction } from "./RepairBrain";

/**
 * The brains' experience memory (Deneyim hafızası, owner approval 20 Oct 2026: "something the helper brains can always
 * use, that carries our system forward"; idea from mem0, kept to Atölye's own append-only JSON files). Every brain
 * writes down what worked and what failed — a remedy that cured a failure, the reason a set or a part was rejected,
 * what the QC found short in a script, the chief's measures — and reads its relevant lessons before it works next
 * time. So the studio gets a little better with every episode without a coding agent. Nothing here changes code; a
 * lesson only ever becomes data or an instruction in a brain's own prompt.
 */
export interface Lesson {
  readonly tarih: string;
  readonly bolum: string;
  readonly beyin: BrainId;
  /**
   * ilac: a remedy for a failure; ders: why something was rejected; onlem: the chief's measure for next time;
   * kural: a standing rule from the owner's review of a finished video, recalled every time whatever the topic.
   */
  readonly tur: "ilac" | "ders" | "onlem" | "kural";
  /** What it is about: an error signature, a place and period, a part, a step. */
  readonly konu: string;
  readonly metin: string;
  readonly sonuc?: "ise_yaradi" | "ise_yaramadi";
  /** The repair action an "ilac" lesson records. */
  readonly eylem?: RepairAction;
  /**
   * A picture of what the lesson is about (file name in `exampleDir`): a frame where the quality brain missed a fault,
   * shown to it beside the frame it judges next time (owner, 26 Oct 2026: "if it gets it wrong, you do it and the
   * helper brain takes it as experience").
   */
  readonly ornek?: string;
}

const MAX_TEXT = 300;

export function memoryDir(workRoot: string): string {
  return path.join(workRoot, "_kutuphane", "deneyim");
}

/** Where the lessons' example pictures are kept. */
export function exampleDir(workRoot: string): string {
  return path.join(memoryDir(workRoot), "ornek");
}

/** Appends one lesson to its brain's file (append-only, one JSON line per lesson). */
export async function remember(workRoot: string, lesson: Omit<Lesson, "tarih">): Promise<void> {
  const dir = memoryDir(workRoot);
  await fs.mkdir(dir, { recursive: true });
  const line: Lesson = { tarih: new Date().toISOString(), ...lesson, konu: lesson.konu.slice(0, 160), metin: lesson.metin.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT) };
  await fs.appendFile(path.join(dir, `${lesson.beyin}.jsonl`), `${JSON.stringify(line)}\n`);
}

async function readAll(workRoot: string, beyin: BrainId): Promise<Lesson[]> {
  const file = path.join(memoryDir(workRoot), `${beyin}.jsonl`);
  if (!existsSync(file)) return [];
  return (await fs.readFile(file, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as Lesson];
      } catch {
        return [];
      }
    });
}

const words = (s: string) => new Set(s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").split(/[^a-z0-9]+/).filter((w) => w.length > 2));

/** How much two texts share (0..1, Jaccard of their words). */
export function overlap(a: string, b: string): number {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return common / (x.size + y.size - common);
}

export interface OwnerRule {
  readonly beyin: BrainId;
  readonly konu: string;
  readonly metin: string;
  /** Where the rule came from (the owner's review of which video, when). */
  readonly kaynak?: string;
}

/**
 * The owner's standing rules (`content/v3/owner-kurallari.json`, in git) written into the brains' memory as "kural"
 * lessons; a rule already there is not written again. Run at the start of every production, so a new work root (the
 * live runtime) gets them too.
 */
export async function seedRules(workRoot: string, rules: readonly OwnerRule[]): Promise<number> {
  let added = 0;
  for (const r of rules) {
    const text = r.metin.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT).toLowerCase();
    if ((await readAll(workRoot, r.beyin)).some((l) => l.tur === "kural" && l.metin.toLowerCase() === text)) continue;
    await remember(workRoot, { bolum: r.kaynak ?? "owner", beyin: r.beyin, tur: "kural", konu: r.konu, metin: r.metin });
    added++;
  }
  return added;
}

/**
 * Meaning search (owner approval 20 Oct 2026; the idea from ruflo's vector memory, kept to Atölye's own files and a
 * local model): the question and the lessons become vectors of a small embedding model and are compared by cosine, so
 * "a walled hilltop town" finds a lesson about "fortified villages" that shares no word with it. Off by default (word
 * overlap, as before); the production turns it on with `enableMeaningSearch`. Vectors are cached next to the lessons;
 * the first failure turns it off for the rest of the process, so a missing model never stops a production.
 */
export interface Embedder {
  /** Model id, part of the cache file name. */
  readonly name: string;
  embed(texts: readonly string[]): Promise<number[][]>;
}

export const EMBED_MODEL_DEFAULT = "qwen3-embedding:0.6b";
/**
 * Cosine from which a lesson counts as being about the same thing. Calibrated with qwen3-embedding:0.6b on the
 * setting brain's Rubicon lessons (20 Oct 2026): the same place 0.74–0.96, other places 0.39–0.56, short phrases
 * 0.64 related against 0.59 unrelated.
 */
export const MIN_COSINE = 0.62;

/**
 * The local embedding model through Ollama, on the CPU (`num_gpu: 0`): it never takes the vision judge's place on the
 * 12 GB card and is no GPU call under the owner's GPU temperature rule. `ATOLYE_V3_EMBED_MODEL=0` turns it off.
 */
export function ollamaEmbedder(baseUrl: string, model = process.env.ATOLYE_V3_EMBED_MODEL?.trim() || EMBED_MODEL_DEFAULT): Embedder | undefined {
  if (/^(0|kapali|off)$/i.test(model)) return undefined;
  return {
    name: model,
    async embed(texts) {
      const res = await fetch(`${baseUrl}/api/embed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, input: texts, keep_alive: "10m", options: { num_gpu: 0 } }), signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`EMBED_HTTP_${res.status}`);
      const body = (await res.json()) as { embeddings?: unknown };
      if (!Array.isArray(body.embeddings) || body.embeddings.length !== texts.length) throw new Error("EMBED_BAD_RESPONSE");
      return body.embeddings as number[][];
    },
  };
}

let meaning: { embedder?: Embedder; off?: string } = { off: "açılmadı" };

/** Turns meaning search on for this process after one test embedding; returns how recall will search. */
export async function enableMeaningSearch(embedder: Embedder | undefined): Promise<string> {
  if (!embedder) {
    meaning = { off: "kapalı (ATOLYE_V3_EMBED_MODEL=0)" };
    return `kelime araması — ${meaning.off}`;
  }
  try {
    await embedder.embed(["test"]);
    meaning = { embedder };
    return `anlam araması (${embedder.name}, işlemcide)`;
  } catch (e) {
    meaning = { off: (e as Error).message.slice(0, 80) };
    return `kelime araması — ${embedder.name} kullanılamadı (${meaning.off})`;
  }
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const textKey = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 20);

/** Cosine of `query` to each text, or undefined when meaning search is off or fails (then it stays off). */
async function cosines(workRoot: string, query: string, texts: readonly string[]): Promise<number[] | undefined> {
  const e = meaning.embedder;
  if (!e) return undefined;
  const file = path.join(memoryDir(workRoot), `.anlam-${e.name.replace(/[^a-z0-9]+/gi, "-")}.json`);
  try {
    const cache: Record<string, number[]> = existsSync(file) ? (JSON.parse(await fs.readFile(file, "utf8")) as Record<string, number[]>) : {};
    const missing = [...new Set(texts.filter((t) => !cache[textKey(t)]))];
    for (let i = 0; i < missing.length; i += 32) {
      const part = missing.slice(i, i + 32);
      (await e.embed(part)).forEach((v, j) => (cache[textKey(part[j]!)] = v));
    }
    if (missing.length) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(`${file}.tmp`, JSON.stringify(cache));
      await fs.rename(`${file}.tmp`, file);
    }
    const [q] = await e.embed([query]);
    return texts.map((t) => cosine(q!, cache[textKey(t)]!));
  } catch (err) {
    meaning = { off: (err as Error).message.slice(0, 80) };
    return undefined;
  }
}

/** At most this many standing rules go into one prompt (the newest when there are more). */
export const MAX_RULES = 8;

/**
 * A brain's lessons about `konu`, most relevant first (meaning when meaning search is on, else shared words; newer
 * wins a tie), each text once; a lesson is relevant when it shares enough words OR is close enough in meaning. Without
 * `konu` the newest come first. The owner's standing rules ("kural") come first and do not count against `limit`
 * whenever no type is asked for; a type filter ("ders") leaves them out.
 */
export async function recall(workRoot: string, beyin: BrainId, opts: { readonly konu?: string; readonly tur?: Lesson["tur"]; readonly limit?: number; readonly minOverlap?: number; readonly minCosine?: number } = {}): Promise<Lesson[]> {
  const everything = await readAll(workRoot, beyin);
  const seen = new Set<string>();
  const once = (l: Lesson) => {
    const key = l.metin.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  const rules = !opts.tur || opts.tur === "kural" ? everything.filter((l) => l.tur === "kural").reverse().filter(once).slice(0, MAX_RULES).reverse() : [];
  if (opts.tur === "kural") return rules;
  const all = everything.filter((l) => l.tur !== "kural" && (!opts.tur || l.tur === opts.tur));
  const scored = all.map((l, i) => ({ l, s: opts.konu ? Math.max(overlap(opts.konu, l.konu), overlap(opts.konu, l.metin)) : 0, i, c: -1 }));
  const cos = opts.konu && scored.length ? await cosines(workRoot, opts.konu, scored.map((x) => `${x.l.konu} — ${x.l.metin}`)) : undefined;
  if (cos) scored.forEach((x, j) => (x.c = cos[j]!));
  const relevant = opts.konu ? scored.filter((x) => x.s >= (opts.minOverlap ?? 0.12) || x.c >= (opts.minCosine ?? MIN_COSINE)) : scored;
  relevant.sort((a, b) => (cos ? b.c - a.c : 0) || b.s - a.s || b.i - a.i);
  const out: Lesson[] = [];
  for (const { l } of relevant) {
    if (!once(l)) continue;
    out.push(l);
    if (out.length >= (opts.limit ?? 5)) break;
  }
  return [...rules, ...out];
}

/**
 * The stable part of an error message, so the same failure is recognised next time: numbers, paths, hashes and
 * quoted names are dropped.
 */
export function errorSignature(error: string): string {
  return error
    .replace(/[A-Za-z]:[\\/][^\s"'`]+/g, "<yol>")
    .replace(/\/[^\s"'`]+\/[^\s"'`]+/g, "<yol>")
    .replace(/["'`][^"'`]{1,80}["'`]/g, "<ad>")
    .replace(/\b[0-9a-f]{8,}\b/gi, "<hash>")
    .replace(/\d+(\.\d+)?/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/**
 * A remedy that cured this failure before (same step, same signature, last outcome "worked"), or undefined. A remedy
 * whose latest use did not work is not repeated.
 */
export async function learnedRemedy(workRoot: string, step: string, error: string): Promise<RepairAction | undefined> {
  const sig = `${step} | ${errorSignature(error)}`;
  const same = (await readAll(workRoot, "onarim")).filter((l) => l.tur === "ilac" && l.konu === sig && l.eylem);
  const last = same[same.length - 1];
  return last?.sonuc === "ise_yaradi" ? last.eylem : undefined;
}

export function remedyTopic(step: string, error: string): string {
  return `${step} | ${errorSignature(error)}`;
}
