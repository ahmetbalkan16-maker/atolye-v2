"use client";

import type { VisualData } from "@/types/visual";

interface VisualPromptPreviewProps {
  visualData: VisualData;
  onChange: (updatedVisualData: VisualData) => void;
  onGenerateScene: (sceneId: number) => void;
  generatingSceneId?: number | null;
  disabled?: boolean;
}

export default function VisualPromptPreview({
  visualData,
  onChange,
  onGenerateScene,
  generatingSceneId,
  disabled = false,
}: VisualPromptPreviewProps) {
  function updateScenePrompt(sceneId: number, visualPrompt: string) {
    onChange({
      ...visualData,
      scenes: visualData.scenes.map((scene) =>
        scene.sceneId === sceneId
          ? {
              ...scene,
              visualPrompt,
            }
          : scene,
      ),
    });
  }

  return (
    <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold text-yellow-400">
          Görsel Prompt Önizleme
        </h3>
        <span className="text-xs font-medium text-zinc-500">
          {visualData.scenes.length} sahne
        </span>
      </div>

      <div className="mt-4 space-y-4">
        {visualData.scenes.map((scene) => (
          <div
            key={scene.sceneId}
            className="rounded-lg border border-zinc-800 bg-zinc-900 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-zinc-200">
                Sahne {scene.sceneId}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {scene.style ? (
                  <span className="rounded-full bg-zinc-800 px-2 py-1 text-xs text-zinc-300">
                    {scene.style}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => onGenerateScene(scene.sceneId)}
                  disabled={disabled}
                  className="rounded-lg border border-yellow-500/40 px-3 py-1.5 text-xs font-semibold text-yellow-300 transition hover:border-yellow-400 hover:text-yellow-200 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:text-zinc-500"
                >
                  {generatingSceneId === scene.sceneId
                    ? "Üretiliyor..."
                    : "Bu Sahneyi Üret"}
                </button>
              </div>
            </div>

            <label
              className="mt-3 block text-xs font-semibold uppercase tracking-wide text-zinc-500"
              htmlFor={`visual-prompt-${scene.sceneId}`}
            >
              Visual Prompt
            </label>
            <textarea
              id={`visual-prompt-${scene.sceneId}`}
              value={scene.visualPrompt}
              onChange={(event) =>
                updateScenePrompt(scene.sceneId, event.target.value)
              }
              rows={5}
              className="mt-2 w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-sm leading-6 text-zinc-200 outline-none transition placeholder:text-zinc-600 focus:border-yellow-400"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
