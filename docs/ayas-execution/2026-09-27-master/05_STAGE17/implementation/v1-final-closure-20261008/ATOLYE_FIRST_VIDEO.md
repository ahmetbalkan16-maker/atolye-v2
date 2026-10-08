# Atölye — 12 Ekim ilk video yolu

**ATÖLYE GEÇİŞİ: CAN_START — yalnız read-only, editoryal ve izole hazırlık.** AYAS V1/Foundation kabulü hâlâ BLOCKED. Bu karar production write, model harcaması, runtime migration veya YouTube upload izni değildir.

Graphify kaynağı `58ec1bd`: PipelineRunner → PipelineStageExecutor; AIManager, AudioPipeline, VideoAssemblyManager, ExportPackager, YouTubePackagePipeline ve YouTubePublishPipeline dosyaları gerçek node/import kenarlarıyla mevcut. [ATOLYE_PIPELINE_GRAPH.json](ATOLYE_PIPELINE_GRAPH.json) file hash'lerini taşır. Graph import kenarı tek başına execution kanıtı değildir; mevcut source contracts ve gerçek artifact probe'larıyla birlikte incelendi. Parser gap'li PowerShell task/wrapper dosyalarının önceki doğrudan incelemesi korunur; semantic PENDING/full-runtime qualification açık.

## Mevcut akış

| Bileşen | Sınıf | Gerçek mevcut tanık | İlk video için sınır/iş |
|---|---|---|---|
| KONU | ÇALIŞIYOR | `/studio` topic/project yolu ve mevcut gerçek proje kayıtları | Owner mevcut Fatih adayını veya yeni konuyu seçer; topic seçim UI'sı yeniden yazılmaz |
| ARAŞTIRMA | ÇALIŞIYOR | AIRouter/AIManager araştırma stage'i; existing research artifact'ları | Kaynak, chronology ve fact doğruluğu editoryal inceleme ister; JSON varlığı fact PASS değildir |
| SENARYO | ÇALIŞIYOR | Research → script → scenes stage'leri; completed script/scene artifacts | Mevcut narration/citations/süre hedefi owner incelemesine girer; yeni director sistemi yok |
| SESLENDİRME | OWNER KARARI GEREKLİ | Mevcut adayda AAC narration gerçek; production AUDIO_PROVIDER=openai; Piper binary/model mevcut | Yeni ücretli synthesis otomatik yapılmaz. Önce mevcut WAV/narration kullanılır; yeni üretimde provider/bütçe/hak kararı owner'a aittir. Assistant sesi frozen kalır |
| SAHNELER | DÜZELTME GEREKLİ | Real scene/video path mevcut; adayın altı sampled frame'i görüldü | Kolaj kompozisyonları/kesilen figürler için editoryal kadraj incelemesi ve gerekiyorsa mevcut scene path'te düzeltme; kaynak/rekonstrüksiyon/hak kabulü henüz yok |
| MONTAJ | ÇALIŞIYOR | FFmpegSceneVideoProvider + VideoAssemblyManager; gerçek mux edilmiş çıktılar | Tüm narration kapsamı, transition ve scene/audio senkronu insan incelemesiyle doğrulanır; working assembly yeniden yazılmaz |
| MP4 | ÇALIŞIYOR | Altı existing final MP4 gerçek H264/AAC1080p stream'lerle okunuyor; ffmpeg/ffprobe mevcut | Container/stream tanığı kalite/rights veya yeni render qualification değildir |
| YOUTUBE | OWNER KARARI GEREKLİ | Mevcut package/export/publish provider/gate source'ları ve bazı completed package metadata | Önce owner-reviewed MP4/thumbnail/title/description/source-rights paketi; yükleme ve yayımlama manual owner kararı. Otomatik upload yok |

