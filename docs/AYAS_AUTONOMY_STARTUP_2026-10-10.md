# AYAS canlı gelişim ve güvenli başlangıç — 10 Ekim 2026

Owner bu oturumda canlı Gelişim Merkezi denemesini ve otomatik başlangıç düzeltmesini açıkça istedi. Tam yedek/WinPE çalışması açılmadı. Bilgisayar yeniden başlatılmadı; son fiziksel yeniden açılış kabulü owner'ın normal restart'ından sonra yapılacak.

## Canlı gelişim sonucu

Owner, Codex tarayıcısındaki localhost AYAS'a kendisi giriş yaptı; anahtar okunmadı/kopyalanmadı. Gözlemcinin gerçek keşfiyle `33e015d` üzerinde oluşturduğu tek dosyalı öneri incelendi: `scripts/smoke-ayas-publication-activity.ts` içindeki 15 assert çağrısına kaynak ifadesini açıklayan hata mesajı eklemek. Gösterilen tam patch kontrol edildi; asıl assert argümanları, test zamanı ve mantığı değişmedi.

Gerçek **ONAYLA VE UYGULA** akışı 13:19:43Z onaylandı, 13:22:28Z **COMPLETED / testler PASS** tamamlandı. Yalnız bu test dosyası commit edildi ve origin'e gönderildi: `26bf49768370cc63ac472ea1a27d761afb2f0701`. Graphify aynı HEAD'e yenilendi; gerçek salt okunur sağlık CLI'si **HEALTHY / ownerActionRecommended=false / findings=[]** verdi. Sayfa yenilendikten sonra sonuç kalıcı geçmişte yine görüldü. Sonraki bağımsız önerinin keşfedilmesi de gözlendi; onaylanmadı.

Geçmişten kalan 9 RECOVERY_REQUIRED kayıt korunur. Bu deneme onları çözüldü saymaz veya tekrar yürütmez. Genel yürütme kapısı CLOSED kaldı; dar onaylı geliştirme akışı çalışması, üretim/GPU/gelir için yeni yetki vermez. Kod değişirken PAUSED_DIRTY_REPO/GRAPH_STALE güvenlik beklemesi normaldir; koruma kaldırılmadı. Kapanış commit ve Graphify sonrasında doğal gözlem döngüsü tekrar doğrulanır.

## Başlangıç düzeltmesi

- Mevcut `ayas-access-daemon.ps1` korunarak yalnız Start-Origin değiştirildi: **npm run build kaldırıldı**, doğrulanmış mevcut Next CLI doğrudan Node ile başlatılır. Sağlıklı servis tekrar başlatılmaz; belirsiz port/süreç kimliği reddedilir. Singleton, erişim kapısı, telefon durum dosyaları ve üç denemelik bekleme sınırı korunur. Yönetici token'ıyla Access çalıştırma reddedilir.
- `ayas-prebuilt-runtime.mjs` açık qualification / salt okunur verification yapar. 1086 build dosyası ve 25976 dependency dosyasının içerikleri, Node, build stamp/BUILD_ID, lock, tünel executable/config hashleri eşleştirilir. Cache/trace/diagnostics dışarıdadır. Sadece aynı hashlenmiş node_modules ağacına giden `.next/node_modules` iç junction'ı kabul edilir; dış bağlantı reddedilir. Gizli değerler rapora/Git'e yazılmaz.
- Yerel manifest `%LOCALAPPDATA%\AtolyeAyasAccess\prebuilt-runtime-v1.json` Git dışıdır. Mevcut, çalışan Next **16.2.10**, lock **16.3.8** farkı açıkça kaydedildi; yükseltme/kurulum yapılmadı. Bu pin mevcut çalışan çifti korur; sürüm farkını çözülmüş saymaz. Uygulama kaynağı build stamp'inden farklılaşırsa otomatik rebuild yerine başlangıç reddedilir. Yeni app sürümü için kontrollü build/kabul ve yeni qualification gerekir.
- `register-ayas-autostart.ps1` varsayılan dry-run, `-Apply` açık uygulamadır; repo yolu script'ten türetilir. Mevcut görev kimliği/owner/limited yetki kontrol edilir. Task Scheduler Windows AccessDenied verdiği için **kapalı eski görev korundu**, kullanıcının Startup klasöründe tek `AYAS Access Online.lnk` oluşturuldu. Normal kullanıcı yetkisi ve mevcut RemoteSigned politikası kullanılır; ExecutionPolicy Bypass/global policy/Defender/firewall/UAC değişikliği yok. Tekrar uygulama mevcut aynı kaydı doğrulayıp ikinci kayıt oluşturmaz.
- `unregister-ayas-autostart.ps1` de dry-run varsayılanıdır. Açık `-Apply` yalnız kendi doğrulanmış kısayolunu kaldırır ve açıksa kendi görevini disable eder; tanım/log/manifest ve çalışan süreçler korunur. Gerçek kaldırma yapılmadı.
- Eski PS denetleyici **14672**, PID+creation UTC+parent+command kimliğiyle doğrulanarak tek başına durduruldu; process tree/task stop yapılmadı. Yeni normal kullanıcı denetleyici **6780** çalışıyor. Mevcut Next **26068**, tünel **27628**, Ollama **5236**, observer **14680/18184/18844/18916** aynı kaldı; korunan süreç kaybı **0**. Yeni denetleyici hata logu 0 byte; yerel/public giriş kapıları sağlıklı. F115'in eski otomatik build davranışı mevcut denetleyici ve yeni logon kaydından kaldırıldı; eski disabled görev yeniden etkinleştirilmez.
- **Sonraki owner talimatı (aynı gün): penceresiz başlangıç.** Windows 11'de varsayılan terminal Windows Terminal olduğundan powershell hedefli kısayol görünür bir "AYAS Access Online" Terminal penceresi açıyordu; `-WindowStyle Hidden` onu gizlemez. Kısayol artık `wscript.exe //B //NoLogo` ile `scripts/ayas-access-hidden.vbs` çalıştırır; VBS daemon'u `WshShell.Run(..., 0, True)` ile penceresiz başlatır. `-Apply` eski kendi kısayolunu aynı dosyada yerinde yükseltir; görünür supervisor 16452 yalnız gözetmen olarak 11948 ile değiştirildi, Next 13656 / tünel 27628 kesintisiz. Ayrıntı: `ATOLYE_CHECKPOINT.md` aynı tarihli kayıt.
- Otonom gözlemci mevcut enabled logon kaydıyla, Ollama mevcut Startup kaydıyla korunur. Bunların kurulu programları/ayarları değiştirilmedi. Oturumlu Atölye proje listesi yüklendi (16 okunabilir proje); başlangıç öncesinde kontrol merkezinin zaten bildirdiği 1 okunamayan proje bu işte değiştirilmedi.

