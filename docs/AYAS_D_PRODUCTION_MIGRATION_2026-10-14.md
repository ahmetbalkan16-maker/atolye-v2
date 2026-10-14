## 14 Ekim 2026 — D üretim kökü aktif; C payload kaldırıldı

Yeni canonical repo **D:\ÜRETİM\Atolye\atolye-v2**, runtime **D:\ÜRETİM\runtime\AtolyeRuntime-current**, authority **D:\ÜRETİM\runtime\AtolyeAuthority-current**. Yeni işler, modeller, özel konfigürasyon, yedek/rapor/arşiv bu paket içinde tutulur. Resmi byteExact transition **ayas-d-qualified-20261014** ve SHA-256 ile bağlı materialization kanıtı aktif. 2936 payload dosyası / 721610035 byte ve 20 physical proje yeterli kılındı; Studio 19 proje, gerçek MP4 range206 ve 8 WAV200 dosya hashleriyle doğrulandı. 19 projenin deferred okuması C/D eşdeğer; önceden var olan 6 geçersiz publication intent güvenli reddedilerek korunur.

Canlı build **c10d1e3386e4b1f542c875b59fe03ec28d593af7 / 1fTs5bb88rNOoNq20lo1u**. Son launcher/belge değişiklikleri uygulama kodunu değiştirmez. Gerçek public yerel Whisper/auth/CSRF/boyut/single-flight kabulü geçti; owner telefonda wake çalışır dedi, görev kapalı. Ollama 5 model gerçek D kökünden listelenir; ücretsiz gemma3:4b gerçek HAZIR yanıtı verdi. Access ve Observer başlatıcıları D; eski Observer Task ACL salt okunur olduğu için kendi legacy launcher'ı inert bırakıldı, tek aktif Observer başlangıcı kullanıcı Startup kısayolu. Yerel çalıştırma doğrulandı, reboot testi NOT_RUN.

C'den 340650 eski payload dosyası kaldırıldı; cold archive 107481 dosya / 42911160489 byte hash doğrulanıp D'de korundu. Ollama/cloudflared 47 dosya / 23352726151 byte profile taşındı; C profile klasörleri yalnız D junction referansı. C repo yalnız Codex'in açık çalışma klasörü için küçük README/AGENTS/gitdir ve scripts bağlantısıdır, kaynak veya veri kopyası yok. Windows/kurulu uygulama binary'leri taşınmadı. Windows TEMP/TMP değişmedi; AYAS süreçlerinin temp/cache'i D, Whisper için ASCII D:\URETIM bağlantısı kullanılır. Eski C'ye dönüş artık arşivden resmi restore/qualification gerektirir; önceki rollback makbuzu hemen kullanılabilir geri dönüş vaadi değildir.

USB'ye **D:\ÜRETİM** bütünü kopyalanabilir. Yeni PC'de kurulu uygulamalar yeniden yüklenir, özel config/authority ve fiziksel kimlikler resmi restore ile yeniden yeterli kılınır; salt klasör kopyası otomatik çalışma yetkisi vermez. Mevcut-host kontrolü: node --env-file=.env.local scripts/check-production-layout.mjs; isteğe bağlı başlatma: scripts/start-production.ps1. Ayrıntı docs/AYAS_D_PRODUCTION_MIGRATION_2026-10-14.md. Git kapanışı son commit/push ardından native Graphify emit→grounded stage→ingest, structural complement, gerçek MCP/health/Observer sonucu ile **.graphify/wake-phone-20261013/D_FINAL_RECEIPT.json** içinde tamamlanır; PASS olmadan hazır kabulü verilmez. Alttaki C-canlı kayıtları tarihçedir.

Son D doğrulamaları: TypeScript/scoped lint PASS, Access 50 ve Observer autostart 35 senaryo PASS. Observer fixture ilk Unicode TEMP denemesinde BOM içermeyen generated PowerShell shim yolu bozulduğu için fail oldu; frozen test değiştirilmeden yalnız test TEMP ASCII D bağlantısına alındı ve geçti. Üretim Observer temp gerçek D yolu olarak kaldı. npm cache yeni işler için D/private/npm-cache; geçici formatter cache hash doğrulanıp D arşivine alındı.


## Klasör ve çalışma düzeni

```text
D:\ÜRETİM
  Atolye/atolye-v2       Git, uygulama, bin, data/brain, dünya karakter kitaplığı
  runtime/AtolyeRuntime-current
  runtime/AtolyeAuthority-current
  models/ollama          beş yerel model ve Ollama anahtarları
  private               cloudflared, Access state, özel env/yedek, temp/cache
  archives              eski kaynaklar, geçmiş, cold copy, kullanıcı ZIP arşivi
  backups               doğrulanmış resmi runtime yedekleri
  migration             candidate/consume/qualification kanıtları
  handover              koleksiyon manifestleri, gerçek kabul ve geçiş makbuzları
```

