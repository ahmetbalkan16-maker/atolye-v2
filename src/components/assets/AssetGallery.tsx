"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimationService } from "@/lib/animation/AnimationService";
import type { AnimationData } from "@/types/animation";
import type { Asset } from "@/types/asset";
import type { SceneData } from "@/types/scene";
import type { VisualData } from "@/types/visual";
import VisualPromptPreview from "./VisualPromptPreview";

interface AssetGalleryProps {
  projectId: string;
  projectSlug: string;
  scenes: SceneData | null;
  visualData: VisualData | null;
  animationData?: AnimationData | null;
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

async function fetchProjectAssets(projectSlug: string) {
  const res = await fetch(
    `/api/assets?projectSlug=${encodeURIComponent(projectSlug)}`,
  );
  const data = (await res.json()) as AssetsResponse;

  if (!res.ok || !data.success) {
    throw new Error(data.error || "Assetler yuklenemedi.");
  }

  return data.assets ?? [];
}

export default function AssetGallery({
  projectId,
  projectSlug,
  scenes,
  visualData,
  animationData = null,
}: AssetGalleryProps) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loadedProjectSlug, setLoadedProjectSlug] = useState("");
  const [reloadingAssets, setReloadingAssets] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatingAnimations, setGeneratingAnimations] = useState(false);
  const [generatingSceneId, setGeneratingSceneId] = useState<number | null>(null);
  const [generatingAnimationSceneId, setGeneratingAnimationSceneId] =
    useState<number | null>(null);
  const [error, setError] = useState("");
  const [visualDataSource, setVisualDataSource] =
    useState<VisualData | null>(visualData);
  const [editableVisualData, setEditableVisualData] =
    useState<VisualData | null>(visualData);
  const [animationDataSource, setAnimationDataSource] =
    useState<AnimationData | null>(animationData);
  const [localAnimationData, setLocalAnimationData] =
    useState<AnimationData | null>(animationData);
  const latestProjectSlugRef = useRef(projectSlug);
  const loading = reloadingAssets || loadedProjectSlug !== projectSlug;
  const hasVisualPlan = Boolean(editableVisualData);
  const canGenerateAnimations = Boolean(scenes && editableVisualData);
  const imageAssets = assets.filter((asset) => asset.type === "image");
  const animationAssets = assets.filter((asset) => asset.type === "animation");
  const animationActiveAssetIds = useMemo(
    () => buildActiveAssetIdMap(localAnimationData),
    [localAnimationData],
  );
  const imageAssetGroups = groupAssetsByScene(imageAssets);
  const animationAssetGroups = groupAssetsByScene(
    animationAssets,
    animationActiveAssetIds,
  );

  if (visualData !== visualDataSource) {
    setVisualDataSource(visualData);
    setEditableVisualData(visualData);
  }

  if (animationData !== animationDataSource) {
    setAnimationDataSource(animationData);
    setLocalAnimationData(animationData);
  }

  async function loadAssets() {
    const requestedProjectSlug = projectSlug;

    try {
      setReloadingAssets(true);
      setError("");

      const nextAssets = await fetchProjectAssets(requestedProjectSlug);

      if (latestProjectSlugRef.current !== requestedProjectSlug) {
        return;
      }

      setAssets(nextAssets);
      setLoadedProjectSlug(requestedProjectSlug);
    } catch (err) {
      console.error("[AssetGallery] Asset loading failed:", err);

      if (latestProjectSlugRef.current === requestedProjectSlug) {
        setError("Assetler yuklenirken hata olustu.");
      }
    } finally {
      setReloadingAssets(false);
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

  async function generateAnimations() {
    if (!scenes || !editableVisualData || generatingAnimations) {
      return;
    }

    try {
      setGeneratingAnimations(true);
      setError("");

      const result = await AnimationService.generateFromSceneVisualData({
        projectId,
        projectSlug,
        scenes,
        visuals: editableVisualData,
      });

      if (result.animationData) {
        setLocalAnimationData(result.animationData);
      }

      await loadAssets();
    } catch (err) {
      console.error("[AssetGallery] Animation generation failed:", err);
      setError("Animasyon uretimi sirasinda hata olustu.");
    } finally {
      setGeneratingAnimations(false);
    }
  }

  async function generateSceneAnimation(sceneId: number) {
    if (!scenes || !editableVisualData || generatingAnimations) {
      return;
    }

    try {
      setGeneratingAnimations(true);
      setGeneratingAnimationSceneId(sceneId);
      setError("");

      const result = await AnimationService.regenerateSceneAnimation({
        projectId,
        projectSlug,
        scenes,
        visuals: editableVisualData,
        sceneId,
      });

      if (result.animationData) {
        setLocalAnimationData(result.animationData);
      }

      await loadAssets();
    } catch (err) {
      console.error("[AssetGallery] Scene animation generation failed:", err);
      setError("Sahne animasyon uretimi sirasinda hata olustu.");
    } finally {
      setGeneratingAnimations(false);
      setGeneratingAnimationSceneId(null);
    }
  }

  useEffect(() => {
    latestProjectSlugRef.current = projectSlug;
  }, [projectSlug]);

  useEffect(() => {
    let cancelled = false;

    async function loadProjectAssets() {
      try {
        const nextAssets = await fetchProjectAssets(projectSlug);

        if (cancelled) {
          return;
        }

        setAssets(nextAssets);
        setError("");
      } catch (err) {
        console.error("[AssetGallery] Asset loading failed:", err);

        if (!cancelled) {
          setError("Assetler yuklenirken hata olustu.");
        }
      } finally {
        if (!cancelled) {
          setLoadedProjectSlug(projectSlug);
        }
      }
    }

    loadProjectAssets();

    return () => {
      cancelled = true;
    };
  }, [projectSlug]);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-white">Görsel Üretimleri</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={generateAnimations}
            disabled={!canGenerateAnimations || generatingAnimations}
            className="rounded-xl border border-yellow-500/40 px-4 py-2 text-sm font-bold text-yellow-300 transition hover:border-yellow-400 hover:text-yellow-200 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:text-zinc-500"
          >
            {generatingAnimations ? "Animasyon uretiliyor..." : "Animasyon uret"}
          </button>
          <button
            type="button"
            onClick={generateAssets}
            disabled={!hasVisualPlan || generating}
            className="rounded-xl bg-yellow-400 px-4 py-2 text-sm font-bold text-black transition hover:bg-yellow-300 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
          >
            {generating ? "Uretiliyor..." : "Tum Sahne Gorsellerini Uret"}
          </button>
        </div>
      </div>

      {!hasVisualPlan ? (
        <p className="mt-3 text-sm text-zinc-500">
          Önce görsel plan oluşturulmalı.
        </p>
      ) : null}

      {!scenes ? (
        <p className="mt-3 text-sm text-zinc-500">
          Animasyon uretimi icin once sahne plani olusturulmali.
        </p>
      ) : null}

      {generating ? (
        <p className="mt-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">
          Sahne görselleri üretiliyor. Bu işlem tamamlanana kadar buton
          pasif kalacak.
        </p>
      ) : null}

      {generatingAnimations ? (
        <p className="mt-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">
          Sahne animasyonlari uretiliyor. Bu islem tamamlanana kadar animasyon
          butonu pasif kalacak.
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
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-bold text-white">Gorsel Uretimleri</h3>
              <span className="text-xs font-medium text-zinc-500">
                {imageAssets.length} asset
              </span>
            </div>

            {imageAssetGroups.length > 0 ? (
              <AssetGroupList
                groups={imageAssetGroups}
                generating={generating}
                generatingSceneId={generatingSceneId}
                onRegenerate={generateSceneAsset}
                showRegenerate
              />
            ) : (
              <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
                Henuz gorsel asset bulunmuyor.
              </p>
            )}
          </section>

          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-bold text-white">Animasyon Uretimleri</h3>
              <span className="text-xs font-medium text-zinc-500">
                {animationAssets.length} asset
              </span>
            </div>

            {animationAssetGroups.length > 0 ? (
              <AssetGroupList
                groups={animationAssetGroups}
                generating={generatingAnimations}
                generatingSceneId={generatingAnimationSceneId}
                onRegenerate={generateSceneAnimation}
                showRegenerate
              />
            ) : (
              <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
                Henuz animasyon asset bulunmuyor.
              </p>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}

function AssetGroupList({
  groups,
  generating,
  generatingSceneId,
  onRegenerate,
  showRegenerate,
}: {
  groups: AssetGroup[];
  generating: boolean;
  generatingSceneId: number | null;
  onRegenerate: (sceneId: number) => void;
  showRegenerate: boolean;
}) {
  return (
    <div className="space-y-6">
      {groups.map((group) => (
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
              onRegenerate={onRegenerate}
              showRegenerate={showRegenerate}
            />
          ) : null}

          {group.otherAssets.length > 0 ? (
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Diger Versiyonlar
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                {group.otherAssets.map((asset) => (
                  <AssetCard
                    key={asset.id}
                    asset={asset}
                    generating={generating}
                    generatingSceneId={generatingSceneId}
                    onRegenerate={onRegenerate}
                    showRegenerate={showRegenerate}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ))}
    </div>
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
      {/* eslint-disable-next-line @next/next/no-img-element -- Asset previews can be local API paths, remote URLs, data URLs, or blob URLs; plain img preserves the current preview behavior without requiring image config. */}
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
  showRegenerate = true,
}: {
  asset: Asset;
  active?: boolean;
  generating: boolean;
  generatingSceneId: number | null;
  onRegenerate: (sceneId: number) => void;
  showRegenerate?: boolean;
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
          {showRegenerate && typeof asset.sceneId === "number" ? (
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

function groupAssetsByScene(
  assets: Asset[],
  activeAssetIds: Map<number, string> = new Map(),
): AssetGroup[] {
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
      const sceneId = sortedAssets[0]?.sceneId;
      const preferredAssetId =
        typeof sceneId === "number" ? activeAssetIds.get(sceneId) : undefined;
      const activeAsset = getActiveAsset(sortedAssets, preferredAssetId);

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

function buildActiveAssetIdMap(animationData: AnimationData | null) {
  const activeAssetIds = new Map<number, string>();

  if (!animationData) {
    return activeAssetIds;
  }

  for (const scene of animationData.scenes) {
    if (scene.outputAssetId) {
      activeAssetIds.set(scene.sceneId, scene.outputAssetId);
    }
  }

  return activeAssetIds;
}

function getActiveAsset(assets: Asset[], preferredAssetId?: string) {
  if (preferredAssetId) {
    const matched = assets.find((asset) => asset.id === preferredAssetId);

    if (matched) {
      return matched;
    }
  }

  const assetType = assets[0]?.type;
  const generatedAssets = assets.filter(
    (asset) =>
      asset.status === "generated" &&
      (!assetType || asset.type === assetType),
  );

  return (
    sortAssetsByNewest(generatedAssets)[0] ??
    sortAssetsByNewest(assets)[0] ??
    null
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
