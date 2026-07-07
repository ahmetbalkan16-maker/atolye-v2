import type { ThumbnailData } from "@/types/thumbnail";
import StudioCard from "./StudioCard";

type ThumbnailPanelProps = {
  thumbnail: ThumbnailData | null;
};

export default function ThumbnailPanel({ thumbnail }: ThumbnailPanelProps) {
  return (
    <StudioCard title="Thumbnail Paneli">
      {!thumbnail ? (
        <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
          Thumbnail planı henüz üretilmedi.
        </p>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 text-sm text-zinc-300 md:grid-cols-2">
            <Info label="Başlık Fikri" value={thumbnail.titleIdea} />
            <Info label="Ana Konu" value={thumbnail.mainSubject} />
            <Info label="Konsept" value={thumbnail.concept} />
            <Info label="Renk Atmosferi" value={thumbnail.colorStyle} />
            <Info label="Thumbnail Yazısı" value={thumbnail.textSuggestion} />
            <Info
              label="Üretim Durumu"
              value={thumbnail.generation?.status ?? "planned"}
            />
          </div>

          <TextBlock title="Kompozisyon" text={thumbnail.composition} />
          <TextBlock title="Görsel Üretim Promptu" text={thumbnail.imagePrompt} />
          <TextBlock title="Tıklanma Sebebi" text={thumbnail.clickReason} />
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

function TextBlock({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h3 className="font-semibold text-yellow-400">{title}</h3>
      <p className="mt-2 whitespace-pre-line leading-7 text-zinc-300">{text}</p>
    </div>
  );
}
