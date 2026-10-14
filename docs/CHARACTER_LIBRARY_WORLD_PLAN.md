# Dünya Medeniyetleri Karakter Kütüphanesi V1

Tarih: 13 Ekim 2026. Kapsam: owner'ın açık emriyle yalnız kütüphane altyapısı.
ChatGPT karakter tasarımını sağlar; Atölye kabul edilen tasarımı hareketlendirir.
Bu sprint görsel üretmez, internetten veri toplamaz, mevcut üretime yeni seçim yolu eklemez.

## Mimari analiz ve sınır

Mevcut `src/lib/character/volume/CharacterDesignLibrary.ts` parametrik karakterleri
runtime'da saklar; mevcut owner onayı, CAS, preview hash ve sürüm korumaları vardır.
`CharacterImageProvider`, `CharacterSceneManifest` ve animasyon/montaj hattı çalışır.
Bu sistemler yeniden yazılmadı. Yeni kaynak sözleşmesi `libraries/world-characters/`
altında izole tutulur. `src/lib/character/WorldCharacterLibrary.ts` saf metadata ve
seçim doğrulamasıdır; hiçbir production modülü tarafından import edilmez.
`scripts/lib/world-character-library-files.ts` yalnız kaynak dizinini okur ve denetler.

Yeni dosyalar kalıcı source/config/test/documentation sınıfındadır. `_core` ortak
teknik kuralları, pack metadata'ları örnek envanteri, `.gitkeep` boş dizinleri taşır.
İkinci bir production storage root, provider, orchestrator veya approval authority yoktur.
Homepage, fiyat/bütçe, env, frozen testler ve güvenlik kapıları değiştirilmedi.

## Klasör ağacı

```text
libraries/world-characters/
├── README.md
├── _core/
│   ├── mixing-policy.json
│   ├── styles/stylized-history-v1.json
│   ├── rigs/cutout-humanoid-v1.json
│   └── schemas/
│       ├── common.schema.json
│       ├── character.schema.json
│       ├── equipment.schema.json
│       ├── mount.schema.json
│       └── environment.schema.json
├── ottoman/early-modern/janissary/default/v1/
├── byzantium/medieval/varangian-guard/default/v1/
├── persia/achaemenid/immortal/default/v1/
└── egypt/new-kingdom/archer/default/v1/
    # Aşağıdaki aynı yapı dört pack'in her birinde bulunur:
    ├── design/.gitkeep
    ├── parts/.gitkeep
    ├── props/.gitkeep
    ├── mounts/.gitkeep
    ├── environments/.gitkeep
    └── metadata/
        ├── character.json
        ├── equipment.json
        ├── mount.json
        └── environment.json
```

Namespace millet/devlet kimliğidir. Varangian Guard, Bizans pack'inde kalır;
köken çağrışımı başka millet dizininden dosya seçme yetkisi vermez. Dönem adları
organizasyon etiketidir; belirli yılın tarihî doğruluğu henüz araştırılmadı/onaylanmadı.
Yeni medeniyet aynı sözleşmeyle yeni dizine eklenebilir; mevcut dört pack dışında
otomatik veri doldurma veya yeni örnek yoktur.

| Klasör | İçerik |
| --- | --- |
| `design/` | ChatGPT'den gelen front/side/back master sheet; animasyon parçası değildir |
| `parts/` | Tutarlı ölçek/canvas ile alpha içeren gövde parçaları; normalized pivot |
| `props/` | Yalnız bu karakter bağlamına ait ekipman/silah/aksesuar cutout'ları |
| `mounts/` | Yalnız bu bağlama ait at/deve vb. cutout; yoksa açık `none` |
| `environments/` | Yalnız bu bağlama ait arka plan; belirsizken `planned` |
| `metadata/` | Dört kapalı şemaya uyan JSON; medya burada saklanmaz |

V1 medya yolları bu beş klasörde tek dosya seviyesidir. Alt klasör, URL, mutlak yol,
`..`, ters eğik çizgi ve symlink/junction kabul edilmez. Cutout'larda PNG/WebP,
sheet/arka planda PNG/WebP/JPG/JPEG kullanılabilir. Her dosya için SHA-256 zorunludur.

## ID ve sürüm standardı

Her kayıt ve her gerçek dosya asset'i benzersiz kimlik taşır:

```text
civilization.period.role.variant.v<version>
ottoman.early-modern.janissary.default.v1
byzantium.medieval.varangian-guard.default.v1
persia.achaemenid.immortal.default.v1
egypt.new-kingdom.archer.default.v1
```

