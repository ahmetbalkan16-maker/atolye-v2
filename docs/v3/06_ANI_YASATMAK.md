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

## Durum

- 1. adım başladı (22 Ekim).
