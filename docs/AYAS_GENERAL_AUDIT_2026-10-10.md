# AYAS genel çalışma denetimi — 10 Ekim 2026

Owner, bütün AYAS işlemlerinin ve komutlarının bağlantılarıyla incelenmesini, hataların çalışan başka bir parçayı bozmadan giderilmesini ve Atölye'ye geçerken güvenli öz-gelişim döngüsünün bırakılmasını istedi. Fiziksel Windows yeniden başlatma ve telefon mikrofon/ses kabulü 12 Ekim Pazartesi olarak kaldı.

## Giriş ve kapsam

Giriş kaynak HEAD'i `03d467484310de21ee7696b3904c0b7d3de0f24d`; dal origin ile eşit ve temizdi. Canlı build `bTVBH-peoZ8mHuMi7K2pX`, stamp `1c48a20` CLEAN; mevcut qualification 502 build / 25976 dependency dosyasıyla PASS. Owner'ın önceki önerisi 19:03:26Z–19:05:45Z arasında gerçekten COMPLETED olmuş ve `03d4674` normal push edilmişti. Bu, gerçek yayın kanıtıdır; yayınla aynı anda sohbet kabulü değildir.

Tarama; komut yönlendirmesi, sohbet ve SSE, hafıza, ses sözleşmeleri, araç/onay sınırları, observer/discovery, micro-batch, owner publication worker, UI, Git/Graphify, Windows başlangıcı, yerel ve tünel erişimi bağlantılarını kapsadı. Boş veya gelecekte kullanılacak bir yeteneği çalışıyor gibi gösterme veya gate açma yapılmadı. Donmuş testlerin/pinlerin ham geçmişi korunur.

## Beş doğrulanmış hata ve düzeltme

1. `AYAS gelişim durumunu raporla. Son gerçek tarama ve bekleyen onaylar neler?` sıradan reasoning'e gidiyordu. Canlıda model, UI'da bir bekleyen öneri varken onay olmadığını ve kanıtsız bir tarama zamanını söyledi. `AyasComplexityRouter` içindeki dar AYAS gelişim/geliştirme merkezi eşleşmesi artık mevcut salt okunur `ayas-development-status` aracına gider. Video/çocuk gelişimi/normal sohbet ve Git niyetleri aynı kalır.
2. Araç doğru seçilse bile ikinci model çağrısı kanonik rapora tarama tarihi ekleyebiliyordu. `AyasChatStream`, yalnız bu aracın gerçekten çalışmış sonucunu mevcut Türkçe kanonik özetiyle döndürür. SSE, kayıt ve actionTrace akışı sürer. UI bunu mevcut deterministik rapor olarak gösterir. Diğer araçlar ve sohbet finalizer'ı korunur.
3. Micro-batch'te yeni öğe eklenmeyen tick erken dönüyor, tek öğeli birikim 24 saat dolsa da incelemeye geçmiyordu. Mevcut readiness politikası artık boş/capacity dolu tick dönüşlerinde de değerlendirilir. Fresh Graphify, temiz repo, ALLOW/THROTTLE, aynı kaynak ve sandbox HEAD şartları sürer; sadece READY_FOR_REVIEW yapılır, onay/rezerve/yayın yetkisi verilmez.

4. Son public kabulde `Graphify durumunu göster. Sadece incele, değişiklik yapma.` gerçek araca gitmeyip genel model cevabı verdi. Yeni dar state niyeti, mevcut `query-graphify` aracının sabit `operation: state` işlemine gider. Agentic seçim availability/mutation/çoklu-hedef sınırlarını korur; sembol açıklama ve güncelleme ayrı kalır. Yerel native veriden Türkçe kanonik durum döner; model FULL veya kaynak HEAD uyduramaz. Yeni `smoke-ayas-graphify-state-chat.ts` 20/20 ve bu son kaynak üzerinde 21 bağlantılı suite PASS; üçüncü zorunlu CI adımıdır. Eski b1d6fcc routing negatif kontrolü gerçekten null ile FAIL verdi.

5. Yeni Graphify raporundaki “salt okunur” ifadesi, sonraki normal hesap yanıtını mevcut `replyMissesReadOnlyConstraint` kontrolünde engelliyordu. 215a544’te gerçek public Graphify→37+48 sırası ve sahte model85 negatif kontrolü aynı read-only fallback’i verdi. Kısıt hatırlatma kontrolü artık sadece gerçek user mesajlarına bakar; yazma ihlali kontrolünün tüm geçmişi, execution-claim, owner talimatları ve action firewall aynı kalır. Yeni suite23/23: araç sonrası85 tek model çağrısı, açık owner kısıtı ve execution-claim engeli.21bağlantılısuite/TS/lint/build ve gerçek aday sıralı kabul PASS. Bu yeni raporun mevcut denetimle etkileşimi final teslimden önce yakalanıp giderildi. İlk fixture’in yanlış assistant/brain tipinden gelen typecheck/build FAIL kaydı korunur; UI’nin gerçek brain rolüyle düzeltilip tüm kontroller yeniden geçti.

