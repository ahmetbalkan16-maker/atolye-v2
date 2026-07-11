import { NextResponse } from "next/server";
import {
  toProductionHealthError,
  type ProductionHealthError,
} from "./ProductionHealthError";

export function createProductionHealthErrorResponse(
  error: unknown,
): NextResponse {
  const domainError = toProductionHealthError(error);
  logProductionHealthError(domainError);

  return NextResponse.json(
    {
      success: false,
      error: {
        code: domainError.code,
        message: domainError.message,
      },
    },
    {
      status: domainError.status,
      headers: noStoreHeaders,
    },
  );
}

export const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0",
} as const;

function logProductionHealthError(error: ProductionHealthError) {
  console.error("[Production Health API] Request failed:", {
    code: error.code,
    cause: error.cause,
  });
}
