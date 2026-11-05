# V3 — YouTube kanalı: bağlantı, onaylı yükleme, kanal ayarları

Owner kararları (2 Kasım 2026): kanal **Geschichte entschlüsselt** (`@Geschichteentschlüsselt`,
`UC3u0Kx_T49g9qdLFOagsN8A`) AYAS'a bağlanır; başlangıçta **haftada 2 Short + 1 uzun video** (yeni PC'de artar);
ilk videolarda **owner onayı olmadan yükleme yok**; Fiverr'de insan döngüde kalır, soğuk toplu mesaj yok.

> **3 Kasım 2026 owner kararı: yüklemeleri owner elle yapar; YouTube API bağlantısı kurulmadı.** Google, test
> modundan çıkış için ana sayfa + gizlilik politikası + kullanım şartları bağlantısı istiyor; test modunda izin 7 günde
> düşüyor. `client.json` sırlar klasöründe duruyor ama `token.json` yok; AYAS'a "yükle" denirse sipariş "YouTube bağlantısı
> bekleniyor" diye bekler, hiçbir şey yüklenmez. Owner AYAS'ın teslim paketindeki başlık, açıklama, etiket ve kapağı
> Studio'ya kendisi koyar. Bağlantı istenirse aşağıdaki adımlar geçerlidir (önce test kullanıcısı ya da yayınlanmış uygulama).

> **3 Kasım 2026 (akşam):** owner kanalın adını **Crowns & Doodles** (`@CrownsAndDoodles`) yaptı (aşağıdaki 1. bulgu
> kapandı; kanal kimliği aynı) ve Sezar Short'unu elle yükledi: `q8JW_i5Gt0M` (küçük q; büyük harfli yazım yok, 5 Kasım'da yt-dlp ile doğrulandı) "Never Kidnap a Future Emperor"; sipariş
> `elle: true` işaretli, AYAS onu bir daha yüklemez.

## Nasıl çalışır

1. AYAS siparişi üretir, kalite beyni teslim eder (değişmedi).
2. Sen videoyu izlersin. Uygunsa AYAS'a yazarsın: **"Kosova videosunu yükle"**, **"son videoyu yükle"**,
   **"videoyu hemen yayınla"** ya da **"yüklemeyi onaylıyorum"**. "Yüklendi mi?" bir durum sorusudur, onay değildir.
   Birden çok video bekliyorsa AYAS hangisi olduğunu sorar, tahmin etmez.
3. Onay siparişe yazılır; videoyu canlı sunucu değil, sipariş izleyicisi (`scripts/v3/yapim.ts izle`) yükler.
4. Yayın takvimi: **uzun video Perşembe, Short'lar Salı ve Cumartesi, New York saatiyle 15:00** (Türkiye'de 23:00,
   ABD yaz saatinde 22:00). Video o saate kadar kanalda **özel** durur (yalnız sen görürsün); YouTube Studio'da son
   bir kez bakabilir, saati değiştirebilir ya da silebilirsin. Bir haftaya fazla video onaylarsan sonraki haftalara
   kayar. "Hemen yayınla" takvimi atlar.
