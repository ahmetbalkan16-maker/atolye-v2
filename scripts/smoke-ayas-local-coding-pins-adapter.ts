/** Offline synthetic protocol/pin checks; no model, network, sandbox or admission evidence. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ayasLocalCodingCandidatePins as pins, parseAyasLocalCodingModelManifest,
  verifyAyasLocalCodingArtifact, parseAyasLocalCodingRuntimeIdentity, inspectAyasLocalCodingImageIdentity } from "../src/lib/brain/autonomy/AyasLocalCodingPins";
import { buildAyasLocalCodingModelRequest, diagnoseAyasLocalCodingModelWith, parseAyasLocalCodingPatch } from "../src/lib/brain/autonomy/AyasLocalCodingModelAdapter";
import type { AyasLocalCodingTaskContract } from "../src/lib/brain/autonomy/AyasLocalCodingTaskContract";

const digest = (value: string): string => crypto.createHash("sha256").update(value).digest("hex");
const task: AyasLocalCodingTaskContract = { schemaVersion: "1", taskId: "ayas-coding-11111111-2222-3333-4444-555555555555",
  baseHead: "a".repeat(40), objective: "Repair the bounded example expression.", exactFiles: ["src/example.ts"], maxChangedLines: 80 };
const sources = [{ path: "src/example.ts", content: "export const value = false;\n" }];
const patch = { schemaVersion: "1", edits: [{ path: "src/example.ts", beforeSha256: digest(sources[0]!.content), search: "false", replace: "true" }] };
const response = (candidate: unknown = patch): string => JSON.stringify({ model: "ayas-qwen2.5-coder-14b-q4-k-m", choices: [{ index: 0, finish_reason: "tool_calls",
  message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "submit_patch", arguments: JSON.stringify(candidate) } }] } }] });
const input = { task, sources, modelManifest: pins.model, endpoint: "http://127.0.0.1:8080/v1/chat/completions", timeoutMs: 1000 };
let count = 0;
async function test(name: string, run: () => void | Promise<void>): Promise<void> { await run(); count++; console.log(`PASS ${count}: ${name}`); }

async function main(): Promise<void> {
  await test("exact owner-selected single GGUF identity", () => { assert.equal(parseAyasLocalCodingModelManifest({ ...pins.model }), pins.model); });
  for (const update of [{ sha256: "0".repeat(64) }, { file: "alternate.gguf" }, { ref: "main" }, { license: "unknown" }, { sizeBytes: 1 }, { extra: true }]) {
    await test("alternate/mutable/forged model refused", () => { assert.throws(() => parseAyasLocalCodingModelManifest({ ...pins.model, ...update })); });
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-pin-smoke-"));
  try {
    const file = path.join(root, "artifact.bin"); fs.writeFileSync(file, "GGUF fixture");
    const pin = { sizeBytes: 12, sha256: digest("GGUF fixture") };
    await test("streaming exact local bytes only", async () => { assert.equal((await verifyAyasLocalCodingArtifact(file, pin)).status, "LOCAL_BYTES_VERIFIED_NOT_ADMITTED"); });
    await test("wrong digest refused", async () => { await assert.rejects(verifyAyasLocalCodingArtifact(file, { ...pin, sha256: "0".repeat(64) }), /SHA256/); });
    await test("wrong size refused", async () => { await assert.rejects(verifyAyasLocalCodingArtifact(file, { ...pin, sizeBytes: 1 }), /SIZE/); });
    await test("artifact verification cancellation", async () => { const cancel = new AbortController(); cancel.abort(); await assert.rejects(verifyAyasLocalCodingArtifact(file, pin, cancel.signal)); });
    await test("directory refused", async () => { await assert.rejects(verifyAyasLocalCodingArtifact(root, pin)); });
  } finally {
    assert.equal(path.dirname(root).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(root).startsWith("ayas-pin-smoke-")); fs.rmSync(root, { recursive: true });
  }
  const runtime = { engine: "podman", version: "5.7.1", binarySha256: "1".repeat(64), host: "windows", backend: "wsl2", wslVersion: "2.7.10.0" };
  await test("runtime structural claim is immutable", () => { assert.equal(Object.isFrozen(parseAyasLocalCodingRuntimeIdentity(runtime)), true); });
  await test("remote runtime and mutable version refused", () => { assert.throws(() => parseAyasLocalCodingRuntimeIdentity({ ...runtime, backend: "ssh" })); assert.throws(() => parseAyasLocalCodingRuntimeIdentity({ ...runtime, version: "latest" })); });
  const image = { Id: `sha256:${"2".repeat(64)}`, Os: "linux", Architecture: "amd64", Config: { User: "65534:65534", Labels: {
    "org.ayas.base.digest": pins.base.image.split("@")[1], "org.ayas.engine.commit": pins.engine.commit, "org.ayas.model.sha256": pins.model.sha256 } } };
  await test("image content/base/model/engine binding", () => { assert.equal(inspectAyasLocalCodingImageIdentity(image, image.Id), true); assert.equal(inspectAyasLocalCodingImageIdentity({ ...image, Architecture: "arm64" }, image.Id), false); });
  await test("image root/default volumes rejected", () => { assert.equal(inspectAyasLocalCodingImageIdentity({ ...image, Config: { ...image.Config, User: "0" } }, image.Id), false); assert.equal(inspectAyasLocalCodingImageIdentity({ ...image, Config: { ...image.Config, Volumes: { "/host": {} } } }, image.Id), false); });
  await test("prompt has bounded source only and no host vault metadata", () => {
    const request = JSON.stringify(buildAyasLocalCodingModelRequest(task, sources));
    for (const hidden of [task.baseHead, task.taskId, "fixHead", "evaluatorBlob", "HELD_OUT", "github.com", "modelManifest"]) assert.ok(!request.includes(hidden));
    assert.ok(request.includes(digest(sources[0]!.content))); assert.ok(!request.includes("API_KEY"));
    assert.throws(() => buildAyasLocalCodingModelRequest(task, [{ ...sources[0]!, evaluatorBlob: "secret" } as typeof sources[0]]));
  });
  await test("candidate is bounded in-memory only", () => { const result = parseAyasLocalCodingPatch(patch, task, sources); assert.equal(result.sources[0]!.content, "export const value = true;\n"); assert.equal(result.changedLines, 2); assert.equal(sources[0]!.content, "export const value = false;\n"); });
  for (const update of [{ path: "src/../secret.ts" }, { path: "scripts/evaluator.ts" }, { beforeSha256: "0".repeat(64) }, { replace: "false" }, { search: "missing" }, { replace: "\0" }, { command: "curl" }]) {
    await test("wrong/out-of-scope/tool candidate refused", () => { assert.throws(() => parseAyasLocalCodingPatch({ ...patch, edits: [{ ...patch.edits[0], ...update }] }, task, sources)); });
  }
  await test("ambiguous overlapping matches refused", () => { assert.throws(() => parseAyasLocalCodingPatch({ ...patch, edits: [{ ...patch.edits[0], beforeSha256: digest("aaa"), search: "aa", replace: "b" }] }, task, [{ path: "src/example.ts", content: "aaa" }])); });
  await test("line budget, duplicate edits and unknown patch fields refused", () => { assert.throws(() => parseAyasLocalCodingPatch(patch, { ...task, maxChangedLines: 1 }, sources)); assert.throws(() => parseAyasLocalCodingPatch({ ...patch, edits: [patch.edits[0], patch.edits[0]] }, task, sources)); assert.throws(() => parseAyasLocalCodingPatch({ ...patch, approval: true }, task, sources)); });
  await test("endpoint integration via synthetic transport, no readiness", async () => {
    const result = await diagnoseAyasLocalCodingModelWith({ ...input, transport: async (request) => { assert.equal(request.url, input.endpoint); assert.equal(request.maxResponseBytes, 256000); assert.equal(request.signal.aborted, false); return response(); } });
    assert.equal(result.status, "UNVERIFIED_HOST_DIAGNOSTIC"); assert.equal(result.peakRamBytes, null); assert.ok(result.elapsedMs >= 0);
  });
  await test("caller mutation cannot change captured source provenance", async () => {
    const mutable = sources.map((source) => ({ ...source }));
    const result = await diagnoseAyasLocalCodingModelWith({ ...input, sources: mutable, transport: async () => { mutable[0]!.content = "secret"; return response(); } });
    assert.equal(result.candidate.sources[0]!.content, "export const value = true;\n");
  });
  await test("non-loopback, DNS, credentials, query and cloud endpoint refused before transport", async () => {
    for (const endpoint of ["https://example.com/v1/chat/completions", "http://localhost:8080/v1/chat/completions", "http://token@127.0.0.1:8080/v1/chat/completions", `${input.endpoint}?key=secret`, "http://127.0.0.1:99999/v1/chat/completions"]) {
      let invoked = false; await assert.rejects(diagnoseAyasLocalCodingModelWith({ ...input, endpoint, transport: async () => { invoked = true; return response(); } })); assert.equal(invoked, false);
    }
  });
  await test("malformed/truncated/unbound/oversized output refused", async () => {
    for (const text of ["{", response().replace('"tool_calls"', '"length"'), response().replace('"submit_patch"', '"host_shell"'), response().replace('ayas-qwen2.5-coder-14b-q4-k-m', 'alternate'), "x".repeat(256001)]) {
      await assert.rejects(diagnoseAyasLocalCodingModelWith({ ...input, transport: async () => text }));
    }
  });
  await test("pre-cancelled run makes no transport call", async () => { const controller = new AbortController(); controller.abort(); let invoked = false; await assert.rejects(diagnoseAyasLocalCodingModelWith({ ...input, signal: controller.signal, transport: async () => { invoked = true; return response(); } }), /CANCELLED/); assert.equal(invoked, false); });
  await test("timeout aborts even an uncooperative transport", async () => { let signal: AbortSignal | undefined; await assert.rejects(diagnoseAyasLocalCodingModelWith({ ...input, timeoutMs: 10, transport: async (request) => { signal = request.signal; return new Promise<string>(() => {}); } }), /TIMEOUT/); assert.equal(signal?.aborted, true); });
  await test("in-flight cancellation aborts transport", async () => { const controller = new AbortController(); const result = diagnoseAyasLocalCodingModelWith({ ...input, signal: controller.signal, transport: async () => { controller.abort(); return new Promise<string>(() => {}); } }); await assert.rejects(result, /CANCELLED/); });
  await test("repeated requests retain identical seeds and no prior response context", async () => {
    const requests: string[] = []; const candidates: string[] = [];
    for (let repeat = 0; repeat < 3; repeat++) {
      const result = await diagnoseAyasLocalCodingModelWith({ ...input, transport: async (request) => { requests.push(request.body); return response(); } });
      candidates.push(result.candidate.candidateSha256);
      assert.equal(result.status, "UNVERIFIED_HOST_DIAGNOSTIC");
    }
    assert.equal(new Set(requests).size, 1); assert.equal(new Set(candidates).size, 1);
    assert.ok(!requests[1]!.includes("call_1"));
  });
  console.log(`Local coding pins/adapter: ${count}/${count} PASS; synthetic only, model runs 0.`);
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
