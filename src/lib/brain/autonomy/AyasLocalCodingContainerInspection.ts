import path from "node:path";

import type { AyasLocalCodingContainerPlan } from "./AyasLocalCodingContainerPlan";

/** Structural engine evidence only. This does not admit or execute a backend. */
export interface AyasLocalCodingInspectionResult {
  readonly configMatchesPlan: boolean;
  readonly mismatches: readonly string[];
}

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const array = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : [];
const empty = (value: unknown): boolean => value === null || value === undefined
  || (Array.isArray(value) && value.length === 0)
  || (!!object(value) && Object.keys(object(value)!).length === 0);

/**
 * Compare a real local engine's inspect JSON against the reviewed probe plan.
 * The caller must obtain inspect from the engine; model output is never evidence.
 */
export function inspectAyasLocalCodingContainer(plan: AyasLocalCodingContainerPlan, inspected: unknown,
  phase: "run" | "retained-probe" = "run"): AyasLocalCodingInspectionResult {
  const root = object(inspected);
  const host = object(root?.HostConfig);
  const config = object(root?.Config);
  const mismatches: string[] = [];
  const check = (name: string, good: boolean): void => { if (!good) mismatches.push(name); };
  if (!root || !host || !config) return { configMatchesPlan: false, mismatches: ["STRUCTURE"] };
  check("IMAGE", config.Image === plan.image);
  check("ENTRYPOINT", JSON.stringify(config.Entrypoint) === JSON.stringify(["/ayas-sandbox-probe"]));
  check("USER", config.User === "65534:65534");
  const env = array(config.Env);
  check("ENV", env.length > 0 && env.every((entry) => typeof entry === "string"
    && (/^PATH=/.test(entry) || entry === "HOME=/tmp" || entry === "ATOLYE_RUNTIME_ROOT=/tmp/runtime"))
    && env.includes("HOME=/tmp") && env.includes("ATOLYE_RUNTIME_ROOT=/tmp/runtime"));
  check("NETWORK", host.NetworkMode === "none" && empty(host.PortBindings) && host.PublishAllPorts === false
    && empty(host.ExtraHosts) && empty(host.Dns));
  check("ROOT", host.ReadonlyRootfs === true && host.Privileged === false
    && host.AutoRemove === (phase === "run"));
  check("CAPABILITIES", array(host.CapDrop).includes("ALL") && empty(host.CapAdd)
    && array(host.SecurityOpt).includes("no-new-privileges"));
  check("PROCESS", (host.PidMode === "" || host.PidMode === "private")
    && (host.IpcMode === "" || host.IpcMode === "private")
    && (host.UsernsMode === "" || host.UsernsMode === undefined || host.UsernsMode === "private")
    && host.PidsLimit === 64);
  check("RESOURCES", host.Memory === 4 * 1024 ** 3 && host.NanoCpus === 2_000_000_000);
  check("HOST_DEVICES", empty(host.Devices) && empty(host.VolumesFrom) && empty(host.Binds));
  const tmpfs = object(host.Tmpfs);
  check("TMPFS", !!tmpfs && Object.keys(tmpfs).length === 1 && tmpfs["/tmp"] === "rw,noexec,nosuid,size=64m");
  const mounts = array(root.Mounts);
  const expectedSource = path.resolve(plan.workspaceRoot).toLowerCase();
  const bind = mounts.filter((entry) => object(entry)?.Type === "bind");
  check("WORKSPACE_MOUNT", bind.length === 1 && object(bind[0])?.Destination === "/workspace"
    && object(bind[0])?.RW === false
    && typeof object(bind[0])?.Source === "string"
    && path.resolve(object(bind[0])!.Source as string).toLowerCase() === expectedSource);
  const temporary = mounts.filter((entry) => object(entry)?.Type === "tmpfs");
  check("EXTRA_MOUNTS", mounts.length >= 1 && mounts.length <= 2 && temporary.length <= 1 && mounts.every((entry) => {
    const mount = object(entry);
    return mount?.Type === "bind" && mount.Destination === "/workspace"
      || mount?.Type === "tmpfs" && mount.Destination === "/tmp";
  }));
  return { configMatchesPlan: mismatches.length === 0, mismatches: Object.freeze(mismatches) };
}
