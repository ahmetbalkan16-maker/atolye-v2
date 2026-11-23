# Knowledgia Shorts incelemesi ve dikey Short (23 Kasım 2026)

Owner: "https://www.youtube.com/@Knowledgia bu hesabın shorts videolarını izle … kapak fotoğraflarından hesap ayarlarına
kadar her şeyi analiz et … bize bir plan çıkar", ardından "bütün planları uygula hepsini atlamadan … bugün yaptığımız
shorts videosuna uyarla, yeni şekliyle yükleyelim".

## Ölçülen (yt-dlp, kare kare inceleme)

- Kanal: 2,2 M abone, doğrulanmış, 2017'den beri. 52 açık Short; medyan izlenme 1,86 M, en iyisi 11 M ("Why wasn't
  Portugal Conquered by Spain?"). 2024'te haftada ~1 Short → o yılın medyanı 2,9 M; 2025'te seyrekleşince 0,87 M.
- Başlık: 52/52 soru (Why/How/What). Anlatıcı 0. saniyede başlığı kelimesi kelimesine okur. Soru kalıplarının medyanı:
  "nasıl oluştu / büyüdü" 4,7 M · "neden olmadı" 2,8 M · "neden çöktü" 1,6 M · tek olay/kişi 1,2 M.
- Süre 46–60 sn (medyan 57), 110–155 kelime. Tek 85 sn'lik Short'u (Kasım 2026) en zayıflarından: 137 k.
- Görüntü: baştan sona DİKEY çizilmiş tek renkli siyasi harita; 60 sn'de 0–7 kesme, ama kamera 1–3 sn'de bir
  yakınlaşıp uzaklaşır; armalar, portreli sancaklar, oklar, bir büyük sayı ("~5 MILLION MUSLIMS"). Karakter/diyalog yok.
- En zayıf ikisi (Stalingrad 216 k, Dunkirk 50 k): siyah açılış, hikâyenin ortasından, soru yok.
- Kapak: yazısız ya da tek soru yazılı, renkli harita karesi. Açıklama kısa (üyelik/Patreon), etiketler sorunun arama
  türevleri. Ham veri ve kolajlar: `D:\ÜRETİM\private\temp\knowledgia-shorts\`.

## Bizdeki en önemli bulgu

12 Kasım'dan beri ("dondur") yatay video 90° döndürülüp yükleniyordu: akışta Short **yan yatık** görünüyor, izleyici
telefonu çevirmiyor. Organik Shorts akışı izlenmesi bununla düştü (Sezar 1.168 ve Cannae 263 dik → Bağdat 99,
Konstantinopolis 2; korelasyon, reklam karışıklığı var ama en güçlü sinyal).

## Yapılanlar (claude/short-dikey-harita)

1. **Dikey Short ("dogal", varsayılan):** harita sahneleri 607,5×1080'lik dikey sahnede çizilir ve 1080×1920 kareyi
   doldurur (`Format.MAP_STAGE_TALL`, `mapStageFor`; Director `mapStage`, `V3Shot.stage`); öteki sahneler 16:9 sahnenin
   tamamı olarak ekranın ortasında dik görünür, üst bantta Short'un sorusu yazar (`V3RenderPlan.shortsView "butun"`,
   `question`; ShotView `QuestionBand`). Yükleme dosyası kesimin kendisi (döndürme yok). Eski düzenler:
   `ATOLYE_V3_SHORTS_BICIM=dondur` / `dikey`. Uzun videolar bit bit aynı.
2. **Soru başlık** (`script/QuestionTitle.ts`, `Episode.soru`): Why/How/What ile başlar, "?" ile biter, 4–14 kelime, ad
   ya da sayı taşır; ilk satır anlatıcının bu soruyu okumasıdır (yazar onarım turunda istenir, olmazsa
   `questionFirst` satırı ekler). YouTube başlığı = soru + "#Shorts"; etiketlerin başında sorunun arama türevleri.
3. **Süre 60 sn** (`AyasVideoOrder.SHORT_ORDER_LENGTH`), vuruş haritası 0–3 soru, 3–8 tehlike, 8–12 ilk hamle,
   12–30 nedenler + tek büyük sayı, 30–50 dönüm, 50–60 cevap + davet (`kanal-hedefleri.json`), soru kalıpları yazara.
4. **Harita payı %85–95** (`MapRules.SHORT_MAP_SHARE`, QC `SHORTS_PICTURE_SHARE_TARGET`); ilk sahne harita; çöp adamlar
   rozetlerinden konuşur, en çok bir kısa sonuç sahnesi.
5. **Tempo:** açılış kuralı 7 → 3 sn (`OPENING_CHANGE_S`); Short haritası her 3 sn'de 0,8 sn'lik yakınlaş/uzaklaş
   (`Director.mapPulse`, değişim sayımına girer).
6. **Boş/siyah açılış hata:** Short'un ilk sahnesi her zaman düz kesmeyle girer; `Director.blankOpening` QC satırı ve
   kurul bulgusu.
7. **Açıklama:** soru, kısa cevap, hashtag'ler; bütün kaynak ve atıflar "Sources & credits" başlığı altında (lisans
   gereği hiçbiri silinmez).
8. **Takvim:** haftada 3 Short (Salı, Perşembe, Cumartesi 15:00 NY).
9. **Ölçüm:** `kanal.ts rapor` her videoda toplam / reklam / organik / Shorts akışı ayrımı ve organik akışa göre tablo
   (`ChannelAnalyticsMap.viewSplit`).
10. Dikey haritada ok adı, okun göründüğü andaki kameranın dar görüşüne sığdırılır (Stalingrad önizlemesinde "NORTH
    PINCER" kenarda kesiliyordu; `placeStateLabels` `frame`).

## Owner'a kalanlar (kodla yapılamaz)

- YouTube Studio → Ayarlar → Kanal → varsayılan video dili: **İngilizce (ABD)** (şu an boş; API izinlerimiz yazmıyor).
- Reklam: ilk dikey Short'ları reklamsız yayınlayıp organik akışı ölçmek önerilir (reklam izleyicisinin videoda kalma
  oranı %15–22, akışınki %38–47).
- Shorts kapağı: mobil YouTube uygulamasından parlak, adları yazılı bir harita karesi seçilebilir.
