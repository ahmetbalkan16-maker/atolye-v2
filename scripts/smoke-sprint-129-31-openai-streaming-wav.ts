import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  AudioStorage,
  AudioWavValidationError,
} from "../src/lib/assets/storage/AudioStorage";
import { OpenAIAudioProvider } from "../src/lib/audio/providers/OpenAIAudioProvider";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { emitSmokeResult } from "./lib/SmokeResult";

const SIZE_SENTINEL = 0xffff_ffff;
const PRODUCTION_TOTAL_BYTES = 1_163_444;
const PRODUCTION_DATA_BYTES = 1_163_400;
const PRODUCTION_DURATION_SECONDS = 24.2375;
let scenarios = 0;

async function scenario(name: string, action: () => unknown | Promise<unknown>) {
  await action();
  scenarios += 1;
  if (process.env.SMOKE_TRACE === "1") process.stdout.write(`PASS ${scenarios}: ${name}\n`);
}

function formatBytes({
  format = 1,
  channels = 1,
  sampleRate = 24_000,
  bitsPerSample = 16,
  blockAlign = channels * (bitsPerSample / 8),
  byteRate = sampleRate * blockAlign,
}: {
  format?: number;
  channels?: number;
  sampleRate?: number;
  bitsPerSample?: number;
  blockAlign?: number;
  byteRate?: number;
} = {}) {
  const bytes = Buffer.alloc(16);
  bytes.writeUInt16LE(format, 0);
  bytes.writeUInt16LE(channels, 2);
  bytes.writeUInt32LE(sampleRate, 4);
  bytes.writeUInt32LE(byteRate, 8);
  bytes.writeUInt16LE(blockAlign, 12);
  bytes.writeUInt16LE(bitsPerSample, 14);
  return bytes;
}

function finiteChunk(id: string, bytes: Buffer) {
  const chunk = Buffer.alloc(8 + bytes.length + (bytes.length % 2));
  chunk.write(id, 0, "ascii");
  chunk.writeUInt32LE(bytes.length, 4);
  bytes.copy(chunk, 8);
  return chunk;
}

function finiteWav(dataBytes = 1600) {
  const body = Buffer.concat([
    finiteChunk("fmt ", formatBytes({ sampleRate: 8_000 })),
    finiteChunk("data", Buffer.alloc(dataBytes)),
  ]);
  const buffer = Buffer.alloc(12 + body.length);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVE", 8, "ascii");
  body.copy(buffer, 12);
  return buffer;
}

function sentinelWav({
  format = 1,
  channels = 1,
  sampleRate = 24_000,
  bitsPerSample = 16,
  dataBytes = PRODUCTION_DATA_BYTES,
  blockAlign = channels * (bitsPerSample / 8),
  byteRate = sampleRate * blockAlign,
}: {
  format?: number;
  channels?: number;
  sampleRate?: number;
  bitsPerSample?: number;
  dataBytes?: number;
  blockAlign?: number;
  byteRate?: number;
} = {}) {
  return sentinelChunkedWav([
    {
      id: "fmt ",
      bytes: formatBytes({
        format,
        channels,
        sampleRate,
        bitsPerSample,
        blockAlign,
        byteRate,
      }),
    },
  ], Buffer.alloc(dataBytes));
}

function sentinelChunkedWav(
  chunksBeforeData: Array<{ id: string; bytes: Buffer }>,
  data: Buffer,
) {
  const prefix = Buffer.concat(chunksBeforeData.map(({ id, bytes }) => finiteChunk(id, bytes)));
  const buffer = Buffer.alloc(12 + prefix.length + 8 + data.length);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(SIZE_SENTINEL, 4);
  buffer.write("WAVE", 8, "ascii");
  prefix.copy(buffer, 12);
  const dataOffset = 12 + prefix.length;
  buffer.write("data", dataOffset, "ascii");
  buffer.writeUInt32LE(SIZE_SENTINEL, dataOffset + 4);
  data.copy(buffer, dataOffset + 8);
  return buffer;
}

function assertInvalid(candidate: Buffer) {
  assert.throws(
    () => AudioStorage.inspectWav(candidate),
    (error) => error instanceof AudioWavValidationError,
  );
}

