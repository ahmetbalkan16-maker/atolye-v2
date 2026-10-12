import fs from "node:fs";
import path from "node:path";
import { SpawnRunner } from "../../src/lib/assembly/providers/FFmpegVideoAssemblyProvider";
import { assertAyasHeavyWorkloadAllowed, AyasMachineHealthBlockedError } from "../../src/lib/ayas/machine/AyasMachineHealthGuard";
import { readAyasGpuThermal } from "../../src/lib/ayas/machine/AyasGpuThermalAdmission";

async function main() {
  const theme = process.argv[2];
  const allowed = ["OTTOMAN", "BYZANTINE", "ROMAN", "EGYPTIAN"];
  if (!allowed.includes(theme ?? "")) throw new Error("LOCAL_VISUAL_THEME_REFUSED");
  const role = process.argv[3];
  if (role !== undefined && !["RULER", "ADVISOR", "GUARD"].includes(role)) throw new Error("LOCAL_VISUAL_ROLE_REFUSED");
  const root = fs.realpathSync.native(process.cwd());
  const runtime = path.join(root, "bin", "ayas-local-visual");
  const python = fs.realpathSync.native(path.join(runtime, ".venv", "Scripts", "python.exe"));
  const relative = path.relative(root, python);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("LOCAL_VISUAL_EXECUTABLE_OUTSIDE_ROOT");
  const directory = path.join(runtime, "candidates"); fs.mkdirSync(directory, { recursive: true });
  const output = path.join(directory, `${theme.toLowerCase()}${role ? `-${role.toLowerCase()}` : ""}-${Date.now()}.png`);
  const evidence: unknown[] = [];
  await assertAyasHeavyWorkloadAllowed({ stage: "visuals", ownedActive: false });
  const result = await new SpawnRunner().run(python, [path.join(root, "scripts", "local-visual-runtime", "generate-background.py"), "--theme", theme, "--output", output, ...(role ? ["--kind", "character", "--role", role] : [])], {
    timeoutMs: 600000, maxOutputBytes: 131072,
    healthCheck: async () => {
      try {
        const decision = await assertAyasHeavyWorkloadAllowed({ stage: "visuals", ownedActive: true });
        evidence.push({ at: new Date().toISOString(), action: decision.action, cpu: decision.telemetry.cpuPercent, ram: decision.telemetry.ramUsedPercent, vram: decision.telemetry.vramUsedPercent, thermal: await readAyasGpuThermal() });
      } catch (error) {
        evidence.push({ at: new Date().toISOString(), refusal: error instanceof AyasMachineHealthBlockedError ? error.code : "HEALTH_CHECK_FAILED", thermal: await readAyasGpuThermal() });
        throw error;
      }
    },
  });
  const receipt = { output, ownedProcessOnly: true, paidCalls: 0, result, health: evidence };
  fs.writeFileSync(output.replace(/\.png$/, ".guard.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ output, failed: result.failed, timedOut: result.timedOut, exitCode: result.exitCode, healthPolls: evidence.length, paidCalls: 0 }));
  if (result.failed || result.timedOut || result.exitCode !== 0 || !fs.existsSync(output)) {
    console.error((result.stderr ?? "").slice(-2500)); throw new Error("LOCAL_VISUAL_CANDIDATE_FAILED");
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
