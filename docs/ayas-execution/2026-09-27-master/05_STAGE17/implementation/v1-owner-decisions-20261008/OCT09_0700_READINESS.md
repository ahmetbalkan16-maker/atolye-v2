# 9 Ekim 2026 / 07.00 Türkiye — gerçek cihaz ve bakım hazırlığı

**Saat bir deploy/restart/bakım izni değildir. Otomasyon kurulmadı.** 12 Ekim Atölye video hazırlığı önceliği korunur; render/ücretli medya/upload yapılmadı. AYAS V1/Foundation BLOCKED, Atölye CAN_START (güvenli hazırlık).

8 Ekim 18.52 Türkiye salt okunur tanığı: live stamp `e974614` CLEAN, build `KmsdsLSOPkVSbJONHR1Zf`, installed Next16.2.10; source lock16.3.8. Yerel/public login200, gerçek `/api/runtime/health`401, studio307. Tek port3000 listener PID32416; Access Online ve Autonomy Observer Running. Authenticated runtime identity veya gerçek reboot kanıtı üretilmedi. Bkz. [TEMP_VALIDATION.json](TEMP_VALIDATION.json) / [HTTP tanığı](LIVE_UNAUTHENTICATED_PROBES.raw.json).

## 07.00 owner cihaz kontrolü — deploy gerektirmeyen mevcut canlı kontrol

Owner bilgisayarı ve telefonu açar, mevcut `https://ayas.atolyeayas.com/` PWA'yı açar. Login'i kendi yapar; password/cookie paylaşmaz. Her satır **NOT_RUN**; owner gerçek sonucu bildirene kadar PASS olmaz:

| Kontrol | Owner adımı | Kaydedilecek veri |
|---|---|---|
| PWA/auth | PWA'yı kapat/aç; homepage, `/brain`, `/studio` erişimi | Cihaz/tarayıcı, saat, doğru ekran ve login sonucu |
| Runtime identity | Mevcut authenticated durum ekranında source/build/lock kimliğini kontrol et | Yalnız non-secret kimlik; kaynak yoksa UNQUALIFIED |
| Mikrofon/STT | İzin ver, kısa Türkçe cümle söyle | Capture ve doğru metin; izin reddi varsa gerçek hata |
| Wake | Sessizlikten AYAS ile dinlemeyi başlat, farklı ilk cümle dene | Kaçırma/yanlış wake/listening durumu |
| Yerel model | Basit soru, önceki mesajı izleyen soru, açık düzeltme | Yerel model cevabı/fallback/echo hatası |
| Türkçe ses | Cevabı dinle; interrupt, mute ve replay dene | Audible Türkçe, telaffuz, kesme ve state uyumu |
| Bağlantı | Telefonda kontrollü kopar/geri bağla, PWA'yı yeniden aç | Kayıp/duplicate turn, recovery veya gerçek hata |
| Reboot continuity | Yalnız owner ayrı bakım/reboot kararını verirse gerçek yeniden başlatma | Sonrası tek listener/tunnel, iki görev/heartbeat ve telefon erişimi |

Mevcut canlı üzerindeki başarılı telefon kontrolü, henüz uygulanmamış K3 veya Next16.3.8 adayını kabul etmiş sayılmaz. Gelişim Merkezi'nde **APPROVE verilmez**.

## Bakımı başlatmadan önce somut koşullar

1. K3 bulguları giderilmiş ve yeni patch digest'i bağımsız inceleme + owner kararına bağlanmış; Exact12 koşulları ve publication sınırı korunmuş.
2. Gerçek final technical HEAD clean; manifest/source hash/pins doğrulanmış; credential-free TEMP **fresh-lock16.3.8** build/TS/lint; final HEAD'de tek Full166 + manifest dışı K3 negatif kontroller. `c17132b` junction baseline'ı bu şartı karşılamaz.
3. Final deploy hedef SHA/paket digest'i ve rollback sınırı owner incelemesinde. Yeni push ve bakım başlangıcı ayrıca onaylı. Aktif baseline veya source writer yok.
4. Mevcut canonical backup mekanizması üzerinden `.next`, dependency/lock/source kimlikleri için repo dışı geri dönüş noktası + hash/disk/restore uygunluğu. Yeni backup yazımı bu oturumda yapılmadı; restore doğrudan denenmedi.
5. F98 writer-quiesced interval isteniyorsa **bütün** korunan kök writer'ları kapsanır: Next, Observer/children, Access auto-recovery ve production. Yalnız Observer'u durdurup Next'i açık bırakmak quiescence kanıtı değildir. Mevcut Access mekanizmasıyla koordinasyon ve owner bakım izni gerekir; ikinci supervisor açılmaz.

Kapsam/missing revenue store/domain TEST-LIVE collector açıkları quiescence ile otomatik kapanmaz. Eski F98 sonucu QUALIFIED_PASS_WITH_LIMITATIONS, combined INCOMPLETE; 30 TEST/LIVE slotu NOT_RUN/collectorExecuted0 korunur. Eşit endpoint hash'leri writer-attribution yerine kullanılmaz.

Uygulama/abort/rollback adımları önceki [LIVE_MAINTENANCE_AND_PHONE_CHECKLIST.md](../v1-final-closure-20261008/LIVE_MAINTENANCE_AND_PHONE_CHECKLIST.md) içinde korunur. 07.00'de prerequisites tamamlanmamışsa mevcut canlı telefon kontrolü yapılabilir; bakım başlamaz. Fiziksel cihaz sonucu olmadan reboot/voice/media gate kapatılmaz.
