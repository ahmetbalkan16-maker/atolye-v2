import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { inspectAyasLocalCodingContainer } from "./AyasLocalCodingContainerInspection";
import { planAyasLocalCodingContainer, type AyasLocalCodingAdapterDescriptor, type AyasLocalCodingContainerPlan } from "./AyasLocalCodingContainerPlan";
import type { AyasLocalCodingTaskContract } from "./AyasLocalCodingTaskContract";

const execFileAsync = promisify(execFile);
const HEX64 = /^[a-f0-9]{64}$/;
const MAX_OUTPUT = 256_000;

/** No local engine/image is approved for activation yet. Changing this requires reviewed evidence. */
const REGISTERED_LOCAL_ENGINES: readonly { readonly binaryPath: string; readonly sha256: string }[] = [];

export type AyasLocalCodingProbeStatus = "LOCAL_ENGINE_UNAVAILABLE" | "PROBE_REFUSED" | "OBSERVED_NOT_ADMITTED";
export interface AyasLocalCodingProbeResult {
  readonly status: AyasLocalCodingProbeStatus;
  readonly reason: string;
}

export interface AyasLocalCodingProbeCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
}

export type AyasLocalCodingProbeRunner = (args: readonly string[]) => Promise<AyasLocalCodingProbeCommandResult>;

/**
 * Diagnostic sequence only: no result from this function grants coding, artifact,
 * proposal or execution authority. The real wrapper below uses a pinned CLI.
 */
export async function diagnoseAyasLocalCodingProbeWith(plan: AyasLocalCodingContainerPlan, run: AyasLocalCodingProbeRunner): Promise<AyasLocalCodingProbeResult> {
  const name = `ayas-local-coding-probe-${crypto.randomUUID()}`;
  const refused = (reason: string): AyasLocalCodingProbeResult => ({ status: "PROBE_REFUSED", reason });
  if (plan.executable !== "docker" || plan.args[0] !== "run" || !plan.args.includes("--pull=never")
    || !plan.args.includes("--network=none") || !plan.args.includes("--read-only")
    || plan.args.at(-1) !== plan.image) return refused("INVALID_PROBE_PLAN");
  let created = false;
  try {
    const image = await run(["image", "inspect", plan.image, "--format", "{{json .RepoDigests}}"]);
    if (image.exitCode !== 0 || image.stdout.length > MAX_OUTPUT) return refused("IMAGE_NOT_LOCAL");
    let digests: unknown;
    try { digests = JSON.parse(image.stdout); } catch { return refused("IMAGE_DIGEST_INVALID"); }
    if (!Array.isArray(digests) || !digests.includes(plan.image)) return refused("IMAGE_DIGEST_MISMATCH");
    const args = ["run", "-d", "--name", name, ...plan.args.slice(1).filter((arg) => arg !== "--rm")];
    const started = await run(args);
    if (started.exitCode !== 0) return refused("CONTAINER_CREATE_FAILED");
    created = true;
    const waited = await run(["wait", name]);
    if (waited.exitCode !== 0 || waited.stdout.trim() !== "0") return refused("PROBE_EXIT_FAILED");
    const inspected = await run(["inspect", name, "--format", "{{json .}}"]);
    if (inspected.exitCode !== 0 || inspected.stdout.length > MAX_OUTPUT) return refused("INSPECT_FAILED");
    let details: unknown;
    try { details = JSON.parse(inspected.stdout); } catch { return refused("INSPECT_INVALID"); }
    if (!inspectAyasLocalCodingContainer(plan, details, "retained-probe").configMatchesPlan) return refused("CONTAINMENT_MISMATCH");
    const logs = await run(["logs", name]);
    if (logs.exitCode !== 0 || logs.stdout.length > MAX_OUTPUT) return refused("PROBE_LOG_INVALID");
    let report: unknown;
    try { report = JSON.parse(logs.stdout); } catch { return refused("PROBE_REPORT_INVALID"); }
    const expected = ["hostCredentialsAbsent", "hostPrivateDataAbsent", "hostShellAbsent", "networkDenied", "packageInstallDenied", "schemaVersion", "workspaceReadOnly"];
    if (!report || typeof report !== "object" || Array.isArray(report)
      || Object.keys(report).sort().join("|") !== expected.join("|")
      || (report as Record<string, unknown>).schemaVersion !== "1"
      || expected.slice(0, -1).filter((key) => key !== "schemaVersion").some((key) => (report as Record<string, unknown>)[key] !== true)
      || (report as Record<string, unknown>).workspaceReadOnly !== true) return refused("PROBE_REPORT_REFUSED");
    return { status: "OBSERVED_NOT_ADMITTED", reason: "ENGINE_AND_PROBE_OBSERVED; independent qualification still required" };
  } catch {
    return refused("PROBE_COMMAND_FAILED");
  } finally {
    if (created) await run(["rm", "--force", name]).catch(() => ({ exitCode: 1, stdout: "" }));
  }
}

/** Production entrypoint is closed until a reviewed absolute local CLI pin is registered. */
export async function diagnoseAyasLocalCodingLocalEngine(input: {
  readonly adapter: AyasLocalCodingAdapterDescriptor;
  readonly task: AyasLocalCodingTaskContract;
  readonly workspaceRoot: string;
}): Promise<AyasLocalCodingProbeResult> {
  const pin = REGISTERED_LOCAL_ENGINES[0];
  if (!pin || !path.isAbsolute(pin.binaryPath) || !HEX64.test(pin.sha256)) {
    return { status: "LOCAL_ENGINE_UNAVAILABLE", reason: "no reviewed local container engine pin" };
  }
  let plan: AyasLocalCodingContainerPlan;
  try { plan = planAyasLocalCodingContainer({ ...input, engine: "docker" }); }
  catch { return { status: "PROBE_REFUSED", reason: "unsafe local coding container plan" }; }
  let actual: string;
  try { actual = crypto.createHash("sha256").update(fs.readFileSync(pin.binaryPath)).digest("hex"); }
  catch { return { status: "LOCAL_ENGINE_UNAVAILABLE", reason: "reviewed local container engine is absent" }; }
  if (actual !== pin.sha256) return { status: "PROBE_REFUSED", reason: "local engine binary hash mismatch" };
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-local-coding-cli-"));
  try {
    const env: NodeJS.ProcessEnv = process.platform === "win32"
      ? { NODE_ENV: "test", SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, PATH: process.env.PATH,
          DOCKER_HOST: "npipe:////./pipe/docker_engine", DOCKER_CONFIG: configRoot }
      : { NODE_ENV: "test", PATH: process.env.PATH, DOCKER_HOST: "unix:///var/run/docker.sock", DOCKER_CONFIG: configRoot };
    return diagnoseAyasLocalCodingProbeWith(plan, async (args) => {
      try {
        const result = await execFileAsync(pin.binaryPath, [...args], { env, windowsHide: true, timeout: 30_000, maxBuffer: MAX_OUTPUT });
        return { exitCode: 0, stdout: result.stdout };
      } catch (error) {
        const failure = error as { code?: unknown; stdout?: unknown };
        return { exitCode: typeof failure.code === "number" ? failure.code : 1,
          stdout: typeof failure.stdout === "string" ? failure.stdout : "" };
      }
    });
  } finally {
    if (path.dirname(configRoot).toLowerCase() === fs.realpathSync(os.tmpdir()).toLowerCase()
      && path.basename(configRoot).startsWith("ayas-local-coding-cli-")) fs.rmSync(configRoot, { recursive: true, force: false });
  }
}
