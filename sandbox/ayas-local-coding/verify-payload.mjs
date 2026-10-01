// Offline build-time payload verifier. No network, shell, extraction or execution.
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

const keys = (value, expected) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join("|") === [...expected].sort().join("|");
function reject(reason) { throw new Error(`PAYLOAD_REFUSED: ${reason}`); }
export function verifyAyasLocalCodingPayload(root = "/opt/ayas/payload", manifestFile = "/opt/ayas/BUILD_INPUT.json") {
  if (!path.isAbsolute(root) || !path.isAbsolute(manifestFile)) reject("absolute paths required");
  const manifestStat = fs.lstatSync(manifestFile);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > 100000) reject("manifest type/size");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  if (!keys(manifest, ["schemaVersion", "role", "files"]) || manifest.schemaVersion !== "1"
    || !["INFERENCE", "EVALUATOR"].includes(manifest.role) || !Array.isArray(manifest.files)
    || manifest.files.length < 1 || manifest.files.length > 5000) reject("manifest schema");
  if (fs.lstatSync(root).isSymbolicLink() || fs.realpathSync(root) !== root) reject("root link");
  const declared = new Map();
  for (const file of manifest.files) {
    if (!keys(file, ["path", "sizeBytes", "sha256"]) || typeof file.path !== "string"
      || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(file.path)
      || file.path.split("/").some((part) => [".", "..", ".git", ".ssh", ".aws", ".npmrc", "id_rsa", "id_ed25519", "data"].includes(part.toLowerCase()) || part.toLowerCase().startsWith(".env"))
      || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1 || file.sizeBytes > 10000000000
      || !/^[a-f0-9]{64}$/.test(file.sha256) || declared.has(file.path)) reject("file declaration");
    declared.set(file.path, file);
  }
  let entries = 0;
  function inspect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (++entries > 10000) reject("too many entries");
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink() || fs.realpathSync(absolute) !== absolute) reject("link");
      if (entry.isDirectory()) { inspect(absolute); continue; }
      if (!entry.isFile()) reject("non-regular entry");
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      const expected = declared.get(relative);
      const stat = fs.statSync(absolute);
      if (!expected || stat.size !== expected.sizeBytes) reject("undeclared file or size mismatch");
      const handle = fs.openSync(absolute, "r");
      try {
        const hash = crypto.createHash("sha256");
        const buffer = Buffer.allocUnsafe(1048576);
        let count;
        while ((count = fs.readSync(handle, buffer)) !== 0) hash.update(buffer.subarray(0, count));
        if (hash.digest("hex") !== expected.sha256) reject("digest mismatch");
      } finally { fs.closeSync(handle); }
      declared.delete(relative);
    }
  }
  inspect(root);
  if (declared.size) reject("missing declared files");
  if (manifest.role === "INFERENCE") {
    const model = manifest.files.find((file) => file.path === "model/qwen2.5-coder-14b-instruct-q4_k_m.gguf");
    const archive = manifest.files.find((file) => file.path === "engine/llama-b11146-bin-ubuntu-x64.tar.gz");
    if (!model || model.sizeBytes !== 8988110272 || model.sha256 !== "c1e659736d89ac1065fb495330fb824d94001974a4bfa78e7270e43476a8d940"
      || !archive || archive.sizeBytes !== 16998357 || archive.sha256 !== "c150306eb16b5ab696f76a8bdf810c35fd98a24e82158742e6fa28f420ff8410"
      || manifest.files.some((file) => !/^(?:engine|model)\//.test(file.path))) reject("inference candidate identity or answer leakage");
  }
  return Object.freeze({ status: "PAYLOAD_BYTES_VERIFIED_NOT_ADMITTED", role: manifest.role, files: manifest.files.length });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(verifyAyasLocalCodingPayload()));
}
