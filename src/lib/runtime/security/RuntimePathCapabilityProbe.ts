import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { canonicalRuntimePath } from "./RuntimeProtectedRoots";
import { RuntimeMutationError } from "./RuntimeMutationError";

export interface RuntimePathCapabilityReport {
  readonly supportsHardLinks: boolean;
  readonly supportsExclusiveCreate: boolean;
  readonly supportsExclusivePublish: boolean;
  readonly hostileConcurrentIsolation: false;
  readonly filesystemKind: string;
  readonly fallbackPublishMode: "exclusive-copy" | "unavailable";
  readonly probeSideEffects: "owned-temporary-only";
  readonly cleanupVerified: boolean;
}

export function probeRuntimePathCapabilities(scratchRoot: string): RuntimePathCapabilityReport {
  const root = canonicalRuntimePath(scratchRoot);
  if (!fs.existsSync(root)) throw capabilityUnavailable();
  const probeRoot = path.join(root, `.atolye-capability-${randomUUID()}`);
  let supportsExclusiveCreate = false;
  let supportsHardLinks = false;
  let supportsExclusivePublish = false;
  let cleanupVerified = false;
  try {
    fs.mkdirSync(probeRoot);
    const source = path.join(probeRoot, "source");
    const linked = path.join(probeRoot, "linked");
    const publishSource = path.join(probeRoot, "publish-source");
    const publishTarget = path.join(probeRoot, "publish-target");
    const descriptor = fs.openSync(source, "wx", 0o600);
    try {
      fs.writeFileSync(descriptor, "capability", "utf8");
    } finally {
      fs.closeSync(descriptor);
    }
    try {
      const unexpected = fs.openSync(source, "wx", 0o600);
      fs.closeSync(unexpected);
    } catch (error) {
      supportsExclusiveCreate = isNodeError(error) && error.code === "EEXIST";
    }
    try {
      fs.linkSync(source, linked);
      supportsHardLinks = fs.readFileSync(linked, "utf8") === "capability";
      try {
        fs.linkSync(source, linked);
        supportsHardLinks = false;
      } catch (error) {
        supportsHardLinks = supportsHardLinks && isNodeError(error) && error.code === "EEXIST";
      }
    } catch {
      supportsHardLinks = false;
    }
    fs.writeFileSync(publishSource, "new-bytes", { flag: "wx", mode: 0o600 });
    fs.writeFileSync(publishTarget, "original-bytes", { flag: "wx", mode: 0o600 });
    try {
      fs.copyFileSync(publishSource, publishTarget, fs.constants.COPYFILE_EXCL);
    } catch (error) {
      supportsExclusivePublish = isNodeError(error) && error.code === "EEXIST" &&
        fs.readFileSync(publishTarget, "utf8") === "original-bytes";
    }
    const freshPublish = path.join(probeRoot, "fresh-publish");
    if (supportsExclusivePublish) {
      fs.copyFileSync(publishSource, freshPublish, fs.constants.COPYFILE_EXCL);
      supportsExclusivePublish = fs.readFileSync(freshPublish, "utf8") === "new-bytes";
    }
  } catch {
    throw capabilityUnavailable();
  } finally {
    try {
      fs.rmSync(probeRoot, { recursive: true, force: true });
      cleanupVerified = !fs.existsSync(probeRoot);
    } catch {
      cleanupVerified = false;
    }
  }
  if (!cleanupVerified) throw capabilityUnavailable();
  return Object.freeze({
    supportsHardLinks,
    supportsExclusiveCreate,
    supportsExclusivePublish,
    hostileConcurrentIsolation: false,
    filesystemKind: filesystemKind(root),
    fallbackPublishMode: supportsExclusivePublish ? "exclusive-copy" : "unavailable",
    probeSideEffects: "owned-temporary-only",
    cleanupVerified,
  });
}

function filesystemKind(root: string) {
  try {
    const type = fs.statfsSync(root).type;
    if (process.platform === "win32") return type === 0 ? "windows-unknown" : `windows-${type}`;
    return `${process.platform}-${type}`;
  } catch {
    return `${process.platform}-unknown`;
  }
}

function capabilityUnavailable() {
  return new RuntimeMutationError("RUNTIME_MUTATION_CAPABILITY_UNAVAILABLE");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
