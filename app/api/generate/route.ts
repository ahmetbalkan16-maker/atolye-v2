import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { topic } = await req.json();

    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `
Sen profesyonel bir Türkçe tarih belgeseli araştırmacısısın.
Cevabın SADECE geçerli JSON olacak.
Markdown, açıklama, yorum veya kod bloğu kullanma.

Şema:
{
  "topic": "string",
  "summary": "string",
  "timeline": ["string"],
  "characters": ["string"],
  "controversies": ["string"],
  "documentaryFlow": ["string"],
  "sources": ["string"]
}
`,
        },
        {
          role: "user",
          content: `Belgesel konusu: ${topic}`,
        },
      ],
    });

    const text = response.choices[0].message.content || "{}";
    const data = JSON.parse(text);

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (err) {
    console.error("GENERATE API ERROR:", err);

    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "OpenAI hatası",
      },
      { status: 500 }
    );
  }
}