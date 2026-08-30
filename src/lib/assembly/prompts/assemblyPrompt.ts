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
      '      "chapterId": 1,',
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
    "- Deliberately vary transitions between scenes; do not repeat the same transition type or " +
      "phrasing back-to-back.",
    "- The scenes are short shots. Between two consecutive scenes that share the same chapterId " +
      'use "cut" (the shots are one continuous moment). Reserve "fade" or "crossfade" for the ' +
      "junction where chapterId changes, or for a deliberate time skip inside a chapter. This " +
      "keeps the cut clean and stops slow dissolves from eating the narration.",
    '- Prefer "cut" for continuing the same visual flow, fast pacing, and battle/action or ' +
      "rapid-succession moments.",
    '- Prefer "fade"/"crossfade" for time skips, chapter or mood changes, and calm or reflective ' +
      "moments.",
    "- Do not use only cut or only fade/crossfade for the whole video; produce a realistic, " +
      "context-appropriate mix (in practice: mostly cuts, with a fade/crossfade at each chapter change).",
    "- Use each chapter's transition field from the Script JSON as context, but make the final " +
      "call at the assembly level.",
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
