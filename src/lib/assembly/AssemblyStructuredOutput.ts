import type { SceneData } from "@/types/scene";

/**
 * Grammar-constraint contract for the assembly-plan response.
 *
 * Mirrors `canonicalAnimationProviderSchema` / the other `*StructuredOutput`
 * modules. `buildAssemblyResponseJsonSchema` produces the JSON Schema passed to
 * a structured-decoding provider (Ollama's `format`) on the fail-closed path so
 * a small local model is held to the exact response shape.
 *
 * Two structural guarantees matter here:
 *  - `scenes` is pinned to exactly `source.scenes.length` items, so the model
 *    cannot drop or invent scenes.
 *  - the system-owned id fields (`animationAssetId`, `videoAssetId`,
 *    `audioAssetId`) are absent from `properties` and `additionalProperties` is
 *    `false`, so the model physically cannot echo a hallucinated id back —
 *    `matchesExpectedAssetId(undefined)` then passes and `AssemblyManager.mapScenes`
 *    fills the deterministic value.
 *
 * Everything semantic (non-empty trimmed strings, `render.status === "planned"`,
 * `render.format === "mp4"`, a round-trip `createdAt`, positional sceneId /
 * chapterId identity) is still enforced by `isStrictAssemblyResponse` in
 * `AssemblyManager`, which runs unchanged.
 */
export const canonicalAssemblyProviderSchema = Object.freeze({
  responseFields: [
    "scenes",
    "totalDuration",
    "style",
    "render",
    "createdAt",
  ] as const,
  sceneFields: [
    "sceneId",
    "chapterId",
    "duration",
    "visualReference",
    "audioReference",
    "transition",
    "cameraMovement",
    "effects",
  ] as const,
  /** Never asked of the model — the fallback plan owns these. */
  systemOwnedSceneFields: [
    "animationAssetId",
    "videoAssetId",
    "audioAssetId",
  ] as const,
  additionalProperties: false,
});

export function buildAssemblyResponseJsonSchema(
  scenes: SceneData,
): Record<string, unknown> {
  const count = Array.isArray(scenes.scenes) ? scenes.scenes.length : 0;
  return {
    type: "object",
    additionalProperties: false,
    required: [...canonicalAssemblyProviderSchema.responseFields],
    properties: {
      scenes: {
        type: "array",
        ...(count > 0 ? { minItems: count, maxItems: count } : { minItems: 1 }),
        items: {
          type: "object",
          additionalProperties: false,
          required: [...canonicalAssemblyProviderSchema.sceneFields],
          properties: {
            sceneId: { type: "integer", minimum: 1 },
            chapterId: { type: "integer", minimum: 1 },
            duration: { type: "string" },
            visualReference: { type: "string" },
            audioReference: { type: "string" },
            transition: { type: "string" },
            cameraMovement: { type: "string" },
            effects: { type: "array", items: { type: "string" } },
            notes: { type: "string" },
          },
        },
      },
      totalDuration: { type: "string" },
      style: { type: "string" },
      render: {
        type: "object",
        additionalProperties: false,
        required: ["status", "format"],
        properties: {
          status: { type: "string", enum: ["planned"] },
          format: { type: "string", enum: ["mp4"] },
        },
      },
      createdAt: { type: "string" },
    },
  };
}
