import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function runOpenAIResearch(topic: string) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: `
Sen profesyonel bir tarih araştırmacısısın.

Konu: ${topic}

Bana şu formatta detaylı bir belgesel araştırma raporu hazırla:

1. Kısa Özet
2. Tarihsel Arka Plan
3. Önemli Olaylar
4. Önemli Kişiler
5. Tartışmalı Noktalar
6. Belgesel Açısından Önem
7. Video Senaryosu Fikirleri
        `,
      },
    ],
  });

  return response.choices[0]?.message?.content || "Sonuç alınamadı.";
}

export async function runOpenAIScript(topic: string) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: `
Sen profesyonel bir YouTube tarih belgeseli senaristisin.

Konu: ${topic}

Bu konu için Türkçe, etkileyici, akıcı ve belgesel tarzında bir senaryo hazırla.

Format:

Başlık:
Giriş:
Bölüm 1:
Bölüm 2:
Bölüm 3:
Kapanış:

Kurallar:
- Dil Türkçe olsun.
- Anlatım sıcak ama profesyonel olsun.
- YouTube belgesel anlatımına uygun olsun.
- İzleyiciyi ilk 10 saniyede yakalayacak güçlü bir giriş yaz.
- Gereksiz tekrar yapma.
- Tarihi anlatımı dramatik ama mantıklı tut.
        `,
      },
    ],
  });

  return response.choices[0]?.message?.content || "Script alınamadı.";
}