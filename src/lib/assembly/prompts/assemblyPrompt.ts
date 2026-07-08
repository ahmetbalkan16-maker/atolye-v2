import type { AssemblySourceData } from "@/lib/assembly/AssemblyManager";
import type { AudioData } from "@/types/audio";
import type { SceneData } from "@/types/scene";
import type { ScriptData } from "@/types/script";
import type { VisualData } from "@/types/visual";

export function createAssemblyPrompt(
  script: ScriptData,
  scenes: SceneData,
  visuals: VisualData,
  audio: AudioData,
  sources: AssemblySourceData = {},
): string {
  return [
    "You are a professional documentary video editor.",
    "Create a video assembly plan from the provided script, scene, visual, and audio plans.",
    "Return only valid JSON. Do not include markdown, comments, or extra text.",
    "Do not render video and do not create real media files. Create planning metadata only.",
    "The JSON object must match this TypeScript shape:",
    "{",
    '  "scenes": [',
    "    {",
    '      "sceneId": 1,',
    '      "duration": "mm:ss",',
    '      "visualReference": "visual-1",',
    '      "animationAssetId": "asset-id",',
    '      "videoAssetId": "asset-id",',
    '      "audioAssetId": "asset-id",',
    '      "audioReference": "section-1",',
    '      "transition": "string",',
    '      "cameraMovement": "string",',
    '      "effects": ["string"],',
    '      "notes": "string"',
    "    }",
    "  ],",
    '  "totalDuration": "mm:ss",',
    '  "style": "string",',
    '  "render": {',
    '    "status": "planned",',
    '    "format": "mp4"',
    "  },",
    '  "createdAt": "string"',
    "}",
    "Rules:",
    "- Preserve scene order.",
    "- Keep sceneId, visualReference, and audioReference clear and stable.",
    "- visualReference should use visual-{sceneId}.",
    "- audioReference should use section-{chapterId}.",
    "- Preserve provided animationAssetId, videoAssetId, and audioAssetId references when available.",
    "- Use documentary cinematic editing language.",
    "- render.status must be planned.",
    "Script JSON:",
    JSON.stringify(script),
    "Scene JSON:",
    JSON.stringify(scenes),
    "Visual JSON:",
    JSON.stringify(visuals),
    "Audio JSON:",
    JSON.stringify(audio),
    "Active media source JSON:",
    JSON.stringify({
      project: sources.project
        ? {
            id: sources.project.id,
            slug: sources.project.slug,
            title: sources.project.title,
          }
        : null,
      animationScenes: sources.animation?.scenes.map((scene) => ({
        sceneId: scene.sceneId,
        outputAssetId: scene.outputAssetId,
      })),
      video: sources.video
        ? {
            outputAssetId: sources.video.outputAssetId,
            scenes: sources.video.scenes.map((scene) => ({
              sceneId: scene.sceneId,
              outputAssetId: scene.outputAssetId,
            })),
          }
        : null,
      audio: {
        outputAssetId: audio.outputAssetId,
        sections: audio.sections.map((section) => ({
          chapterId: section.chapterId,
          outputAssetId: section.outputAssetId,
        })),
      },
    }),
  ].join("\n");
}
