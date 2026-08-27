"use client";

import { useState } from "react";
import type { AssemblyPlanData } from "@/types/assembly";
import StudioCard from "./StudioCard";
import VideoPreview from "./VideoPreview";

type AssemblyPanelProps = {
  slug: string;
  assembly: AssemblyPlanData | null;
  canGenerate: boolean;
};

type AssemblyResponse = {
  success?: boolean;
  assembly?: AssemblyPlanData | null;
  error?: string;
};

function getAssemblyVideoUrl(slug: string, assembly: AssemblyPlanData): string | null {
  if (assembly.render?.outputUrl) {
    return assembly.render.outputUrl;
  }
  if (assembly.render?.filePath) {
    const fileName = assembly.render.filePath.split(/[/\\]/).pop();
    if (fileName && fileName.endsWith(".mp4")) {
      return `/api/assets/videos/${encodeURIComponent(slug)}/${encodeURIComponent(fileName)}`;
    }
  }
  if (assembly.render?.status === "rendered") {
    return `/api/assets/videos/${encodeURIComponent(slug)}/output.mp4`;
  }
  return null;
}

export default function AssemblyPanel({
  slug,
  assembly,
  canGenerate,
}: AssemblyPanelProps) {
  const [localAssembly, setLocalAssembly] =
    useState<AssemblyPlanData | null>(assembly);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  async function generateAssembly() {
    if (!canGenerate || generating) {
      return;
    }

    try {
      setGenerating(true);
      setError("");

      const response = await fetch("/api/assembly", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ slug }),
      });
      const data = (await response.json()) as AssemblyResponse;

      if (!response.ok || !data.success) {
        setError(data.error || "Kurgu paketi olusturulamadi.");
        return;
      }

      if (data.assembly) {
        setLocalAssembly(data.assembly);
      }
    } catch (err) {
      console.error("[AssemblyPanel] Assembly generation failed:", err);
      setError("Kurgu paketi olusturulurken hata olustu.");
    } finally {
      setGenerating(false);
    }
  }

  const assemblyVideoUrl = localAssembly
    ? getAssemblyVideoUrl(slug, localAssembly)
    : null;

  return (
    <StudioCard title="Kurgu Paneli">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-400">
          Sahne video ve ses kaynaklarını birleştirerek alt yazılı, müzikli ve geçişli nihai MP4 kurgu videosunu üretir.
        </p>
        <button
          type="button"
          onClick={generateAssembly}
          disabled={!canGenerate || generating}
          className="rounded-xl border border-yellow-500/40 px-4 py-2 text-sm font-bold text-yellow-300 transition hover:border-yellow-400 hover:text-yellow-200 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:text-zinc-500"
        >
          {generating ? "Kurgu olusturuluyor..." : "Kurgu paketi olustur"}
        </button>
      </div>

      {!canGenerate ? (
        <p className="mt-4 rounded-xl border border-dashed border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
          Kurgu paketi icin video ve ses asamalari tamamlanmali.
        </p>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-950/30 p-4 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {!localAssembly ? (
        <p className="mt-4 rounded-xl border border-dashed border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
          Kurgu planı henüz oluşturulmadı.
        </p>
      ) : (
        <div className="mt-5 space-y-6">
          {assemblyVideoUrl ? (
            <VideoPreview
              src={assemblyVideoUrl}
              title="Nihai MP4 Kurgu Videosu"
              durationSeconds={localAssembly.render?.durationSeconds}
              width={localAssembly.render?.width ?? 1920}
              height={localAssembly.render?.height ?? 1080}
              byteLength={localAssembly.render?.byteLength}
              badgeText={
                localAssembly.render?.status === "rendered"
                  ? "Render Tamamlandı (MP4)"
                  : "Kurgu Hazır (MP4)"
              }
              downloadFileName={`${slug}-assembly-output.mp4`}
            />
          ) : null}

          <div className="grid gap-4 text-sm text-zinc-300 md:grid-cols-3">
            <Info label="Durum" value={localAssembly.status ?? "planned"} />
            <Info label="Toplam Süre" value={localAssembly.totalDuration} />
            <Info label="Video Stili" value={localAssembly.style} />
            <Info
              label="Kaynak Video"
              value={localAssembly.sourceVideoAssetId ?? "Belirtilmedi"}
            />
            <Info
              label="Kaynak Ses"
              value={localAssembly.sourceAudioAssetId ?? "Belirtilmedi"}
            />
            <Info
              label="Render Durumu"
              value={localAssembly.render?.status ?? "planned"}
            />
          </div>

          <div className="space-y-4">
            {localAssembly.scenes.map((scene) => (
              <div
                key={scene.sceneId}
                className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-semibold text-yellow-400">
                    Kurgu Sahnesi {scene.sceneId}
                  </h3>
                  <span className="text-sm text-zinc-400">
                    {scene.duration}
                  </span>
                </div>

                <div className="mt-4 grid gap-4 text-sm text-zinc-300 md:grid-cols-2">
                  <Info label="Görsel Referans" value={scene.visualReference} />
                  <Info label="Ses Referansı" value={scene.audioReference} />
                  <Info
                    label="Animasyon Asset"
                    value={scene.animationAssetId ?? "Yok"}
                  />
                  <Info
                    label="Video Asset"
                    value={scene.videoAssetId ?? "Yok"}
                  />
                  <Info
                    label="Audio Asset"
                    value={scene.audioAssetId ?? "Yok"}
                  />
                  <Info label="Geçiş" value={scene.transition} />
                  <Info label="Kamera Hareketi" value={scene.cameraMovement} />
                </div>

                {scene.effects.length > 0 && (
                  <p className="mt-3 text-sm text-zinc-400">
                    Efektler: {scene.effects.join(", ")}
                  </p>
                )}

                {scene.notes && (
                  <p className="mt-3 text-sm leading-7 text-zinc-300">
                    {scene.notes}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </StudioCard>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <p className="mt-1 break-all text-zinc-200">{value}</p>
    </div>
  );
}
