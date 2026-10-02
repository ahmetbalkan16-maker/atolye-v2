import { classifyFactEvidence, type HistoricalFactPack } from "./HistoricalFactPack";

/**
 * Stage 15J — the narrative contract for a 10–15 minute historical story.
 *
 * Eight beats in order, and the seven checks of the design: repeated facts,
 * long exposition, unresolved setup, chronology break, abrupt transition,
 * unsupported dramatic claim, excessive static visual time.
 *
 * The scene-level review of Stage 12 (`AyasDirectorReadiness`) already reports
 * media, rights and per-scene continuity. This module looks at the story as a
 * whole, unit by unit, and adds what that review cannot see: the beat
 * structure, setups and payoffs, the shape of the exposition, and drama that
 * no supported claim carries.
 *
 * Nothing is inferred: a unit without a declared beat is reported as such and
 * is not assigned one. The numbers below are stated policy, not measurements;
 * two come from the design (the 10–15 minute target) and one from Stage 12
 * (25 seconds on one static image). The other rules are relative.
 *
 * Pure and advisory: it reads units and returns findings.
 */
export const NARRATIVE_BEATS = Object.freeze(["COLD_OPEN", "CONTEXT", "STAKES", "ESCALATION", "TURNING_POINT", "CONSEQUENCE", "PAYOFF", "LEGACY"] as const);
export type NarrativeBeat = (typeof NARRATIVE_BEATS)[number];

export const NARRATIVE_POLICY = Object.freeze({
  /** The design's target length. */
  minTotalSeconds: 600,
  maxTotalSeconds: 900,
  /** Stage 12's existing limit for one static image. */
  maxStaticSecondsPerUnit: 25,
});

export interface NarrativeUnit {
  readonly id: number;
  /** The beat the unit was written for. Null when none was declared. */
  readonly beat: NarrativeBeat | null;
  readonly narration: string;
  readonly durationSeconds: number;
  /** The year the unit is set in, when it has one. */
  readonly year: number | null;
  /** How the unit is entered from the previous one, when the script says. */
  readonly transition: string | null;
  /** The unit deliberately leaves the timeline (a flashback or a look ahead). */
  readonly outOfSequence: boolean;
  /** Fact pack claims this unit states. */
  readonly claimIds: readonly string[];
  /** Questions or promises the unit opens, by label. */
  readonly setups: readonly string[];
  /** Labels of earlier setups the unit answers. */
  readonly payoffs: readonly string[];
  /** Seconds of the unit spent on an image that does not move. */
  readonly staticVisualSeconds: number;
}

export type NarrativeFindingCode =
  | "BEAT_NOT_DECLARED" | "BEAT_MISSING" | "BEAT_ORDER_BREAK" | "DURATION_OUT_OF_RANGE" | "REPEATED_FACT" | "LONG_EXPOSITION" | "UNRESOLVED_SETUP" | "PAYOFF_WITHOUT_SETUP"
  | "CHRONOLOGY_BREAK" | "ABRUPT_TRANSITION" | "UNSUPPORTED_DRAMATIC_CLAIM" | "EXCESSIVE_STATIC_VISUAL_TIME";
export interface NarrativeFinding { readonly code: NarrativeFindingCode; readonly severity: "BLOCKER" | "MAJOR" | "REVIEW"; readonly unitId: number | null; readonly evidence: string }
export interface NarrativeReview {
  readonly gate: "PASS" | "REVIEW_REQUIRED" | "BLOCKED";
  readonly findings: readonly NarrativeFinding[];
  readonly totalSeconds: number;
  readonly beatSeconds: Readonly<Record<NarrativeBeat, number>>;
  readonly staticVisualSeconds: number;
  readonly authority: "ADVISORY_ONLY";
}

