import { NextResponse } from "next/server";
import {
  getPipelineStatePublicError,
  isPipelineStateError,
} from "./PipelineStateError";

export function createPipelineStateErrorResponse(
  error: unknown,
  logContext: string,
): NextResponse | null {
  if (!isPipelineStateError(error)) {
    return null;
  }

  console.error(logContext, {
    code: error.code,
    state: error.state,
    failure: error.failure,
    fileName: error.fileName,
    cause: error.cause,
  });

  const publicError = getPipelineStatePublicError(error);

  if (!publicError) {
    return null;
  }

  return NextResponse.json(
    {
      success: false,
      code: publicError.code,
      error: publicError.message,
    },
    { status: 500 },
  );
}
