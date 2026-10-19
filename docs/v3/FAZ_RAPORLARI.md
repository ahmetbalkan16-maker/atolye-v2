# V3 faz raporları

Her fazın doğrulaması (komut + sonuç). En yeni en altta.

## FAZ 0 — Yedek ve dal (19 Ekim 2026)

- `git tag atolye-v2-pre-v3-backup` → `69bda564` (ana dal temiz, `origin` ile eşit).
- `feature/cop-adam-v3` **ayrı worktree'de**: `D:\ÜRETİM\Atolye\atolye-v2-v3`. Ana repo canlı AYAS'ın çalışma
  ağacı ve otomatik yayın kaynağı olduğu için orada branch değiştirilmedi (gerekçe: `01_ATOLYE_DURUM.md`).
- Doğrulama: `git -C atolye-v2 status` temiz; worktree `On branch feature/cop-adam-v3`.

## FAZ 1–4 — İnceleme, donanım, boşluk analizi, yol haritası

- `01_ATOLYE_DURUM.md`, `02_DONANIM.md`, `03_BOSLUK_ANALIZI.md`, `04_YOL_HARITASI.md` yazıldı.
- Mevcut test: `npx tsx scripts/smoke-character-animation-pipeline.ts` → PASS (14 senaryo, 1 FFmpeg senaryosu atlandı).
- Referans: yalnız `yt-dlp --skip-download` meta veri + altyazı; 144 kelime/dk, 5,5 sn/vuruş.
- Seviye ORTA (RTX A2000 12 GB). Kurulanlar: Remotion 4.0.536 (alt paket), Rhubarb 1.14.0, Chatterbox 0.1.7 venv (kurulum sürüyor).
- Bulgular: SDXL venv bozuk (eski PC yolu), mevcut Piper sesi CC BY-NC-SA.

## FAZ 5.1 (kısmi) / 5.2 — Şema ve karakter sistemi

- `src/lib/v3/episode/` (tipler + doğrulayıcı), `docs/v3/episode.schema.json`, `content/v3/kadrolar/fatih-1453.json`.
- Karakter rig'i `remotion-v3/src/character/`: ileri kinematik, 12 jest, yürüme/koşma, nefes, göz kırpma,
  8 duygu, 9 vizem (Rhubarb A–H/X), 6 efekt; 7 giysi tipi; iki stil (`kukla`, `cop`).
- Kostüm paketleri `remotion-v3/public/costumes/` (Osmanlı 1453: 17, Bizans 1453: 7 SVG) — yükleyici SVG'de
  script/href/url/foreignObject'i reddeder.
- Doğrulama:
  - `npx tsx scripts/v3/karakter-vitrini.ts --stil kukla --video` → 15 sn, 1080p30, **13 sn'de render** (~35 kare/sn).
  - Kare incelemesi (40, 250, 330, 420): duygular, jestler, yürüme, efektler, yazı kartları, altyazı doğru.
  - Owner geri bildirimi "karakterler havada uçuyor gibi" → temas gölgesi (iki katman), alçak zemin çizgisi,
    zemin tonlaması; yürürken ayaklar yerde kalıyor. Paralaks arka planın kenar boşluğu giderildi.
  - `npx tsx scripts/smoke-v3-episode-director.ts` → PASS (9 senaryo).
  - `npx tsc --noEmit` (kök) 0 hata; `remotion-v3` `tsc --noEmit` 0 hata; `eslint src/lib/v3 scripts/v3` 0 uyarı.

## Güvenli duruş — 19 Ekim 2026 (owner isteği: "güvenli yerde dur, sonra devam")

Tamam:
- Commons sağlayıcısı + lisans filtresi (`src/lib/v3/backgrounds/`), `scripts/v3/commons-ara.ts` (arama ve başlığa göre indirme).
  Commons artık standart dışı küçük resim genişliğini reddediyor (HTTP 400); API `iiurlwidth=3840` ile resmî adres kullanılıyor.
  Doğrulama: "File:Rumeli Hisarı - Otağtepeden Görünüşü.jpg" CC0 indirildi (`output/v3/_aday/`, SHA-256 `80a19335…4939`).