Companion kayıtları farklı `variant` kullanır: `equipment-basic`, `mount-none`,
`environment-planned`. Dosyalarda örneğin `design-front`, `part-torso`, `prop-bow`
kullanılır. `id`, namespace alanları ve sürüm birlikte doğrulanır; tüm kütüphanede
yinelenen kayıt/dosya kimliği reddedilir. Aynı rolün yeni karakter variant'ı eklenirken
companion/dosya variant'ları da benzersiz seçilir (ör. `ceremonial-equipment-basic`).
Dosya adı kimliğin yerine geçmez. `v1` değiştirilip eski tasarım silinmez;
kabul edilmiş yeni tasarım yeni `v2/` dizini ve `.v2` kimlikleriyle eklenir.
Append-only sürüm disiplini Git incelemesiyle korunur; bu sprint writer eklemez.

## Şemalar ve örnek metadata

Şemalar JSON Schema Draft 2020-12 biçimindedir. `additionalProperties: false`
ve zorunlu alanlar bilinmeyen/eksik alanları reddeder. `common.schema.json`
kimlik, provenance ve dosya tanımlarını paylaşır. Yerel doğrulayıcı yalnız bu
şemalarda kullanılan sınırlı keyword kümesini destekler; tanımadığı keyword'ü
reddeder ve `$ref` ile ağdan veya keyfî dosya yolundan hiçbir şey okumaz.
Namespace ilişkileri JSON Schema'ya ek olarak TypeScript ile denetlenir.

| Şema | Ortak alanlara ek zorunlu alanlar |
| --- | --- |
| `character.schema.json` | `displayName`, `styleId`, `rigId`, `equipmentIds`, `mountIds`, `environmentIds` |
| `equipment.schema.json` | `characterId`, `items` (`slot` ve `fileId`) |
| `mount.schema.json` | `characterId`, `availability`, `species` |
| `environment.schema.json` | `characterId`, `availability`, `setting` |

Ortak alanlar: `schemaVersion`, `kind`, `id`, `civilization`, `period`, `role`,
`variant`, `version`, `status`, `review`, `provenance`, `files`.
Gerçek, tam ve şemaya uyan örnekler dört pack'in `metadata/` dizinlerindedir.
Örnek `character.json`:

```json
{
  "schemaVersion": 1,
  "kind": "character",
  "id": "ottoman.early-modern.janissary.default.v1",
  "civilization": "ottoman",
  "period": "early-modern",
  "role": "janissary",
  "variant": "default",
  "version": 1,
  "status": "placeholder",
  "review": "pending",
  "provenance": {
    "source": "placeholder",
    "rights": "pending",
    "historicalReview": "unreviewed",
    "sources": [],
    "notes": "Structural example only. No generated design, historical approval or production readiness."
  },
  "files": [],
  "displayName": "Ottoman / Janissary",
  "styleId": "stylized-history-v1",
  "rigId": "cutout-humanoid-v1",
  "equipmentIds": ["ottoman.early-modern.janissary.equipment-basic.v1"],
  "mountIds": ["ottoman.early-modern.janissary.mount-none.v1"],
  "environmentIds": ["ottoman.early-modern.janissary.environment-planned.v1"]
}
```

Aşağıdakiler diğer üç şemanın alan örnekleridir; ortak alanlar bu kesitlerde
tekrar gösterilmez. Tam örnekler pack metadata dosyalarındadır:

```json
{
  "kind": "equipment",
  "variant": "equipment-basic",
  "characterId": "ottoman.early-modern.janissary.default.v1",
  "items": []
}
```

```json
{
  "kind": "mount",
  "variant": "mount-none",
  "characterId": "ottoman.early-modern.janissary.default.v1",
  "availability": "none",
  "species": "none"
}
```

```json
{
  "kind": "environment",
  "variant": "environment-planned",
  "characterId": "ottoman.early-modern.janissary.default.v1",
  "availability": "planned",
  "setting": "Unspecified placeholder; research and owner review required."
}
```

Gerçek dosya eklendiğinde `files[]` öğesi aşağıdaki sözleşmeye uyar (`sha256`
gerçek dosyadan hesaplanır; aşağıdaki hash yalnız biçim örneğidir):

```json
{
  "id": "ottoman.early-modern.janissary.part-torso.v1",
  "path": "parts/torso.png",
  "purpose": "body-part",
  "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "pivot": { "x": 0.5, "y": 0.5 }
}
```

