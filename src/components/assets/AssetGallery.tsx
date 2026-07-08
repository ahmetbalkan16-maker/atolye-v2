"use client";

import { useEffect, useState } from "react";
import type { Asset } from "@/types/asset";
import type { VisualData } from "@/types/visual";
import VisualPromptPreview from "./VisualPromptPreview";

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

type AssetGroup = {
  key: string;
  title: string;
  assets: Asset[];
  activeAsset: Asset | null;
  otherAssets: Asset[];
};

export default function AssetGallery({
  projectId,
  projectSlug,
  visualData,
}: AssetGalleryProps) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatingSceneId, setGeneratingSceneId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [editableVisualData, setEditableVisualData] =
    useState<VisualData | null>(visualData);
  const hasVisualPlan = Boolean(editableVisualData);
  const assetGroups = groupAssetsByScene(assets);

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
    if (!editableVisualData || generating) {
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
          visualData: editableVisualData,
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

  async function generateSceneAsset(sceneId: number) {
    if (!editableVisualData || generating) {
      return;
    }

    try {
      setGenerating(true);
      setGeneratingSceneId(sceneId);
      setError("");

      const res = await fetch("/api/assets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId,
          projectSlug,
          visualData: editableVisualData,
          sceneId,
        }),
      });
      const data = (await res.json()) as AssetsResponse;

      if (!res.ok || !data.success) {
        setError(data.error || "Sahne asset uretimi tamamlanamadi.");
        return;
      }

      await loadAssets();
    } catch (err) {
      console.error("[AssetGallery] Scene asset generation failed:", err);
      setError("Sahne asset uretimi sirasinda hata olustu.");
    } finally {
      setGenerating(false);
      setGeneratingSceneId(null);
    }
  }

  useEffect(() => {
    loadAssets();
  }, [projectSlug]);

  useEffect(() => {
    setEditableVisualData(visualData);
  }, [visualData]);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-white">Görsel Üretimleri</h2>
        <button
          type="button"
          onClick={generateAssets}
          disabled={!hasVisualPlan || generating}
          className="rounded-xl bg-yellow-400 px-4 py-2 text-sm font-bold text-black transition hover:bg-yellow-300 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
        >
          {generating ? "Üretiliyor..." : "Tüm Sahne Görsellerini Üret"}
        </button>
      </div>

      {!hasVisualPlan ? (
        <p className="mt-3 text-sm text-zinc-500">
          Önce görsel plan oluşturulmalı.
        </p>
      ) : null}

      {generating ? (
        <p className="mt-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">
          Sahne görselleri üretiliyor. Bu işlem tamamlanana kadar buton
          pasif kalacak.
        </p>
      ) : null}

      {editableVisualData ? (
        <VisualPromptPreview
          visualData={editableVisualData}
          onChange={setEditableVisualData}
          onGenerateScene={generateSceneAsset}
          generatingSceneId={generatingSceneId}
          disabled={generating}
        />
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
          Henüz asset bulunmuyor. Görsel plan hazırsa tüm sahne görsellerini
          üretebilirsin.
        </p>
      ) : null}

      {!loading && !error && assets.length > 0 ? (
        <div className="mt-5 space-y-6">
          {assetGroups.map((group) => (
            <section key={group.key} className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-semibold text-white">{group.title}</h3>
                <span className="text-xs font-medium text-zinc-500">
                  {group.assets.length} versiyon
                </span>
              </div>

              {group.activeAsset ? (
                <AssetCard
                  asset={group.activeAsset}
                  active
                  generating={generating}
                  generatingSceneId={generatingSceneId}
                  onRegenerate={generateSceneAsset}
                />
              ) : null}

              {group.otherAssets.length > 0 ? (
                <div>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Diğer Versiyonlar
                  </p>
                  <div className="grid gap-4 md:grid-cols-2">
                    {group.otherAssets.map((asset) => (
                      <AssetCard
                        key={asset.id}
                        asset={asset}
                        generating={generating}
                        generatingSceneId={generatingSceneId}
                        onRegenerate={generateSceneAsset}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
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

function AssetCard({
  asset,
  active = false,
  generating,
  generatingSceneId,
  onRegenerate,
}: {
  asset: Asset;
  active?: boolean;
  generating: boolean;
  generatingSceneId: number | null;
  onRegenerate: (sceneId: number) => void;
}) {
  return (
    <article className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <AssetPreview asset={asset} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold text-yellow-400">
          {getAssetName(asset)}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {active ? (
            <span className="rounded-full bg-yellow-400 px-2 py-1 text-xs font-bold text-black">
              ⭐ Aktif
            </span>
          ) : null}
          <span className="rounded-full bg-zinc-800 px-2 py-1 text-xs font-medium text-zinc-300">
            {asset.status}
          </span>
          {typeof asset.sceneId === "number" ? (
            <button
              type="button"
              onClick={() => onRegenerate(asset.sceneId as number)}
              disabled={generating}
              className="rounded-lg border border-yellow-500/40 px-3 py-1.5 text-xs font-semibold text-yellow-300 transition hover:border-yellow-400 hover:text-yellow-200 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:text-zinc-500"
            >
              {generatingSceneId === asset.sceneId
                ? "Üretiliyor..."
                : "Yeniden Üret"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3 text-sm text-zinc-400 sm:grid-cols-2">
        <Info label="Type" value={asset.type} />
        <Info label="Provider" value={asset.provider} />
        <Info label="Oluşturulma" value={formatDate(asset.createdAt)} />
      </div>

      {asset.status === "failed" || asset.error ? (
        <p className="mt-4 rounded-lg border border-red-500/30 bg-red-950/30 p-3 text-sm text-red-300">
          {asset.error || "Asset üretimi başarısız oldu."}
        </p>
      ) : null}

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Prompt
        </p>
        <p className="mt-2 line-clamp-4 whitespace-pre-line text-sm leading-6 text-zinc-300">
          {asset.prompt}
        </p>
      </div>
    </article>
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

function groupAssetsByScene(assets: Asset[]): AssetGroup[] {
  const groups = new Map<string, Asset[]>();

  for (const asset of assets) {
    const key =
      typeof asset.sceneId === "number" ? `scene-${asset.sceneId}` : "unassigned";
    const groupAssets = groups.get(key) ?? [];

    groupAssets.push(asset);
    groups.set(key, groupAssets);
  }

  return Array.from(groups.entries())
    .map(([key, groupAssets]) => {
      const sortedAssets = sortAssetsByNewest(groupAssets);
      const activeAsset = getActiveAsset(sortedAssets);

      return {
        key,
        title: getGroupTitle(sortedAssets[0]),
        assets: sortedAssets,
        activeAsset,
        otherAssets: activeAsset
          ? sortedAssets.filter((asset) => asset.id !== activeAsset.id)
          : sortedAssets,
      };
    })
    .sort((a, b) => getGroupSortValue(a) - getGroupSortValue(b));
}

function getActiveAsset(assets: Asset[]) {
  return (
    sortAssetsByNewest(
      assets.filter(
        (asset) => asset.type === "image" && asset.status === "generated",
      ),
    )[0] ?? null
  );
}

function sortAssetsByNewest(assets: Asset[]) {
  return [...assets].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

function getGroupTitle(asset: Asset | undefined) {
  if (typeof asset?.sceneId === "number") {
    return `Sahne ${asset.sceneId}`;
  }

  return "Sahne bilgisi olmayan assetler";
}

function getGroupSortValue(group: AssetGroup) {
  const firstAsset = group.assets[0];

  if (typeof firstAsset?.sceneId === "number") {
    return firstAsset.sceneId;
  }

  return Number.MAX_SAFE_INTEGER;
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
