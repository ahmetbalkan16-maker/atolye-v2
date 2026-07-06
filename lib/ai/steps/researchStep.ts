import { runPipeline } from "../pipeline";

export async function researchStep(topic: string) {
  const prompt = `
Sen profesyonel bir tarih araştırmacısısın.

Konu:
${topic}

Aşağıdaki başlıklarda kapsamlı bir araştırma hazırla:

1. Kısa Özet
2. Tarihsel Arka Plan
3. Kronoloji
4. Önemli Kişiler
5. Tartışmalı Noktalar
6. Belgesel Açısından Önemi
`;

  return await runPipeline(prompt);
}