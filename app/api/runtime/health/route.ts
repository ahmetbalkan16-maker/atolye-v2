import type { NextResponse } from "next/server";
import { getProductionRuntimeStatus } from "@/lib/runtime/ProductionRuntimeCompositionRoot";
import { createProductionRuntimeHealthResponse } from "@/lib/runtime/ProductionRuntimeHealthResponse";
import type { ProductionRuntimeHealthResponse } from "@/types/productionRuntimeHealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const productionDependencies = {
  getRuntimeStatus: getProductionRuntimeStatus,
  now: () => new Date().toISOString(),
};

export function GET(): NextResponse<ProductionRuntimeHealthResponse> {
  return createProductionRuntimeHealthResponse(productionDependencies);
}
