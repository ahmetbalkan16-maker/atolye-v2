import { FileStorage } from "@/lib/storage/FileStorage";
import {
  resolveRuntimeStorageContext,
  type RuntimeStorageInput,
} from "@/lib/runtime/RuntimeStoragePaths";
import type { Asset, ProjectAssets } from "@/types/asset";

type CreateAssetInput = Omit<Asset, "id" | "status" | "createdAt"> & {
  id?: string;
  status?: Asset["status"];
  createdAt?: string;
};

type AssetPatch = Partial<Omit<Asset, "id" | "createdAt">>;

export class AssetManager {
  static getAssetsPath(slug: string) {
    return `data/projects/${slug}/assets/assets.json`;
  }

  static createDefaultAssets(
    projectId: string,
    slug: string,
  ): ProjectAssets {
    const now = new Date().toISOString();

    return {
      projectId,
      projectSlug: slug,
      assets: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  static getProjectAssets(
    slug: string,
    projectId: string,
    input: RuntimeStorageInput = {},
  ): ProjectAssets {
    const context = resolveRuntimeStorageContext(input);
    return (
      FileStorage.loadJson<ProjectAssets>(this.getAssetsPath(slug), context) ??
      this.createDefaultAssets(projectId, slug)
    );
  }

  static saveProjectAssets(
    slug: string,
    data: ProjectAssets,
    input: RuntimeStorageInput = {},
  ): ProjectAssets {
    return FileStorage.saveJson(
      this.getAssetsPath(slug),
      data,
      input,
    ) as ProjectAssets;
  }

  static saveProjectAssetsAtomically(
    slug: string,
    data: ProjectAssets,
    input: RuntimeStorageInput = {},
  ): ProjectAssets {
    return FileStorage.saveJsonAtomically(
      this.getAssetsPath(slug),
      data,
      input,
    ) as ProjectAssets;
  }

  static createAsset(input: CreateAssetInput): Asset {
    return {
      ...input,
      id: input.id ?? crypto.randomUUID(),
      status: input.status ?? "planned",
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
  }

  static addAsset(
    slug: string,
    projectId: string,
    asset: Asset,
    input: RuntimeStorageInput = {},
  ): ProjectAssets {
    const context = resolveRuntimeStorageContext(input);
    const current = this.getProjectAssets(slug, projectId, context);
    const now = new Date().toISOString();
    const updatedAssets: ProjectAssets = {
      ...current,
      projectId,
      projectSlug: current.projectSlug ?? slug,
      assets: [...current.assets, asset],
      updatedAt: now,
    };

    return this.saveProjectAssets(slug, updatedAssets, context);
  }

  static addAssetAtomically(
    slug: string,
    projectId: string,
    asset: Asset,
    input: RuntimeStorageInput = {},
  ): ProjectAssets {
    const context = resolveRuntimeStorageContext(input);
    const current = this.getProjectAssets(slug, projectId, context);
    const now = new Date().toISOString();
    return this.saveProjectAssetsAtomically(slug, {
      ...current,
      projectId,
      projectSlug: current.projectSlug ?? slug,
      assets: [...current.assets, asset],
      updatedAt: now,
    }, context);
  }

  static updateAsset(
    slug: string,
    projectId: string,
    assetId: string,
    patch: AssetPatch,
    input: RuntimeStorageInput = {},
  ): ProjectAssets {
    const context = resolveRuntimeStorageContext(input);
    const current = this.getProjectAssets(slug, projectId, context);
    const now = new Date().toISOString();
    const updatedAssets: ProjectAssets = {
      ...current,
      projectId,
      projectSlug: current.projectSlug ?? slug,
      assets: current.assets.map((asset) =>
        asset.id === assetId
          ? {
              ...asset,
              ...patch,
              id: asset.id,
              createdAt: asset.createdAt,
              updatedAt: now,
            }
          : asset,
      ),
      updatedAt: now,
    };

    return this.saveProjectAssets(slug, updatedAssets, context);
  }
}
