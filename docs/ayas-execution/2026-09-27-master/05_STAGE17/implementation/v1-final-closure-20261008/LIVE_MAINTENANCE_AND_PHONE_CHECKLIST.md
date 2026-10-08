> Current owner decision, 8 October: PC/phone availability 9 October Friday07.00 is preparation time, NOT maintenance authorization. Current technical source dbf9542, K3 source303f36b, fresh-lock Full166 166_166_PASS. Live e974614/Next16.2.10 unchanged. Use ../v1-k3-security-20261008/OCT09_0700_OWNER_MAINTENANCE.md and FINAL_OWNER_REPORT.md for current gates. Historical draft below is preserved; its 58ec1bd/time-not-selected statements no longer describe the current technical plan. Whole-writer quiescence and exact fresh build/rollback identity must be reviewed before any explicit deploy/restart/reboot approval.

# AYAS V1 — tek canlı bakım penceresi, uygulanmamış plan

**Durum: PREPARED / NOT AUTHORIZED / NOT EXECUTED.** Owner master order §4 canlı deploy, Next değişimi, servis restart ve runtime migration için ayrı açık onay ister. Bu plan şu an reboot veya maintenance otomasyonu kurmaz.

## Kaynak ve geçiş sınırı

- Mevcut canlı: `e97461495391a5d287b7505dc6b41e01a8b88acc`, CLEAN build stamp; installed Next16.2.10.
- Mevcut incelenen teknik kaynak: `58ec1bd`; manifestv58 ve lock Next16.3.8. Yalnız dokümantasyon descendant'ları aynı teknik kaynağı taşır.
- İzole Next16.3.8 build/route55/rollback-artifact kanıtı korunur; ISOLATED_REUSE_BINDING.json güncel kod/lock eşitliğini gösterir. Gerçek live downgrade/rollback kanıtı yok.
- Eğer owner evaluator succession onaylarsa final teknik HEAD değişecektir. Deploy hedef SHA, final manifest/lock ve bir final Full166 sonucuyla dondurulur; placeholder/latest HEAD deploy edilmez.
- Runtime/authority root, generation, owner/execution gates, mevcut Access/Autonomy wrapper/task, port/domain/tunnel, homepage/orb/voice/commands değiştirilmez. Runtime migration bu planın kapsamında **yoktur**.

## Pencereye giriş şartları

1. Frozen evaluator için owner kararı ve Recovery9 için güvenli no-replay disposition incelemesi; unresolved alanlar açık tutulur.
2. Teknik kaynak clean commit; manifest/pins ve ilgili negatif kontroller doğrulanmış; fresh-lock16.3.8 build/TS/lint/session/access ve exact final HEAD Full166 tamamlanmış. Güvenlik regresyonu varsa bakım başlamaz. Eski265f16f çıktısı yeni kaynak için kullanılamaz.
3. Final deployed-source adayı, paket digest'i ve rollback sınırı owner tarafından incelenmiş. Source publication/push ile live deployment onayları ayrıdır.
4. Owner bakım başlangıcını ve gerçek reboot zamanını seçer. Öneri: 9 Ekim, owner müsaitken tek pencere; saat henüz seçilmedi, takvim/automation oluşturulmadı.
5. Mevcut backup/restore gate'inden build + node_modules + lock/source identity için geri dönüş noktası, dışarıda yeterli disk kapasitesi ve byte/hash doğrulaması. Media/runtime/authority üzerinde deney veya yazım yok. Loglarda secret bulunmaz.

## Bir penceredeki uygulama sırası — ancak ayrı onaydan sonra

1. Listener, tunnel, task XML/config hash, build/source/installed package/lock kimlikleri kaydedilir. Aktif test veya başka source writer varsa başlamaz.
2. İncelenen lock/dependency ve build, mevcut canonical recovery/deploy mekanizmasıyla hazırlanır. Key veya production env değerleri kopyalanmaz/agent'a verilmez. Install-script/native package politikası ayrı doğrulanır; `npm audit fix --force` veya gevşetilmiş guard yok.
3. Mevcut singleton Access mekanizması yalnız bir origin için yeniden devreye alır; ikinci server/tunnel/daemon açılmaz. Bu görevin şu anki uygulanmış adımı değildir.
4. Local/public login/PWA/static asset ve protected401/307 kontrolü; owner'ın kendi authenticated oturumundan current source/build/lock identity. Kimlik kaydı credentials/cookies içermez.
5. Aşağıdaki gerçek telefon/medya checklist'i yapılır; sonuçlar actual deployed SHA ve timestamp'e bağlanır.
6. Owner gerçekten reboot eder. Sonrasında port3000 tek listener, tek tunnel, iki existing task, observer heartbeat ve tekrar cihaz erişimi kaydedilir.
7. Başarısızlıkta mevcut recovery gate'inden kaydedilmiş source/dependency/build'e dönülür; authority/history/status elle düzeltilmez. Rollback kimliği ve local/public gate tekrar ölçülür. Testi geçmiş gibi gösterme yok.

## Açık başlangıç ve bitiş koşulları (Claude, 8 Ekim)

