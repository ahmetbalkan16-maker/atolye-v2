# Crowns & Doodles — video hedefleri, Shorts standardı ve yayın sonrası öğrenme

Owner kararı, 5 Kasım 2026. Kanal: Crowns & Doodles (`UC3u0Kx_T49g9qdLFOagsN8A`, en-US). Hedefler **kanalımıza özel
deney hedefleridir**; YouTube'un garanti ettiği eşikler değildir.

## Tek kaynak

Bütün sayılar yalnız `content/v3/kanal-hedefleri.json` içindedir. Okuyan modül `src/lib/v3/publish/ChannelGoals.ts`.
Yazar (Short zaman haritası), üretim QC'si (ilk 3 saniye, sahne planı, kanal hedefi notu) ve yayın sonrası rapor bu
dosyadan okur; hiçbiri sayıyı kopyalamaz (`smoke-v3-channel-goals` bunu denetler). Hedefi değiştirmek için yalnız bu
JSON düzenlenir, sonra `npx tsx scripts/v3/kanal.ts hedefler` ile kontrol edilir.

## Başlangıç ölçümü (YouTube Studio, 5 Kasım 2026)

| | Kanal (7 Eki – 3 Kas) | Caesar Short `q8JW_i5Gt0M` (44 sn) |
|---|---|---|
| Görüntüleme | 1.203 | ~1.190 |
| İzlenme süresi | 3,9 sa | 3,8 sa |
| İzlemeyi seçenler / kaydıranlar | %51,9 / %48,1 | %52 / %48 |
| Ortalama görüntüleme | — | 23 sn |
| Aktif izlenme / benzersiz izleyici | — | 560 / 542 |
| Abone | 2 | — |
| Yeni / ara sıra / düzenli izleyici | %66,7 / %33,3 / <%0,1 | — |
| Trafik | Shorts akışı %96,8, arama %0,8 | — |

Ülke: ABD %25,5 (ort. 30 sn), Hindistan %9,6 (19 sn), Almanya %8,0 (22 sn), Filipinler %7,4 (16 sn), İngiltere %4,1
(20 sn), Türkiye %2,6 (18 sn), Kanada %2,3 (32 sn). Studio'da aktif saatler ve izlenen diğer kanallar için **yeterli veri
yok** — bunlar ölçülmedi olarak kalır.

Not: videonun kimliği küçük harfle `q8JW_i5Gt0M`'dir (yt-dlp ile 5 Kasım'da doğrulandı, 44 sn).

## Hedefler

