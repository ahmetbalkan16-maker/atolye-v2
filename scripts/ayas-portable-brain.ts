/** Stage 15S operator. Private inputs/session/passphrase never appear in argv/output. No live import. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decryptAyasPortableBrain, manifestAyasPortableBrain, portableBrainDigest, AYAS_PORTABLE_MAX_BYTES } from "../src/lib/ayas/migration/AyasPortableBrain";
import { readAyasPortableEnvelope, restoreAyasPortableBrainInTemp, exportAyasPortableBrain } from "../src/lib/ayas/migration/AyasPortableBrainStore";
import { verifyAyasPortableArtifacts } from "../src/lib/ayas/migration/AyasPortableArtifacts";

async function main() {
  const [mode, file, expectedDigest, ...extra] = process.argv.slice(2);
  if (!file) throw new Error("AYAS_PORTABLE_ARGUMENT_INVALID");
  if (mode === "manifest" || mode === "export") {
    if ((mode === "manifest" && (expectedDigest || extra.length)) || (mode === "export" && (!expectedDigest || extra.length))) throw new Error("AYAS_PORTABLE_ARGUMENT_INVALID");
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > AYAS_PORTABLE_MAX_BYTES) throw new Error("AYAS_PORTABLE_INPUT_INVALID");
    const payload: unknown = JSON.parse(fs.readFileSync(file, "utf8")), manifest = manifestAyasPortableBrain(payload), digest = portableBrainDigest(manifest);
    if (mode === "manifest") { console.log(JSON.stringify({ manifest, manifestDigest: digest, grantsAuthority: false })); return; }
    const result = await exportAyasPortableBrain({ repoRoot: process.cwd(), payload, expectedManifestDigest: expectedDigest!,
      passphrase: process.env.AYAS_PORTABLE_PASSPHRASE ?? "", ownerSession: process.env.AYAS_PORTABLE_OWNER_SESSION });
    console.log(JSON.stringify({ outcome: "ENCRYPTED_ARCHIVE_EXPORTED_NOT_MIGRATION_CERTIFIED", manifestDigest: result.manifestDigest,
      archive: `data/brain/execution/portable-brain/${result.manifestDigest}.encrypted.json`, grantsAuthority: false })); return;
  }
  if (!expectedDigest || !["verify", "drill", "artifacts"].includes(mode ?? "") || (mode === "artifacts" ? extra.length !== 1 : extra.length !== 0)) throw new Error("AYAS_PORTABLE_ARGUMENT_INVALID");
  const passphrase = process.env.AYAS_PORTABLE_PASSPHRASE;
  if (!passphrase) throw new Error("AYAS_PORTABLE_PASSPHRASE_REQUIRED");
  const envelope = readAyasPortableEnvelope(file);
  if (mode === "artifacts") { console.log(JSON.stringify(verifyAyasPortableArtifacts(decryptAyasPortableBrain(envelope, passphrase, expectedDigest), extra[0]!))); return; }
  if (mode === "verify") {
    const payload = decryptAyasPortableBrain(envelope, passphrase, expectedDigest), manifest = manifestAyasPortableBrain(payload);
    console.log(JSON.stringify({ outcome: "ARCHIVE_VERIFIED_NOT_MIGRATION_CERTIFIED", sourceHead: manifest.sourceHead,
      entries: manifest.entries.length, manifestDigest: expectedDigest, grantsAuthority: false }));
    return;
  }
  const proof = restoreAyasPortableBrainInTemp(envelope, passphrase, expectedDigest);
  try { console.log(JSON.stringify({ ...proof, restoredRoot: "OWNED_TEMP_REMOVED_AFTER_VERIFICATION" })); }
  finally {
    const parent = fs.realpathSync.native(os.tmpdir()), root = fs.realpathSync.native(proof.restoredRoot);
    if (path.dirname(root).toLowerCase() !== parent.toLowerCase() || !path.basename(root).startsWith("ayas-portable-restore-")) throw new Error("AYAS_PORTABLE_CLEANUP_SCOPE_INVALID");
    fs.rmSync(root, { recursive: true, force: true });
  }
}
void main().catch(error => {
  console.error(error instanceof Error && /^(?:AYAS_PORTABLE_[A-Z_]+|AYAS_SAFE_READ_ONLY|AYAS_SAFE_MODE_UNAVAILABLE)$/.test(error.message) ? error.message : "AYAS_PORTABLE_OPERATION_FAILED"); process.exitCode = 1;
});
