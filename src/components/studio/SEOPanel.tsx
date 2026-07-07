import type { SEOData } from "@/types/seo";
import StudioCard from "./StudioCard";

type SEOPanelProps = {
  seo: SEOData | null;
};

export default function SEOPanel({ seo }: SEOPanelProps) {
  return (
    <StudioCard title="SEO Paneli">
      {!seo ? (
        <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
          SEO yayın paketi henüz üretilmedi.
        </p>
      ) : (
        <div className="space-y-6">
          <ListBlock title="Başlık Önerileri" items={seo.titleSuggestions} />
          <TextBlock title="Açıklama" text={seo.description} />

          <div className="grid gap-4 text-sm text-zinc-300 md:grid-cols-2">
            <Info label="Hedef Kitle" value={seo.targetAudience} />
            <Info label="Arama Niyeti" value={seo.searchIntent} />
          </div>

          <TagBlock title="Etiketler" items={seo.tags} />
          <TagBlock title="Hashtagler" items={seo.hashtags} />
          <TagBlock title="Anahtar Kelimeler" items={seo.keywords} />
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

function ListBlock({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
        {title} verisi bulunmuyor.
      </p>
    );
  }

  return (
    <div>
      <h3 className="font-semibold text-yellow-400">{title}</h3>
      <ul className="mt-3 space-y-2 text-zinc-300">
        {items.map((item, index) => (
          <li key={`${title}-${index}`} className="leading-7">
            <span className="mr-2 text-yellow-400">{index + 1}.</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TagBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="font-semibold text-yellow-400">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">Veri bulunmuyor.</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {items.map((item) => (
            <span
              key={`${title}-${item}`}
              className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1 text-sm text-zinc-300"
            >
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
