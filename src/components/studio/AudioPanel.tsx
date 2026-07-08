"use client";

import { useState } from "react";
import { AudioService } from "@/lib/audio/AudioService";
import type { AudioData } from "@/types/audio";
import StudioCard from "./StudioCard";

type AudioPanelProps = {
  slug: string;
  audio: AudioData | null;
  canGenerate: boolean;
};

export default function AudioPanel({
  slug,
  audio,
  canGenerate,
}: AudioPanelProps) {
  const [localAudio, setLocalAudio] = useState<AudioData | null>(audio);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  async function generateAudio() {
    if (!canGenerate || generating) {
      return;
    }

    try {
      setGenerating(true);
      setError("");

      const result = await AudioService.generateAudio({ slug });

      if (result.audio) {
        setLocalAudio(result.audio);
      }
    } catch (err) {
      console.error("[AudioPanel] Audio generation failed:", err);
      setError("Ses uretimi sirasinda hata olustu.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <StudioCard title="Seslendirme Paneli">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-400">
          Senaryo anlatimindan mock audio assetleri olusturur.
        </p>
        <button
          type="button"
          onClick={generateAudio}
          disabled={!canGenerate || generating}
          className="rounded-xl border border-yellow-500/40 px-4 py-2 text-sm font-bold text-yellow-300 transition hover:border-yellow-400 hover:text-yellow-200 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:text-zinc-500"
        >
          {generating ? "Ses uretiliyor..." : "Ses uret"}
        </button>
      </div>

      {!canGenerate ? (
        <p className="mt-4 rounded-xl border border-dashed border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
          Ses uretimi icin once video ve senaryo asamalari hazir olmali.
        </p>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-950/30 p-4 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {!localAudio ? (
        <p className="mt-4 rounded-xl border border-dashed border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
          Seslendirme planı henüz üretilmedi.
        </p>
      ) : (
        <div className="mt-5 space-y-6">
          <div className="grid gap-4 text-sm text-zinc-300 md:grid-cols-3">
            <Info label="Anlatıcı Stili" value={localAudio.narrator.style} />
            <Info label="Ton" value={localAudio.narrator.tone} />
            <Info label="Dil" value={localAudio.narrator.language} />
            <Info label="Müzik Duygusu" value={localAudio.music.mood} />
            <Info label="Müzik Önerisi" value={localAudio.music.suggestion} />
            <Info
              label="Toplam Süre"
              value={localAudio.production.estimatedTotalDuration}
            />
            <Info
              label="Durum"
              value={localAudio.status ?? localAudio.production.generationStatus}
            />
            <Info
              label="Provider"
              value={localAudio.provider ?? localAudio.narrator.voiceProvider ?? "planned"}
            />
            <Info
              label="Audio Asset"
              value={localAudio.outputAssetId ?? "Oluşturulmadı"}
            />
          </div>

          <div className="space-y-4">
            {localAudio.sections.map((section) => (
              <div
                key={section.chapterId}
                className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-semibold text-yellow-400">
                    Bölüm {section.chapterId}: {section.title}
                  </h3>
                  <span className="text-sm text-zinc-400">
                    {section.status ?? section.duration}
                  </span>
                </div>

                <div className="mt-3 grid gap-3 text-sm text-zinc-300 md:grid-cols-2">
                  <Info label="Süre" value={section.duration} />
                  <Info
                    label="Çıktı Asset"
                    value={section.outputAssetId ?? "Oluşturulmadı"}
                  />
                </div>

                <p className="mt-3 text-sm leading-7 text-zinc-300">
                  {section.narrationNotes}
                </p>

                {section.emphasis.length > 0 && (
                  <p className="mt-3 text-sm text-zinc-400">
                    Vurgu: {section.emphasis.join(", ")}
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
