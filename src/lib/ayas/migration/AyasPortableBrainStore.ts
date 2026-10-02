/** Owner-gated export; restore evidence in a newly owned TEMP directory only. No live-store import or activation. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { resolveAccessGate, verifySession } from "../../auth/accessGate";
import { ensureSafeContainedDirectory, requireContainedRealDirectory } from "../../runtime/RuntimeStoragePaths";
import { canonicalAyasJson } from "../provenance/AyasReleaseProvenance";
import { readAyasGit } from "../provenance/AyasBuildStamp";
import { decryptAyasPortableBrain, encryptAyasPortableBrain, manifestAyasPortableBrain, portableBrainDigest, type AyasPortableBrain, type AyasPortableEnvelope } from "./AyasPortableBrain";

const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
function durableFile(file: string, text: string): void {
  const fd = fs.openSync(file, "wx", 0o600);
  try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
/** The owner reviews the exact manifest digest. disabled-dev, a hash or model output is not owner approval. */
export async function exportAyasPortableBrain(input: {
  readonly repoRoot: string; readonly payload: unknown; readonly expectedManifestDigest: string;
  readonly passphrase: string; readonly ownerSession: string | undefined;
  readonly env?: Readonly<Record<string, string | undefined>>; readonly nowMs?: () => number;
}): Promise<{ readonly manifestDigest: string; readonly archive: string }> {
  const env = input.env ?? process.env, now = input.nowMs ?? Date.now;
  const requireOwner = async () => {
    const gate = resolveAccessGate(env);
    if (gate.mode !== "enforced" || !gate.key || !await verifySession(input.ownerSession, gate.key, now())) throw new Error("AYAS_PORTABLE_OWNER_SESSION_REQUIRED");
  };
  await requireOwner();
  const manifest = manifestAyasPortableBrain(input.payload), digest = portableBrainDigest(manifest);
  if (digest !== input.expectedManifestDigest) throw new Error("AYAS_PORTABLE_OWNER_REVIEW_MISMATCH");
  const archive = encryptAyasPortableBrain(input.payload, input.passphrase);
  if (archive.manifestDigest !== digest) throw new Error("AYAS_PORTABLE_OWNER_REVIEW_MISMATCH");
  await requireOwner();
  const root = fs.realpathSync.native(input.repoRoot);
  if (readAyasGit(root, ["rev-parse", "HEAD"]).trim() !== manifest.sourceHead
    || readAyasGit(root, ["status", "--porcelain=v1", "-z"]).trim() !== "") throw new Error("AYAS_PORTABLE_SOURCE_BINDING_REFUSED");
  const dir = ensureSafeContainedDirectory(root, path.join(root, "data", "brain", "execution", "portable-brain"));
  const file = path.join(dir, `${digest}.encrypted.json`);
  // Write-once. No raw private manifest/payload or credential is written to disk.
  const pending = path.join(dir, `.pending-${randomUUID()}`);
  try {
    durableFile(pending, canonicalAyasJson(archive) + "\n");
    fs.linkSync(pending, file); // atomic, exclusive publication after fsync
  } finally { if (fs.existsSync(pending)) fs.unlinkSync(pending); }
  return { manifestDigest: digest, archive: file };
}
export interface AyasPortableRestoreProof {
  readonly schemaVersion: "1"; readonly outcome: "TEMP_RESTORE_VERIFIED_NOT_MIGRATION_CERTIFIED";
  readonly manifestDigest: string; readonly entries: number; readonly restoredRoot: string;
  readonly grantsAuthority: false; readonly liveStoresChanged: false;
}
/** Restores real bytes and rereads them. Never accepts a destination path, archive filenames or a live root. */
export function restoreAyasPortableBrainInTemp(envelope: unknown, passphrase: string, expectedManifestDigest: string,
  inspect?: (restoredRoot: string, payload: AyasPortableBrain) => void): AyasPortableRestoreProof {
  const payload = decryptAyasPortableBrain(envelope, passphrase, expectedManifestDigest), manifest = manifestAyasPortableBrain(payload);
  const parent = fs.realpathSync.native(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, "ayas-portable-restore-"));
  try {
    for (const e of payload.entries) {
      const dir = ensureSafeContainedDirectory(root, path.join(root, e.section));
      const text = canonicalAyasJson(e.data), file = path.join(dir, `${e.id}.json`);
      durableFile(file, text);
      const expected = manifest.entries.find(x => x.id === e.id)!;
      const actual = fs.readFileSync(file);
      if (actual.length !== expected.bytes || hash(actual) !== expected.sha256) throw new Error("AYAS_PORTABLE_RESTORE_UNVERIFIED");
    }
    durableFile(path.join(root, "manifest.json"), canonicalAyasJson(manifest));
    inspect?.(root, payload);
    // Recheck after the audit hook, not just before it.
    const files: string[] = ["manifest.json"];
    for (const e of manifest.entries) {
      const file = path.join(root, e.section, `${e.id}.json`); files.push(`${e.section}/${e.id}.json`);
      if (fs.lstatSync(file).isSymbolicLink() || hash(fs.readFileSync(file)) !== e.sha256) throw new Error("AYAS_PORTABLE_RESTORE_UNVERIFIED");
    }
    if (fs.readFileSync(path.join(root, "manifest.json"), "utf8") !== canonicalAyasJson(manifest)) throw new Error("AYAS_PORTABLE_RESTORE_UNVERIFIED");
    const actualFiles: string[] = [];
    const walk = (dir: string, relative: string) => {
      requireContainedRealDirectory(root, dir, dir === root);
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isSymbolicLink()) throw new Error("AYAS_PORTABLE_RESTORE_UNVERIFIED");
        const name = relative ? `${relative}/${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(dir, e.name), name); else if (e.isFile()) actualFiles.push(name); else throw new Error("AYAS_PORTABLE_RESTORE_UNVERIFIED");
      }
    };
    walk(root, "");
    if (JSON.stringify(actualFiles.sort()) !== JSON.stringify(files.sort())) throw new Error("AYAS_PORTABLE_RESTORE_UNVERIFIED");
    return { schemaVersion: "1", outcome: "TEMP_RESTORE_VERIFIED_NOT_MIGRATION_CERTIFIED", manifestDigest: expectedManifestDigest,
      entries: payload.entries.length, restoredRoot: root, grantsAuthority: false, liveStoresChanged: false };
  } catch (error) {
    // Own fresh fixture only. The caller owns successful drill cleanup and can inspect the proof before removing it.
    requireContainedRealDirectory(parent, root); fs.rmSync(root, { recursive: true, force: true }); throw error;
  }
}
export function readAyasPortableEnvelope(file: string): AyasPortableEnvelope {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 24 * 1024 * 1024) throw new Error("AYAS_PORTABLE_ARCHIVE_FILE_INVALID");
  return JSON.parse(fs.readFileSync(file, "utf8")) as AyasPortableEnvelope; // decrypt performs all schema/crypto validation
}