**Başlangıç:** Pencere ancak şunların hepsi aynı anda doğruysa açılır:
1. Yukarıdaki beş giriş şartı karşılanmış.
2. Owner bu belgeye, hedef SHA'ya ve saate yazılı olarak "bakımı başlat" demiş.
3. Ölçülen ön durum kaydedilmiş: tek :3000 dinleyici, iki Running görev, canlı build stamp `e974614` CLEAN, Next 16.2.10.
4. Gelişim Merkezi'nde APPROVE dondurulmuş. `AYAS_AUTONOMOUS_EXECUTION_ENABLED=1` olduğu için bir APPROVE HEAD'i değiştirir ve push eder; final HEAD donduğu andan pencere kapanana kadar owner onay vermez.
5. Çalışan başka test/baseline/agent yok.

**Başarılı bitiş:** Pencere ancak şu koşullarda başarılı kapanır:
- Canlı build stamp hedef SHA'yı CLEAN gösterir; kurulu Next lock ile aynı (16.3.8).
- Yerel ve public login 200; korunan runtime 401 / studio 307; owner'ın kendi oturumunda authenticated kimlik doğru SHA/lock'u gösterir.
- Fiziksel telefon tablosundaki her satır owner tarafından sonuçlandırılmış.
- Gerçek reboot sonrası tek listener, tek tunnel, iki görev ve observer heartbeat kaydedilmiş.
- Kapanış receipt'i yazılmış.

**Geri dönüş ile bitiş:** Şunlardan herhangi biri olursa pencere geri dönüşle kapanır:
- Build veya start başarısız, ya da Access daemon owner'ın pencere başında yazdığı süre içinde ayağa kalkmıyor (önceki `e974614` geçişi ~70 s sürdü; garanti değil).
- Login veya korunan 401/307 kapısı yanlış davranıyor.
- Owner kimliği yanlış SHA'yı gösteriyor.
- Telefonda mikrofon/STT/TTS/PWA'da yeni bir regresyon var.
- Reboot sonrası servis veya görevler eksik.

Geri dönüşte kaydedilmiş `.next` + `node_modules` + lock noktasına dönülür; local/public kapılar yeniden ölçülür. Authority/runtime/history'ye dokunulmaz; sonuç başarısız olarak kaydedilir.

**İptal (başlamadan durma):** Herhangi bir giriş şartı pencere sırasında bozulursa (yeni commit, kirli worktree, ikinci listener, beklenmeyen süreç) adım uygulanmadan durulur.

Kesinti süresi yeni adayda ölçülmedi. Önceki e974614 geçişinde yaklaşık70 saniye görülmüş olması yeni pencere için garanti değildir. Owner fiziksel cihaz testi/reboot tamamlanmadan pencere başarılı kabul edilmez.

## Fiziksel telefon kontrol listesi

Her satır şimdi **NOT_RUN**. Owner gerçek cihazda sonuç, zaman ve deployed-source kimliğini bildirir; agent checkbox'ları kendisi PASS'a çeviremez.

| Kontrol | Yapılacak işlem | Kaydedilecek sonuç |
|---|---|---|
| PWA erişimi | Installed AYAS'ı kapat/aç; doğru homepage, login ve studio/brain erişimi | Gerçek installed launch, orientation/overflow ve auth davranışı |
| Mikrofon | İzin ver; kısa Türkçe cümle konuş | Gerçek capture/STT; permission/refusal/fallback |
| Wake/dinleme | Mevcut wake ile sessizlikten ve farklı ilk cümlelerden dinlemeye geç | Gerçek wake/listening; yanlış uyanma veya kaçırma |
| Gerçek konuşma | Geçmişe bağlı soru, basit yeni soru, açık düzeltme | Model yanıtı; önceki yanıta echo, yanlış status, anlaşılmayan Türkçe varsa açık kayıt |
| Türkçe ses | Mevcut assistant voice'u dinle; konuşmayı kes, mute/replay kontrol et | Audible TTS, pronunciation, barge-in, speaking-state doğruluğu |
| Bağlantı kaybı | Kontrollü bağlantı kopar/geri getir; pending turn/PWA yeniden aç | Süreklilik, duplicate request, kayıp/tekrar yanıt ve truthful error |
| Medya | Onaylanmış mevcut video adayını gerçek cihazda sonuna kadar izle/dinle | Görüntü/ses/süre/rights/rekonstrüksiyon kabulü; ffprobe bunu yerine geçmez |
| Reboot sonrası | Gerçek Windows reboot ardından login/PWA/wake/chat/media tekrar | Postboot gate/task/observer ve cihaz continuity |

## Kapanış receipt'i

Final receipt; maintenance owner kararı, exact source/lock/manifest/build hash'leri, eski/new rollback noktaları, değişmeyen authority/runtime ve task/tunnel sınırları, actual probes, owner device sonuçları, actual reboot ve gerekirse rollback outcome taşır. Writer attribution ve protected scope için mevcut canonical sözleşmeden ayrı tanıklar gereklidir; bu checklist onları kendiliğinden üretmez.