Pivot koordinatları görüntünün sol üstünden `[0,1]` aralığındadır. Equipment
`items[].fileId` yalnız aynı equipment kaydının `files[].id` öğesini gösterebilir;
slot'lar tekrar edemez. `ready` ekipmanda dosya/slot envanteri eksiksiz eşleşir.
V1 her karakter için bir equipment, bir mount, bir environment kaydı kabul eder.
Birçok gerçek dosya bu companion kayıtlarının içinde tutulabilir.

## Mixing policy ve kullanım mantığı

`_core/mixing-policy.json`: deny-by-default. Bu dosya ortak sözleşmenin açıklamasıdır;
uygulayıcı kuralı sabittir, metadata bir izin/override sağlayamaz.

1. Klasör, karakter ID'si ve tüm companion/dosya ID'leri aynı medeniyet, dönem,
   rol ve sürüme uyar. Companion sahibi tam karakter ID'sini gösterir.
2. Seçim isteği tam `civilization`, `period`, `role`, `characterId` vermelidir.
   Yakın dönem, başka millet, alias veya eksik kayıt için otomatik fallback yoktur.
3. `_core` yalnız style/rig/schema paylaşır. Silah, giysi, arma, binek ve arka plan
   farklı medeniyetler arasında paylaşılmaz. Ortak teknik rig kültürel izin vermez.
4. `placeholder`/`draft` seçilemez. Seçim için dört kayıt da `ready`,
   `review=owner-approved`, `rights=owner-cleared` ve gerçek kaynak tipinde olmalıdır.
   Karakterde reference-sheet ve body-part zorunludur. `planned` companion hazır sayılmaz.
5. Binek/çevre kullanılmayacaksa `availability=none` ve boş `files` açıkça yazılır;
   hiç çizilmemiş çevre `planned` kalır. Sahne ihtiyacıyla gerçek uyum sonraki adapter'ın işidir.
6. Eksik dosya, değiştirilmiş SHA-256, kayıtsız medya, link, şema/namespace uyuşmazlığı
   veya yinelenen ID işlemi durdurur; guard gevşetilmez.

```typescript
const packs = readWorldCharacterLibrary(); // scripts/lib/world-character-library-files.ts
const pack = packs.find(p => p.character.id === requestedId);
if (!pack) throw new Error('WORLD_LIBRARY_MISSING');
const selected = selectWorldCharacterPack(pack, {
  civilization: 'ottoman', period: 'early-modern', role: 'janissary',
  characterId: 'ottoman.early-modern.janissary.default.v1',
}); // mevcut placeholder örneği burada WORLD_LIBRARY_NOT_READY ile durur
```

Saf seçim yalnız metadata'yı kontrol eder. Dosya denetimi CLI okuyucusunda yapılır.
`ready` kaynak kaydı production yetkisi/onayı oluşturmaz. Şu anda hiçbir production
consumer bu fonksiyonu kullanmaz; mevcut asset seçimi bu sprintte değişmedi.

## Gerçek sheet kabulü ve entegrasyon planı

1. Owner ChatGPT tasarımını ilgili pack'in `design/` dizinine inceleme ile ekler.
   Namespace/dönem/rol, haklar, sentetik görsel açıklaması ve araştırma kaynakları
   metadata'ya yazılır; tarihî doğruluk otomatik onaylanmaz.
2. Tasarım `draft` olarak kaydedilir. Atölye'nin hareketlendireceği ayrı alpha
   parçalar, tutuş/ekipman pivots ve ortak rig joints hazırlanır. Sheet tek başına
   bir rig veya çalışır animasyon değildir.
3. Metadata/hash/namespace CLI'si çalıştırılır. Owner görsel incelemesiyle uygun
   kaynak kaydı `ready` olabilir. Repo metadata'sı mevcut authenticated approval
   mekanizmasını atlayamaz; gerçek runtime kayıt/onayı mevcut library yolu ile yapılır.
4. Ayrı sonraki sprintte `CharacterImageProvider`/animasyon tüketicisi için küçük
   adapter tasarlanır: tam sahne bağlamı, tüm gerçek byte hashleri, image decode,
   alpha/canvas/ölçek ve joint/pivot uyumu yeniden doğrulanır. Stage sözleşmeleri,
   synthetic reenactment etiketleri, mevcut cost ve authority kapıları korunur.
