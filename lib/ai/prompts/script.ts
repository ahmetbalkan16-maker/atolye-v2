export function createScriptPrompt(topic: string) {
  return `
Sen profesyonel bir tarih belgeseli senaristisin.

Konu:

${topic}

Çıktıyı SADECE JSON olarak üret.

Şema:

{
"title":"",
"summary":"",
"sections":[
{
"title":"",
"narration":"",
"duration":0
}
]
}

Kurallar:

- Belgesel dili kullan.
- Bilgiler tarihsel olarak tutarlı olsun.
- Her bölüm mantıklı sırada ilerlesin.
- duration saniye cinsinden olsun.
`;
}