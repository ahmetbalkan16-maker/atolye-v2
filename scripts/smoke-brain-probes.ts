/**
 * Atölye Brain — read-only probe smoke suite (Sprint 181, PHASE 5 + 6).
 *
 * Deterministic / $0 / no network. Hermetic by default: every nvidia-smi and
 * ffprobe call is an injected fake. If a real `nvidia-smi` / `ffprobe` + a real
 * MP4 are present, two extra scenarios do ONE read-only live call each (a
 * telemetry query / a metadata read — nothing is changed, encoded or rendered).
 *
 *  A. nvidia-smi CSV parsing — normal / [N/A] / [Not Supported] / off-the-bus.
 *  B. probeBrainResources — measured vs unavailable; never throws.
 *  C. A2000 60 °C hard stop — trips at/above 60, not below, honest on unknown.
 *  D. ffprobe JSON parsing — av / video-only / malformed / no-format.
 *  E. probeMediaFile — missing file, injected success.
 *  F. buildBrainFinalRenderReport → evaluateBrainQuality (end to end, pure).
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  parseNvidiaSmiCsv,
  probeBrainResources,
  evaluateBrainResourceHardStop,
  BRAIN_A2000_GPU_HARD_STOP_C,
  parseFfprobeJson,
  probeMediaFile,
  buildBrainFinalRenderReport,
  evaluateBrainQuality,
  DEFAULT_BRAIN_HARDWARE_PROFILES,
} from "../src/lib/brain";
import type { FfprobeMediaSummary } from "../src/lib/brain";

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

/* ---- fixtures (captured from real tools on this repo's MP4s) ---- */

const NVSMI_OK = "44, 19, 14.53, 752, 12282\n";
const NVSMI_MULTI = "61, 80, 68.0, 9000, 12282\n40, 5, 12.0, 500, 12282\n";
const NVSMI_NA = "[N/A], [N/A], [N/A], [N/A], [N/A]\n";
const NVSMI_PARTIAL = "55, [Not Supported], [Not Supported], 1024, 12282\n";
const NVSMI_OFF_BUS = "Unable to determine the device handle for GPU0000:01:00.0: GPU has fallen off the bus.\n";

const FFPROBE_AV = JSON.stringify({
  streams: [
    { codec_name: "h264", codec_type: "video", width: 1920, height: 1080, r_frame_rate: "30/1", avg_frame_rate: "30/1" },
    { codec_name: "aac", codec_type: "audio", sample_rate: "48000", channels: 2, r_frame_rate: "0/0", avg_frame_rate: "0/0" },
  ],
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "89.733333", size: "6970219", bit_rate: "621416" },
});
const FFPROBE_VIDEO_ONLY = JSON.stringify({
  streams: [{ codec_name: "h264", codec_type: "video", width: 1920, height: 1080, r_frame_rate: "30/1", avg_frame_rate: "30/1" }],
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "71.000000", size: "4108365", bit_rate: "462914" },
});
const FFPROBE_NDJSON_NO_FORMAT = JSON.stringify({ streams: [{ codec_type: "video", codec_name: "h264" }] });

function realTool(bin: string, versionFlag: string): string | undefined {
  try {
    execFileSync(bin, [versionFlag], { stdio: "ignore", timeout: 5_000 });
    return bin;
  } catch {
    return undefined;
  }
}

function firstRealMp4(): string | undefined {
  const dir = path.resolve(__dirname, "..", "data", "e2e-output");
  if (!fs.existsSync(dir)) return undefined;
  const found = fs.readdirSync(dir).filter((f) => f.endsWith(".mp4")).sort();
  return found[0] ? path.join(dir, found[0]) : undefined;
}

