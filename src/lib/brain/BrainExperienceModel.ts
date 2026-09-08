/**
 * Atölye Brain — experience / memory model (section 2 of the emir).
 *
 * "Kontrolsüz self-training istemiyorum. Bunun yerine güvenli bir experience /
 * evaluation loop." This module is the **pure** analysis half of that loop: it
 * takes a set of past `BrainExperienceRecord`s (each one a structured summary of
 * a finished production — strategy, models, tokens, time, cost, media choices,
 * quality score, error classes, user feedback) and derives explainable
 * insights and a strategy recommendation for the next run.
 *
 * It learns nothing on its own and changes no behaviour. The persistence layer
 * (a JSON-file store, sibling of `AIUsageManager`) and the wiring that feeds a
 * recommendation into the orchestrator are separate, later, approved phases.
 */

import {
  type BrainErrorClass,
  type BrainExperienceInsight,
  type BrainExperienceQuery,
  type BrainExperienceRecord,
  type BrainInsightKind,
  type BrainProductionRequest,
  type BrainStrategyConstraint,
  type BrainStrategyRecommendation,
} from "@/types/brain";

function confidenceFor(support: number, minSupport: number): BrainExperienceInsight["confidence"] {
  if (support >= minSupport * 4) return "high";
  if (support >= minSupport * 2) return "moderate";
  return "low";
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function matchesQuery(record: BrainExperienceRecord, query: BrainExperienceQuery): boolean {
  if (query.topicCategory && record.topicCategory !== query.topicCategory) return false;
  if (query.hardwareProfileId && record.hardwareProfileId !== query.hardwareProfileId) return false;
  return true;
}

interface Bucket {
  readonly quality: number[];
  readonly cost: number[];
  failures: number;
  total: number;
}

function emptyBucket(): Bucket {
  return { quality: [], cost: [], failures: 0, total: 0 };
}

/**
 * Derive insights from experience. Deterministic; an insight is only emitted
 * when at least `query.minSupport` records / observations back it.
 */
export function deriveBrainExperienceInsights(
  records: readonly BrainExperienceRecord[],
  query: BrainExperienceQuery,
): readonly BrainExperienceInsight[] {
  const minSupport = Math.max(1, Math.floor(query.minSupport));
  const scoped = records.filter((record) => matchesQuery(record, query));
  const insights: BrainExperienceInsight[] = [];
  if (scoped.length < minSupport) return insights;

  const scopeLabel = [
    query.topicCategory ?? "all-categories",
    query.hardwareProfileId ?? "all-machines",
  ].join("/");

  /* ---- media-strategy-quality ---- */
  {
    const byStrategy = new Map<string, { quality: number[]; accepted: number; total: number }>();
    for (const record of scoped) {
      for (const outcome of record.media) {
        const bucket = byStrategy.get(outcome.strategy) ?? { quality: [], accepted: 0, total: 0 };
        bucket.quality.push(record.qualityScore);
        bucket.accepted += outcome.acceptedCount;
        bucket.total += outcome.sceneCount;
        byStrategy.set(outcome.strategy, bucket);
      }
    }
    const ranked = [...byStrategy.entries()]
      .filter(([, bucket]) => bucket.quality.length >= minSupport)
      .map(([strategy, bucket]) => ({
        strategy,
        meanQuality: mean(bucket.quality),
        acceptRate: bucket.total > 0 ? bucket.accepted / bucket.total : 0,
        support: bucket.quality.length,
      }))
      .sort((left, right) => right.meanQuality - left.meanQuality);
    if (ranked.length >= 2 && ranked[0].meanQuality - ranked[ranked.length - 1].meanQuality >= 0.08) {
      const best = ranked[0];
      const worst = ranked[ranked.length - 1];
      insights.push({
        kind: "media-strategy-quality",
        scope: scopeLabel,
        statement: `"${best.strategy}" media scored higher quality (${pct(best.meanQuality)}) than "${worst.strategy}" (${pct(worst.meanQuality)}) on similar topics.`,
        support: best.support,
        confidence: confidenceFor(best.support, minSupport),
        evidence: ranked.map((entry) => `${entry.strategy}: q=${pct(entry.meanQuality)} accept=${pct(entry.acceptRate)} n=${entry.support}`),
      });
    }
  }

  /* ---- provider-reliability + computation-mode ---- */
  {
    const byProvider = new Map<string, Bucket>();
    const byMode = new Map<string, Bucket>();
    for (const record of scoped) {
      for (const stage of record.stages) {
        if (query.stage && stage.stage !== query.stage) continue;
        const failed = stage.outcome === "failed" || stage.outcome === "degraded";

        const providerKey = `${stage.provider}:${stage.model}`;
        const providerBucket = byProvider.get(providerKey) ?? emptyBucket();
        providerBucket.total += 1;
        if (failed) providerBucket.failures += 1;
        providerBucket.quality.push(stage.qualityContribution ?? record.qualityScore);
        byProvider.set(providerKey, providerBucket);

        const modeBucket = byMode.get(stage.computationMode) ?? emptyBucket();
        modeBucket.total += 1;
        if (failed) modeBucket.failures += 1;
        byMode.set(stage.computationMode, modeBucket);
      }
    }

    for (const [providerKey, bucket] of byProvider) {
      if (bucket.total < minSupport) continue;
      const failureRate = bucket.failures / bucket.total;
      if (failureRate >= 0.34) {
        insights.push({
          kind: "provider-reliability",
          scope: `${scopeLabel}${query.stage ? `/${query.stage}` : ""}`,
          statement: `"${providerKey}" failed or degraded ${pct(failureRate)} of the time here — prefer an alternative or add retries.`,
          support: bucket.total,
          confidence: confidenceFor(bucket.total, minSupport),
          evidence: [`attempts=${bucket.total}`, `failures=${bucket.failures}`],
        });
      }
    }

    const single = byMode.get("single-call");
    const split = byMode.get("split-sequential");
    if (single && split && single.total >= minSupport && split.total >= minSupport) {
      const singleRate = single.failures / single.total;
      const splitRate = split.failures / split.total;
      if (singleRate - splitRate >= 0.15) {
        insights.push({
          kind: "computation-mode",
          scope: `${scopeLabel}${query.stage ? `/${query.stage}` : ""}`,
          statement: `Splitting heavy stages into sequential units cut the failure rate from ${pct(singleRate)} to ${pct(splitRate)}.`,
          support: single.total + split.total,
          confidence: confidenceFor(single.total + split.total, minSupport),
          evidence: [
            `single-call: ${single.failures}/${single.total}`,
            `split-sequential: ${split.failures}/${split.total}`,
          ],
        });
      }
    }
  }

  /* ---- error-pattern ---- */
  {
    const counts = new Map<BrainErrorClass, number>();
    for (const record of scoped) {
      for (const errorClass of record.errorClasses) {
        counts.set(errorClass, (counts.get(errorClass) ?? 0) + 1);
      }
    }
    const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]);
    if (ranked.length > 0 && ranked[0][1] >= minSupport) {
      insights.push({
        kind: "error-pattern",
        scope: scopeLabel,
        statement: `The most frequent failure class here is "${ranked[0][0]}" (${ranked[0][1]} run(s)).`,
        support: ranked[0][1],
        confidence: confidenceFor(ranked[0][1], minSupport),
        evidence: ranked.slice(0, 4).map(([errorClass, count]) => `${errorClass}: ${count}`),
      });
    }
  }

  /* ---- thermal-pattern ---- */
  {
    const withTemp = scoped.filter((record) => typeof record.totals.gpuPeakTempC === "number");
    if (withTemp.length >= minSupport) {
      const hot = withTemp.filter((record) => (record.totals.gpuPeakTempC ?? 0) >= 76);
      const thermalErrors = withTemp.filter((record) => record.errorClasses.includes("thermal"));
      if (hot.length >= minSupport || thermalErrors.length >= 1) {
        insights.push({
          kind: "thermal-pattern",
          scope: scopeLabel,
          statement: `${hot.length}/${withTemp.length} run(s) peaked ≥ 76 °C GPU${thermalErrors.length ? `, ${thermalErrors.length} hit a thermal failure` : ""} — serialise GPU stages with cooldowns here.`,
          support: withTemp.length,
          confidence: confidenceFor(withTemp.length, minSupport),
          evidence: withTemp
            .slice(0, 6)
            .map((record) => `peak=${record.totals.gpuPeakTempC}°C`),
        });
      }
    }
  }

  /* ---- cost-efficiency ---- */
  {
    const released = scoped.filter(
      (record) => record.qualityOutcome === "release" && record.totals.aiCostUsd >= 0,
    );
    if (released.length >= minSupport) {
      const localOnly = released.filter((record) => record.totals.aiCostUsd === 0);
      if (localOnly.length >= minSupport) {
        insights.push({
          kind: "cost-efficiency",
          scope: scopeLabel,
          statement: `${localOnly.length}/${released.length} released videos were produced at $0 (fully local) at mean quality ${pct(mean(localOnly.map((r) => r.qualityScore)))}.`,
          support: localOnly.length,
          confidence: confidenceFor(localOnly.length, minSupport),
          evidence: [`local-only releases: ${localOnly.length}`, `all releases: ${released.length}`],
        });
      }
    }
  }

  return insights.sort((left, right) => insightRank(left.kind) - insightRank(right.kind));
}

