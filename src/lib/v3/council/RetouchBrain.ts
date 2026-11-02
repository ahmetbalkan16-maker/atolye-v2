import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { MIN_FIT_SCORE } from "../backgrounds/BackgroundJudge";
import type { DebateEntry } from "./Council";

/**
 * The retouch brain (Rötuş beyni, owner direction 20 Oct 2026: "hand these fixes to the helper brains, so that they
 * can correct such faults when neither Codex nor Claude is around"). After a finished production it reads what the
 * other brains measured — the side-by-side likeness scores and the set judge's verdicts — and decides on a retouch
 * from a fixed menu, then the production reruns itself from the earliest step concerned (at most MAX_RETOUCH_ROUNDS times):
 * - a real person whose cartoon scored below LIKENESS_OK next to the portrait is redesigned, with the art director's
 *   list of differences as the instruction (the people library keeps both versions);
 * - a set the judge left under its bar is redrawn with fresh seeds.
 * Nothing here changes code, and there are never more than MAX_RETOUCH_ROUNDS rounds, so a production always ends.
 */
export const MAX_RETOUCH_ROUNDS = 2;
/**
 * A likeness below this side-by-side score is redesigned (and not reused by later episodes). Owner decision
 * (20 Oct 2026): "the worst acceptable is 8/10, the best 10/10; everything below gets corrected".
 */
export const LIKENESS_OK = 8;

export interface RetouchPlan {
  /** The round this plan starts (1 = the first retouch). */
  readonly tur: number;
  /** The earliest step to run again. */
  readonly adim: "gardirop" | "gorsel";
  readonly kisiler: readonly { readonly castId: string; readonly kisi: string; readonly puan: number; readonly farklar: readonly string[] }[];
  readonly setler: readonly { readonly sahne: string; readonly neden: string }[];
}

export interface RetouchInput {
  /** Rounds already done (0 after the first production). */
  readonly round: number;
  readonly likenesses: readonly { readonly castId: string; readonly kisi: string; readonly kaynak: string; readonly benzerlik?: number; readonly farklar?: readonly string[] }[];
  readonly sets: readonly { readonly sahne: string; readonly esikAlti?: boolean; readonly secim?: { readonly puan: number; readonly donem?: number; readonly sorun?: string } }[];
}

export function planRetouch(input: RetouchInput): RetouchPlan | undefined {
  if (input.round >= MAX_RETOUCH_ROUNDS) return undefined;
  const kisiler = input.likenesses
    .filter((l) => l.kaynak === "tasarim" && l.benzerlik !== undefined && l.benzerlik < LIKENESS_OK)
    .map((l) => ({ castId: l.castId, kisi: l.kisi, puan: l.benzerlik!, farklar: l.farklar ?? [] }));
  const setler = input.sets
    .filter((s) => s.esikAlti)
    .map((s) => ({ sahne: s.sahne, neden: s.secim ? `hakem ${s.secim.puan}/10, dönem ${s.secim.donem ?? "?"}/10${s.secim.sorun ? ` — ${s.secim.sorun}` : ""}` : "hakem puanı yok" }));
  if (!kisiler.length && !setler.length) return undefined;
  return { tur: input.round + 1, adim: kisiler.length ? "gardirop" : "gorsel", kisiler, setler };
}

/**
 * What one round scored, kept beside its cut (owner, 2 Nov 2026: the Caesar Short's retouch made the likeness worse,
 * 6 → 7 → 6, and the last round was delivered, not the best).
 */
export interface RoundScore {
  readonly tur: number;
  readonly kisiler: readonly { readonly castId: string; readonly puan: number }[];
  readonly setler: readonly { readonly sahne: string; readonly puan: number; readonly gecti: boolean }[];
}

/** A round's scores, from the same measures the retouch decision reads. */
export function roundScore(tur: number, input: Omit<RetouchInput, "round">): RoundScore {
  return {
    tur,
    kisiler: input.likenesses.filter((l) => l.kaynak === "tasarim" && l.benzerlik !== undefined).map((l) => ({ castId: l.castId, puan: l.benzerlik! })),
    setler: input.sets.flatMap((s) => (s.secim ? [{ sahne: s.sahne, puan: Math.min(s.secim.puan, s.secim.donem ?? s.secim.puan), gecti: !s.esikAlti }] : [])),
  };
}

