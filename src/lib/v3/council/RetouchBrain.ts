import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { MIN_FIT_SCORE } from "../backgrounds/BackgroundJudge";
import { PRODUCTION_STEPS } from "../orders/ProductionOrders";
import type { DebateEntry } from "./Council";
import { type DirectorDecision, editLine, editsStep } from "./DirectorCouncil";

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
  readonly adim: "gardirop" | "ses" | "gorsel" | "render";
  readonly kisiler: readonly { readonly castId: string; readonly kisi: string; readonly puan: number; readonly farklar: readonly string[] }[];
  readonly setler: readonly { readonly sahne: string; readonly neden: string }[];
  /** AYAS's fixes from the director's council (DirectorCouncil), applied to the script before the round runs. */
  readonly yonetmen?: DirectorDecision;
}

const stepIndex = (s: RetouchPlan["adim"]) => PRODUCTION_STEPS.indexOf(s);

/**
 * The retouch round with AYAS's fixes added: one round for both (they share MAX_RETOUCH_ROUNDS), from the earlier of
 * the two steps; a set AYAS changes is drawn anew like a set under the judge's bar.
 */
export function withDirector(plan: RetouchPlan | undefined, round: number, decision: DirectorDecision): RetouchPlan | undefined {
  const step = editsStep(decision.duzeltmeler);
  if (!step) return plan;
  const sets = decision.duzeltmeler.flatMap((e) => (e.tur === "set" && !plan?.setler.some((s) => s.sahne === e.sahne) ? [{ sahne: e.sahne, neden: `AYAS: ${e.neden || "set değişiyor"}` }] : []));
  const adim = plan && stepIndex(plan.adim) <= stepIndex(step) ? plan.adim : step;
  return { tur: plan?.tur ?? round + 1, adim, kisiler: plan?.kisiler ?? [], setler: [...(plan?.setler ?? []), ...sets], yonetmen: decision };
}

export interface RetouchInput {
  /** Rounds already done (0 after the first production). */
  readonly round: number;
  readonly likenesses: readonly { readonly castId: string; readonly kisi: string; readonly kaynak: string; readonly benzerlik?: number; readonly farklar?: readonly string[] }[];
  readonly sets: readonly { readonly sahne: string; readonly esikAlti?: boolean; readonly secim?: { readonly puan: number; readonly donem?: number; readonly sorun?: string } }[];
  /** People whose likeness is stuck (LikenessDesigner.likenessPlateau): no round is opened for them. */
  readonly plateau?: ReadonlySet<string>;
}

export function planRetouch(input: RetouchInput): RetouchPlan | undefined {
  if (input.round >= MAX_RETOUCH_ROUNDS) return undefined;
  const kisiler = input.likenesses
    .filter((l) => l.kaynak === "tasarim" && l.benzerlik !== undefined && l.benzerlik < LIKENESS_OK && !input.plateau?.has(l.castId))
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
  /** The director's council mean for this cut (1..10), when the council sat. */
  readonly kurul?: number;
  /**
   * The measured faults of this cut (cutFaults): its open QC checks plus the render's layout and pixel faults. Missing
   * on rounds scored before 11 Nov 2026 and on a round whose layout or pixel check could not run.
   */
  readonly kusurlar?: number;
}

/**
 * The measured faults of a cut, the retouch brain's second key between rounds (11 Nov 2026: over the last seven videos
 * the council's mean was 7 in every round but two — Taranto 7, 7, 7; Gallipoli 7, 7; Cannae 7, 7; Zanzibar 7, 6.8 — so
 * the delivered round was decided by "the earlier wins", while the open QC checks moved: Taranto 5 → 2 → 2, Gallipoli
 * 3 → 4, Cannae 4 → 3). Counted: every open QC check of the cut (`openChecks`; the caller leaves out the rows that
 * restate the likeness and set shortfall — already the first key — and the standing ones no retouch round can change:
 * the script step's fact check, which a retouch never reruns, and the cover, which is not the cut) and every box the
 * render's layout check and every defect its pixel check found. Not counted: the vision model's frame verdicts and its
 * "told but not shown" notes — an opinion, like the council's mean (Gallipoli's sampled frames went from 2 faulty to 0
 * between two cuts whose layout faults stayed 2). Undefined when the layout or the pixel check did not run, so a round
 * is never favoured for a check that failed. Counted so, the kept rounds were Taranto 5 → 4 → 4, Gallipoli 4 → 5,
 * Cannae 3 → 2 and Zanzibar 2 → 2: none of them would have been delivered differently (the bars or the earlier round
 * already decided), but Gallipoli's retouch round was worse by this count too.
 */
