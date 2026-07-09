import type { ExportProviderName } from "@/types/export";

export type ExportProviderConfig = {
  provider: ExportProviderName;
};

export const defaultExportProviderConfig: ExportProviderConfig = {
  provider: "mock",
};
