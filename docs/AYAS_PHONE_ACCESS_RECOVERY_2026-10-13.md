# AYAS telefon erişimi — 13 Ekim 2026 kapanışı

Owner telefonda sayfanın hiç açılmadığını/bağlantı hatası verdiğini bildirdi.
Onarım sonrası **“tamam açıldı”** diyerek gerçek telefon erişimini doğruladı.
Bu kayıt yalnız erişim onarımı ve önceki Dünya Karakter Kütüphanesi V1'in
tamamlanmış kaynak kapsamını kapatır; yeni production adapter veya görsel üretimi yoktur.

## Kanıtlanan arıza

- `https://ayas.atolyeayas.com/` gerçek HTTP **502** döndürüyordu.
- DNS çözülüyor ve aynı named cloudflared tüneli **29440** çalışıyordu.
- Yerel `127.0.0.1:3000` bağlantıyı reddediyordu; web sunucusu ve Access
  supervisor süreci mevcut değildi. Durum dosyasının son sağlıklı kaydı
  **16:02 İstanbul /13:02 UTC** idi. Tünel loglarında sonraki istekler için
  `Unable to reach the origin service` /`connection refused` vardı.
- Bu, istemci DNS/sertifika veya paroladan önce **origin servisinin kapalı
  olması** nedeniyle oluşan kesintidir. Süreçleri hangi kişi/işlemin durdurduğu
  eldeki kanıtla belirlenemedi; crash veya owner müdahalesi varsayılmadı.

## Kalıcı başlangıç düzeni ve uygulanan onarım

Mevcut güvenli düzen 10 Ekim runbook'unda açıklanır:
[AYAS_AUTONOMY_STARTUP_2026-10-10.md](AYAS_AUTONOMY_STARTUP_2026-10-10.md).
Eski **AYAS Access Online** Scheduled Task bilinçli `Disabled` durumundadır;
Windows ACL'si görev değişikliğine izin vermediği için kullanıcı Startup
klasöründeki **AYAS Access Online.lnk** kanonik mekanizmadır.
Bu nedenle disabled eski görevi tek başına arıza nedeni sayma.

1. Mevcut prebuilt qualification doğrulandı: build source
   **1921e200647058ed91260bc0703f249e16557f7c**, CLEAN build
   **eYLul_gOlarfCz4yzavNy**, **518 build /25976 dependency** dosyası PASS.
   Pinli mevcut Next16.2.10/lock16.3.8 farkı önceki runbook'taki haliyle korunur;
   bağımlılık kurulumu/yükseltme yapılmadı.
2. İlk legacy görev etkinleştirme girişimi Windows AccessDenied verdi; hiçbir
   görev ayarı değişmedi. Mevcut gizli başlatıcı ile origin geri geldi.
3. Bu oturumun geçici legacy supervisor'ı kimlik/PID/parent ile doğrulanarak
   tek başına durduruldu; web sunucusu kesilmeden kanonik
   `scripts/ayas-access-hidden.vbs` ile değiştirildi. Son düzen
   `wscript.exe //B //NoLogo` → gizli, normal kullanıcı PowerShell →
   `ayas-access-daemon.ps1 -Continuous -IntervalSeconds 60` zinciridir.
   Kanonik başlatıcı ExecutionPolicy override kullanmaz.
4. `register-ayas-autostart.ps1 -Apply` gerçek mevcut kısayolu ve qualification'ı
   doğrulayıp **Already registered; no duplicate or overwrite** verdi.
   Yeni görev/ikinci startup kaydı, UAC/policy/firewall/Defender değişikliği yoktur.
5. Son gözlemde origin **15352**, kanonik supervisor **9460**, wrapper **29156**;
   mevcut tunnel **29440** aynı. Origin/public health `healthy`,
   `ownerActionRecommended=false`; tek supervisor ve tek origin vardır.
   PID'ler gözlem kimlikleridir, ilerideki komutlarda körlemesine kullanılmaz.

