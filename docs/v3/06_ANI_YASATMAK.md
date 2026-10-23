# 06 — "İzleyen o anı yaşasın": üretim hattını hedef seviyeye çıkarma planı (22 Ekim 2026)

## Neden

İlk uçtan uca AYAS videosu (Rubicon, 1 dk 50 sn) bütün adımlardan geçti ama owner'ın hükmü: "amatörce, haritada
canlandırma yok, arka resimler ve ortam çok anlamsız; benim istediğim izleyenin o anı yaşamasıydı — çok uzağız".
Owner (aynı gün): sahneyi sen seç, üretim hattını ve videoyu istenen seviyeye çıkaralım.

Kök neden tek tek hatalar değil, sahneleme biçimi:
- Her sahne "arkada tek resim + önünde duran, konuşan kuklalar". Anlatılan olay (gece nehir kıyısı, tereddüt, lejyonun
  suya girmesi) hiç sahnelenmiyor.
- Arka plan, sahnenin mekân adıyla aranan/SDXL'e çizdirilen tek bir görüntü; hakem tutarsız, üslup dağınık, olayın
  havası (gece, meşale, sis, su) yok. Bu adım tek başına 73 dk sürdü.
- Harita durağan: rozet beliriyor, ok kısa, ordu yürümüyor, sınır büyümüyor, kamera izlemiyor.

## Seçilen an: Rubicon geçişi (~30 sn, ölçüt klip)

| # | Görüntü | Ne hareket ediyor | Ses |
|---|---|---|---|
| 1 | Harita, MÖ 49 İtalya: Roma Cumhuriyeti ve Galya boyalı, Rubicon sınır çizgisi olarak parlıyor, Sezar rozeti Ravenna'da | Kamera Galya'dan Rubicon'a iner, nehir adı yazılır | Anlatıcı: "Ocak, MÖ 49…" |
| 2 | Gece, çizili nehir kıyısı: yıldızlar, ay, akan su, sazlar, uzak tepeler; meşaleli lejyon sıra sıra | Su akar, meşaleler titrer, sis süzülür; Sezar atın üstünde kıyıda bekler, düşünür | Lejyoner: "So… are we crossing or not?" |
| 3 | Aynı kıyı, yakın çekim → geniş | Sezar: "The die is cast!" (yumruk), kamera vurur; at suya girer, lejyon arkasından yürüyerek geçer, su sıçrar | Davul, su, kalabalık |
| 4 | Harita | Sezar'ın ordusu Rubicon'dan Ariminum'a yürür, kırmızı ok uzar; Pompeius rozeti Roma'dan güneye kaçar; kamera orduyu izler | Anlatıcı: "Rome panics…" |

Ölçüt: owner bu klibi izleyip "evet, o anı yaşattı" demeden tam videoya geçilmez.

## Eksik yetenekler ve sıra (her biri kısa klip + owner'ın gözüyle doğrulanır)

1. **Çizili, yaşayan ortamlar (SetComposer)** — SDXL tek resmi yerine, sahnenin zamanından (gün/akşam/gece/şafak),
   manzarasından (nehir kıyısı, ova, tepeler, orman, sahil, sokak, meydan, saray içi, meclis, ordugâh, sur önü),
   döneminin mimari üslubundan ve havasından (sis, yağmur, kar) katman katman çizilen düz, kalın konturlu vektör
   sahneler. Canlı öğeler: akan su, titreyen meşale/kamp ateşi, kayan bulut/sis, yıldız. Her zaman konuyla ilgili,
   her zaman aynı üslupta, saniyeler içinde (GPU yok). SDXL yalnız özel istekte.
2. **Olay sahneleme** — yürüyen/koşan/hücum eden/kaçan kalabalık (sıra halinde duran figürler yerine), atlı karakter,
   suya giren karakter (bel hizasına kadar su), elde meşale; yazar her satırda "izleyen ne görüyor"u yazar, yönetmen
   bunu harekete çevirir.
3. **Yaşayan harita** — rota boyunca yürüyen ordu birlikleri, satırla büyüyen/el değiştiren topraklar, sınır olan
   nehirlerin vurgusu, orduyu izleyen kamera; yazara sefer anlatımını "hareket" olarak yazdıran kurallar.
4. **Yazar + kalite beyni** — yazar her sahne için ortam ve olay alanlarını doldurur; kalite beyni kareye "anlatılan an
   görünüyor mu" diye bakar (bugün yalnız teknik kusur arıyor).
5. **Ölçüt klibi** → owner onayı → tam video (önce kısa, sonra 15–20 dk).

## Yön kararı (owner, 22 Ekim akşam)

