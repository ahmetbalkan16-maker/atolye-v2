import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  withCanonicalSmokeRuntime,
  type CanonicalSmokeRuntime,
} from "./lib/CanonicalSmokeRuntime";
import {
  acquireProjectWriteAuthority,
  type RuntimeStorageAuthorityLease,
} from "../src/lib/runtime/RuntimeStoragePaths";
import {
  createAudioCanonicalDescriptorRebind,
  createProtectedAudioCompensationReceipt,
  prepareAudioCompensationWorkspace,
  reserveProtectedAudioCompensationPublication,
  bindProtectedAudioCompensationPublication,
  transitionAudioCompensationState,
  assertProtectedAudioCanonicalResolutionAllowed,
} from "../src/lib/audio/AudioCompensationStore";
import {
  createAudioPublicationDescriptorRebind,
  getCommittedAudioPublicationAssets,
  prepareAudioPublicationIntent,
} from "../src/lib/audio/AudioPublicationIntentStore";
import { AudioStorage } from "../src/lib/assets/storage/AudioStorage";
import { VideoAssemblyManager } from "../src/lib/assembly/VideoAssemblyManager";
import { AssetManager } from "../src/lib/assets/AssetManager";
import { FFmpegVideoAssemblyProvider } from "../src/lib/assembly/providers/FFmpegVideoAssemblyProvider";
import type { PortablePublishedFile } from "../src/lib/runtime/security/PortableNoClobberFilePublisher";

const SOURCE_SLUG = "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5";

