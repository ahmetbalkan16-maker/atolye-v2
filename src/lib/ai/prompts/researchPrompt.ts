export function researchPrompt(topic: string) {
  return `
Sen profesyonel bir tarih belgeseli araştırmacısısın.

Konu: ${topic}

Görev:
Bu konuyu detaylı, hikaye odaklı ve YouTube belgeseli formatında analiz et.

Çıktı:
1. Hook
2. Tarihsel arka plan
3. Ana olaylar
4. Önemli kişiler
5. Sonuç
6. Sahne önerileri
`;
}