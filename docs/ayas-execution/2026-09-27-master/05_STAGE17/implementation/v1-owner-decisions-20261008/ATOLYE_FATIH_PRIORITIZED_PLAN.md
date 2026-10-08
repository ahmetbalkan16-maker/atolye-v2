# Atölye — Fatih videosu: önceliklendirilmiş düzeltme planı (12 Ekim haftası)

**Durum: PLAN / YENİ RENDER YOK / YOUTUBE YÜKLEMESİ YOK / ÜCRETLİ ÇAĞRI YOK.** Bulguların tamamı [../v1-final-closure-20261008/ATOLYE_FATIH_REVIEW.md](../v1-final-closure-20261008/ATOLYE_FATIH_REVIEW.md) içinde. Bu belge onları owner'ın verdiği beş başlığa göre sıralar ve kaynakta yeni doğrulanan bir engeli ekler.

## Yeni doğrulanan engel: mevcut yeniden üretim aracı donmayı tek başına çözemez

- Video aşaması, sahne kliplerini sesten **önce** ve script/sahne planındaki tahmini sürelerle render eder (15/20/20/15/10/10 s). Montaj her sahneyi ölçülmüş TTS süresine uzatır (24,5/19,3/18,6/19,1/17,0/18,6 s); arayı son kareyi dondurarak doldurur ([docs/DURATION_AUTHORITY.md](../../../../../DURATION_AUTHORITY.md)).
- `133864d` düzeltmesi yeni projelerde tahmini **script** aşamasında düzeltir. Mevcut bir projenin sahne sürelerini ölçülmüş sesten yeniden hesaplamaz.
- `production:acceptance:regeneration-plan` / `:prepare-regeneration` yalnız `video` ve `assembly` aşamalarını kabul eder. İkisi de eski sahne hedeflerini yeniden kullanır. Yeni `VideoDurationCoverageGuard` %77 dolguyu reddeder. Sonuç: yalnız video/montaj yeniden üretimi fail-closed durur.
- Planlayıcı da tamamen salt okunur değildir: önce runtime yedek otoritesini başlatır (`bootstrapRuntimeBackupStorageAuthority`). Bu yüzden bu oturumda çalıştırılmadı.

## Öncelik sırası