Bu onarım uygulama kodunu, homepage'i, env'i, passcode'u, projeleri, authority'yi,
fiyat/bütçeyi veya frozen testleri değiştirmedi. Runtime yalnız mevcut daemon'un
durum/audit/PID kayıtlarını doğal yoluyla güncelledi. Rebuild, yeni video, ücretli
çağrı, yayın veya PC reboot yapılmadı. Fiziksel sonraki reboot/logon kabulü
bu oturumda NOT_RUN; mevcut Startup kısayolu ve çalışan launcher doğrulandı.

## Doğrulama

| Kontrol | Sonuç |
| --- | --- |
| Yerel/public `/`, `/brain`, `/studio` | 307 login redirect, enforced gate |
| Yerel/public `/login` | 200 |
| Yerel/public `/api/runtime/health`, oturumsuz | 401, kapı korunur |
| Yerel/public cross-origin protected pipeline POST | 403; pipeline başlatılmaz |
| Gerçek HTTP toplamı | **12/12 PASS** |
| `node scripts/smoke-ayas-prebuilt-runtime.mjs` | **20 PASS**, özel temp fixture |
| `powershell -NoProfile -File scripts/smoke-ayas-access-daemon.ps1` | **50 PASS**, ayrı port/temp fixture, mevcut origin korunur |
| `npx.cmd tsc --noEmit --incremental false` | **PASS** |
| `npx.cmd eslint .` | **0 hata /13 mevcut uyarı** |
| Mevcut kullanıcı Startup kaydı / prebuilt verify | **PASS**, değişiklik/duplicate yok |
| Gerçek telefon sayfa açılışı | **OWNER_REPORTED_PASS** |

İlk HTTP fixture yanlış şekilde açık `/api/auth/login` endpoint'inden 403
bekledi; endpoint boş parolayı kendi sözleşmesine uygun 401 ile reddetti.
CSRF testi middleware'in koruduğu `/api/pipeline` üzerinde düzeltilip 403
olarak doğrulandı. Uygulama kodu veya güvenlik kuralı değiştirilmedi.
Oturumlu bütün backend/üretim işlerinin yeniden sınandığı, estetik kalite
kabulü veya tüm cihazın hatasız sertifikalandığı iddia edilmez.

## Kütüphane ve sonraki işler

Dünya Medeniyetleri Karakter Kütüphanesi V1 kaynak sprinti
**87adc997c064156d3d1d70756c9cabd3ffce529f** ile tamamlanmış ve push edilmiştir.
`libraries/world-characters/` altında dört izole placeholder pack, altı standart
klasör/pack, 16 metadata kaydı, `_core` şemaları/stil/rig/mixing policy ve
namespace/hash/path/readiness doğrulayıcıları vardır. Önceki **45/45 smoke**, TS,
lint0hata/13mevcutuyarı, existing-library ve storage11 PASS kaydı korunur;
bu erişim oturumunda tekrar çalıştırılmış bütün-kütüphane sertifikası sayılmaz.

[CHARACTER_LIBRARY_WORLD_PLAN.md](CHARACTER_LIBRARY_WORLD_PLAN.md) tam ağaç,
örnek JSON, ID standardı, kullanım ve entegrasyon planını taşır.
İstenen altyapı ve telefon erişim onarımı kapsamında açık implementasyon işi yoktur.
Gerçek ChatGPT sheet/cutout kabulü, image decode/alpha/rig, scene-year eşlemesi,
runtime approval binding ve production adapter sonraki ayrı sprintlerdir.
Önceki ses/montaj projesinin thumbnail/SEO/YouTube/export aşamaları bu erişim
emrinin kapsamında yürütülmedi; otomatik yayın yapılmaz.

Bu kapanış commit'i yalnız checkpoint/roadmap/changelog/bu raporu içerir.
Exact son HEAD, push ve çalışma ağacı sonucu commit sonrası Git raporundadır.