async function main() {
  const originalFetch = globalThis.fetch;
  const run = await withCanonicalSmokeRuntime({
    name: "sprint-129-31-openai-streaming-wav",
    operationType: "audio-streaming-wav-test",
    environment: {
      AUDIO_PROVIDER: "openai",
      OPENAI_API_KEY: "mock-key-never-sent",
      OPENAI_TTS_MODEL: "tts-1",
      OPENAI_TTS_VOICE: "alloy",
      OPENAI_TTS_MAX_RESPONSE_BYTES: "2000000",
    },
  }, async (runtime) => {
    runtime.deferRestore(() => { globalThis.fetch = originalFetch; });
    await scenario("ordinary finite WAV remains accepted", () => {
      assert.deepEqual(AudioStorage.inspectWav(finiteWav()), {
        byteLength: 1644,
        durationSeconds: 0.1,
      });
    });

    await scenario("paired production-sized sentinel uses actual data length", () => {
      const candidate = sentinelWav();
      assert.equal(candidate.length, PRODUCTION_TOTAL_BYTES);
      assert.deepEqual(AudioStorage.inspectWav(candidate), {
        byteLength: PRODUCTION_TOTAL_BYTES,
        durationSeconds: PRODUCTION_DURATION_SECONDS,
      });
    });

    await scenario("chunk-like PCM suffix remains valid audio data", () => {
      const candidate = sentinelWav();
      const chunkLikePcm = finiteChunk("JUNK", Buffer.from("LISTdatafmt "));
      chunkLikePcm.copy(candidate, candidate.length - chunkLikePcm.length);
      assert.deepEqual(AudioStorage.inspectWav(candidate), {
        byteLength: PRODUCTION_TOTAL_BYTES,
        durationSeconds: PRODUCTION_DURATION_SECONDS,
      });
    });

    await scenario("mixed sentinel pairs fail closed", () => {
      const riffSentinelFiniteData = sentinelWav({ dataBytes: 1600 });
      riffSentinelFiniteData.writeUInt32LE(1600, 40);
      const finiteRiffDataSentinel = sentinelWav({ dataBytes: 1600 });
      finiteRiffDataSentinel.writeUInt32LE(finiteRiffDataSentinel.length - 8, 4);
      assertInvalid(riffSentinelFiniteData);
      assertInvalid(finiteRiffDataSentinel);
    });

    await scenario("sentinel ordering duplicates and ancillary sentinel fail closed", () => {
      const fmt = formatBytes();
      const data = Buffer.alloc(1600);
      assertInvalid(sentinelChunkedWav([], Buffer.concat([finiteChunk("fmt ", fmt), data])));
      assertInvalid(sentinelChunkedWav([
        { id: "fmt ", bytes: fmt },
        { id: "fmt ", bytes: fmt },
      ], data));
      assertInvalid(sentinelChunkedWav([
        { id: "fmt ", bytes: fmt },
        { id: "data", bytes: Buffer.alloc(2) },
      ], data));

      const ancillarySentinel = Buffer.alloc(20);
      ancillarySentinel.write("RIFF", 0, "ascii");
      ancillarySentinel.writeUInt32LE(SIZE_SENTINEL, 4);
      ancillarySentinel.write("WAVE", 8, "ascii");
      ancillarySentinel.write("JUNK", 12, "ascii");
      ancillarySentinel.writeUInt32LE(SIZE_SENTINEL, 16);
      assertInvalid(ancillarySentinel);
    });

    await scenario("sentinel format and frame invariants remain exact", () => {
      for (const candidate of [
        sentinelWav({ format: 6, dataBytes: 1600 }),
        sentinelWav({ format: 3, bitsPerSample: 16, dataBytes: 1600 }),
        sentinelWav({ channels: 3, dataBytes: 2400 }),
        sentinelWav({ sampleRate: 7999, dataBytes: 1600 }),
        sentinelWav({ bitsPerSample: 40, dataBytes: 2000 }),
        sentinelWav({ blockAlign: 4, dataBytes: 1600 }),
        sentinelWav({ byteRate: 48_001, dataBytes: 1600 }),
        sentinelWav({ dataBytes: 0 }),
        sentinelWav({ dataBytes: 1599 }),
      ]) assertInvalid(candidate);
    });

    await scenario("truncated fmt and data headers fail closed", () => {
      const truncatedFmt = Buffer.alloc(30);
      truncatedFmt.write("RIFF", 0, "ascii");
      truncatedFmt.writeUInt32LE(SIZE_SENTINEL, 4);
      truncatedFmt.write("WAVE", 8, "ascii");
      truncatedFmt.write("fmt ", 12, "ascii");
      truncatedFmt.writeUInt32LE(16, 16);
      assertInvalid(truncatedFmt);
      assertInvalid(sentinelChunkedWav([
        { id: "fmt ", bytes: formatBytes() },
      ], Buffer.alloc(2)).subarray(0, -6));
    });

    await scenario("maximum byte and duration limits remain enforced", () => {
      assertInvalid(Buffer.allocUnsafe(256 * 1024 * 1024 + 1));
      const excessiveDuration = sentinelWav({
        sampleRate: 8_000,
        bitsPerSample: 8,
        dataBytes: 8_000 * 4 * 60 * 60 + 1,
      });
      assertInvalid(excessiveDuration);
    });

    await scenario("rejected sentinel bodies remain write-free and safely normalized", async () => {
      const slug = "sprint-129-31-rejected-sentinel";
      const malformed = sentinelWav({ dataBytes: 1599 });
      globalThis.fetch = async () => new Response(new Uint8Array(malformed), {
        status: 200,
        headers: { "Content-Type": "audio/wav" },
      });
      const result = await new OpenAIAudioProvider().generateAudio({
        projectSlug: slug,
        sourceText: "Bounded fixture narration.",
        target: { kind: "section", chapterId: 1 },
      });
      assert.equal(result.success, false);
      assert.equal(result.evidence?.rootCode, "AUDIO_WAV_INVALID");
      assert.equal(fs.existsSync(path.join(runtime.runtimeStorageContext.projectsRoot, slug)), false);
      assert.doesNotMatch(
        JSON.stringify(result),
        /JUNK|LIST|datafmt|Bounded fixture narration|API_KEY|provider.?payload/i,
      );
    });
  });
  assert.equal(run.finalization.cleanupCompleted, true);
  assert.equal(run.finalization.runtimeRemainder, 0);
  assert.equal(run.finalization.authorityRemainder, 0);
  emitSmokeResult("sprint-129-31-openai-streaming-wav", scenarios);
}

void main().catch((error) => {
  process.stderr.write(`Sprint 129.31 streaming WAV smoke FAILED: ${
    error instanceof Error ? error.stack ?? error.message : "unknown"
  }\n`);
  process.exitCode = 1;
});
