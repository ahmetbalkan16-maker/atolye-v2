/**
 * Atölye Brain — the morning report (pure).
 *
 * When the PC comes back on, the Brain Worker reports its overnight cycle in
 * exactly the shape section "SABAH PC AÇILDIĞINDA" of the emir asks for:
 *
 *   "Overnight I analysed these tasks. I found this problem. I ran these tests.
 *    I proposed this improvement. I found this security risk. I did NOT do these
 *    things without your approval. I am waiting on your approval for these.
 *    The next single step is …"
 *
 * All text is run through {@link redactBrainLines} before it lands in the report.
 */

import { stableBrainId } from "../BrainId";
import { redactBrainLines } from "../BrainRedaction";
import { pendingApprovalBrainTasks } from "./BrainTaskQueue";
import {
  brainWorkerSchemaVersion,
  type BrainTask,
  type BrainTaskResult,
  type BrainWorkerCycleReport,
} from "@/types/brainWorker";

export interface BrainWorkerCycleInput {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly queueAtStart: readonly BrainTask[];
  readonly results: readonly BrainTaskResult[];
  readonly gpu?: BrainWorkerCycleReport["gpu"];
  readonly nextSingleStep: string;
}

function collect(
  results: readonly BrainTaskResult[],
  outcomeKind: BrainTaskResult["outcomeKind"],
): string[] {
  return results
    .filter((result) => result.outcomeKind === outcomeKind)
    .map((result) => result.summary);
}

/**
 * Build the structured cycle report. Deterministic. Never throws — a malformed
 * result just contributes nothing.
 */
export function buildBrainWorkerCycleReport(
  input: BrainWorkerCycleInput,
): BrainWorkerCycleReport {
  const results = input.results;
  const run = results.filter(
    (result) => result.status === "succeeded" || result.status === "failed",
  );

  const analyses = redactBrainLines(collect(results, "analysis")).lines;
  const diagnoses = redactBrainLines(collect(results, "diagnosis")).lines;
  const testsRun = redactBrainLines(collect(results, "test-run")).lines;
  const proposals = redactBrainLines(
    results
      .filter((result) => result.outcomeKind === "proposal")
      .map((result) => result.summary),
  ).lines;
  const securityFindings = redactBrainLines(collect(results, "security-finding")).lines;

  const problemsFound = redactBrainLines([
    ...diagnoses,
    ...results
      .filter((result) => result.status === "failed")
      .map((result) => `Task failed: ${result.summary}`),
  ]).lines;

  const pending = pendingApprovalBrainTasks(input.queueAtStart);
  const notDoneNeedingApproval = redactBrainLines(
    pending.map((task) => `${task.kind}: ${task.title} — ${task.rationale}`),
  ).lines;

  const awaitingUserApproval = redactBrainLines(
    results
      .filter((result) => result.status === "blocked-on-approval")
      .map((result) => result.summary),
  ).lines;

  return {
    schemaVersion: brainWorkerSchemaVersion,
    cycleId: stableBrainId("brain-worker-cycle", {
      startedAt: input.startedAt,
      results: results.map((result) => result.taskId),
    }),
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    tasksConsidered: input.queueAtStart.length,
    tasksRun: run.length,
    analyses,
    problemsFound,
    testsRun,
    improvementsProposed: proposals,
    securityRisks: securityFindings,
    notDoneNeedingApproval,
    awaitingUserApproval: [...new Set([...awaitingUserApproval, ...notDoneNeedingApproval])],
    ...(input.gpu ? { gpu: input.gpu } : {}),
    nextSingleStep: redactBrainLines([input.nextSingleStep]).lines[0] ?? "",
  };
}

/** Render the report as the plain-language morning brief. */
export function renderBrainWorkerCycleReport(
  report: BrainWorkerCycleReport,
): string {
  const section = (title: string, items: readonly string[]): string[] =>
    items.length
      ? [`## ${title}`, ...items.map((item) => `- ${item}`), ""]
      : [`## ${title}`, "- (none)", ""];

  const lines = [
    "# Atölye Brain — Overnight Report",
    "",
    `- Cycle: ${report.cycleId}`,
    `- Window: ${report.startedAt} → ${report.finishedAt}`,
    `- Tasks considered / run: ${report.tasksConsidered} / ${report.tasksRun}`,
    "",
    ...section("Analysed", report.analyses),
    ...section("Problems found", report.problemsFound),
    ...section("Tests run", report.testsRun),
    ...section("Improvements proposed", report.improvementsProposed),
    ...section("Security risks", report.securityRisks),
    ...section("NOT done — needs your approval", report.notDoneNeedingApproval),
    ...section("Waiting on your approval", report.awaitingUserApproval),
  ];

  if (report.gpu) {
    lines.push(
      "## GPU",
      `- used: ${report.gpu.used}`,
      ...(report.gpu.used
        ? [
            `- peak: ${report.gpu.peakCelsius ?? "?"} °C`,
            `- duration: ${report.gpu.durationMs ?? "?"} ms`,
            `- power: ${report.gpu.powerWatts ?? "?"} W`,
            `- cooldown: ${report.gpu.cooldownMs ?? "?"} ms`,
            `- throttle / TDR / WHEA: ${report.gpu.throttleOrFault ? "DETECTED — stopped" : "none"}`,
          ]
        : []),
      "",
    );
  }

  lines.push("## Next single step", report.nextSingleStep || "(none proposed)");
  return lines.join("\n");
}
