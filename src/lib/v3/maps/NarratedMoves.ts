/**
 * Close-battle moves told in the narrator's order (owner, 9 Nov 2026, before the Hannibal long video: "anlatıma göre
 * askerlerin dizilişi yaptığı hamleler birbirine tutarlı olması lazım; anlatırken videoda başka hareket veya gösterim
 * olmaması lazım"). Measured on the Cannae Short: on one narrator's line ("Hannibal's center bulges forward, then gives
 * ground. The Romans push in") all six units set off at the line's first frame — both cavalries swapping flanks, both
 * African wings turning, four arrows at once — and a unit told to hold turned on its place as the enemy moved. Here:
 *
 * - a unit that holds (`tut`, or no move and the same place) keeps its formation exactly — no drift, no turning;
 * - two formations a unit was given for the same line are one step (the first one's losses vanished at once);
 * - on a line, a unit sets off on the word that names it; the units the line does not name follow one after another
 *   once the named ones are under way, so the moves come one by one, in the order told.
 *
 * Pure: no file, no model. MapBuilder gives it the units it built, what each step came from, and the line timings.
 */

type XY = { readonly x: number; readonly y: number };

/** A unit's step as MapBuilder builds it (frames local to the shot). */
export interface MoveStep {
  readonly start: number;
  readonly points: readonly XY[];
  readonly alive: number;
  readonly losses?: readonly number[];
  readonly rout?: boolean;
  readonly label?: string;
  readonly via?: XY;
  readonly through?: readonly number[];
}

/** What a step came from: its line, and whether the unit holds its place on it. */
export interface StepSource {
  readonly satir: number;
  readonly hold: boolean;
}

/** A unit as the narration names it. */
export interface MoveUnit<S extends MoveStep> {
  readonly side: string;
  readonly name?: string;
  readonly kind?: string;
  readonly steps: readonly S[];
}

export interface LineTimes {
  /** The frame a line starts. */
  readonly start: (line: number) => number;
  /** The frame it ends (undefined: unknown). */
  readonly end: (line: number) => number | undefined;
  /** The frame a word matching `word` is told in that line or near it (Director.toldWordAt), or undefined. */
  readonly told: (line: number, word: RegExp) => number | undefined;
}

/** After a unit sets off, the next one waits this long (seconds): its slide is well under way, the eye has followed it. */
export const NEXT_MOVE_S = 1.6;

/** Words that name no one unit (stems, after folding). */
const COMMON = new Set(["the", "of", "and", "his", "her", "their", "its", "army", "troop", "unit", "force", "men", "soldier", "wing", "flank", "line", "right", "left", "sag", "sol", "kanat", "ordu", "birlik"]);

/** Words a unit kind is told by (English and Turkish stems). */
const KIND_WORDS: Readonly<Record<string, string>> = {
  piyade: "infantry|foot|legion\\p{L}*|legionar\\p{L}*|hoplite\\p{L}*|piyade\\p{L}*",
  kilicli: "infantry|foot|swordsm\\p{L}*|legion\\p{L}*|legionar\\p{L}*|piyade\\p{L}*",
  mizrakci: "infantry|spear\\p{L}*|pike\\p{L}*|phalanx|hoplite\\p{L}*|mızrak\\p{L}*",
  okcu: "archer\\p{L}*|bowm\\p{L}*|okçu\\p{L}*",
  tufekci: "musket\\p{L}*|rifle\\p{L}*|infantry|tüfek\\p{L}*",
  suvari: "cavalry|horse\\p{L}*|rider\\p{L}*|knight\\p{L}*|süvari\\p{L}*|atlı\\p{L}*",
  topcu: "gun\\p{L}*|cannon\\p{L}*|artillery|batter\\p{L}*|top\\p{L}*",
};