const lower = (value: string) => value.toLocaleLowerCase("tr");
/** Phrases that claim something is the most, the first or the only. A sentence that uses one needs a supported claim behind it. */
const DRAMATIC = ["en büyük", "en güçlü", "en kanlı", "en önemli", "tarihin en", "tarihinde ilk", "ilk kez", "ilk defa", "asla", "hiçbir zaman", "tek başına", "eşi benzeri", "dünyayı değiştir", "tarihi değiştir", "yenilmez",
  "the greatest", "the largest", "the bloodiest", "the most", "for the first time", "never before", "changed the world", "changed history", "single-handedly", "unprecedented", "invincible", "the only"];
const sentences = (value: string) => value.split(/(?<=[.!?…])\s+|\n+/u).map((sentence) => sentence.trim()).filter(Boolean);
const normalized = (value: string) => lower(value).replace(/[^\p{L}\d]+/gu, " ").trim();

/** Reads the story unit by unit. With a fact pack, a dramatic claim is checked against the claims the unit states. */
export function reviewNarrative(units: readonly NarrativeUnit[], factPack: HistoricalFactPack | null = null): NarrativeReview {
  const findings: NarrativeFinding[] = [];
  const add = (code: NarrativeFindingCode, severity: NarrativeFinding["severity"], unitId: number | null, evidence: string) => findings.push({ code, severity, unitId, evidence });
  const beatSeconds = Object.fromEntries(NARRATIVE_BEATS.map((beat) => [beat, 0])) as Record<NarrativeBeat, number>;
  const seconds = (unit: NarrativeUnit) => (Number.isFinite(unit.durationSeconds) && unit.durationSeconds > 0 ? unit.durationSeconds : 0);
  const totalSeconds = units.reduce((sum, unit) => sum + seconds(unit), 0);
  for (const unit of units) if (unit.beat) beatSeconds[unit.beat] += seconds(unit);

  // ---- the eight beats, in order --------------------------------------------------------------------------------
  for (const unit of units) if (!unit.beat) add("BEAT_NOT_DECLARED", "REVIEW", unit.id, "The unit names no beat; none is assumed for it.");
  const declared = units.filter((unit) => unit.beat);
  if (declared.length > 0) {
    for (const beat of NARRATIVE_BEATS) if (!declared.some((unit) => unit.beat === beat)) add("BEAT_MISSING", "MAJOR", null, beat);
  }
  let previous: NarrativeUnit | undefined;
  for (const unit of units) {
    if (previous?.beat && unit.beat) {
      const from = NARRATIVE_BEATS.indexOf(previous.beat); const to = NARRATIVE_BEATS.indexOf(unit.beat);
      if (to < from && !unit.outOfSequence) add("BEAT_ORDER_BREAK", "MAJOR", unit.id, `${previous.beat} -> ${unit.beat}`);
      // A step over one or more beats with nothing said about the change.
      if (to > from + 1 && !unit.transition?.trim()) add("ABRUPT_TRANSITION", "REVIEW", unit.id, `${previous.beat} -> ${unit.beat} with no transition`);
    }
    if (previous && previous.year !== null && unit.year !== null && unit.year < previous.year && !unit.outOfSequence) add("CHRONOLOGY_BREAK", "MAJOR", unit.id, `${previous.year} -> ${unit.year}`);
    previous = unit;
  }
  if (units.length > 0 && (totalSeconds < NARRATIVE_POLICY.minTotalSeconds || totalSeconds > NARRATIVE_POLICY.maxTotalSeconds)) add("DURATION_OUT_OF_RANGE", "REVIEW", null, `${Math.round(totalSeconds)} s; the target is ${NARRATIVE_POLICY.minTotalSeconds}-${NARRATIVE_POLICY.maxTotalSeconds} s`);

  // ---- repeated facts ----------------------------------------------------------------------------------------
  const claimFirstSeen = new Map<string, number>();
  const sentenceFirstSeen = new Map<string, number>();
  for (const unit of units) {
    for (const claimId of new Set(unit.claimIds)) {
      const first = claimFirstSeen.get(claimId);
      if (first !== undefined) add("REPEATED_FACT", "REVIEW", unit.id, `claim ${claimId} was already stated in unit ${first}`);
      else claimFirstSeen.set(claimId, unit.id);
    }
    for (const sentence of sentences(unit.narration)) {
      const key = normalized(sentence);
      if (key.split(" ").length < 5) continue;
      const first = sentenceFirstSeen.get(key);
      if (first !== undefined && first !== unit.id) add("REPEATED_FACT", "REVIEW", unit.id, `a sentence of unit ${first} is said again`);
      else if (first === undefined) sentenceFirstSeen.set(key, unit.id);
    }
  }

  // ---- long exposition: more time setting the story up than the story's rise and turn take ------------------------
  if (beatSeconds.CONTEXT > 0 && beatSeconds.CONTEXT > beatSeconds.ESCALATION + beatSeconds.TURNING_POINT) {
    add("LONG_EXPOSITION", "REVIEW", null, `context ${Math.round(beatSeconds.CONTEXT)} s; escalation and turning point ${Math.round(beatSeconds.ESCALATION + beatSeconds.TURNING_POINT)} s`);
  }

  // ---- setups and payoffs --------------------------------------------------------------------------------------
  const open = new Map<string, number>();
  for (const unit of units) {
    for (const label of unit.payoffs) { if (open.has(label)) open.delete(label); else add("PAYOFF_WITHOUT_SETUP", "REVIEW", unit.id, label); }
    for (const label of unit.setups) if (!open.has(label)) open.set(label, unit.id);
  }
  for (const [label, unitId] of open) add("UNRESOLVED_SETUP", "MAJOR", unitId, label);

  // ---- drama that no supported claim carries ---------------------------------------------------------------------
  for (const unit of units) {
    const supported = factPack ? unit.claimIds.some((id) => { const claim = factPack.claims.find((candidate) => candidate.id === id); return claim !== undefined && classifyFactEvidence(claim, factPack) === "SUPPORTED"; }) : false;
    if (supported) continue;
    for (const sentence of sentences(unit.narration)) {
      const phrase = DRAMATIC.find((candidate) => lower(sentence).includes(candidate));
      if (phrase) { add("UNSUPPORTED_DRAMATIC_CLAIM", factPack ? "BLOCKER" : "MAJOR", unit.id, factPack ? `"${phrase}" with no supported claim in the unit` : `"${phrase}" and no fact pack to check it against`); break; }
    }
  }

  // ---- static visual time --------------------------------------------------------------------------------------
  const staticSeconds = (unit: NarrativeUnit) => (Number.isFinite(unit.staticVisualSeconds) && unit.staticVisualSeconds > 0 ? Math.min(unit.staticVisualSeconds, seconds(unit) || unit.staticVisualSeconds) : 0);
  const staticVisualSeconds = units.reduce((sum, unit) => sum + staticSeconds(unit), 0);
  for (const unit of units) if (staticSeconds(unit) > NARRATIVE_POLICY.maxStaticSecondsPerUnit) add("EXCESSIVE_STATIC_VISUAL_TIME", "REVIEW", unit.id, `${Math.round(staticSeconds(unit))} s on a static image`);
  // More of the story on images that do not move than on ones that do.
  if (totalSeconds > 0 && staticVisualSeconds > totalSeconds / 2) add("EXCESSIVE_STATIC_VISUAL_TIME", "REVIEW", null, `${Math.round(staticVisualSeconds)} s of ${Math.round(totalSeconds)} s is static`);

  return {
    gate: findings.some((finding) => finding.severity === "BLOCKER") ? "BLOCKED" : findings.length ? "REVIEW_REQUIRED" : "PASS",
    findings, totalSeconds, beatSeconds, staticVisualSeconds, authority: "ADVISORY_ONLY",
  };
}
