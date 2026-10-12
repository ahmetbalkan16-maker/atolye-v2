# Atölye — Çöp adam canlandırma modu

Tarih: 2026-10-11. Owner isteği: konuyu çöp adam çizimleriyle, hareketli canlandırmalarla anlatan video.

## Ne yapar

`IMAGE_PROVIDER=character` iken her sahne, Stage 15J çöp adam motoruyla yerelde çizilir ve sahne boyunca hareket eder:

- **Sahne planlayıcı** (`src/lib/animation/character/CharacterScenePlanner.ts`): visuals aşamasının yazdığı sahne metnini (görsel prompt + arama anahtar kelimeleri, Türkçe veya İngilizce) okur ve motorun kapalı sözlüğünden bir sahne kurar: sahne türü (savaş, yürüyüş, ordu önünde konuşma, zafer, saray, divan, deniz, inşaat, çarşı, âlim, dua, yolculuk, ölüm, anlatıcı), arka plan (sur, deniz, iç mekân, dağ, ova, düz), gün/akşam/gece, figürler, kostüm (sarık, miğfer, taç, kapüşon, cüppe, zırh), el aksesuarı ve dekor (top, çadır, at, ağaç, masa, kule, gemi, taht). Model çağrısı yoktur; aynı sahne her zaman aynı planı alır. Tanınmayan bir sahne iki kişilik anlatıcı sahnesi olur, boş kalmaz.
- **Animasyon** (`src/lib/animation/character/CharacterAnimation.ts`): her figüre bir eylem: `IDLE` (nefes), `WALK`/`RUN` (adım döngüsüyle sabit hızda hedefe yürür ve durur), `TALK` (ağız açılıp kapanır, el hareketi), `POINT`, `CHEER`, `FIGHT` (kılıç sallama), `BOW`, `KNEEL_DOWN`, `FALL`, `SIT`. Pozlar eklem açısı olarak karıştırılır; 15 kare/sn.
- **Sağlayıcı** (`src/lib/assets/providers/CharacterImageProvider.ts`): sahnenin bir karesini 1920x1080 PNG olarak mevcut görsel deposuna yazar. Sahne planı aynı PNG'nin içinde bir `tEXt` bloğu olarak taşınır (`src/lib/animation/character/CharacterSceneAsset.ts`); yeni depolama yolu yoktur, galeri/thumbnail için normal bir görseldir.
- **Sahne videosu** (`FFmpegSceneVideoProvider`): görselde plan varsa sahnenin tüm karelerini geçici bir klasöre çizer, FFmpeg ile 30 fps H.264'e çevirir ve klasörü siler. Plansız görseller eski yoldan (tek kare + bulanık arka plan) geçer. Bozuk/değiştirilmiş plan sahneyi durdurur, sessizce durağan resme dönmez.

Her karede sol altta **CANLANDIRMA** etiketi vardır (15J kuralı, belgeselde sabit). Bu yüzden AYAS yönetmen incelemesi bu sahneleri "etiketli canlandırma" sayar (`SYNTHETIC_UNLABELED` bulgusu çıkmaz). Çöp adam sahnelerinde kamera zoom/pan uygulanmaz: hareketi figürler verir ve etiket hiç kırpılmaz.

## Açma / kapama

`.env.local`: `IMAGE_PROVIDER=character` (belgesel fotoğraf moduna dönüş: `IMAGE_PROVIDER=real`). Değişiklik sunucunun yeniden başlamasıyla etkinleşir. Mod yalnız yeni üretilen görselleri etkiler; tamamlanmış projeler değişmez.

## Maliyet ve bilgisayar yükü

- Görseller $0: API çağrısı yok, AI görsel kotasına (`ATOLYE_MAX_AI_IMAGES`) sayılmaz, $1/video bütçesinde 0 görünür. Mevcut ayarlarda seslendirme OpenAI üzerinden ücretlidir (`AUDIO_PROVIDER=openai`); `$1` koruması (`ATOLYE_AI_COST_GUARD=on`) aynen geçerli.
- Kare çizimi bu makinede ~20–28 ms (1920x1080). Önceki küçük fixture ölçümünden tahmin: 12 dakikalık bir video ≈ 10.800 kare ≈ 4–5 dk CPU (gerçek uzun video kabulü yapılmadı); kareler sırayla çizilir, sahne biter bitmez silinir.
- Üretim aşamaları başlamadan Makine Sağlığı Koruması (RAM/CPU/disk/VRAM) ve **GPU 73 °C koruması** çalışır: A2000 profilinde kart ≥ 73 °C ise aşama 15 sn aralıklarla soğumasını bekler (en fazla 10 dk, `ATOLYE_GPU_THERMAL_MAX_WAIT_MS` ile 0–30 dk); soğumazsa aşama başlatılmaz ve proje sayfasından devam ettirilebilir. Okunamayan sıcaklık beklemeye sokmaz (ses tanımayla aynı kural).

