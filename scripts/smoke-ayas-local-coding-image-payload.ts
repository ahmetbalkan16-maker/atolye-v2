/** Real filesystem checks on synthetic TEMP payloads; never builds or runs an image. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

interface PayloadVerifier { verifyAyasLocalCodingPayload(root: string, manifest: string): { readonly status: string } }
const hash = (text: string): string => crypto.createHash("sha256").update(text).digest("hex");
let count = 0;
async function main(): Promise<void> {
  const moduleUrl = pathToFileURL(path.resolve("sandbox/ayas-local-coding/verify-payload.mjs")).href;
  const verifier = await import(moduleUrl) as PayloadVerifier;
  const run = (name: string, mutate: (root: string, manifest: Record<string, unknown>) => void, accepted = false): void => {
    const ownedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-image-payload-"));
    const root = path.join(ownedRoot, "payload"); const manifestFile = path.join(ownedRoot, "BUILD_INPUT.json");
    fs.mkdirSync(root); fs.writeFileSync(path.join(root, "test.mjs"), "export const test = 1;\n");
    const manifest: Record<string, unknown> = { schemaVersion: "1", role: "EVALUATOR", files: [{ path: "test.mjs", sizeBytes: 23, sha256: hash("export const test = 1;\n") }] };
    try {
      mutate(root, manifest); fs.writeFileSync(manifestFile, JSON.stringify(manifest));
      if (accepted) assert.equal(verifier.verifyAyasLocalCodingPayload(root, manifestFile).status, "PAYLOAD_BYTES_VERIFIED_NOT_ADMITTED");
      else assert.throws(() => verifier.verifyAyasLocalCodingPayload(root, manifestFile), /PAYLOAD_REFUSED/);
      console.log(`PASS ${++count}: ${name}`);
    } finally {
      assert.equal(path.dirname(ownedRoot).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
      assert.ok(path.basename(ownedRoot).startsWith("ayas-image-payload-"));
      fs.rmSync(ownedRoot, { recursive: true });
    }
  };
  run("exact evaluator fixture bytes verified only", () => {}, true);
  run("tampered bytes refused", (root) => { fs.writeFileSync(path.join(root, "test.mjs"), "export const test = 2;\n"); });
  run("undeclared external content refused", (root) => { fs.writeFileSync(path.join(root, "secret"), "value"); });
  run("missing file refused", (root) => { fs.unlinkSync(path.join(root, "test.mjs")); });
  run("unknown manifest authority refused", (_, manifest) => { manifest.approved = true; });
  run("duplicate path refused", (_, manifest) => { const files = manifest.files as unknown[]; files.push(files[0]); });
  run("path traversal refused", (_, manifest) => { (manifest.files as Record<string, unknown>[])[0]!.path = "../escape"; });
  run("Git metadata refused", (root, manifest) => { fs.mkdirSync(path.join(root, ".git")); fs.writeFileSync(path.join(root, ".git", "config"), "git"); (manifest.files as unknown[]).push({ path: ".git/config", sizeBytes: 3, sha256: hash("git") }); });
  run("model cannot see evaluator payload", (_, manifest) => { manifest.role = "INFERENCE"; });
  run("alternate model/archive refused", (root, manifest) => {
    fs.unlinkSync(path.join(root, "test.mjs")); fs.mkdirSync(path.join(root, "model")); fs.writeFileSync(path.join(root, "model", "qwen2.5-coder-14b-instruct-q4_k_m.gguf"), "bad");
    manifest.role = "INFERENCE"; manifest.files = [{ path: "model/qwen2.5-coder-14b-instruct-q4_k_m.gguf", sizeBytes: 3, sha256: hash("bad") }];
  });
  run("junction outside payload refused", (root) => { fs.symlinkSync(path.dirname(root), path.join(root, "escape"), "junction"); });
  run("invalid digest refused", (_, manifest) => { (manifest.files as Record<string, unknown>[])[0]!.sha256 = "latest"; });
  run("environment secrets refused even when declared", (root, manifest) => {
    fs.writeFileSync(path.join(root, ".env.local"), "secret");
    (manifest.files as unknown[]).push({ path: ".env.local", sizeBytes: 6, sha256: hash("secret") });
  });
  const scoped = (root: string, manifest: Record<string, unknown>, scope: string): void => {
    const file = `toolchain/node_modules/${scope}/linux-x64/bin/esbuild`;
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), "bin");
    (manifest.files as unknown[]).push({ path: file, sizeBytes: 3, sha256: hash("bin") });
  };
  run("exact evaluator-only Linux esbuild namespace", (root, manifest) => scoped(root, manifest, "@esbuild"), true);
  run("unregistered scoped namespace refused", (root, manifest) => scoped(root, manifest, "@other"));
  run("inference cannot declare evaluator native toolchain", (root, manifest) => { scoped(root, manifest, "@esbuild"); manifest.role = "INFERENCE"; });
  run("scoped native toolchain traversal refused", (_, manifest) => {
    (manifest.files as Record<string, unknown>[])[0]!.path = "toolchain/node_modules/@esbuild/linux-x64/../escape";
  });
  console.log(`Image payload verifier: ${count}/${count} PASS; fixture bytes only, image builds 0.`);
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
