import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ThumbnailStorage } from "../ThumbnailStorage";
import { createProviderDispatchAdapter } from "@/lib/providers/ProviderDispatchAdapterAuthority";
import { resolveRuntimeLogicalPath } from "@/lib/runtime/RuntimeStoragePaths";
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
    const logicalSource = input.assembly?.render?.filePath;
    if (!logicalSource) return failure(assetId, createdAt);
    // `render.filePath` is a runtime-logical path — resolve it to an absolute
    // filesystem path the same way the FFmpeg assembly/scene providers do.
    let source: string;
    try {
      source = fs.existsSync(logicalSource)
        ? logicalSource
        : resolveRuntimeLogicalPath(logicalSource);
    } catch {
      return failure(assetId, createdAt);
    }
    if (!fs.existsSync(source)) return failure(assetId, createdAt);

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
      // drawtext needs an explicit font on Windows (no fontconfig). Copy a
      // system font into the workdir and reference it by bare filename — that
      // sidesteps all filtergraph path escaping (drive-letter colon, backslash).
      // No usable font -> skip the text overlay; a darkened key still is a valid
      // thumbnail and YouTube shows the title anyway.
      let fontFile = "";
      const systemFont = resolveSystemFontPath();
      if (systemFont) {
        try {
          fs.copyFileSync(systemFont, path.join(workdir, "font.ttf"));
          fontFile = "font.ttf";
        } catch { /* fall through to no-text */ }
      }
      const withText = Boolean(title) && Boolean(fontFile);
      const filters = [
        `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase`,
        `crop=${WIDTH}:${HEIGHT}`,
        "eq=contrast=1.06:brightness=-0.02:saturation=1.08",
        ...(withText
          ? [
              `drawbox=x=0:y=${HEIGHT - 210}:w=${WIDTH}:h=210:color=black@0.55:t=fill`,
              `drawtext=fontfile=${fontFile}:text='${title}':fontcolor=white:fontsize=64:` +
                `x=(w-text_w)/2:y=${HEIGHT - 150}:box=1:boxcolor=black@0.35:boxborderw=18:` +
                "line_spacing=10",
            ]
          : ["drawbox=x=0:y=0:w=iw:h=ih:color=black@0.12:t=fill"]),
      ].join(",");

      const args = [
        "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-ss", seek.toFixed(3), "-i", source,
        "-frames:v", "1", "-vf", filters, "-f", "image2", outputPath,
      ];
      // cwd = workdir so the bare `font.ttf` filter reference resolves.
      const result = spawnSync(ffmpeg, args, {
        timeout: 60_000, windowsHide: true, cwd: workdir,
      });
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

/** Absolute path to a usable bold TTF, or "" if none is found. */
function resolveSystemFontPath(): string {
  const candidates = [
    process.env.ATOLYE_THUMBNAIL_FONT?.trim(),
    ...(process.platform === "win32"
      ? [
          `${process.env.WINDIR ?? "C:/Windows"}/Fonts/arialbd.ttf`,
          `${process.env.WINDIR ?? "C:/Windows"}/Fonts/segoeuib.ttf`,
          `${process.env.WINDIR ?? "C:/Windows"}/Fonts/arial.ttf`,
        ]
      : [
          "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
          "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
          "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        ]),
  ].filter((value): value is string => Boolean(value));
  return candidates.find((candidate) => {
    try { return fs.existsSync(candidate); } catch { return false; }
  }) ?? "";
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
