import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const repo = fs.realpathSync.native(process.cwd());
const production = path.dirname(path.dirname(repo));
function contained(root, file) {
  const relative = path.relative(root, file);
  return (
    relative !== ".." &&
    !relative.startsWith(".." + path.sep) &&
    !path.isAbsolute(relative)
  );
}
const runtime = process.env.ATOLYE_RUNTIME_ROOT,
  authority = process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT;
assert(runtime && authority, "Explicit runtime and authority required.");
for (const item of [runtime, authority])
  assert(
    contained(production, fs.realpathSync.native(item)),
    "Runtime outside production bundle.",
  );
const store = path.join(authority, "authority-transition-v1");
const active = JSON.parse(
  fs.readFileSync(path.join(store, "active-authority.json"), "utf8"),
);
const record = JSON.parse(
  fs.readFileSync(
    path.join(store, "transitions", active.transitionId + ".json"),
    "utf8",
  ),
);
assert(["published", "old-root-quarantined"].includes(record.state));
assert.equal(
  record.target.resolverBindingIdentity,
  active.resolverBindingIdentity,
);
const raw = fs.readFileSync(
  path.join(store, "materializations", active.transitionId + ".json"),
);
assert.equal(
  createHash("sha256").update(raw).digest("hex"),
  record.targetValidation.materializationEvidenceSha256,
);
const proof = JSON.parse(raw);
assert.equal(proof.targetBinding, active.resolverBindingIdentity);
const rootPin = proof.directories.find((d) => d.relativePath === ".");
assert(rootPin);
const actual = fs.lstatSync(path.join(runtime, "projects"));
assert(!actual.isSymbolicLink() && actual.isDirectory());
assert.equal(
  actual.dev,
  rootPin.target.device,
  "Copied/new-PC root requires official physical requalification.",
);
assert.equal(
  actual.ino,
  rootPin.target.inode,
  "Copied/new-PC root requires official physical requalification.",
);
const defaults = {
  PIPER_EXECUTABLE: "bin/piper/piper.exe",
  PIPER_VOICE_MODEL: "bin/piper/tr_TR-dfki-medium.onnx",
};
const providerFiles = [
  "AYAS_WHISPER_EXECUTABLE",
  "AYAS_WHISPER_MODEL",
  "PIPER_EXECUTABLE",
  "PIPER_VOICE_MODEL",
].map((k) => ({ name: k, path: process.env[k] || defaults[k] }));
for (const item of providerFiles)
  assert(item.path, "Missing local provider configuration.");
for (const item of providerFiles) {
  assert(fs.statSync(item.path).isFile());
  assert(
    contained(production, fs.realpathSync.native(item.path)),
    "AYAS provider asset outside production bundle.",
  );
}
const result = {
  status: "QUALIFIED_CURRENT_HOST_LAYOUT",
  repo,
  production,
  runtime,
  authority,
  transitionId: active.transitionId,
  anchoredFiles: proof.files.length,
  providerFiles: providerFiles.map((e) => e.name),
  newPcAutomaticQualification: false,
};
console.log(JSON.stringify(result));
