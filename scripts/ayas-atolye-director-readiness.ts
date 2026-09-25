/**
 * Read-only Stage 12 review of an existing project.
 *
 * npx tsx --env-file-if-exists=.env.local scripts/ayas-atolye-director-readiness.ts \
 *   --slug <project> --format documentary [--json]
 *
 * Without ATOLYE_RUNTIME_ROOT (tsx does not load .env.local by itself) the
 * review reads the repository's legacy data/projects copy; the output always
 * names the storage classification it read.
 *
 * No production run, provider call, media download, ffmpeg render or write.
 */
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ProjectReader } from "../src/lib/projects/ProjectReader";
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import {
  directorTaskFromProjectArtifacts,
} from "../src/lib/ayas/director/AyasDirectorProjectAdapter";
import {
  reviewAtolyeDirectorTask,
  type DirectorFormat,
} from "../src/lib/ayas/director/AyasDirectorReadiness";
import type { Project } from "../src/types/project";
import type { ResearchData } from "../src/types/research";
import type { ScriptData } from "../src/types/script";
import type { SceneData } from "../src/types/scene";
import type { VisualData } from "../src/types/visual";
import type { AnimationData } from "../src/types/animation";
import type { AudioData } from "../src/types/audio";
import type { ProjectAssets } from "../src/types/asset";

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function probeTool(
  name: "ffmpeg" | "ffprobe",
  configuredPaths: Readonly<Record<string, string>>,
): "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN" {
  const configured = name === "ffmpeg"
    ? process.env.FFMPEG_EXECUTABLE?.trim() || process.env.FFMPEG_PATH?.trim()
      || configuredPaths.FFMPEG_EXECUTABLE || configuredPaths.FFMPEG_PATH
    : process.env.FFPROBE_EXECUTABLE?.trim() || process.env.FFPROBE_PATH?.trim()
      || configuredPaths.FFPROBE_EXECUTABLE || configuredPaths.FFPROBE_PATH;
  if (!configured) return "UNKNOWN";
  try {
    execFileSync(configured, ["-version"], {
      timeout: 3_000,
      stdio: "ignore",
      windowsHide: true,
    });
    return "AVAILABLE";
  } catch (error) {
    const failure = error as { code?: string; status?: number };
    if (failure.code === "ENOENT" || typeof failure.status === "number") {
      return "UNAVAILABLE";
    }
    // A sandbox may forbid launching an otherwise valid executable.
    return "UNKNOWN";
  }
}

async function readConfiguredMediaToolPaths(): Promise<Record<string, string>> {
  let content: string;
  try {
    content = await fs.readFile(path.join(process.cwd(), ".env.local"), "utf8");
  } catch {
    return {};
  }
  const paths: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = /^(FFMPEG_EXECUTABLE|FFMPEG_PATH|FFPROBE_EXECUTABLE|FFPROBE_PATH)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const raw = match[2].trim();
    paths[match[1]] = raw.replace(/^(['"])(.*)\1$/, "$2");
  }
  return paths;
}

async function readOptional<T>(
  slug: string,
  fileName: string,
  context: ReturnType<typeof createRuntimeStorageContext>,
): Promise<T | null> {
  const result = await ProjectReader.readJSONState<T>(slug, fileName, context);
  if (result.status === "malformed") throw new Error(`${fileName}: malformed project data`);
  return result.status === "parsed" ? result.value : null;
}

async function readAssets(
  slug: string,
  context: ReturnType<typeof createRuntimeStorageContext>,
): Promise<ProjectAssets | null> {
  const projectFolder = ProjectReader.getProjectFolder(slug, context);
  const assetsFolder = path.join(projectFolder, "assets");
  const registryFile = path.join(assetsFolder, "assets.json");
  try {
    const [folderStat, fileStat] = await Promise.all([
      fs.lstat(assetsFolder), fs.lstat(registryFile),
    ]);
    if (!folderStat.isDirectory() || folderStat.isSymbolicLink()
      || !fileStat.isFile() || fileStat.isSymbolicLink()) {
      throw new Error("Unsafe asset registry path.");
    }
    const parsed: unknown = JSON.parse(await fs.readFile(registryFile, "utf8"));
    if (!parsed || typeof parsed !== "object"
      || !Array.isArray((parsed as ProjectAssets).assets)) {
      throw new Error("Malformed asset registry.");
    }
    return parsed as ProjectAssets;
  } catch (error) {
    if (typeof error === "object" && error !== null
      && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function main(): Promise<void> {
  const slug = argValue("--slug");
  const rawFormat = argValue("--format")?.toLowerCase();
  if (!slug || !/^[a-zA-Z0-9_-]{1,160}$/.test(slug)
    || !["documentary", "general"].includes(rawFormat ?? "")) {
    throw new Error("Usage: --slug <safe project slug> --format documentary|general [--json]");
  }
  const format: DirectorFormat = rawFormat === "documentary" ? "DOCUMENTARY" : "GENERAL";
  const context = createRuntimeStorageContext({ workspaceRoot: process.cwd() });
  const project = await readOptional<Project>(slug, "project.json", context);
  if (!project || (project.slug !== slug && project.id !== slug)) {
    throw new Error("Project not found or identity mismatch.");
  }
  const [research, script, scenes, visuals, animation, audio] = await Promise.all([
    readOptional<ResearchData>(slug, "research.json", context),
    readOptional<ScriptData>(slug, "script.json", context),
    readOptional<SceneData>(slug, "scenes.json", context),
    readOptional<VisualData>(slug, "visuals.json", context),
    readOptional<AnimationData>(slug, "animation.json", context),
    readOptional<AudioData>(slug, "audio.json", context),
  ]);
  const assets = await readAssets(slug, context);
  const mediaToolPaths = await readConfiguredMediaToolPaths();
  const task = directorTaskFromProjectArtifacts(
    { project, research, script, scenes, visuals, animation, audio, assets },
    {
      format,
      host: {
        ffmpeg: probeTool("ffmpeg", mediaToolPaths),
        ffprobe: probeTool("ffprobe", mediaToolPaths),
      },
      // Environment selection is not proof of provider liveness or spend authority.
      provider: "UNKNOWN",
    },
  );
  const review = reviewAtolyeDirectorTask(task);
  const storage = { classification: context.classification, rootSelection: context.rootSelection };
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ ...review, storage }, null, 2));
  } else {
    console.log([
      `STORAGE: ${storage.classification}${storage.rootSelection === "explicit" ? ""
        : " (ATOLYE_RUNTIME_ROOT not set: repository legacy copy, not the live runtime)"}`,
      `PROJECT: ${review.projectId}`,
      `SCENES: ${review.scenesReviewed}`,
      `SELECTED MEDIA: ${review.selectedMediaCount}`,
      `READINESS: ${review.readiness}`,
      `DEPENDENCIES: ${review.dependencyState} (provider liveness unverified)`,
      `PRE-ASSEMBLY: ${review.preAssemblyGate}`,
      `POST-ASSEMBLY: ${review.postAssemblyGate}`,
      `FINDINGS: ${review.findings.length}`,
      ...review.findings.slice(0, 20).map((finding) =>
        `  ${finding.severity} ${finding.code} ${finding.sceneId ?? "project"}: ${finding.evidence}`),
      "AUTHORITY: ADVISORY_ONLY",
    ].join("\n"));
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
