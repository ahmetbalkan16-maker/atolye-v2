import { ProductionHealthEngine } from "./ProductionHealthEngine";
import { ProductionHealthError } from "./ProductionHealthError";
import { isValidProductionProjectSlug } from "./ProductionProjectSlug";
import { ProductionSnapshotBuilder } from "./ProductionSnapshotBuilder";
import { productionHealthSchemaVersion } from "@/types/productionHealth";
import type { ProductionHealthResult } from "@/types/productionHealth";
import type { ProductionSnapshot } from "@/types/productionSnapshot";

export interface GetProductionHealthInput {
  projectSlug: string;
  evaluatedAt?: string;
}

export interface ProductionHealthReport {
  schemaVersion: typeof productionHealthSchemaVersion;
  projectSlug: string;
  generatedAt: string;
  snapshot: ProductionSnapshot;
  health: ProductionHealthResult;
}

export class ProductionHealthService {
  static async getProductionHealth(
    input: GetProductionHealthInput,
  ): Promise<ProductionHealthReport> {
    if (!isValidProductionProjectSlug(input.projectSlug)) {
      throw new ProductionHealthError("INVALID_PROJECT_SLUG");
    }

    const evaluatedAt = input.evaluatedAt ?? new Date().toISOString();
    let snapshot: ProductionSnapshot;

    try {
      snapshot = await ProductionSnapshotBuilder.build(
        input.projectSlug,
        evaluatedAt,
      );
    } catch (error) {
      throw new ProductionHealthError("SNAPSHOT_BUILD_FAILED", {
        cause: error,
      });
    }

    let health: ProductionHealthResult;

    try {
      health = ProductionHealthEngine.evaluate(snapshot, evaluatedAt);
    } catch (error) {
      throw new ProductionHealthError("HEALTH_EVALUATION_FAILED", {
        cause: error,
      });
    }

    return {
      schemaVersion: productionHealthSchemaVersion,
      projectSlug: input.projectSlug,
      generatedAt: evaluatedAt,
      snapshot,
      health,
    };
  }
}

export { isValidProductionProjectSlug } from "./ProductionProjectSlug";
