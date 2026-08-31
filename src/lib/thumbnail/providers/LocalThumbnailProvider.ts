import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ThumbnailStorage } from "../ThumbnailStorage";
import { createProviderDispatchAdapter } from "@/lib/providers/ProviderDispatchAdapterAuthority";
import { createMockThumbnailData } from "./MockThumbnailProvider";
import type {
  ThumbnailAssetGenerationInput,
  ThumbnailAssetGenerationResult,
  ThumbnailGenerationInput,
  ThumbnailGenerationResult,
  ConfiguredThumbnailProvider,
} from "./ThumbnailProvider";

const MODEL = "ffmpeg-frame-drawtext";
const WIDTH = 1280;
const HEIGHT = 720;

/**
 * Local, $0 thumbnail provider. Instead of an image-generation API it takes a
 * representative frame from the finished assembled video and burns the title
 * over it with FFmpeg `drawtext` — the classic "key still + big text"
 * documentary thumbnail. Opt-in via `THUMBNAIL_PROVIDER=local`. No model, no
 * network. Falls back to `THUMBNAIL_ASSET_GENERATION_FAILED` (pipeline-handled)
 * when FFmpeg or the assembled video is unavailable.
 */
export class LocalThumbnailProvider implements ConfiguredThumbnailProvider {
  readonly name = "local" as const;

  createImmutableThumbnailDispatchAdapter() {
    return createProviderDispatchAdapter(this, {
      metadata: { name: this.name },
      requiredMethods: ["generateThumbnailPlan", "generateThumbnailAsset"],
    });
  }

  async generateThumbnailPlan(
    input: ThumbnailGenerationInput,
  ): Promise<ThumbnailGenerationResult> {
    const thumbnail = createMockThumbnailData(input);
    return {
      provider: "local",
      model: MODEL,
      status: "planned",
      thumbnail: {
        ...thumbnail,
        provider: "local",
        model: MODEL,
        generation: { provider: "local", model: MODEL, status: "planned" },
      },
    };
  }

  async generateThumbnailAsset(
    input: ThumbnailAssetGenerationInput,
  ): Promise<ThumbnailAssetGenerationResult> {
    const assetId = randomUUID();
    const createdAt = new Date().toISOString();
    const ffmpeg = process.env.FFMPEG_EXECUTABLE?.trim() || process.env.FFMPEG_PATH?.trim() || "ffmpeg";
    const source = input.assembly?.render?.filePath;
    if (!source || !fs.existsSync(source)) return failure(assetId, createdAt);

    const durationSeconds =
      typeof input.assembly?.render?.durationSeconds === "number" &&
      input.assembly.render.durationSeconds > 0
        ? input.assembly.render.durationSeconds
        : 0;
    const seek = durationSeconds > 3 ? Math.min(durationSeconds / 3, durationSeconds - 1) : 0;

    let workdir: string | undefined;
    try {
      workdir = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-thumb-"));
      const outputPath = path.join(workdir, "thumbnail.png");
      const title = sanitizeTitle(input.title || "");
      const filters = [
        `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase`,
        `crop=${WIDTH}:${HEIGHT}`,
        "eq=contrast=1.06:brightness=-0.02:saturation=1.08",
        `drawbox=x=0:y=${HEIGHT - 210}:w=${WIDTH}:h=210:color=black@0.55:t=fill`,
        ...(title
          ? [
              `drawtext=text='${title}':fontcolor=white:fontsize=64:` +
                `x=(w-text_w)/2:y=${HEIGHT - 150}:box=1:boxcolor=black@0.35:boxborderw=18:` +
                "line_spacing=10",
            ]
          : []),
      ].join(",");

      const args = [
        "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-ss", seek.toFixed(3), "-i", source,
        "-frames:v", "1", "-vf", filters, "-f", "image2", outputPath,
      ];
      const result = spawnSync(ffmpeg, args, { timeout: 60_000, windowsHide: true });
      if (result.status !== 0 || !fs.existsSync(outputPath)) {
        return failure(assetId, createdAt);
      }
      const data = fs.readFileSync(outputPath);
      if (data.length < 8 || !(data[0] === 0x89 && data[1] === 0x50)) {
        return failure(assetId, createdAt);
      }
      const saved = ThumbnailStorage.saveThumbnail({
        projectSlug: input.projectSlug,
        assetId,
        data,
        mimeType: "image/png",
      });
      return {
        success: true,
        assetId,
        provider: "local",
        model: MODEL,
        status: "generated",
        generationMode: "production",
        createdAt,
        ...saved,
      };
    } catch {
      return failure(assetId, createdAt);
    } finally {
      if (workdir) {
        try { fs.rmSync(workdir, { recursive: true, force: true }); } catch { /* best-effort */ }
      }
    }
  }
}

/** FFmpeg drawtext: escape the characters that terminate / reinterpret the arg. */
function sanitizeTitle(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim().slice(0, 90);
  return collapsed
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "’")
    .replace(/%/g, "\\%");
}

function failure(assetId: string, createdAt: string): ThumbnailAssetGenerationResult {
  return {
    success: false,
    assetId,
    provider: "local",
    model: MODEL,
    status: "failed",
    createdAt,
    error: "Thumbnail provider request failed.",
  };
}
