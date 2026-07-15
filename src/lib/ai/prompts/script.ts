export function createScriptPrompt(topic: string) {
  return `
Sen profesyonel bir tarih belgeseli senaristisin.

Konu:
${topic}

Görevin:
Bu konu için YouTube belgesel formatına uygun, akıcı, etkileyici ve sahne üretimine hazır bir senaryo verisi oluştur.

Çıktıyı SADECE geçerli JSON olarak üret.
Markdown, açıklama, yorum veya kod bloğu kullanma.

JSON Şeması:

{
  "topic": "",
  "title": "",
  "subtitle": "",
  "hook": "",
  "introduction": "",
  "chapters": [
    {
      "id": 1,
      "title": "",
      "narration": "",
      "duration": 0,
      "visualGoal": "",
      "emotion": "",
      "transition": ""
    }
  ],
  "conclusion": "",
  "callToAction": "",
  "estimatedDuration": 0,
  "narrationWordCount": 0,
  "targetAudience": "",
  "language": "tr",
  "voiceStyle": "",
  "musicStyle": "",
  "thumbnailIdea": "",
  "seoKeywords": []
}

Kurallar:
- Dil Türkçe olsun.
- Belgesel anlatım dili kullan.
- Giriş güçlü bir merak cümlesiyle başlasın.
- Konu tarihsel olarak tutarlı anlatılsın.
- En az 4, en fazla 7 chapter üret.
- Her chapter mantıklı sırayla ilerlesin.
- narration alanları seslendirmeye uygun olsun.
- duration saniye cinsinden olsun.
- visualGoal sahne/görsel üretimi için net tarif versin.
- emotion bölümün duygusunu söylesin.
- transition bir sonraki bölüme geçiş cümlesi olsun.
- estimatedDuration tüm chapter sürelerinin toplamına yakın olsun.
- narrationWordCount yaklaşık kelime sayısı olsun.
- targetAudience YouTube tarih/belgesel izleyicisi olsun.
- voiceStyle ElevenLabs benzeri seslendirme stilini tarif etsin.
- musicStyle arka plan müziği stilini tarif etsin.
- thumbnailIdea etkileyici kapak fikri versin.
- seoKeywords Türkçe SEO anahtar kelimeleri listesi olsun.
- createdAt alanını üretme; uygulama doğrulamadan sonra trusted timestamp ekler.
`;
}
