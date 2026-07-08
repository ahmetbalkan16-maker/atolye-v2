"use client";

import { useEffect, useState } from "react";
import type { Asset } from "@/types/asset";
import type { VisualData } from "@/types/visual";

interface AssetGalleryProps {
  projectId: string;
  projectSlug: string;
  visualData: VisualData | null;
}

type AssetsResponse = {
  success?: boolean;
  assets?: Asset[];
  error?: string;
};

export default function AssetGallery({
  projectId,
  projectSlug,
  visualData,
}: AssetGalleryProps) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  async function loadAssets() {
    try {
      setLoading(true);
      setError("");

      const res = await fetch(
        `/api/assets?projectSlug=${encodeURIComponent(projectSlug)}`,
      );
      const data = (await res.json()) as AssetsResponse;

      if (!res.ok || !data.success) {
        setError(data.error || "Assetler yuklenemedi.");
        return;
      }

      setAssets(data.assets ?? []);
    } catch (err) {
      console.error("[AssetGallery] Asset loading failed:", err);
      setError("Assetler yuklenirken hata olustu.");
    } finally {
      setLoading(false);
    }
  }

  async function generateAssets() {
    if (!visualData || generating) {
      return;
    }

    try {
      setGenerating(true);
      setError("");

      const res = await fetch("/api/assets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId,
          projectSlug,
          visualData,
        }),
      });
      const data = (await res.json()) as AssetsResponse;

      if (!res.ok || !data.success) {
        setError(data.error || "Asset uretimi tamamlanamadi.");
        return;
      }

      await loadAssets();
    } catch (err) {
      console.error("[AssetGallery] Asset generation failed:", err);
      setError("Asset uretimi sirasinda hata olustu.");
    } finally {
      setGenerating(false);
    }
  }

  useEffect(() => {
    loadAssets();
  }, [projectSlug]);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-white">Görsel Üretimleri</h2>
        <button
          type="button"
          onClick={generateAssets}
          disabled={!visualData || generating}
          className="rounded-xl bg-yellow-400 px-4 py-2 text-sm font-bold text-black transition hover:bg-yellow-300 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
        >
          {generating ? "Üretiliyor..." : "Görsel Asset Üret"}
        </button>
      </div>

      {!visualData ? (
        <p className="mt-3 text-sm text-zinc-500">
          Görsel plan oluşmadan asset üretimi başlatılamaz.
        </p>
      ) : null}

      {loading ? (
        <p className="mt-4 text-sm text-zinc-500">Assetler yükleniyor...</p>
      ) : null}

      {!loading && error ? (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-950/30 p-4 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {!loading && !error && assets.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
          Henüz asset bulunmuyor.
        </p>
      ) : null}

      {!loading && !error && assets.length > 0 ? (
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {assets.map((asset) => (
            <article
              key={asset.id}
              className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"
            >
              <AssetPreview asset={asset} />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-semibold text-yellow-400">
                  {getAssetName(asset)}
                </h3>
                <span className="rounded-full bg-zinc-800 px-2 py-1 text-xs font-medium text-zinc-300">
                  {asset.status}
                </span>
              </div>

              <div className="mt-4 grid gap-3 text-sm text-zinc-400 sm:grid-cols-2">
                <Info label="Type" value={asset.type} />
                <Info label="Provider" value={asset.provider} />
                <Info label="Oluşturulma" value={formatDate(asset.createdAt)} />
              </div>

              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Prompt
                </p>
                <p className="mt-2 line-clamp-4 whitespace-pre-line text-sm leading-6 text-zinc-300">
                  {asset.prompt}
                </p>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AssetPreview({ asset }: { asset: Asset }) {
  const [failed, setFailed] = useState(false);
  const imageSrc = getAssetImageSource(asset);

  if (!imageSrc || failed) {
    return <AssetPreviewFallback asset={asset} />;
  }

  return (
    <div className="mb-4 aspect-video overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
      <img
        src={imageSrc}
        alt={getAssetName(asset)}
        className="h-full w-full object-cover"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function AssetPreviewFallback({ asset }: { asset: Asset }) {
  return (
    <div className="mb-4 flex aspect-video items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-900">
      <div className="text-center">
        <p className="text-sm font-semibold text-zinc-300">
          {asset.type.toUpperCase()}
        </p>
        <p className="mt-1 text-xs text-zinc-500">Görsel önizleme yok</p>
      </div>
    </div>
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

function getAssetName(asset: Asset) {
  if (asset.sceneId) {
    return `Sahne ${asset.sceneId} Asset`;
  }

  return `${asset.type} asset`;
}

function getAssetImageSource(asset: Asset) {
  const source = asset.url?.trim() || asset.filePath?.trim();

  if (!source) {
    return "";
  }

  if (
    source.startsWith("http://") ||
    source.startsWith("https://") ||
    source.startsWith("/") ||
    source.startsWith("data:image/") ||
    source.startsWith("blob:")
  ) {
    return source;
  }

  return "";
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("tr-TR");
}
