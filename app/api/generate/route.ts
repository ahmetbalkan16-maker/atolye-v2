import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { topic } = await req.json();

    if (!topic || typeof topic !== "string") {
      return NextResponse.json(
        { success: false, error: "Konu boş olamaz." },
        { status: 400 }
      );
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      response_format: { type: "json_object" },
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content: `
Sen profesyonel bir Türkçe tarih belgeseli araştırmacısı, senarist ve YouTube içerik stratejistisin.

Görevin, verilen konu için tam bir "AI Belgesel Üretim Paketi" hazırlamaktır.

Cevabın SADECE geçerli JSON olacak.
Markdown, açıklama veya kod bloğu kullanma.

JSON şeması:
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

Kurallar:
- Dil Türkçe olacak.
- Anlatım belgesel tarzında, sade ve etkileyici olacak.
- Konu tarih dışıysa bile belgesel formatına uygun işle.
- Timeline kronolojik olmalı.
- characters bölümünde kişi isimleri ve kısa rolleri olmalı.
- locations bölümünde olayın geçtiği önemli yerler olmalı.
- strategies bölümünde savaş, liderlik veya siyasi stratejiler yazılmalı.
- documentaryFlow YouTube videosunun bölüm akışı gibi yazılmalı.
- sceneIdeas sahne sahne video fikirleri olmalı.
- imagePrompts sinematik, gerçekçi, yapay zekâ görsel üretimine uygun promptlar olmalı.
- animationPrompts Pika, Kling veya Runway gibi araçlara uygun hareket promptları olmalı.
- musicIdeas belgeselin atmosferine uygun müzik tarzları olmalı.
- soundEffects sahnelere uygun ses efektleri olmalı.
- thumbnailIdeas tıklanma oranı yüksek küçük resim fikirleri olmalı.
- youtubeTitles etkileyici ama mantıklı başlıklar olmalı.
- sources bölümüne güvenilir kaynak türleri veya araştırılması gereken kaynak başlıkları yaz.
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