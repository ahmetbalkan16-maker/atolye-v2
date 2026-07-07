import type { AudioData } from "@/types/audio";
import StudioCard from "./StudioCard";

type AudioPanelProps = {
  audio: AudioData | null;
};

export default function AudioPanel({ audio }: AudioPanelProps) {
  return (
    <StudioCard title="Seslendirme Paneli">
      {!audio ? (
        <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
          Seslendirme planı henüz üretilmedi.
        </p>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 text-sm text-zinc-300 md:grid-cols-3">
            <Info label="Anlatıcı Stili" value={audio.narrator.style} />
            <Info label="Ton" value={audio.narrator.tone} />
            <Info label="Dil" value={audio.narrator.language} />
            <Info label="Müzik Duygusu" value={audio.music.mood} />
            <Info label="Müzik Önerisi" value={audio.music.suggestion} />
            <Info
              label="Toplam Süre"
              value={audio.production.estimatedTotalDuration}
            />
          </div>

          <div className="space-y-4">
            {audio.sections.map((section) => (
              <div
                key={section.chapterId}
                className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-semibold text-yellow-400">
                    Bölüm {section.chapterId}: {section.title}
                  </h3>
                  <span className="text-sm text-zinc-400">
                    {section.duration}
                  </span>
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
      <p className="mt-1 text-zinc-200">{value}</p>
    </div>
  );
}
