import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProviderDispatchAdapter } from "@/lib/providers/ProviderDispatchAdapterAuthority";
import type { ImageGenerationResult } from "@/types/asset";
import { ImageStorage } from "../storage/ImageStorage";
import { getLocalImageProviderConfig } from "./ImageProviderConfig";
import type { ConfiguredImageProvider, ImageGenerationInput } from "./ImageProvider";

const MODEL = "ffmpeg-gradient-drawtext";
const GENERIC_ERROR = "Local placeholder image generation failed.";

/**
 * Local, $0 **last-resort** image provider. Renders a deterministic muted-colour
 * frame with a subtle vignette and — when a system font is available — the
 * scene's key phrase burned in with FFmpeg `drawtext`. No model, no network, no
 * API cost.
 *
 * This is a placeholder, not a picture: it exists so a fully-local ($0) render
 * can complete every scene even when a scene has no admissible real archival
 * photo. `VisualAssetPipeline` only reaches it when
 * `ATOLYE_LOCAL_IMAGE_FALLBACK` is on AND the real-photo attempt found nothing
 * usable — a scene that DOES have an admissible real photo always keeps the real
 * photo. Standalone use (`IMAGE_PROVIDER=local`) makes every scene a placeholder.
 *
 * The persisted asset is honestly classified downstream as a synthesised image
 * (`mediaOrigin: "ai"`, `selectionReason: "local-generated-placeholder"`); it is
 * never recorded as a real photo and never carries a source licence.
 */
export class LocalImageProvider implements ConfiguredImageProvider {
  readonly name = "local" as const;

  createImmutableImageDispatchAdapter() {
    return createProviderDispatchAdapter(this, {
      metadata: { name: this.name },
      requiredMethods: ["generateImage"],
    });
  }

