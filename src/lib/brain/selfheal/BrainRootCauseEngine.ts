/**
 * Atölye Brain — Self-Healing: root-cause correlation engine (pure).
 *
 * Emir §6. Not a string search. It correlates:
 *
 *   symptom category  ↔  recent commits that touched that area
 *   event timeline    ↔  known failure signatures
 *   incident signature ↔  previously-learned patterns
 *   prior/next state   ↔  benign vs pathological transitions
 *
 * Every hypothesis carries `confidence`, `evidence` and `counterEvidence`. The
 * scoring is deterministic and deliberately conservative — a hypothesis with
 * only weak circumstantial support stays well below 0.5.
 */

import type { BrainIncident, BrainIncidentCategory, BrainRootCauseHypothesis } from "./BrainIncident";
import { brainIncidentSignature } from "./BrainIncident";
import type { BrainLearnedPattern } from "./BrainLearnedPattern";
import { matchLearnedPattern } from "./BrainLearnedPattern";

export interface BrainRecentCommit {
  readonly hash: string;
  readonly subject: string;
  readonly ageHours: number;
  readonly files: readonly string[];
}

export interface BrainTimelineEvent {
  readonly at: number; // epoch ms
  readonly name: string; // e.g. "wake-hit", "capture-start", "visibility:hidden", "pagehide", "recover:stall"
  readonly detail?: string;
}

/** Which source-area prefixes map to which incident category (for commit correlation). */
const CATEGORY_AREAS: Readonly<Record<BrainIncidentCategory, readonly string[]>> = Object.freeze({
  voice: ["src/components/brain/voice/", "src/components/brain/useAyasVoice", "src/components/brain/ayasVoice"],
  stt: ["src/lib/ayas/stt/", "app/api/ayas/stt/"],
  tts: ["src/components/brain/voice/browserVoiceAdapter", "src/components/brain/ayasVoice"],
  ui: ["src/components/brain/", "src/components/brain/BrainCore.css"],
  lifecycle: ["src/lib/brain/ui/brainLifecycle", "src/components/brain/useBrainLifecycle", "public/sw.js", "src/components/PwaRegister"],
  graphify: ["src/lib/ayas/GraphifyConsistency", "src/lib/ayas/AyasStudioContext", "src/lib/projects/"],
  performance: ["src/components/brain/voice/wake/", "src/lib/brain/probe/"],
  network: ["app/api/", "src/lib/ayas/AyasChatStream"],
  storage: ["src/lib/brain/store/", "src/lib/brain/autonomy/", "src/lib/runtime/"],
  security: ["src/lib/ayas/execution/", "src/lib/brain/security/", "src/lib/auth/"],
  unknown: [],
});

/** Timeline signatures → a candidate root-cause statement + a base confidence. */
interface Signature {
  readonly match: (events: readonly BrainTimelineEvent[]) => boolean;
  readonly statement: string;
  readonly base: number;
  readonly suspectAreas: readonly string[];
  readonly category: BrainIncidentCategory;
}

const has = (events: readonly BrainTimelineEvent[], name: string) => events.some((e) => e.name === name);
const gapBetween = (events: readonly BrainTimelineEvent[], a: string, b: string): number | null => {
  const ea = [...events].reverse().find((e) => e.name === a);
  const eb = [...events].reverse().find((e) => e.name === b);
  return ea && eb ? Math.abs(eb.at - ea.at) : null;
};

const SIGNATURES: readonly Signature[] = Object.freeze([
  {
    match: (e) => has(e, "wake-hit") && has(e, "capture-start") && !has(e, "command-final") && (gapBetween(e, "capture-start", "capture-end") ?? 9999) < 1500,
    statement: "The command capture endpoints ~1 s after the wake word — the VAD is finalising on the pre-roll wake word before the command is spoken.",
    base: 0.72,
    suspectAreas: ["src/components/brain/voice/wakeWordVoiceAdapter.ts"],
    category: "voice",
  },
  {
    match: (e) => has(e, "visibility:hidden") && has(e, "pagehide") && !has(e, "user-navigation") && has(e, "boot"),
    statement: "The page instance ended after visibility:hidden + pagehide with no user navigation — a background eviction / PWA lifecycle reset.",
    base: 0.62,
    suspectAreas: ["src/components/brain/useBrainLifecycle.ts", "src/components/brain/useScreenWakeLock.ts"],
    category: "lifecycle",
  },
  {
    match: (e) => has(e, "controllerchange") && has(e, "boot"),
    statement: "A service-worker controllerchange preceded the reload — the deferred SW update fired.",
    base: 0.7,
    suspectAreas: ["public/sw.js", "src/components/PwaRegister.tsx"],
    category: "lifecycle",
  },
  {
    match: (e) => has(e, "recover:stall") || (gapBetween(e, "audio-frame", "audio-frame") ?? 0) > 3000,
    statement: "The audio capture graph stopped producing frames while armed — an iOS AudioContext stall.",
    base: 0.6,
    suspectAreas: ["src/components/brain/voice/wakeWordVoiceAdapter.ts"],
    category: "voice",
  },
  {
    match: (e) => has(e, "stt-error") || has(e, "stt-empty"),
    statement: "The STT route returned an error / empty transcript for a captured clip.",
    base: 0.5,
    suspectAreas: ["src/lib/ayas/stt/AyasSttService.ts", "app/api/ayas/stt/route.ts"],
    category: "stt",
  },
  {
    match: (e) => has(e, "unhandled-rejection") || has(e, "fatal-error"),
    statement: "An unhandled rejection / fatal error was raised in the voice path.",
    base: 0.55,
    suspectAreas: [],
    category: "voice",
  },
]);

