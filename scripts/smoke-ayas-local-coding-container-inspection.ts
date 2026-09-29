import assert from "node:assert/strict";

import { inspectAyasLocalCodingContainer } from "../src/lib/brain/autonomy/AyasLocalCodingContainerInspection";
import type { AyasLocalCodingContainerPlan } from "../src/lib/brain/autonomy/AyasLocalCodingContainerPlan";

const image = `local/ayas-coder@sha256:${"b".repeat(64)}`;
const workspaceRoot = "C:\\Temp\\ayas-local-coding-fixture";
const plan: AyasLocalCodingContainerPlan = { executable: "docker", args: [], image, workspaceRoot };
const good = {
  Config: { Image: image, Entrypoint: ["/ayas-sandbox-probe"], User: "65534:65534",
    Env: ["PATH=/usr/bin", "HOME=/tmp", "ATOLYE_RUNTIME_ROOT=/tmp/runtime"] },
  HostConfig: { NetworkMode: "none", PortBindings: null, PublishAllPorts: false, ExtraHosts: null, Dns: null,
    ReadonlyRootfs: true, Privileged: false, AutoRemove: true, CapDrop: ["ALL"], CapAdd: null,
    SecurityOpt: ["no-new-privileges"], PidMode: "", IpcMode: "private", PidsLimit: 64,
    Memory: 4 * 1024 ** 3, NanoCpus: 2_000_000_000, Devices: null, VolumesFrom: null, Binds: null,
    Tmpfs: { "/tmp": "rw,noexec,nosuid,size=64m" } },
  Mounts: [{ Type: "bind", Source: workspaceRoot, Destination: "/workspace", RW: false },
    { Type: "tmpfs", Source: "", Destination: "/tmp", RW: true }],
};
assert.deepEqual(inspectAyasLocalCodingContainer(plan, good), { configMatchesPlan: true, mismatches: [] });
const retained = structuredClone(good);
retained.HostConfig.AutoRemove = false;
assert.equal(inspectAyasLocalCodingContainer(plan, retained, "retained-probe").configMatchesPlan, true);
assert.equal(inspectAyasLocalCodingContainer(plan, retained).configMatchesPlan, false);
const clone = () => structuredClone(good);
const tamper: Array<(item: typeof good) => void> = [
  (x) => { x.Config.Image = "local/ayas-coder:latest"; },
  (x) => { x.Config.Entrypoint = ["/bin/sh"]; },
  (x) => { x.Config.User = "root"; },
  (x) => { x.Config.Env.push("OPENAI_API_KEY=secret"); },
  (x) => { x.HostConfig.NetworkMode = "host"; },
  (x) => { x.HostConfig.PortBindings = {} as never; x.HostConfig.PublishAllPorts = true; },
  (x) => { x.HostConfig.ReadonlyRootfs = false; },
  (x) => { x.HostConfig.Privileged = true; },
  (x) => { x.HostConfig.CapDrop = []; },
  (x) => { x.HostConfig.SecurityOpt = []; },
  (x) => { x.HostConfig.PidsLimit = 0; },
  (x) => { (x.HostConfig as Record<string, unknown>).UsernsMode = "host"; },
  (x) => { x.HostConfig.Memory = 0; },
  (x) => { x.HostConfig.Devices = ["/dev/sda"] as never; },
  (x) => { x.HostConfig.Tmpfs = { "/tmp": "rw,exec,size=1g" }; },
  (x) => { x.Mounts[0]!.RW = true; },
  (x) => { x.Mounts[0]!.Source = "C:\\Users\\owner"; },
  (x) => { x.Mounts.push({ Type: "bind", Source: "C:\\Users\\owner", Destination: "/host", RW: true }); },
  (x) => { x.Mounts.push({ Type: "tmpfs", Source: "", Destination: "/tmp", RW: true }); },
];
for (const mutate of tamper) {
  const item = clone();
  mutate(item);
  const result = inspectAyasLocalCodingContainer(plan, item);
  assert.equal(result.configMatchesPlan, false);
  assert.ok(result.mismatches.length > 0);
}
assert.equal(inspectAyasLocalCodingContainer(plan, null).configMatchesPlan, false);
console.log(JSON.stringify({ status: "PASS", suite: "ayas-local-coding-container-inspection", scenarios: tamper.length + 4, evidence: "synthetic-config-only" }));