export function cutFaults(openChecks: number, layout: number | undefined, pixel: number | undefined): number | undefined {
  return layout === undefined || pixel === undefined ? undefined : openChecks + layout + pixel;
}

/** A round's scores, from the same measures the retouch decision reads (and the council's mean, when it sat). */
export function roundScore(tur: number, input: Omit<RetouchInput, "round">, kurul?: number, kusurlar?: number): RoundScore {
  return {
    tur,
    kisiler: input.likenesses.filter((l) => l.kaynak === "tasarim" && l.benzerlik !== undefined).map((l) => ({ castId: l.castId, puan: l.benzerlik! })),
    setler: input.sets.flatMap((s) => (s.secim ? [{ sahne: s.sahne, puan: Math.min(s.secim.puan, s.secim.donem ?? s.secim.puan), gecti: !s.esikAlti }] : [])),
    ...(kurul !== undefined && kurul > 0 ? { kurul } : {}),
    ...(kusurlar !== undefined ? { kusurlar } : {}),
  };
}

/** How far a round stays under the bars: likeness points below LIKENESS_OK, set points below the judge's bar. */
export function roundShortfall(s: RoundScore): number {
  return s.kisiler.reduce((a, k) => a + Math.max(0, LIKENESS_OK - k.puan), 0) + s.setler.reduce((a, x) => a + (x.gecti ? 0 : Math.max(1, MIN_FIT_SCORE - x.puan)), 0);
}

/** Fewer measured faults first; 0 (the key skipped) when either round lacks the count. */
const faultOrder = (a: RoundScore, b: RoundScore) => (a.kusurlar !== undefined && b.kusurlar !== undefined ? a.kusurlar - b.kusurlar : 0);

/** Below 0 when round `a` is the better one to deliver. */
const roundOrder = (a: RoundScore, b: RoundScore) => roundShortfall(a) - roundShortfall(b) || faultOrder(a, b) || (b.kurul ?? 0) - (a.kurul ?? 0) || a.tur - b.tur;

/**
 * The rounds as they are compared, in round order: a person scored in an earlier round and not scored in a later one
 * carries their last score into it. `kisiler` holds only the people this round's wardrobe step designed and checked,
 * so a person drops out when the side-by-side check could not run (its records keep no score), when the redesign's
 * sheet could not be read ("degismedi"), or when a stuck likeness is reused from the people library (kaynak
 * "kutuphane") while another person's redesign reruns the wardrobe — and that round's shortfall fell with nothing
 * redrawn better. Checked on 11 Nov 2026 against the kept rounds: the people missing from a later round (Taranto's
 * andrew-cunningham 9/10, Gallipoli's liman-von-sanders and hamilton 8/10) were all at the bar and reused from the
 * library, so no delivered round changes; the carried score keeps the three paths above from deciding one.
 */
export function comparableRounds(scores: readonly RoundScore[]): RoundScore[] {
  const last = new Map<string, number>();
  return [...scores]
    .sort((a, b) => a.tur - b.tur)
    .map((s) => {
      const carried = [...last].filter(([castId]) => !s.kisiler.some((k) => k.castId === castId)).map(([castId, puan]) => ({ castId, puan }));
      for (const k of s.kisiler) last.set(k.castId, k.puan);
      return carried.length ? { ...s, kisiler: [...s.kisiler, ...carried] } : s;
    });
}

/**
 * The round to deliver: the least under the bars (comparableRounds), then the fewer measured faults (cutFaults,
 * 11 Nov 2026: the council's mean was a tie in nearly every round), then the council's higher mean (AYAS's revision of
 * lines, acts and sets is judged by the same council); a retouch replaces an earlier round only when it scored better.
 * Rounds are taken in their order and each must beat the best so far: a round without the fault count (kept before it
 * existed) skips that key, and the skipped key would make a sort's order depend on how the rounds were listed. The
 * round is returned as it was scored (without carried people).
 */
