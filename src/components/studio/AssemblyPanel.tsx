import type { AssemblyPlanData } from "@/types/assembly";
import StudioCard from "./StudioCard";

type AssemblyPanelProps = {
  assembly: AssemblyPlanData | null;
};

export default function AssemblyPanel({ assembly }: AssemblyPanelProps) {
  return (
    <StudioCard title="Kurgu Paneli">
      {!assembly ? (
        <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
          Kurgu planı henüz oluşturulmadı.
        </p>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 text-sm text-zinc-300 md:grid-cols-3">
            <Info label="Toplam Süre" value={assembly.totalDuration} />
            <Info label="Video Stili" value={assembly.style} />
            <Info label="Render Durumu" value={assembly.render?.status ?? "planned"} />
          </div>

          <div className="space-y-4">
            {assembly.scenes.map((scene) => (
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
      <p className="mt-1 text-zinc-200">{value}</p>
    </div>
  );
}
