import fs from "node:fs";
import path from "node:path";

import { inventoryAyasCapabilities } from "../routing/AyasAgenticRouting";
import { createAyasTechnologyRegister, parseAyasTechnologyRegister, serializeAyasTechnologyRegister, type AyasTechnologyRegister } from "./AyasTechnologyCandidate";
import { runAyasTechnologyWatchCycle } from "./AyasTechnologyIntegration";
import type { AyasTechnologyWatchEnvironment } from "./AyasTechnologyWatch";

/**
 * Stage 8 → Stage 14 in the discovery child (owner, 2026-11-05: the technology watch ran only by hand). After the
 * research-improvement cycle, under the same lease capability, the recorded Stage 8 findings go through one bounded
 * `runAyasTechnologyWatchCycle` against the register kept here, so every technology the research found has an
 * assessment and the reason it waits. Only local facts are stated: the root package.json's dependencies; everything
 * else (host binaries, accounts, coverage) stays UNKNOWN, as in the operator CLI. Hand-offs are counted, never
 * submitted to Stage 13; nothing is fetched, installed, approved or dispatched. Writes only
 * data/brain/self-improvement/technology-watch/ (git-ignored).
 */

export const AYAS_TECHNOLOGY_WATCH_STEP_LIMIT = 40;

export function ayasTechnologyWatchDir(repoRoot: string): string {
  return path.join(repoRoot, "data", "brain", "self-improvement", "technology-watch");
}

export interface AyasTechnologyWatchStepSummary {
  readonly at: string;
  readonly extracted: number;
  readonly skipped: number;
  readonly deferred: number;
  readonly refused: number;
  readonly technologies: number;
  readonly handoffs: number;
  /** Recommendation/readiness counts and the first few technologies with their reason. */
  readonly recommendations: Readonly<Record<string, number>>;
  readonly sample: readonly string[];
  readonly executionAuthority: "NONE";
}

function writeAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/** The npm dependencies the repository already ships with (root package.json, read-only). */
function installedPackages(repoRoot: string): AyasTechnologyWatchEnvironment["installedPackages"] {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { readonly dependencies?: Record<string, string>; readonly devDependencies?: Record<string, string> };
    return [...new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})])].sort().map((name) => ({ ecosystem: "NPM" as const, name }));
  } catch { return undefined; }
}

export function readAyasTechnologyWatchRegister(repoRoot: string): AyasTechnologyRegister {
  const file = path.join(ayasTechnologyWatchDir(repoRoot), "register.json");
  if (!fs.existsSync(file)) return createAyasTechnologyRegister();
  // A register that no longer parses is kept for inspection and the watch starts over (findings are re-extracted).
  try { return parseAyasTechnologyRegister(JSON.parse(fs.readFileSync(file, "utf8"))); } catch {
    fs.renameSync(file, `${file}.unreadable-${Date.now()}`);
    return createAyasTechnologyRegister();
  }
}

export function runAyasTechnologyWatchStep(input: { readonly repoRoot: string; readonly findings: readonly unknown[]; readonly now?: string }): AyasTechnologyWatchStepSummary {
  const now = input.now ?? new Date().toISOString();
  const packages = installedPackages(input.repoRoot);
  const env = {
    now,
    capabilities: inventoryAyasCapabilities({ availableModelIds: [], availableSkillIds: [], availableAgentIds: [] }),
    ...(packages ? { installedPackages: packages } : {}),
  } as AyasTechnologyWatchEnvironment;
  const cycle = runAyasTechnologyWatchCycle({ register: readAyasTechnologyWatchRegister(input.repoRoot), findings: input.findings, env, limit: AYAS_TECHNOLOGY_WATCH_STEP_LIMIT });
  const recommendations: Record<string, number> = {};
  for (const a of cycle.assessments) recommendations[a.recommendation] = (recommendations[a.recommendation] ?? 0) + 1;
  const summary: AyasTechnologyWatchStepSummary = {
    at: now, extracted: cycle.extracted, skipped: cycle.skipped, deferred: cycle.deferred, refused: cycle.refused.length,
    technologies: cycle.assessments.length, handoffs: cycle.handoffs.length, recommendations,
    sample: cycle.assessments.slice(0, 12).map((a) => `${a.identity.displayName} [${a.identity.category}]: ${a.recommendation} (${a.primaryReason})`),
    executionAuthority: "NONE",
  };
  const dir = ayasTechnologyWatchDir(input.repoRoot);
  writeAtomic(path.join(dir, "register.json"), `${JSON.stringify(serializeAyasTechnologyRegister(cycle.register), null, 2)}\n`);
  writeAtomic(path.join(dir, "last-cycle.json"), `${JSON.stringify({ ...summary, assessments: cycle.assessments.map((a) => ({ technologyKey: a.technologyKey, name: a.identity.displayName, category: a.identity.category, recommendation: a.recommendation, readiness: a.readiness, reason: a.primaryReason, blockers: a.blockers.slice(0, 6).map((b) => `${b.level}:${b.code}`) })) }, null, 2)}\n`);
  return summary;
}
