/** Stage 15L, read-only: --project <slug> [--owner-request <file.json>]. Plans only; no provider, stage execution, upload or source mutation. */
import fs from "node:fs";
import path from "node:path";
import { collectAyasProductionDirectorSession, parseAyasDirectorOwnerRequest } from "../src/lib/ayas/director/AyasProductionDirectorCollector";
import { planAyasProductionRepairs } from "../src/lib/ayas/director/AyasProductionFaultRepair";
import { resolveRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";

async function main() {
  const args = process.argv.slice(2);
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!["--project", "--owner-request"].includes(arg) || values.has(arg) || !args[i + 1] || args[i + 1]!.startsWith("--")) throw new Error("AYAS_PRODUCTION_REPAIR_ARGUMENTS_INVALID");
    values.set(arg, args[++i]!);
  }
  const projectSlug = values.get("--project");
  if (!projectSlug) throw new Error("AYAS_PRODUCTION_REPAIR_ARGUMENTS_INVALID");
  const requestFile = values.get("--owner-request");
  const ownerRequest = requestFile ? parseAyasDirectorOwnerRequest(JSON.parse(fs.readFileSync(path.resolve(requestFile), "utf8"))) : null;
  const storage = resolveRuntimeStorageContext({});
  const { facts, readRetries } = await collectAyasProductionDirectorSession({ projectSlug, now: new Date(), repoRoot: process.cwd(), ownerRequest, storage });
  console.log(JSON.stringify({ storage: storage.classification, readRetries, report: planAyasProductionRepairs(facts) }, null, 2));
}
main().catch((error: unknown) => { console.error(JSON.stringify({ status: "FAILED", message: error instanceof Error ? error.message : String(error) })); process.exitCode = 1; });
