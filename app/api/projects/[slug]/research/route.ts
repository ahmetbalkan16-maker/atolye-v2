import { NextResponse } from "next/server";
import { openai } from "@/lib/ai/client";
import { ProjectManager } from "@/lib/project/ProjectManager";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const project = ProjectManager.getProject(slug);

    if (!project) {
      return NextResponse.json(
        { success: false, error: "Proje bulunamadı." },
        { status: 404 }
      );
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `
Sen profesyonel bir Türkçe tarih belgeseli araştırmacısısın.
Sadece geçerli JSON döndür.

Şema:
{
  "topic": "string",
  "summary": "string",
  "historicalContext": "string",
  "timeline": ["string"],
  "characters": ["string"],
  "locations": ["string"],
  "keyEvents": ["string"],
  "strategies": ["string"],
  "controversies": ["string"],
  "interestingFacts": ["string"],
  "documentaryFlow": ["string"],
  "sceneIdeas": ["string"],
  "imagePrompts": ["string"],
  "animationPrompts": ["string"],
  "musicIdeas": ["string"],
  "soundEffects": ["string"],
  "thumbnailIdeas": ["string"],
  "youtubeTitles": ["string"],
  "sources": ["string"]
}
          `,
        },
        {
          role: "user",
          content: `
Proje başlığı: ${project.title}
Proje açıklaması: ${project.description || ""}
          `,
        },
      ],
    });

    const text = response.choices[0].message.content || "{}";
    const research = JSON.parse(text);

    ProjectManager.saveResearch(slug, research);

    return NextResponse.json({
      success: true,
      research,
      message: "Araştırma tamamlandı ve kaydedildi.",
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Araştırma hatası.",
      },
      { status: 500 }
    );
  }
}