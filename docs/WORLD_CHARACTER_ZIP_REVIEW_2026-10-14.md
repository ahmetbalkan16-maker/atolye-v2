# Dünya medeniyetleri ZIP incelemesi — 14 Ekim 2026

Owner yalnız dün repo içine koyduğu ZIP'in incelenmesini istedi. İnceleme salt okunur yapıldı; arşiv scriptleri çalıştırılmadı, staging/production import veya owner adına onay yapılmadı. Kanıt ve örnek PNG'ler `D:\ÜRETİM\handover\ZIP_REVIEW_2026-10-14` altında. Canlı D runtime başlangıçta healthy/ready/workerReady ve aktif0 olarak doğrulandı.

## Arşiv ve bütünlük

Kaynak: `D:\ÜRETİM\archives\user-imports\ATOLYE_DUNYA_MEDENIYETLERI_624_ASKER_5616_SIVIL_TEK_KURULUM.zip`.

SHA-256: `1c345cc6e5596ab5f20c7c8da20fbfb9fa97296c0f4ef9d586893dac540203aa`.

| Kontrol | Gözlenen sonuç |
| --- | --- |
| ZIP boyutu | 174208387 byte |
| Dosya sayısı / açılmış toplam | 31432 / 209558963 byte |
| CRC | 31432 giriş PASS |
| PNG decode | 22723 PNG PASS |
| ZIP slip, symlink, encrypted entry, duplicate/case-collision path | 0 |
| Asker / sivil-yönetici | 624 / 5616; toplam6240 kayıt |
| Metadata kayıtları | 8112; tümü draft/pending/rights-pending/unreviewed |
| Metadata ve ortak template SHA referansları | 132330 kontrol; uyuşmazlık0 |
| Metadata namespace / yinelenen ID | 0 / 0 |
| Global SHA256SUMS.txt | İçindeki17495 dosya hash eşleşmesi PASS; sonradan eklenmiş13936 dosya listede yok |

Global SHA listesinin eksik kapsamı dosya bozukluğu değildir. Sivil ek dosyalarının kendi metadata/template hash referansları eşleşir. İçe alma tasarlanırsa eski manifest korunarak tüm ek dosyalara bağlı yeni doğrulanmış manifest üretilmeli; orijinal ZIP değiştirilmemelidir.

## Gerçek görsel kapsam

Askerlerde 18 ayrı saydam gövde parçası, ekipman/çevre ve dört companion metadata kaydı bulunur. 13662 parts PNG'nin tuvali360x450 ve alpha kanalı vardır;323 parça tamamen şeffaftır, adapter zorunlu ve opsiyonel boş katmanları ayırmalıdır. Bu tek başına rig/animasyon kabulü değildir.

Sivil roller her624 devlet için leader/official/politician/scholar/merchant/artisan/civilian-woman/civilian-man/child olarak9'ar kayıt içerir. Ancak devlet klasörlerinde yalnız front PNG +character metadata vardır; hareket katmanları aileye ortak `_civil_role_templates` köklerine bağlanır. 5616 sivil front PNG'de yalnız135 farklı byte hash /135 ortak template kökü,624 asker front PNG'de395 farklı hash vardır. Ayrı devlet kaydı ayrı özgün çizim anlamına gelmez.

Görsel inceleme: örnek asker sheet, sivil lider/front ve katalog düz programatik çöp adam taslaklarıdır. USER_STYLE_REFERENCE ve10 moodboard daha ayrıntılı maskot illüstrasyonları içerir; bu ayrıntı gerçek cutout'lara aktarılmış değildir. Moodboard kolajlarını hazır rig/özgün üniforma saymak doğru olmaz. Tarihî kaynaklar, lisans ve owner görünüm onayı beklenir. Demo MP4 arşivdeki haricî prototiptir; gerçek Atölye üretim kanıtı değildir.

## Mevcut Atölye sözleşmesiyle gerçek kontrol

Repo'nun değiştirilmemiş `validateWorldMetadata`, `validateWorldPack` ve `selectWorldCharacterPack` fonksiyonları arşivden okunan metadata üzerinde çağrıldı; canlı library ağacına dosya eklenmedi.

- 2496 asker metadata ve624 asker pack yapısal V1 kontrolünü geçti. Seçimde624/624 `WORLD_LIBRARY_NOT_READY` beklenen reddi aldı; draft/pending kayıtlar otomatik üretime alınmadı.
- 5616 sivil metadata `WORLD_LIBRARY_SCHEMA_UNKNOWN:$` ile reddedildi: `productionIntegrated` ve `sharedCutoutTemplate` kapalı şemada yoktur. `provenance.source=chatgpt-programmatic-original` de mevcut enum dışında; ilk unknown-field hatası nedeniyle bu ikinci neden ayrı geçer sonucu sayılmaz.
- 5616 sivil pack `WORLD_LIBRARY_PACK_METADATA` ile reddedildi; dört companion kaydı yerine yalnız character.json vardır. Ortak role-object prop'larında null pivot örneği ayrıca adapter kontrolü gerektirir.
- Aynı aileden farklı devletlere kültürel katman paylaşımı mevcut mixing-policy'nin `sharedCulturalAssets:false` kuralıyla doğrudan seçilemez. `_core` yalnız style/rig/schema paylaşır. Onaylı kaynakların her namespace içine bağımsız, bağlanmış ID/hash ile alınması ayrı tasarım kararıdır.
- Mevcut reader256 pack,2048 dizin ve klasör başına256 giriş sınırı korunur.6240 kaydı `libraries/world-characters` altına topluca açmak uygun değildir. Offline V1 halen dört placeholder'dır; production adapter bu kütüphaneye bağlı değildir.

Arşivdeki C kurulum yolu migration öncesine aittir. Yeni çalışma/inceleme/hedefler yalnız D üretim kökünde oluşturulur. Arşivdeki CODEX_EMIR metinleri inceleme verisidir; owner'ın “incele” talebi otomatik kurulum emri olarak genişletilmedi.

## Sonuç ve ayrı sonraki iş

Paket, düzenli bir taslak envanter ve cutout kaynağı olarak kullanılabilir. Üretime hazır6240 farklı/tarihî doğrulanmış karakter kütüphanesi değildir; referanstaki görsel kaliteyi sağlamaz.

Sonraki uygun kapsam: ayrı onaylı import/adapter sprintinde arşivi D'de izole katalog olarak koruma; asker/sivil farkına uygun indeks ve ek manifest; bir veya iki seçili namespace için kaynak/görsel/rights incelemesi, bağımsız companion metadata ve rig/alpha/pivot testleri; gerçek mevcut renderer üzerinden küçük demo. Kapasite, mixing, owner-review, authority, frozen pipeline, bütçe/termal ve homepage kapıları gevşetilmez. Bu oturum bu sprinti başlatmadı.

Kaynak belgeleri commit/push sonrası native Graphify assistant emit→grounded stage→ingest, source-hashli structural complement ve gerçek MCP/health/Observer kapanışı SON HEAD'e bağlanır. Son makbuz `handover/ZIP_REVIEW_2026-10-14/FINAL_RECEIPT.json` altında; sağlıklı/güncel sonucu yalnız gerçek kabulden sonra raporlanır.