const CONFIDENCE_FLOOR = 0.15;

export interface BrainRootCauseInput {
  readonly incident: BrainIncident;
  readonly timeline: readonly BrainTimelineEvent[];
  readonly recentCommits: readonly BrainRecentCommit[];
  readonly learnedPatterns: readonly BrainLearnedPattern[];
}

export interface BrainRootCauseReport {
  readonly hypotheses: readonly BrainRootCauseHypothesis[];
  /** The single best hypothesis, if one crossed the floor. */
  readonly best: BrainRootCauseHypothesis | null;
  /** True when confidence is high enough AND the fix would be SAFE — a self-heal candidate. */
  readonly selfHealCandidate: boolean;
}

export function diagnoseRootCause(input: BrainRootCauseInput): BrainRootCauseReport {
  const { incident, timeline, recentCommits, learnedPatterns } = input;
  const areas = CATEGORY_AREAS[incident.category] ?? [];
  const hypotheses: BrainRootCauseHypothesis[] = [];

  // 1 — learned-pattern match (strongest signal: this exact thing happened + was fixed).
  const learned = matchLearnedPattern(learnedPatterns, brainIncidentSignature(incident));
  if (learned) {
    hypotheses.push({
      statement: `Recurrence of a known pattern: ${learned.rootCause}`,
      confidence: clamp(0.6 + 0.3 * learned.timesConfirmed / Math.max(1, learned.timesConfirmed + learned.timesFailed)),
      evidence: [
        `incident signature matches learned pattern "${learned.id}"`,
        `previously fixed by: ${learned.successfulFix}`,
        `pattern confirmed ${learned.timesConfirmed}× / failed ${learned.timesFailed}×`,
      ],
      counterEvidence: learned.timesFailed > 0 ? [`the learned fix has failed ${learned.timesFailed}× on a later occurrence`] : [],
      suspectFiles: learned.affectedFiles,
      matchedLearnedPatternId: learned.id,
    });
  }

  // 2 — timeline signature match, boosted by a correlating recent commit.
  for (const sig of SIGNATURES) {
    if (!sig.match(timeline)) continue;
    const correlating = recentCommits.filter(
      (c) => c.ageHours <= 72 && c.files.some((f) => sig.suspectAreas.some((a) => norm(f).startsWith(norm(a))) || areas.some((a) => norm(f).startsWith(norm(a)))),
    );
    const recencyBoost = correlating.length ? Math.min(0.2, 0.08 + 0.04 * correlating.length) : 0;
    const catMatchBoost = sig.category === incident.category ? 0.05 : 0;
    hypotheses.push({
      statement: sig.statement,
      confidence: clamp(sig.base + recencyBoost + catMatchBoost),
      evidence: [
        "timeline matches a known failure signature",
        ...correlating.map((c) => `recent commit ${c.hash.slice(0, 8)} "${c.subject}" touched a suspect area (${c.ageHours} h ago)`),
      ],
      counterEvidence: correlating.length === 0 ? ["no recent commit touched the suspect area — could be a latent / environmental cause"] : [],
      suspectFiles: [...new Set([...sig.suspectAreas, ...correlating.flatMap((c) => c.files.filter((f) => areas.some((a) => norm(f).startsWith(norm(a)))))])].slice(0, 12),
    });
  }

  // 3 — pure commit correlation when no signature fired (weak, circumstantial).
  if (hypotheses.length === 0 && areas.length) {
    const suspects = recentCommits.filter((c) => c.ageHours <= 48 && c.files.some((f) => areas.some((a) => norm(f).startsWith(norm(a)))));
    if (suspects.length) {
      hypotheses.push({
        statement: `A recent change in the ${incident.category} area may have introduced the fault (circumstantial — no timeline signature).`,
        confidence: clamp(0.2 + 0.06 * suspects.length),
        evidence: suspects.map((c) => `commit ${c.hash.slice(0, 8)} "${c.subject}" (${c.ageHours} h ago) touched: ${c.files.filter((f) => areas.some((a) => norm(f).startsWith(norm(a)))).join(", ")}`),
        counterEvidence: ["no runtime timeline signature — correlation only"],
        suspectFiles: [...new Set(suspects.flatMap((c) => c.files.filter((f) => areas.some((a) => norm(f).startsWith(norm(a))))))].slice(0, 12),
      });
    }
  }

  // 4 — always add an honest "cannot prove it" hypothesis when nothing is strong.
  const maxConf = hypotheses.reduce((m, h) => Math.max(m, h.confidence), 0);
  if (maxConf < 0.5) {
    hypotheses.push({
      statement: "Root cause not established from the available evidence.",
      confidence: clamp(0.1 + (0.4 - Math.min(0.4, maxConf))),
      evidence: ["no learned pattern, timeline signature or commit correlation crossed the confidence bar"],
      counterEvidence: [],
      suspectFiles: [],
    });
  }

  const ranked = hypotheses
    .filter((h) => h.confidence >= CONFIDENCE_FLOOR)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 6);
  const best = ranked[0] ?? null;
  const selfHealCandidate = Boolean(best && best.confidence >= 0.65 && best.statement !== "Root cause not established from the available evidence.");

  return { hypotheses: ranked, best, selfHealCandidate };
}

function norm(p: string): string {
  return String(p ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
}
function clamp(n: number): number {
  return Math.min(0.95, Math.max(0, Math.round(n * 100) / 100));
}