## Doğrulama

| Kontrol | Sonuç |
|---|---|
| Gerçek owner onayı → mutation/test → commit/push → Graphify/health → kalıcı sonuç | COMPLETED |
| Prebuilt artifact/dependency/source/link/tunnel guard | 20 senaryo PASS |
| PowerShell 5.1 erişim regresyonları / yeni başlangıç | 48 senaryo PASS |
| Native Windows cold-start sınırı | ayrı portta sahte Next/HTTP, tek süreç, mevcut AYAS korunur |
| Brain UI / homepage / microbatch / portable | 43 / 11 / 27 / 24 PASS; izole fixture |
| Toplam bu oturum bağımsız senaryo | 173 PASS; canlı öneri validator'ı ayrıca PASS |
| TypeScript | noEmit / incremental=false, exit0 |
| Repo ESLint | 0 hata, devralınmış 13 uyarı |
| Gerçek PC reboot/logon/telefon/mikrofon | bu oturumda NOT_RUN |

Native cold-start fixture gerçek AYAS restart'ı değildir. Hash manifesti ve testler tam veri yedeği veya işletim sistemi güvenliği için sıfır risk garantisi değildir. Uygulama/ana sayfa, veri, authority, model, kurulu bağımlılık ve tünel kimliği değiştirilmedi. Yalnız test açıklamaları ve başlangıç kaynak/yerel kayıtları değişti.

## Son owner kontrolü ve yeni PC

Owner normal Windows **Yeniden Başlat** işlemini yaptıktan ve kendi Windows oturumuna girdikten sonra kontrol edilir: tek Next listener, tek tünel, Ollama/model listesi, observer kalp atışı, yerel ve telefon erişimi, oturumlu AYAS/Atölye ve kalıcı COMPLETED sonucu. Açılışta hash doğrulaması diskin hızına göre kısa bir bekleme oluşturabilir. Aktif iş/kayıt tamamlanmadan restart yapılmaz; agent restart göndermedi.

Yeni PC'ye eski `.next`, node_modules, Startup kısayolu veya yerel qualification manifesti çalıştırılabilir kurulum olarak taşınmaz. Hedefte lock'tan kurulum, kontrollü build, gerçek cihaz kabulü ve **hedefe özel yeni qualification** yapılır. Ardından yeni script'teki `-Apply` ile hedef logon kaydı oluşturulur. Manifest repo/Node/tünel yollarına ve içeriklerine bağlıdır; başka cihazda körlemesine kullanılamaz. Tam devir: `AYAS_NEW_PC_HANDOVER_2026-10-10.md`.
