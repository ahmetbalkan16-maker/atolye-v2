import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseAyasLocalCodingTaskContract, type AyasLocalCodingTaskContract } from "./AyasLocalCodingTaskContract";

const PREFIX = "ayas-local-coding-";
const MAX_SOURCE_BYTES = 1_000_000;
const TREE_ROW = /^(100644) blob ([0-9a-f]{40})\t(.+)$/;

export class AyasLocalCodingWorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AyasLocalCodingWorkspaceError";
  }
}

export interface AyasLocalCodingWorkspace {
  readonly root: string;
  /** Host-side proof only. Never include this in a model prompt or workspace. */
  readonly sourceBlobs: readonly { readonly file: string; readonly blob: string; readonly sha256: string }[];
}

function sourceAllowed(file: string): boolean {
  if (file.toLowerCase().split("/").some((part) => ["fixtures", "__tests__", "test", "tests"].includes(part))) return false;
  if (file.toLowerCase().includes("ayas-local-coding-qualification-")) return false;
  if (file.startsWith("src/")) return true;
  return /^scripts\/ayas-[A-Za-z0-9_-]+\.ts$/.test(file);
}

function gitBytes(repoRoot: string, args: readonly string[], maxBuffer = MAX_SOURCE_BYTES + 1): Buffer {
  return execFileSync("git", [...args], { cwd: repoRoot, windowsHide: true, maxBuffer,
    stdio: ["ignore", "pipe", "ignore"] });
}

function readBaselineBlob(repoRoot: string, head: string, file: string): { readonly bytes: Buffer; readonly blob: string } {
  const tree = gitBytes(repoRoot, ["ls-tree", "-z", "--full-tree", head, "--", file], 4_096).toString("utf8");
  const rows = tree.split("\0").filter(Boolean);
  const match = rows.length === 1 ? TREE_ROW.exec(rows[0]!) : null;
  if (!match || match[3] !== file) throw new AyasLocalCodingWorkspaceError("baseline source is absent, linked or not a regular blob");
  const bytes = gitBytes(repoRoot, ["cat-file", "blob", match[2]!]);
  if (bytes.length === 0 || bytes.length > MAX_SOURCE_BYTES || bytes.includes(0)) {
    throw new AyasLocalCodingWorkspaceError("baseline source is empty, binary or oversized");
  }
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new AyasLocalCodingWorkspaceError("baseline source is not UTF-8"); }
  return { bytes, blob: match[2]! };
}

/** Project only exact baseline source bytes. No Git history, evaluator, fixture, tool or dependency tree is copied. */
export function createAyasLocalCodingWorkspace(input: {
  readonly repoRoot: string;
  readonly task: AyasLocalCodingTaskContract;
}): AyasLocalCodingWorkspace {
  const task = parseAyasLocalCodingTaskContract(input.task);
  if (task.exactFiles.some((file) => !sourceAllowed(file))) {
    throw new AyasLocalCodingWorkspaceError("task requests a non-source or evaluator path");
  }
  const repoRoot = fs.realpathSync(input.repoRoot);
  const top = gitBytes(repoRoot, ["rev-parse", "--show-toplevel"], 4_096).toString("utf8").trim();
  if (path.resolve(top).toLowerCase() !== repoRoot.toLowerCase()) {
    throw new AyasLocalCodingWorkspaceError("repository root does not match Git top level");
  }
  try { gitBytes(repoRoot, ["merge-base", "--is-ancestor", task.baseHead, "HEAD"], 4_096); }
  catch { throw new AyasLocalCodingWorkspaceError("baseline commit is not in current repository history"); }
  // Resolve all blobs before making a model-facing directory. A failed lookup leaves no projection.
  let sources: readonly { readonly file: string; readonly bytes: Buffer; readonly blob: string }[];
  try { sources = task.exactFiles.map((file) => ({ file, ...readBaselineBlob(repoRoot, task.baseHead, file) })); }
  catch (error) {
    if (error instanceof AyasLocalCodingWorkspaceError) throw error;
    throw new AyasLocalCodingWorkspaceError("baseline Git object is unavailable");
  }
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), PREFIX));
  try {
    for (const source of sources) {
      const target = path.join(root, source.file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, source.bytes, { flag: "wx" });
    }
    return Object.freeze({ root, sourceBlobs: Object.freeze(sources.map(({ file, bytes, blob }) => Object.freeze({
      file, blob, sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    }))) });
  } catch (error) {
    destroyAyasLocalCodingWorkspace({ root });
    throw error;
  }
}

export function destroyAyasLocalCodingWorkspace(workspace: Pick<AyasLocalCodingWorkspace, "root">): void {
  const root = path.resolve(workspace.root);
  const tmp = fs.realpathSync(os.tmpdir());
  if (path.dirname(root).toLowerCase() !== tmp.toLowerCase() || !path.basename(root).startsWith(PREFIX)
    || fs.lstatSync(root).isSymbolicLink() || fs.realpathSync(root).toLowerCase() !== root.toLowerCase()) {
    throw new AyasLocalCodingWorkspaceError("refusing to remove a non-owned workspace");
  }
  fs.rmSync(root, { recursive: true, force: false });
}
