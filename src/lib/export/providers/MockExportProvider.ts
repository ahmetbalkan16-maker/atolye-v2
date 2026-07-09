import type {
  ExportFormat,
  ExportItem,
  ExportItemType,
  ExportPackageData,
  ExportStatus,
} from "@/types/export";
import type {
  ExportGenerationInput,
  ExportGenerationResult,
  ExportProvider,
} from "./ExportProvider";

export class MockExportProvider implements ExportProvider {
  async generateExportPackage(
    input: ExportGenerationInput,
  ): Promise<ExportGenerationResult> {
    const exportPackage = createMockExportPackage(input);

    return {
      provider: "mock",
      model: "mock-export-packager",
      status: "planned",
      package: exportPackage,
    };
  }
}

export function createMockExportPackage(
  input: ExportGenerationInput,
): ExportPackageData {
  const now = new Date().toISOString();
  const format = normalizeFormat(input.format);
  const projectId = input.projectId ?? input.project?.id;
  const slug = input.projectSlug ?? input.project?.slug;
  const title =
    input.title ??
    input.project?.title ??
    input.assembly?.title ??
    input.youtube?.metadata.title;
  const items = createExportItems(input);

  return {
    projectId,
    slug,
    provider: "mock",
    model: "mock-export-packager",
    status: "planned",
    format,
    manifest: {
      projectId,
      slug,
      title,
      format,
      version: 1,
      items,
      createdAt: now,
    },
    items,
    notes: createNotes(items, format),
    createdAt: now,
    updatedAt: now,
  };
}

function createExportItems(input: ExportGenerationInput): ExportItem[] {
  return [
    createItem({
      id: "project",
      type: "project",
      label: "Project metadata",
      fileName: "project.json",
      sourcePackage: "project",
      required: true,
      included: Boolean(input.project || input.projectId || input.projectSlug),
    }),
    createItem({
      id: "video",
      type: "video",
      label: "Final video plan",
      fileName: "video.json",
      sourcePackage: "video",
      sourceAssetId: input.video?.outputAssetId,
      required: true,
      included: Boolean(input.video),
    }),
    createItem({
      id: "audio",
      type: "audio",
      label: "Final audio plan",
      fileName: "audio.json",
      sourcePackage: "audio",
      sourceAssetId: input.audio?.outputAssetId,
      required: true,
      included: Boolean(input.audio),
    }),
    createItem({
      id: "assembly",
      type: "assembly",
      label: "Assembly package",
      fileName: "assembly.json",
      sourcePackage: "assembly",
      sourceAssetId: input.assembly?.outputAssetId,
      required: true,
      included: Boolean(input.assembly),
    }),
    createItem({
      id: "thumbnail",
      type: "thumbnail",
      label: "Thumbnail plan",
      fileName: "thumbnail.json",
      sourcePackage: "thumbnail",
      sourceAssetId: input.thumbnail?.generation?.imageUrl,
      required: true,
      included: Boolean(input.thumbnail),
    }),
    createItem({
      id: "seo",
      type: "seo",
      label: "SEO package",
      fileName: "seo.json",
      sourcePackage: "seo",
      required: false,
      included: Boolean(input.seo),
    }),
    createItem({
      id: "youtube",
      type: "youtube",
      label: "YouTube publishing package",
      fileName: "youtube.json",
      sourcePackage: "youtube",
      sourceAssetId: input.youtube?.assetReferences.videoAssetId,
      required: true,
      included: Boolean(input.youtube),
    }),
    createItem({
      id: "manifest",
      type: "manifest",
      label: "Export manifest",
      fileName: "manifest.json",
      sourcePackage: "manifest",
      required: true,
      included: true,
    }),
  ];
}

function createItem(input: {
  id: string;
  type: ExportItemType;
  label: string;
  fileName: string;
  sourcePackage: string;
  sourceAssetId?: string;
  required: boolean;
  included: boolean;
}): ExportItem {
  return {
    id: input.id,
    type: input.type,
    label: input.label,
    fileName: input.fileName,
    sourcePackage: input.sourcePackage,
    sourceAssetId: input.sourceAssetId,
    required: input.required,
    included: input.included,
    status: input.included ? "planned" : "failed",
    notes: input.included
      ? "Mock export item reference prepared; no physical file was created."
      : "Source package missing; item is not included in the export plan.",
  };
}

function createNotes(items: ExportItem[], format: ExportFormat): string[] {
  const missingRequired = items.filter((item) => item.required && !item.included);
  const notes = [
    `Mock-first export package planned as ${format}; no zip, folder, render or upload was created.`,
  ];

  if (missingRequired.length > 0) {
    notes.push(
      `Missing required export sources: ${missingRequired
        .map((item) => item.type)
        .join(", ")}.`,
    );
  }

  return notes;
}

function normalizeFormat(format: ExportFormat | undefined): ExportFormat {
  if (format === "zip" || format === "folder" || format === "json") {
    return format;
  }

  return "json";
}