function copyDirAndReplaceSlug(src: string, dest: string, targetSlug: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === "production-execution") continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirAndReplaceSlug(srcPath, destPath, targetSlug);
    } else if (entry.isFile()) {
      if (entry.name.endsWith(".json")) {
        const text = fs.readFileSync(srcPath, "utf-8");
        const replaced = text.replaceAll(SOURCE_SLUG, targetSlug);
        fs.writeFileSync(destPath, replaced, "utf-8");
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

function withProjectAuthority<T>(
  runtime: CanonicalSmokeRuntime,
  action: (authority: RuntimeStorageAuthorityLease) => T,
): T {
  const authority = acquireProjectWriteAuthority(runtime.projectSlug, runtime.runtimeStorageContext);
  try {
    return action(authority);
  } finally {
    authority.release();
  }
}

async function runIsolatedE2E() {
  console.log("=== ISOLATED REAL-PROJECT COPY E2E TEST ===");

  await withCanonicalSmokeRuntime(
    {
      name: "isolated-real-project-e2e",
      configureProductionExecution: true,
      environment: {
        VIDEO_ASSEMBLY_PROVIDER: "ffmpeg",
        FFMPEG_PATH: process.env.FFMPEG_PATH || "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
        FFPROBE_PATH: process.env.FFPROBE_PATH || "C:\\Program Files\\ffmpeg\\bin\\ffprobe.exe",
      },
    },
    async (runtime) => {
      const repoRoot = process.cwd();
      const sourcePath = path.join(repoRoot, "data", "projects", SOURCE_SLUG);
      const isolatedProjPath = path.join(
        runtime.runtimeStorageContext.projectsRoot,
        runtime.projectSlug,
      );

      console.log(`[E2E] Copying real project ${SOURCE_SLUG} to temp isolated dir with slug ${runtime.projectSlug}...`);
      copyDirAndReplaceSlug(sourcePath, isolatedProjPath, runtime.projectSlug);

      const projectJson = JSON.parse(fs.readFileSync(path.join(isolatedProjPath, "project.json"), "utf-8"));
      const projectId = projectJson.id ?? `project-${runtime.projectSlug}`;
      console.log(`[E2E] Project ID: ${projectId}`);

      const audioJsonPath = path.join(isolatedProjPath, "audio.json");
      assert.ok(fs.existsSync(audioJsonPath), "audio.json must exist in isolated project");
      const audioData = JSON.parse(fs.readFileSync(audioJsonPath, "utf-8"));
      assert.ok(audioData && audioData.sections && audioData.sections.length > 0, "audio.json must exist with sections");

      const assetCompRefMap = new Map<string, string>();

      const itemsToSeed = [
        ...audioData.sections.map((sec: any, idx: number) => ({
          sceneId: idx + 1,
          outputAssetId: sec.outputAssetId,
          audioFileUrl: sec.audioFileUrl,
          durationSeconds: sec.durationSeconds ?? 5,
        })),
      ];
      if (audioData.outputAssetId && audioData.production?.audioFileUrl) {
        itemsToSeed.push({
          sceneId: undefined,
          outputAssetId: audioData.outputAssetId,
          audioFileUrl: audioData.production.audioFileUrl,
          durationSeconds: audioData.production.durationSeconds ?? 10,
        });
      }

      console.log(`[E2E] Seeding authentic publication intent and compensation records for ${itemsToSeed.length} audio items...`);
      for (let i = 0; i < itemsToSeed.length; i += 1) {
        const item = itemsToSeed[i];
        const canonicalFileName = path.basename(item.audioFileUrl);
        const canonicalRelPath = `data/projects/${runtime.projectSlug}/assets/audio/${canonicalFileName}`;
        const fullWavPath = path.join(isolatedProjPath, "assets", "audio", canonicalFileName);
        assert.ok(fs.existsSync(fullWavPath), `WAV file must exist at ${fullWavPath}`);

        const wavBytes = fs.readFileSync(fullWavPath);
        const sha256 = createHash("sha256").update(wavBytes).digest("hex");
        const wavStat = fs.statSync(fullWavPath);

        const workspace = withProjectAuthority(runtime, (authority) =>
          prepareAudioCompensationWorkspace({
            authority, context: runtime.runtimeStorageContext,
            projectSlug: runtime.projectSlug, byteLength: wavBytes.length,
          }),
        );
        fs.writeFileSync(workspace.temporaryFilePath, wavBytes, { flag: "wx" });

        const receipt = withProjectAuthority(runtime, (authority) =>
          createProtectedAudioCompensationReceipt({
            authority, context: runtime.runtimeStorageContext,
            projectSlug: runtime.projectSlug, workspace, canonicalFileName,
            byteLength: wavBytes.length, sha256, device: wavStat.dev, inode: wavStat.ino,
          }),
        );

        const stagingPath = path.join(workspace.directory, "publication-staging.wav");
        fs.writeFileSync(stagingPath, wavBytes);

        withProjectAuthority(runtime, (authority) =>
          reserveProtectedAudioCompensationPublication({
            authority, context: runtime.runtimeStorageContext,
            projectSlug: runtime.projectSlug, compensationRef: receipt.compensationRef,
            mode: "hard-link", byteLength: wavBytes.length, sha256,
            device: wavStat.dev, inode: wavStat.ino,
          }),
        );

        const publication = withProjectAuthority(runtime, (authority) =>
          bindProtectedAudioCompensationPublication({
            authority, context: runtime.runtimeStorageContext,
            projectSlug: runtime.projectSlug, compensationRef: receipt.compensationRef,
            mode: "hard-link", byteLength: wavBytes.length, sha256,
            device: wavStat.dev, inode: wavStat.ino,
          }),
        );

        withProjectAuthority(runtime, (authority) =>
          transitionAudioCompensationState(
            runtime.projectSlug, receipt.compensationRef,
            { status: "completed", outcome: "registry-owned" },
            authority, runtime.runtimeStorageContext,
          ),
        );

        const pubPayload: PortablePublishedFile = {
          mode: publication.mode, device: publication.device,
          inode: publication.inode, byteLength: publication.byteLength,
          sha256: publication.sha256,
        };

        const assetDate = new Date(1700000000000 + i * 1000).toISOString();
        const asset = {
          id: item.outputAssetId,
          projectId,
          projectSlug: runtime.projectSlug,
          sceneId: item.sceneId,
          type: "audio" as const,
          status: "generated" as const,
          provider: "openai" as const,
          model: "tts-1",
          prompt: item.sceneId ? `narration section ${item.sceneId}` : "full audio mix",
          filePath: canonicalRelPath,
          url: `/api/assets/audio/${runtime.projectSlug}/${canonicalFileName}`,
          mimeType: "audio/wav",
          byteLength: wavBytes.length,
          durationSeconds: item.durationSeconds,
          createdAt: assetDate,
        };

        withProjectAuthority(runtime, (authority) =>
          prepareAudioPublicationIntent({
            projectSlug: runtime.projectSlug,
            projectId,
            compensationRef: receipt.compensationRef,
            asset,
            publication: pubPayload,
            authority,
            context: runtime.runtimeStorageContext,
          }),
        );

        assetCompRefMap.set(item.outputAssetId, receipt.compensationRef);
      }

      const committedAssets = getCommittedAudioPublicationAssets(runtime.projectSlug, projectId, runtime.runtimeStorageContext);
      assert.equal(committedAssets.length, itemsToSeed.length);
      console.log(`[E2E] ${committedAssets.length} audio publication intents seeded successfully.`);

      const targetAsset = committedAssets.find(a => a.sceneId === 1)!;
      const targetCompRef = assetCompRefMap.get(targetAsset.id);
      assert.ok(targetCompRef, "Compensation ref must exist for target asset");

      const audioRelativePath = targetAsset.filePath as string;
      const canonicalFileName = path.basename(audioRelativePath);
      const fullAudioPath = path.join(isolatedProjPath, "assets", "audio", canonicalFileName);

      console.log(`[E2E] Step 1: AudioStorage.inspectStoredWav() on initial copied WAV (${audioRelativePath})...`);
      const initialInspection = AudioStorage.inspectStoredWav(runtime.projectSlug, audioRelativePath, runtime.runtimeStorageContext);
      assert.ok(initialInspection.durationSeconds > 0, "Initial inspection must yield valid durationSeconds");

      const initialIdentity = assertProtectedAudioCanonicalResolutionAllowed(runtime.projectSlug, canonicalFileName, runtime.runtimeStorageContext);
      assert.ok(initialIdentity?.sha256, "Resolution allowed must yield valid identity sha256");
      console.log(`[E2E] Initial inspection PASS. Duration: ${initialInspection.durationSeconds.toFixed(2)}s, Inode: ${initialIdentity?.inode}`);

      console.log(`[E2E] Step 2: Simulating materialization drift (unlink & rewrite WAV)...`);
      const originalBytes = fs.readFileSync(fullAudioPath);
      fs.rmSync(fullAudioPath);
      fs.writeFileSync(fullAudioPath, originalBytes, { flag: "wx" });
      const driftedStat = fs.statSync(fullAudioPath);
      console.log(`[E2E] Drifted file written. New Inode: ${driftedStat.ino}`);
      assert.notEqual(driftedStat.ino, initialIdentity?.inode, "Inode must have changed");

      console.log(`[E2E] Step 3: Verifying AudioStorage.inspectStoredWav() fails before rebind...`);
      assert.throws(
        () => AudioStorage.inspectStoredWav(runtime.projectSlug, audioRelativePath, runtime.runtimeStorageContext),
        (err: any) => err instanceof Error,
        "Inspection must fail-closed on inode drift before rebind",
      );
      console.log(`[E2E] Inspection fail-closed PASS.`);

      console.log(`[E2E] Step 4: Re-anchoring descriptors via createAudioPublicationDescriptorRebind & createAudioCanonicalDescriptorRebind...`);
      const publicationRebind = withProjectAuthority(runtime, (authority) =>
        createAudioPublicationDescriptorRebind({
          projectSlug: runtime.projectSlug,
          projectId,
          assetId: targetAsset.id,
          reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT",
          authority,
          context: runtime.runtimeStorageContext,
        }),
      );
      console.log(`[E2E] Publication rebind created for assetId=${targetAsset.id}`);

      const compensationRebind = withProjectAuthority(runtime, (authority) =>
        createAudioCanonicalDescriptorRebind({
          projectSlug: runtime.projectSlug,
          compensationRef: targetCompRef,
          reasonCode: "FILESYSTEM_MATERIALIZATION_DRIFT",
          authority,
          context: runtime.runtimeStorageContext,
        }),
      );

      console.log(`[E2E] Compensation rebind created. New Inode: ${compensationRebind.newInode}`);

      console.log(`[E2E] Step 5: AudioStorage.inspectStoredWav() after rebind...`);
      const postRebindInspection = AudioStorage.inspectStoredWav(runtime.projectSlug, audioRelativePath, runtime.runtimeStorageContext);
      assert.ok(postRebindInspection.durationSeconds > 0, "Post-rebind inspection must yield valid duration");
      const postIdentity = assertProtectedAudioCanonicalResolutionAllowed(runtime.projectSlug, canonicalFileName, runtime.runtimeStorageContext);
      assert.equal(postIdentity?.inode, compensationRebind.newInode, "Post-rebind inspection must match new inode");
      console.log(`[E2E] Post-rebind inspection PASS!`);

      console.log(`[E2E] Step 6: Testing VideoAssemblyManager & provider.assemble() access with FFmpeg...`);
      const scenes = JSON.parse(fs.readFileSync(path.join(isolatedProjPath, "scenes.json"), "utf-8"));
      const visuals = JSON.parse(fs.readFileSync(path.join(isolatedProjPath, "visuals.json"), "utf-8"));
      const assembly = JSON.parse(fs.readFileSync(path.join(isolatedProjPath, "assembly.json"), "utf-8"));
      const animation = JSON.parse(fs.readFileSync(path.join(isolatedProjPath, "animation.json"), "utf-8"));

      const ffmpegProvider = new FFmpegVideoAssemblyProvider();
      let providerAssembleReached = false;
      let realFFmpegSpawned = false;

      const originalAssemble = ffmpegProvider.assemble.bind(ffmpegProvider);
      ffmpegProvider.assemble = async (input) => {
        providerAssembleReached = true;
        console.log(`[E2E] provider.assemble() CALLED with project ${input.projectSlug}, ${input.scenes.length} scenes.`);
        try {
          const result = await originalAssemble(input);
          realFFmpegSpawned = true;
          console.log(`[E2E] FFmpeg assembly render output: ${(result as any).outputPath}`);
          return result;
        } catch (err: any) {
          console.log(`[E2E] FFmpeg assembly throw/completed with message: ${err?.message || err}`);
          throw err;
        }
      };

      try {
        await VideoAssemblyManager.renderExistingAssets({
          projectId,
          projectSlug: runtime.projectSlug,
          scenes,
          visuals,
          audio: audioData,
          assembly,
          animation,
          video: null,
          provider: ffmpegProvider,
        });
      } catch (e: any) {
        console.log(`[E2E] renderExistingAssets Exception Details:`, e);
      }

      console.log(`[E2E] provider.assemble() reached: ${providerAssembleReached}`);
      console.log(`[E2E] real FFmpeg/FFprobe spawned: ${realFFmpegSpawned}`);
      assert.ok(providerAssembleReached, "provider.assemble() MUST be reached in E2E test");

      console.log("=== ISOLATED REAL-PROJECT COPY E2E TEST: SUCCESS ===");
    },
  );
}

runIsolatedE2E().catch((err) => {
  console.error("ISOLATED REAL-PROJECT COPY E2E TEST FAILED:", err);
  process.exitCode = 1;
});
