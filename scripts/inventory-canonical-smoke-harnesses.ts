import fs from "node:fs";
import path from "node:path";

interface SmokeInventoryRow {
  file: string;
  classification: "production-durable-positive" | "controlled-negative" |
    "pure-unit-contract" | "migration-backup-sandbox";
  canonicalFoundationRequired: boolean;
  runtimeModel: "canonical-foundation" | "explicit-sandbox" | "ambient-or-repository";
  cleanupModel: "canonical" | "owned-sandbox" | "direct-recursive" | "none";
  authorityModel: "operation-bound" | "explicit-local" | "ambient";
  ambientEnvironment: readonly string[];
  dataProjectsRisk: boolean;
  decision: "migrated" | "retain-explicit-sandbox" | "retain-pure-contract" | "remediation-required";
}

const root = path.join(process.cwd(), "scripts");
const files = fs.readdirSync(root).filter((name) => /^(smoke|visual)-.*\.ts$/.test(name))
  .concat(["run-canonical-smoke-validation.ts", "lib/CanonicalSmokeRuntime.ts"])
  .sort(codeUnitCompare);
const rows = files.map(classify);
process.stdout.write(`${JSON.stringify({ schemaVersion: "canonical-smoke-inventory-v1",
  count: rows.length, rows }, null, 2)}\n`);
if (rows.length !== 90) throw new Error(`Canonical smoke inventory expected 90 files, received ${rows.length}.`);

function classify(file: string): SmokeInventoryRow {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  if (file === "run-canonical-smoke-validation.ts" || file === "lib/CanonicalSmokeRuntime.ts") {
    return { file, classification: "pure-unit-contract", canonicalFoundationRequired: false,
      runtimeModel: file.startsWith("lib/") ? "canonical-foundation" : "explicit-sandbox",
      cleanupModel: file.startsWith("lib/") ? "canonical" : "none",
      authorityModel: file.startsWith("lib/") ? "operation-bound" : "explicit-local",
      ambientEnvironment: [], dataProjectsRisk: false, decision: "retain-pure-contract" };
  }
  const canonical = source.includes("withCanonicalSmokeRuntime");
  const migration = /migration|backup|runtime-root|guarded-filesystem/.test(file);
  const production = /production|pipeline|retry|audio|visual|animation|video|thumbnail|youtube/.test(file);
  const controlledNegative = /corruption|error-contract|failure|hardening/.test(file) &&
    !/end-to-end|wiring|provider/.test(file);
  const explicitSandbox = /mkdtemp|mkdtempSync/.test(source) &&
    (/process\.chdir|ATOLYE_RUNTIME_ROOT|path\.join\((?:os\.)?tmpdir|mkdtemp/.test(source));
  const directRecursive = /(?:rm|rmSync)\([^\n]{0,180}recursive\s*:\s*true/.test(source);
  const environment = [...source.matchAll(/process\.env(?:\.([A-Z][A-Z0-9_]*)|\[['"]([A-Z][A-Z0-9_]*)['"]\])/g)]
    .map((match) => match[1] ?? match[2]).filter((value, index, all) => all.indexOf(value) === index)
    .sort(codeUnitCompare);
  const dataRisk = /ProjectReader\.getProjectFolder|ProjectReader\.getProjectsRoot|data[\\/]projects/.test(source) &&
    !canonical && !explicitSandbox;
  const classification = migration ? "migration-backup-sandbox" : controlledNegative
    ? "controlled-negative" : production && !explicitSandbox
      ? "production-durable-positive" : "pure-unit-contract";
  const required = classification === "production-durable-positive";
  const decision = canonical ? "migrated" : required && (dataRisk || directRecursive)
    ? "remediation-required" : explicitSandbox || migration ? "retain-explicit-sandbox" : "retain-pure-contract";
  return {
    file, classification, canonicalFoundationRequired: required,
    runtimeModel: canonical ? "canonical-foundation" : explicitSandbox ? "explicit-sandbox" : "ambient-or-repository",
    cleanupModel: canonical ? "canonical" : directRecursive ? (explicitSandbox ? "owned-sandbox" : "direct-recursive") : "none",
    authorityModel: canonical ? "operation-bound" : explicitSandbox ? "explicit-local" : "ambient",
    ambientEnvironment: environment, dataProjectsRisk: dataRisk, decision,
  };
}

function codeUnitCompare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
