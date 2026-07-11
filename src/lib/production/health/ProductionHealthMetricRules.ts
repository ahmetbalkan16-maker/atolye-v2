import type { ProductionHealthRule } from "@/types/productionHealth";
import {
  createHealthFinding,
  createRule,
  productionHealthThresholds,
} from "./ProductionHealthRules";

export const productionHealthMetricRules: readonly ProductionHealthRule[] = [
  createRule("history-signals", "history", "Evaluates terminal history failures, cancellations and success rate.", (snapshot, context) => {
    const findings = [];
    if (snapshot.history.failedEvents > 0) findings.push(createHealthFinding({ code: "history_failed_events", severity: "warning", category: "history", scope: "history", sources: ["history"], message: "Terminal history contains failed events.", evidence: { failedEvents: snapshot.history.failedEvents }, detectedAt: context.evaluatedAt }));
    if (snapshot.history.cancelledEvents > 0) findings.push(createHealthFinding({ code: "history_cancelled_events", severity: "warning", category: "history", scope: "history", sources: ["history"], message: "Terminal history contains cancelled events.", evidence: { cancelledEvents: snapshot.history.cancelledEvents }, detectedAt: context.evaluatedAt }));
    if (snapshot.history.totalTerminalEvents >= productionHealthThresholds.minimumRateSampleSize && snapshot.history.successRate.state === "known" && snapshot.history.successRate.value < productionHealthThresholds.lowHistorySuccessRate) findings.push(createHealthFinding({ code: "history_low_success_rate", severity: "warning", category: "history", scope: "history", sources: ["history"], message: "Terminal history success rate is below the configured threshold.", evidence: { successRate: snapshot.history.successRate.value, threshold: productionHealthThresholds.lowHistorySuccessRate, sampleSize: snapshot.history.totalTerminalEvents }, detectedAt: context.evaluatedAt }));
    return findings;
  }),
  createRule("usage-signals", "usage", "Evaluates AI failure, fallback and telemetry coverage.", (snapshot, context) => {
    const findings = [];
    const requests = snapshot.usage.totalRequests;
    const failureRate = requests === 0 ? 0 : snapshot.usage.failedRequests / requests;
    const fallbackRate = requests === 0 ? 0 : snapshot.usage.fallbackRequests / requests;
    if (requests > 0 && snapshot.usage.failedRequests === requests) findings.push(createHealthFinding({ code: "usage_all_requests_failed", severity: "critical", category: "usage", scope: "usage", sources: ["aiUsage"], message: "All recorded AI requests failed.", evidence: { requests }, detectedAt: context.evaluatedAt }));
    if (requests >= productionHealthThresholds.minimumRateSampleSize && failureRate >= productionHealthThresholds.highUsageFailureRate) findings.push(createHealthFinding({ code: "usage_high_failure_rate", severity: "warning", category: "usage", scope: "usage", sources: ["aiUsage"], message: "AI request failure rate meets or exceeds the configured threshold.", evidence: { failureRate, threshold: productionHealthThresholds.highUsageFailureRate, requests }, detectedAt: context.evaluatedAt }));
    if (requests >= productionHealthThresholds.minimumRateSampleSize && fallbackRate >= productionHealthThresholds.highUsageFallbackRate) findings.push(createHealthFinding({ code: "usage_high_fallback_rate", severity: "warning", category: "usage", scope: "usage", sources: ["aiUsage"], message: "AI fallback rate meets or exceeds the configured threshold.", evidence: { fallbackRate, threshold: productionHealthThresholds.highUsageFallbackRate, requests }, detectedAt: context.evaluatedAt }));
    if (requests > 0 && snapshot.usage.tokenCoverage < 1) findings.push(createHealthFinding({ code: "usage_token_coverage_partial", severity: "info", category: "usage", scope: "usage", sources: ["aiUsage"], message: "AI token coverage is partial.", evidence: { coverage: snapshot.usage.tokenCoverage }, detectedAt: context.evaluatedAt }));
    if (requests > 0 && snapshot.usage.costCoverage < 1) findings.push(createHealthFinding({ code: "usage_cost_coverage_partial", severity: "info", category: "usage", scope: "usage", sources: ["aiUsage"], message: "AI cost coverage is partial.", evidence: { coverage: snapshot.usage.costCoverage }, detectedAt: context.evaluatedAt }));
    const completedAiStages = snapshot.stages.filter((stage) => stage.effectiveStatus === "completed" && (stage.stage === "research" || stage.stage === "script" || stage.stage === "scenes"));
    if (requests === 0 && completedAiStages.length > 0 && snapshot.sourceState.aiUsage.status === "available") findings.push(createHealthFinding({ code: "completed_ai_stages_without_usage", severity: "info", category: "usage", scope: "usage", sources: ["manifest", "aiUsage"], message: "Completed AI stages have no recorded AI usage.", evidence: { completedAiStages: completedAiStages.length }, detectedAt: context.evaluatedAt }));
    return findings;
  }),
];