/** How far a round stays under the bars: likeness points below LIKENESS_OK, set points below the judge's bar. */
export function roundShortfall(s: RoundScore): number {
  return s.kisiler.reduce((a, k) => a + Math.max(0, LIKENESS_OK - k.puan), 0) + s.setler.reduce((a, x) => a + (x.gecti ? 0 : Math.max(1, MIN_FIT_SCORE - x.puan)), 0);
}

/** The round to deliver: the least under the bars; a retouch replaces an earlier round only when it scored better. */
export function bestRound(scores: readonly RoundScore[]): RoundScore | undefined {
  return [...scores].sort((a, b) => roundShortfall(a) - roundShortfall(b) || a.tur - b.tur)[0];
}

/** One round in a line (Turkish, for QC.md and KURUL.md). */
export function roundLine(s: RoundScore): string {
  const parts = [...s.kisiler.map((k) => `${k.castId} ${k.puan}/10`), ...s.setler.filter((x) => !x.gecti).map((x) => `${x.sahne} seti ${x.puan}/10`)];
  return `tur ${s.tur}: ${parts.join(", ") || "ölçülen kişi/set yok"} (eşik altı ${roundShortfall(s)} puan)`;
}

/** The files that make a delivered round, besides its video (kept as final-tur<N>.mp4 next to final.mp4). */
export const ROUND_FILES = ["QC.md", "KURUL.md", "yapim-raporu.json", "youtube.json", "aciklama.txt", "CREDITS.md", "altyazi.srt", "kapak.jpg"] as const;

export const roundVideo = (finalName: string, tur: number) => finalName.replace(/\.mp4$/, `-tur${tur}.mp4`);

/** Keeps a finished round — its video, its package and its scores — in `tur<N>/` before the next round overwrites them. */
export async function keepRound(work: string, finalName: string, score: RoundScore): Promise<void> {
  const dir = path.join(work, `tur${score.tur}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.copyFile(path.join(work, finalName), path.join(work, roundVideo(finalName, score.tur)));
  for (const name of ROUND_FILES) if (existsSync(path.join(work, name))) await fs.copyFile(path.join(work, name), path.join(dir, name));
  await fs.writeFile(path.join(dir, "puan.json"), `${JSON.stringify(score, null, 2)}\n`);
}

/** The scores of the rounds kept before round `before`. */
export async function keptRounds(work: string, finalName: string, before: number): Promise<RoundScore[]> {
  const out: RoundScore[] = [];
  for (let tur = 0; tur < before; tur++) {
    const file = path.join(work, `tur${tur}`, "puan.json");
    if (existsSync(file) && existsSync(path.join(work, roundVideo(finalName, tur)))) out.push(JSON.parse(await fs.readFile(file, "utf8")) as RoundScore);
  }
  return out;
}

/** Puts a kept round back as the delivery: its video as `finalName`, its package files in place of the last round's. */
export async function restoreRound(work: string, finalName: string, tur: number): Promise<void> {
  const dir = path.join(work, `tur${tur}`);
  await fs.copyFile(path.join(work, roundVideo(finalName, tur)), path.join(work, finalName));
  for (const name of ROUND_FILES) {
    if (existsSync(path.join(dir, name))) await fs.copyFile(path.join(dir, name), path.join(work, name));
    else await fs.rm(path.join(work, name), { force: true });
  }
}

/** The retouch decision as a council transcript (Turkish, for KURUL.md and AYAS's inbox). */
export function retouchDebate(plan: RetouchPlan): DebateEntry[] {
  return [
    ...plan.kisiler.map((k) => ({ rol: "Sanat yönetmeni", metin: `${k.kisi} portreyle yan yana ${k.puan}/10: ${k.farklar.join("; ") || "fark listesi yok"}` })),
    ...plan.setler.map((s) => ({ rol: "Ortam beyni", metin: `${s.sahne} seti eşiğin altında (${s.neden})` })),
    { rol: "Rötuş beyni", metin: `${plan.tur}. rötuş turu: ${[plan.kisiler.length ? `${plan.kisiler.length} kişi farklarla yeniden tasarlanacak` : "", plan.setler.length ? `${plan.setler.length} set yeni tohumlarla yeniden çizilecek` : ""].filter(Boolean).join(", ")}; üretim "${plan.adim}" adımından bir kez yeniden çalışacak` },
  ];
}