export function bestRound(scores: readonly RoundScore[]): RoundScore | undefined {
  const best = comparableRounds(scores).reduce<RoundScore | undefined>((b, s) => (!b || roundOrder(s, b) < 0 ? s : b), undefined);
  return best && scores.find((s) => s.tur === best.tur);
}

/**
 * Why the delivered round beat a round that was as far under the bars, when the measured faults decided it (Turkish,
 * for the retouch brain's log): "ölçülen kusur: tur 1 2, tur 0 4". Undefined when the faults did not decide.
 */
export function faultsDecided(scores: readonly RoundScore[]): string | undefined {
  const rounds = comparableRounds(scores);
  const best = bestRound(scores);
  const fewest = best?.kusurlar;
  if (!best || fewest === undefined) return undefined;
  const shortfall = roundShortfall(rounds.find((s) => s.tur === best.tur)!);
  const beaten = rounds.filter((s) => s.tur !== best.tur && roundShortfall(s) === shortfall && s.kusurlar !== undefined && s.kusurlar > fewest);
  return beaten.length ? `ölçülen kusur: ${[best, ...beaten].map((s) => `tur ${s.tur} ${s.kusurlar}`).join(", ")}` : undefined;
}

/**
 * Whether a retouch round earned another one: only a round better than every round before it (owner, 3 Nov 2026,
 * after the Caesar Short's likeness went 7 → 6 → 4 on the judge's contradicting notes: "it must stop by itself and
 * know it"). A tie keeps the earlier round, so a round that changed nothing stops too.
 */
export function roundImproved(earlier: readonly RoundScore[], current: RoundScore): boolean {
  return !earlier.length || bestRound([...earlier, current])!.tur === current.tur;
}

/**
 * What a retouch round taught the costume brain about each person it redesigned, so the designer does not repeat a
 * change that made the cartoon less like the portrait (English: it goes into the designer's prompt).
 */
export function likenessLessons(plan: Pick<RetouchPlan, "kisiler">, current: RoundScore, donem: string, tarifOf: (castId: string) => string | undefined): { konu: string; metin: string; sonuc: "ise_yaradi" | "ise_yaramadi" }[] {
  return plan.kisiler.flatMap((k) => {
    const now = current.kisiler.find((x) => x.castId === k.castId)?.puan;
    if (now === undefined) return [];
    const notes = k.farklar.length ? `the notes "${k.farklar.join("; ")}"` : "no notes";
    const design = tarifOf(k.castId);
    const result = now > k.puan ? `raised the likeness ${k.puan} → ${now}/10` : now < k.puan ? `lowered the likeness ${k.puan} → ${now}/10 — do not repeat that change, keep the earlier design's features` : `left the likeness at ${now}/10 — those notes did not help`;
    return [{ konu: `${k.kisi} ${donem} benzerlik`, metin: `${k.kisi} (${donem}): redesigning from ${notes} ${result}${design ? ` (design: "${design}")` : ""}.`, sonuc: now > k.puan ? ("ise_yaradi" as const) : ("ise_yaramadi" as const) }];
  });
}

/** One round in a line (Turkish, for QC.md and KURUL.md). */
export function roundLine(s: RoundScore): string {
  const parts = [...s.kisiler.map((k) => `${k.castId} ${k.puan}/10`), ...s.setler.filter((x) => !x.gecti).map((x) => `${x.sahne} seti ${x.puan}/10`)];
  return `tur ${s.tur}: ${parts.join(", ") || "ölçülen kişi/set yok"} (eşik altı ${roundShortfall(s)} puan)${s.kusurlar !== undefined ? `, ${s.kusurlar} ölçülen kusur` : ""}${s.kurul !== undefined ? `, kurul ${s.kurul}/10` : ""}`;
}

/**
 * A kept round was judged while a retouch was still to come, so its QC says "teslim edildi" even when a likeness or a
 * set stayed under the bar; after the last round that shortfall is final (Caesar, 2 Nov 2026: 7/10 in all three
 * rounds, the first one delivered as if nothing were missing).
 */
export function finalDelivery(qc: string, best: RoundScore): string {
  if (roundShortfall(best) === 0) return qc;
  return qc.replace(/^- Teslim: teslim edildi$/m, `- Teslim: UYARIYLA teslim — rötuş turlarından sonra eşik altında kaldı (${roundLine(best)})`);
}