| # | Sorun (owner başlığı) | Kök neden | Önerilen düzeltme | Maliyet | Kim karar verir |
|---|---|---|---|---|---|
| **P0-1** | Donmuş sahneler (%77 hareketsiz) | Eski sahne hedefleri ile ölçülmüş TTS arasındaki fark | **P0-A paketi:** mevcut proje için ölçülmüş-ses sahne hedefi. `audio.json` bölüm süreleri + mevcut `allocateProductionSceneAudioSegments` → her sahne için yeni video hedefi. Ardından mevcut kapılı yeniden üretim yolundan yerel FFmpeg ile video + montaj | Sıfır (yerel) | Owner: kod paketi onayı, sonra tek render onayı |
| **P0-2** | Kesilmiş kadraj (sahne 1'de yüz/kavuk dışarıda) | Eski render 1024² kareyi 1920 genişliğe büyütüp kesmiş | Güncel `FFmpegSceneVideoProvider` tam kadraj kompozisyonu (`37dc655`) P0-A'daki video yeniden üretiminde kendiliğinden gelir | Sıfır | P0-A ile aynı |
| **P0-3** | Düşük ses (−24,5 LUFS, ~10 dB kısık) | Hiçbir aşama yükseklik normalize etmiyor | **P0-C paketi:** montaj/export'ta iki geçişli `loudnorm`, hedef −14 LUFS ve gerçek tepe ≤ −1 dBTP | Sıfır | Owner: kod paketi onayı. Çift render olmasın diye P0-A ile aynı render'da |
| **P0-4** | Anlatım hatası: "Urban'ı **İstanbul'a** getirtti" (doğrusu: Osmanlı hizmetine girdi, toplar **Edirne'de** döküldü) | Script'teki olgu hatası, seslendirmede var | (a) yalnız 2. bölümün yeniden seslendirilmesi; (b) "İstanbul'a" kelimesinin yerel kesimle çıkarılması (kesim duyulabilir; owner dinleyerek karar verir); (c) tüm bölümlerin yerel Piper ile yeniden seslendirilmesi (ses tutarlılığı için hepsi) | (a) ücretli, düşük; (b, c) sıfır | Owner: sağlayıcı/bütçe |
| **P0-5** | Tarihî anakronizm: sahne 5'te fes ve kristal avize, sahne 6'da modern görünümlü ay-yıldız bayraklar | Görsel üretim istemi | Sahne 5 için yeni görsel (1453 kıyafeti, elçi/antlaşma sahnesi). Sahne 6 önce P0-A tam kadrajıyla yeniden değerlendirilir; yetmezse yeni görsel | Ücretli (görsel başına) | Owner: bütçe |
| P1-1 | Anlatım kapsamı: Rumeli Hisarı (1452) yok; "1000 yıl" yaklaşık | Script kapsamı | Bir paragraf + görsel ekleme ya da "bin yılı aşkın" düzeltmesi | Ücretli (TTS + görsel) | Owner. İlk video için isteğe bağlı |
| P1-2 | Bölüm zaman damgaları yanlış (0/15/35/55/70/80 s) | Plan süreleri kullanılmış | İlk video için açıklamada elle doğru zamanlar (0:00 / 0:24 / 0:43 / 1:02 / 1:21 / 1:38; P0-A sonrası yeniden ölçülür). Kalıcı çözüm B2 paketi | Sıfır | Owner yayında |
| P1-3 | Küçük resim 3:2 (1536×1024) | Şablon | 1280×720'ye kırpma (yerel) | Sıfır | Owner yayında |
| P1-4 | Altyazı bölüm başına tek ipucu | Altyazı üreticisi | İlk video için YouTube otomatik altyazı veya cümle düzeyine bölme (B4, yerel Whisper hizalaması mevcut) | Sıfır | Owner |
| P1-5 | Yapay zekâ beyanı ve kaynaklar yok; anlatıcı kaydı "Google Wavenet" yazıyor (gerçek: OpenAI `tts-1`) | Paket metni / metadata | Açıklamaya "Görseller ve seslendirme yapay zekâ ile üretilmiştir; temsilî canlandırmadır" + kaynak listesi. YouTube'da sentetik içerik beyanı açık. Metadata düzeltmesi | Sıfır | Owner yayında |

## 12 Ekim haftası — önerilen sıra

1. **12 Ekim:** owner mevcut MP4'ü baştan sona izleyip bu listeyi doğrular. P0-A ve P0-C kod paketlerine onay verir. P0-4 ve P0-5 için sağlayıcı/bütçe kararı verir.
2. **12–13 Ekim:** P0-A ve P0-C TEMP'te yazılır ve test edilir:
   - kopyalanmış Fatih proje fixture'ı üzerinde freezedetect, LUFS ve sahne-1 yüz kontrolü;
   - mevcut duration/assembly/regeneration smoke'ları.
   Owner onayıyla gerçek kaynağa alınır. Production kodu değiştiği için `ATOLYE_CHECKPOINT.md`'deki ilgili regresyon seti koşulur.
3. **13–14 Ekim:** owner bütçe onayı verdiyse sahne 5 görseli ve 2. bölüm seslendirmesi yalnız o varlıklar için üretilir. Eski varlıklar append-only kalır.
4. **14 Ekim:** owner'ın açık onayıyla **tek** yerel render (video + montaj; mevcut kapılı yol, doğru runtime context, authenticated owner). Ölçümler: süre, freezedetect payı (hedef: yalnız kare yuvarlama düzeyi), −14 LUFS, sahne-1 yüz görünürlüğü.
5. **15 Ekim:** yayın paketi:
   - 16:9 küçük resim;
   - doğru bölüm zamanları;
   - yapay zekâ beyanı ve kaynaklı açıklama.
   Owner tam izleme/dinleme yapar; yüklemeyi kendi eliyle yapar. Otomatik upload yok.

## Bu plan neyi beklemez, neyi bekler

- AYAS V1/Foundation kapanışını **beklemez**; Atölye CAN_START korunur.
- Gerçek production yazımı yine authenticated owner, mevcut acceptance/regeneration kapıları ve doğru runtime/authority context ister.
- Ücretli her çağrı ayrı owner onayıdır. Bu oturumda hiçbir sağlayıcı çağrılmadı, render yapılmadı, runtime'a yazılmadı.