## Sınırlar (bilerek)

- Planlayıcı anahtar kelimeyle çalışır; sahneyi "anlamaz". Karmaşık bir sahne en baskın türe indirgenir. Gerekirse sonraki adım: AYAS'ın (yerel model) sahne planını önermesi, aynı doğrulayıcılardan geçmek şartıyla.
- Dudak senkronu yok; konuşma ağız açma-kapama döngüsüdür.
- Sahne içinde yazı (yer/yıl başlığı) eklenmez; yanlış bilgi yazmamak için.
- Yazı tipi: Windows'ta `sans-serif` serif'e düştüğü için yeni karelerde `Segoe UI, Arial, DejaVu Sans, sans-serif` kullanılır. Eski 15J durağan render'ı (golden kasası) bayt-bayt aynı kalır.

## Testler

- `npx tsx scripts/smoke-character-animation-pipeline.ts` — 15 senaryo: renderer bayt eşitliği, animasyon doğrulama, planlayıcı (TR/EN, deterministik, 240 üretilmiş metin), PNG yükü, sağlayıcı + visuals aşaması (TEMP runtime), gerçek FFmpeg ile animasyonlu sahne videosu, maliyet/hazırlık/yönetmen, başlatma ekranı kurtarma, GPU kabulü.
- Mevcut 15J ve golden testleri (`smoke-ayas-historical-storytelling*.ts`, `smoke-ayas-golden-video-projects*.ts`) değişmeden geçer.

## Aynı pakette

- **Uzaktan başlatma kopması**: `POST /api/pipeline` tüm üretimi tek istekte yürütür; Cloudflare 100 sn'de keser. `/studio` artık istek beklerken projeyi slug + oluşturma zamanıyla bulur ve ilerleme sayfasına geçer; yanıt koparsa 30 sn daha arar (`findStartedProjectUrl`). Slug türetimi aynen korunur (`src/lib/projects/projectSlug.ts`; "İ" → `i-` bilinen kusuru mevcut projeler/kabul işaretleri yeniden türettiği için bilerek düzeltilmedi).


## 11 Ekim — Claude'dan devir ve tamamlanan canlı geçiş

Başlangıç HEAD `5864c887bd0ac4f2489170f807d2bc32b61c6ea8` uzak dalla eşit/temizdi. Claude'un `0f0ef5dd983027ef941bb8eb963ce1f38b43b293` özellik commit'i yerel dalda hazırdı. Owner aynı kaynak için 166 paket PASS şartıyla canlı geçişi ve Git push'u onaylamış; devam talimatı bu işin tamamlanmasıdır. Kod/onay/derleme işi yeniden yapılmadı.

Son engel geçiş betiğinin `Git` fonksiyonunun PowerShell'de `git` komutunu gölgelemesiydi. Claude'un `Invoke-RepoGit` / `git.exe` düzeltmesi yerindeydi; tekrar ön kontrol PASS. 11 Ekim 02:43:47 Türkiye saatinde canonical dal yalnız fast-forward ile `0f0ef5d` oldu; `IMAGE_PROVIDER=real` → `character` yapıldı. Build `_d7VZ_06v2f0NPdit7Kor`, CLEAN stamp `0f0ef5d`, `.next/server/instrumentation.js` var. Qualification 503 build / 25976 dependency PASS. Origin 22372→32212, supervisor 32240→28896; kullanıcı Startup kısayolundan penceresiz başladı. Reboot yapılmadı.

Önceki `.next` ve qualification manifesti `C:\Users\Metod\.claude\ayas-receipts\20261011-stickfigure\rollback-previous` altında korunur. Geri dönüş eski `5864c88` uygulama kaynağı + `IMAGE_PROVIDER=real` + eski build/manifest gerektirir; yalnız artifact değişimi yeterli değildir. Genel backup/PC ayarı değişikliği yoktur.

### Ek test hatası ve gerçek kök neden

Önceki taramalardaki üç FFmpeg suite hatası yeniden üretildi. İzole taze klonda gerçek proje görseli yokken hardcoded PNG'ler bozuk: FFmpeg 9.0 `inflate returned error -3`, decode error ve exit69. Önceki “eski HEAD'de de var” gözlemi tek başına ortam teşhisi sayılmaz. Yeni ham FAIL ve stderr korunur. Ürün FFmpeg filtreleri değiştirilmedi.

