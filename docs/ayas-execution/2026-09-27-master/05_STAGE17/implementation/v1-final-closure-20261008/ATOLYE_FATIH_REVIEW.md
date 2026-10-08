# Atölye — Fatih adayı: ilk YouTube videosu inceleme ve düzeltme planı

**Durum: İNCELENDİ / YAYINA HAZIR DEĞİL / YENİ RENDER YAPILMADI.** Bu inceleme salt okunurdur: runtime projesine, asset'lere, manifest'e veya YouTube'a hiçbir yazım yapılmadı; ücretli servis çağrılmadı. Kareler ve ölçümler yalnız oturumun geçici klasörüne çıkarıldı. Proje kimliği ve özel yollar bu dosyaya yazılmadı; bağ yalnız digest'lerledir.

## Doğrulanan dosya

| Alan | Değer |
|---|---|
| Proje kaydı digest'i | `adff30787ecad7df872855f4f12de7418120239fbf7e5a4c1cc5396505c2082d` (ATOLYE_EXISTING_OUTPUT_EVIDENCE.json ile aynı) |
| Final MP4 SHA-256 | `b03323fa3bd06283e2b1c1acf8a8b38750d5f07e7fcc5153cc686608d812892b` — asset kopyası ile export bundle kopyası byte olarak aynı |
| Süre / boyut | **116,971 s** (ffprobe), 9.452.948 byte |
| Akışlar | H264 1920×1080 30 fps + AAC |
| Ses | Entegre yükseklik **−24,5 LUFS**, LRA 4,6 LU |

Süre raporlandığı gibi doğrulandı. `assembly.json` planı `01:30` der; gerçek çıktı 116,971 s'dir. Fark bir hata değil, kaynağı aşağıda: plan TTS öncesi tahmin, çıktı gerçek seslendirme süresi.

## Zaman çizelgesi ve hareketsiz kare

