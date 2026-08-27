import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { AssetManager } from "../src/lib/assets/AssetManager";
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import {
  createProductionRuntimeOperationContext,
  initialRuntimeAuthorityGeneration,
} from "../src/lib/runtime/ProductionRuntimeOperationContext";
import { runWithProductionRuntimeOperationContext } from "../src/lib/runtime/RuntimeOperationScope";
import { updateAudioSectionBinding } from "../src/lib/audio/AudioCanonicalSectionBinding";
import { rebuildAudioMixFromCanonicalSections } from "../src/lib/audio/AudioCanonicalMixRebuilder";
import { invalidateAssemblyForAudioChange } from
  "../src/lib/audio/AudioCompensationAssemblyInvalidation";

const PROJECT_SLUG = "i-stanbul-un-fethi-1453";
const CHAPTER_IDS = [1, 2, 3, 4, 5];

function parseArgs() {
  const values = new Map<string, string>();
  for (const raw of process.argv.slice(2)) {
    const match = /^--([a-z-]+)=(.+)$/.exec(raw);
    if (match) values.set(match[1], match[2]);
  }
  return {
    backupId: values.get("backup-id"),
    reasonCode: values.get("reason-code"),
  };
}

async function main() {
  const { backupId, reasonCode } = parseArgs();
  const storageContext = createRuntimeStorageContext();
  const operationContext = createProductionRuntimeOperationContext({
    operationId: `reconcile-istanbul-1453-audio-${Date.now()}`,
    operationType: "reconcile-audio",
    authorityGeneration: initialRuntimeAuthorityGeneration,
    storageContext,
  });

  await runWithProductionRuntimeOperationContext(operationContext, async () => {
    const project = await ProjectManager.getProject(PROJECT_SLUG);
    if (!project) throw new Error(`Project "${PROJECT_SLUG}" not found.`);

    console.log("[1/4] Rebinding audio.json sections to authoritative real narration assets...");
    const projectAssetsBefore = AssetManager.getProjectAssets(PROJECT_SLUG, project.id);
    for (const chapterId of CHAPTER_IDS) {
      const authoritative = projectAssetsBefore.assets.find((asset) =>
        asset.type === "audio" && asset.sceneId === chapterId &&
        asset.provider !== "mock" && asset.model !== "mock" && asset.mimeType === "audio/wav");
      if (!authoritative) {
        throw new Error(`No authoritative (non-mock) audio asset found for chapter ${chapterId}.`);
      }
      await updateAudioSectionBinding({
        projectSlug: PROJECT_SLUG,
        projectId: project.id,
        chapterId,
        assetId: authoritative.id,
      });
      console.log(`  chapter ${chapterId} -> ${authoritative.id} (${authoritative.durationSeconds}s)`);
    }

    console.log("[2/4] Rebuilding the canonical mix from the now-bound sections...");
    const rebuiltAudio = await rebuildAudioMixFromCanonicalSections({
      projectSlug: PROJECT_SLUG,
      projectId: project.id,
    });
    console.log(`  new mix asset: ${rebuiltAudio.outputAssetId} ` +
      `(${rebuiltAudio.production.durationSeconds}s total)`);

    console.log("[3/4] Quarantining orphaned assets/audio/*.wav files with no registry reference...");
    await quarantineOrphanedAudioFiles(PROJECT_SLUG, project.id);

    console.log("[4/4] Computing (and, if requested, preparing) the assembly regeneration plan...");
    const invalidation = await invalidateAssemblyForAudioChange({
      projectSlug: PROJECT_SLUG,
      context: storageContext,
      backupId,
      reasonCode,
    });
    console.log(`  ${JSON.stringify(invalidation, null, 2)}`);

    if (!backupId) {
      console.log(
        "\nNo --backup-id supplied: assembly was NOT requeued. Re-run with " +
        "--backup-id=<verified runtime backup id> --reason-code=<REASON> once a fresh " +
        "backup covering this project has been created and verified " +
        "(npm run runtime:backup:create / :verify) to actually queue the re-render.",
      );
    }
  });
}

async function quarantineOrphanedAudioFiles(slug: string, projectId: string) {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const projectAssets = AssetManager.getProjectAssets(slug, projectId);
  const referencedFileNames = new Set(
    projectAssets.assets
      .filter((asset) => asset.type === "audio" && typeof asset.filePath === "string")
      .map((asset) => path.basename(asset.filePath as string)),
  );
  const audioDir = path.join("data", "projects", slug, "assets", "audio");
  const quarantineDir = path.join(audioDir, ".audio-quarantine-orphaned-pre-reconcile");
  const entries = fs.readdirSync(audioDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".wav"));
  let moved = 0;
  for (const entry of entries) {
    if (referencedFileNames.has(entry.name)) continue;
    fs.mkdirSync(quarantineDir, { recursive: true });
    fs.renameSync(path.join(audioDir, entry.name), path.join(quarantineDir, entry.name));
    console.log(`  quarantined: ${entry.name}`);
    moved += 1;
  }
  if (moved === 0) console.log("  nothing to quarantine.");
}

main().catch((error) => {
  console.error("RECONCILE_FAILED", error);
  process.exitCode = 1;
});
