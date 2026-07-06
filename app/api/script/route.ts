import { NextResponse } from "next/server";
import { scriptStep } from "@/lib/ai/steps/scriptStep";

export async function POST(req: Request) {
  try {
    const { topic } = await req.json();

    if (!topic || topic.trim() === "") {
      return NextResponse.json(
        {
          success: false,
          error: "Konu boş olamaz.",
        },
        { status: 400 }
      );
    }

    const script = await scriptStep(topic);

    return NextResponse.json({
      success: true,
      script,
    });
  } catch (error) {
    console.error("Script API Error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Script oluşturulamadı.",
      },
      { status: 500 }
    );
  }
}