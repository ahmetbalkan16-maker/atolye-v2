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

## FAZ 5.1 / 5.3–5.6 / 5.8 — Senaryo, ses, senkron, müzik/miks, orkestratör (19 Ekim 2026)

Ayrıntılar commit mesajlarında (`4d5e9ed6`, `0a0819ce`, `94d72e65`, `7a13d7bf`); özet:
- Senaryo motoru: yaz → doğrula/onar → ayrı tarih doğrulama geçişi; kaynak bankası (`content/v3/kaynaklar/`);
  video başına 1 $ tavan (`V3Budget`, Atölye'nin fiyat tablosu ve maliyet yöneticisi).
- Ses: Chatterbox Multilingual 0.1.7 (MIT, Perth filigranı), owner sesinden klon; Rhubarb (gerçek ASCII klasör
  `D:\atolye-ascii\rhubarb`) + RMS yedeği; whisper.cpp kelime zamanları.
- Müzik Kevin MacLeod (CC BY 4.0, git dışı, sha256 sabitli), 10 sentez efekt (CC0), sidechain ducking,
  iki geçişli loudnorm.
- `npx tsx scripts/atolye-v3.ts uret …`: adım önbelleği, `--from-step`, `--onizleme`, QC.md / CREDITS.md / altyazi.srt.
- İlk pilot (yerel gemma4) QC 6/11 → 10/11; kalan: süre (76 sn / hedef 90).

## Pilot — OpenAI gpt-4.1, görüntüye bakan arka plan hakemi (19 Ekim 2026 gece)

- OpenAI çalışıyor (Windows kullanıcı değişkeni; `v3Secret` önce ona bakar). Yazım + doğrulama gpt-4.1: 0,0385 $.
- Arka plan hakemi (`BackgroundJudge`, `a78064b7`): Commons'un ilk 6 adayı yerel gemma4:12b'ye görüntü olarak
  gider, 0–10 puan, eşik 7; owner kararıyla konuyu gösteren gerçek fotoğraf serbest. Önceki pilotun 2. sahnesindeki
  ilgisiz İsviçre sokağı fotoğrafı bu kapıdan geçemez; "araçlar ve insanlar önde" fotoğraf 3/10 aldı.
- Süre: Türkçe kelime bütçesi ölçülen hıza (1,8 kelime/sn bitmiş video), uzunluk bandı QC ile aynı ±%10.
- Kare incelemesi iki hata buldu, düzeltildi (`bf12eeab`): yapışık altyazı kelimeleri (kontur boşluğu yiyordu) ve
  iki sahnede aynı fotoğraf.
- Sonuç `output/v3/bolumler/fatih-pilot-openai/final.mp4`: 82,6 sn, 6 sahne, 4 görünür karakter / 4 ses,
  QC **12/12** (kanca 0,3 sn; olay aralığı 2,6 sn, en uzun 4,9 sn; diyaloglu sahne %83; 16/16 Rhubarb; 4 set +
  2 farklı gerçek görsel, puan 10/10; −14,0 LUFS / −1,2 dBTP; süre ±%10 içinde). İlk hali `fatih-pilot-openai-ilk/`.
- Doğrulama: smoke-v3-backgrounds (6), -script (13), -episode-director (10), -mix (6), -lipsync (5), -motion (9),
  smoke-script-structured-generation (22), smoke-local-providers (71, ASCII TEMP) PASS; kök ve remotion-v3 tsc 0; eslint 0.
- Kalan (öncelik sırasıyla): yerel setlerin dönem kimliği zayıf (`harbor_early` İtalyan kasabası gibi, 1. ve 2. sahnede
  art arda) → Osmanlı/Boğaz 1452 setleri üret; karakter seçimi ve ses seçimi owner'da (`v3-voices\ornekler`);
  Bizans elçisi imparator tacı taşıyor (kostüm anlamı); yakın çekimde kenardaki karakterler kadrajdan taşıyor;
  tam bölüm (6–10 dk) ve referansla önce/sonra puan kartı (FAZ 6.2–6.4).

## 20 Ekim 2026 — OverSimplified hedefi: dönem görselleri, İngilizce, her konu için altyapı

Owner istekleri (aynı gün, sırayla): arka plan döneme ait olsun (bulunamazsa ilgisiz görsel konmasın, açıkça yazılsın,
sahne tasarlansın); video Amerikan kanalı kalitesinde ve Amerikan İngilizcesiyle anlatılsın; ekrandaki altyazı kalksın,
yalnız konuşanın üstünde espri/anlamlı söz çıksın; referans **OverSimplified** (video Q-nWA0WeF98 ve kanalın en çok
izlenenleri); bu yalnız bir video için değil, **her tarih/olay/karakter için altyapı** olsun; ana karakterlerin yüzü gerçek
portreden gelsin, diğerleri saç/şapka/sakal parçalarıyla.

Referans incelemesi (yalnız meta veri, altyazı ve YouTube önizleme kareleri; video indirilmedi): 147 kelime/dk anlatım;
balonsuz, kalın konturlu konuşma yazısı; oklu isimler; sıra sıra asker/senatör kalabalıkları; sade düz çizim setler;
uydu/düz haritalar, bölge renkleri, ordu blokları, oklar; tam ekran tek kelime kartları; deadpan anlatıcı, modern konuşan
tarihî karakterler.

Kurulanlar (hepsi konudan bağımsız):
- **Dönem görseli:** Wikipedia makale görselleri + yönlendirme adları (eski yazımlar, ör. "Roumeli Hissar"), The Met Open
  Access, Commons. Hakem (yerel gemma4) iki puan verir — konu ve dönem — artı "modern öğe" bayrağı; ara plan o anda
  anlatılan kişi/yeri göstermeli. Görsel yalnız anlatıcı satırlarında tam ekran ara plan (bulanık zemin, kaynak plakası).
  Bulunamazsa log/QC: "DÖNEME AİT GÖRSEL BULUNAMADI — ilgisiz görsel kullanılmadı".
- **Set:** kütüphane seti hakem onaylarsa; yoksa senaryonun `tasarim` tarifiyle yerel SDXL (gen-venv), iki tur × iki
  tohum, düz çizgi film stili; ekleme-yalnız set kütüphanesi.
- **Ekran yazısı:** altyazı yok (SRT ayrı, YouTube CC); konuşanın başı üstünde konturlu yazı, bağırmada büyük harf; ilk
  konuşmada kırmızı oklu isim + rol; tam ekran `kelime` kartı; "DRAMATIZATION" etiketi.
- **Kalabalık:** `kalabalik` (sıra/meclis/ordu; coşkulu/korkmuş), oyuncuların arkasında, mesafe sisiyle.
- **İngilizce ses:** Kokoro-82M (Apache-2.0) 14 profil; senarist her karaktere tarife göre ses seçer; `--anlatici`.
- **Araştırma:** el yapımı banka yoksa Wikipedia revizyonları okunur, olgu ancak alıntısı makalede birebir varsa kalır.
- **Gardırop (Katman 2):** "yeni:<tarif>" siparişi → gpt-4.1 SVG → güvenlik/geometri kapıları → kukla provası →
  hakem → repo dışı `gardirop` paketi; sonraki bölümler ücretsiz kullanır (Roma ikinci çalıştırmada 3 parça kütüphaneden).
- **Kıyafet ve saç:** tunik, toga, ceket, üniforma, takım elbise, elbise; 7 parametrik saç.
- **Portre yüz:** `portre.wiki` olan ana karakter için portre bulunur, hakem kişiyi doğrular, OpenCV YuNet yüzü keser
  (sola bakan aynalanır); yüz kafa ovalinde, konuşurken çene düşer.
- **Harita:** Natural Earth 1:50m; bölgeler ISO koduyla ya da yaklaşık çizgiyle (kıyıya kırpılır), şehirler, ordular,
  kendini çizen oklar; her öğe onu anan satırla belirir.
- **Sağlamlık:** taslak normalleştirici (görünür anlatıcı, İngilizce kıyafet adı, uydurma parça → sipariş), Wikimedia 429
  bekle-yeniden-dene, yazar çıktı sınırı, başarısız taslak kaydı; Rhubarb Unicode TEMP çökmesi ve espeak Unicode yolu
  (ikisi de ASCII klasörle) düzeltildi; İngilizce hız ölçüldü 2,35 kelime/sn.

Pilotlar:
- `output/v3/bolumler/rumeli-hisari-en/final.mp4` (96 sn): 2/6 sahnede dönem görseli (Buondelmonti 1430 haritası), 4'ünde
  açık "bulunamadı" ve tasarlanmış set; QC 11/13 (RMS ağız senkronu ve süre — ikisi de sonradan düzeltildi).
- Roma (MÖ 49, yalnız konu cümlesiyle): `output/v3/bolumler/rubicon-en-2/` — sonuçlar aşağıdaki doğrulama satırında.

Doğrulama: kök ve remotion-v3 tsc 0; eslint 0; smoke-v3-episode-director (16), -script (15), -backgrounds (10),
-lipsync (5), -motion (9), -mix (6) PASS.

### Beyin takımı (20 Ekim 2026, owner fikri)

AYAS yönetici; Atölye'de uzman beyinler: **Araştırma** (kaynak bankası), **Kurgu** (senarist + tarih editörü),
**Kostüm** (tasarımcı + tarihçi + sanat yönetmeni; kafalar/portreler dahil), **Ortam** (dönem görselleri, setler,
haritalar), **Ses** (sesler, müzik, efekt), **Kalite** (bitmiş videoyu izler, teslim eder) ve **Hata onarım** beyni.
- Beyinler kendi içinde tartışır (öneri → eleştiri → şef kararı); kayıtlar `KURUL.md` / `yapim-raporu.json`.
- Bulgular AYAS gelen kutusuna gider (`output/v3/_kutuphane/ayas-gelen-kutusu.jsonl`); şef bunları "önlem" (Atölye
  kendisi alır: veri/ayar) ve "geliştirme" (kod — owner onayıyla) diye ayırır. Hiçbir beyin kod değiştirmez.
- Hata onarım beyni her adımı gözetir: bilinen hatalara hazır ilaç, tanınmayanda yerel model yalnız izinli eylemlerden
  seçer (bekle/yeniden, GPU boşalt, izinli ayar, isteğe bağlı adımı atla, dur). Video yapımı Claude/Codex'e bağlı değil.
- AYAS sipariş kapısı: `npx tsx scripts/v3/yapim.ts siparis --konu "…" --donem "…"`, `… kuyruk`, `… durum`.
  Canlı AYAS'ın bu kapıyı kullanması (konuşmada "X hakkında video yap") ayrı, owner onaylı adım; canlı sisteme dokunur.

## 20 Ekim 2026 (öğleden sonra) — Benzerlik, "herkes farklı", referans videoya göre iyileştirmeler

Owner düzeltmesi ve istekleri (sırayla): (1) ana karakterlerin yüzü fotoğraftan kesilmeyecek; OverSimplified'ın Henry
VIII'i (referans `ewLpXw6uN28`) gibi bizim çizimimiz olacak, ama kafası (yüz, saç, sakal, şapka/taç/miğfer) ve kıyafeti
gerçek portresine göre tasarlanacak; (2) her karakterin saçı ve kıyafeti farklı; (3) kalabalıktaki askerler tek tip
kalabilir, yalnız önemli kişiler özel (yüz, kıyafet, taç/şapka/miğfer, kılıç); (4) görünüş ve kıyafet konunun geçtiği
yıla göre araştırılsın, uygun yardımcı beyin yapsın; (5) son videoyu izle, referansa göre iyileştir; (6) gerekirse skill
kullan ve sisteme entegre et; (7) en önemlisi görsel kalite, efektler, arka planın canlılığı ve renkleri, akış ve
anlatım biçimi — PC'nin izin verdiği kadar; (8) hepsini sıraya koy, video üretmeden bitir, bir yeri yaparken başka yeri
bozma; (9) videolar artık Amerikan İngilizcesi.

Yapılanlar:
- **Benzerlik tasarımcısı** (Kostüm beyni, `src/lib/v3/faces/LikenessDesigner.ts`): tarihçi kişinin Wikipedia
  makalesindeki görünüş/giyim cümlelerini okuyup "o yıl kaç yaşında, neye benziyordu, ne giyiyordu, ünlü portrelerden
  farkı" notunu yazar; resim araştırmacısı portreyi bulur (hakem o yaşa yakın olanı yüksek puanlar); tasarımcı (gpt-4.1,
  görüntülü) portreye ve nota bakıp benzerlik kartı yazar: yüz biçimi, ten, burun, kaş rengi, yaş, saç, kıyafet,
  renkler, kürk yaka; eksik parçalar ("yeni:Henry VIII's …") gardıroba sipariş edilir ve portre referansıyla, kişinin
  yüz biçimindeki kukla üzerinde provayla çizilir. Sonunda çizim portreyle yan yana puanlanır (<6 → AYAS'a bulgu).
  Biten benzerlik kişi+dönem başına `_kutuphane/kisiler/` içinde saklanır; sonraki bölüm ücretsiz kullanır.
  Fotoğraf yüz (PhotoHead, `face_cut.py`, YuNet) ve ayrı "portre" adımı kaldırıldı (`--from-step portre` = gardırop).
- **Kukla:** 5 yüz biçimi, ten rengi, 6 burun, detaylı (beyaz) göz, kaş rengi, yaş çizgileri, 4 yeni saç (kıvırcık,
  kâkül, geriye, seyrek), tasarlanmış saç (`sac_parca`) ve göğüs (`gogus`: zincir, nişan, kuşak) yuvaları; "ortak"
  paket (altın zincir, nişan kuşağı, saç örneği). Gardırop talimatındaki yüz koordinatları kuklanın gerçek göz/ağız
  yerlerine düzeltildi (eski metin gözleri (30,-10)/(62,-10) diyordu; gerçek (-21,-4)/(41,-4), ağız (8,46)).
- **Herkes farklı** (`LookVariety`): başı açık isimli karaktere saç; aynı görünen ikisinden ikincisine farklı saç ya da
  ana renk tonu; gerçek kişiler korunur, kalabalıklara dokunulmaz. Kostüm tarihçisi başlık takmayan rollere (ör. Roma
  senatörü) başlık vermez.
- **Referans karşılaştırması** (son Roma videosu 36 kare + referansın 160 önizleme karesi): karakterler büyük (bel/diz
  üstü), tablolar kısa ve şakalı, tepki yakın çekimleri, düz-parlak konturlu setler. Buna göre: orta çekimler daha yakın
  ve aşağıdan (baş üst kısımda), anlatıcı çekimi 1.18–1.26; tablo ara planı karakter varken en fazla 4,5 sn ve daha
  belirgin Ken Burns; set stili "düz, kalın konturlu, parlak düz renk, sade", yasak listesine fırça/yağlı boya/sulu boya;
  döneme göre yasak yapılar (MS 400 öncesi kilise/çan kulesi/haç, 630 öncesi minare); set hakemi stili de puanlar
  (resim gibi görünen set en fazla 5). Senarist: şaka 10–15 sn'de bir, 8–15 sn sahneler, "göster, sadece anlatma"
  (anlatıcı satırını karakterler canlandırır, kısa tepki repliği), sahnelerin %40'ında diyalog, 2–4 kelime kartı.
- **Skill (remotion-best-practices) → ses efektleri:** önerilen soundcn koleksiyonunun yalnız Kenney CC0 klasörlerinden
  10 kayıt (`scripts/v3/sfx-kenney.ts`, commit sabitli, lisans + SHA-256 kaydı): kılıç ve çekiç (sentezin yerine),
  yumruk, düşüş, adım, kapı, para, kâğıt, başarı/başarısızlık müziği (perde yönü ölçülerek seçildi). World of Warcraft
  klasörü Blizzard'ın, kullanılmaz. Mikser kaydı sentezden önce dener; yazara efektler açıklamalarıyla verilir.
- **Dil:** `atolye-v3.ts uret` ve `senaryo-yaz.ts` varsayılanı `--dil en` (sipariş kapısı ve AYAS zaten en).

Doğrulama: kök ve remotion-v3 tsc 0; eslint 0; smoke-v3 likeness 10 (yeni), council 4, episode-director 17,
script 16, backgrounds 11, motion 9, mix 7, lipsync 5; smoke-ayas-video-order 4; vitrin karesi (6 kukla) incelendi.

### Devretme ve PC sağlığı (aynı gün, owner: "bu komutları yardımcı beyinlere devret"; "PC sağlığı kurallarını atlama")

- **Rötuş beyni** (`src/lib/v3/council/RetouchBrain.ts`): bitmiş üretimde benzerlik puanı < 8 olan kişiyi sanat
  yönetmeninin fark listesiyle yeniden tasarlatır, eşiğin altındaki seti yeni tohumlarla yeniden çizdirir; üretim kendini
  en erken ilgili adımdan (`gardirop`/`gorsel`) yeniden çalıştırır (`--rotus-turu`, plan `rotus-plani.json`,
  ilk kesim `final-tur0.mp4`). Kod değiştirmez, en fazla 2 tur (`MAX_RETOUCH_ROUNDS`), `--rotus-yok` ile kapanır. Owner kararı: benzerlikte en düşük kabul 8/10 (`LIKENESS_OK`); 2 turdan sonra hâlâ altındaysa "eksik" olarak AYAS'a bildirilir.
- Kişi kütüphanesi sürümlü (`…--v2.json`), eski sürüm silinmez; her sürümün yanında `.kontrol.json` (yan yana puan +
  farklar). Puanı düşük sürüm sonraki bölümlerde yeniden kullanılmaz; farkları tasarımcıya talimat olur.
- **Otomatik efektler** (mikser, yazar unutsa da): kelime kartına düşüş, girişe adım, koşuya hışırtı, ünlem/sürprize
  pop, soru işaretine boing, abone davetine başarı müziği; yazara "her sahnede en az bir sfx" kuralı.
- **PC sağlığı:** yerel GPU modelleri (görüntü hakemi, ücretsiz metin yedeği; `atolye-v3.ts`, `senaryo-yaz.ts`) her
  çağrıdan önce 73 °C kuralını bekler (`coolGpuProvider`); SDXL artık çizim SIRASINDA da her adımdan sonra sıcaklığa
  bakar ve 73 °C ve üstünde kart soğuyana kadar dinlenir (`sdxl_server.py` `max_temp`; önce yalnız başlamadan önce
  bakılıyordu ve tek çizimde 82 °C görüldü). Üretim uzayabilir, sınır aşılmaz.

### Deneyim hafızası (owner onayı: "yardımcı beyinler için sistemi ileri taşıyacak, her zaman kullanılacak bir şey")

`src/lib/v3/council/ExperienceMemory.ts` (fikir: mem0; kendi ekleme-yalnız JSONL dosyalarımızda,
`_kutuphane/deneyim/<beyin>.jsonl`). Beyinler neyin işe yarayıp neyin yaramadığını yazar, bir sonraki işten önce
okur; kod değişmez, ders yalnız veri ya da beynin kendi talimatı olur.
- Onarım: bir hataya uygulanan ilaç sonraki denemede başarılıysa "işe yaradı", değilse "işe yaramadı" kaydı (hata
  imzası: yol/sayı/hash ayıklanmış metin). Aynı hata tekrar gelince bilinen ilaçtan sonra, modele sormadan hafızadaki ilaç.
- Ortam: set hakemi artık reddederken İngilizce "kacin" notu yazar; benzer yer/dönem çizilirken SDXL'in ikinci
  kodlayıcısına "Avoid what failed before: …" olarak gider.
- Kostüm: 3 turda çizilemeyen parçanın son sorunu kaydedilir; benzer parça siparişinde tasarımcıya verilir.
- Kurgu: süre hedef dışı, diyalog oranı %40 altı, hiç sfx yok → ders; Şef'in önlemleri ilgili beynin dosyasına
  "onlem" olarak. Sonraki senaryonun talimatında "LESSONS FROM EARLIER EPISODES".

### Beyin sınavı ve tarihî harita sınırları (aynı gün)

- **Beyin sınavı** (`content/v3/beyin-sinavi.json`, `scripts/v3/beyin-sinavi.ts hazirla|calistir --modeller …`):
  ortak görüntü hakemi bilinen cevaplı 6 soruyla ölçülür (gün batımı göklü sokak ≤5, kilise kuleli MÖ 49 kasabası dönem
  ≤4 vb.); modeller yan yana karşılaştırılır; her çağrı 73 °C kuralıyla; rapor `_kutuphane/sinav/sonuc-*.json`.
- **Tarihî sınırlar** (`src/lib/v3/maps/HistoricalBorders.ts`, aourednik/historical-basemaps GPL-3.0, commit
  `da7a4b73` sabit, 54 anlık görüntü MÖ 123000–2010): yazara bölümün yılına en yakın iki anlık görüntünün devlet adları
  verilir (MÖ 49 → MÖ 100 ve MÖ 1); bölge `"tarihi": {"ad", "yil"}` ile gerçek sınırını çizer; atlasta olmayan ad hiçbir
  şey çizmez (yanlış yer asla). Dosyalar ilk kullanımda `v3-tools/maps/historical/` içine iner; CREDITS'e kaynak eklenir.

### Kapak ve YouTube paketi (aynı gün; higgsfield-youtube-thumbnail ve kostja94 YouTube skill'lerinin bilgisi, ücretli servisleri olmadan)

- Yeni isteğe bağlı adım **"kapak"** (render'dan sonra): `src/lib/v3/thumbnail/ThumbnailDesigner.ts` bölümün kendi
  karakterleri ve setleriyle 3 kapak çizer (baş karakter büyük ve şaşkın; iki rakip karşı karşıya; ikinci karakter),
  üstte 2–4 kelimelik kalın konturlu başlık (`kucukresim` başlık stili); hakem her birini akış boyutunda (480×270)
  puanlar: tek odak, okunur başlık, duygu, merak, doğruluk; en iyisi `kapak.jpg` (1280×720, YouTube'un 2 MB sınırı altı).
- `YoutubePackage.ts` (tek ucuz çağrı, gpt-4.1-mini): 60 karakter altı başlık seçenekleri (anahtar kelime başta),
  kapak başlıkları, sahne bölüm adları, etiketler, hashtag'ler, ilk 160 karakterde anahtar kelimeli kanca. Açıklama
  artık paket başlığı + kanca + zaman damgalı bölümler (0:00'dan, en az 3, her biri en az 10 sn) + kaynaklar + hashtag.
  Hepsi `youtube.json` içinde; QC'de kapak satırı.
- Deneme: eski Roma bölümünden 3 kapak çizildi ve incelendi (başlık okunur, karakterler ve set doğru).

### Openverse ve güvenli duruş (aynı gün)

- **Openverse** (`openverseCandidates`, HistorySources): dönem görseli aramasında The Met'ten sonra lisans filtreli ek
  kaynak (yalnız ticari kullanım + değişiklik izni, judgeLicense'tan geçen; Wikimedia sonuçları atlanır; 24 saat
  önbellek; anonim 20/dk, 200/gün). Bugün bir sorgu 504 verdi: hata aramayı durdurmaz, diğer kaynaklar sürer.
- Roma (`rubicon-en-4`): 1. rötuş turu bitti (111,6 sn); rötuş beyni 2. turu kendisi başlattı; 2. turda üç gerçek
  kişi de ≥ 8/10 (Sezar 8, Pompeius 8, Cicero 9). Güvenli duruşta 2. tur görsel adımındaydı; son tur, kendiliğinden biter.
- Kalan (owner onaylı sıra): beyin sınavını gemma4 ile çalıştır, Qwen3-VL indir ve karşılaştır; Orpheus duygulu ses;
  bütün sistem taraması.

### Roma teslimi ve kare incelemesi (aynı gün, gece)

- `rubicon-en-4` 2. rötuş turu 15:30'da bitti (`EXIT 0`): `final.mp4` 111,6 sn 1080p, kapak + YouTube paketi; QC 15/15,
  kalite beyni 18 kare 9,6/10, 0,41 $. Kurul uyarıları: render bir kez Chrome bağlantı zaman aşımıyla çöktü (onarım
  beyni `ATOLYE_V3_RENDER_CONCURRENCY=2` ile geçirdi); s6-mercy için dönem görseli yok.
- Tüm videoyu kapsayan iki kare tabakasında QC'nin kaçırdığı hatalar: (1) Sezar, Pompeius, Cicero aynı beyaz toga +
  kırmızı kuşakla — Kostüm beyninin notundaki paludamentum kuklaya geçmemiş, adlı karakterlerin kıyafeti ayrışmıyor;
  (2) harita sahnesinde çift "CAESAR" etiketi, simgenin altında kalan "Ariminum", karakterin arkasında "Rome", etiketin
  üstüne binen konuşma balonu; (3) yakın planda isim etiketi yüze biniyor, alt satırı sahne içinde değişiyor;
  (4) kapanışta ~17 sn tek arşiv karesi, karakter yok — "olaysız aralık" kontrolü bunu saymıyor.
- Owner: kullanım yenilenince bu hataları gider; ardından yukarıdaki kalan sıra, sonra birleştirme ve canlıya alma.
  Komutlar ve ayrıntı: `D:\ÜRETİM\handover\SESSION_2026-10-20\DEVAM_RAPORU.md` → "EN GÜNCEL".
