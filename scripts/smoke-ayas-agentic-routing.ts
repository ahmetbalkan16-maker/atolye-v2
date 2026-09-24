/** Deterministic Stage 7 routing evaluation. No network, storage or agent dispatch. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { classifyAyasComplexity } from "../src/lib/ayas/model/AyasComplexityRouter";
import { resolveDeterministicToolCandidate } from "../src/lib/ayas/AyasChatStream";
import { routeAyasModel } from "../src/lib/ayas/model/AyasModelRouter";
import type { AyasModelProvider } from "../src/lib/ayas/model/AyasModelTypes";

type Expectation = { tool: string | null; skill: string | null; model: "ollama" | null; agent: string; blocked: boolean };
type Case = { id: string; text: string; expected: Expectation; availableSkills?: string[]; availableAgents?: string[]; unavailableTools?: string[]; verifiedToolResultIds?: string[]; modelAvailable?: boolean; agentEvidence?: Record<string, number>; heldOut?: boolean };

const E = (tool: string | null = null, skill: string | null = null, model: "ollama" | null = "ollama", agent = "local-ayas", blocked = false): Expectation => ({ tool, skill, model, agent, blocked });
const cases: readonly Case[] = [
  { id: "greeting", text: "Merhaba!", expected: E() },
  { id: "arithmetic", text: "2 + 2 kaç eder?", expected: E() },
  { id: "answer-write", text: "Bu soruya kısa bir cevap yaz", expected: E() },
  { id: "memory", text: "Benim adım neydi?", expected: E() },
  { id: "memory-skill-registered", text: "Benim adım neydi?", availableSkills: ["ayas-conversational-intelligence"], expected: E(null, "ayas-conversational-intelligence") },
  { id: "document", text: "Checkpoint'e bak, nerede kalmışız?", expected: E("read-project-document") },
  { id: "source", text: "src/lib/ayas/model/AyasModelRouter.ts dosyasını açıkla", expected: E("inspect-source-file") },
  { id: "named-md", text: "ROADMAP.md dosyasını açıkla", expected: E("inspect-source-file") },
  { id: "status", text: "Git durumunu kontrol et", expected: E("inspect-repository-status") },
  { id: "status-paraphrase", text: "Depoda değişiklik var mı, git status göster", expected: E("inspect-repository-status") },
  { id: "beneficial-graph", text: "Depo mimarisindeki modül bağımlılıklarını açıkla", availableSkills: ["graphify"], expected: E(null, "graphify") },
  { id: "catalog", text: "Kaç proje var?", expected: E("list-production-projects") },
  { id: "fresh-news", text: "Bugünün güncel dış haberlerini araştır", expected: E(null, null, "ollama", "local-ayas", true) },
  { id: "fresh-latest", text: "En son dış kaynak haberlerini kaynaklarla bul", expected: E(null, null, "ollama", "local-ayas", true) },
  { id: "fresh-weather", text: "Paris'te bugün hava nasıl?", expected: E(null, null, "ollama", "local-ayas", true) },
  { id: "fresh-currency", text: "Güncel dolar kuru kaç?", expected: E(null, null, "ollama", "local-ayas", true) },
  { id: "research-general", text: "Kuantum hesaplama nedir, açıkla", expected: E() },
  { id: "skill-tests", text: "Bu depo için güvenli smoke test planı hazırla", availableSkills: ["ayas-tests"], expected: E(null, "ayas-tests") },
  { id: "skill-absent", text: "Bu depo için güvenli smoke test planı hazırla", expected: E() },
  { id: "skill-irrelevant", text: "Selam", availableSkills: ["ayas-tests", "ayas-conversational-intelligence"], expected: E() },
  { id: "model-down", text: "Merhaba", modelAvailable: false, expected: E(null, null, null, "local-ayas", true) },
  { id: "tool-down", text: "Git durumunu kontrol et", unavailableTools: ["inspect-repository-status"], expected: E(null, null, "ollama", "local-ayas", true) },
  { id: "verified-prior-result", text: "Git durumunu kontrol et", verifiedToolResultIds: ["inspect-repository-status"], expected: E() },
  { id: "privacy", text: "Özel yerel dosyam src/lib/ayas/model/AyasModelRouter.ts hakkında bilgi ver", availableAgents: ["codex"], expected: E("inspect-source-file") },
  { id: "code-agent", text: "Depoda kapsamlı TypeScript kod değişikliği yap ve test et", availableAgents: ["codex"], expected: E(null, null, "ollama", "codex", true) },
  { id: "code-agent-unavailable", text: "Depoda kapsamlı TypeScript kod değişikliği yap ve test et", expected: E(null, null, "ollama", "local-ayas", true) },
  { id: "agent-evidence", text: "Depoda kapsamlı TypeScript kod değişikliği yap ve test et", availableAgents: ["claude", "codex"], agentEvidence: { claude: 2, codex: 3 }, expected: E(null, null, "ollama", "codex", true) },
  { id: "agent-tie", text: "Depoda kapsamlı TypeScript kod değişikliği yap ve test et", availableAgents: ["claude", "codex"], expected: E(null, null, "ollama", "local-ayas", true) },
  { id: "read-only", text: "ROADMAP dosyasını oku", expected: E("read-project-document") },
  { id: "write-file", text: "src/lib/ayas/model/AyasModelRouter.ts dosyasını değiştir", expected: E(null, null, "ollama", "local-ayas", true) },
  { id: "multiple-files", text: "src/a.ts ve src/b.ts dosyalarını karşılaştır", expected: E(null, null, "ollama", "local-ayas", true) },
  { id: "variant-status", text: "Çalışma ağacının git durumunu göster", expected: E("inspect-repository-status") },
  { id: "variant-fresh", text: "Şu anki dış dünya gelişmelerini doğrula", expected: E(null, null, "ollama", "local-ayas", true) },
  { id: "variant-skill", text: "Smoke doğrulama planını çıkar", availableSkills: ["ayas-tests"], expected: E(null, "ayas-tests") },
  { id: "variant-agent", text: "Kod tabanındaki geniş değişikliği uygula ve doğrula", availableAgents: ["claude"], expected: E(null, null, "ollama", "claude", true) },
  { id: "variant-tool-down", text: "Checkpoint'i oku", unavailableTools: ["read-project-document"], expected: E(null, null, "ollama", "local-ayas", true) },
  // Reserved after the production selector was written and the validation set passed.
  { id: "heldout-git-paraphrase", text: "Lütfen git status çıktısını kontrol et", expected: E("inspect-repository-status"), heldOut: true },
  { id: "heldout-source-paraphrase", text: "src/lib/ayas/reasoning/AyasToolRegistry.ts hakkında bilgi ver", expected: E("inspect-source-file"), heldOut: true },
  { id: "heldout-live-price", text: "Bugün hisse fiyatı ne?", expected: E(null, null, "ollama", "local-ayas", true), heldOut: true },
  { id: "heldout-skill-availability", text: "Derleme için smoke test planı", availableSkills: ["ayas-tests"], expected: E(null, "ayas-tests"), heldOut: true },
  { id: "heldout-agent-availability", text: "Repo için kapsamlı kod değişikliği uygula", availableAgents: ["claude"], expected: E(null, null, "ollama", "claude", true), heldOut: true },
];

type Actual = Expectation;
const finalFile = path.resolve("src/lib/ayas/routing/AyasAgenticRouting.ts");
async function main() {
const final = fs.existsSync(finalFile)
  ? await import(pathToFileURL(finalFile).href) as typeof import("../src/lib/ayas/routing/AyasAgenticRouting")
  : null;

async function legacy(item: Case): Promise<Actual> {
  const complexity = classifyAyasComplexity(item.text);
  const tool = complexity === "TOOL" ? resolveDeterministicToolCandidate(item.text)?.action ?? null : null;
  const provider = (id: "ollama" | "cloud", available: boolean): AyasModelProvider => ({
    id, kind: id === "ollama" ? "local" : "cloud", model: "fixture", configured: id === "ollama",
    async health() { return { available, detail: "fixture", checkedAtMs: 0 }; },
    async chat() { throw new Error("no model call in route evaluation"); },
    async *stream() { throw new Error("no model call in route evaluation"); },
  });
  const route = await routeAyasModel({ text: item.text, providers: {
    ollama: provider("ollama", item.modelAvailable !== false), cloud: provider("cloud", false),
  } });
  return E(tool, null, route.decision.providerId === "ollama" ? "ollama" : null);
}

async function evaluate(item: Case): Promise<Actual> {
  if (!final) return legacy(item);
  const route = final.selectAyasAgenticRoute({
    text: item.text,
    availableModelIds: item.modelAvailable === false ? [] : ["ollama"],
    availableSkillIds: item.availableSkills ?? [],
    availableAgentIds: item.availableAgents ?? [],
    unavailableToolIds: item.unavailableTools ?? [],
    verifiedToolResultIds: item.verifiedToolResultIds ?? [],
    agentEvidence: item.agentEvidence ?? {},
  });
  return E(route.selectedToolId, route.selectedSkillId, route.selectedModelId, route.selectedAgentId, route.blocked);
}

const counts = { tool: 0, skill: 0, model: 0, agent: 0, blocked: 0, all: 0, unnecessaryTool: 0, missedTool: 0, irrelevantSkill: 0, unavailableHallucination: 0, missingMutationHold: 0 };
const misses: { id: string; actual: Actual; expected: Expectation }[] = [];
for (const item of cases) {
  const actual = await evaluate(item);
  for (const key of ["tool", "skill", "model", "agent", "blocked"] as const) if (actual[key] === item.expected[key]) counts[key]++;
  if (JSON.stringify(actual) === JSON.stringify(item.expected)) counts.all++;
  else misses.push({ id: item.id, actual, expected: item.expected });
  if (actual.tool && !item.expected.tool) counts.unnecessaryTool++;
  if (!actual.tool && item.expected.tool) counts.missedTool++;
  if (actual.skill && !item.expected.skill) counts.irrelevantSkill++;
  if (actual.tool && item.unavailableTools?.includes(actual.tool)) counts.unavailableHallucination++;
  if (actual.agent !== "local-ayas" && !item.availableAgents?.includes(actual.agent)) counts.unavailableHallucination++;
  if (actual.skill && !item.availableSkills?.includes(actual.skill)) counts.unavailableHallucination++;
  if (actual.model && item.modelAvailable === false) counts.unavailableHallucination++;
  if (["write-file", "code-agent", "code-agent-unavailable", "agent-evidence", "agent-tie", "variant-agent", "heldout-agent-availability"].includes(item.id) && !actual.blocked) counts.missingMutationHold++;
}
const held = cases.filter((c) => c.heldOut);
let heldPass = 0;
for (const item of held) if (JSON.stringify(await evaluate(item)) === JSON.stringify(item.expected)) heldPass++;
let performanceMsPerRoute: number | null = null;
if (final) {
  const inventory = final.inventoryAyasCapabilities({
    availableModelIds: ["ollama", "cloud", "invented-model"],
    availableSkillIds: ["invented-skill"], availableAgentIds: ["invented-agent"],
  });
  assert.equal(inventory.find((c) => c.id === "cloud")?.available, false);
  assert.equal(inventory.find((c) => c.id === "web-research-lookup")?.available, false);
  assert.equal(inventory.some((c) => c.id.startsWith("invented-")), false);
  assert.equal(final.selectAyasAgenticRoute({ text: "Özel yerel kod değişikliği yap", availableModelIds: ["ollama"], availableAgentIds: ["codex"] }).selectedAgentId, "local-ayas");
  assert.equal(final.selectAyasAgenticRoute({ text: "Depo mimarisindeki modül bağımlılıklarını açıkla", availableModelIds: ["ollama"] }).toolNeed, "BENEFICIAL");
  const secret = "FAKE_PRIVATE_PROMPT_123";
  assert.equal(JSON.stringify(final.selectAyasAgenticRoute({ text: secret, availableModelIds: ["ollama"] })).includes(secret), false);
  const once = JSON.stringify(final.selectAyasAgenticRoute({ text: cases[5]!.text, availableModelIds: ["ollama"] }));
  assert.equal(once, JSON.stringify(final.selectAyasAgenticRoute({ text: cases[5]!.text, availableModelIds: ["ollama"] })));
  const start = performance.now();
  for (let i = 0; i < 5_000; i++) final.selectAyasAgenticRoute({ text: cases[i % cases.length]!.text, availableModelIds: ["ollama"] });
  performanceMsPerRoute = (performance.now() - start) / 5_000;
}
console.log(JSON.stringify({ source: final ? "stage7" : "7814868-baseline", total: cases.length, heldOut: { pass: heldPass, total: held.length }, counts, performanceMsPerRoute, misses }, null, 2));
if (process.argv.includes("--gate")) assert.equal(counts.all, cases.length);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