- TTS katmanı kodu (`src/lib/v3/tts/`, `scripts/v3/tts_server.py`), `content/v3/voices.json`, `content/v3/lexicon_tr.json`.
- Owner ses kaydı `D:\URETIM\private\v3-voices\owner-source.mp3` (47,7 sn, git dışı); Whisper dökümü temiz.
- Kontroller: kök `tsc` 0, `remotion-v3` `tsc` 0, `eslint src/lib/v3 scripts/v3` 0 uyarı, `smoke-v3-episode-director` PASS (9).

Yarım / doğrulanmadı:
- Chatterbox venv kurulumu (`D:\URETIM\Atolye\v3-tools\tts-venv`): Python 3.11.16 + venv hazır; torch 2.6.0+cu124
  indirmesi/çıkarması duruş anında sürüyordu. Devamda: `tts-venv\Scripts\python.exe -c "import torch, chatterbox"` ile doğrula;
  yoksa aynı `uv pip install` komutlarını yeniden çalıştır (02_DONANIM.md).
- Pilot senaryo `content/v3/bolumler/fatih-pilot.json` henüz yazılmadı (taslak ve doğrulanmış kaynaklar aşağıda).

Sıradaki adımlar (sırayla):
1. Chatterbox doğrula → `prepareOwnerReferences` ile `owner-a.wav` / `owner-b.wav` → 5 karakter × 2 satır ses örneği (owner seçecek).
2. Lip-sync modülü: Rhubarb (ASCII TEMP kopyası) + RMS yedeği; whisper.cpp kelime zamanları.
3. Müzik: Kevin MacLeod (CC BY 4.0) parçaları `v3-tools/music` + `content/v3/music_index.json`; SFX sentezi; FFmpeg mix (sidechain + 2 geçiş loudnorm −14 LUFS).
4. SDXL için yeni görsel venv (torch uv önbelleğinden) → Rumeli Hisarı inşaat arka planı.
5. Pilot `episode.json` (5 sahne, ~80 sn) → `scripts/atolye-v3.ts uret` orkestratörü → render → QC raporu.

Pilot için doğrulanan kaynaklar: Avunduk, "Rumelihisarı", TDVİA 35 (2008) 237–240 (Mart 1452 sonu başlangıç, Temmuz–Ağustos 1452 bitiş,
~4–5 ay, "Boğazkesen" adı, deniz kenarındaki kule Çandarlı Halil, diğerleri Sarıca/Zağanos); Eyice, "Anadoluhisarı", TDVİA 3 (1991)
147–149 (Anadoluhisarı Boğaz'ın en dar yerinde, Rumelihisarı karşısında 1452'de yapıldı); Runciman, *The Fall of Constantinople 1453* (1965);
Doukas (çev. Magoulias, 1975). Kaynak metinde olmayan "en dar nokta" iddiası Rumeli Hisarı için değil Anadolu Hisarı için kullanılacak.

## Owner kararı: stil A "kukla" + kılıç detayı (19 Ekim 2026)

- Owner karakter stili olarak **A "kukla"**yı seçti; isteği: "eldeki kılıç detayına biraz daha dikkat".
- Sorun: kabza ve balçak avuç dairesinin altında kalıyordu, kılıç ön kol yönünde ince bir şerit olarak sarkıyordu.
  Açık el jestlerinde (`konus`, `sasir`, `el_salla`…) el açılıp kılıcı bırakıyormuş gibi görünüyordu.
- `kilic.svg` yeniden çizildi: hafif kavisli 18 px namlu (oluk + ağız parıltısı), aşağı kıvrık topuzlu balçak, namluya
  inen dil, sargılı kabza, pirinç kabza başı. Kabza yumruğun içinden 40° çapraz geçer: dinlenirken öne-aşağı,
  `isaret_et`'te öne-yukarı, `yumruk_kaldir`'da dik yukarı, `elleri_belde`'de yere dayalı.
