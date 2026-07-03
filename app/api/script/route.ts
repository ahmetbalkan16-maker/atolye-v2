import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { research } = await req.json();

    if (!research) {
      return NextResponse.json(
        { success: false, error: "Araştırma verisi bulunamadı." },
        { status: 400 }
      );
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      response_format: { type: "json_object" },
      temperature: 0.8,
      messages: [
        {
          role: "system",
          content: `
Sen profesyonel bir Türkçe tarih belgeseli senaristisin.

Görevin, verilen araştırma paketinden YouTube belgeseli için etkileyici ve düzenli bir senaryo üretmektir.

Cevabın SADECE geçerli JSON olacak.
Markdown veya kod bloğu kullanma.

JSON şeması:
{
  "title": "string",
  "hook": "string",
  "intro": "string",
  "chapters": [
    {
      "title": "string",
      "content": "string"
    }
  ],
  "closing": "string",
  "narrationStyle": "string"
}

Kurallar:
- Dil Türkçe olacak.
- Anlatım güçlü, sinematik ve belgesel tarzında olacak.
- hook ilk 10 saniyede izleyiciyi yakalamalı.
- intro konuyu etkileyici şekilde açmalı.
- chapters en az 5 bölümden oluşmalı.
- Her bölüm uzun ve anlatıma uygun olmalı.
- closing izleyiciye güçlü bir final hissi vermeli.
- Abartılı, gerçek dışı veya uydurma bilgi kullanma.
          `,
        },
        {
          role: "user",
          content: `Araştırma paketi: ${JSON.stringify(research)}`,
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
    console.error("SCRIPT API ERROR:", err);

    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Senaryo üretim hatası",
      },
      { status: 500 }
    );
  }
}