async function run() {
  /* ------------------------- A. nvidia-smi parsing --------------------- */

  await scenario("A1. normal CSV row parses temp / util / power / vram", () => {
    const r = parseNvidiaSmiCsv(NVSMI_OK);
    assert.equal(r.anyFieldParsed, true);
    assert.equal(r.gpuTempC, 44);
    assert.equal(r.gpuUtilizationPct, 19);
    assert.equal(r.gpuPowerW, 14.53);
    assert.equal(r.vramTotalGb, 12); // 12282 MiB → 12.0
    assert.ok((r.vramUsedGb ?? 0) > 0 && (r.vramUsedGb ?? 0) < 1);
    assert.deepEqual(r.abnormalSignals, []);
  });

  await scenario("A2. multi-GPU dump uses the first row", () => {
    const r = parseNvidiaSmiCsv(NVSMI_MULTI);
    assert.equal(r.gpuTempC, 61);
    assert.equal(r.gpuUtilizationPct, 80);
  });

  await scenario("A3. [N/A] everywhere → nothing parsed", () => {
    const r = parseNvidiaSmiCsv(NVSMI_NA);
    assert.equal(r.anyFieldParsed, false);
    assert.equal(r.gpuTempC, undefined);
  });

  await scenario("A4. partial [Not Supported] still yields the readable fields", () => {
    const r = parseNvidiaSmiCsv(NVSMI_PARTIAL);
    assert.equal(r.gpuTempC, 55);
    assert.equal(r.gpuUtilizationPct, undefined);
    assert.equal(r.vramUsedGb, 1); // 1024 MiB
  });

  await scenario("A5. 'fallen off the bus' → abnormal signal", () => {
    const r = parseNvidiaSmiCsv(NVSMI_OFF_BUS);
    assert.equal(r.anyFieldParsed, false);
    assert.ok(r.abnormalSignals.includes("gpu-fallen-off-bus"));
  });

  /* ----------------------- B. probeBrainResources --------------------- */

  await scenario("B1. injected good telemetry → source 'measured' with fields", async () => {
    const snap = await probeBrainResources({
      now: () => new Date("2026-09-08T00:00:00.000Z"),
      runNvidiaSmi: async () => NVSMI_OK,
      readHostMemory: () => ({ usedGb: 12, totalGb: 32 }),
    });
    assert.equal(snap.source, "measured");
    assert.equal(snap.gpuTempC, 44);
    assert.equal(snap.ramTotalGb, 32);
    assert.equal(snap.activeInference, false); // 19% < 25%
  });

  await scenario("B2. nvidia-smi throwing → source 'unavailable', never throws", async () => {
    const snap = await probeBrainResources({
      now: () => new Date("2026-09-08T00:00:00.000Z"),
      runNvidiaSmi: async () => { throw new Error("ENOENT nvidia-smi"); },
      readHostMemory: () => ({ usedGb: 10, totalGb: 32 }),
    });
    assert.equal(snap.source, "unavailable");
    assert.equal(snap.gpuTempC, undefined);
    assert.equal(snap.ramTotalGb, 32, "RAM still reported, but GPU-unknown ⇒ unavailable");
  });

  await scenario("B3. all-[N/A] telemetry → 'unavailable' ('no info' is NOT 'safe')", async () => {
    const snap = await probeBrainResources({ runNvidiaSmi: async () => NVSMI_NA, readHostMemory: () => undefined });
    assert.equal(snap.source, "unavailable");
  });

  await scenario("B4. off-the-bus signal survives into the snapshot", async () => {
    const snap = await probeBrainResources({ runNvidiaSmi: async () => NVSMI_OFF_BUS, readHostMemory: () => undefined });
    assert.equal(snap.source, "unavailable");
    assert.ok((snap.abnormalSignals ?? []).includes("gpu-fallen-off-bus"));
  });

  /* --------------------- C. A2000 60 °C hard stop --------------------- */

  await scenario("C1. A2000 at / above 60 °C trips the hard stop", () => {
    const a2000 = DEFAULT_BRAIN_HARDWARE_PROFILES["rtx-a2000-12gb"];
    assert.equal(BRAIN_A2000_GPU_HARD_STOP_C, 60);
    assert.equal(evaluateBrainResourceHardStop({ observedAt: "x", source: "measured", gpuTempC: 60 }, a2000).tripped, true);
    assert.equal(evaluateBrainResourceHardStop({ observedAt: "x", source: "measured", gpuTempC: 72 }, a2000).tripped, true);
  });

  await scenario("C2. A2000 below 60 °C does not trip; unknown temp is honest, not 'clear'", () => {
    const a2000 = DEFAULT_BRAIN_HARDWARE_PROFILES["rtx-a2000-12gb"];
    assert.equal(evaluateBrainResourceHardStop({ observedAt: "x", source: "measured", gpuTempC: 59.9 }, a2000).tripped, false);
    const unknown = evaluateBrainResourceHardStop({ observedAt: "x", source: "unavailable" }, a2000);
    assert.equal(unknown.tripped, false);
    assert.match(unknown.reason, /cannot confirm below/);
  });

  await scenario("C3. GTX 1650 has no A2000 hard stop (its own 80 °C ceiling governs)", () => {
    const gtx = DEFAULT_BRAIN_HARDWARE_PROFILES["gtx-1650-4gb"];
    assert.equal(evaluateBrainResourceHardStop({ observedAt: "x", source: "measured", gpuTempC: 75 }, gtx).tripped, false);
  });

  /* ------------------------- D. ffprobe parsing ----------------------- */

  await scenario("D1. AV MP4 JSON → container + video + audio", () => {
    const r = parseFfprobeJson(FFPROBE_AV);
    assert.equal(r.available, true);
    if (!r.available) return;
    assert.match(r.container.format, /mp4/);
    assert.ok(Math.abs(r.container.durationSeconds - 89.733333) < 1e-6);
    assert.equal(r.video?.width, 1920);
    assert.equal(r.video?.frameRate, 30);
    assert.equal(r.audio?.sampleRate, 48000);
    assert.equal(r.audio?.channels, 2);
    assert.equal(r.container.bitRateKbps, 621);
  });

  await scenario("D2. video-only MP4 → audio omitted, not faked", () => {
    const r = parseFfprobeJson(FFPROBE_VIDEO_ONLY);
    assert.equal(r.available, true);
    if (!r.available) return;
    assert.equal(r.audio, undefined);
    assert.equal(r.video?.height, 1080);
  });

  await scenario("D3. malformed JSON → { available: false }, no throw", () => {
    const r = parseFfprobeJson("{ not json");
    assert.equal(r.available, false);
  });

  await scenario("D4. JSON without a format block → unavailable", () => {
    const r = parseFfprobeJson(FFPROBE_NDJSON_NO_FORMAT);
    assert.equal(r.available, false);
  });

  /* ------------------------- E. probeMediaFile ------------------------ */

  await scenario("E1. missing file → unavailable (no spawn attempted)", async () => {
    let spawned = false;
    const r = await probeMediaFile("/no/such/file.mp4", {
      fileExists: () => false,
      runFfprobe: async () => { spawned = true; return ""; },
    });
    assert.equal(r.available, false);
    assert.equal(spawned, false);
  });

  await scenario("E2. injected ffprobe success → parsed summary", async () => {
    const r = await probeMediaFile("C:/fake/final.mp4", {
      fileExists: () => true,
      runFfprobe: async (args) => {
        assert.ok(args.includes("-show_streams") && args.includes("-show_format"));
        assert.ok(!args.some((a) => /-o\b|out|encode|-c:v/.test(a)), "read-only args only");
        return FFPROBE_AV;
      },
    });
    assert.equal(r.available, true);
  });

  await scenario("E3. ffprobe throwing → unavailable, never throws", async () => {
    const r = await probeMediaFile("C:/fake/final.mp4", {
      fileExists: () => true,
      runFfprobe: async () => { throw new Error("ffprobe: not found"); },
    });
    assert.equal(r.available, false);
  });

  /* ------------- F. summary → BrainFinalRenderReport → judge ---------- */

  await scenario("F1. a clean probe summary builds a report the quality judge can release", () => {
    const summary = parseFfprobeJson(FFPROBE_AV) as FfprobeMediaSummary;
    const report = buildBrainFinalRenderReport({
      projectSlug: "smoke",
      observedAt: "2026-09-08T00:00:00.000Z",
      summary,
      targetDurationBand: { minSeconds: 60, maxSeconds: 120 },
      targetResolution: { width: 1920, height: 1080 },
      targetFrameRate: 30,
      targetLoudnessLufs: -14,
      narrationDurationSeconds: 89,
      leadingSilenceSeconds: 0.2,
      trailingSilenceSeconds: 0.6,
      integratedLoudnessLufs: -14.1,
      subtitleCueCount: 3,
      expectedAssetKinds: ["script", "audio", "assembly"],
      presentAssetKinds: ["script", "audio", "assembly"],
      scenes: [
        { sceneId: 1, plannedDurationSeconds: 30, renderedDurationSeconds: 30, visualAssetId: "a1", visualDigest: "d1", narrationCharacters: 400, meanLuma: 120 },
        { sceneId: 2, plannedDurationSeconds: 30, renderedDurationSeconds: 30, visualAssetId: "a2", visualDigest: "d2", narrationCharacters: 400, meanLuma: 118 },
        { sceneId: 3, plannedDurationSeconds: 30, renderedDurationSeconds: 29, visualAssetId: "a3", visualDigest: "d3", narrationCharacters: 400, meanLuma: 122 },
      ],
    });
    assert.equal(report.container.durationSeconds, summary.container.durationSeconds);
    assert.equal(report.video?.width, 1920);
    const verdict = evaluateBrainQuality(report);
    assert.equal(verdict.outcome, "release");
    assert.equal(verdict.repairTargets.length, 0);
  });

  await scenario("F2. a video-only summary → report with no audio → judge rejects (missing stream)", () => {
    const summary = parseFfprobeJson(FFPROBE_VIDEO_ONLY) as FfprobeMediaSummary;
    const report = buildBrainFinalRenderReport({
      projectSlug: "smoke",
      observedAt: "2026-09-08T00:00:00.000Z",
      summary,
      targetDurationBand: { minSeconds: 60, maxSeconds: 120 },
      targetResolution: { width: 1920, height: 1080 },
      targetFrameRate: 30,
      expectedAssetKinds: ["assembly"],
      presentAssetKinds: ["assembly"],
      scenes: [],
    });
    assert.equal(report.audio, undefined);
    const verdict = evaluateBrainQuality(report);
    assert.notEqual(verdict.outcome, "release");
  });

  /* --------------------- optional live read-only checks --------------- */

  const nvsmi = realTool("nvidia-smi", "--version");
  if (nvsmi) {
    await scenario("LIVE. one read-only nvidia-smi telemetry query returns a snapshot", async () => {
      const snap = await probeBrainResources({ timeoutMs: 5_000 });
      assert.ok(snap.source === "measured" || snap.source === "unavailable");
      if (snap.source === "measured") {
        assert.ok(typeof snap.gpuTempC === "number");
        console.log(`   live GPU: ${snap.gpuTempC} °C, util ${snap.gpuUtilizationPct}%, ${snap.gpuPowerW} W, vram ${snap.vramUsedGb}/${snap.vramTotalGb} GB`);
      } else {
        console.log("   live GPU: unavailable (no NVIDIA telemetry) — treated conservatively");
      }
    });
  } else {
    console.log("   (skipped LIVE nvidia-smi — not present)");
  }

  const ffprobe = realTool("ffprobe", "-version");
  const mp4 = firstRealMp4();
  if (ffprobe && mp4) {
    await scenario("LIVE. one read-only ffprobe metadata read parses a real MP4", async () => {
      const r = await probeMediaFile(mp4, { timeoutMs: 10_000 });
      assert.equal(r.available, true, `ffprobe could not read ${mp4}`);
      if (r.available) {
        console.log(`   live MP4: ${path.basename(mp4)} — ${r.container.format} ${r.container.durationSeconds.toFixed(1)}s ${r.video?.width}x${r.video?.height}@${r.video?.frameRate}`);
      }
    });
  } else {
    console.log("   (skipped LIVE ffprobe — no ffprobe or no MP4)");
  }

  console.log(`Atölye Brain probes smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "brain-probes", scenarios: count }));
}

run().catch((error) => {
  console.error("Atölye Brain probes smoke FAILED:", error);
  process.exitCode = 1;
});
