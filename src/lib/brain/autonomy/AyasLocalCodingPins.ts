import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Owner-selected candidates, not installed binaries, containment evidence or execution permits. */
export const ayasLocalCodingCandidatePins = Object.freeze({
  engine: Object.freeze({
    repository: "https://github.com/ggml-org/llama.cpp", release: "v0.5.0",
    tagObject: "c13fcbf684171d5e0bca3fc5c34be6a99174b05f",
    commit: "7fe450e19305b828c199d602c23a8337aaa1f03b", binaryRelease: "b11146",
    windowsArchive: Object.freeze({
      url: "https://github.com/ggml-org/llama.cpp/releases/download/b11146/llama-b11146-bin-win-cpu-x64.zip",
      sizeBytes: 18_560_055, sha256: "14cf1303ca9ac3abd94816850532f9f9a69ac66fbaca3776fc6f9061c2fac1d1",
    }),
    linuxArchive: Object.freeze({
      url: "https://github.com/ggml-org/llama.cpp/releases/download/b11146/llama-b11146-bin-ubuntu-x64.tar.gz",
      sizeBytes: 16_998_357, sha256: "c150306eb16b5ab696f76a8bdf810c35fd98a24e82158742e6fa28f420ff8410",
    }),
  }),
  model: Object.freeze({
    repository: "Qwen/Qwen2.5-Coder-14B-Instruct-GGUF",
    ref: "d0a692ef765eefbf2fabb130b3cb2e8917e3d225",
    file: "qwen2.5-coder-14b-instruct-q4_k_m.gguf", quantization: "Q4_K_M", license: "apache-2.0",
    sizeBytes: 8_988_110_272, sha256: "c1e659736d89ac1065fb495330fb824d94001974a4bfa78e7270e43476a8d940",
    url: "https://huggingface.co/Qwen/Qwen2.5-Coder-14B-Instruct-GGUF/resolve/d0a692ef765eefbf2fabb130b3cb2e8917e3d225/qwen2.5-coder-14b-instruct-q4_k_m.gguf",
  }),
  base: Object.freeze({
    image: "docker.io/library/node@sha256:d45d78e7929b46875bbd4e29bea672d5bc48186c6c3588306521c815e78352d6",
    indexDigest: "sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d",
    platform: "linux/amd64", version: "24.18.0-bookworm-slim",
  }),
});

export class AyasLocalCodingPinError extends Error {
  constructor(reason: string) { super(reason); this.name = "AyasLocalCodingPinError"; }
}

function exact(value: unknown, expected: object): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const keys = Object.keys(expected);
  return Object.keys(item).length === keys.length
    && keys.every((key) => item[key] === (expected as Record<string, unknown>)[key]);
}

/** Accept only the selected single-file model identity; split GGUFs and alternate models are refused. */
export function parseAyasLocalCodingModelManifest(value: unknown): typeof ayasLocalCodingCandidatePins.model {
  if (!exact(value, ayasLocalCodingCandidatePins.model)) throw new AyasLocalCodingPinError("MODEL_MANIFEST_MISMATCH");
  return ayasLocalCodingCandidatePins.model;
}

export interface AyasLocalCodingArtifactPin { readonly sha256: string; readonly sizeBytes: number }

/** Streaming byte verification only. Never extracts, installs, runs, downloads or activates an artifact. */
export async function verifyAyasLocalCodingArtifact(file: string, pin: AyasLocalCodingArtifactPin, signal?: AbortSignal): Promise<{
  readonly status: "LOCAL_BYTES_VERIFIED_NOT_ADMITTED"; readonly sha256: string; readonly sizeBytes: number;
}> {
  const expectedSha256 = pin.sha256;
  const expectedSize = pin.sizeBytes;
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || !Number.isSafeInteger(expectedSize) || expectedSize < 1
    || expectedSize > 20_000_000_000 || !path.isAbsolute(file)) throw new AyasLocalCodingPinError("INVALID_ARTIFACT_PIN");
  signal?.throwIfAborted();
  const absolute = path.resolve(file);
  const samePath = (a: string, b: string): boolean => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (!samePath(fs.realpathSync(absolute), absolute)) throw new AyasLocalCodingPinError("ARTIFACT_LINK_REFUSED");
  const before = fs.lstatSync(absolute);
  if (!before.isFile() || before.isSymbolicLink() || before.size !== expectedSize) throw new AyasLocalCodingPinError("ARTIFACT_SIZE_OR_TYPE_MISMATCH");
  const handle = await fs.promises.open(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw new AyasLocalCodingPinError("ARTIFACT_CHANGED");
    const hash = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let sizeBytes = 0;
    for (;;) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      signal?.throwIfAborted();
      if (bytesRead === 0) break;
      sizeBytes += bytesRead;
      if (sizeBytes > expectedSize) throw new AyasLocalCodingPinError("ARTIFACT_CHANGED");
      hash.update(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    const current = fs.lstatSync(absolute);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
      || current.isSymbolicLink() || current.dev !== before.dev || current.ino !== before.ino
      || !samePath(fs.realpathSync(absolute), absolute)) throw new AyasLocalCodingPinError("ARTIFACT_CHANGED");
    const sha256 = hash.digest("hex");
    if (sha256 !== expectedSha256 || sizeBytes !== expectedSize) throw new AyasLocalCodingPinError("ARTIFACT_SHA256_MISMATCH");
    return Object.freeze({ status: "LOCAL_BYTES_VERIFIED_NOT_ADMITTED", sha256, sizeBytes });
  } finally { await handle.close(); }
}

/** Structural claims only, to be checked again against an actual locally pinned engine. */
export function parseAyasLocalCodingRuntimeIdentity(value: unknown): Readonly<{
  engine: "podman"; version: string; binarySha256: string; host: "windows"; backend: "wsl2"; wslVersion: string;
}> {
  const keys = ["backend", "binarySha256", "engine", "host", "version", "wslVersion"];
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("|") !== keys.join("|")) throw new AyasLocalCodingPinError("RUNTIME_IDENTITY_INVALID");
  const item = value as Record<string, unknown>;
  if (item.engine !== "podman" || item.host !== "windows" || item.backend !== "wsl2"
    || typeof item.binarySha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.binarySha256)
    || typeof item.version !== "string" || !/^\d+\.\d+\.\d+$/.test(item.version)
    || typeof item.wslVersion !== "string" || !/^2\.\d+\.\d+\.\d+$/.test(item.wslVersion)) throw new AyasLocalCodingPinError("RUNTIME_IDENTITY_INVALID");
  return Object.freeze({ ...item }) as ReturnType<typeof parseAyasLocalCodingRuntimeIdentity>;
}

/** Base tag claims cannot substitute for the pinned platform manifest or final local content ID. */
export function inspectAyasLocalCodingImageIdentity(value: unknown, expectedContentId: string): boolean {
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedContentId) || !value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const config = item.Config as Record<string, unknown> | undefined;
  const labels = config?.Labels as Record<string, unknown> | undefined;
  return item.Id === expectedContentId && item.Os === "linux" && item.Architecture === "amd64"
    && config?.User === "65534:65534" && !config?.Volumes && !config?.ExposedPorts
    && labels?.["org.ayas.base.digest"] === ayasLocalCodingCandidatePins.base.image.split("@")[1]
    && labels?.["org.ayas.engine.commit"] === ayasLocalCodingCandidatePins.engine.commit
    && labels?.["org.ayas.model.sha256"] === ayasLocalCodingCandidatePins.model.sha256;
}
