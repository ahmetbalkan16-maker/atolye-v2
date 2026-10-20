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
  /** ilac: a remedy for a failure; ders: why something was rejected; onlem: the chief's measure for next time. */
  readonly tur: "ilac" | "ders" | "onlem";
  /** What it is about: an error signature, a place and period, a part, a step. */
  readonly konu: string;
  readonly metin: string;
  readonly sonuc?: "ise_yaradi" | "ise_yaramadi";
  /** The repair action an "ilac" lesson records. */
  readonly eylem?: RepairAction;
}

const MAX_TEXT = 300;

export function memoryDir(workRoot: string): string {
  return path.join(workRoot, "_kutuphane", "deneyim");
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

/**
 * A brain's lessons about `konu`, most relevant first (shared words; newer wins a tie), each text once. Without
 * `konu` the newest come first.
 */
export async function recall(workRoot: string, beyin: BrainId, opts: { readonly konu?: string; readonly tur?: Lesson["tur"]; readonly limit?: number; readonly minOverlap?: number } = {}): Promise<Lesson[]> {
  const all = (await readAll(workRoot, beyin)).filter((l) => !opts.tur || l.tur === opts.tur);
  const scored = all.map((l, i) => ({ l, s: opts.konu ? Math.max(overlap(opts.konu, l.konu), overlap(opts.konu, l.metin)) : 0, i }));
  const relevant = opts.konu ? scored.filter((x) => x.s >= (opts.minOverlap ?? 0.12)) : scored;
  relevant.sort((a, b) => b.s - a.s || b.i - a.i);
  const seen = new Set<string>();
  const out: Lesson[] = [];
  for (const { l } of relevant) {
    const key = l.metin.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
    if (out.length >= (opts.limit ?? 5)) break;
  }
  return out;
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
