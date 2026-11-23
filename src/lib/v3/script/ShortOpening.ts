import { splitDirections } from "../tts/StageDirections";

/**
 * No backstory before the first action in a Short (owner, 23 Nov 2026, "90 sn olsun diğer önerileri de kabul ediyorum",
 * after the Lake Trasimene Short: 8.4–18.8 s told "Hannibal crossed the Alps with his army. By the time he reached Lake
 * Trasimene, he had over 50,000 men. Rome sent Flaminius with 25,000 to stop him." — exactly the 4–12 s window where about
 * half of this channel's Short viewers swipe away — and the first action came only at ~19 s). The first action or clash
 * follows the stakes line (on screen by about FIRST_ACTION_BY_S); marches, routes and troop counts come after it, in one
 * line at most. Measured from the episode JSON alone: no model, no files.
 */

/** Seconds by which a Short's first action is on screen (the beat map's "ilk_hamle" ends here). */
export const FIRST_ACTION_BY_S = 12;
/** Spoken words before the first action at most: FIRST_ACTION_BY_S at the channel's ~2.5 spoken words a second. */
export const FIRST_ACTION_MAX_WORDS = 30;
/** The channel's spoken pace, for the seconds a count of words takes (HookFollow: 2.3–2.5 words a second). */
const WORDS_PER_S = 2.4;

interface OpeningLine { readonly karakter?: string; readonly metin?: string }
interface Step { readonly satir?: number; readonly hareket?: string; readonly bozgun?: boolean; readonly kayip?: number; readonly suya?: boolean }
interface OpeningScene {
  readonly id?: string;
  readonly satirlar?: readonly OpeningLine[];
  readonly harita?: {
    readonly savaslar?: readonly { readonly satir?: number }[];
    readonly birlikler?: readonly { readonly yerler?: readonly Step[] }[];
    readonly yanginlar?: readonly { readonly satir?: number }[];
    readonly araclar?: readonly { readonly ates_satir?: number }[];
    readonly rozetler?: readonly { readonly x_satir?: number }[];
    readonly teslim?: readonly { readonly satir?: number }[];
  };
  readonly kalabalik?: readonly { readonly hareket?: { readonly tur?: string; readonly satir?: number } }[];
}
export interface OpeningEpisode { readonly oyuncu_kadrosu?: readonly { readonly id?: string; readonly gorunur?: boolean }[]; readonly sahneler?: readonly OpeningScene[] }

const fold = (text: string) => text.replace(/ı/g, "i").replace(/İ/g, "I").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const wordCount = (text: string) => text.split(/\s+/).filter((w) => /\p{L}|\d/u.test(w)).length;
const speechOf = (l: OpeningLine) => (typeof l.metin === "string" ? splitDirections(l.metin).speech : "");

/** Unit steps that are a fight, not a stand: a charge, an advance, an encirclement, a withdrawal, a rout, losses. */
const FIGHT_STEPS = new Set(["ilerle", "hucum", "kusat", "geri"]);

/**
 * The lines of a scene on which something happens on screen: a battle mark, a unit's fighting step, a fire, a gun
 * firing, a ruler struck out, a white flag, a crowd charging or fleeing. (A march along a route is not one: it is the
 * backstory this rule keeps out of the opening.)
 */
export function actionLines(scene: OpeningScene): Set<number> {
  const out = new Set<number>();
  const map = scene.harita;
  for (const b of map?.savaslar ?? []) out.add(b.satir ?? 0);
  for (const u of map?.birlikler ?? []) for (const y of u.yerler ?? []) if (typeof y.satir === "number" && ((y.hareket && FIGHT_STEPS.has(y.hareket)) || y.bozgun || (y.kayip ?? 0) > 0 || y.suya)) out.add(y.satir);
  for (const f of map?.yanginlar ?? []) if (typeof f.satir === "number") out.add(f.satir);
  for (const v of map?.araclar ?? []) if (typeof v.ates_satir === "number") out.add(v.ates_satir);
  for (const r of map?.rozetler ?? []) if (typeof r.x_satir === "number") out.add(r.x_satir);
  for (const t of map?.teslim ?? []) if (typeof t.satir === "number") out.add(t.satir);
  for (const c of scene.kalabalik ?? []) if ((c.hareket?.tur === "hucum" || c.hareket?.tur === "kac") && typeof c.hareket.satir === "number") out.add(c.hareket.satir);
  return out;
}

/**
 * What tells background rather than the moment (folded text): a march or a journey, someone sent or elected, an army's
 * size, a step back in time. English and Turkish.
 */
