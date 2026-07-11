import { NextResponse } from "next/server";
import {
  createProductionHealthErrorResponse,
  noStoreHeaders,
} from "@/lib/production/ProductionHealthApiError";
import { ProductionHealthService } from "@/lib/production/ProductionHealthService";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { slug } = await context.params;
    const data = await ProductionHealthService.getProductionHealth({
      projectSlug: slug,
    });

    return NextResponse.json(
      {
        success: true,
        data,
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return createProductionHealthErrorResponse(error);
  }
}
