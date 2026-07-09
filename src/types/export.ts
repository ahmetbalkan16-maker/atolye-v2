export type ExportStatus =
  | "planned"
  | "packaging"
  | "packaged"
  | "failed";

export type ExportProviderName =
  | "mock";

export type ExportFormat =
  | "json"
  | "zip"
  | "folder";

export type ExportItemType =
  | "project"
  | "video"
  | "audio"
  | "assembly"
  | "thumbnail"
  | "youtube"
  | "seo"
  | "manifest";

export interface ExportItem {
  id: string;

  type: ExportItemType;

  label: string;

  fileName: string;

  sourcePackage?: string;

  sourceAssetId?: string;

  required: boolean;

  included: boolean;

  status: ExportStatus;

  notes?: string;
}

export interface ExportManifest {
  projectId?: string;

  slug?: string;

  title?: string;

  format: ExportFormat;

  version: 1;

  items: ExportItem[];

  createdAt: string;
}

export interface ExportPackageData {
  projectId?: string;

  slug?: string;

  provider?: ExportProviderName | string;

  model?: string;

  status: ExportStatus;

  format: ExportFormat;

  manifest: ExportManifest;

  items: ExportItem[];

  outputPath?: string;

  outputUrl?: string;

  checksum?: string;

  notes: string[];

  createdAt: string;

  updatedAt?: string;
}
