/** Read-only physical quality inspection; never runs a stage or uploads. --project <slug> */
import { execFileSync } from "node:child_process";
import { collectProductionBundleQuality } from "../src/lib/production/ProductionQualityCollector";
import { resolveRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--project" || !/^[a-z0-9][a-z0-9-]{0,179}$/.test(args[1] ?? "")) throw new Error("QUALITY_ARGUMENT_INVALID");
  const storage = resolveRuntimeStorageContext({});
  const repositoryHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim();
  const result = await collectProductionBundleQuality({ projectSlug: args[1]!, repositoryHead, storageContext: storage });
  console.log(JSON.stringify({ storage: storage.classification, ...result, probe: result.probe.available ? result.probe : { available: false, reason: "FFPROBE_OR_VERIFIED_VIDEO_UNAVAILABLE" } }, null, 2));
}
main().catch(() => { console.error(JSON.stringify({ status: "UNAVAILABLE", authority: "NONE", publication: "OWNER_ONLY", reason: "CURRENT_VERIFIED_QUALITY_PACKAGE_UNAVAILABLE" })); process.exitCode = 1; });
