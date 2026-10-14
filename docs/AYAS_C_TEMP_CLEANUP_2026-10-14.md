# AYAS / Atölye C geçici dosya ve eski kopya temizliği — 2026-10-14

Canonical çalışma kökü `D:\ÜRETİM\Atolye\atolye-v2`; üretim paketi `D:\ÜRETİM`.
Owner, gereken AYAS/Atölye dosyalarının D'ye taşınmasını, gereksiz test kopyalarının kaldırılmasını ve özellikle `C:\ayas-iso-val` incelemesini istedi. Windows ve kurulu programlar korunur. Uyanma görevi owner'ın telefondaki kabulüyle kapalıdır.

## Çalışan süreçlerin geçici dosyaları

Ollama'nın kurulu GUI/server binary'leri yerinde kaldı. Eski GUI'nin devraldığı C TEMP/TMP yerine mevcut kullanıcı Startup ve Start Menu kısayolları `scripts/ollama-production-hidden.vbs` başlatıcısını kullanır. Başlatıcı üretim klasöründen D `private/temp` yolunu türetir; yalnız kendi process ve çocukları için TEMP/TMP/OLLAMA_TMPDIR belirler. Varsayılan gizli başlatma mevcut aynı executable'ı yeniden açmaz; kullanıcı menüsü `--show` ile normal GUI'yi açar. Yeni ikinci autostart kaydı yok. Eski kısayollar ve kullanıcı OLLAMA_TMPDIR değeri D özel yedeğinde korunur. Kullanıcı OLLAMA_TMPDIR yalnız Ollama için D'ye bağlandı; Windows kullanıcı/makine TEMP/TMP ayarları değiştirilmedi.

Access, Next, tunnel, Observer ve Ollama için gerçek process çalışma dizini ve TEMP/TMP salt okunur olarak doğrulandı. Observer'ın D özel VBS wrapper'ı da ortamını çocuk başlamadan ayarlar. Whisper yolu Unicode uyumluluğu için aynı fiziksel D klasörüne giden `D:\URETIM` bağlantısını kullanır. Üretim başlatma Ollama, Access ve Observer'ı mevcut resmi qualification ve singleton kontrollerinden sonra çağırır. Yeni PC'de yalnız klasör kopyası qualification yerine geçmez.

Yeni geliştirme/test komutları D repo ve D temp/npm cache ile çalıştırılır. Frozen Observer fixture için yalnız test TEMP'i ASCII D alias'a alınabilir; test veya güvenlik kapısı değiştirilmez. Ayrıntı AGENTS.md ve `docs/AYAS_D_PRODUCTION_MIGRATION_2026-10-14.md`.

## İlk iki Temp temizliği — tamamlandı

- İlk geçiş: 149111 kök, 620381 normal dosya ve 4282 reparse bağlantısı kaldırıldı. Belirsiz eski kaynak/geçmiş için 232595 dosya / 16478035287 byte D cold archive'a kaynak ve hedef SHA-256 doğrulamasıyla alındı. Kaynakta kanıtlanan, artık kullanılmayan fixture dosyaları ayrı sınıflandı.
- Ek geçiş: 196 kök, 76598 normal dosya, 884 bağlantı kaldırıldı. 76596 dosya / 2699311806 byte ayrıca D'de hash doğrulandı. `atolye-*`, `atölye-*`, karakter kareleri ve üretim testleri kapsamdaydı.
- İki geçiş toplamı: 696979 normal dosya kaldırıldı; gerekli/belirsiz 309191 dosya / 19177347093 byte saklandı. Mantıksal byte toplamı fiziksel boşalan alan anlamına gelmez; hardlink dedup nedeniyle farklıdır.
- Kaynakta aktif AYAS/Atölye süreci C Temp kullanmıyordu. Kullanılmayan üretim geçmişindeki C stringleri immutable kayıtları bozacak toplu rewrite ile değiştirilmedi.

D arşivler: `archives/retired-c-temp-20261014` ve `archives/retired-c-temp-extra-20261014`. Makbuzlar `handover/C_TEMP_CLEANUP_2026-10-14` altında. Bunlar yeniden çalıştırılacak/publish edilecek runtime değildir.

## Tam C taraması ve derin kopyalar — tamamlandı

C metadata taraması 340003 dizin ve 1187905 normal dosya gördü; dosya/dizin adları ve package.json proje kimlikleriyle sahiplik adayları çıkarıldı. Reparse hedefleri izlenmedi. 182 erişilemeyen/protected sistem yolu envanterde tutuldu; ACL veya Windows korumaları gevşetilmedi. Benzer ad taşıyan Autodesk dosyası, kurulu programlar, browser IndexedDB ve Windows Startup metadata'sı otomatik proje dosyası sayılmadı.

