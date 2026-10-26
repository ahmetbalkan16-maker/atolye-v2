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

### Hataların giderilmesi ve owner kuralları (20 Ekim gece, 2. oturum)

- (a) Kıyafet: kostümde `pelerin` (paludamentum gibi; arka kısmı bacakların arkasında, omuzda pervaz + fibula);
  tarihçi notunda pelerin geçiyorsa rengiyle eklenir (kişi kütüphanesindeki eski kayıtlara da); `LookVariety` aynı
  giysi/renk/pelerinli adlı karakterleri ikincil renkle ayırır (önce notun rengi: Cicero'ya senatör moru). Sonuç:
  Sezar kırmızı kuşak, Pompeius kırmızı pelerin, Cicero mor şerit.
- (b) Harita: `declutterMap` (aynı adlı ok etiketi düşer, şehrin üstündeki ordu solunda/üstünde), `mapStageX` (tek
  karakter yazıları en az örttüğü yerde).
- (c) İsim etiketi: bulgu yanlış okumaydı; yalnız ekran kenarında yüze kaymaya karşı koruma eklendi.
- (d) Boş kapanış: `stageEmptyScenes` baş karakteri sessiz oyuncu koyar; sessiz sahnede yüz anlatımın duygusunu,
  uzun satırda jest, bölümün son satırında el sallama. QC: `longestEmptyStretch` (karaktersiz en uzun süre) ve
  `clothesClashes` (kıyafet farkı). Roma: 17,9 → 4,5 sn.
- Owner kuralları: deneyim hafızasında "kural" türü konudan bağımsız her seferinde okunur (en fazla 8);
  `content/v3/owner-kurallari.json` her üretimde hafızaya yazılır; Kurgu (senaryo), Kostüm (benzerlik kartı) ve
  Kalite beyni (kare incelemesi) okur. Kalite beyni ilk denemede bozuk tablo künyesini yakaladı.
- Anlamca arama (ruflo'nun vektör hafızası fikri, kendi kodumuz): yerel `qwen3-embedding:0.6b`, işlemcide; eşik
  0,62 Rubicon dersleriyle ölçüldü (aynı yer 0,74–0,96, başka yer 0,39–0,56). Kazanç orta (küçük model); yanlış ders
  getirmiyor, sıralamayı iyileştiriyor.
- Onaylı setler: `setler-kabul.json`; rötuşsuz yeniden üretim Corfinium'u ortaçağ kalesi çizmişti (6/10), şimdi
  8/10'luk set korunuyor ve SDXL çalışmıyor.
- GitHub araştırması → owner onayı: ACE-Step 1.5, MOSS-SoundEffect v2, VoxCPM2, OmniSVG, CLIP ön eleme; hepsi yerel,
  ağırlık lisansı ticari kullanıma açık (HF'den doğrulandı), güvenli yedekle. Elenenler: Woosh (CC-BY-NC), OpenMontage
  (AGPL, ikinci boru hattı), IndexTTS-2 (lisans belirsiz), Orpheus (Llama şartlı; VoxCPM2 daha uygun).

## 21 Ekim 2026 — Uzun video (15–20 dk) ve harita anlatımı altyapısı

Owner: videolar en az 15–20 dk; Hayalhanem Ankara tarzı harita anlatımı; uzun videoda OpenAI tavanı 4 $; önce altyapı,
emin olunca video.

- `fd9bd11a` görsel araması: Chicago + Cleveland müzeleri (CC0); antik dönem görselinde sonraki çağ yapısı elenir.
- `98598152` harita: Natural Earth kabartmalı zemin, kayan/yakınlaşan kamera, hükümdar rozetleri, savaşlar, sınır değişimi.
- `bdedf72d` bölüm bölüm senaryo (`LongForm`), uzun videoda 4 $ tavan, yazar harita anlatımını bilir.
- `1c890cb1` YouTube bölümleri bölüm kartlarından, ortam sesi en uzun 10 yere, kalite beyni tüm videoya yayılır,
  siparişin varsayılan süresi 18 dk.
- Parçalı render (`src/lib/v3/render/ChunkedRender.ts`): ~3 dk'lık parçalar, kesim çekim başına; her parça geçici adla
  yazılır, kare sayısı doğrulanınca kalır; adımın yeniden denenmesi (onarım beyni, yarıda kalan sipariş) yalnız eksik
  parçaları çizer; parçalar yeniden kodlamasız birleşir. Anahtar = plan + Remotion kodu + ölçek/kalite. Gerçek deneme
  (Roma planı, 3 parça): 180 kare, zaman damgası kesintisiz, dikiş kareleri temiz. Yarım kalan `video-sessiz.mp4`'ün
  "bitti" sanılması da kapandı.
- Müzik: bölüm kartı yeni müzik yatağı açar (aynı ruh hâlinde bile). Jenerikteki ses satırı satırları seslendiren gerçek
  motorlardan (İngilizce jenerik VoxCPM2 yerine Kokoro diyordu). Önizleme ölçeği 0,45 (eski 0,4447 yüksekliği 480,276
  yapıyordu, Remotion reddediyordu: `--onizleme` hiç çalışmıyordu). `maliyet.json`/QC gerçek tavanı yazar.
- Kalan: tam regresyon + kısa deneme bölümü, ardından owner onayıyla ilk 15–20 dk'lık video.

### Harita referansa göre yeniden: tarihî sınırlar, canlı anlatım (21 Ekim, öğleden sonra)

Owner harita denemesine: "sınır çizgileri çok kötü, o videodaki gibi değil" → "renkler ve sınırlar daha net olabilir" →
"sadece boyalar gözüküyor, haritayı andıran bir şey yok" → "kaliteyi artırabildiğin kadar artır; harita üzerinde canlı
hareketli anlatım (Yıldırım Bayezid sefere çıkıyor, rozet hareket ederek istikameti gösterecek); bunu sonra bizim
yardımcı yapay zekalar yapabilsin; rozetteki karakter kayıtlı değilse tasarlansın; başka bir şeyi bozma".
Referans kareleri oynatma listesinden alındı (Malazgirt, Osmanlı tarihi): opak canlı devlet renkleri, kıyıya oturan
sınırlar, dar kalın beyaz büyük harf adlar, koyu lacivert deniz, parşömen şeritli portre rozetleri, noktalı kırmızı yollar.

- Sınırlar: sahnenin atlas yılındaki **bütün devletler** boyanır (`backgroundStates`, komşu aynı renk almaz; atlasın
  dönemle uyuşmayan adları yüzünden adsız), adı senaryonun seçtiği devletler taşır. Ad alan merkezine (hilal biçiminde
  bile içeride), büyüklüğe göre boyutlanır, iki satıra bölünür; kadraj içinde, şehir/rozet/savaş/ok adlarından kaçar,
  yer yoksa küçülür (`labelPoint`, `placeStateLabels`). Ok adı şehirlere çarpmayan noktaya.
- Kabartma üslubu (`MapView`, yalnız kabartmalı harita; düz harita değişmedi): renk hard-light karışımla (canlı ama
  dağlar/vadiler görünür), sınır her devletin kendi koyu tonunda keskin çizgi, ince kıyı hattı, kıyıda açık sığ su
  bandı, nehirler, kenar karartması; adlar Bahnschrift dar kalın + yumuşak gölge (çok satırlı tspan Remotion'da ~70 px
  kayıyordu → satır başına ayrı text); şehir adları yolların üstünde; savaş rozetlerin üstünde.
- Canlı anlatım: `rozetler[].yol_satir` — rozet o satırda yola çıkar, yol uzunluğuna göre 2,5–7 sn yürür, arkasında noktalı
  kırmızı iz; sefer okları noktalı kırmızı çizgi olarak kendini çizer; sahne içinde gelen devlet adından dışa yayılarak
  büyür (fetih); harita çekiminde sahne kamerasının %14–20 itişi ¼'e indi (`mapShotCamera`, kenardaki adları kesiyordu).
- Kalite: kabartma zemini çizildiği boyuta kadar (en çok 2,5×, 8192 px) Lanczos + hafif keskinleştirme ile kesilir
  (`RELIEF_VERSION` 2).
- Yardımcı yapay zekalar için: senaryo yazarı istemi (atlas önceliği, adlar, renkler, `yol_satir`, savaşın ~70 km
  yanında biten yol, rozet hükümdarı da `portre`lu görünür kadro → Kostüm beyni benzerliğini çizer, rozet onu gösterir);
  owner kuralları `content/v3/owner-kurallari.json` (+3: harita sınırları, canlı anlatım, kalite beyni için harita
  görünüşü); `scripts/v3/harita-onizleme.ts` (bir bölümün haritalı sahnesini seslendirmeden resim/sessiz klip;
  Claude gerekmez); örnek `content/v3/ornekler/harita-nigbolu-1396.json`. Şema: `yol_satir`.
- Doğrulama: smoke-v3-episode-director PASS (21; yeni O3), diğer 9 V3 smoke + ayas-video-order PASS, tsc 0 (kök +
  remotion), eslint 0; gerçek klip `v3-runtime/harita-onizleme/ornek-harita-nigbolu-1396-s1-harita/s1-harita.mp4`
  (33 sn) kare kare incelendi; Roma bölümünün haritalı sahnesi yeni yolla sorunsuz çizildi.
- Açık: kabartma kaynağı derece başına 60 px (Natural Earth); 1000 km altı yakın planlar için daha yüksek çözünürlüklü
  yükselti verisi (ETOPO/SRTM gölgelendirme) gerekir — öneri, owner kararı bekliyor. historical-basemaps 1400 sınırları
  kaba ve yer yer dönemle uyumsuz (Bizans Yunanistan'ın tamamı).

### Gerçekçi sınırlar, atlas görünümü, dünya geneli (21 Ekim, akşam)

Owner: "sınırları düz değil daha gerçekçi çizilebilir"; örnek bir atlas haritası gönderdi ("seninki daha iyiyse
seninkini yap, kötüyse böyle yapılabilir mi"); "bütün dünya için olacak — Pers, Çin, Amerika; yardımcı yapay zekalar
araştırıp doğru şekilde otomatik videoya uyarlayacak".
- Sınırlar: devletler bugünkü il/eyaletlerden kurulur (Natural Earth 1:10m admin-1, kamu malı, 4552 birim, bütün
  dünya; `src/lib/v3/maps/AdminUnits.ts`): merkezi atlas sınırında kalan iller devlete verilir, ortak kenarlar birbirini
  götürür, geriye devletin gerçek il sınırlarını izleyen dış sınırı kalır. Öncelik: senaryonun kendi bölgeleri (Vidin),
  sonra adı geçen atlas devletleri, sonra diğerleri. 200 km² altı kapalı halkalar (San Marino, eşleşmeyen kenar)
  çizilmez; il arası kılcal boşlukları dolgunun 5 px'lik kendi renkli kenarı kapatır. Veri: `scripts/v3/il-sinirlari-hazirla.ts`
  (bir kez; dosya yoksa eski atlas çizgisi).
- Atlas görünümü (owner'ın örneğinden): deniz adları aralıklı italik (Natural Earth deniz adları, Türkçesiyle;
  Türkçe büyük harf İ korunur), sol altta pusula + kameranın yakınlığına göre km ölçeği, ana devlet (senaryonun ilk
  saydığı) kalın koyu sınır. Örneğin tarihî içeriği yanlıştı (Osmanlı 1299–1326'da bütün Anadolu); bizimki atlas verisi.
- Dünya geneli: kabartma, il sınırları, tarihî atlas (MÖ 123000–2010), deniz adları, nehirler küresel. Kanıt: yeni örnek
  `content/v3/ornekler/harita-pers-480.json` (Kserkses'in Yunanistan seferi; Susa→Sard→Çanakkale→Thermopylae, Salamis).
- Doğrulama: smoke-v3-episode-director PASS (22; yeni O4: il atama, iç kenar silinmesi, deniz adı TR, ölçek, ana devlet),
  diğer 9 V3 smoke + ayas-video-order PASS, tsc 0 (kök + remotion), eslint 0; Niğbolu (33 sn) ve Pers (26 sn) klipleri
  kare kare incelendi; Roma bölümünün haritası yeni yolla sorunsuz.
- Açık: Pasifik'i ortalayan haritalar (180. boylamı geçen dünya) desteklenmiyor; yazarın verdiği şehir/savaş
  koordinatları henüz bağımsız bir kaynakla (Wikipedia koordinatları) denetlenmiyor — sıradaki öneri.

### Sistem hazır: Pasifik haritaları, konum denetimi, harita + çöp adam birleşimi (21 Ekim, gece)

Owner: "çizilemeyenleri de halledelim, sistem hazır olsun; canlıya alındı mı; beyinler kendi başına yapabiliyor mu;
şehir içi anlatımda çöp adam, ülkeler arası konuda harita — 2 özellik konuya göre birleşsin".
- Pasifik (180. boylam): kamera durakları ilk durağın yanında açılır (Japonya 139° → Hawaii 202°), dünya ±180'de kesilmez,
  her şekil/nokta görünüm merkezine en yakın kopyasına taşınır (`shiftFor`, `projectNear`, `touchesRound`), kabartma
  kesimi 180°'yi sararak okur (`relief_crop.py`). Avrupa haritalarında kayma 0. Örnek `harita-pasifik-1941.json`.
- Konum denetimi (`src/lib/v3/maps/PlaceCheck.ts`): senaryodan sonra her şehir/savaş İngilizce Wikipedia'da koordinatlı
  maddeyle aranır (ücretsiz); 40 km'den uzaksa taşınır, üstündeki rozet/yol/ok/ordu noktaları da; erişilemezse
  "denetlenemedi" (asla "doğru" sayılmaz). `konumlar.json`, kurul notu; önizleme `--dogrula`. Canlı deneme: Persepolis
  930 km, Thermopylae 227 km uzağa konmuştu → düzeltildi.
- Sahne türü (owner kuralı): tek mekân → çöp adam sahnesi, mekânlar arası → canlı harita. Yazar istemi (SCENE KIND BY
  SCALE), bölüm planı, owner kuralı; `src/lib/v3/script/MapRules.ts` onarım turlarında ister (harita adlı sahnede harita
  yoksa, haritada hiçbir şey olmuyorsa, sefer/geçiş anlatılıp rota çizilmemişse) ama geçerli senaryoyu asla kaybettirmez.
- Beyinlerin kendi başına denemesi (`--yalniz-senaryo`, Claude yok): "Mongol invasions of Japan" — ilk sürüm 1 cansız
  harita + kumsalda anlatılan deniz geçişi; kurallarla ikinci sürüm 2 canlı harita (kamera, ok, yola çıkan rozet, 1279
  atlas devletleri) + 5 karakter sahnesi, konumlar Wikipedia ile uyumlu, 0,32 $. Haritadaki çöp adam artık konuştuğu
  anda ekranda rozet/ok/savaşın boş tarafında durur (`mapOnScreen`); aynı adlı şehir+savaş bir kez yazılır; pusula/ölçek
  ekrana sabit (ShotView, ölçek bütün yakınlıkları sayar); önizleme ısmarlanmış parçaları atlar.
- Doğrulama: episode-director 23 (yeni O5), script 19 (yeni harita kuralları), diğer V3 smoke + ayas-video-order PASS,
  tsc 0 (kök + remotion), eslint 0; Niğbolu, Pers, Pasifik ve beyinlerin Moğol haritası render edilip incelendi.
- Canlıya alınmadı: owner onayı bekleniyor (ff + otomatik yayın canlı uygulamayı yeniden başlatır).

## 22 Ekim 2026 — İlk uçtan uca AYAS siparişi (kısa deneme): beyinler nerede takıldı

Owner: "kısa bir deneme yapalım, uzun videoya henüz geçmeyelim, AYAS'a başlatalım, sen izle tüm aşamaları, bakalım
beyinler halledebilecek mi". Telefondan "Sezar'ın Rubicon'u geçmesi hakkında kısa bir video yap".
- AYAS her siparişi 18 dk açıyordu ("kısa" tanınıp yok sayılıyordu) → süre konunun çevresindeki sözcüklerden okunur:
  "kısa"/"short" 3 dk ($1 tavanı), "N dakikalık/saniyelik", "a 3-minute"; yoksa 18 dk; konudaki yıl süre sayılmaz (4d5d44ee).
- İlk deneme 2 dk'da araştırmada durdu; dört kök neden (4c5330bd, 20c9ecee):
  1. Sipariş izleyici üreticiyi `npx` + `shell: true` ile başlatıyordu; Windows kabuğu argümanları boşluktan böldü,
     üreticiye konu "Sezar’ın", dönem "konunun" ulaştı (konudaki `&`/`|` komut olarak da çalışabilirdi). Artık
     `productionCommand`: node + tsx CLI, kabuk yok. İzleyici uzun ömürlü süreç: `yapim.ts` değişikliği ancak izleyici
     yeniden başlatılınca geçer (owner onayıyla 11:24'te yapıldı).
  2. Araştırma İngilizce Wikipedia'da Türkçe sözcüklerle + yer tutucu dönemle arıyordu → konu çözümü
     (`resolveTopic`, gpt-4.1-mini): İngilizce konu, yıl, ≤3 makale; `konu-cozumu.json`; sahibin yıllı dönemi korunur.
     Gerçek: "Julius Caesar crossing the Rubicon" (49 BC), 3 makale, 25 olgu doğrulandı, $0.0066.
  3. Onarım beyni (gemma4) V3_RESEARCH_NOTHING'i geçici sandı, 4×30 sn bekledi → bilinen çare: dur; THIN bir kez yeniden.
  4. AYAS "videom ne durumda", "video ne oldu" vb. tanımıyordu (genel modele gidip bilgi veremiyordu), tanıdığında yalnız
     "durdu" diyordu → durum cevabı son üç siparişi `uret.log`'dan anlatır (biten adımlar, n/9, süre, onarım, neden).
- Durmuş sipariş aynı kimlikle kuyruğa geri kondu (eski günlük `uret-1-durdu.log`); ikinci deneme araştırmayı geçti.
- Canlı: 4d5d44ee ve a90f0093 (canlı dalda bekleyen onaylı AYAS önerisi e8531466 birleştirildi) otomatik yayınlandı.

### İkinci deneme: video çıktı (1 dk 50 sn), kare kare inceleme ve dört düzeltme (22 Ekim öğleden sonra)

İkinci deneme onarım beyni hiç gerekmeden 1 sa 44 dk'da `final.mp4` verdi (0,29 $): araştırma 25/25 olgu, tarih denetimi
1 düzeltme (Ariminum Rubicon'dan önce alındı), kütüphaneden Sezar/Pompeius/Cicero, 18/18 Rhubarb, -14,3 LUFS, açılışta
Yvon'un 1875 Sezar'ı, Senato'da Maccari freski, SDXL Roma sokağı. Kalite beyni 18 karede 5 sorun buldu (7,0/10) ama en
büyüklerini kaçırdı. Owner "başla" dedi; dört düzeltme:
- (a) Set olarak fotoğraf/tablo yok: 21 Ekim'in "çizim tutmazsa yerin bugünkü fotoğrafı ya da dönem nesnesi" yedeği
  Rubicon'a 2012 karlı köprü fotoğrafı (arkada evler), heykelin toga kıvrımları ve fırtınada tekne tablosu koydu (hakem
  "konu 10/10"; Delaunay'ı Rubicon sandı). Artık hiçbir set geçmezse dönemi doğru en iyi çizim ya da kütüphane seti
  (`periodFallback`: dönem ≥7, modern/sonraki çağ yok, konu ≥4; QC ve rötuş için işaretli). Dönem resimleri ara görüntü kalır.
- (b) Harita: senaryo "Roman Republic" için -49 yazdı; atlasta yok → sınır da, aynı yıldan boyanan bütün devletler de
  kayboldu. `withAtlasYears`: en yakın, o devleti içeren atlas yılı (gerçek atlas: -49 → -100). 25 km'lik geçiş oku 1.800
  km'de görünmüyordu: `zoomOnShortRoutes` ok anlatılırken kamerayı oka yaklaştırır (ok ekranın ~üçte biri, en az 150 km).
  Üretim (1c) ve `harita-onizleme.ts` ikisi de uygular.
- (c) Süre: üç uzunluk turu (0,17 $) sessizce atılmıştı. Gerçek modelle tekrar: yeni satırlarda listede olmayan duygu/jest
  (13 hata). `normalizeDraft` bunları en yakın değere çevirir (bilinmeyen duygu notr, jest silinir); atılan tur nedenini
  günlüğe yazar. Tekrar: 249 → 502 kelime, 0 sorun (hedef 423; sonraki tur yaklaştırır).
- (d) Kostüm: tarihçi renkleri onaltılık gördüğü için mor tuniği göremiyordu; Cicero'nun çelengini `"bas": null` ile
  kaldırma düzeltmesi birleştirmede null kalıp bölümü bozduğu için atılıyordu. `colourName` + istemde rütbe-renk kuralı;
  `mergeCostume` null/boş parçayı ve "sac" verilip "bas" bırakılmışsa başlığı siler. Tekrar: lejyoner mor → kırmızı,
  Cicero'nun çelengi kalktı, "2 düzeltme uygulandı" (0,0014 $).
- Açık (e): rötuş turu tek seti yeniden çizerken bütün görsel adımını baştan koşturuyor; bu sırada hakem Yvon tablosunu
  ikinci kez geçirmedi — rötuş iyi bir dönem görselini kaybettirebiliyor. Açık (f): lejyoner miğferi kütüphane parçası
  (20 Ekim, hakem 10/10) kenarlı, modern görünüyor (kalite beyni de işaretledi); yeniden çizilmesi owner'a sorulacak.
- Doğrulama: V3 smoke'ları (backgrounds 20, council 11, episode-director 26, likeness 14, lipsync 5, mix 13, motion 9,
  render 5, script 20, youtube 4) + ayas-video-order 8 PASS; tsc 0 (kök + remotion); lint 0 hata.

## İlk AYAS kısa video denemesi — Kosova 1389 (23–24 Ekim 2026)

AYAS'a verilen 3 dakikalık sipariş adım adım takip edildi; her adımın çıktısı (günlük, prova kareleri, harita
önizlemeleri, bitmiş videonun kontak sayfaları) incelendi, bulunan hatalar kodda düzeltildi ve canlıya alındı.
Ayrıntı ve commit listesi: ATOLYE_CHECKPOINT.md "23–24 Ekim 2026 (gece, 3)".

- Bulunan ve düzeltilen: konu yanlış çözümü (Kosova 1998), kostüm provası kesit hatası (15/15 parça haksız ret),
  ortaçağ portrelerinin "dönem" puanından elenmesi, Wikimedia 429 aday kaybı, iç içe cepheler, üst üste rozetler,
  rozet altında kalan güç etiketi, savaştan sonraki atlas yılı, Overpass çökünce dakikalarca bekleme, sakalsız Murad
  (başarısız parça → katalog parçası), çadır sahnesinin dışarıda çizilmesi, durağan yakın harita (otomatik vurgu),
  GPU'nun 85 °C'ye değmesi (çağrı 74 °C altında başlar), DRAMATIZATION yazısı (owner isteğiyle kaldırıldı).
- Yönetmenlik yerel beyinlere: MapRules.directBattleMaps (rozet anıldığı satırda, düşen hükümdara X, bozgun, hücum oku)
  yazarın ilk Kosova senaryosunda elle yapılanların aynısını buldu.
- Doğrulama: smoke-v3-episode-director 48, script 21, council 11, mix 13, motion 9, backgrounds 20, likeness 14,
  youtube 4, render 5, ayas-video-order 8 PASS; tsc 0 (kök + remotion); lint 0 hata / 13 eski uyarı.

## Kosova 1389 videosu bitirildi; kalite beynine kare kusuru tespiti (26 Ekim 2026)

Owner: "videoyu istediğim kalitede bitir", "kare kusuru tespitini beyine kur, o da yapabilsin". Ayrıntı ve commit
listesi: ATOLYE_CHECKPOINT.md "26 Ekim 2026".

- Kare kare inceleme her render'dan sonra (2 sn arayla kontak sayfaları, geçişlerde 5 kare/sn şeritler); bulunan dokuz
  kusur genel olarak kodda düzeltildi: kesik rozet/etiket/devlet ve deniz adları, balon altında ok adı, kaydır geçişinde
  koyu şerit, yüklenmemiş kabartmada lacivert zemin, öldürüldükten sonra ayakta kalan kukla (artık yere yığılır), yerde
  konuşana yanlış kamera.
- Kalite beyni: kare türüne göre evet/hayır soruları, tam boy kenar şeritleri, örnek resimli tecrübe; sınav
  `scripts/v3/kalite-sinavi.ts` (12 soru). gemma4:12b 6–7/12'de kalıyor: küçük kusurları güvenilir göremiyor, örneği
  temiz karelere tekrarlıyor. Beynin "0 sorun"u kanıt değildir; kontrol Claude'da.
- Doğrulama: smoke-v3-episode-director 50, council 12, motion 9, render 5, script 21, backgrounds 20, mix 13,
  likeness 14, youtube 4 PASS; tsc 0 (kök + remotion); lint 0 hata / 13 eski uyarı.