5. Adapter sahne gereksinimine göre gerekli environment/mount/parts kapsamını
   kontrol eder; yetersiz tasarımda fail-closed durur. Karakter görünümünü modelle
   yeniden tasarlama veya başka civilization'dan ödünç parça alma yoktur.
6. Üretilen görüntü/animasyon/video mevcut RuntimeStoragePaths/AssetManager üzerinden
   runtime'a gider. Canonical master sheet kaynak asset'i olabilir; generated frame,
   test çıktısı, cache ve proje medyası kaynak repoya konmaz. Büyük medya için ileride
   owner seçimiyle LFS/referans depolama planlanır; bu sprint LFS/ignore değiştirmez.

V1 denetim sınırları: 256 pack, 2048 dizin ziyareti, dizin başına 256 giriş,
metadata başına 64 KiB, dosya başına 32 MiB, kayıt başına 64 dosya.
Image decoder/alpha kontrolü, tamamlanmış rig, scene-year tarih eşlemesi, runtime
approval binding ve production rendering bu sprintte uygulanmadı. Bunlar metadata
ve hash geçişinden bağımsız kabul adımlarıdır.

## Doğrulama ve teslim

```powershell
npx.cmd tsx scripts/validate-world-character-library.ts
npx.cmd tsx scripts/smoke-world-character-library.ts
npx.cmd tsc --noEmit --incremental false
npx.cmd eslint .
npx.cmd tsx scripts/smoke-character-design-library.ts
npx.cmd tsx scripts/smoke-project-storage-hygiene.ts
```

Smoke; dört örnek, seçim reddi, medeniyet/dönem/rol/sürüm karışması, yanlış owner,
eksik referans, yinelenen ID, path traversal, Windows reserved names, rig pivot,
hak/onay eksiği, dosya hash/tahrif/eksiklik, envanter ve junction kaçışını sınar.
Test fixture'ları özel OS temp dizininde oluşturulur ve doğrulanmış sınırla temizlenir.
Mevcut iki chapter-scene dosyasının oturum öncesi değişiklikleri korunur ve bu
sprint commit'ine dahil edilmez. Exact HEAD ve tam değişen dosyalar Git teslim
raporunda belirtilir; canlı deploy veya genel sistem sertifikasyonu iddia edilmez.


## 14 Ekim 2026 — owner'ın ayrıntılı belgesel yönü

Owner referansına göre yeni Ottoman/early-modern/janissary/reference/v1 draft pack eklendi: imagegen dokuz poz atlası ve üç ayrıntılı ortam (avlu, koğuş, mutfak). Kaynak/byteSHA metadata'ya bağlı; 4 orijinal placeholder korunur. Tasarımın kullanım/üslup izni owner tarafından bu konuşmada verildi; status halen draft, tam gövde pozlar cutout-humanoid eklem rig'i yerine geçirilmez. Varsayılan üretim seçimi NOT_READY reddini sürdürür. Yerel açık PREVIEW_ONLY adapter'i gerçek renderer/FFmpeg/Piper/Whisper ile somut önizleme hazırlar.

Ortak estetik hedef `_core/styles/detailed-documentary-v1.json`; millet/dönem kıyafeti değildir. Sultan, prenses, kral, politikacı, halk, zanaatkâr, demirci, denizci ayrı role/variant kapsamında üretilir; tek yeniçeri görüntüsü başka meslek/millete yeniden etiketlenmez. Büyük otomatik katalog doldurma yok.

180 saniyede en az30 gerçek karakter/ortam değişimi; aynı aktör/odaya yapılan zoom'lar bu sayıya katılmaz. Bu editorial alt-plan frozen pipeline scene aşamalarından ayrıdır: 30'luk legacy scene cap veya stage sırası değiştirilmez. `ImmersiveDocumentaryPlan` namespace/süre/devamlılık/değişim denetimi yapar; resim üretmez ve tek başına production admission vermez. Güncel 6 bölümlü önizleme bu 3 dakikalık kabulün tamamlandığı anlamına gelmez.

Owner ayrıca kaliteli sonuç için toplam en fazla1USD/video OpenAIAPI kullanımını yetkilendirdi. Mevcut bütçe/fiyat tablosu değiştirilmedi; ücretsiz kütüphane tekrar kullanımı önceliklidir. Ayrıntı ve canlı/rig sınırlaması docs/ATOLYE_ILLUSTRATED_DOCUMENTARY_2026-10-14.md.
