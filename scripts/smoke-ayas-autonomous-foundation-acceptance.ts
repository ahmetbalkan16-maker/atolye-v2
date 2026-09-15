import assert from "node:assert/strict";
import fs from "node:fs";
import { AYAS_EXECUTION_ALLOWLIST, AYAS_EXECUTION_RESERVED_ACTIONS } from "../src/lib/ayas/execution/AyasExecutionPolicy";
import { evaluateAyasZeroCost, AYAS_AUTONOMOUS_MONETARY_BUDGET_USD } from "../src/lib/ayas/policy/AyasZeroCostPolicy";
import { evaluateAyasMachineHealth } from "../src/lib/ayas/machine/AyasMachineHealthGuard";
import { classifyPatchTarget } from "../src/lib/brain/selfheal/BrainPatchSafety";

let checks = 0;
const check = (condition: unknown, message: string) => { checks += 1; assert.ok(condition, message); };
const read = (file: string) => fs.readFileSync(file, "utf8");

check(AYAS_AUTONOMOUS_MONETARY_BUDGET_USD === 0, "autonomous budget is zero");
check(evaluateAyasZeroCost("local-zero-cost").allowed, "local allowed");
check(evaluateAyasZeroCost("free-public").allowed, "free public allowed");
for (const value of ["paid", "subscription", "metered-free-tier", "unknown-cost"] as const) check(!evaluateAyasZeroCost(value).allowed, `${value} denied`);

const conversation = read("src/lib/ayas/execution/AyasGuidedRepairConversation.ts");
check(conversation.includes("planAyasDeveloperWorkflow"), "product repair uses planner");
check(!/import\s*\{[^}]*createAyasDeveloperWorkflow/.test(conversation), "no direct product planner bypass");
check((conversation.match(/this\.planRepairWorkflow\(/g) ?? []).length === 2, "initial and revision paths planned");

const route = read("app/api/ayas/chat/stream/route.ts");
for (const token of ["loadAyasProductBrainContext", "productBrainLines", "AyasGuidedRepairSessionRuntime"]) check(route.includes(token), `${token} reachable from product route`);
const productBrain = read("src/lib/ayas/AyasProductBrain.ts");
for (const name of ["Repo Brain", "Decision Brain", "Failure Brain", "Sprint Brain", "Project Brain"]) check(productBrain.includes(name), `${name} reachable`);

const canonical = read("src/lib/production/ProductionPipelineExecutionCanonicalRuntime.ts");
check((canonical.match(/assertAyasHeavyWorkloadAllowed/g) ?? []).length >= 3, "machine guard imported and checked twice");
check(!read("src/lib/production/ProductionHealthService.ts").includes("AyasMachineHealthGuard"), "health read path does not run machine readiness");
check(!read("src/lib/production/ProductionReadinessService.ts").includes("AyasMachineHealthGuard"), "readiness remains separate");
check(evaluateAyasMachineHealth({ observedAt: "2026-09-15T00:00:00.000Z", ramUsedPercent: 30, diskFreePercent: 50, processRssMb: 1, unavailable: ["cpu", "gpu", "vram"] }, { stage: "video", ownedActive: false }).action === "THROTTLE", "partial telemetry conservative");

check(AYAS_EXECUTION_RESERVED_ACTIONS.includes("resume-stage"), "resume reserved");
check(!("resume-stage" in AYAS_EXECUTION_ALLOWLIST), "automatic resume not allowlisted");
check(read("src/lib/production/ProductionControlledExecutionGateway.ts").includes("allowExecution:false"), "production execution default remains closed");

const controlled = read("src/lib/ayas/execution/AyasControlledSelfImprovement.ts");
for (const link of ["research/evidence", "Graphify impact", "planner", "durable workflow", "authorization", "execution gate", "mutation", "tests", "evaluation", "memory"]) check(controlled.includes(`\"${link}\"`), `${link} chain link present`);
check(classifyPatchTarget("src/lib/ayas/policy/AyasZeroCostPolicy.ts").level === "FORBIDDEN_AUTONOMOUS", "zero cost self-change forbidden");
check(classifyPatchTarget("src/lib/ayas/machine/AyasMachineHealthGuard.ts").level === "FORBIDDEN_AUTONOMOUS", "machine guard self-change forbidden");
check(classifyPatchTarget("src/lib/ayas/execution/AyasExecutionGate.ts").level === "FORBIDDEN_AUTONOMOUS", "execution gate self-change forbidden");

const research = read("src/lib/ai/ResearchPromptContext.ts");
check(research.includes("UNTRUSTED EXTERNAL EVIDENCE"), "external research labelled");
check(research.includes("sanitizeUntrustedText"), "external research sanitized");
check(read("src/lib/production/ProductionHealthService.ts").includes("evaluateProductionDocumentaryQuality"), "documentary quality product wiring");
check(read("src/lib/production/ProductionDocumentaryQuality.ts").includes("evaluateBrainQuality"), "existing quality evaluator reused");

console.log(JSON.stringify({ status: "PASS", suite: "ayas-autonomous-foundation-acceptance", scenarios: checks }));
