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

  /**
   * Physical distribution bundle materialized under
   * data/projects/<slug>/export/bundle/. Absent when the export was plan-only
   * (no persisted project to bundle from, e.g. an inline-body API request
   * without a projectSlug) or when materialization has not run.
   */
  bundle?: ExportBundleInfo;
}

/** One physically materialized file inside export/bundle/. */
export interface ExportBundleFileEntry {
  fileName: string;

  /** Canonical Asset id the file was copied from, when it originates from the asset registry. */
  sourceAssetId?: string;

  /** Logical source stage/package the file was derived from (e.g. "assembly", "audio"). */
  sourcePackage?: string;

  byteLength: number;

  /** Lowercase hex SHA-256 of the file's exact bytes. */
  sha256: string;

  status: "packaged" | "failed";
}

/**
 * export_manifest.json contents. `checksum` is a detached self-hash: it is
 * computed over the canonical JSON serialization of every other field (with
 * `checksum` itself absent from that serialization), then attached last.
 */
export interface ExportBundleManifest {
  schemaVersion: "1";

  projectId?: string;

  slug?: string;

  createdAt: string;

  files: ExportBundleFileEntry[];

  checksum: string;
}

export type ExportBundleStatus = "packaged" | "failed" | "skipped";

export interface ExportBundleInfo {
  status: ExportBundleStatus;

  /** Logical path of the canonical bundle directory, e.g. data/projects/<slug>/export/bundle. */
  path?: string;

  files?: ExportBundleFileEntry[];

  /** The bundle manifest's own detached checksum (ExportBundleManifest.checksum). */
  manifestChecksum?: string;

  reason?: string;
}
