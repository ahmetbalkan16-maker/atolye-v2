/** Operator read-only view. No model, executor, gate mutation or compaction. */
import { readAyasOperationalState } from "../src/lib/ayas/observability/AyasOperationalState";

function main() {
  const args = process.argv.slice(2);
  let rootDir: string | undefined;
  let windowHours: number | undefined;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--root" && args[i + 1] && !args[i + 1]!.startsWith("--")) rootDir = args[++i];
    else if (flag === "--window-hours" && args[i + 1] && Number.isFinite(Number(args[i + 1])) && Number(args[i + 1]) > 0) windowHours = Number(args[++i]);
    else throw new Error("ARGUMENT_INVALID");
  }
  console.log(JSON.stringify(readAyasOperationalState({ rootDir, windowHours }), null, 2));
}
try { main(); } catch { console.error("AYAS_OPERATIONAL_STATE_FAILED"); process.exitCode = 1; }