D:\URETIM yalnız aynı pakete bağlı ASCII junction'dır; ikinci veri kopyası değildir. Ollama model ayarı gerçek Unicode D köküdür. Kurulu Node/Ollama/cloudflared/FFmpeg binary yollarının C'de kalması Windows uygulamalarının kurulumudur; AYAS/Atölye payload'ın C'de kaldığı anlamına gelmez. Global Windows veya başka uygulama TEMP/TMP ayarları değiştirilmez. Ollama'nın yalnız models ayarı transaction içinde değiştirildi; diğer ayar alanları ve history tablo sayıları aynı, eski SQLite/WAL/SHM özel D yedeğinde korunur.

## Güvenli geçiş ve değişmeyen sınırlar

İlk byte-exact D denemesi fiziksel descriptor ve eski namespace kimliği nedeniyle resmi tokenlı rollback ile geri alındı. Başarılı yeni geçiş eski payload/history dosyalarını değiştirmeden ayrı materialization kanıtı bağlar. Okuyucular yalnız aktif published target, generation/binding ve kanıt SHA-256'sı doğrulandığında eski kimliğin tam hash/byte/dev/ino karşılığını kabul eder. File open/fstat/hash/post-lstat ve dizin pinleri korunur; farklı kaynak/namespace/SHA, aynı byte ile inode değiştirme ve unpublished target reddedilir. Çoklu geçiş eski quarantine/lift/enforcement kanıtlarını değiştirmez; token tüketimi ile doğrulanmış reactivation yeni append-only çevrim kaydı üretir.

C retirement kendi explicit kökleriyle sınırlandı, önce hash/readback yedeği alındı. Reparse hedefleri silinmedi; yalnız yerel bağlantılar kaldırıldı. Windows, SolidWorks ve diğer kurulu program klasörlerine recursive işlem yapılmadı. Açık Codex host klasörü Windows tarafından yeniden adlandırılamadığı için küçük host referansları bırakıldı; Git actual worktree D'dir. Eski recovery hold'ları veya geçersiz intent'ler elle temizlenmedi. GET /api/assets içindeki önceden var olan eksik operation-context sorunu bu migration kapsamında refactor edilmedi; doğru resmi read-only operation context ile kaynak/hedef eşdeğerliği ayrı ölçüldü.

## Kabul ve kalan fiziksel sınırlar

TypeScript/scoped lint, materialization smoke, üç tekrar relocation/rollback çevrimi, frozen transition21/quarantine15 ve Access50 geçti. Ses publication/compensation suite'leri 11'er geçti ve tasarımlarındaki birer concurrency skip'i korudu; detached11/canonical6 geçti. Gerçek proje medya okuması ve public Whisper kontrolü hash/HTTP/single-flight ile doğrulandı. Gerçek env ile izole Piper/FFmpeg assembly çalıştı; yanlış success logger'ı nedeniyle yalnız logdaki error-free provider/spawn sonucu raporlandı, yeni video görsel kabulü iddia edilmez.

Observer Windows Task güvenlik tanımı yalnız Administrators/System yazabilir, owner okuyabilir. ACL yükseltme yapılmadı; kendi eski VBS inert, D VBS'ye bağlı kullanıcı Startup aktif. D launcher ile çalışan M25 bounded supervisor ve mevcut native singleton kullanılır. Yeniden başlatma yapılmadı; ilk gerçek logon fiziksel kabulü ayrıca ölçülür. Homepage/price/budget/owner approval/frozen sınırları değişmez.

Yeni PC hazırmış gibi sertifikalandırılmadı. USB kopyasından sonra kurulu araçlar yüklenmeli, root/env/startup/key yolları hedef host'a bağlanmalı ve resmi backup/candidate/consume/materialization/authority kabulü tekrar yürütülmelidir. Mevcut host hazırlık kontrolü kopyalanmış projectsRoot inode/dev uyuşmazlığını reddeder. Mevcut geçiş kanıtlarının arşivi korunur; yeni fiziksel kimlikler eski payload kayıtlarına elle yazılmaz. Paket özel anahtar/env içerir ve Git'e girmez.

Exact HEAD için son kaynak/belge commit'inden sonra Graphify/MCP/health kapanış makbuzu üretilir; önceki koleksiyon veya rollback makbuzları tarihsel kapsamlarını korur. Source build HEAD ile daha sonraki yalnız script/belge HEAD'i makbuzda ayrı tutulur.


## 14 Ekim ek temizliği ve süreç TEMP kapsamı

Ollama dahil gerçek AYAS süreçleri D temp ile doğrulandı. Existing Startup/menu aynı installed binary için scripts/ollama-production-hidden.vbs kullanır; Windows genel TEMP/TMP değişmez. İlk iki owned C Temp batch ve son trailing-dot fixture kaldırıldı, belirsiz kaynak/geçmiş D SHA readback arşivlerinde korundu. C:/ayas-iso-val ve diğer historical49-root archive devam eder; tamamlandı denmez. Güncel kapsam/receipts docs/AYAS_C_TEMP_CLEANUP_2026-10-14.md ve ATOLYE_CHECKPOINT.md ilk kaydındadır. Owner phone Graphify eski durumunu bildirdi; WIP commit sonrası native graph/Observer kabulüne öncelik verildi. Eski C host shim yolu OS-held olduğu için restore edildi; Windows/kurulu app/browser metadata korunur.