Resimli belgesele (yapay zekâ ile resimden video) geçiş önerildi; owner reddetti: "bu yaptığımız çöp adam şeklinde
ilerleyelim ve bunu bir belgesel video haline getirelim", "hem çöp adam olacak hem de harita üzerinde canlı anlatım".
Kuklalar ve canlı harita kalır; ikisi belgesel seviyesine çıkarılır. Kuklayı bırakmak yeniden önerilmez.

## Araştırma (22 Ekim): bu tarz kanallar nasıl yapıyor, açık kaynakta ne var

- Hazır "konu ver, belgesel çıksın" aracı yok; bu iddiadaki depolar (enlightenment-pipeline, SceneForge,
  historical-documentary-video-workflow; 0–11 yıldız) resim + seslendirme + kaydırma yapıyor = slayt gösterisi.
- OverSimplified: arka planlar, karakterler, haritalar Photoshop'ta; animasyon After Effects'te; taban harita NASA
  "Whole World Land and Oceans" (kamu malı, düz görünüm, modern şehir yok). Başarısı: sinema gibi kurgu, komik zamanlama,
  her beat'te ne gösterileceğini bilmek, arka plan şakaları.
- Kings and Generals / Epic History / History Marche: her harita bölümü ayrı kompozisyon; ordu hareketleri, kuşatma
  hatları, süvari kanatları, toprak değişimi anlatımla eşzamanlı; şekil katmanı yollarıyla çizilen oklar (trim path).
- `Fansist/warmap` (Remotion, lisanssız → kod alınmaz, fikir alınır): her şey tarihli anahtar kare, motor ara kareleri
  üretir; topraklar anahtarlar arasında **biçim değiştirir** (çokgenler aynı nokta sayısına örneklenip hizalanır —
  sınır "belirmez", kayar); ordular rota boyunca kesik izle yürür, filolar eğri bacaklarla, gemi sayısı azalınca
  küçülür; savaş patlaması (büyüklük), kuşatılan kale nabız atar, el değiştirince renk değiştirir; ikmal yolu kesilince
  kırmızı; kamera zoom'u logaritmik; zaman bölümleri (bir günlük savaşa daha çok ekran süresi).
- Mapimator (tarayıcı aracı): yollar boyunca ilerleyen sivrilen okular, bölge bölge yayılan fetih, taranmış (işgal)
  topraklar.
- Arka planlar: SDXL için çizgi film arka plan LoRA'ları — BACKTOON (openrail++, tetik "flatee v3rd", "background
  plate"), "SDXL Cartoon Background" (982 gerçek çizgi film arka planıyla eğitilmiş, insansız; lisansı sayfadan
  doğrulanmalı). Bizim canlı katmanlarımız (su, meşale, sis, ışık) bunların üstüne biner.
- Ses: Freesound (CC0 süzgeci; nehir, gece cırcır, kamp ateşi, yürüyen ordu, kalabalık), Kenney CC0 (zaten var),
  Sonniss GDC paketleri (telifsiz, ticari serbest, atıf gerekmez; yapay zekâ eğitimi yasak — biz yalnız kullanırız).

## Uygulama sırası (araştırmadan sonra)

1. **Canlı harita**: toprak biçim değiştirmesi (satırla büyüyen/küçülen sınır), rota boyunca yürüyen ordu birlikleri
   ve kesik iz, ilerledikçe çizilen sivri oklar, savaş patlaması, ele geçen şehrin renk değiştirmesi, orduyu izleyen
   kamera (logaritmik zoom).
2. **Sahne ortamı**: SDXL + çizgi film arka plan LoRA'sı ile ayrıntılı düz arka planlar (alt bant karakterlere boş),
   üstüne bizim canlı katmanlarımız; tek üslup; ortam alanından tarif.
3. **Ses**: ortama bağlı ambiyans yatakları (nehir, gece, kamp, kalabalık) + harekete bağlı efektler (yürüyüş, suya
   giriş, at, kılıç), CC0/Sonniss.
4. **Ölçüt klip** (harita → gece Rubicon → geçiş → haritada yürüyüş), owner'ın gözüyle.

## Durum (22 Ekim akşam)

- Çizili yaşayan ortam, yürüyen kalabalık, suya giren karakter (16e33f3d); üretim hattına bağlandı (6fef977c):
  ortamı olan sahne SDXL/kütüphane/hakem kullanmaz — görsel adımı 73 dk → ~4 dk.
- Canlı harita (dd6f62af, 6fef977c): il il yayılan fetih (ordu aynı satırda yürüyorsa onun hızında, ötesi ordu
  vardıktan sonra), eski sahibin adı cephe geçince söner, yürüyen ordu + iz, parlayan sınır çizgisi, sivri sefer oku,
  orduyu/kaçanı izleyen kamera.
