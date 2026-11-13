# Canva kapağı (isteğe bağlı)

Owner kararı 13 Kasım 2026 ("o iki fikri işleme al, yaptır"). Atölye, YouTube kapağını senin Canva **marka
şablonlarını** otomatik doldurarak da yapabilir: bölümün kapak başlığı, video başlığı, dönemi, dizi satırı ve seçilen
kapağın karesi şablona konur, Canva bunu JPG olarak verir. Video yine Remotion ile yapılır; Canva yalnız kapak içindir.

- Kendi kapağımız (`kapak.jpg`) her zaman yapılır ve **hiç ezilmez**. Canva kapağı yanına `kapak-canva.jpg` olarak
  yazılır; üretimde Canva açıksa YouTube'a yüklenen kapak odur.
- Canva bir şey yapamazsa (bağlantı yok, şablon yok, sınır, hata) tek satır yazılır ve kendi kapağımız kalır.
- Varsayılan **kapalı**: üretim yalnız `ATOLYE_V3_CANVA=1` iken Canva'yı dener.
- Her deneme Canva hesabında yeni bir tasarım oluşturur (kök klasörde, başlığı "<bölüm> — kapak").
- Canva sınırları (canva.dev, 13 Kasım 2026): dışa aktarma kullanıcı başına 5 dakikada 75, günde 500; indirme
  bağlantısı 24 saat geçerli. Bir bölüm bir dışa aktarma kullanır.

## 1. Canva geliştirici portalında entegrasyon

0. Canva hesabında **iki adımlı doğrulama (MFA)** açık olmalı (Canva entegrasyon geliştirenden bunu ister).
1. https://www.canva.com/developers/apps → **Create an app**.
2. **Who can use your app?** → **Anyone on Canva** (herkese açık entegrasyon). "Restricted to your Canva team"
   (özel) Enterprise ister; Pro'da seçme. Bu seçim sonradan değişmez. İncelemeye (review) göndermen gerekmez —
   entegrasyonu yalnız sen kullanacaksın.
   *Doğrulanmadı:* incelenmemiş bir entegrasyonu sahibinin kendi hesabıyla kullanabildiği belgede açıkça yazmıyor;
   `baglan` sırasında Canva reddederse bunu yaz, ona göre ilerleriz.
3. **Outside Canva** → **Start integrating**. Sonra **Outside Canva > Configuration**:
   - **Integration methods**: **Canva REST APIs** açık.
   - **Credentials**: Client ID'yi not et, **Generate secret** ile secret'ı al (bir daha gösterilmez).
   - **Scopes** — tam olarak bunlar (her biri ayrı; biri diğerini kapsamaz):
     - `asset:read`, `asset:write` — kapak karesini yükleyip yükleme işini okumak
     - `brandtemplate:meta:read` — marka şablonlarını listelemek
     - `brandtemplate:content:read` — şablonun doldurma alanlarını okumak
     - `design:content:write` — şablonu doldurup tasarım yapmak
     - `design:meta:read` — doldurma işinin sonucunu okumak
     - `design:content:read` — tasarımı JPG olarak dışa aktarmak
4. **Outside Canva > Redirect URLs** → **URL 1**: `http://127.0.0.1:3917/oauth/redirect`
   (başka port istersen aynısını `ATOLYE_V3_CANVA_REDIRECT` ile ver; yalnız `http://127.0.0.1:<port>/...` kabul edilir).

## 2. Ayarlar (gizli bilgiler git'e girmez)

`.env.v3.local` (git dışı) ya da `ATOLYE_V3_SECRETS_ENV`'in gösterdiği env dosyası:

```
ATOLYE_V3_CANVA_CLIENT_ID=OC-...
ATOLYE_V3_CANVA_CLIENT_SECRET=cnvca...
# İsteğe bağlı:
ATOLYE_V3_CANVA_DIR=            # token.json'un klasörü; boş = output/v3-canva (git dışı)
ATOLYE_V3_CANVA_REDIRECT=       # boş = http://127.0.0.1:3917/oauth/redirect
ATOLYE_V3_CANVA_TEMPLATE_UZUN=  # content/v3/canva.json yerine
ATOLYE_V3_CANVA_TEMPLATE_KISA=
ATOLYE_V3_CANVA=                # 1 = üretim Canva kapağını dener
```

