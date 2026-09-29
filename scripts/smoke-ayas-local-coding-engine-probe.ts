import assert from "node:assert/strict";

import { diagnoseAyasLocalCodingLocalEngine, diagnoseAyasLocalCodingProbeWith,
  type AyasLocalCodingProbeRunner } from "../src/lib/brain/autonomy/AyasLocalCodingEngineProbe";
import type { AyasLocalCodingContainerPlan } from "../src/lib/brain/autonomy/AyasLocalCodingContainerPlan";

const image = `local/ayas-coder@sha256:${"b".repeat(64)}`;
const workspaceRoot = "C:\\Temp\\ayas-local-coding-fixture";
const plan: AyasLocalCodingContainerPlan = {
  executable: "docker", image, workspaceRoot,
  args: ["run", "--rm", "--pull=never", "--network=none", "--read-only", "--cap-drop=ALL",
    "--security-opt=no-new-privileges", "--pids-limit=64", "--memory=4g", "--cpus=2",
    "--user=65534:65534", "--mount", `type=bind,src=${workspaceRoot},dst=/workspace,readonly`,
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m", "--workdir=/workspace", "--env", "HOME=/tmp",
    "--env", "ATOLYE_RUNTIME_ROOT=/tmp/runtime", "--entrypoint=/ayas-sandbox-probe", image],
};
const inspection = {
  Config: { Image: image, Entrypoint: ["/ayas-sandbox-probe"], User: "65534:65534",
    Env: ["PATH=/usr/bin", "HOME=/tmp", "ATOLYE_RUNTIME_ROOT=/tmp/runtime"] },
  HostConfig: { NetworkMode: "none", PortBindings: null, PublishAllPorts: false, ExtraHosts: null, Dns: null,
    ReadonlyRootfs: true, Privileged: false, AutoRemove: false, CapDrop: ["ALL"], CapAdd: null,
    SecurityOpt: ["no-new-privileges"], PidMode: "", IpcMode: "private", PidsLimit: 64,
    Memory: 4 * 1024 ** 3, NanoCpus: 2_000_000_000, Devices: null, VolumesFrom: null, Binds: null,
    Tmpfs: { "/tmp": "rw,noexec,nosuid,size=64m" } },
  Mounts: [{ Type: "bind", Source: workspaceRoot, Destination: "/workspace", RW: false }],
};
const report = { schemaVersion: "1", hostCredentialsAbsent: true, hostPrivateDataAbsent: true,
  hostShellAbsent: true, networkDenied: true, packageInstallDenied: true, workspaceReadOnly: true };
const makeRunner = (change?: (command: string, result: { exitCode: number; stdout: string }) => void) => {
  const calls: string[][] = [];
  const run: AyasLocalCodingProbeRunner = async (args) => {
    calls.push([...args]);
    const result = { exitCode: 0, stdout: args[0] === "image" ? JSON.stringify([image])
      : args[0] === "wait" ? "0" : args[0] === "inspect" ? JSON.stringify(inspection)
        : args[0] === "logs" ? JSON.stringify(report) : "ok" };
    change?.(args[0] ?? "", result);
    return result;
  };
  return { run, calls };
};

async function main(): Promise<void> {
const good = makeRunner();
const observed = await diagnoseAyasLocalCodingProbeWith(plan, good.run);
assert.equal(observed.status, "OBSERVED_NOT_ADMITTED");
const create = good.calls.find((args) => args[0] === "run");
assert.ok(create?.includes("--pull=never") && create.includes("--network=none") && !create.includes("--rm"));
assert.equal(good.calls.at(-1)?.[0], "rm", "owned container must be cleaned up");

for (const mutate of [
  (command: string, result: { exitCode: number; stdout: string }) => { if (command === "image") result.stdout = "[]"; },
  (command: string, result: { exitCode: number; stdout: string }) => { if (command === "wait") result.stdout = "1"; },
  (command: string, result: { exitCode: number; stdout: string }) => { if (command === "inspect") result.stdout = JSON.stringify({ ...inspection, HostConfig: { ...inspection.HostConfig, NetworkMode: "host" } }); },
  (command: string, result: { exitCode: number; stdout: string }) => { if (command === "logs") result.stdout = JSON.stringify({ ...report, networkDenied: false }); },
  (command: string, result: { exitCode: number; stdout: string }) => { if (command === "logs") result.stdout = "not-json"; },
]) {
  const runner = makeRunner(mutate);
  assert.equal((await diagnoseAyasLocalCodingProbeWith(plan, runner.run)).status, "PROBE_REFUSED");
  if (runner.calls.some((args) => args[0] === "run")) assert.equal(runner.calls.at(-1)?.[0], "rm");
}
const unsafe = makeRunner();
assert.equal((await diagnoseAyasLocalCodingProbeWith({ ...plan, args: ["run", "--network=host", image] }, unsafe.run)).status, "PROBE_REFUSED");
assert.equal(unsafe.calls.length, 0, "unsafe plan must be refused before a command runs");
const crashedCalls: string[][] = [];
const crashed: AyasLocalCodingProbeRunner = async (args) => {
  crashedCalls.push([...args]);
  if (args[0] === "inspect") throw new Error("engine inspection crashed");
  return makeRunner().run(args);
};
assert.equal((await diagnoseAyasLocalCodingProbeWith(plan, crashed)).status, "PROBE_REFUSED");
assert.equal(crashedCalls.at(-1)?.[0], "rm", "inspection failure must clean up the owned container");
assert.equal((await diagnoseAyasLocalCodingLocalEngine({ adapter: { adapterId: "local-coder", image },
  task: {} as never, workspaceRoot })).status, "LOCAL_ENGINE_UNAVAILABLE");
console.log(JSON.stringify({ status: "PASS", suite: "ayas-local-coding-engine-probe", scenarios: 9,
  evidence: "synthetic-runner; no local engine admission" }));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