17 runtime proje dizini incelendi; 7 assembly manifest'i completed diyor. Bunlardan örneklenen 6 projede final audio+video MP4 okundu. Bir completed projede generated video registry tanığı bulunmadı; bu yüzden bütün completed metadata'lar fiziksel çıktı PASS'ına çevrilmedi. UUID/project contents, raw registry/private paths Git'e eklenmedi; yalnız teknik aggregate/stream kanıtı [ATOLYE_EXISTING_OUTPUT_EVIDENCE.json](ATOLYE_EXISTING_OUTPUT_EVIDENCE.json) içinde.

## İlk somut aday ve ilk sorun

Mevcut **Fatih Sultan Mehmet’in İstanbul’un fethine hazırlanışı** adayı:116,971 saniye,9.452.948 byte,1920×1080 H264+AAC MP4. Audio probe mean−27,8dB/max−10,2dB: sinyal var; dinlenebilirlik veya ses-müzik dengesi kabulü değildir. Source assembly planı `01:30` yazarken gerçek output116,971 saniye; narration coverage ve render metadata doğrulanmadan bu fark bug veya success olarak yorumlanmaz.

Altı frame'lik yerel incelemede kolaj/kesilen figürler görülüyor. **İlk düzeltilecek sorun:** adayın YouTube videosu olarak kadraj/scene selection ve editoryal provenance kabulü; MP4 motoru eksik değildir. Mevcut video yeniden canlandırma görünümündedir; arşiv kanıtı veya fact-accurate görsel diye kabul edilmez. Tam izleme/dinleme, kaynak/hak ve reconstruction etiketi henüz owner tarafından doğrulanmadı.

## 12 Ekim ilk uygulanacak görev

1. Owner konuyu/aday videoyu seçer; en kısa öneri mevcut116,971s Fatih adayıdır. Yeni research/TTS/render harcaması başlatmadan eldeki output kullanılır.
2. MP4'ü baştan sona izle/dinle; timecode'lu scene crop, narration coverage, fact/citation, rekonstrüksiyon etiketi, asset rights ve ses dengesi listesi çıkar. Bu hazırlık AYAS Stage17 bitmeden yapılabilir.
3. Yalnız doğrulanmış ilk kusur için mevcut üretim/generation/regeneration gate'inden exact scope ve budget/provider kararı hazırla. Bilinmeyen eski job/asset/manifest durumunu JSON elle düzenleyerek düzeltme; needed replay/fresh authorization ayrımı mevcut durable contract'a göre yapılır.
4. Gerekiyorsa yalnız onaylı stage'i yeniden üret/render et; production gates, claim/lease/idempotency ve runtime context taşınır. Test kopyasına taşınmış WAV'ın inode/dev binding hatası guard gevşetme gerekçesi değildir.
5. MP4 + thumbnail + başlık/açıklama + kaynak/hak/rekonstrüksiyon notları bir owner review paketi olsun. Owner upload/yayın kararını kendisi verir. YouTube credential, ödeme veya yayın otomasyonu eklenmez.

## Gerçek zorunluluklar ve backlog

Güvenli preparation için mevcut dosyaları doğrulamak, konu ve editoryal hedef seçmek yeterlidir. Gerçek production write için authenticated owner, mevcut execution/acceptance gate, doğru runtime/authority context, uygun provider/bütçe ve doğrulanmış asset/source-rights gerekir. Yayın için insanın full media review'u zorunludur.

Lemon/Fiverr, MP4 motorunun teknik bağımlılığı değildir; onların Stage17 sözleşme kapıları kanıt veya açık reviewed owner kararı bekler. Hazırlık başlayabilir; bu commercial kapılar, auth veya safety kapıları kendiliğinden kapatılmış sayılmaz.

Backlog: genel AYAS grammar/LLM mükemmelleştirmesi, yeni model/paid route, future research/dispatch, yeni director/media mimarisi, Graphify semantic enrichment/parser genişletmesi, yeni gelir altyapısı. Bunlar ilk video için yeni evrensel ön şart değildir. Mevcut güvenlik/production/owner gates korunur.
