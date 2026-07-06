import { NextResponse } from "next/server";
import { VisualEngine } from "../../../src/lib/visuals/VisualEngine";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const { scenes, style = "cinematic" } = body;

    if (!Array.isArray(scenes)) {
      return NextResponse.json(
        {
          success: false,
          error: "Scenes dizisi gönderilmedi.",
        },
        { status: 400 }
      );
    }

    const prompts = VisualEngine.generatePrompts(scenes, style);

    return NextResponse.json({
      success: true,
      prompts,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        success: false,
        error: "Visual Engine çalıştırılamadı.",
      },
      { status: 500 }
    );
  }
}