/** The files that make a delivered round, besides its video (kept as final-tur<N>.mp4 next to final.mp4). */
export const ROUND_FILES = ["QC.md", "KURUL.md", "yapim-raporu.json", "youtube.json", "aciklama.txt", "CREDITS.md", "altyazi.srt", "kapak.jpg"] as const;
/**
 * Kept with a round and put back only when the round has them: the script the round was made from (AYAS's revision
 * changes it) and its council transcript. A round kept before these existed never deletes the current ones.
 */
export const ROUND_FILES_IF_KEPT = ["episode.json", "yonetmen-kurulu.json", "olcum.json"] as const;

export const roundVideo = (finalName: string, tur: number) => finalName.replace(/\.mp4$/, `-tur${tur}.mp4`);

/** Keeps a finished round — its video, its package and its scores — in `tur<N>/` before the next round overwrites them. */
export async function keepRound(work: string, finalName: string, score: RoundScore): Promise<void> {
  const dir = path.join(work, `tur${score.tur}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.copyFile(path.join(work, finalName), path.join(work, roundVideo(finalName, score.tur)));
  for (const name of [...ROUND_FILES, ...ROUND_FILES_IF_KEPT]) if (existsSync(path.join(work, name))) await fs.copyFile(path.join(work, name), path.join(dir, name));
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
  for (const name of ROUND_FILES_IF_KEPT) if (existsSync(path.join(dir, name))) await fs.copyFile(path.join(dir, name), path.join(work, name));
}

/**
 * A retouch round that failed no longer loses the video (the third Caesar Short, 3 Nov 2026: OpenAI answered 429 to
 * the last round's cover four times and the whole order failed with two finished cuts on disk): the best round kept
 * before it is put back and delivered with a warning, as the last round would have delivered it. Undefined when no
 * round was kept. The caller links the upload file again.
 */
export async function deliverAfterFailedRound(work: string, finalName: string, failed: number, why: string): Promise<RoundScore | undefined> {
  const rounds = await keptRounds(work, finalName, failed);
  const best = bestRound(rounds);
  if (!best) return undefined;
  await restoreRound(work, finalName, best.tur);
  const qc = path.join(work, "QC.md");
  if (existsSync(qc)) await fs.writeFile(qc, finalDelivery(await fs.readFile(qc, "utf8"), best));
  const section = `\n## Rötuş turları\n\n${rounds.map((r) => `- ${roundLine(r)}${r.tur === best.tur ? " — **teslim edilen**" : ""}`).join("\n")}\n- Tur ${failed} başarısız oldu (${why}); teslim: tur ${best.tur} (${roundVideo(finalName, best.tur)})\n`;
  for (const name of ["QC.md", "KURUL.md"]) if (existsSync(path.join(work, name))) await fs.appendFile(path.join(work, name), section);
  return best;
}

/** The retouch decision as a council transcript (Turkish, for KURUL.md and AYAS's inbox). */
export function retouchDebate(plan: RetouchPlan): DebateEntry[] {
  return [
    ...plan.kisiler.map((k) => ({ rol: "Sanat yönetmeni", metin: `${k.kisi} portreyle yan yana ${k.puan}/10: ${k.farklar.join("; ") || "fark listesi yok"}` })),
    ...plan.setler.filter((s) => !s.neden.startsWith("AYAS:")).map((s) => ({ rol: "Ortam beyni", metin: `${s.sahne} seti eşiğin altında (${s.neden})` })),
    ...(plan.yonetmen?.duzeltmeler.length ? [{ rol: "AYAS (yönetmen)", metin: plan.yonetmen.duzeltmeler.map(editLine).join(" · ") }] : []),
    { rol: "Rötuş beyni", metin: `${plan.tur}. rötuş turu: ${[plan.kisiler.length ? `${plan.kisiler.length} kişi farklarla yeniden tasarlanacak` : "", plan.setler.length ? `${plan.setler.length} set yeni tohumlarla yeniden çizilecek` : "", plan.yonetmen?.duzeltmeler.length ? `AYAS'ın ${plan.yonetmen.duzeltmeler.length} düzeltmesi uygulanacak` : ""].filter(Boolean).join(", ")}; üretim "${plan.adim}" adımından bir kez yeniden çalışacak` },
  ];
}
