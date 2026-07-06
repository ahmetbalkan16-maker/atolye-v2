import { runPipeline } from "../pipeline";
import type { ResearchData } from "@/types/project";

export async function researchStep(topic: string): Promise<ResearchData> {
  const prompt = `
Sen profesyonel bir tarih araştırmacısısın.

Konu:
${topic}

Bu konu için YouTube belgesel üretimine uygun kapsamlı bir araştırma hazırla.

Çıktıyı SADECE geçerli JSON olarak üret.
Markdown, açıklama, yorum veya kod bloğu kullanma.

JSON Şeması:

{
  "topic": "",
  "summary": "",
  "historicalContext": "",
  "timeline": [],
  "characters": [],
  "locations": [],
  "keyEvents": [],
  "strategies": [],
  "controversies": [],
  "interestingFacts": [],
  "documentaryFlow": [],
  "sceneIdeas": [],
  "imagePrompts": [],
  "animationPrompts": [],
  "musicIdeas": [],
  "soundEffects": [],
  "thumbnailIdeas": [],
  "youtubeTitles": [],
  "sources": []
}

Kurallar:
- Dil Türkçe olsun.
- Tarihsel olarak tutarlı ol.
- Belgesel üretimine uygun bilgi ver.
- timeline kronolojik sırada olsun.
- characters önemli kişilerden oluşsun.
- locations önemli coğrafi yerleri içersin.
- keyEvents ana olayları içersin.
- strategies savaş, siyaset veya yönetim stratejilerini içersin.
- controversies tartışmalı tarihsel noktaları içersin.
- interestingFacts izleyicinin ilgisini çekecek kısa bilgiler olsun.
- documentaryFlow belgeselin akış sırasını versin.
- sceneIdeas video sahnelerine uygun fikirler olsun.
- imagePrompts görsel üretim için net promptlar olsun.
- animationPrompts Pika / Kling benzeri araçlara uygun olsun.
- musicIdeas sahne atmosferine uygun müzik fikirleri versin.
- soundEffects kullanılabilecek ses efektlerini versin.
- thumbnailIdeas tıklanabilir kapak görseli fikirleri versin.
- youtubeTitles YouTube için etkili başlık önerileri versin.
- sources güvenilir kaynak veya kaynak türü önerileri olsun.
`;

  const text = await runPipeline(prompt);

  try {
    return JSON.parse(text) as ResearchData;
  } catch (error) {
    console.error("RESEARCH PARSE ERROR:", text);

    return {
      topic,
      summary: text,
      historicalContext: "",
      timeline: [],
      characters: [],
      locations: [],
      keyEvents: [],
      strategies: [],
      controversies: [],
      interestingFacts: [],
      documentaryFlow: [],
      sceneIdeas: [],
      imagePrompts: [],
      animationPrompts: [],
      musicIdeas: [],
      soundEffects: [],
      thumbnailIdeas: [],
      youtubeTitles: [],
      sources: [],
    };
  }
}