`scripts/lib/MediaSmokePng.ts` geçerli 64×64 RGB PNG'yi zlib ve CRC ile üretir; aşağıdaki üç pinlenmemiş suite artık owner projesine veya bozuk fallback'e bağlı değildir. Beklentiler gevşetilmedi; gerçek FFmpeg çıktı/ses/duration kontrolleri aynı:
- `smoke-assembly-background-music-mix`: 6/6 PASS; ducking, fade ve ses seviyesi.
- `smoke-ffmpeg-bgm-kenburns-assembly`: 30/30 PASS.
- `smoke-multi-shot-assembly-render`: 2/2 PASS; 14 sahne ve sınırlı dissolve süre kaybı.

Hepsi özel TEMP kökünde, sentetik görsel/PCM ile ve ücretsiz yerel FFmpeg üzerinden çalıştı. Owner videosu, ücretli çağrı ve upload yok. EVAL v60/frozen test/manifest pinleri değişmedi. Son oturum commit'inde yalnız bu test düzeltmeleri ve belgeler var; canlı uygulama kaynağı `0f0ef5d` ile aynıdır, yeni build gerekmez.

### Doğrulama kapsamı

- Claude'un exact-source `0f0ef5d` EVAL v60 makbuzu: completeDeclaredBaseline=true, 166/166 PASS, failed=[]. Son test/doküman HEAD'i adına yeniden Full166 iddiası yok.
- Claude'un final hedefli 22 suite kaydı PASS. Yeni character pipeline 15 senaryo; gerçek PipelineRunner e2e 6 senaryo, 12 aşama ve sentetik 46.933333 s H264/AAC 1920×1080 MP4. Bu geçmiş TEMP kanıtıdır, yeni owner videosu değildir.
- Derleme fixture HTTP kabulü: initialized/healthy/workerReady/acceptingExecutions=true, studio200, unauth gate307. Research→video tamam; audio mock sağlayıcı yapılandırılmadığı için beklenen stop. Bu HTTP fixture tam ücretli seslendirme kabulü değildir.
- Bu devirde TypeScript 0 hata; whole ESLint 0 hata / 13 eski uyarı; değişen test/helper lint 0; diff-check PASS.
- Canlı localhost/public login200, manifest200, korumalı sayfa307/enforced, health API401; Access recovery healthy. Observer OBSERVING/lastError=null; tünel27628, Ollama5236, Observer14680 korunur.
- Dosya boyutu+mtime parmak izi: canlı runtime2374, authority4, repoProjects2399 dosyada geçiş öncesi/sonrası digest aynı. Bu içerik hash backup/restore sertifikası değildir. Mevcut projelere müdahale edilmedi.
- Salt okunur canlı runtime konsistensi: 17 klasör/16 okunabilir proje, 1 eski okunamayan kayıt; Brain/Graphify toplamları eşit, consistent-with-notes. Eski 4 failed-stage proje, 2 id mismatch ve 7 legacy unresolved raporlanır; owner verileri otomatik onarılmadı/silinmedi.

### Git / Graphify / Pazartesi

Özellik ve bu devir commit'i `wip/ayas-graphify-final-execution` dalına normal push edilir. Son Git HEAD'inde `graphify update --scope all --no-description --no-label .` çalıştırılarak AYAS'ın mevcut yerel Graphify tüketicileriyle aynı graph yenilenir; kaynak/import kenarları ve graph bütünlüğü son makbuzda doğrulanır. Semantic PENDING ve desteklenmeyen bazı PowerShell/dinamik rotalar için PARTIAL beyanı korunur; remote MCP doğrulaması yapılmış sayılmaz.

Makbuzlar (Git dışı): Claude `C:\Users\Metod\.claude\ayas-receipts\20261011-stickfigure\`; devir `C:\Users\Metod\.codex\visualizations\2026\10\10\01a12594-c923-77b2-a250-4991764b40b0\atolye-stickfigure-20261011\` (`LIVE_AFTER.json`, `PROTECTED_*.json`, `RUNTIME_CONSISTENCY.txt`, medya test/diagnostic logları, final Graphify/closure). Graphify-generated dosyaları PC değişiminde kaynak Git yerine geçmez; yeni PC'de graph yeniden üretilir/bağlantıları doğrulanır.

**Durma noktası:** çöp adam modu canlı ve üretim hattına bağlı; yeni owner üretimi başlatılmadı. 12 Ekim Pazartesi önce reboot/logon ve telefon ses/erişim kabulü, sonra owner'ın seçtiği konuyla kontrollü ilk çöp adam videosu. Ücretli seslendirmeye owner onayı ve mevcut $1/video cost guard uygulanır. Uzun video görsel anlatım kalitesi/dudak senkronu kabul edilmedi; planlayıcı kapalı kelime sözlüğüyle çalışır. AYAS öz-gelişiminde keşif/öneri otomatik, canlı yayın owner onaylı; homepage ve writeExecutionGate CLOSED korunur. 9 eski recovery kaydı bekler.