Altı sahne kesimi, seslendirmenin altı bölümüyle birebir örtüşür (ffmpeg sahne tespiti 24,47 / 43,73 / 62,30 / 81,37 / 98,33 s; bölüm WAV'ları 24,46 / 19,25 / 18,56 / 19,06 / 16,96 / 18,64 s). Sahne klipleri ise planlanan sürelerle (15+20+20+15+10+10 = 90 s) üretilmiş. Montaj eksik süreyi son kareyi dondurarak (`tpad`) kapatmış.

- ffmpeg `freezedetect` (n=0,003, ≥1 s): toplam **~89,5 s hareketsiz kare**, yani sürenin ~%77'si; en uzun tek donma 16,4 s (98,3→114,7 s).
- Sorun sistemik: ölçülen diğer dört final videoda da hareketsiz pay %36–73, yükseklik −24,5…−24,8 LUFS; beşten dördünün kaynak görseli 1024×1024 kare.
- Bu video, sonradan eklenen iki düzeltmeden **önce** render edilmiş (assembly `updatedAt` 2026-08-08): `133864d` TTS-otoritatif süre uzlaştırması + fail-closed `VideoDurationCoverageGuard` (2026-08-28) ve `37dc655` tam kadraj kompozisyonu (2026-08-08). Güncel kaynakla yeniden render, aynı donmayı "başarılı" kabul etmez.

## Kadraj ve kesilmiş figürler

Kaynak görseller 1024×1024 kare; eski render bunu 1920 genişliğe büyütüp ortadan 1080 yükseklik kesmiş (dikeyin ~%44'ü kayıp).

| Sahne | Zaman | Gözlem | Kaynak görselde düzeltilebilir mi |
|---|---|---|---|
| 1 Tahta çıkış | 0–24 s | **Fatih'in yüzü ve kavuğu kadraj dışında**; yalnız gövde ve çene görünür, dolly-in daha da gövdeye iner | Evet — kaynak karede yüz ve kavuk tam; güncel tam kadraj render'ı yeterli |
| 2 Ordu | 24–44 s | Tek görsel 2×2 kolaj (okçu, top dökümü, kılıççı, yeniçeriler); panel kenarlarında başlar kesik | Kısmen — kolaj kaynağın kendisinde; ya panel panel kaydırma ya yeni tek kompozisyon |
| 3 Top dökümü | 44–62 s | Kadraj kabul edilebilir; erimiş metalin namlu ağzına dökülmesi fiziksel olarak tuhaf | Kabul edilebilir |
| 4 Lojistik / Haliç zinciri | 62–81 s | Kadraj kabul edilebilir; depo + zincir + gemi tek kompozit | Kabul edilebilir |
| 5 Diplomasi | 81–98 s | **Fes giyen heyet** (fes Osmanlı'ya 1829'da girdi) ve kristal avize: 1453 için açık anakronizm; kenar figürler kesik; diplomasi değil iç meclis | Hayır — yeni görsel gerekir |
| 6 Kuşatma başlangıcı | 98–117 s | **Kırmızı zeminde ay-yıldız bayraklar** modern bayrak görünümünde; 1453 için anakronizm riski | Kısmen — kırpma azaltır; temiz çözüm yeni görsel |

## Seslendirme ↔ görsel uyumu ve tarihî kapsam

Seslendirilen metin yalnız altı bölüm anlatımıdır (OpenAI `tts-1`); hook/giriş/sonuç/çağrı metinleri seslendirilmemiş. Bölüm–görsel konuları genel olarak eşleşir; sahne 5 hariç.

Düzeltilmesi gereken içerik:
1. **Urban:** anlatım "Urban'ı **İstanbul'a** getirtti" der. Urban Osmanlı hizmetine girdi ve büyük toplar **Edirne'de** döküldü. Bu cümle seslendirmede var; yayından önce düzeltilmeli.
2. **Yaş:** bölüm 1 "1451'de 19 yaşında" der (kabul edilebilir; 18'ini doldurmuş, 19'una girmek üzere). Seslendirilmeyen giriş metni "21 yaşında tahta oturduğunda" der: çelişki. Açıklama/altyazıda giriş metni kullanılmamalı.
3. **Eksik kapsam:** hazırlığın simgesi **Rumeli Hisarı (Boğazkesen, 1452)** hiç anılmıyor. Diplomasi bölümü genel ve kaynaksız.
4. "1000 yıldır Bizans'ın elinde" yaklaşık ifadedir ("bin yılı aşkın" daha doğru).

## Kaynak, hak ve açıklama riskleri

- **Görseller:** 6 sahne + küçük resim OpenAI `gpt-image-1`. Stok/üçüncü taraf görsel yok. Gerçekçi tarzda tarihî canlandırma oldukları için YouTube'un "değiştirilmiş veya sentetik içerik" beyanı açılmalı ve açıklamaya "Görseller yapay zekâ ile üretilmiş temsilî canlandırmalardır" notu eklenmeli. Arşiv belgesi veya tarihî doğruluk kanıtı olarak sunulmamalı.
- **Ses:** OpenAI `tts-1`. OpenAI'nin TTS kullanım şartı, dinleyiciye sesin yapay zekâ ürünü olduğunun açıkça bildirilmesini ister. Proje metadata'sı anlatıcıyı "Google Wavenet tr-TR-Wavenet-B" diye yazar; gerçek sağlayıcı OpenAI'dir. Kayıt uyumsuzluğu düzeltilmeli.
- **Müzik:** yalnız öneri var, müzik parçası yok. Hak riski yok; izleyici deneyimi için owner isterse YouTube Ses Kitaplığı gibi lisansı açık bir kaynaktan seçer.
- **Kanal riski:** şablon görsel + TTS ile seri üretim, YouTube Partner Programı'nın "orijinal olmayan / tekrarlayan içerik" politikasına takılabilir. Editoryal katkı (kaynaklı anlatım, düzeltilmiş görseller, açıklamada kaynaklar) bu riski azaltır.
- Fatih, Urban ve tarihî figürler gerçek kişilerdir; görseller onların gerçek görünümü olarak sunulmamalıdır.

## Metadata ve paket

- **Bölüm zaman damgaları yanlış:** metadata 0/15/35/55/70/80 s der (plan süreleri); gerçek kesimler **0:00 / 0:24 / 0:43 / 1:02 / 1:21 / 1:38**.
- **Küçük resim 1536×1024 (3:2)**; YouTube için 16:9 (1280×720) olmalı.
- **Altyazı:** zamanlama gerçek seslendirmeye bağlı, fakat her bölüm tek ipucu (17–24 s'lik paragraf): okunamaz; cümle düzeyine bölünmeli.
- **Açıklama:** iki dakikalık video için "kapsamlı", "detaylarıyla" abartılı; yapay zekâ beyanı ve kaynak listesi yok.

## Düzeltme planı (uygulanmadı; her adım ayrı owner onayıyla)

**A. Önce plan, sonra mümkünse sıfır maliyetli yerel yeniden üretim (önerilen ilk adım).** Mevcut görseller ve seslendirme korunur. Önce mevcut yeniden üretim planlayıcısı (`production:acceptance:regeneration-plan`) okunur ve hangi aşamaların gerektiği görülür; yazım yapan `:prepare-regeneration` ancak owner onayından sonra çalışır.
- Tam kadraj (yüz görünür, yanlar bulanık dolgu) için `video` aşaması yeterli; güncel `FFmpegSceneVideoProvider` bunu zaten yapar.
- Donmalar daha zor: sahne klipleri seslendirmeden **önce**, projenin eski tahmini sahne süreleriyle (15/20/20/15/10/10 s) render edilir. Montaj bunları ölçülmüş TTS süresine (24,5/19,3/18,6/19,1/17,0/18,6 s) uzatır. Güncel coverage guard bu kadar büyük dolguyu **reddeder**. Yani yalnız `video`/`assembly` yeniden üretimi büyük olasılıkla fail-closed durur; sahne sürelerini ölçülmüş TTS'e uzlaştırmak `scenes`/`animation` aşamalarını gerektirebilir. Bu doğrulanmadı.
- Planlayıcı görselleri (ücretli `gpt-image-1`) veya seslendirmeyi (ücretli `tts-1`) yeniden üretilecek gösterirse durulur ve C'deki owner bütçe kararına gidilir.
Sağlayıcılar `animation`=ollama, `video`/`assembly`=ffmpeg, `thumbnail`=yerel. Eski asset'ler append-only kalır, JSON elle düzenlenmez.

**B. Sıfır maliyet, küçük kaynak değişiklikleri (owner onayı + test).**
1. Ses mastering: montaj/export'ta −14 LUFS, gerçek tepe ≤ −1 dBTP (`loudnorm`). Şu an hiçbir aşama yükseklik normalize etmiyor; bütün videolar ~10 dB kısık.
2. YouTube bölüm zaman damgalarını gerçek sahne/TTS sınırlarından üretmek.
3. Küçük resmi 1280×720'ye uygun kırpmak.
4. Altyazıyı cümle düzeyine bölmek (yerel Whisper hizalaması mevcut).

**C. Owner kararı gerektiren ücretli/yeni üretim.**
1. Sahne 5 için yeni görsel: 1453 kıyafeti, fes/avize yok; elçi/antlaşma sahnesi.
2. Sahne 6 bayrakları ve sahne 2 kolajı için yeni görsel (veya A'daki tam kadraj ile kabul).
3. Urban cümlesinin düzeltilmesi: yeniden seslendirme. Alternatif, "İstanbul'a" kelimesinin yerel kesimle çıkarılması ("Urban'ı getirtti" doğru kalır); kesim duyulabilir olabilir, owner dinleyerek karar verir.
4. Rumeli Hisarı paragrafı + görseli (kapsam açığını kapatır, süreyi uzatır).

**D. Yayın paketi (owner).** Düzeltilmiş açıklama: AI beyanı, kaynaklar, doğru bölümler. YouTube'da sentetik içerik beyanı açık. Owner MP4'ü baştan sona izleyip dinler; yükleme ve yayın owner'ın elle kararıdır. Otomatik upload yok.

## 12 Ekim ilk somut iş

1. Owner MP4'ü baştan sona izler/dinler ve bu listeyi doğrular. Ardından regeneration-plan çıktısı (exact scope, hangi aşamalar, ücretli çağrı var mı) okunur. Plan ücretsizse ve owner onaylarsa yalnız o aşamalar yeniden üretilir; değilse C'deki bütçe kararı beklenir.
2. Yeni MP4 ve eski MP4 yan yana: süre, hareketsiz pay (freezedetect), sahne 1 yüz görünürlüğü, LUFS ölçülür.
3. Owner tam izleme/dinleme yapar; C maddeleri (sahne 5 görseli, Urban cümlesi, Rumeli Hisarı) için bütçe/provider kararı verir.
4. B1–B4 küçük pipeline düzeltmeleri bundan sonraki her video için ayrı, testli paket olarak hazırlanır.

Bu plan AYAS V1/Foundation kabulünü beklemez; Atölye CAN_START korunur. Gerçek production yazımı yine authenticated owner, mevcut acceptance/regeneration kapıları ve doğru runtime context ister.