**Short (ILK_DENEY):** izlemeyi seçenler **%58–60** (başlangıç %52); ortalama izlenme **videonun %57,8–62,2'si**
(45 sn'de 26–28 sn; 30 sn'de 17,3–18,7 sn; 60 sn'de 34,7–37,3 sn). Ayrıca izlenir: düzenli izleyici payı, aboneye
dönüşüm, yorum ve beğeni.

**Uzun video:** `HEDEF_TANIMLANMADI` — kanalda ölçülmüş uzun video yok; ilk uzun videonun 7 günlük verisiyle konur.
Tahmini hedef yazılmadı.

**Kurallar:** ölçülmeyen bir metrik `OLCULMEDI`dir ve sonuç `VERI_EKSIK` olur, asla "hedefte" sayılmaz. Hedef yalnız
yükselir: son 3 ölçülen Short'un ortancası bandın üstüne çıkarsa yeni bant oradan başlar (aynı genişlik); kötü bir
video hedefi düşürmez.

## Diziler (öncelik sırasıyla)

1. **History's Most Insane Moments** — şaşırtıcı olaylar, tesadüfler, komik/dramatik anlar (Caesar yaklaşımı). İlk deney önceliği.
2. **Wars That Changed Everything** — kısa savaşlar, beklenmedik zaferler, askerî hatalar.
3. **Rise and Fall of Empires** — Roma, Osmanlı, Moğol ve diğerleri.

## Shorts üretim standardı

Mevcut tarif (`ScriptPrompts.ts`: karakterin 2 sn içinde kancası, tek an, 3–5 sahne, döngülü son, abone daveti yok,
~%70 harita) korunur. Eklenen:

- **Zaman haritası** (yazara bir madde olarak gider, süreye göre ölçeklenir; kanca her zaman 0–2 sn):
  0–2 sn kanca · 2–9 sn bağlam · 9–24 sn çatışma, mizah, gerilim · 24–38 sn en güçlü gelişme ve karşılığı ·
  38–45 sn akılda kalan final, espri ya da yorum sorusu ("abone ol" asla). Hikâyenin akışı önce gelir.
- **İlk 3 saniye QC** (Short'ta, mevcut "Kanca" satırına ek): ilk söz 2 sn içinde, karakterin ve en çok 8 kelime;
  ilk görsel olay ≤ 3 sn; açılışta tam ekran kart yok.
- **Sahne planı QC:** her sahnede kamera hareketi (sahne kamerası ya da harita kamerası), efekt, karakter hareketi
  (jest/hareket/oyun ya da haritada ordu/ok), müzik ruh hali ve (ilk sahne hariç) geçiş. Görsel amaç
  (`arka_plan_sorgusu`) ve diyalog şemada zaten zorunlu. Eksik satırlar yönetmen kuruluna düzeltme önerisi olarak gider.
- **Tarih doğruluğu:** repliklerin dramatize olduğu açıklamada zaten yazıyor ("This video contains dramatization; the
  dialogue is invented for storytelling"); kaynak bankası ve doğrulama turu değişmedi.
- QC.md'nin sonunda "Kanal hedefi" bölümü: bu videonun yayından sonra hangi sayılarla ölçüleceği — üretimde "geçti"
  sayılmaz.

## Yayın sonrası öğrenme döngüsü

Kanal Analytics API'ye bağlı değil (owner, 3 Kasım: elle yükleme). Kaynak owner'ın Studio okumasıdır:

1. `npx tsx scripts/v3/kanal.ts ornek > olcum.json` — boş şablon (bilinmeyen sayı `null`, tahmin yazılmaz; `"52%"`,
   `"1.203"`, `"3,9"` biçimleri okunur).
2. Yayından **48 saat** ve **7 gün** sonra doldur: görüntüleme, aktif izlenme, izlemeyi seçenler, kaydıranlar, ort.
   görüntüleme süresi, ort. görüntülenen yüzde, izlenme süresi, abone kazanımı, beğeni, yorum, benzersiz izleyici,
   ülkeler, trafik kaynakları; varsa `siparisId` ve `pilotNo`.
3. `npx tsx scripts/v3/kanal.ts kaydet --dosya olcum.json` — kayıt `<workRoot>/_kutuphane/kanal/performans/`; hedefe
   göre değerlendirme; kurgu beyninin hafızasına ölçülmüş sayılarla bir ders (aynı videonun eski dersi yenisiyle
   değişir). Yazar sonraki senaryoda bu dersi üretim dersleri kotasından okur.
4. `npx tsx scripts/v3/kanal.ts rapor` — bütün videolar, sonraki Short hedefi, pilot eğilimi.

## Pilot 1 — 6 Short (~45 sn)

| # | Dizi | Konu | Dönem | Saat (TR) |
|---|---|---|---|---|
| 1 | Insane Moments | The Cadaver Synod — ölü papanın yargılanması | 897 | 19:00 |
| 2 | Wars | Anglo-Zanzibar War — tarihin en kısa savaşı (Short'u 4 Kasım'da üretildi) | 1896 | 20:00 |
| 3 | Empires | II. Mehmed gemileri karadan Haliç'e indiriyor | 1453 | 21:00 |
| 4 | Insane Moments | Strasbourg dans vebası | 1518 | 21:00 |
| 5 | Wars | Great Emu War | 1932 | 19:00 |
| 6 | Empires | Cengiz Han'ın elçileri ve Harezm'in ölümcül hakareti | 1218 | 20:00 |

Her dizi iki farklı saate, her saat iki farklı diziye düşer; süre sabit tutulur. Rapor saat etkisini dizinin
ortalamasını çıkardıktan sonra gösterir ve 6 videoda **kesin sonuç değil, ilk eğilim** olduğunu yazar. Her konunun
doğruluk notu JSON'da (tartışmalı sayılar temkinli verilir). Not: mevcut otomatik takvim (`PublishCalendar`) New York
15:00'ü kullanır; pilot elle yüklendiği için saatler owner'ın yüklemesinde uygulanır.

## Henüz yapılmayanlar

- Analytics API bağlantısı yok; ölçüm elle girilir (owner kararı).
- Kamera hareketi / yüz ifadesi / efekt kalitesi QC'de sayılır ama güçlendirmenin kendisi (yeni kamera dili, ifade
  animasyonu) ayrı geliştirme işi — araştırma adayları `docs/research/2026-11-05-ucretsiz-ai-video-arastirmasi.md`.
- Pilot videoların üretimi başlatılmadı (görev: gerçek TTS/medya üretimi yok).
