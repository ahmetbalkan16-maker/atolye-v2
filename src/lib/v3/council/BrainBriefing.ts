import type { BrainId } from "./Council";
import { briefCaseLine, type DevCase, similarCases } from "./DevBrain";
import { type Lesson, recall } from "./ExperienceMemory";
import { isReferenceLesson } from "./ReferenceStore";

/**
 * What a content brain is handed before it works (owner, 13 Nov 2026, "kesin emir": every fix Claude makes becomes a
 * case, and the brains get the similar past cases AUTOMATICALLY when they work on something similar, so they can solve
 * such problems themselves). Until then only the repair brain and development jobs were handed cases; the writer, the
 * fact checker, the council's critics, the costume historian and the quality judge never saw one — and the critics'
 * lessons were recalled by the episode's topic while lessons are written under generic topics ("senaryo", "rotus"), so
 * they almost never matched. No model, no cost: word overlap only (DevBrain.similarCases, ExperienceMemory.recall).
 */

/** At most this many past cases go into one brain's prompt, each at most this long (symptom, cause, how to catch). */
export const BRAIN_CASES = 3;
export const BRAIN_CASE_CHARS = 400;

/**
 * The past cases nearest any of `queries` among those concerning one of `beyinler` (Vaka-beyin), best first (a newer
 * case wins a tie), each once, as short prompt lines. A topic ("1638 Siege of Baghdad") and a problem text (the brain's
 * findings in this production) are asked apart: one long text would dilute the shared words below the threshold.
 */
export async function brainCases(workRoot: string, beyinler: readonly string[], queries: readonly (string | undefined)[], n = BRAIN_CASES, max = BRAIN_CASE_CHARS): Promise<string[]> {
  const best = new Map<string, { c: DevCase; s: number }>();
  for (const beyin of beyinler)
    for (const q of queries) {
      if (!q?.trim()) continue;
      for (const c of await similarCases(workRoot, q, n, { beyin }).catch(() => [])) {
        const had = best.get(c.id);
        if (!had || c.benzerlik > had.s) best.set(c.id, { c, s: c.benzerlik });
      }
    }
  return [...best.values()]
    .sort((a, b) => b.s - a.s || b.c.tarih.localeCompare(a.c.tarih))
    .slice(0, Math.max(0, n))
    .map((x) => briefCaseLine(x.c, max));
}

/**
 * A brain's lessons for one job: the owner's standing rules, up to `byTopic` lessons about `konu` and the `newest`
 * lessons and measures whatever their topic (13 Nov 2026: lessons are written under generic topics, so recalling by the
 * episode's topic alone found almost none), each text once. `filter` narrows the non-rule lessons (by source).
 */
export async function lessonMix(workRoot: string, beyin: BrainId, opts: { readonly konu: string; readonly byTopic?: number; readonly newest?: number; readonly filter?: (l: Lesson) => boolean }): Promise<string[]> {
  const filter = opts.filter ? { filter: opts.filter } : {};
  const topical = await recall(workRoot, beyin, { konu: opts.konu, tur: ["kural", "ders", "onlem"], limit: opts.byTopic ?? 2, ...filter }).catch(() => [] as Lesson[]);
  const newest = (opts.newest ?? 2) > 0 ? await recall(workRoot, beyin, { tur: ["ders", "onlem"], limit: opts.newest ?? 2, ...filter }).catch(() => [] as Lesson[]) : [];
  return [...new Set([...topical, ...newest].map((l) => l.metin))];
}

/**
 * A council critic's lessons (DirectorCouncil.holdCouncil's `lessons`): its rules, two lessons about the episode, its
 * two newest, then up to two past cases of its own brain near the episode's topic or near what was found in this cut.
 */
export async function criticBriefing(workRoot: string, beyin: BrainId, konu: string, problems?: string): Promise<string[]> {
  return [...(await lessonMix(workRoot, beyin, { konu })), ...(await brainCases(workRoot, [beyin], [konu, problems], 2))];
}

/**
 * The history editor's (fact check's) lessons: the research brain's rules, two lessons about the topic and its two
 * newest from productions and commits (a studied video's storytelling advice is the writer's, not the editor's), then
 * up to two past research cases near the topic.
 */
export async function factCheckBriefing(workRoot: string, queries: readonly (string | undefined)[]): Promise<string[]> {
  const konu = queries.filter(Boolean).join(" ");
  return [...(await lessonMix(workRoot, "arastirma", { konu, filter: (l) => !isReferenceLesson(l) })), ...(await brainCases(workRoot, ["arastirma"], queries, 2))];
}