5. Uzun videonun kapağı da yüklenir (Short'larda kapak yok). Kapak reddedilirse video yine yüklenir, AYAS uyarır.

Her yüklemede giden ayarlar: kategori **Eğitim**, başlık/açıklama dili **İngilizce**, ses dili **İngilizce (ABD)**,
**çocuklara özel değil**, **gerçekçi yapay içerik yok** (V3 her şeyi çizer; tasarlanmış resimler fotogerçekçi değildir
ve ekranda "tasarlanmış" yazar), lisans standart YouTube, yerleştirmeye açık. Başlık paketin ilk başlığı; açıklama
`aciklama.txt` (kanca, bölümler, kaynaklar, jenerik, hashtag'ler; 5000 bayta sığdırılır, bölümler hiç kesilmez);
etiketler 500 karakter sınırına sığdırılır.

Güvenlik: izin yalnız **yükleme + okuma**dır (silme/düzenleme yetkisi yok); başka bir kanala verilen izin reddedilir;
kanalda aynı başlıkta video varsa yükleme durur (iki kez yüklenmez); bağlantı koparsa yükleme YouTube'un aldığı son
bayttan devam eder. İzin ve anahtarlar git dışındaki `D:\ÜRETİM\private\AtolyeSecrets\AYAS-SECRETS\youtube\` klasöründe.

## Bir kerelik bağlantı (owner, ~10 dakika)

Google hesabına yalnız sen girebilirsin; bu adımları sen yaparsın.

1. <https://console.cloud.google.com/projectcreate> → proje adı **AYAS YouTube** → Oluştur.
2. <https://console.cloud.google.com/apis/library/youtube.googleapis.com> → **YouTube Data API v3** → **Etkinleştir**.
3. <https://console.cloud.google.com/auth/overview> → **Başlayın**: uygulama adı **AYAS**, destek e-postası (kendi
   adresin), kitle **Harici (External)**, iletişim e-postası → Oluştur.
4. **Kitle (Audience)** sekmesi → **Uygulamayı yayınla (Publish app)** → "Üretimde" olmalı. *Test* modunda izin 7 günde
   düşer. Google doğrulaması gerekmez (uygulamayı yalnız sen kullanıyorsun).
5. **İstemciler (Clients)** → **İstemci oluştur** → uygulama türü **Masaüstü uygulaması (Desktop app)**, ad **AYAS** →
   Oluştur → **JSON'u indir** (gizli anahtar yalnız bu ekranda indirilebilir).
6. İnen `client_secret_….json` dosyasını şu adla kaydet:
   `D:\ÜRETİM\private\AtolyeSecrets\AYAS-SECRETS\youtube\client.json`
7. Bana "bağla" de, ya da kendin çalıştır: `npx tsx scripts/v3/youtube.ts baglan`. Tarayıcı açılır:
   **Crowns & Doodles** kanalını seç → "Google bu uygulamayı doğrulamadı" ekranında **Gelişmiş → AYAS'a git**
   → izinleri onayla. Komut kanalı doğrular ve ayarlarını denetler (`youtube.ts durum` ile sonra da bakılır).

YouTube kotası: günde 100 yükleme (Aralık 2025'ten beri ayrı kova); haftada 3 video sorun değil. Güncel API belgesine
göre doğrulanmamış projelerin yüklemeleri artık "özel"e kilitlenmiyor (2 Kasım 2026'da `videos.insert` sayfasından
doğrulandı).

## Kanal ayarları — doğru izleyici için (2 Kasım 2026 incelemesi)

Herkese açık verilerden görülenler: 2 abone, 4 uzun video + 3 Short; kanal açıklaması İngilizce ("Welcome to History
Decoded…"), anahtar kelimeler İngilizce, videoların dili en-US ve kategorisi Eğitim.

| # | Bulgu | Öneri | Nerede |
|---|---|---|---|
| 1 | Kanal adı Almanca ("Geschichte entschlüsselt"), tanıtıcı `ü` içeriyor; içerik Amerikan İngilizcesi | Adı **History Decoded** yap; tanıtıcıyı ASCII bir adla değiştir (ör. `@HistoryDecoded…`, müsait olanı). 2 aboneyle değiştirmenin bedeli yok. İzleyici aramada da önerilerde de adı okur. | Studio → Özelleştirme → Temel bilgiler |
| 2 | Kanal açıklaması "cinematic documentaries" diyor; V3 çizgi film animasyon anlatımı | Açıklamayı gerçekte yapılana uydur (aşağıda taslak). Beklentisi karşılanmayan izleyici hemen çıkar, bu da öneriyi düşürür. | Studio → Özelleştirme → Temel bilgiler |
| 3 | Almanca 17 dk video (`1LaN5cVKZRo`), dili en-US işaretli, 4:3 | **Liste dışı** yap (bağlantısı çalışır, kanal akışından çıkar) ya da en azından dilini Almanca'ya düzelt. İki dilli kanal, sistemin izleyici modelini karıştırır. | Studio → İçerik → video → Görünürlük |
| 4 | "Aliens and Ancient Egypt" Short'u, etiketsiz ve sözde tarih | Liste dışı yapmayı düşün: "kaynaklı gerçek tarih" kimliğiyle çelişiyor. | Studio → İçerik |
| 5 | Kitle ayarı herkese açık görünmüyor | Kanal varsayılanı **"Hayır, çocuklara özel değil"** olmalı. Çizgi film görünümü YouTube'un çocuk içeriği sınıflandırmasını tetikleyebilir; "çocuklara özel" olursa yorumlar, bildirimler ve öneriler kısılır. Yükleyici her videoda "değil" gönderiyor; `youtube.ts durum` kanalın ayarını da gösterir. | Studio → Ayarlar → Kanal → Gelişmiş ayarlar |
| 6 | Ülke görünmüyor | **Türkiye** (ikamet ettiğin ülke) — gelir, vergi ve YPP buna bağlı; izleyici hedeflemesini belirlemez, doğrusunu yaz. | Studio → Ayarlar → Kanal → Temel bilgiler |
| 7 | — | Yükleme varsayılanları: kategori Eğitim, video dili İngilizce (ABD), başlık/açıklama dili İngilizce. (Elle yüklemeler için; AYAS'ınkiler zaten böyle.) | Studio → Ayarlar → Yükleme varsayılanları |
| 8 | — | Uzun bölümler 20–30 dk: 15 dakikadan uzun video için telefon doğrulaması gerekir (17 dk'lık video yüklendiğine göre muhtemelen açık; `youtube.ts durum` kesin söyler). Özel kapak için de gerekir. | youtube.com/verify |
| 9 | — | Haftanın 2 Short'unu haftanın uzun videosunun konusundan yap; Short'un "İlgili video" alanına o uzun videoyu bağla (bu alan API'de yok, Studio'dan elle). Short izleyicisi uzun videoya akar ve kanal tek bir izleyici kitlesi biriktirir. | Studio → Short → Ayrıntılar → İlgili video |
| 10 | Başlık üslupları karışık (🔥, "|", Almanca) | V3 paketi sabit bir üslup veriyor (ana anahtar kelime başta, ≤60 karakter); eski başlıklara dokunmak gerekmez. | — |

Kanal açıklaması taslağı (İngilizce, değiştirebilirsin):

> History Decoded tells the world's great stories as animated history — emperors, battles and turning points, from
> Rome and the Ottomans to the Mongols and World War II. Every episode is researched from real sources, drawn by hand
> in our own cartoon style and told with a sense of humor. A new long episode every week, Shorts in between.
> Subscribe and see how history really happened.

Kanal anahtar kelimeleri önerisi: `history, animated history, history animation, world history, Ottoman Empire, Roman
Empire, medieval history, military history, battles, empires, history explained`.

Gelir notu: YouTube'un "özgün olmayan / seri üretim içerik" kuralı (Temmuz 2025) aynı kalıptan çıkan, emek görünmeyen
videoları para kazanmadan çıkarır. Owner onayı, kaynaklı araştırma, her bölüme özgü çizim ve haftada 3 videoluk tempo
bu riski düşürür; tempoyu kaliteden önce artırma.

## Komutlar

- `npx tsx scripts/v3/youtube.ts baglan | durum` — bağlantı ve kanal denetimi.
- `npx tsx scripts/v3/yapim.ts onayla <sipariş id> [--hemen]` — AYAS'sız onay; `yapim.ts yayinla` tek yükleme turu;
  `yapim.ts durum` siparişlerin YouTube durumunu da gösterir.
- Kod: `src/lib/v3/publish/` — `YoutubeAuth` (izin), `YoutubeUpload` (meta + parçalı yükleme), `PublishCalendar`
  (takvim, ağsız), `PublishApproval` (onay, ağsız; canlı sunucu yalnız bunlara ulaşır), `PublishOrder` (izleyicinin
  yükleme turu). Test: `scripts/smoke-v3-youtube-yukleme.ts`.