Erişim ve yenileme anahtarları `ATOLYE_V3_CANVA_DIR\token.json`'da durur, kendiliğinden yenilenir (Canva'nın yenileme
anahtarı tek kullanımlık; her yenilemede yenisi hemen kaydedilir).

## 3. Bağlan (bir kez)

```
npx tsx scripts/v3/canva.ts baglan
```

Tarayıcıda Canva izin ekranı açılır; izin ver. Yanıt yalnız bu bilgisayarda (127.0.0.1) 10 dakika beklenir.
Kontrol: `npx tsx scripts/v3/canva.ts durum`.

## 4. Marka şablonu hazırla

Canva'da kapak şablonunu yap (16:9 uzun video için 1280×720; Shorts için ayrı bir dikey 1080×1920 şablon), **marka
şablonu** olarak yayınla. Alan eklemek: editörde **Apps** → **Bulk Create** → **Labels** → öğeyi seç → **Data field**
bağla ve ad ver (Canva rehberi: canva.dev/docs/connect/autofill-guide). Kodun doldurduğu alanlar (adları `content/v3/canva.json` → `alanlar` ile değiştirebilirsin):

| Alan adı | Tür | İçine ne konur |
|---|---|---|
| `kapak_basligi` | metin | Kapağın 2–4 kelimelik başlığı ("HE DID WHAT?") — seçilen kapak çeşidinin başlığı |
| `video_basligi` | metin | Videonun başlığı (YouTube paketinin ilk başlığı) |
| `donem` | metin | Dönem ("49 BC") |
| `dizi` | metin | Dizi satırı ("Fatih 06") — yalnız dizi bölümlerinde; tek bölümlerin şablonuna koyma |
| `resim` | görsel | Seçilen kapağın karesi |

Şablonda olmayan alan atlanır (günlükte yazılır); türü yanlış olan alan da atlanır. Hiçbiri yoksa Canva denenmez.

`resim` iki türlü olabilir (`content/v3/canva.json` → `"resim"`):
- `"temiz"` (varsayılan): seçilen kapak çeşidi **bizim başlığımız olmadan** yeniden çizilir; başlığı şablon yazar.
- `"kapak"`: bitmiş kapağımız olduğu gibi konur; şablon yalnız çerçeve, logo, kanal rengi ekler.

Şablon kimliği yayınlanmış şablonun adresinin son parçasıdır (`.../brand/brand-templates/<kimlik>`); ya da listele, sonra `content/v3/canva.json` → `sablonlar.uzun.id` / `sablonlar.kisa.id`'ye yaz:

```
npx tsx scripts/v3/canva.ts sablonlar
```

`kalite` (1–100, varsayılan 90): YouTube kapağı 2 MB'ı aşamaz; aşarsa Canva kapağı reddedilir, kalite düşürülür.

## 5. Dene, sonra aç

Bitmiş bir bölüm klasöründe (episode.json ve youtube.json olan):

```
npx tsx scripts/v3/canva.ts dene --bolum <bölüm klasörü>
```

Klasöre `kapak-canva.jpg` yazar (kapak.jpg'ye dokunmaz) ve Canva'da düzenleme bağlantısını gösterir. Beğenirsen
`.env.v3.local`'a `ATOLYE_V3_CANVA=1` yaz: bundan sonraki üretimler kapak adımında Canva'yı dener.

Kapatmak için `ATOLYE_V3_CANVA=` (boş) ya da satırı sil. Bağlantıyı tamamen kesmek için Canva'da entegrasyonun iznini
geri al ve `token.json`'u sil.

Kod: `src/lib/v3/thumbnail/CanvaThumbnail.ts` (saf kısım), `src/lib/v3/thumbnail/CanvaClient.ts` (ağ; canlı AYAS
sunucusu içe aktarmaz), `scripts/v3/canva.ts`, deneme: `scripts/smoke-v3-canva.ts`.
