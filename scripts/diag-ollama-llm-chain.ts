/**
 * DIAGNOSIS ONLY. Runs research -> script -> scenes on a local Ollama model with
 * the production code path and reports which stages produced a REAL result vs
 * fell back to mock. Use it to check LLM-chain reliability without a full e2e.
 *
 *   OLLAMA_MODEL=qwen2.5:3b OLLAMA_NUM_CTX=8192 npx tsx scripts/diag-ollama-llm-chain.ts
 */
import { AIManager } from "../src/lib/ai/AIManager";
import { resolveOllamaConfig } from "../src/lib/ai/OllamaConfig";

process.env.AI_PROVIDER = "ollama";

const topic = process.argv[2]?.trim() || "Kanuni Sultan Süleyman";

async function main() {
  const cfg = resolveOllamaConfig();
  console.log(`model=${cfg.model} num_ctx=${cfg.numCtx ?? "server-default"} timeoutMs=${cfg.timeoutMs}`);

  const t0 = Date.now();
  const research = await AIManager.runResearch(topic, {
    projectSlug: "diag-llm-chain", stage: "research", operation: "research",
  });
  const r = research as unknown as { summary?: string; overview?: string };
  const summaryText = r.summary ?? r.overview ?? JSON.stringify(research);
  const researchMock = summaryText.toLowerCase().includes('"mock"') || summaryText.trim().toLowerCase() === "mock" || summaryText.length < 120;
  console.log(
    `research: ${researchMock ? "MOCK" : "REAL"}  ` +
    `(${((Date.now() - t0) / 1000).toFixed(0)}s, summaryChars=${summaryText.length})`,
  );

  const t1 = Date.now();
  const script = await AIManager.runScript(
    topic,
    { projectSlug: "diag-llm-chain", stage: "script", operation: "script" },
    undefined, undefined, research,
  );
  const scriptMock = script.subtitle === "mock" || script.conclusion === "mock" || script.chapters.length === 0;
  console.log(
    `script:   ${scriptMock ? "MOCK" : "REAL"}  ` +
    `(${((Date.now() - t1) / 1000).toFixed(0)}s, chapters=${script.chapters.length}, ` +
    `narrationChars=${script.chapters.reduce((s, c) => s + c.narration.length, 0)})`,
  );

  const t2 = Date.now();
  const scenes = await AIManager.runScenes(
    script,
    { projectSlug: "diag-llm-chain", stage: "scenes", operation: "scenes" },
    undefined, undefined, research,
  );
  const scenesMock = scenes.scenes.length <= 1;
  console.log(
    `scenes:   ${scenesMock ? "MOCK" : "REAL"}  ` +
    `(${((Date.now() - t2) / 1000).toFixed(0)}s, scenes=${scenes.scenes.length})`,
  );

  const allReal = !researchMock && !scriptMock && !scenesMock;
  console.log(`\n${allReal ? "✅ FULL LLM CHAIN REAL" : "❌ at least one stage fell back to mock"}`);
  process.exitCode = allReal ? 0 : 1;
}

void main().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 2;
});
