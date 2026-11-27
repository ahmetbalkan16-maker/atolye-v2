import { splitDirections } from "../tts/StageDirections";
import { CLOSE_MAP_MAX_KM } from "../episode/EpisodeTypes";

/**
 * No backstory before the first action in a Short (owner, 23 Nov 2026, "90 sn olsun diğer önerileri de kabul ediyorum",
 * after the Lake Trasimene Short: 8.4–18.8 s told "Hannibal crossed the Alps with his army. By the time he reached Lake
 * Trasimene, he had over 50,000 men. Rome sent Flaminius with 25,000 to stop him." — exactly the 4–12 s window where about
 * half of this channel's Short viewers swipe away — and the first action came only at ~19 s). The first action or clash
 * follows the stakes line (on screen by about FIRST_ACTION_BY_S); marches, routes and troop counts come after it, in one
 * line at most. Measured from the episode JSON alone: no model, no files.
 */

/**
 * Seconds by which a Short's first action is on screen (the beat map's "ilk_hamle" ends here). 12 s until 27 Nov 2026;
 * 10 s since (owner, 27 Nov 2026: "insanları çekecek başlangıçlar yapmamız gerekiyor"; docs/v3/KANCA_ANALIZI_2026-11-27.md):
 * on all ten measured Shorts the steepest early drop fell between 4.4 and 9.8 s, on a setup line while nothing happened on
 * screen, and the three question Shorts made since 23 Nov showed their first move on the map only at 13.6–24 s.
 * 8 s since the owner's quality standard of the same day ("videoya giriş hook bunu daha da etkin hale gelmeli"): 10 s
 * still sat inside that 4.4–9.8 s drop; the action now comes with the stakes line.
 */
export const FIRST_ACTION_BY_S = 8;
/**
 * Spoken words before the first action at most: FIRST_ACTION_BY_S at the channel's ~2.4 spoken words a second — the
 * question title (~10 words) and the stakes line (at most 12), so the action comes with the stakes line or the next one.
 */
// Kept at 24 when the target moved to 8 s: the channel's best organic Short (Caesar) acted after exactly 24 words.
export const FIRST_ACTION_MAX_WORDS = 24;
/** The channel's spoken pace, for the seconds a count of words takes (HookFollow: 2.3–2.5 words a second). */
const WORDS_PER_S = 2.4;

