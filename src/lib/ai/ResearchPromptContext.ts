import type { ResearchData } from "@/types/research";

/**
 * Renders the research package into a compact, bounded prompt block so the
 * downstream text stages (script, scenes, SEO) are grounded in the same real,
 * source-checked facts the research stage already produced, instead of
 * re-deriving everything from the bare topic string.
 *
 * Every field is optional and length-capped. An empty / missing research
 * object yields an empty string, and callers omit the block entirely so the
 * existing prompt (and its behaviour) is unchanged when no research is passed.
 */
export function formatResearchForPrompt(research: ResearchData): string {
  const section = (
    label: string,
    value: unknown,
    maxItems: number,
  ): string | null => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed ? `${label}: ${trimmed.slice(0, 1200)}` : null;
    }
    if (Array.isArray(value)) {
      const items = value
        .filter(
          (entry): entry is string =>
            typeof entry === "string" && entry.trim().length > 0,
        )
        .slice(0, maxItems)
        .map((entry) => `  - ${entry.trim().slice(0, 400)}`);
      return items.length ? `${label}:\n${items.join("\n")}` : null;
    }
    return null;
  };

  return [
    section("Summary", research.summary, 1),
    section("Historical context", research.historicalContext, 1),
    section("Timeline", research.timeline, 12),
    section("Key people", research.characters, 12),
    section("Important places", research.locations, 12),
    section("Key events", research.keyEvents, 12),
    section("Strategies / methods", research.strategies, 10),
    section("Disputed or debated points", research.controversies, 8),
    section("Notable details", research.interestingFacts, 10),
    section("Suggested YouTube titles", research.youtubeTitles, 8),
  ]
    .filter((entry): entry is string => entry !== null)
    .join("\n");
}

/**
 * Scene-planning slice of the research block: the concrete visual subjects a
 * scene planner needs (people, places, events, ready-made image prompts), kept
 * separate from the narrative-history slice used by the script stage.
 */
export function formatResearchForScenePrompt(research: ResearchData): string {
  const list = (label: string, value: unknown, maxItems: number): string | null => {
    if (!Array.isArray(value)) return null;
    const items = value
      .filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim().length > 0,
      )
      .slice(0, maxItems)
      .map((entry) => `  - ${entry.trim().slice(0, 400)}`);
    return items.length ? `${label}:\n${items.join("\n")}` : null;
  };

  return [
    list("Scene ideas", research.sceneIdeas, 16),
    list("Suggested image prompts", research.imagePrompts, 16),
    list("Key events", research.keyEvents, 12),
    list("Important places", research.locations, 12),
    list("Key people", research.characters, 12),
  ]
    .filter((entry): entry is string => entry !== null)
    .join("\n");
}