function insightRank(kind: BrainInsightKind): number {
  return {
    "thermal-pattern": 0,
    "provider-reliability": 1,
    "computation-mode": 2,
    "error-pattern": 3,
    "media-strategy-quality": 4,
    "cost-efficiency": 5,
  }[kind];
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Turn insights into a next-run strategy hint. Never executes anything — the
 * orchestrator decides whether to adopt it and records that as a
 * `BrainDecision`.
 */
export function recommendStrategyFromExperience(
  insights: readonly BrainExperienceInsight[],
  request: BrainProductionRequest,
): BrainStrategyRecommendation | undefined {
  if (insights.length === 0) return undefined;

  const rationale: string[] = [];
  const constraints = new Set<BrainStrategyConstraint>();
  const labelParts: string[] = [];

  for (const insight of insights) {
    if (insight.confidence === "low") continue;
    switch (insight.kind) {
      case "thermal-pattern":
        constraints.add("serialize-stages");
        constraints.add("cooldown-between-stages");
        labelParts.push("thermal-safe");
        rationale.push(insight.statement);
        break;
      case "computation-mode":
        constraints.add("small-work-units");
        labelParts.push("split-heavy-stages");
        rationale.push(insight.statement);
        break;
      case "provider-reliability":
        rationale.push(insight.statement);
        break;
      case "media-strategy-quality":
        labelParts.push("archival-first");
        rationale.push(insight.statement);
        break;
      case "cost-efficiency":
        if (request.costPolicy !== "allow-paid-with-approval") {
          labelParts.push("local-$0");
        }
        rationale.push(insight.statement);
        break;
      case "error-pattern":
        rationale.push(`Watch for: ${insight.statement}`);
        break;
    }
  }

  if (rationale.length === 0) return undefined;

  return {
    label: labelParts.length ? [...new Set(labelParts)].join("+") : "experience-informed",
    rationale,
    suggestedConstraints: [...constraints].sort(),
    derivedFromInsightCount: insights.filter((insight) => insight.confidence !== "low").length,
  };
}

/** One-line-per-insight report. */
export function renderBrainExperienceInsights(
  insights: readonly BrainExperienceInsight[],
): string {
  if (insights.length === 0) return "No experience insights yet (not enough history).";
  return insights
    .map((insight) => `[${insight.kind} · ${insight.confidence}] ${insight.statement}`)
    .join("\n");
}
