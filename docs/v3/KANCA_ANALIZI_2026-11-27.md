# Short kancası ve abone dönüşümü — kanıt (27 Kasım 2026)

Owner: "neredeyse hiç takip gelmiyor kanalımıza, insanları çekecek başlangıçlar yapmamız gerekiyor".
Kaynak: YouTube Analytics kayıtları (`_kutuphane/kanal/performans/*.json`) ve her Short'un yapım klasörü
(`episode.json`, `plan.json`; saniye → sahne/satır `ChannelAnalyticsMap.placeAt`).

## Ne ölçüldü

| Bulgu | Sayı | Dayanak |
|---|---|---|
| Abone | 11 videoda ~14.900 görüntüleme, toplam 1 abone | tüm kayıtlar |
| Reklam payı | uzun Short'larda görüntülemenin %82–99,8'i reklam | trafik kaynakları |
| En dik erken düşüş | ölçülen 10 Short'un hepsinde 4,4–9,8. sn | tutma eğrisi |
| O anda ekranda | bir tarih/hazırlık satırı okunuyor, ekranda hiçbir şey kıpırdamıyor | zaman çizelgesi |
| İlk harita hamlesi | 23 Kasım'dan beri çıkan 3 soru Short'unda 13,6–24. sn | plan.json |
| En iyi organik Short | Sezar ("Never Kidnap a Future Emperor"): sahnede karakterin esprisiyle açıldı, 24 kelimede ilk hamle | q8JW_i5Gt0M |

Not: "uzun Short kötü tutuyor" sonucu karışık eğriden geliyor (reklam izleyicisi). Yalnız organik eğride uzun
Short'lar %15 noktasında 0,79–1,06 tutuyor; bu yüzden süre kısaltma kuralı EKLENMEDİ.

## Değişen kurallar ve karşıladıkları bulgu

| Kural | Bulgu |
|---|---|
| İlk hamle en geç ~10 sn / 24 kelime (önce 12 sn / 30) | 4,4–9,8 sn düşüşü; ilk hamle 13,6–24 sn |
| Haritada rozetin esprisi ilk hamle sayılmaz; hamle okları ve beliren/yayılan sınırlar sayılır | hareketsiz ekranda düşüş |
| Yalnız rozetlerin konuştuğu harita Short'una da onarım isteği gider | aynı |
| Tehlike satırını ana karakter de söyleyebilir | Sezar'ın açılışı |
| Short açıklamasında kısa cevabın altına kanalın vaadi + yayın günleri | 1 abone / 14.900 görüntüleme |
| Son satırın açık sorusundan sabitlenecek yorum (`youtube.json` → `paket.sabitYorum`; API sabitleyemez, elle) | yorum 1000'de 0,2 |

Kod: `ShortOpening.ts`, `ScriptPrompts.ts` (SHORTS_RULES tr+en), `content/v3/kanal-hedefleri.json`
(`ilk_hamle`, `abonelik`), `ChannelGoals.subscribeTexts`, `PublishCalendar.slotDaysText`,
`ClosingLine.closingQuestion`, `YoutubePackage.descriptionLead`, `scripts/atolye-v3.ts`.
