import { NextResponse } from "next/server";

import { loadBrainConsoleSnapshot } from "@/lib/brain/ui/BrainConsoleSnapshot";

/**
 * `GET /api/brain/snapshot` — read-only aggregate of the Brain's durable state
 * for the Brain Core UI and any future Beyin Merkezi client. It runs nothing:
 * no task, no model, no pipeline, no GPU, no outbound network. The execution
 * gate is not exposed here.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await loadBrainConsoleSnapshot();
    return NextResponse.json(
      { success: true, snapshot },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "brain snapshot failed",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
