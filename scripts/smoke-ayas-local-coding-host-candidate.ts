import assert from "node:assert/strict";
import crypto from "node:crypto";

import { buildAyasLocalCodingModelRequest, diagnoseAyasLocalCodingModelWith } from "../src/lib/brain/autonomy/AyasLocalCodingModelAdapter";
import { ayasLocalCodingCandidatePins, ayasLocalCodingHostCandidatePins, parseAyasLocalCodingModelManifest, resolveAyasLocalCodingServedModel } from "../src/lib/brain/autonomy/AyasLocalCodingPins";
import type { AyasLocalCodingTaskContract } from "../src/lib/brain/autonomy/AyasLocalCodingTaskContract";

// Synthetic only: no engine, network or model run.
const task: AyasLocalCodingTaskContract = { schemaVersion: "1", taskId: "ayas-coding-11111111-2222-3333-4444-555555555555",
  baseHead: "a".repeat(40), objective: "Repair the bounded example expression.", exactFiles: ["src/example.ts"], maxChangedLines: 80 };
const sources = [{ path: "src/example.ts", content: "export const value = false;\n" }];
const patch = { schemaVersion: "1", edits: [{ path: "src/example.ts", beforeSha256: crypto.createHash("sha256").update(sources[0]!.content).digest("hex"),
  search: "false", replace: "true" }] };
const response = (model: string): string => JSON.stringify({ model, choices: [{ index: 0, finish_reason: "stop",
  message: { role: "assistant", content: JSON.stringify(patch) } }] });
const host = ayasLocalCodingHostCandidatePins.model;
const container = ayasLocalCodingCandidatePins.model;
const base = { task, sources, endpoint: "http://127.0.0.1:11434/v1/chat/completions", timeoutMs: 60_000 };
let scenarios = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> { await fn(); scenarios += 1; void name; }

async function main(): Promise<void> {
  await test("pins are frozen and the host candidate is the owner-selected model", () => {
    assert.ok(Object.isFrozen(ayasLocalCodingHostCandidatePins) && Object.isFrozen(host) && Object.isFrozen(ayasLocalCodingHostCandidatePins.engine), "assert.ok(Object.isFrozen(ayasLocalCodingHostCandidatePins) && Object.isFrozen(host) && Object.isFrozen(ayasLocalCodingHostCandidatePins.engine))");
    assert.equal(host.servedModel, "qwen3-coder:30b", "assert.equal(host.servedModel, \"qwen3-coder:30b\")"); assert.match(host.manifestDigest, /^sha256:[a-f0-9]{64}$/); assert.match(host.weightsSha256, /^[a-f0-9]{64}$/);
    assert.equal(ayasLocalCodingHostCandidatePins.engine.name, "ollama", "assert.equal(ayasLocalCodingHostCandidatePins.engine.name, \"ollama\")");
  });
  await test("served identity resolves for exactly the two pinned candidates", () => {
    assert.deepEqual(resolveAyasLocalCodingServedModel(container), { servedModel: "ayas-qwen2.5-coder-14b-q4-k-m", modelDigest: container.sha256 }, "assert.deepEqual(resolveAyasLocalCodingServedModel(container), { servedModel: \"ayas-qwen2.5-coder-14b-q4-k-m\", modelDigest: container.sha256 })");
    assert.deepEqual(resolveAyasLocalCodingServedModel(host), { servedModel: "qwen3-coder:30b", modelDigest: host.weightsSha256 }, "assert.deepEqual(resolveAyasLocalCodingServedModel(host), { servedModel: \"qwen3-coder:30b\", modelDigest: host.weightsSha256 })");
    for (const forged of [{ ...host, servedModel: "qwen3-coder:480b" }, { ...host, weightsSha256: "b".repeat(64) }, { ...host, extra: 1 },
      { ...container, sha256: "c".repeat(64) }, null, "qwen3-coder:30b"]) assert.throws(() => resolveAyasLocalCodingServedModel(forged), /MODEL_MANIFEST_MISMATCH/);
  });
  await test("the original container manifest parser still refuses the host candidate", () => {
    assert.equal(parseAyasLocalCodingModelManifest(container), container, "assert.equal(parseAyasLocalCodingModelManifest(container), container)");
    assert.throws(() => parseAyasLocalCodingModelManifest(host), /MODEL_MANIFEST_MISMATCH/);
  });
  await test("request default identity is unchanged; only pinned served names are accepted", () => {
    assert.equal(buildAyasLocalCodingModelRequest(task, sources).model, "ayas-qwen2.5-coder-14b-q4-k-m", "assert.equal(buildAyasLocalCodingModelRequest(task, sources).model, \"ayas-qwen2.5-coder-14b-q4-k-m\")");
    assert.equal(buildAyasLocalCodingModelRequest(task, sources, "qwen3-coder:30b").model, "qwen3-coder:30b", "assert.equal(buildAyasLocalCodingModelRequest(task, sources, \"qwen3-coder:30b\").model, \"qwen3-coder:30b\")");
    assert.throws(() => buildAyasLocalCodingModelRequest(task, sources, "gpt-5"), /MODEL_IDENTITY_INVALID/);
  });
  await test("host candidate: request names it and an answer with its identity is accepted", async () => {
    let sent = "";
    const result = await diagnoseAyasLocalCodingModelWith({ ...base, modelManifest: host, transport: async (request) => { sent = request.body; return response("qwen3-coder:30b"); } });
    assert.equal(JSON.parse(sent).model, "qwen3-coder:30b", "assert.equal(JSON.parse(sent).model, \"qwen3-coder:30b\")"); assert.equal(result.modelDigest, host.weightsSha256, "assert.equal(result.modelDigest, host.weightsSha256)");
    assert.equal(result.candidate.sources[0]!.content, "export const value = true;\n", "assert.equal(result.candidate.sources[0]!.content, \"export const value = true;\\n\")"); assert.equal(result.status, "UNVERIFIED_HOST_DIAGNOSTIC", "assert.equal(result.status, \"UNVERIFIED_HOST_DIAGNOSTIC\")");
  });
  await test("an answer from a different model identity is refused in both directions", async () => {
    await assert.rejects(diagnoseAyasLocalCodingModelWith({ ...base, modelManifest: host, transport: async () => response("ayas-qwen2.5-coder-14b-q4-k-m") }), /IDENTITY_OR_CHOICES_INVALID/);
    await assert.rejects(diagnoseAyasLocalCodingModelWith({ ...base, modelManifest: container, transport: async () => response("qwen3-coder:30b") }), /IDENTITY_OR_CHOICES_INVALID/);
  });
  await test("a forged manifest is refused before any transport call", async () => {
    let invoked = false;
    await assert.rejects(diagnoseAyasLocalCodingModelWith({ ...base, modelManifest: { ...host, servedModel: "x" }, transport: async () => { invoked = true; return response("x"); } }), /MODEL_MANIFEST_MISMATCH/);
    assert.equal(invoked, false, "assert.equal(invoked, false)");
  });
  await test("a tool call from the host candidate is still refused", async () => {
    const withTool = JSON.stringify({ model: "qwen3-coder:30b", choices: [{ index: 0, finish_reason: "stop",
      message: { role: "assistant", content: JSON.stringify(patch), tool_calls: [{ function: { name: "shell" } }] } }] });
    await assert.rejects(diagnoseAyasLocalCodingModelWith({ ...base, modelManifest: host, transport: async () => withTool }), /MODEL_OUTPUT_INVALID/);
  });
  console.log(`Local coding host candidate: ${scenarios}/${scenarios} PASS; synthetic only, model runs 0.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
