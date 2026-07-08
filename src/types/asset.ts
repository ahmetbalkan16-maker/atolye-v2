export type AssetType =
  | "image"
  | "animation"
  | "thumbnail";

export type AssetStatus =
  | "planned"
  | "generating"
  | "generated"
  | "failed";

export interface Asset {
  id: string;

  projectId: string;

  projectSlug?: string;

  sceneId?: number;

  type: AssetType;

  status: AssetStatus;

  provider: string;

  model?: string;

  prompt: string;

  filePath?: string;

  url?: string;

  mimeType?: string;

  error?: string;

  createdAt: string;

  updatedAt?: string;
}

export interface ProjectAssets {
  projectId: string;

  projectSlug?: string;

  assets: Asset[];

  createdAt: string;

  updatedAt: string;
}
