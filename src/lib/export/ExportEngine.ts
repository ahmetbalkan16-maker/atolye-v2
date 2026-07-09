import type { ExportPackageData } from "@/types/export";
import { ExportProviderRouter } from "./ExportProviderRouter";
import {
  createMockExportPackage,
  MockExportProvider,
} from "./providers/MockExportProvider";
import type {
  ExportGenerationInput,
  ExportProvider,
} from "./providers/ExportProvider";

export type GenerateExportPackageInput = ExportGenerationInput & {
  provider?: ExportProvider;
};

export class ExportEngine {
  private readonly router: ExportProviderRouter;

  constructor(router = new ExportProviderRouter()) {
    this.router = router;
  }

  async generateExportPackage(
    input: GenerateExportPackageInput,
  ): Promise<ExportPackageData> {
    try {
      const provider = input.provider ?? this.router.getProvider();
      const result = await provider.generateExportPackage(input);

      if (result.error) {
        return this.createFallback(input);
      }

      return result.package;
    } catch (error) {
      console.error("[ExportEngine] Falling back to mock package:", error);
      return this.createFallback(input);
    }
  }

  private async createFallback(
    input: ExportGenerationInput,
  ): Promise<ExportPackageData> {
    const fallbackProvider = new MockExportProvider();

    try {
      const result = await fallbackProvider.generateExportPackage(input);

      return result.package;
    } catch {
      return createMockExportPackage(input);
    }
  }
}

export async function generateExportPackage(
  input: GenerateExportPackageInput,
): Promise<ExportPackageData> {
  return new ExportEngine().generateExportPackage(input);
}
