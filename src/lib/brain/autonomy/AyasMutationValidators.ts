import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Bounded, server-owned validators a mutation registry entry may declare.
 * Every validator here is a closed, reviewed function — never proposal
 * text, never a client-supplied command, never a dynamic module path. A
 * validator's job is to report `pass`/`fail` truthfully; it never mutates
 * anything itself.
 */
export interface AyasValidatorResult {
  readonly validator: string;
  readonly pass: boolean;
  /** Safe, human-readable summary — never a raw secret, never an unbounded command dump. */
  readonly summary: string;
}

export type AyasValidator = (repoRoot: string) => Promise<AyasValidatorResult>;

const MAX_SUMMARY_LENGTH = 500;

function safeSummary(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_SUMMARY_LENGTH);
}

/**
 * Closed factory for "does this exact, already-committed smoke script pass
 * right now" — the only command ever run is `node <local tsx cli> <scriptRelativePath>`,
 * where `scriptRelativePath` is a literal supplied by reviewed source at
 * registry-authoring time, never by a proposal or by client input. This
 * mirrors the existing `fixedLocal` pattern in `AyasGuidedRepairProduction.ts`
 * (a local `node_modules` binary invoked via `process.execPath`, never a
 * shell), generalized to name a script instead of `tsc`/`eslint`.
 */
export function createAyasSmokeTestValidator(scriptRelativePath: string): AyasValidator {
  return async (repoRoot: string): Promise<AyasValidatorResult> => {
    const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
    if (!fs.existsSync(tsxCli)) {
      return { validator: scriptRelativePath, pass: false, summary: "local tsx CLI is unavailable" };
    }
    const scriptAbs = path.join(repoRoot, scriptRelativePath);
    if (!fs.existsSync(scriptAbs)) {
      return { validator: scriptRelativePath, pass: false, summary: "validator target script does not exist" };
    }
    try {
      const stdout = execFileSync(process.execPath, [tsxCli, scriptRelativePath], {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 60_000,
        windowsHide: true,
        maxBuffer: 2_000_000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const pass = /"status"\s*:\s*"PASS"/.test(stdout);
      return { validator: scriptRelativePath, pass, summary: pass ? "smoke test reported PASS" : "smoke test did not report PASS" };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { validator: scriptRelativePath, pass: false, summary: safeSummary(`smoke test run failed: ${detail}`) };
    }
  };
}

export class AyasValidatorFailedError extends Error {
  constructor(readonly results: readonly AyasValidatorResult[]) {
    super(`validator failed: ${results.find((r) => !r.pass)?.validator ?? "unknown"}`);
    this.name = "AyasValidatorFailedError";
    this.stack = undefined;
  }
}

/**
 * Runs every declared validator in order, stopping at the first failure.
 * A validator that throws, or returns a malformed (non-conforming) result,
 * is treated as a failure with a safe summary rather than letting the raw
 * exception (which could contain unbounded or unexpected content) escape.
 * Returns the full accumulated result list either way — the caller decides
 * what happens next (this module never rolls back or finalizes anything).
 */
export async function runAyasValidators(repoRoot: string, validators: readonly AyasValidator[]): Promise<readonly AyasValidatorResult[]> {
  const results: AyasValidatorResult[] = [];
  for (const validator of validators) {
    let result: AyasValidatorResult;
    try {
      const raw = await validator(repoRoot);
      result = typeof raw?.validator === "string" && typeof raw?.pass === "boolean" && typeof raw?.summary === "string"
        ? { validator: raw.validator, pass: raw.pass, summary: safeSummary(raw.summary) }
        : { validator: "unknown", pass: false, summary: "validator returned a malformed result" };
    } catch (error) {
      result = { validator: "unknown", pass: false, summary: safeSummary(`validator threw: ${error instanceof Error ? error.message : String(error)}`) };
    }
    results.push(result);
    if (!result.pass) throw new AyasValidatorFailedError(results);
  }
  return results;
}
