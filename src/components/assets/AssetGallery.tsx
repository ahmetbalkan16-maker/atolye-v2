"use client";

import { useEffect, useState } from "react";
import type { Asset } from "@/types/asset";

interface AssetGalleryProps {
  projectSlug: string;
}

type AssetsResponse = {
  success?: boolean;
  assets?: Asset[];
  error?: string;
};

export default function AssetGallery({ projectSlug }: AssetGalleryProps) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
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

    loadAssets();
  }, [projectSlug]);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <h2 className="text-xl font-bold text-white">Görsel Üretimleri</h2>

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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-semibold text-yellow-400">
                  {asset.type}
                </h3>
                <span className="rounded-full bg-zinc-800 px-2 py-1 text-xs font-medium text-zinc-300">
                  {asset.status}
                </span>
              </div>

              <div className="mt-4 grid gap-3 text-sm text-zinc-400 sm:grid-cols-2">
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

function formatDate(value: string) {
  return new Date(value).toLocaleString("tr-TR");
}
