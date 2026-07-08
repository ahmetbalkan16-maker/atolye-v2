"use client";

import { useState } from "react";
import { VideoService } from "@/lib/video/VideoService";
import type { VideoData } from "@/types/video";
import StudioCard from "./StudioCard";

type VideoPanelProps = {
  slug: string;
  video: VideoData | null;
  canGenerate: boolean;
};

export default function VideoPanel({
  slug,
  video,
  canGenerate,
}: VideoPanelProps) {
  const [localVideo, setLocalVideo] = useState<VideoData | null>(video);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  async function generateVideo() {
    if (!canGenerate || generating) {
      return;
    }

    try {
      setGenerating(true);
      setError("");

      const result = await VideoService.generateVideo({ slug });

      if (result.video) {
        setLocalVideo(result.video);
      }
    } catch (err) {
      console.error("[VideoPanel] Video generation failed:", err);
      setError("Video uretimi sirasinda hata olustu.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <StudioCard title="Video Paneli">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-zinc-400">
            Aktif animasyon assetlerinden mock video çıktısı oluşturur.
          </p>
        </div>

        <button
          type="button"
          onClick={generateVideo}
          disabled={!canGenerate || generating}
          className="rounded-xl border border-yellow-500/40 px-4 py-2 text-sm font-bold text-yellow-300 transition hover:border-yellow-400 hover:text-yellow-200 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:text-zinc-500"
        >
          {generating ? "Video uretiliyor..." : "Video uret"}
        </button>
      </div>

      {!canGenerate ? (
        <p className="mt-4 rounded-xl border border-dashed border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
          Video uretimi icin once animation asamasi tamamlanmali.
        </p>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-950/30 p-4 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {localVideo ? (
        <div className="mt-5 space-y-4">
          <div className="grid gap-4 text-sm text-zinc-300 md:grid-cols-3">
            <Info label="Durum" value={localVideo.status} />
            <Info label="Provider" value={localVideo.provider ?? "mock"} />
            <Info
              label="Video Asset"
              value={localVideo.outputAssetId ?? "Olusturulmadi"}
            />
          </div>

          <div className="space-y-3">
            {localVideo.scenes.map((scene) => (
              <div
                key={scene.sceneId}
                className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-semibold text-yellow-400">
                    Video Sahnesi {scene.sceneId}
                  </h3>
                  <span className="text-sm text-zinc-400">{scene.status}</span>
                </div>
                <div className="mt-3 grid gap-3 text-sm text-zinc-300 md:grid-cols-2">
                  <Info
                    label="Kaynak Animasyon"
                    value={scene.sourceAnimationAssetId}
                  />
                  <Info
                    label="Çıktı Asset"
                    value={scene.outputAssetId ?? "Olusturulmadi"}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
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