- Yazar beyni bu yetenekleri kullanır (de7d3bd8): ORTAM bölümü, kalabalık hareketi, ordular.yol, yayilma, cizgiler,
  "anlatılan o satırda ekranda görünsün"; ortamsız karakter sahnesi onarımda istenir.
- Ses (2c86a16b, b87b9d00): ortam sesi ortamdan (nehir, gece, sis, meşale, ordu); yürüyüşte adım, hücumda kalabalık+
  davul, suya girişte gerçek şıpırtı ("su"), haritada yürüyen orduda davul, savaşta kılıç.
- Kalite beyni (b87b9d00): o an söyleneni görür, "anlatılan ekranda mı" (anlati 0–10) puanlar.
- Kalabalıkla aynı üniformadaki adlı karakter pelerin alır (ef1dc29a).
- Ölçüt klip 1 (olcut-rubicon-1, 53 sn): harita + gravür ara görüntüsü + gece geçişi; ölçüt klip 2 tüm
  iyileştirmelerle üretildi.
- Owner (22 Ekim akşam): "ilerleme var"; hareket sırasında garip ses, harita daha yavaş/belirgin/akıcı olmalı;
  kalabalık canlılığı ve at istendi. Yapılan (67925ff8…3c974a6a): vuruşsuz davul (MOSS'un borulu uğultusu, 1,5 dB)
  vuruş kontrolüyle reddedilir, ortamlı sahnede koşu ayak sesidir; harita ~2 kat yavaş, 16 bantlı cephe, ordunun
  arkasında büyüyen sefer oku, kamera 2,4 sn; kalabalıkta farklı yüzler, yumruk, liderin ünlemine tezahürat; at
  (binek: at) — Sezar Rubicon'a atla girer, atlı konuşana dönerken atı çevirmez. Ölçüt klip 3: olcut-rubicon-3. Sıradaki: owner'ın gözü; ardından arka plan detayı (SDXL çizgi film LoRA'sı) ve yazar
  beyninin Claude'suz denemesi (yeni konu, `--yalniz-senaryo`).

## Haritalı anlatım (22–23 Ekim gece)

Owner: haritalı anlatıma öncelik; örnekler Anima History (2. Dünya Savaşı, haritada birlik pulları, patlamalar, hareket
eden araçlar) ve DFT Tarih (Osman Bey: dış harita → yakın savaş haritası → konsey sahnesi → yine harita).

- **Birlik pulları** (`harita.birlikler`): tarafın amblemli yuvarlak pulları; her satırda cephe / küme / kuşatma
  dizilişine kayar. Savaş satırında (kayıp olan satır) iki taraf birbirine atılır, değdiği yerde vuruşur, kayıplar
  **teker teker** X'lenip düşer; her düşüşte kılıç sesi (`unitLossDelaysS`, görüntü ve ses aynı zamanlamadan).
- **Araçlar** (`harita.araclar`): kadırga, yelkenli, savaş gemisi, denizaltı, süvari, fil, top, tank, uçak; yol boyunca
  ilerler, `hedef`e ateş eder. Dönemde olmayan araç doğrulayıcıda hata (1453'te tank yok); `gemi` dönemine göre çizilir.
- **Yakın savaş haritası** (genislik_km ≤ 120): kıyı OpenStreetMap'ten (Haliç dahil), zemin gerçek yükseltiden (AWS
  Terrain Tiles, atlas renkleri + gölgeleme); üstünde `surlar` (burç, kapı, gedik), `yerlesimler` (şehir evleri, köy,
  ordugâh çadırları, yangın), `yapilar` (kale, saray, kilise, cami, kule, otağ), `yollar`, `arazi`; `cizgiler` içinde
  `stil: "zincir"` (Haliç zinciri). Örnek: `content/v3/ornekler/harita-fetih-1453-yakin.json`.
- **Hazır haritalar:** Commons'taki olaya özel haritalar CC BY-SA (videoyu da BY-SA yapabilir) ve üzerlerinde basılı
  yazı/işaret var; telifsiz eski haritalar (Buondelmonti, Matrakçı) ara sahne için. Yakın harita açık veriden üretilir.
- **Sıradaki:** ölçüt bölüm 1453 (dış harita → yakın harita → otağda savaş toplantısı → yakın harita, sesli), yazar
  beyninin bu alanları kullanması, küçük etiket çakışmaları, gedikten yayılan yangın.

## Yakın harita her olay için (23 Ekim)

Owner: "bu özellikleri bizim yardımcı beyinler yapabilmeli, alt yapıyı tam kur; bu haritaları bütün dünya üzerinde
herhangi bir olayda yapabilmeliyiz — yakın haritayı, kaleyi."

- **Okunur harita** (`CloseLabels.ts`): savaş, zincir, sur, yerleşim, yapı ve yol adları her kamera duruşunda öteki
  adlara, şehirlere, pullara, gemilere, yapılara, surlara ve pusula köşesine en az değen yere konur. Yollar kıvrılır ve
  adını taşır; yangın gedikten yayılır; pullar gedikten geçer; kamera kadraj dışındaki savaşa döner.
- **Karadan yürütme**: gemi rotası sudan suya bir kara parçasını aşarsa kütük kızak yolu, dönen kütükler, halatla çeken
  ekip, tek sıra kafile. Karada biten ya da iç karadan başlayan rota çekme değildir (yazar bir yeri işaret etmiştir).
- **Açık veriden yer** (`CloseSite.ts`, `CastleShapes.ts`): sur ve kale izi katmanlarla — kütüphane → Overpass (sur,
  kale, kapı) → Nominatim (adıyla kale/sur) → yazarın çizgisi ya da çağına göre çizilen kale (1500 öncesi burçlu
  halka, 1500–1870 yıldız tabya). İnce şerit surların orta hattı, parçaların birleşmesi, yazar çizgisine oturtma;
  kalenin alanındaki gerçek sur hatları ve kapıları (Belgrad: 24 hat, 8,2 km, 7 kapı). Kuşatma halkası olup suru
  olmayan yakın haritaya kale kendiliğinden kurulur (ad mekândan: "Belgrade Fortress"). `sur_ici`: şehir evleri surun
  içinde. Nehirler ve göller OSM'den gerçek genişliğiyle (iç karadaki savaşlar); Natural Earth nehri bu ölçekte bant
  olmaz.
- **Yazar beyni**: ScriptPrompts'ta BİRLİKLER VE ARAÇLAR ile YAKIN SAVAŞ HARİTASI bölümleri (akış, alanlar, savaş
  kuralları); MapRules yakın harita denetimleri (ordusuz harita, kayıp satırında düşman uzakta, kuşatma var sur yok);
  DraftNormalizer tarafa yazılmış dizilişi `yerler`e taşır, ortam/duygu değerlerini eşler; PlaceCheck yakın haritada
  harita genişliğine göre tolerans ve adlı yapılar (yalnız aynı adlı makale).
- **Sınav**: 1456 Belgrad Kuşatması, Claude'suz (gpt-4.1, 0,15 $): yakın harita 18 km, pullar, kaleyi döven toplar,
  Tuna'yı kapatan donanma, kendiliğinden kurulan kale (OSM çevresi). Kalan zayıflık: savaşın kendisi karakter
  sahnesinde anlatılıyor, yakın haritada kayıp yok; haritada konuşan iki büyük figür savaşı örtüyor.

## Savaşın kendisi yakın haritada (23 Ekim akşam)

- **Konuşan rozet** (`MapSpeakers.ts`): haritada konuşan karakter tam boy çizilmez; portre rozeti konuşur (ağız, yüz,
  büyüme, altın halka), söz balonu rozetten çıkar, harita geniş kalır. Yakın haritada rozetsiz konuşmacının rozeti kendi
  tarafının pulunda: en az şeyi örten ve konuştuğu her satırda kadrajda kalan pul.
- **Araç kayıpları** (`araclar[].kayip`, `kayip_satir`): gemiler batar, toplar/atlılar/tanklar patlar, uçaklar düşer —
  teker teker, sesleriyle. Deniz savaşı iki donanma ve batan gemilerle anlatılır.
- **Yazar beyni**: kuşatma/savaş öyküsü sırası — yürüyüş (dış harita) → yakın harita (ordular, toplar, donanma) →
  konsey (karakter sahnesi) → aynı yerin ikinci yakın haritasında hücum (gedik, iki yanda kayıp, geri püskürtme) →
  tepki → sonuç haritası. Hücum yalnız karakter sahnesinde anlatılırsa onarım istenir; uzunluk turu harita
  kazanımlarını bozamaz.
- **Sınav 4** (Belgrad, 0,45 $): yazar bu akışı kendisi kurdu (Tuna'da batan Osmanlı gemileri, surlu hücum haritası,
  Mehmed rozetinden konuşur).
- **Kusur düzeltmeleri**: karaya konmuş gemi en yakın suya oturur, ona yöneltilen ateş onu izler; yazarın rozeti
  örttüğü pullardan biraz kayar; km'siz küme/kuşatma yakın haritada haritanın onda biri (önceden 30/40 km — pullar
  harita dışına düşüyordu).
