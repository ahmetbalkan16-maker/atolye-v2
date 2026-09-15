import assert from "node:assert/strict";
import fs from "node:fs";
import { loadBrainConsoleSnapshot } from "../src/lib/brain/ui/BrainConsoleSnapshot";
import { loadAyasProductBrainContext } from "../src/lib/ayas/AyasProductBrain";

async function main() {
  const context = await loadAyasProductBrainContext(await loadBrainConsoleSnapshot());
  assert.deepEqual(Object.keys(context.reachable).sort(), ["Decision Brain", "Failure Brain", "Project Brain", "Repo Brain", "Sprint Brain"]);
  assert.equal(context.lines.length, 6);
  for (const name of Object.keys(context.reachable)) assert.ok(context.lines.some((line) => line.startsWith(`${name}:`)), name);
  assert.ok(context.lines.some((line) => line.startsWith("Controlled improvement: research/evidence → Graphify impact → planner")));
  const route = fs.readFileSync("app/api/ayas/chat/stream/route.ts", "utf8");
  assert.match(route, /loadAyasProductBrainContext/);
  assert.match(route, /productBrainLines: productBrain\.lines/);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-product-brain", scenarios: 9 }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