Yeni iki ilk regresyon dosyası: `smoke-ayas-named-development-routing.ts` (25 senaryo: 12 doğru niyet, 12 konu ayrımı, gerçek stream'de yalan model taslağının dışlanması), `smoke-ayas-micro-batch-age-readiness.ts` (7 senaryo: gerçek sandbox typecheck/smoke ile öğe; süre, dirty/stale/makine kapıları, 24 saat ve tekrar). İki suite mevcut AYAS Safe CI'ya zorunlu adım olarak eklendi; frozen EVAL manifest değiştirilmedi. Önceki kaynakta üç ayrı negatif kontrol gerçekten FAIL verdi; ham loglar saklanır.

## Doğrulama kayıtları

Kanonik girişin v60 Full166 baseline'ı **PASS: 166/166**, failed=[]; sourceHEAD `03d467484310de21ee7696b3904c0b7d3de0f24d`. Bu kanıt giriş kaynağına bağlıdır; üç düzeltme sonrası kaynak için ayrı ilgili regresyon/derleme/kabul kanıtı kullanılır. Bu bir foundation veya dış servis sertifikası değildir.

İlk ayrı aday taraması 41 suite: 39 PASS / 2 FAIL. Owner UI hatası aday fixture'ında Git tarihi eksikliğiydi; gerçek yerel tarih tamamlanınca 36/36 PASS. Research-improvement-loop'un ayrı fixture koşusu BENCHMARK_NOT_HERMETIC ile durdu; bu FAIL silinmedi, hermetic koruma gevşetilmedi. Kanonik girişin gerçek baseline klonunda aynı suite PASS idi. Son kaynak bu suite için gerçek baseline klonuyla ayrıca değerlendirilir.

Üçüncü düzeltmeden sonra 18 bağlantılı suite yeniden PASS: named routing 25, development status 27, chat stream 31, client trace 11, chat quality 36, natural conversation 42, reasoning 48, candidate guard 34, context 21, unified trace 17, firewall closure 12, cognitive quality 55, memory temporal 52, reply truth 11, brain core UI 43, homepage 11, owner UI 36 ve voice 79. İlk 41 koşusundaki worker 15, worker mutants 13, voice mutants 12, mobile 36, phone 42, wake V3 71, observer/daemon ve micro-batch approval/execution kontrolleri de PASS.

Windows Access native smoke 50/50, prebuilt smoke 20/20 PASS. Yedi kritik PowerShell dosyası doğrudan parser ile 0 hata. TypeScript 0 hata; ESLint 0 hata / 13 devralınmış uyarı. İzole production build PASS, BUILD_ID `-WgX0I-wago_q5Ngo3q9M`, sourceStable true, sourceDigest `be5910d49f81b16ad5266a1f7b2c0002cb73314a721394cd2a26ae6eb82caa22`. Mevcut kurulu Next 16.2.10 / lock 16.3.8 farkı korunup raporlandı; kurulum/upgrade yapılmadı.

İzole gerçek Gemma3:12b production UI kabulünde gelişim komutu, boş fixture kayıtları için doğru kanonik raporu verdi; tarama tarihi uydurmadı. Sonraki sıradan hesap sorusu 37 + 48 = 85, normal model yolu. Test sunucusu sadece loopback3918, sahte fixture erişim anahtarı, ayrı runtime data ve otonom execution kapalıyla çalıştı; kimliği doğrulanıp kapatıldı.

Gerçek remote’suz baseline klonunda `research-improvement-loop` son üç-düzeltme kaynağı **b1d6fcc** için PASS (229061 ms), failed=[]. İlk aday fixture FAIL’i korunur; son ek Graphify niyeti için 21 bağlantılı suite/TS/lint/build ve ayrı gerçek üretim kabulü kullanıldı; Full166 tekrarlandığı veya bütün kanıtların son HEAD sertifikası olduğu iddia edilmez.

## Canlı kayıtlar ve korunmuş sınırlar

Başlangıç public/local erişim kapıları, authenticated UI'nin dokuz alt paneli, mevcut görev/bellek/proje/rapor kaynakları okundu. Observer HEALTHY/OBSERVING, lastError null, gerçek doğal discovery SUCCEEDED; araştırma kaynağı okuması hatasız. Ayrı eski autonomous-loop başlatılmadı; mevcut Observer ikinci döngüyle çakıştırılmadı. Global writeExecutionGate CLOSED kalır. Mevcut owner approval ve tek yayın kuyruğu korunur.

9 eski RECOVERY_REQUIRED kayıt, owner'ın önceki bekletme kararıyla silinmedi ve yeniden çalıştırılmadı. Atölye'de 17 proje görülür, geçmişten 1 okunamayan proje ayrıca görünür; mevcut veri üzerinde bu denetimde onarım/re-render yapılmadı. Bazı gelecek Learning/experience veya dış servis yetenekleri bağlı değildir; bunlar genel sistem çalışması veya güvenlik sertifikası sayılmaz. Mevcut homepage owner görseli/policy ve ses UI'si değiştirilmedi.

İlk kontrollü geçiş **20:08:12Z**: build PWgInBTNf40hHD9Sovd_6 / b1d6fcc CLEAN; qualification/check 494build/25976dep PASS. Startup kısayolu üzerinden supervisor12244 ve origin14660; tünel27628/Ollama5236/Observer14680+18184/18844/18916 korunur. Local/public auth ve authenticated UI PASS. Gerçek gelişim raporu 0 bekleyen,9recovery,1biriken öğeyi doğru gösterdi; normal model37+48=85.2108JSON değişen/eklenen/silinen0. Observer20:09:05Z OBSERVING/lastErrornull. b1d6fcc CI38081999587 SUCCESS. Ek Graphify geçişi20:22:31Z:215a544/ZLRX8jxam2DN0-x6uAgn0 CLEAN,494build/25976dep PASS; origin30048/supervisor13984. Public komut gerçek215a544source=analiz,PARTIAL/PENDING/10eksik/CLEAN bildirdi. KaynakCI38083280824 SUCCESS. Son normal-sohbet devamında read-only kısıt bağlam hatası yakalandı; son iki satırlık rol düzeltmesi canlı geçiş ve kapanış kabulü BEKLİYOR. Önceki artifact/manifest ayrıca korunur.

## Güvenli devir

AYAS, mevcut observer ve kaynak/makine sınırları içinde araştırma yapar, küçük adayları sandbox'ta doğrular, biriktirir ve öneri sunar. Canlı kaynak yayını owner onayı ister. Genel öz-gelişim isteği homepage veya yetki/storage değişikliklerine otomatik izin vermez. Hata/dirty/stale/aşırı yük koşullarında duraklama korumaları geçerlidir; kapıların kapalı olması hata değildir.

Başlangıç mevcut kullanıcı Windows oturumu açılınca Startup kısayolundan gizli supervisor'ı başlatır; fiziksel reboot/logon kabulü ve gerçek telefon ses testi henüz NOT_RUN, Pazartesi yapılır. Bilgisayar değiştirilince cihaz bazlı qualification/bağımlılık/erişim yolları yeniden kurulup doğrulanır. Bu denetim yeni cihaz veya tüm PC güvenliği garantisi değildir.

## Yerel kanıtlar

Makbuzların özel klasörü: `C:\Users\Metod\.codex\visualizations\2026\10\10\01a12594-c923-77b2-a250-4991764b40b0`.

- `AYAS_GENERAL_BASELINE_ENTRY.json`, `AYAS_GENERAL_REGRESSIONS.json`, `AYAS_GENERAL_REGRESSIONS_RECHECK.json`
- `AYAS_NAMED_ROUTING_BEFORE.log`, `AYAS_STATUS_TRUTH_BEFORE.log`, `AYAS_AGE_READINESS_BEFORE.log`
- `AYAS_GENERAL_ACCESS_SMOKE.log`, `AYAS_GENERAL_PREBUILT_SMOKE.log`, `AYAS_GENERAL_POWERSHELL_DIRECT.json`
- `AYAS_GENERAL_BUILD.json`, `AYAS_GENERAL_CANDIDATE_ACCEPTANCE.json`, `AYAS_GENERAL_STAGE.json`, `AYAS_GENERAL_RUNTIME_SWITCH.json`
- `AYAS_GENERAL_LIVE_ENTRY.json`, `AYAS_GENERAL_PANELS_ENTRY.json`, `AYAS_GENERAL_PROTECTED_BEFORE.json`, final closure makbuzları

İlk mikro-batch negatif kontrolündeki genel TEMP cleanup, Observer sandbox'ıyla çakışma riski nedeniyle otomatik onay incelemesince reddedildi; komut çalışmadı. Özel TEMP kökü, gerçek yol sınırı assertion'ı ve cleanup'sız testle güvenli alternatif tamamlandı. Başka canlı süreç/veri silinmedi.