  async generateImage(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    const createdAt = new Date().toISOString();

    if (
      !Number.isSafeInteger(input.sceneId) ||
      input.sceneId <= 0 ||
      !input.projectSlug
    ) {
      return failure(input.sceneId, createdAt);
    }

    const config = getLocalImageProviderConfig();
    let workdir: string | undefined;

    try {
      workdir = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-localimg-"));
      const outputPath = path.join(workdir, "scene.png");

      const [colorA, colorB] = paletteFor(input.prompt, input.sceneId);
      const label = sanitizeDrawText(pickLabel(input));

      // drawtext needs an explicit font on Windows (no fontconfig). Copy a system
      // font into the workdir and reference it by bare filename so no filtergraph
      // path escaping (drive-letter colon, backslash) is ever needed. No usable
      // font -> skip the text; a clean colour field is still a valid placeholder.
      let fontFile = "";
      const systemFont = config.fontPath ?? resolveSystemFontPath();
      if (systemFont) {
        try {
          fs.copyFileSync(systemFont, path.join(workdir, "font.ttf"));
          fontFile = "font.ttf";
        } catch {
          /* fall through to no-text */
        }
      }
      const withText = Boolean(label) && Boolean(fontFile);

      const filters = [
        // A soft two-band vertical gradient built from two solid draws — robust
        // across every FFmpeg build (no dependency on the `gradients` source).
        `drawbox=x=0:y=0:w=iw:h=ih/2:color=${colorB}@0.55:t=fill`,
        "vignette=PI/5",
        "noise=alls=6:allf=t",
        ...(withText
          ? [
              `drawbox=x=0:y=ih-260:w=iw:h=260:color=black@0.42:t=fill`,
              `drawtext=fontfile=${fontFile}:text='${label}':fontcolor=white@0.92:` +
                `fontsize=58:x=(w-text_w)/2:y=h-165:box=1:boxcolor=black@0.32:` +
                `boxborderw=22:line_spacing=12`,
            ]
          : []),
      ].join(",");

      const args = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-f",
        "lavfi",
        "-i",
        `color=c=${colorA}:s=${config.width}x${config.height}`,
        "-frames:v",
        "1",
        "-vf",
        filters,
        "-f",
        "image2",
        outputPath,
      ];

      const result = spawnSync(config.ffmpegPath, args, {
        timeout: config.timeoutMs,
        windowsHide: true,
        cwd: workdir,
      });

      if (result.status !== 0 || !fs.existsSync(outputPath)) {
        return failure(input.sceneId, createdAt);
      }

      const data = fs.readFileSync(outputPath);
      // PNG magic bytes.
      if (data.length < 8 || data[0] !== 0x89 || data[1] !== 0x50) {
        return failure(input.sceneId, createdAt);
      }

      const saved = trySaveImage(input.projectSlug, data);
      if (!saved) {
        return failure(input.sceneId, createdAt);
      }

      return {
        success: true,
        sceneId: input.sceneId,
        provider: "local",
        model: MODEL,
        filePath: saved.filePath,
        url: saved.url,
        mimeType: "image/png",
        width: config.width,
        height: config.height,
        createdAt,
      };
    } catch {
      return failure(input.sceneId, createdAt);
    } finally {
      if (workdir) {
        try {
          fs.rmSync(workdir, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
      }
    }
  }
}

function trySaveImage(
  projectSlug: string,
  bytes: Buffer,
): { filePath: string; url: string } | null {
  try {
    const savedImage = ImageStorage.saveImage({
      projectSlug,
      data: bytes,
      mimeType: "image/png",
    });
    const inspection = ImageStorage.inspectStoredImage(
      projectSlug,
      savedImage.filePath,
      "image/png",
    );
    if (
      inspection.byteLength !== bytes.byteLength ||
      savedImage.url !== ImageStorage.getImageUrl(projectSlug, savedImage.fileName) ||
      savedImage.filePath !== ImageStorage.getImagePath(projectSlug, savedImage.fileName)
    ) {
      return null;
    }
    return { filePath: savedImage.filePath, url: savedImage.url };
  } catch {
    return null;
  }
}

/** A deterministic pair of dark, muted hex colours from the scene's prompt + id. */
function paletteFor(prompt: string, sceneId: number): [string, string] {
  const digest = createHash("sha256")
    .update(`${sceneId}:${typeof prompt === "string" ? prompt : ""}`)
    .digest();
  const palette: Array<[string, string]> = [
    ["0x1c2431", "0x0d1017"],
    ["0x2b2320", "0x14100e"],
    ["0x1f2a24", "0x0e1512"],
    ["0x2a2233", "0x140f1a"],
    ["0x33291c", "0x1a140c"],
    ["0x1b2b33", "0x0c161b"],
  ];
  return palette[digest[0] % palette.length];
}

/** The scene's most search-worthy phrase, for the burned-in caption. */
function pickLabel(input: ImageGenerationInput): string {
  const keyword = input.searchKeywords?.find(
    (value) => typeof value === "string" && value.trim().length >= 2,
  );
  if (keyword) return keyword.split(/\s*[:—–]\s*|\.\s+/)[0].trim().slice(0, 80);
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  return prompt.split(/[.!?\n]/)[0].trim().slice(0, 80);
}

/** Absolute path to a usable TTF, or "" if none is found. */
function resolveSystemFontPath(): string {
  const candidates = [
    ...(process.platform === "win32"
      ? [
          `${process.env.WINDIR ?? "C:/Windows"}/Fonts/segoeui.ttf`,
          `${process.env.WINDIR ?? "C:/Windows"}/Fonts/arial.ttf`,
          `${process.env.WINDIR ?? "C:/Windows"}/Fonts/arialbd.ttf`,
        ]
      : [
          "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
          "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
          "/System/Library/Fonts/Supplemental/Arial.ttf",
        ]),
  ];
  return (
    candidates.find((candidate) => {
      try {
        return fs.existsSync(candidate);
      } catch {
        return false;
      }
    }) ?? ""
  );
}

/** FFmpeg drawtext: escape the characters that terminate / reinterpret the arg. */
function sanitizeDrawText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\u2019")
    .replace(/%/g, "\\%");
}

function failure(sceneId: number, createdAt: string): ImageGenerationResult {
  return {
    success: false,
    sceneId: Number.isSafeInteger(sceneId) && sceneId > 0 ? sceneId : 0,
    provider: "local",
    model: MODEL,
    createdAt,
    error: GENERIC_ERROR,
  };
}