/** A word folded for comparison: lower case (Turkish dotless i kept apart), marks dropped, a plural or possessive cut. */
export function wordStem(w: string): string {
  const folded = w.replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase().normalize("NFD").replace(/\p{M}+/gu, "").replace(/[’']s?$/u, "");
  return folded.length > 4 && folded.endsWith("s") ? folded.slice(0, -1) : folded;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The words that name each unit: `own`, its name's words no other unit's name has ("Gauls and Spaniards", "heavy
 * infantry"); `group`, the words it shares only with units of its own side ("African" for both African wings, "Roman"
 * for both Roman units) — those name them together. A word another side's unit carries names neither ("cavalry"). Each
 * a regex matching one word (any plural or possessive), or undefined.
 */
export function unitWords(units: readonly { readonly name?: string; readonly side?: string }[]): { readonly own?: RegExp; readonly group?: RegExp; readonly groupStems?: readonly string[] }[] {
  const words = units.map((u) => new Set((u.name ?? "").split(/[^\p{L}\p{N}’']+/u).filter(Boolean).map(wordStem).filter((w) => w.length >= 3 && !COMMON.has(w))));
  const re = (ws: readonly string[]) => (ws.length ? new RegExp(`^(?:${ws.map(escape).join("|")})(?:s|es)?(?:[’']s?)?$`, "iu") : undefined);
  return words.map((mine, i) => {
    const holders = (w: string) => words.flatMap((other, j) => (other.has(w) ? [j] : []));
    const own = [...mine].filter((w) => holders(w).length === 1);
    const group = [...mine].filter((w) => holders(w).length > 1 && holders(w).every((j) => units[j]!.side === units[i]!.side));
    const o = re(own);
    const g = re(group);
    return { ...(o ? { own: o } : {}), ...(g ? { group: g, groupStems: group } : {}) };
  });
}

/** A side told by its name ("Romans", "the Carthaginians"). */
const sideWord = (side: string) => {
  const stem = wordStem(side.split(/\s+/).pop() ?? side);
  return stem.length >= 3 ? new RegExp(`^${escape(stem.replace(/(?:an|ian|ish|e)$/u, ""))}\\p{L}*$`, "iu") : undefined;
};

/** Two step lists merged where a unit has two formations for one line: the later one stands, losses counted from before. */
export function mergeSameLine<S extends MoveStep>(steps: readonly S[], sources: readonly StepSource[], losses: (n: number) => number[]): { steps: S[]; sources: StepSource[] } {
  const outS: S[] = [];
  const outR: StepSource[] = [];
  steps.forEach((st, i) => {
    const src = sources[i]!;
    if (outS.length && outS[outS.length - 1]!.start === st.start) {
      const before = outS.length >= 2 ? outS[outS.length - 2]!.alive : (outS[0]!.alive + (outS[0]!.losses?.length ?? 0));
      const lost = Math.max(0, before - st.alive);
      const rest: Record<string, unknown> = { ...(st as MoveStep) };
      delete rest.losses;
      outS[outS.length - 1] = { ...rest, ...(lost ? { losses: losses(lost) } : {}) } as unknown as S;
      outR[outR.length - 1] = { satir: src.satir, hold: outR[outR.length - 1]!.hold && src.hold };
      return;
    }
    outS.push(st);
    outR.push(src);
  });
  return { steps: outS, sources: outR };
}

const samePoints = (a: readonly XY[], b: readonly XY[]) => a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i]!.x) < 0.5 && Math.abs(p.y - b[i]!.y) < 0.5);

/**
 * The units with their moves told in order: holds kept still, one step per line, each move starting on the word that
 * names its unit (or after the named ones). `moved`: where a unit's move on a line now starts (`${unit}|${line}`),
 * for the arrows and name callouts that go with it.
 */
export function narrateMoves<S extends MoveStep, U extends MoveUnit<S>>(units: readonly U[], sources: readonly (readonly StepSource[])[], times: LineTimes, fps: number, losses: (n: number) => number[]): { units: U[]; moved: Map<string, number> } {
  // Holds keep the formation they had; then one step per line.
  const merged = units.map((u, ui) => {
    const src = u.steps.map((_, si) => sources[ui]?.[si] ?? { satir: -1, hold: false });
    // A held step takes the formation of the one before it (already final, so a hold after a hold stays put too).
    const kept = [...u.steps];
    for (let si = 1; si < kept.length; si++) if (src[si]!.hold && !kept[si]!.rout && !kept[si]!.via && kept[si]!.alive === kept[si - 1]!.alive) kept[si] = { ...kept[si]!, points: kept[si - 1]!.points };
    return mergeSameLine(kept, src, losses);
  });
  const words = unitWords(units);
  const moved = new Map<string, number>();
  // The lines on which some unit moves: a step after its first whose places change. A step with losses or a rout is
  // the line's fight and stays on the line's start, with the fight.
  const movers = new Map<number, { ui: number; si: number }[]>();
  merged.forEach((m, ui) =>
    m.steps.forEach((st, si) => {
      if (si === 0 || st.rout || st.losses?.length) return;
      const line = m.sources[si]!.satir;
      if (line < 0 || samePoints(st.points, m.steps[si - 1]!.points)) return;
      const list = movers.get(line) ?? movers.set(line, []).get(line)!;
      list.push({ ui, si });
    }),
  );
  const starts = new Map<string, number>();
  for (const [line, list] of movers) {
    const from = times.start(line);
    const end = times.end(line);
    const within = (f: number | undefined) => (f !== undefined && f >= from && (end === undefined || f <= end) ? f : undefined);
    const ownAt = list.map((m) => (words[m.ui]!.own ? within(times.told(line, words[m.ui]!.own!)) : undefined));
    const told = list.map((m, k) => {
      const u = units[m.ui]!;
      // Its own name first, then the name its side's units share ("the African veterans" moves both African wings) —
      // unless a unit sharing that word is named by its own words on the line ("the Roman heavy infantry" is not the
      // Roman cavalry) — then its kind ("horsemen": every horse moving on the line), then its side ("Rome").
      const w = words[m.ui]!;
      if (ownAt[k] !== undefined) return ownAt[k];
      const taken = list.some((o, j) => j !== k && ownAt[j] !== undefined && (words[o.ui]!.groupStems ?? []).some((s) => w.groupStems?.includes(s)));
      const group = w.group && !taken ? within(times.told(line, w.group)) : undefined;
      if (group !== undefined) return group;
      const kind = u.kind && KIND_WORDS[u.kind] ? within(times.told(line, new RegExp(`^(?:${KIND_WORDS[u.kind]})$`, "iu"))) : undefined;
      if (kind !== undefined) return kind;
      // A side's name names it only when none of its units is named by its own words here.
      const side = sideWord(u.side);
      const sideTaken = list.some((o, j) => j !== k && ownAt[j] !== undefined && units[o.ui]!.side === u.side);
      return side && !sideTaken ? within(times.told(line, side)) : undefined;
    });
    // The named ones on their words, in the order told (those named by one word together); the others one by one after.
    const named = list.map((m, k) => ({ ...m, at: told[k] })).filter((m) => m.at !== undefined).sort((a, b) => a.at! - b.at!);
    const unnamed = list.filter((_, k) => told[k] === undefined);
    let cursor = from;
    let word: number | undefined;
    let wordAt = from;
    for (const m of named) {
      if (m.at !== word) {
        word = m.at;
        wordAt = Math.max(m.at!, cursor);
        cursor = wordAt + Math.round(NEXT_MOVE_S * fps);
      }
      starts.set(`${m.ui}|${m.si}`, wordAt);
    }
    for (const m of unnamed) {
      starts.set(`${m.ui}|${m.si}`, cursor);
      cursor += Math.round(NEXT_MOVE_S * fps);
    }
  }
  const out = units.map((u, ui) => {
    const m = merged[ui]!;
    const steps = m.steps.map((st, si) => {
      const wanted = starts.get(`${ui}|${si}`);
      // Never past the unit's next step (its steps stay in order).
      const next = m.steps[si + 1]?.start;
      const at = wanted === undefined ? undefined : Math.max(st.start, next !== undefined ? Math.min(wanted, next - 1) : wanted);
      if (at === undefined || at === st.start) return st;
      moved.set(`${ui}|${m.sources[si]!.satir}`, at);
      return { ...st, start: at };
    });
    return { ...u, steps } as U;
  });
  return { units: out, moved };
}
