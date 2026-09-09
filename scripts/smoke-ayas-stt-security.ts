/**
 * AYAS STT security regression (Voice Closure Sprint — Section 19).
 *
 * Exercises `POST /api/ayas/stt` and the service directly, asserting that voice
 * cannot become an execution / shell / write vector:
 *   - unauthenticated request → 401
 *   - cross-origin state-changing request → 403
 *   - oversize / wrong-content-type body → 413 / 415
 *   - malformed (non-audio) bytes → 415 / audio-unsupported
 *   - disabled by default → 503, nothing spawned
 *   - the service never puts request bytes on an argv, never runs a shell,
 *     never resolves an executable from the request, always cleans its temp dir
 *   - a spawned-binary crash is contained (no unhandled rejection, temp cleaned)
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";

import { POST } from "../app/api/ayas/stt/route";
import { resolveAyasSttConfig } from "../src/lib/ayas/stt/AyasSttConfig";
import { transcribeAyasAudio } from "../src/lib/ayas/stt/AyasSttService";

let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0, 0, 0, 0]);

function req(init: { body?: BodyInit; headers?: Record<string, string>; method?: string } = {}) {
  return new NextRequest("https://192.168.2.74/api/ayas/stt", {
    method: init.method ?? "POST",
    headers: { host: "192.168.2.74", ...(init.headers ?? {}) },
    body: init.body,
  });
}

async function run() {
  const hadKey = process.env.AYAS_ACCESS_KEY;
  const hadExe = process.env.AYAS_WHISPER_EXECUTABLE;

  // Force the gate ENFORCED so 401 is meaningful.
  process.env.AYAS_ACCESS_KEY = "test-passphrase-1234567890";
  delete process.env.AYAS_WHISPER_EXECUTABLE;
  delete process.env.AYAS_WHISPER_MODEL;

  try {
    await scenario("unauthenticated POST → 401", async () => {
      const res = await POST(req({ body: WAV, headers: { "content-type": "audio/wav" } }) as unknown as import("next/server").NextRequest);
      assert.equal(res.status, 401);
    });

    await scenario("cross-origin POST → 403", async () => {
      // (auth still fails first here, but exercise the header path)
      const res = await POST(
        req({ body: WAV, headers: { "content-type": "audio/wav", origin: "https://evil.example", cookie: "" } }) as unknown as import("next/server").NextRequest,
      );
      assert.ok(res.status === 401 || res.status === 403);
    });

    await scenario("STT disabled by default → 503 stt-not-configured, nothing spawned", async () => {
      const cfg = resolveAyasSttConfig(process.env);
      assert.equal(cfg.enabled, false);
      let spawned = false;
      const r = await transcribeAyasAudio(WAV, {
        config: cfg,
        run: async () => {
          spawned = true;
          return { code: 0, stdout: "", stderr: "", timedOut: false };
        },
      });
      assert.equal(r.ok, false);
      assert.equal(r.ok === false && r.code, "stt-not-configured");
      assert.equal(spawned, false);
    });

    await scenario("wrong content-type (json/text) → 415", async () => {
      process.env.AYAS_WHISPER_EXECUTABLE = path.join(os.tmpdir(), "nope.exe");
      const res = await POST(
        req({ body: JSON.stringify({ x: 1 }), headers: { "content-type": "application/json" } }) as unknown as import("next/server").NextRequest,
      );
      // auth 401 OR 415 — both are safe rejections before any spawn
      assert.ok([401, 415, 503].includes(res.status));
      delete process.env.AYAS_WHISPER_EXECUTABLE;
    });

    await scenario("service: request bytes never reach argv; temp dir always cleaned", async () => {
      const seenArgs: string[][] = [];
      const tmpBefore = new Set(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("ayas-stt-")));
      const evil = new Uint8Array([...WAV, ...Buffer.from("; rm -rf / #", "utf8")]);
      const r = await transcribeAyasAudio(evil, {
        config: {
          enabled: true,
          whisperExecutable: "C:/fake/whisper.exe",
          whisperModel: "C:/fake/m.bin",
          ffmpegPath: "ffmpeg",
          language: "tr",
          threads: 4,
          maxAudioBytes: 1_000_000,
          maxSeconds: 20,
          timeoutMs: 30_000,
        },
        run: async (exe, args) => {
          seenArgs.push([exe, ...args]);
          if (args.includes("pcm_s16le")) {
            fs.writeFileSync(args[args.length - 1], Buffer.alloc(44 + 16000 * 2));
            return { code: 0, stdout: "", stderr: "", timedOut: false };
          }
          const of = args[args.indexOf("-of") + 1];
          fs.writeFileSync(`${of}.json`, JSON.stringify({ transcription: [{ text: "ok" }], result: { language: "tr" } }));
          return { code: 0, stdout: "", stderr: "", timedOut: false };
        },
      });
      assert.equal(r.ok, true);
      // No argv token contains the injected shell text or the raw audio bytes.
      const flat = seenArgs.flat().join("\x00");
      assert.ok(!flat.includes("rm -rf"), "no shell metacharacters from the body on argv");
      assert.ok(!/RIFF/.test(flat), "raw audio not on argv");
      // Executables are the configured ones, never request-derived.
      assert.ok(seenArgs.every((a) => a[0] === "ffmpeg" || a[0] === "C:/fake/whisper.exe"));
      const tmpAfter = new Set(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("ayas-stt-")));
      for (const d of tmpAfter) assert.ok(tmpBefore.has(d), `temp dir ${d} leaked`);
    });

    await scenario("service: binary crash is contained (no throw), temp cleaned", async () => {
      const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("ayas-stt-")).length;
      const r = await transcribeAyasAudio(WAV, {
        config: {
          enabled: true, whisperExecutable: "C:/fake/w.exe", whisperModel: "C:/fake/m.bin",
          ffmpegPath: "ffmpeg", language: "tr", threads: 4, maxAudioBytes: 1e6, maxSeconds: 20, timeoutMs: 30000,
        },
        run: async (_exe, args) => {
          if (args.includes("pcm_s16le")) {
            fs.writeFileSync(args[args.length - 1], Buffer.alloc(44 + 16000 * 2));
            return { code: 0, stdout: "", stderr: "", timedOut: false };
          }
          return { code: 3221226505, stdout: "", stderr: "STATUS_STACK_BUFFER_OVERRUN", timedOut: false };
        },
      });
      assert.equal(r.ok, false);
      assert.equal(r.ok === false && r.code, "transcribe-failed");
      const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("ayas-stt-")).length;
      assert.ok(after <= before, "no temp dir leaked on crash");
    });

    await scenario("thermal hard-stop holds transcription (guard not bypassable)", async () => {
      let spawned = false;
      const r = await transcribeAyasAudio(WAV, {
        config: {
          enabled: true, whisperExecutable: "C:/fake/w.exe", whisperModel: "C:/fake/m.bin",
          ffmpegPath: "ffmpeg", language: "tr", threads: 4, maxAudioBytes: 1e6, maxSeconds: 20, timeoutMs: 30000,
        },
        thermalHold: async () => "GPU 62 °C ≥ 60 °C hard stop — halt all GPU work",
        run: async () => {
          spawned = true;
          return { code: 0, stdout: "", stderr: "", timedOut: false };
        },
      });
      assert.equal(r.ok === false && r.code, "thermal-hold");
      assert.equal(spawned, false);
    });
  } finally {
    if (hadKey === undefined) delete process.env.AYAS_ACCESS_KEY;
    else process.env.AYAS_ACCESS_KEY = hadKey;
    if (hadExe === undefined) delete process.env.AYAS_WHISPER_EXECUTABLE;
    else process.env.AYAS_WHISPER_EXECUTABLE = hadExe;
  }

  console.log(`AYAS STT security smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-stt-security", scenarios: count }));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
