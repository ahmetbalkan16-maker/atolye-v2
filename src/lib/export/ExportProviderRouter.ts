import type { ExportProviderName } from "@/types/export";
import {
  defaultExportProviderConfig,
  type ExportProviderConfig,
} from "./ExportProviderConfig";
import { MockExportProvider } from "./providers/MockExportProvider";
import type { ExportProvider } from "./providers/ExportProvider";

export class ExportProviderRouter {
  private readonly providers: Record<ExportProviderName, ExportProvider>;
  private readonly config: ExportProviderConfig;

  constructor(
    providers?: Partial<Record<ExportProviderName, ExportProvider>>,
    config: ExportProviderConfig = defaultExportProviderConfig,
  ) {
    this.providers = {
      mock: providers?.mock ?? new MockExportProvider(),
    };
    this.config = config;
  }

  getProvider(providerName = this.config.provider): ExportProvider {
    return this.providers[providerName] ?? this.providers.mock;
  }
}