interface OpeningLine { readonly karakter?: string; readonly metin?: string }
interface Step { readonly satir?: number; readonly hareket?: string; readonly bozgun?: boolean; readonly kayip?: number; readonly suya?: boolean }
interface OpeningScene {
  readonly id?: string;
  readonly satirlar?: readonly OpeningLine[];
  readonly harita?: {
    readonly genislik_km?: number;
    readonly oklar?: readonly { readonly satir?: number; readonly stil?: string }[];
    readonly bolgeler?: readonly { readonly satir?: number; readonly yayilma?: { readonly satir?: number } }[];
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

/** A line telling a move (folded text): attack, charge, strike, encircle, cut off, break through, invade… English and Turkish. */
const MOVE_TOLD = /\b(attack\w*|charg\w*|strik\w*|struck|encircl\w*|surround\w*|trap\w*|cut off|cuts off|pincer\w*|break(s|ing)? through|broke through|smash\w*|storm\w*|invad\w*|assault\w*|ambush\w*|outflank\w*|flank\w*|sweep\w*|swept|launch\w*|unleash\w*|advanc\w*|push\w*|counterattack\w*|bomb\w*|torpedo\w*|sink\w*|sank|fir(e|es|ed|ing)|burn\w*|hucum\w*|saldir\w*|kusat\w*|vurdu|vurur|ilerl\w*|bombal\w*|batir\w*|yakti)\b/;

/** Unit steps that are a fight, not a stand: a charge, an advance, an encirclement, a withdrawal, a rout, losses. */
const FIGHT_STEPS = new Set(["ilerle", "hucum", "kusat", "geri"]);

/**
 * The lines of a scene on which something happens on screen: a battle mark, a unit's fighting step, a fire, a gun
 * firing, a ruler struck out, a white flag, a crowd charging or fleeing, a move's arrow drawn on the map (not a "plan"
 * arrow), a border appearing or spreading after the scene's first line (27 Nov 2026: the beat map's "a border
 * changing"; the Stalingrad Short's pincer was two arrows and a pocket). (An army's march route is not one: it is the
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
  // An arrow drawn under a line that tells background (a march, a troop count) is the march route, not a move (27 Nov
  // 2026, Gaugamela: the Tyre–Gaugamela march arrow under "Alexander's 47,000 face a Persian army…" passed as the first
  // action at 4 s while the two armies were never on screen before 16 s).
  // On a wide map (wider than a close battle map) an arrow counts only when its line tells a move: there an arrow under a
  // line of numbers or stakes is the army's approach march.
  const wide = (map?.genislik_km ?? 0) > CLOSE_MAP_MAX_KM;
  for (const a of map?.oklar ?? []) {
    if (typeof a.satir !== "number" || a.stil === "plan") continue;
    const told = speechOf(scene.satirlar?.[a.satir] ?? {});
    if (backstoryPhrases(told).length || (wide && !MOVE_TOLD.test(fold(told)))) continue;
    out.add(a.satir);
  }
  for (const r of map?.bolgeler ?? []) {
    if (typeof r.yayilma?.satir === "number") out.add(r.yayilma.satir);
    else if (typeof r.satir === "number" && r.satir > 0) out.add(r.satir);
  }
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
  /(\d[\d,.]*|\b(thousands?|hundreds?|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety))\s+(\S+\s+){0,2}(men|soldiers|troops|warriors|legions?|legionaries|ships|horsemen|cavalry|infantry|elephants|followers|guards|attendants)\b/,
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

type Backstory = { readonly sahne: string; readonly satir: number; readonly metin: string; readonly ifadeler: readonly string[] };

/** The opening scanned up to its first action, or through the whole episode when nothing acts (`action` absent). */
function scanOpening(episode: OpeningEpisode): { readonly action?: { readonly sahne: string; readonly satir: number }; readonly kelime: number; readonly arkaPlan: readonly Backstory[] } {
  const narrators = new Set((episode.oyuncu_kadrosu ?? []).filter((c) => c.gorunur === false).map((c) => c.id));
  let spoken = 0;
  let before = 0;
  const backstory: Backstory[] = [];
  for (const s of episode.sahneler ?? []) {
    const acts = actionLines(s);
    for (const [i, l] of (s.satirlar ?? []).entries()) {
      const speech = speechOf(l);
      if (!speech) continue;
      spoken++;
      const narrator = narrators.has(l.karakter);
      // The hook itself is not the first action, even when its speaker gestures (it is judged on its own: HookFollow).
      if (spoken > 1 && (acts.has(i) || (!narrator && !s.harita))) return { action: { sahne: s.id ?? "?", satir: i + 1 }, kelime: before, arkaPlan: backstory };
      // The line after the hook is the stakes line (its own rules: HookFollow); later narrator lines are judged here.
      if (spoken > 2 && narrator) {
        const phrases = backstoryPhrases(speech);
        if (phrases.length) backstory.push({ sahne: s.id ?? "?", satir: i + 1, metin: speech, ifadeler: phrases });
      }
      before += wordCount(speech);
    }
  }
  return { kelime: before, arkaPlan: backstory };
}

/**
 * The opening of a Short up to its first action: where that action is (the first line, after the hook, on which
 * something happens on screen, or that a visible character speaks on a stage), the spoken words before it, and the
 * narrator's lines between the line after the hook and it that tell background. Undefined when nothing in the episode
 * acts at all (not measurable). On a map a character's line is a badge's quip, not an action (27 Nov 2026: the
 * Stalingrad, Cajamarca and Iran question Shorts passed this rule on a quip at 8.6–16.4 s while their maps showed their
 * first move only at 13.6–24 s); on a stage it stays one — the clash of two characters the channel's best Short opened on.
 */
export function openingBeforeAction(episode: OpeningEpisode): {
  readonly sahne: string;
  readonly satir: number;
  readonly kelime: number;
  readonly arkaPlan: readonly Backstory[];
} | undefined {
  const o = scanOpening(episode);
  return o.action ? { ...o.action, kelime: o.kelime, arkaPlan: o.arkaPlan } : undefined;
}

/**
 * The writer's repair ask for a Short that tells background before its first action, or reaches its first action only
 * after FIRST_ACTION_MAX_WORDS spoken words (ScriptEngine asks it with the hook asks in the repair and length rounds).
 * A Short with a map where no line shows anything happening — only badge quips — is asked too (27 Nov 2026: a
 * character's line on a map no longer counts as the first action); a stage-only episode with no action is not measured.
 */
export function backstoryProblems(episode: OpeningEpisode): string[] {
  const o = scanOpening(episode);
  if (!o.action && !(episode.sahneler ?? []).some((s) => s.harita)) return [];
  if (o.action && !o.arkaPlan.length && o.kelime <= FIRST_ACTION_MAX_WORDS) return [];
  const told = o.arkaPlan.map((b) => `scene "${b.sahne}" line ${b.satir} ("${b.metin.slice(0, 70)}…": ${b.ifadeler.join(", ")})`).join("; ");
  const late = o.action
    ? `the first action comes at scene "${o.action.sahne}" line ${o.action.satir}, after ${o.kelime} spoken words (~${Math.round(o.kelime / WORDS_PER_S)} s; at most ${FIRST_ACTION_MAX_WORDS}, on screen by ~${FIRST_ACTION_BY_S} s)`
    : `no line of the Short shows an action on screen (only badges speak; at most ${FIRST_ACTION_MAX_WORDS} spoken words before one, on screen by ~${FIRST_ACTION_BY_S} s)`;
  return [`${told ? `background told before the first action — ${told}; ` : ""}${late}: in a Short the first action or clash comes right after the stakes line (a charge, the trap sprung, a fire, two characters clashing on a stage; on a map a move drawn on it — a unit's attack step, a move's arrow, a border spreading; a badge's quip is not the action); marches, routes, troop counts, "X crossed the Alps", "Rome sent…" come AFTER the first clash, in one line at most — BACKSTORY FIRST`];
}

/**
 * The quality gate's view of a Short's opening (owner, 27 Nov 2026, after the Gaugamela Short: "giriş çok önemli, çok
 * etkili bir giriş olması gerekiyor … ne anlattığını göstermesi gerekiyor"): the gate gave that hook 10/10 on its
 * question and a camera drift at 0 s, while the two armies first stood on screen at 16 s and a still relief covered the
 * stakes line. Two rows, measured on the finished timeline: when the first action is on screen (target
 * FIRST_ACTION_BY_S), and whether a real picture (`pictures`, absolute seconds) covers more than half a second of the
 * opening's first `floor` lines. `lineStart` gives a line's start in seconds.
 */
export function openingScreenChecks(
  episode: OpeningEpisode,
  lineStart: (scene: number, line: number) => number | undefined,
  pictures: readonly { readonly start: number; readonly end: number }[],
  floor: number,
): { ok: boolean; text: string }[] {
  const o = scanOpening(episode);
  const scenes = episode.sahneler ?? [];
  const si = o.action ? scenes.findIndex((s) => (s.id ?? "?") === o.action!.sahne) : -1;
  const at = o.action && si >= 0 ? lineStart(si, o.action.satir - 1) : undefined;
  const openEnd = lineStart(0, floor) ?? Infinity;
  const covered = pictures.filter((p) => Math.min(p.end, openEnd) - p.start > 0.5);
  return [
    {
      ok: at !== undefined && at <= FIRST_ACTION_BY_S,
      text: `Açılışta ilk hamle: ${at === undefined ? "ekranda hamle YOK (yalnız rozet esprisi ya da yürüyüş oku)" : `${at.toFixed(1)} sn'de (${o.action!.sahne} ${o.action!.satir}. satır)`} (hedef ≤ ${FIRST_ACTION_BY_S} sn: iki taraf karşı karşıya, bir hücum, bir ok — yürüyüş oku ya da rozet esprisi sayılmaz)`,
    },
    {
      ok: !covered.length,
      text: `Açılış resmi: ${covered.length ? `gerçek resim ${covered.map((p) => `${p.start.toFixed(1)}–${Math.min(p.end, openEnd).toFixed(1)} sn`).join(", ")} soru/tehlike satırını örtüyor (ilk ${floor} satır haritada kalmalı)` : `soru ve tehlike satırı haritada`} (izleyicinin çoğu 4–10. sn'de gidiyor; orada harita kıpırdamalı)`,
    },
  ];
}