- Paket öğesine `grip` bayrağı (`CostumePackLoader`, `V3Accessory`): kavranan nesnede el her jestte yumruk kalır.
  Kılıç, çekiç, tuğ ve asada açık; harita/parşömen açık elde kalabilir. `cop` stilinde nesne avuç merkezine (y=10) hizalandı.
- Vitrin: Zağanos'un `yumruk_kaldir` jesti kılıçlı arka kola yönlendirildi (`toward: "right"`).
- Doğrulama: kareler 40/80/135 (üç kılıç pozu) ve 385 (Urban el sallarken çekici yumrukta tutuyor) incelendi;
  vitrin videosu yeniden üretildi (`output/v3/vitrin-kukla/vitrin.mp4`, 14,7 sn). Kök `tsc` 0, `remotion-v3` `tsc` 0,
  `eslint src/lib/v3 scripts/v3 remotion-v3/src` 0 uyarı, `smoke-v3-episode-director` PASS (9; F senaryosu `grip` bayrağını da doğrular).

## Akıcı hareket — "film gibi" (19 Ekim 2026, owner isteği)

- Sorun (ölçüldü): jestler 0,2 sn'de giriyor, tüm eklemler aynı karede kilitleniyordu. Yürüyüş başında ayak tek
  karede kalkıyor, sonunda bacaklar duruşa atlıyordu; dönüş tek karede aynalanıyor, ifade tek karede değişiyordu.
  Kamera her anahtar karede durup yeniden kalkıyordu. Yürüyüşte kübik ease yolun ortasında hızı 3 katına çıkarıyordu.
- `remotion-v3/src/character/dynamics.ts`: yay-sönüm takibi (savrulma + oturma, örtüşen hareket: ön kol üst koldan,
  baş gövdeden geç gelir). Remotion kareleri paralel çizdiği için her kare son 1,5 sn'yi yeniden hesaplar; deterministik.
- `motion.ts`: niyet edilen poz + yay katmanı; jestten 0,15 sn önce ters yönde hazırlık; jest süresi hareketin
  büyüklüğüne göre (0,28–0,6 sn, beşinci derece yumuşatma); organik boşta salınım; konuşmada baş hecelere (vizem
  açıklığı) göre sallanır; yürüyüş sabit seyir hızı + yumuşak başlangıç/bitiş; 7 karelik dönüş (ayna 0'dan geçer,
  hafif esneme); ifade değişimi göz kırpmasıyla gizlenir, kaşlar 6 karede kayar.
- `scene/camera.ts` (ShotView'dan taşındı): anahtar karelerden durmadan geçen monoton kübik eğri (beklemelerde
  hedefi aşmaz), her çekimde %2 yavaş yaklaşma + birkaç piksel el kamerası nefesi, sarsıntı iki karede vurur ve
  karesel söner. `snap`/`cut` davranışı korundu.
- Ölçüm (`scripts/smoke-v3-motion.ts`, önce → sonra): kol ivmesi 35,0 → 3,5 °/kare²; gövde/baş 8,5 → 3,2; bacak
  ivmesi 16,2 → 5,7; yürüyüş başında ayak sıçraması 9 → 0,1 birim; dönüş tek kare → 0,29/kare.
- Doğrulama: `smoke-v3-motion` PASS (9: kol/gövde/bacak akıcılığı, dönüş, kare sırasından bağımsızlık, oturma,
  ifade geçişi, kamera eğrisi, film kamerası sınırları); `smoke-v3-episode-director` PASS (9); kök ve `remotion-v3`
  `tsc` 0; eslint 0 uyarı. Vitrin videosu yeniden üretildi (render 16 sn / 15 sn video); film şeritleri incelendi
  (kılıç kaldırma yayı, ifade değişiminde göz kırpma, yürüyüş).
- Sonraki seçenek: hareket bulanıklığı (`@remotion/motion-blur`) final render'da film hissini artırır ama render
  süresini örnek sayısı kadar katlar; kesirli kare desteği (göz kırpma tablosu) gerekir.
