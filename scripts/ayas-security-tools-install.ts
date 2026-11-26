/**
 * Installs (or checks) the open-source tools Bekçi runs — today Gitleaks (MIT), pinned in
 * src/lib/brain/security/SecurityTools.ts.
 *
 *   npx tsx scripts/ayas-security-tools-install.ts            download, verify, install (no-op when already verified)
 *   npx tsx scripts/ayas-security-tools-install.ts --check    verify the installed program only (no network)
 *   npx tsx scripts/ayas-security-tools-install.ts --force    reinstall even when the installed copy verifies
 *
 * Operator script (owner or Claude), never started by the observer or the app. It downloads the release archive and
 * its checksums file from the tool's official GitHub release into a fresh temp folder, refuses unless the archive's
 * SHA-256 equals BOTH the pin in code and the checksums file, extracts only the program and its licence with Windows'
 * own tar.exe (the program is never run here), refuses unless the program's SHA-256 equals its pin, then copies both
 * into the Git-ignored bin/security-tools/<tool>/<version>/ with a receipt (install.json). No admin rights, no PATH
 * change, nothing outside the repository's bin folder and the temp folder (removed afterwards).
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { GITLEAKS, releaseAssetUrl, toolInstallDir, toolRunDecision, verifyArchive, type PinnedTool } from "../src/lib/brain/security/SecurityTools";
import { fixedHostGet, type FetchLike } from "./lib/SecurityFixedHostFetch";

/** GitHub release downloads redirect to its asset hosts; nothing else is accepted on any hop. */
export const RELEASE_HOSTS = ["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"] as const;
const MAX_ARCHIVE_BYTES = 40_000_000;

export const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
export const sha256File = (file: string): string => sha256(fs.readFileSync(file));

export type InstallOutcome =
  | { readonly status: "INSTALLED" | "ALREADY_INSTALLED"; readonly tool: string; readonly version: string; readonly exe: string; readonly exeSha256: string }
  | { readonly status: "REFUSED"; readonly tool: string; readonly version: string; readonly reason: string }
  | { readonly status: "PIN_NEEDED"; readonly tool: string; readonly version: string; readonly exeSha256: string; readonly reason: string };

/** The installed program, verified against its pin (no network). */
export function checkInstalledTool(root: string, tool: PinnedTool = GITLEAKS): { readonly exe: string; readonly decision: ReturnType<typeof toolRunDecision>; readonly sha256?: string } {
  const exe = path.join(root, ...toolInstallDir(tool).split("/"), tool.exe);
  if (!fs.existsSync(exe)) return { exe, decision: toolRunDecision(tool, { exists: false }) };
  const actual = sha256File(exe);
  return { exe, sha256: actual, decision: toolRunDecision(tool, { exists: true, sha256: actual }) };
}

async function download(url: string, maxBytes: number, fetchImpl?: FetchLike): Promise<Buffer> {
  const r = await fixedHostGet(url, { allowedHosts: [...RELEASE_HOSTS], maxRedirects: 4, maxBytes, timeoutMs: 300_000, accept: "application/octet-stream", ...(fetchImpl ? { fetchImpl } : {}) });
  if (!r.ok) throw new Error(`${path.basename(url)} indirilemedi: ${r.message}`);
  return r.body;
}

/** Extracts the named members of a verified zip with Windows' tar.exe (bsdtar refuses absolute and ../ paths). */
function defaultExtract(archive: string, into: string, members: readonly string[]): void {
  const tar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  execFileSync(tar, ["-xf", archive, "-C", into, ...members], { windowsHide: true, timeout: 120_000, stdio: ["ignore", "ignore", "pipe"] });
}

