/** Stage 15K — production cost governor and reservation ledger. Fixture numbers and TEMP directories only; no paid call, no provider, no model. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

import { DEFAULT_AI_COST_BUDGET_USD } from "../src/lib/ai/AiCostBudget";
import { estimateProductionCost } from "../src/lib/production/ProductionCostEstimate";
import {
  costComponentsFromEstimate, governProductionCost, governProductionCostCheckpoint, PRODUCTION_COST_COMPONENTS, PRODUCTION_COST_POLICY,
  type CostGovernorInput, type ProductionCostComponent,
} from "../src/lib/production/ProductionCostGovernor";
import { admitCostReservation, committedCostUsd, summarizeCostLedger, type CostLedgerEvent } from "../src/lib/production/ProductionCostReservationLedger";
import { readCostLedger, releaseProjectCost, reserveProjectCost, settleProjectCost } from "../src/lib/production/ProductionCostReservationStore";

let count = 0;
async function scenario(name: string, run: () => void | Promise<void>) { await run(); count++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

const repo = process.cwd();
const AT = "2026-10-02T00:00:00.000Z";
const POLICY = { preferredTargetUsd: 0.25, technicalCeilingUsd: 1 };
const parts = (usd: Partial<Record<(typeof PRODUCTION_COST_COMPONENTS)[number], number>>, provider = "openai"): ProductionCostComponent[] =>
  PRODUCTION_COST_COMPONENTS.map((id) => ({ id, provider: id === "video" ? "ffmpeg" : id === "music" ? "music-library" : provider, estimatedUsd: usd[id] ?? 0 }));
const input = (over: Partial<CostGovernorInput> = {}): CostGovernorInput => ({
  components: parts({ llm: 0.1, tts: 0.08 }), remainingPricing: "KNOWN", observedUsd: 0, observedPricing: "KNOWN", approvedProjectCapUsd: 0.25, policy: POLICY,
  allowance: { basis: "OWNER_DECLARED_AT_PLANNING", totalUsd: 9.85, committedUsd: 0 }, ...over,
});
const decide = (over: Partial<CostGovernorInput> = {}) => { const report = governProductionCost(input(over)); return [report.decision, report.reason] as const; };
const reserve = (reservationId: string, projectId: string, capUsd: number): CostLedgerEvent => ({ type: "RESERVE", reservationId, projectId, capUsd, at: AT });

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-cost-governor-"));

async function main() {
  try {
    await scenario("the design's own numbers and lines: target 0.25, ceiling 1.00, allowance 9.85, and the preflight's six lines", () => {
      const order = fs.readFileSync(path.join(repo, "docs/ayas-execution/2026-09-27-master/00_COMMAND/AYAS_FINAL_CODEX_MASTER_EXECUTION_ORDER.md"), "utf8").replace(/\r\n/g, "\n");
      const section = order.slice(order.indexOf("## STAGE 15K"), order.indexOf("## STAGE 15L"));
      assert.match(section, /- preferred target = `\$0\.25\/video`\n- ordinary technical ceiling = `\$1\.00\/video`\n- planning-time owner-declared available allowance = `\$9\.85`/);
      assert.deepEqual(PRODUCTION_COST_POLICY, { preferredTargetUsd: 0.25, technicalCeilingUsd: 1, planningAllowanceUsd: 9.85 });
      assert.equal(PRODUCTION_COST_POLICY.technicalCeilingUsd, DEFAULT_AI_COST_BUDGET_USD, "the ceiling is the pipeline's own default budget");
      const lines = section.slice(section.indexOf("Preflight BEFORE paid dispatch:"), section.indexOf("Output:")).split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2));
      assert.deepEqual(lines, ["LLM", "image", "video", "TTS", "music/SFX", "retry reserve"]);
      for (const line of ["llm", "image", "video", "tts", "music"]) assert.ok((PRODUCTION_COST_COMPONENTS as readonly string[]).includes(line), line);
      assert.match(section, /“Estimated \$0\.82\. Current cap \$0\.25\. Authorize this project up to \$1\.00\?”/);
      assert.match(section, /Unknown pricing => fail closed\./);
    });

    await scenario("the decision before any paid dispatch: continue, pause and ask, or block", () => {
      // Nothing to pay: nothing to approve and nothing to reserve.
      const free = governProductionCost(input({ components: parts({}, "ollama"), approvedProjectCapUsd: null, allowance: { basis: "NOT_DECLARED", totalUsd: null, committedUsd: 0 } }));
      assert.deepEqual([free.decision, free.reason, free.reserveUsd, free.escalation, free.estimatedTotalUsd], ["CONTINUE", "ZERO_COST", 0, null, 0]);
      // Within the cap the owner approved: continue, and reserve that cap.
      const within = governProductionCost(input());
      assert.deepEqual([within.decision, within.reason, within.reserveUsd, within.estimatedTotalUsd, within.escalation], ["CONTINUE", "WITHIN_APPROVED_CAP", 0.25, 0.18, null]);
      assert.deepEqual(decide({ components: parts({ llm: 0.25 }) }), ["CONTINUE", "WITHIN_APPROVED_CAP"], "exactly the cap is within it");
      // Above the cap and under the ceiling: the exact question of the design.
      const above = governProductionCost(input({ components: parts({ llm: 0.5, tts: 0.32 }) }));
      assert.deepEqual([above.decision, above.reason, above.escalation, above.reserveUsd], ["PAUSE_ASK_OWNER", "ABOVE_APPROVED_CAP", "Estimated $0.82. Current cap $0.25. Authorize this project up to $1.00?", 0]);
      // No cap approved: a paid estimate is never run on the target alone.
      const noCap = governProductionCost(input({ approvedProjectCapUsd: null }));
      assert.deepEqual([noCap.decision, noCap.reason, noCap.escalation], ["PAUSE_ASK_OWNER", "NO_APPROVED_CAP", "Estimated $0.18. No cap is approved for this project. Authorize this project up to $0.25?"]);
      assert.equal(governProductionCost(input({ approvedProjectCapUsd: null, components: parts({ llm: 0.6 }) })).escalation, "Estimated $0.60. No cap is approved for this project. Authorize this project up to $1.00?");
      // Above the ceiling: blocked, whatever was approved.
      assert.deepEqual(decide({ components: parts({ llm: 1.01 }), approvedProjectCapUsd: 1 }), ["BLOCK", "ABOVE_TECHNICAL_CEILING"]);
      assert.deepEqual(decide({ components: parts({ llm: 1 }), approvedProjectCapUsd: 1 }), ["CONTINUE", "WITHIN_APPROVED_CAP"]);
      // What was already spent counts.
      assert.deepEqual([governProductionCost(input({ observedUsd: 0.1 })).estimatedTotalUsd, ...decide({ observedUsd: 0.1 })], [0.28, "PAUSE_ASK_OWNER", "ABOVE_APPROVED_CAP"]);
      // An unknown price is never read as zero.
      assert.deepEqual(decide({ remainingPricing: "UNKNOWN", components: parts({}) }), ["BLOCK", "UNKNOWN_PRICING"]);
      assert.deepEqual(decide({ observedPricing: "UNKNOWN" }), ["BLOCK", "UNKNOWN_PRICING"]);
    });

    await scenario("it never raises a cap: an approval above the ceiling counts up to the ceiling, and no decision continues above what was approved", () => {
      const generous = governProductionCost(input({ approvedProjectCapUsd: 5, components: parts({ llm: 0.9 }) }));
      assert.deepEqual([generous.decision, generous.approvedProjectCapUsd, generous.effectiveCapUsd, generous.reserveUsd], ["CONTINUE", 5, 1, 1]);
      assert.deepEqual(decide({ approvedProjectCapUsd: 5, components: parts({ llm: 1.2 }) }), ["BLOCK", "ABOVE_TECHNICAL_CEILING"]);
      let checked = 0;
      for (const cap of [null, 0, 0.1, 0.25, 0.5, 1, 3]) for (const estimate of [0, 0.01, 0.2, 0.25, 0.26, 0.82, 1, 1.01, 4]) for (const observed of [0, 0.3]) {
        const report = governProductionCost(input({ approvedProjectCapUsd: cap, observedUsd: observed, components: parts({ llm: estimate }) }));
        checked++;
        assert.equal(report.approvedProjectCapUsd, cap, "the approved cap is reported as given");
        assert.equal(report.authority, "NONE");
        if (report.decision === "CONTINUE" && report.estimatedTotalUsd > 0) {
          assert.ok(cap !== null && report.estimatedTotalUsd <= cap && report.estimatedTotalUsd <= 1, `continue at ${report.estimatedTotalUsd} with cap ${cap}`);
          assert.ok(report.reserveUsd <= Math.min(cap, 1));
        }
        if (report.escalation) assert.match(report.escalation, /Authorize this project up to \$(?:0\.25|1\.00)\?$/, "the question never names more than the ceiling");
      }
      assert.equal(checked, 126);
    });

    await scenario("what the owner sees: estimate, retry reserve, conservative maximum, zero-cost alternatives with what they give up, and the allowance with its label", () => {
      const report = governProductionCost(input({ components: [...parts({ llm: 0.1, tts: 0.08, image: 0.3, thumbnail: 0.04 }).filter((part) => part.id !== "animation"), { id: "animation", provider: "ollama", estimatedUsd: 0 }], approvedProjectCapUsd: 1, allowance: { basis: "OWNER_DECLARED_AT_PLANNING", totalUsd: 9.85, committedUsd: 2 } }));
      assert.deepEqual([report.estimatedTotalUsd, report.retryReserveUsd, report.conservativeMaxUsd, report.retryReserveFitsCap, report.aboveTarget, report.preferredTargetUsd, report.technicalCeilingUsd], [0.52, 0.3, 0.82, true, true, 0.25, 1]);
      assert.deepEqual(report.alternatives, [
        { component: "llm", provider: "openai", alternative: "ollama", savesUsd: 0.1, qualityTradeoff: "LOCAL_TEXT_MODEL_NOT_QUALIFIED" },
        { component: "image", provider: "openai", alternative: "real", savesUsd: 0.3, qualityTradeoff: "REAL_PHOTOS_DEPEND_ON_ARCHIVE_COVERAGE" },
        { component: "tts", provider: "openai", alternative: "piper", savesUsd: 0.08, qualityTradeoff: "LOCAL_VOICE_IS_THE_PIPER_BASELINE" },
        { component: "thumbnail", provider: "openai", alternative: "local", savesUsd: 0.04, qualityTradeoff: "LOCAL_THUMBNAIL_IS_A_FRAME_COMPOSITE" },
      ]);
      assert.deepEqual(report.allowance, { basis: "OWNER_DECLARED_AT_PLANNING", totalUsd: 9.85, committedUsd: 2, projectedRemainingUsd: 6.85, label: "owner-declared at planning time; not revalidated" });
      assert.equal(governProductionCost(input({ allowance: { basis: "REVALIDATED", totalUsd: 9.85, committedUsd: 0 } })).allowance.label, "revalidated by the owner for this execution");
      // A retry reserve that does not fit the cap is said, and the decision still rests on the estimate.
      const tight = governProductionCost(input({ components: parts({ llm: 0.2 }) }));
      assert.deepEqual([tight.decision, tight.conservativeMaxUsd, tight.retryReserveFitsCap], ["CONTINUE", 0.4, false]);
      assert.equal(governProductionCost(input({ components: parts({ llm: 0.2 }, "ollama") })).alternatives.length, 0, "a component already on the alternative has none");
    });

    await scenario("allowance: not declared pauses, a cap that would oversubscribe it blocks, and what is committed counts", () => {
      assert.deepEqual(decide({ allowance: { basis: "NOT_DECLARED", totalUsd: null, committedUsd: 0 } }), ["PAUSE_ASK_OWNER", "ALLOWANCE_NOT_DECLARED"]);
      assert.match(governProductionCost(input({ allowance: { basis: "NOT_DECLARED", totalUsd: null, committedUsd: 0 } })).escalation!, /^Estimated \$0\.18 within the approved cap \$0\.25\. No allowance is declared\./);
      assert.deepEqual(decide({ allowance: { basis: "OWNER_DECLARED_AT_PLANNING", totalUsd: 9.85, committedUsd: 9.6 } }), ["CONTINUE", "WITHIN_APPROVED_CAP"], "exactly the allowance");
      assert.deepEqual(decide({ allowance: { basis: "OWNER_DECLARED_AT_PLANNING", totalUsd: 9.85, committedUsd: 9.61 } }), ["BLOCK", "ALLOWANCE_OVERSUBSCRIBED"]);
      // The cap is what is reserved, so the cap is what has to fit, not the smaller estimate.
      assert.deepEqual(decide({ approvedProjectCapUsd: 1, allowance: { basis: "OWNER_DECLARED_AT_PLANNING", totalUsd: 1, committedUsd: 0.5 } }), ["BLOCK", "ALLOWANCE_OVERSUBSCRIBED"]);
      assert.equal(governProductionCost(input({ allowance: { basis: "OWNER_DECLARED_AT_PLANNING", totalUsd: 9.85, committedUsd: 9.61 } })).allowance.projectedRemainingUsd, 0.24, "nothing is reserved by a block");
    });

    await scenario("numbers that cannot be trusted fail closed", () => {
      for (const bad of [{ observedUsd: -1 }, { observedUsd: Number.NaN }, { approvedProjectCapUsd: -0.1 }, { policy: { preferredTargetUsd: 2, technicalCeilingUsd: 1 } }, { policy: { preferredTargetUsd: 0.25, technicalCeilingUsd: Number.POSITIVE_INFINITY } },
        { components: parts({ llm: -0.1 }) }, { components: [...parts({}), { id: "llm" as const, provider: "openai", estimatedUsd: 0.1 }] }, { components: [{ id: "bribe" as never, provider: "x", estimatedUsd: 0 }] },
        { allowance: { basis: "NOT_DECLARED" as const, totalUsd: 5, committedUsd: 0 } }, { allowance: { basis: "REVALIDATED" as const, totalUsd: null, committedUsd: 0 } }, { allowance: { basis: "REVALIDATED" as const, totalUsd: 5, committedUsd: -1 } }]) {
        const report = governProductionCost(input(bad as Partial<CostGovernorInput>));
        assert.deepEqual([report.decision, report.reason, report.reserveUsd, report.escalation], ["BLOCK", "INPUT_INVALID", 0, null], JSON.stringify(bad));
      }
    });

    await scenario("in the middle of a project: a billable call that would pass the reserved cap is paused before it is made", () => {
      const check = (over: Partial<Parameters<typeof governProductionCostCheckpoint>[0]>) => { const result = governProductionCostCheckpoint({ observedUsd: 0.2, observedPricing: "KNOWN", nextCallUsd: 0.04, nextCallPricing: "KNOWN", reservedCapUsd: 0.25, ...over }); return [result.decision, result.reason, result.projectedUsd]; };
      assert.deepEqual(check({}), ["CONTINUE", "WITHIN_RESERVED_CAP", 0.24]);
      assert.deepEqual(check({ nextCallUsd: 0.05 }), ["CONTINUE", "WITHIN_RESERVED_CAP", 0.25]);
      assert.deepEqual(check({ nextCallUsd: 0.06 }), ["PAUSE_BEFORE_BILLABLE_CALL", "PROJECTED_ABOVE_RESERVED_CAP", 0.26]);
      assert.deepEqual(check({ nextCallUsd: 0, observedUsd: 5 }), ["CONTINUE", "FREE_CALL", 5], "a free call always goes out");
      assert.deepEqual(check({ reservedCapUsd: null }), ["PAUSE_BEFORE_BILLABLE_CALL", "NOTHING_RESERVED", 0.24]);
      assert.deepEqual(check({ nextCallPricing: "UNKNOWN", nextCallUsd: 0 }), ["BLOCK", "UNKNOWN_PRICING", 0.2]);
      assert.deepEqual(check({ observedPricing: "UNKNOWN" }), ["BLOCK", "UNKNOWN_PRICING", 0.24]);
      for (const bad of [{ observedUsd: -1 }, { nextCallUsd: Number.NaN }, { reservedCapUsd: -1 }]) assert.deepEqual(check(bad).slice(0, 2), ["BLOCK", "INPUT_INVALID"], JSON.stringify(bad));
    });

    await scenario("the pipeline's own estimate feeds the governor: paid providers are priced, local ones are zero, and an unpriced estimate stays unknown", () => {
      const inputs = { chapterCount: 6, sceneCount: 16, narrationCharacters: 9000, plannedAiImageCount: 4, textModel: "gpt-4o-mini", ttsModel: "gpt-4o-mini-tts", imageModel: "gpt-image-1", imageSize: "1536x1024", imageQuality: "low" };
      const paid = estimateProductionCost(inputs, { budgetUsd: 1 });
      const fromPaid = costComponentsFromEstimate(paid);
      assert.deepEqual(fromPaid.components.map((part) => part.id), [...PRODUCTION_COST_COMPONENTS]);
      assert.deepEqual([paid.status, fromPaid.remainingPricing, paid.totalUsd > 0], ["known", "KNOWN", true], "these models have price rows");
      assert.ok(Math.abs(fromPaid.components.reduce((sum, part) => sum + part.estimatedUsd, 0) - paid.totalUsd) < 1e-6, "the lines add up to the pipeline's total");
      assert.deepEqual(fromPaid.components.filter((part) => part.id === "video" || part.id === "music"), [{ id: "video", provider: "ffmpeg", estimatedUsd: 0 }, { id: "music", provider: "music-library", estimatedUsd: 0 }]);
      const local = estimateProductionCost({ ...inputs, textProvider: "ollama", animationProvider: "ollama", youtubeProvider: "ollama", ttsProvider: "piper", imageProvider: "real", thumbnailProvider: "local" }, { budgetUsd: 1 });
      const fromLocal = costComponentsFromEstimate(local);
      assert.deepEqual([local.status, local.totalUsd, fromLocal.remainingPricing, fromLocal.components.every((part) => part.estimatedUsd === 0)], ["known", 0, "KNOWN", true]);
      assert.deepEqual(decide({ ...fromLocal, approvedProjectCapUsd: null, allowance: { basis: "NOT_DECLARED", totalUsd: null, committedUsd: 0 } }), ["CONTINUE", "ZERO_COST"]);
      // An estimate the pipeline could not price: its numbers are not used, and the governor blocks.
      const unpriced = costComponentsFromEstimate({ status: "unknown", breakdown: { ...paid.breakdown, llmUsd: Number.NaN, unknownComponents: ["llm"] }, providers: paid.providers });
      assert.deepEqual([unpriced.remainingPricing, unpriced.components.every((part) => part.estimatedUsd === 0), ...decide(unpriced)], ["UNKNOWN", true, "BLOCK", "UNKNOWN_PRICING"]);
      assert.equal(costComponentsFromEstimate({ ...paid, breakdown: { ...paid.breakdown, unknownComponents: ["tts"] } }).remainingPricing, "UNKNOWN");
    });

    await scenario("ledger: reserve, settle with the actual cost and release the rest; a list that cannot be trusted is a problem, never skipped", () => {
      const events: CostLedgerEvent[] = [reserve("r1", "p1", 0.25), reserve("r2", "p2", 1), { type: "SETTLE", reservationId: "r1", actualUsd: 0.2, at: AT }, reserve("r3", "p3", 0.5), { type: "RELEASE", reservationId: "r3", at: AT }];
      const summary = summarizeCostLedger(events);
      assert.deepEqual([summary.events, summary.active.map((item) => item.reservationId), summary.reservedUsd, summary.settledUsd, summary.overruns, summary.problems, committedCostUsd(summary)], [5, ["r2"], 1, 0.2, [], [], 1.2]);
      // A project that cost more than its cap: the whole amount is counted as spent, and it is named.
      const overrun = summarizeCostLedger([reserve("r1", "p1", 0.25), { type: "SETTLE", reservationId: "r1", actualUsd: 0.4, at: AT }]);
      assert.deepEqual([overrun.settledUsd, overrun.overruns, overrun.problems], [0.4, ["r1"], []]);
      // The same project may reserve again after it has settled.
      assert.deepEqual(summarizeCostLedger([reserve("r1", "p1", 0.25), { type: "SETTLE", reservationId: "r1", actualUsd: 0.1, at: AT }, reserve("r4", "p1", 0.25)]).problems, []);
      const bad: readonly (readonly [readonly unknown[], readonly string[]])[] = [
        [[null], ["EVENT:0"]], [[{ type: "RESERVE" }], ["EVENT:0"]], [[{ ...reserve("r1", "p1", 0.25), type: "GRANT" }], ["EVENT:0"]],
        [[reserve("r1", "p1", 0)], ["EVENT:0"]], [[reserve("r1", "p1", -1)], ["EVENT:0"]], [[reserve("r 1", "p1", 0.25)], ["EVENT:0"]], [[{ ...reserve("r1", "p1", 0.25), at: "yesterday" }], ["EVENT:0"]],
        [[reserve("r1", "p1", 0.25), reserve("r1", "p2", 0.25)], ["EVENT:1"]], [[reserve("r1", "p1", 0.25), reserve("r2", "p1", 0.25)], ["EVENT:1"]],
        [[{ type: "SETTLE", reservationId: "r9", actualUsd: 0.1, at: AT }], ["EVENT:0"]], [[reserve("r1", "p1", 0.25), { type: "SETTLE", reservationId: "r1", actualUsd: -1, at: AT }], ["EVENT:1"]],
        [[reserve("r1", "p1", 0.25), { type: "SETTLE", reservationId: "r1", actualUsd: 0.1, at: AT }, { type: "SETTLE", reservationId: "r1", actualUsd: 0.1, at: AT }], ["EVENT:2"]],
        [[reserve("r1", "p1", 0.25), { type: "SETTLE", reservationId: "r1", actualUsd: 0.1, at: AT }, { type: "RELEASE", reservationId: "r1", at: AT }], ["EVENT:2"]],
        [[reserve("r1", "p1", 0.25), { type: "RELEASE", reservationId: "r1", at: AT }, reserve("r1", "p1", 0.25)], ["EVENT:2"]],
      ];
      for (const [list, expected] of bad) assert.deepEqual(summarizeCostLedger(list).problems, expected, JSON.stringify(list).slice(0, 140));
    });

    await scenario("concurrent projects cannot oversubscribe: settled spend and every active cap count against the declared allowance", () => {
      const admit = (events: readonly unknown[], capUsd: number, allowance: number | null, projectId = "p9", reservationId = "r9") => { const result = admitCostReservation(summarizeCostLedger(events), { reservationId, projectId, capUsd }, allowance); return result.ok ? result.remainingAfterUsd : result.reason; };
      assert.equal(admit([], 0.6, 1), 0.4);
      assert.equal(admit([reserve("r1", "p1", 0.6)], 0.6, 1), "ALLOWANCE_OVERSUBSCRIBED");
      assert.equal(admit([reserve("r1", "p1", 0.6)], 0.4, 1), 0);
      // Settling at less than the cap frees the rest; settled spend still counts.
      const settled = [reserve("r1", "p1", 0.6), { type: "SETTLE", reservationId: "r1", actualUsd: 0.2, at: AT }];
      assert.equal(admit(settled, 0.6, 1), 0.2);
      assert.equal(admit(settled, 0.81, 1), "ALLOWANCE_OVERSUBSCRIBED");
      assert.equal(admit([reserve("r1", "p1", 0.6), { type: "RELEASE", reservationId: "r1", at: AT }], 1, 1), 0);
      assert.equal(admit([], 0.6, null), "ALLOWANCE_NOT_DECLARED");
      assert.equal(admit([], 0, 1), "CAP_INVALID"); assert.equal(admit([], Number.NaN, 1), "CAP_INVALID");
      assert.equal(admit([], 0.5, 1, "p 9"), "ID_INVALID");
      assert.equal(admit([reserve("r1", "p9", 0.1)], 0.1, 1), "PROJECT_ALREADY_RESERVED");
      assert.equal(admit([reserve("r9", "p1", 0.1)], 0.1, 1), "RESERVATION_EXISTS");
      assert.equal(admit([{ type: "SETTLE", reservationId: "r7", actualUsd: 0.1, at: AT }], 0.1, 1), "LEDGER_UNTRUSTED", "a ledger with a problem admits nothing");
    });

    await scenario("store: one file per event that is never rewritten; a gap, a stray file or a damaged record stops every reservation", () => {
      const dir = path.join(temp, "ledger");
      assert.deepEqual([readCostLedger(dir).summary.events, readCostLedger(dir).summary.problems], [0, []], "a ledger that does not exist yet is empty, not broken");
      const first = reserveProjectCost(dir, { reservationId: "r1", projectId: "p1", capUsd: 0.6, at: AT }, 1);
      assert.deepEqual([first.ok && first.seq, fs.readdirSync(dir)], [1, ["000001.json"]]);
      const bytes = fs.readFileSync(path.join(dir, "000001.json"));
      assert.deepEqual(reserveProjectCost(dir, { reservationId: "r2", projectId: "p2", capUsd: 0.6, at: AT }, 1), { ok: false, reason: "ALLOWANCE_OVERSUBSCRIBED" });
      assert.deepEqual(reserveProjectCost(dir, { reservationId: "r2", projectId: "p2", capUsd: 0.6, at: AT }, null), { ok: false, reason: "ALLOWANCE_NOT_DECLARED" });
      assert.deepEqual(settleProjectCost(dir, { reservationId: "r7", actualUsd: 0.1, at: AT }), { ok: false, reason: "EVENT_REFUSED" });
      const settled = settleProjectCost(dir, { reservationId: "r1", actualUsd: 0.2, at: AT });
      assert.deepEqual([settled.ok && settled.seq, settled.ok && settled.summary.settledUsd, settled.ok && settled.summary.active.length], [2, 0.2, 0]);
      const second = reserveProjectCost(dir, { reservationId: "r2", projectId: "p2", capUsd: 0.6, at: AT }, 1);
      assert.deepEqual([second.ok && second.seq, releaseProjectCost(dir, { reservationId: "r2", at: AT }).ok, releaseProjectCost(dir, { reservationId: "r2", at: AT })], [3, true, { ok: false, reason: "EVENT_REFUSED" }]);
      assert.deepEqual([fs.readdirSync(dir), fs.readFileSync(path.join(dir, "000001.json")).equals(bytes), readCostLedger(dir).summary.settledUsd, readCostLedger(dir).summary.reservedUsd], [["000001.json", "000002.json", "000003.json", "000004.json"], true, 0.2, 0]);
      // Anything that makes the list untrustworthy stops every reservation, and nothing is added.
      const damage = (name: string, make: (broken: string) => void) => {
        const broken = path.join(temp, name); fs.cpSync(dir, broken, { recursive: true }); make(broken);
        const before = fs.readdirSync(broken);
        assert.ok(readCostLedger(broken).summary.problems.length > 0, name);
        assert.deepEqual(reserveProjectCost(broken, { reservationId: "r5", projectId: "p5", capUsd: 0.1, at: AT }, 100), { ok: false, reason: "LEDGER_UNTRUSTED" }, name);
        assert.deepEqual(fs.readdirSync(broken), before, `${name}: nothing was added`);
        return readCostLedger(broken).storeProblems;
      };
      assert.deepEqual(damage("gap", (broken) => fs.rmSync(path.join(broken, "000002.json"))), ["SEQUENCE_GAP:000003.json"]);
      assert.deepEqual(damage("stray", (broken) => fs.writeFileSync(path.join(broken, "notes.txt"), "x")), ["UNEXPECTED_FILE:notes.txt"]);
      assert.deepEqual(damage("unreadable", (broken) => fs.writeFileSync(path.join(broken, "000002.json"), "{ not json")), ["RECORD_UNREADABLE:000002.json"]);
      assert.deepEqual(damage("renumbered", (broken) => fs.writeFileSync(path.join(broken, "000002.json"), JSON.stringify({ schemaVersion: "1", seq: 7, event: {} }))), ["RECORD_INVALID:000002.json"]);
      assert.deepEqual(damage("edited", (broken) => fs.writeFileSync(path.join(broken, "000001.json"), JSON.stringify({ schemaVersion: "1", seq: 1, event: reserve("r1", "p1", 0) }))), []);
      // A writer's own half-finished private file is not a problem for anyone else.
      const inFlight = path.join(temp, "in-flight"); fs.cpSync(dir, inFlight, { recursive: true }); fs.writeFileSync(path.join(inFlight, ".tmp-123-abc"), "{");
      assert.deepEqual(readCostLedger(inFlight).summary.problems, []);
    });

    await scenario("store under a race: a writer that loses a position reads again and decides again; real concurrent processes never oversubscribe", async () => {
      const raced = (competitorCap: number) => {
        const dir = path.join(temp, `race-${competitorCap}`); fs.mkdirSync(dir);
        const realLink = fs.linkSync; let done = false;
        // Another writer takes the first position between this writer's read and its write.
        fs.linkSync = ((from: fs.PathLike, to: fs.PathLike) => { if (!done) { done = true; fs.writeFileSync(to, JSON.stringify({ schemaVersion: "1", seq: 1, event: reserve("r1", "p1", competitorCap) })); } return realLink(from, to); }) as typeof fs.linkSync;
        try { return [reserveProjectCost(dir, { reservationId: "r2", projectId: "p2", capUsd: 0.6, at: AT }, 1), fs.readdirSync(dir)] as const; } finally { fs.linkSync = realLink; }
      };
      const [lost, lostFiles] = raced(0.6);
      assert.deepEqual([lost, lostFiles], [{ ok: false, reason: "ALLOWANCE_OVERSUBSCRIBED" }, ["000001.json"]], "the second writer saw the first one's reservation and was refused");
      const [fits, fitsFiles] = raced(0.3);
      assert.deepEqual([fits.ok && fits.seq, fits.ok && fits.summary.reservedUsd, fitsFiles], [2, 0.9, ["000001.json", "000002.json"]]);

      // Six processes, each reserving 0.3 of an allowance of 1.0, started together.
      const dir = path.join(temp, "concurrent"); fs.mkdirSync(dir);
      const worker = path.join(temp, "worker.ts");
      fs.writeFileSync(worker, `import { reserveProjectCost } from ${JSON.stringify(path.join(repo, "src/lib/production/ProductionCostReservationStore").replace(/\\/g, "/"))};\nconst id = process.argv[2]!;\nconst result = reserveProjectCost(${JSON.stringify(dir.replace(/\\/g, "/"))}, { reservationId: \`r-\${id}\`, projectId: \`p-\${id}\`, capUsd: 0.3, at: ${JSON.stringify(AT)} }, 1);\nconsole.log(JSON.stringify(result.ok ? { ok: true } : result));\n`);
      const tsx = path.join(repo, "node_modules", "tsx", "dist", "cli.mjs");
      const results = await Promise.all(Array.from({ length: 6 }, (_, index) => new Promise<{ ok: boolean; reason?: string }>((resolve, reject) => {
        const child = spawn(process.execPath, [tsx, worker, String(index)], { cwd: repo, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        let out = ""; let err = "";
        child.stdout.on("data", (chunk) => { out += String(chunk); }); child.stderr.on("data", (chunk) => { err += String(chunk); });
        child.on("error", reject); child.on("close", (code) => (code === 0 ? resolve(JSON.parse(out) as { ok: boolean; reason?: string }) : reject(new Error(err.slice(0, 400)))));
      })));
      const final = readCostLedger(dir);
      assert.deepEqual([final.summary.problems, results.filter((result) => result.ok).length, final.summary.active.length, final.summary.reservedUsd], [[], 3, 3, 0.9], "three caps of 0.3 fit an allowance of 1.0; the other three were refused");
      for (const refused of results.filter((result) => !result.ok)) assert.ok(refused.reason === "ALLOWANCE_OVERSUBSCRIBED" || refused.reason === "CONTENDED", String(refused.reason));
    });

    await scenario("operator script on a TEMP runtime: zero-cost continues, a paid estimate without a cap pauses with the question, an oversubscribed allowance blocks", () => {
      const runtime = path.join(temp, "runtime"); const authority = path.join(temp, "authority"); const slug = "constantinople";
      const folder = path.join(runtime, "projects", slug);
      fs.mkdirSync(folder, { recursive: true }); fs.mkdirSync(authority, { recursive: true });
      fs.writeFileSync(path.join(folder, "project.json"), JSON.stringify({ id: "p-1", slug, title: "Constantinople", status: "scenes", createdAt: AT, updatedAt: AT }));
      fs.writeFileSync(path.join(folder, "script.json"), JSON.stringify({ chapters: Array.from({ length: 6 }, (_, index) => ({ id: index + 1, title: `Bölüm ${index + 1}`, narration: "x".repeat(1500) })) }));
      fs.writeFileSync(path.join(folder, "scenes.json"), JSON.stringify({ scenes: Array.from({ length: 16 }, (_, index) => ({ id: index + 1, chapterId: 1, title: `Sahne ${index + 1}`, description: "x" })) }));
      const tsx = path.join(repo, "node_modules", "tsx", "dist", "cli.mjs");
      const script = path.join(repo, "scripts", "run-production-cost-governor.ts");
      const base: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "test", ATOLYE_RUNTIME_ROOT: runtime, ATOLYE_RUNTIME_AUTHORITY_ROOT: authority, OPENAI_API_KEY: "" };
      for (const key of ["AI_PROVIDER", "ANIMATION_PROVIDER", "AUDIO_PROVIDER", "IMAGE_PROVIDER", "THUMBNAIL_PROVIDER", "YOUTUBE_PROVIDER", "ATOLYE_AI_COST_BUDGET_USD", "OPENAI_MODEL"]) delete base[key];
      const local = { AI_PROVIDER: "ollama", ANIMATION_PROVIDER: "ollama", AUDIO_PROVIDER: "piper", IMAGE_PROVIDER: "real", THUMBNAIL_PROVIDER: "local", YOUTUBE_PROVIDER: "ollama" };
      const run = (env: Record<string, string>, ...args: string[]) => spawnSync(process.execPath, [tsx, script, "--project", slug, ...args], { cwd: repo, encoding: "utf8", windowsHide: true, timeout: 120_000, env: { ...base, ...env } });
      const snapshot = () => fs.readdirSync(folder).sort().join();
      const before = snapshot();
      const free = run(local);
      assert.equal(free.status, 0, free.stderr);
      assert.deepEqual([JSON.parse(free.stdout).report.decision, JSON.parse(free.stdout).report.reason, JSON.parse(free.stdout).report.reserveUsd], ["CONTINUE", "ZERO_COST", 0]);
      // The paid default: an estimate above zero and no approved cap.
      const paid = run({});
      const paidReport = JSON.parse(paid.stdout).report;
      assert.deepEqual([paid.status, paidReport.decision, paidReport.reason, paidReport.estimatedTotalUsd > 0, paidReport.reserveUsd], [2, "PAUSE_ASK_OWNER", "NO_APPROVED_CAP", true, 0], paid.stderr);
      {
        assert.match(paidReport.escalation, /^Estimated \$\d+\.\d\d\. No cap is approved for this project\. Authorize this project up to \$(?:0\.25|1\.00)\?$/);
        const approved = run({}, "--approved-cap", "1", "--allowance", "9.85", "--allowance-basis", "declared");
        const approvedReport = JSON.parse(approved.stdout).report;
        assert.deepEqual([approved.status, approvedReport.decision, approvedReport.reserveUsd, approvedReport.allowance.label], [0, "CONTINUE", 1, "owner-declared at planning time; not revalidated"]);
        // A ledger whose other projects already hold the allowance.
        const ledger = path.join(temp, "operator-ledger");
        assert.equal(reserveProjectCost(ledger, { reservationId: "r1", projectId: "another-project", capUsd: 9.5, at: AT }, 9.85).ok, true);
        const blocked = run({}, "--approved-cap", "1", "--allowance", "9.85", "--allowance-basis", "declared", "--ledger", ledger);
        assert.deepEqual([blocked.status, JSON.parse(blocked.stdout).report.decision, JSON.parse(blocked.stdout).report.reason, JSON.parse(blocked.stdout).ledger.reservedUsd], [3, "BLOCK", "ALLOWANCE_OVERSUBSCRIBED", 9.5]);
        assert.deepEqual(fs.readdirSync(ledger), ["000001.json"], "the script reads the ledger and reserves nothing");
      }
      for (const args of [["--approved-cap", "lots"], ["--approved-cap", "-1"], ["--allowance", "5"], ["--allowance-basis", "declared"], ["--allowance", "5", "--allowance-basis", "mine"], ["--raise-cap", "2"], ["--approved-cap", "1001"]]) {
        const refused = run(local, ...args); assert.equal(refused.status, 1, args.join(" ")); assert.match(refused.stderr, /COST_GOVERNOR_ARGUMENTS_INVALID/, args.join(" "));
      }
      assert.equal(snapshot(), before, "the project folder is as it was");
    });

    await scenario("it decides and records, and does nothing else: no provider, no network, no pipeline call, and nothing in the application reads it", () => {
      const governor = "src/lib/production/ProductionCostGovernor.ts"; const ledger = "src/lib/production/ProductionCostReservationLedger.ts"; const store = "src/lib/production/ProductionCostReservationStore.ts";
      const code = (file: string) => fs.readFileSync(path.join(repo, file), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      for (const file of [governor, ledger]) assert.ok(!/node:fs|node:child_process|node:path|node:os|Date\.now|new Date\(|process\./.test(code(file)), `${file} is pure`);
      for (const file of [governor, ledger, store]) {
        for (const forbidden of [/\bfetch\s*\(/, /node:https?|node:net|node:child_process/, /process\.env/, /Provider(?:Router|Config)|AIRouter|PipelineRunner|runObservedAIRequest/, /unlinkSync|renameSync|appendFileSync|truncateSync/]) assert.ok(!forbidden.test(code(file)), `${file} must not contain ${forbidden}`);
      }
      // The store removes only its own private file, and writes only whole new files.
      assert.deepEqual(code(store).match(/fs\.(?:rmSync|writeFileSync|linkSync|mkdirSync)\([^)]*\)?/g)!.map((call) => call.split("(")[0]).sort(), ["fs.linkSync", "fs.mkdirSync", "fs.rmSync", "fs.writeFileSync"]);
      assert.match(code(store), /fs\.rmSync\(temp, \{ force: true \}\)/); assert.match(code(store), /fs\.writeFileSync\(temp, [^\n]*\{ flag: "wx" \}\)/);
      // Nothing in the pipeline or the application calls the governor yet.
      const importers: string[] = [];
      const walk = (dir: string) => {
        if (!fs.existsSync(path.join(repo, dir))) return;
        for (const entry of fs.readdirSync(path.join(repo, dir), { withFileTypes: true })) {
          const relative = `${dir}/${entry.name}`;
          if (entry.isDirectory()) { if (entry.name !== "node_modules" && !entry.name.startsWith(".")) walk(relative); }
          else if (/\.tsx?$/.test(entry.name) && /ProductionCostGovernor|ProductionCostReservation(?:Ledger|Store)/.test(fs.readFileSync(path.join(repo, relative), "utf8"))) importers.push(relative);
        }
      };
      for (const dir of ["src", "app", "scripts"]) walk(dir);
      // Stage 15R: the safe-mode suites call the store on a TEMP ledger to prove a new reservation is refused in SAFE_READ_ONLY.
      assert.deepEqual(importers.filter((file) => ![governor, ledger, store, "scripts/run-production-cost-governor.ts", "scripts/smoke-ayas-production-cost-governor.ts", "scripts/smoke-ayas-production-cost-governor-mutations.ts",
        "scripts/smoke-ayas-safe-mode.ts", "scripts/smoke-ayas-safe-mode-mutations.ts"].includes(file)), []);
    });
  } finally {
    assert.equal(path.dirname(temp), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("ayas-cost-governor-"));
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log(`Stage 15K production cost governor: PASS (${count} scenarios; TEMP only; paid/provider/model actions 0)`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