Temp altındaki generic isimli eski repo kopyaları da package kimliğiyle yakalandı. Taze varlık kontrolünde 4029 eski aday zaten yoktu; bunlar bu temizlik tarafından silinmiş gibi raporlanmaz. 49 mevcut açık hedefteki 262032 mantıksal dosya / 34443612632 byte kaynak ve hedef SHA-256 ile D `archives/retired-c-projects-20261014` arşivinde doğrulandı. Son değişmemiş-source pin kontrolü ardından 48 kök ve 262031 normal dosya girişi kaldırıldı. Diğer bir hedef Windows MSIX görünümünün aynı device/inode sahibi alias’ıydı; gerçek kaynak kaldırılınca o görünüm de yok oldu. Arşivde iki görünüm korunur, fiziksel kaynak silme sayısı iki kez yazılmaz. 110 reparse girişinin hedefi takip edilmeden kaldırıldı. İlk sürücü-root guard reddi parent separator korunarak exact C:/ayas-iso-val sınırında düzeltildi; önceki partial makbuz korunur, resolved makbuz tüm49 hedefin kalmadığını gösterir.

`C:\ayas-iso-val` aktif üretim değildi: eski izole validation kopyası, 58367 dosya / 6046331215 byte. Tamamı ayrı cold archive’da kaynak/hedef SHA ile korunup C kökü kaldırıldı; current D repo/runtime’a karıştırılmadı. Diğer hedefler eski AYAS-WIP tasarımları, UI inceleme görselleri, AYAS'a ait Claude receipt/proje geçmişi ve eski Codex test/üretim artefaktlarıdır. Aktif Codex host çalışma dizini kaldırılacak hedefler arasında değildir.

Son kapsam makbuzları: `D:\ÜRETİM\handover\C_FULL_SCAN_2026-10-14`. Son C taraması 225922 dizin / 531185 dosya; Atölye/AYAS package marker0, owned Temp eşleşmesi0, Metod kullanıcı alanında erişim hatası0. 185 protected OS dizini tarama sınırı olarak korunur. Kalan7 isim eşleşmesi: 2 açık host dizini, 2 D başlatıcısına giden Windows Startup kısayolu, 2 aktif browser IndexedDB görünümü ve ilgisiz Autodesk ARRAYASSOCIATIVITY.dll. Hiçbiri C üretim payload’ı değildir. Son 3 trailing-dot fixture dosyası/18 byte ve 5 boş Atölye temp dizini ayrıca doğrulanıp kaldırıldı; dinlemeyen portu/çalışan worker’ı olmayan eski Wrangler dev registry216byte hash ile D’ye alınıp kaldırıldı.

## Silme ve doğrulama sınırı

Silme yalnız açık manifest içindeki normal dosya/dizinlere ve bu köklerin kendi reparse girişlerine uygulanır. Kaynak inode/device/hash ve sabit içerik kontrol edilir; gerekli dosyalar kaynak ve hedef hashleri eşleşmeden silinmez. Reparse hedefleri takip edilmez veya arşivde otomatik canlandırılmaz. Boundary sentinel testi ayrı hedefteki dosyanın korunduğunu doğrular. Manifest, archive receipt ve değişmemiş kaynak kontrolü eşleşmeden temizleyici çalışmaz.

C'deki kurulu Windows/Node/Ollama/cloudflared/Python gibi programlar ve Windows metadata'sı yerinde kalır. C `.ollama`/`.cloudflared` dizinleri D'deki fiziksel verilere giden bağlantıdır. Açık Codex host klasöründe yalnız küçük README/AGENTS/gitdir ve scripts bağlantısı vardır. Bu OS/app referansları fiziksel C üretim payload'ı değildir; literal C'de hiçbir isim kalmadığı iddia edilmez. Reboot ve yeni-PC kabulü bu oturumda denenmedi.

## Telefonda sağlık ve kapanış

Owner telefonda kısmen bozuk / Graphify eski gördü. Gerçek Collector yalnız GRAPH_STALE_VS_HEAD ve OBSERVER_PAUSED_DIRTY_REPO verdi. WIP source kaydı f74f61820988cd0c91865e71a6a7db865bbd7ed8 push edildi; native Graphify emit→grounded stage→ingest (20316 grounded nodes, API0), gerçek MCP ve 6 authenticated local/public HTTP200 ardından HEALTHY/findings[]/OBSERVING ve structural+semanticCURRENT doğrulandı. Makbuz handover/C_FULL_SCAN_2026-10-14/graphify-phone-recovery-wip.json. Bu son temizlik belgesi commit edilince indeks yeniden son exact HEAD için yenilenir; sonuç C_FINAL_RECEIPT.json içinde tutulur.


TypeScript, üretim launcher syntax/idempotence ve resmi mevcut-host layout kontrolü geçti. Son temiz Git commit/push ardından native Graphify assistant emit → source-grounded stage → ingest, structural complement, gerçek MCP ve authenticated health/Observer kabulü son HEAD'e bağlanır. Bu son makbuz Git dışında `handover` altında tutulur; ondan sonra kaynak belge commit'i atılırsa yeniden doğrulama gerekir.
