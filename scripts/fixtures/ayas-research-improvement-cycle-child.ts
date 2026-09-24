/**
 * Stage 8 child process for crash and double-daemon tests. It runs ONE
 * research-improvement cycle against a TEMP fixture repository and TEMP
 * store, optionally dying with `process.exit(137)` at a named fault point to
 * simulate a real crash. It refuses any repository or store outside OS TEMP.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runAyasResearchImprovementCycle, type AyasResearchExperimentFaultPoint } from "../../src/lib/brain/autonomy/AyasResearchImprovementCycle";
import { createAyasResearchExperimentStore } from "../../src/lib/brain/autonomy/AyasResearchExperimentStore";
import type { AyasExternalResearchFinding } from "../../src/lib/brain/autonomy/AyasExternalResearchStore";
import { behaviorStrategy, fixtureRegistry } from "./ayas-research-improvement-fixtures";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireTemp(value: string | undefined, label: string): string {
  const tmp = fs.realpathSync(os.tmpdir());
  const resolved = value ? fs.realpathSync(path.resolve(value)) : "";
  if (!resolved || !(resolved === tmp || resolved.startsWith(tmp + path.sep))) throw new Error(`${label} must be under OS TEMP`);
  return resolved;
}

async function main(): Promise<void> {
  const repoRoot = requireTemp(arg("repo"), "repo");
  const storeDir = requireTemp(arg("store"), "store");
  const findings = JSON.parse(fs.readFileSync(requireTemp(arg("findings"), "findings"), "utf8")) as AyasExternalResearchFinding[];
  const crash = arg("crash") ?? "none";
  const head = arg("head")!;
  const strategy = behaviorStrategy("improve", { "ref-follow-up": true });
  const result = await runAyasResearchImprovementCycle({
    repoRoot,
    store: createAyasResearchExperimentStore({ rootDir: storeDir }),
    registry: fixtureRegistry([strategy]),
    observation: { now: new Date().toISOString(), head, repoClean: true, graphifyFresh: true, machineAction: "ALLOW" },
    findings,
    nodeModulesDir: arg("node-modules"),
    timeBudgetMs: 120_000,
    ...(arg("clock") ? { clock: () => arg("clock")! } : {}),
    faultInjection: (point: AyasResearchExperimentFaultPoint) => { if (point === crash) process.exit(137); },
  });
  console.log(JSON.stringify({ admission: result.admission, experiment: result.experiment, reconciled: result.reconciledInterrupted }));
}

main().catch((error) => { console.error(error instanceof Error ? `${(error as { code?: string }).code ?? ""} ${error.message}` : String(error)); process.exitCode = 2; });