const BACKSTORY: readonly RegExp[] = [
  /\b(crossed|marched|sailed|travell?ed|journeyed|arrived|reached|set (out|off)|had come)\b/,
  /\b(sent|dispatched|appointed|elected|raised an army)\b/,
  /(\d[\d,.]*|\b(thousands?|hundreds?|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety))\s+(\S+\s+){0,2}(men|soldiers|troops|warriors|legions?|legionaries|ships|horsemen|cavalry|infantry|elephants)\b/,
  /\b(years?|months?|weeks?) (earlier|before|ago)\b|\bby the time\b|\bback in\b/,
  /\b(gecti|gectikten|asti|asarak|yurudu|yuruyerek|gonderdi|ulasti|vardi|yola cikti|secildi|atandi)\b/,
  /\b(yil|yillar|ay|aylar) once\b/,
  /(\d[\d.,]*|\bbin)\s+(kisilik|askerle|askeriyle|asker|adamla|gemiyle|gemi)\b/,
];

/** The background phrases a line tells (the matched words), or [] for a line of the moment itself. */
export function backstoryPhrases(text: string): string[] {
  const f = fold(splitDirections(text).speech);
  return BACKSTORY.flatMap((re) => {
    const m = re.exec(f);
    return m ? [m[0]] : [];
  });
}

/**
 * The opening of a Short up to its first action: where that action is (the first line, after the hook, that a visible
 * character speaks or on which something happens on screen), the spoken words before it, and the narrator's lines
 * between the line after the hook and it that tell background. Undefined when nothing in the episode acts at all (not
 * measurable).
 */
export function openingBeforeAction(episode: OpeningEpisode): {
  readonly sahne: string;
  readonly satir: number;
  readonly kelime: number;
  readonly arkaPlan: readonly { readonly sahne: string; readonly satir: number; readonly metin: string; readonly ifadeler: readonly string[] }[];
} | undefined {
  const narrators = new Set((episode.oyuncu_kadrosu ?? []).filter((c) => c.gorunur === false).map((c) => c.id));
  let spoken = 0;
  let before = 0;
  const backstory: { sahne: string; satir: number; metin: string; ifadeler: string[] }[] = [];
  for (const s of episode.sahneler ?? []) {
    const acts = actionLines(s);
    for (const [i, l] of (s.satirlar ?? []).entries()) {
      const speech = speechOf(l);
      if (!speech) continue;
      spoken++;
      const narrator = narrators.has(l.karakter);
      // The hook itself is not the first action, even when its speaker gestures (it is judged on its own: HookFollow).
      if (spoken > 1 && (acts.has(i) || !narrator)) return { sahne: s.id ?? "?", satir: i + 1, kelime: before, arkaPlan: backstory };
      // The line after the hook is the stakes line (its own rules: HookFollow); later narrator lines are judged here.
      if (spoken > 2 && narrator) {
        const phrases = backstoryPhrases(speech);
        if (phrases.length) backstory.push({ sahne: s.id ?? "?", satir: i + 1, metin: speech, ifadeler: phrases });
      }
      before += wordCount(speech);
    }
  }
  return undefined;
}

/**
 * The writer's repair ask for a Short that tells background before its first action, or reaches its first action only
 * after FIRST_ACTION_MAX_WORDS spoken words (ScriptEngine asks it with the hook asks in the repair and length rounds).
 */
export function backstoryProblems(episode: OpeningEpisode): string[] {
  const o = openingBeforeAction(episode);
  if (!o || (!o.arkaPlan.length && o.kelime <= FIRST_ACTION_MAX_WORDS)) return [];
  const told = o.arkaPlan.map((b) => `scene "${b.sahne}" line ${b.satir} ("${b.metin.slice(0, 70)}…": ${b.ifadeler.join(", ")})`).join("; ");
  const late = `the first action comes at scene "${o.sahne}" line ${o.satir}, after ${o.kelime} spoken words (~${Math.round(o.kelime / WORDS_PER_S)} s; at most ${FIRST_ACTION_MAX_WORDS}, on screen by ~${FIRST_ACTION_BY_S} s)`;
  return [`${told ? `background told before the first action — ${told}; ` : ""}${late}: in a Short the first action or clash comes right after the stakes line (a charge, the trap sprung, a fire, two characters clashing); marches, routes, troop counts, "X crossed the Alps", "Rome sent…" come AFTER the first clash, in one line at most — BACKSTORY FIRST`];
}