export async function installPinnedTool(options: {
  readonly root: string;
  readonly tool?: PinnedTool;
  readonly force?: boolean;
  readonly fetchImpl?: FetchLike;
  readonly extract?: (archive: string, into: string, members: readonly string[]) => void;
  readonly tmpRoot?: string;
}): Promise<InstallOutcome> {
  const tool = options.tool ?? GITLEAKS;
  const base = { tool: tool.tool, version: tool.version };
  const installed = checkInstalledTool(options.root, tool);
  if (!options.force && installed.decision.run) return { status: "ALREADY_INSTALLED", ...base, exe: installed.exe, exeSha256: installed.sha256! };
  const work = fs.mkdtempSync(path.join(options.tmpRoot ?? os.tmpdir(), `bekci-${tool.tool}-`));
  try {
    const downloadDir = path.join(work, "download");
    const extractDir = path.join(work, "extract");
    fs.mkdirSync(downloadDir); fs.mkdirSync(extractDir);
    const checksums = (await download(releaseAssetUrl(tool, tool.checksumsAsset), 100_000, options.fetchImpl)).toString("utf8");
    const archive = await download(releaseAssetUrl(tool, tool.asset), MAX_ARCHIVE_BYTES, options.fetchImpl);
    const verdict = verifyArchive(tool, sha256(archive), checksums);
    if (!verdict.ok) return { status: "REFUSED", ...base, reason: verdict.reason };
    const archiveFile = path.join(downloadDir, tool.asset);
    fs.writeFileSync(archiveFile, archive);
    (options.extract ?? defaultExtract)(archiveFile, extractDir, [tool.exe, "LICENSE"]);
    const exe = path.join(extractDir, tool.exe);
    if (!fs.existsSync(exe)) return { status: "REFUSED", ...base, reason: `arşivde ${tool.exe} yok` };
    const exeSha256 = sha256File(exe);
    if (!/^[0-9a-f]{64}$/.test(tool.exeSha256)) return { status: "PIN_NEEDED", ...base, exeSha256, reason: "arşiv doğrulandı; programın SHA-256'sını SecurityTools.ts'e sabitle ve yeniden çalıştır" };
    if (exeSha256 !== tool.exeSha256) return { status: "REFUSED", ...base, reason: `çıkarılan programın SHA-256'sı sabitle uyuşmuyor (${exeSha256.slice(0, 12)}…)` };
    const target = path.join(options.root, ...toolInstallDir(tool).split("/"));
    fs.mkdirSync(target, { recursive: true });
    for (const name of [tool.exe, "LICENSE"]) {
      const from = path.join(extractDir, name);
      if (!fs.existsSync(from)) continue;
      const temp = path.join(target, `${name}.${process.pid}.tmp`);
      fs.copyFileSync(from, temp);
      fs.renameSync(temp, path.join(target, name));
    }
    const finalExe = path.join(target, tool.exe);
    if (sha256File(finalExe) !== tool.exeSha256) return { status: "REFUSED", ...base, reason: "kopyalanan program doğrulanamadı" };
    fs.writeFileSync(path.join(target, "install.json"), `${JSON.stringify({ schemaVersion: 1, tool: tool.tool, version: tool.version, licence: tool.licence, source: releaseAssetUrl(tool, tool.asset), assetSha256: tool.assetSha256, exeSha256, installedAt: new Date().toISOString() }, null, 2)}\n`);
    return { status: "INSTALLED", ...base, exe: finalExe, exeSha256 };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const root = process.cwd();
  if (process.argv.includes("--check")) {
    const c = checkInstalledTool(root);
    console.log(JSON.stringify({ tool: GITLEAKS.tool, version: GITLEAKS.version, exe: c.exe, ok: c.decision.run, ...(c.decision.run ? {} : { reason: c.decision.reason }) }));
    if (!c.decision.run) process.exitCode = 1;
    return;
  }
  const outcome = await installPinnedTool({ root, force: process.argv.includes("--force") });
  console.log(JSON.stringify(outcome));
  if (outcome.status === "REFUSED" || outcome.status === "PIN_NEEDED") process.exitCode = 2;
}

if (path.basename(process.argv[1] ?? "") === "ayas-security-tools-install.ts") {
  main().catch((error: unknown) => {
    console.error(`Güvenlik aracı kurulamadı: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
