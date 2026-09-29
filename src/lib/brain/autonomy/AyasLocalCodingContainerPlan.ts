import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseAyasLocalCodingTaskContract, type AyasLocalCodingTaskContract } from "./AyasLocalCodingTaskContract";

/** A server-owned, replaceable local image descriptor. This never selects a model from task text. */
export interface AyasLocalCodingAdapterDescriptor {
  readonly adapterId: string;
  readonly image: string;
}

export interface AyasLocalCodingContainerPlan {
  readonly executable: "docker" | "podman";
  readonly args: readonly string[];
  readonly image: string;
  readonly workspaceRoot: string;
}

export class AyasLocalCodingContainerPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AyasLocalCodingContainerPlanError";
  }
}

const ADAPTER_ID = /^[a-z][a-z0-9-]{2,50}$/;
const PINNED_IMAGE = /^[a-z0-9][a-z0-9./_-]{1,180}@sha256:[a-f0-9]{64}$/;
const MAX_ENTRIES = 5_000;

/**
 * Construct a fixed, network-denied container invocation for a later admission
 * probe. A plan is NOT proof of containment and is never an execution permit.
 */
export function planAyasLocalCodingContainer(input: {
  readonly engine: "docker" | "podman";
  readonly adapter: AyasLocalCodingAdapterDescriptor;
  readonly task: AyasLocalCodingTaskContract;
  readonly workspaceRoot: string;
}): AyasLocalCodingContainerPlan {
  const task = parseAyasLocalCodingTaskContract(input.task);
  if (input.engine !== "docker" && input.engine !== "podman") throw new AyasLocalCodingContainerPlanError("unsupported local container engine");
  if (!ADAPTER_ID.test(input.adapter.adapterId) || !PINNED_IMAGE.test(input.adapter.image)) {
    throw new AyasLocalCodingContainerPlanError("adapter image must be locally pinned by digest");
  }
  const root = path.resolve(input.workspaceRoot);
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  if (path.dirname(root).toLowerCase() !== temporaryRoot.toLowerCase() || !path.basename(root).startsWith("ayas-local-coding-")) {
    throw new AyasLocalCodingContainerPlanError("workspace is outside the dedicated temporary root");
  }
  if (/[\u0000-\u001f,]/.test(root) || !fs.statSync(root).isDirectory()
    || fs.lstatSync(root).isSymbolicLink() || fs.realpathSync(root).toLowerCase() !== root.toLowerCase()) {
    throw new AyasLocalCodingContainerPlanError("workspace root is not a plain directory");
  }
  let entries = 0;
  const inspect = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (++entries > MAX_ENTRIES) throw new AyasLocalCodingContainerPlanError("workspace is too large to inspect");
      if (entry.isSymbolicLink() || entry.name === ".git" || entry.name === "node_modules" || entry.name === "data" || entry.name === ".env") {
        throw new AyasLocalCodingContainerPlanError("workspace contains a forbidden path or link");
      }
      if (entry.isDirectory()) inspect(path.join(directory, entry.name));
      else if (!entry.isFile()) throw new AyasLocalCodingContainerPlanError("workspace contains a non-file entry");
    }
  };
  inspect(root);
  for (const file of task.exactFiles) {
    const target = path.join(root, file);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new AyasLocalCodingContainerPlanError("task exact file is absent");
  }
  return Object.freeze({
    executable: input.engine,
    image: input.adapter.image,
    workspaceRoot: root,
    args: Object.freeze([
      "run", "--rm", "--pull=never", "--network=none", "--read-only", "--cap-drop=ALL",
      "--security-opt=no-new-privileges", "--pids-limit=64", "--memory=4g", "--cpus=2",
      "--user=65534:65534", "--mount", `type=bind,src=${root},dst=/workspace,readonly`,
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m", "--workdir=/workspace",
      "--env", "HOME=/tmp", "--env", "ATOLYE_RUNTIME_ROOT=/tmp/runtime",
      "--entrypoint=/ayas-sandbox-probe", input.adapter.image,
    ]),
  });
}
