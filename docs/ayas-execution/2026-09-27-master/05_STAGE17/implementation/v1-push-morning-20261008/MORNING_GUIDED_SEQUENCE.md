# 9 Ekim Cuma 07.00 - kesin rehberlik sırası

**Mevcut canlı: e974614 / Next.js 16.2.10. Onaylı push hedefi: 32e59c1.** İlk yedi adım canlı sürümde hiçbir deploy/restart/yükseltme/reboot yapmadan owner ile yürütülür. Gelişim Merkezi APPROVE/YÜRÜT kapalı tutulur. Her adım sonunda owner'ın gerçek gözlemi alınır; cevap yoksa sonuç NOT_RUN kalır. Cookie, passcode, env veya kişisel ses kaydı paylaşılmaz.

| Sıra | Owner'a verilecek işlem | Kaydedilecek gözlem |
|---|---|---|
| 1. PC erişimi | PC tarayıcısında https://ayas.atolyeayas.com/ aç. Sayfanın veya login ekranının geldiğini bildir. Erişim yoksa yerel/public ayrımını salt okunur kontrol ederiz; restart yapılmaz. | Saat, PC erişimi PASS/FAIL; error/status varsa secretsiz kısa ifade |
| 2. Kimlik doğrulama ve PC sohbeti | Owner kendi girişini yapar; korumalı `/brain` sayfasının açıldığını doğrular. Ayrı girişsiz pencerede korumalı erişim reddedilmeli. Önce mevcut provider/modelin yerel olduğu doğrulanır; sonra kısa Türkçe metin sohbeti denenir. Ücretli fallback başlatılmaz. | Genel owner erişimi, anonymous gate, metin sohbeti ve yerel model ayrı sonuçlar; model kanıtı yoksa yerel model NOT_RUN |
| 3. Telefon PWA | Telefonda kurulu AYAS'ı kapat/aç; doğru ana sayfa, giriş ve sohbet erişimini kontrol et. Takılırsa önce aynı URL'yi telefon tarayıcısında aç; PWA ve tarayıcı sonucunu ayır. Site verisini topluca silme veya hemen yeniden kurma. | Telefon/OS/browser, installed PWA ve browser erişimi, görülen başlangıç URL'si |
| 4. Mikrofon | Mevcut mikrofon kontrolünü aç, izin ver. “Fatih videosunu pazartesi düzelteceğiz” cümlesini söyle. | İzin/capture/transcript ayrı PASS/FAIL; izin yoksa sonraki ses adımlarını PASS sayma |
| 5. Dinleme ve konuşma | Mevcut wake/dinleme davranışıyla sessizlikten konuşmaya geç; dinleme göstergesini ve doğru metni kontrol et. Cümle bitince yanıtın başlayıp başlamadığını bildir. | Wake/dinleme/STT/yanıt başlangıcı ayrı gözlemler; fiziksel ses duyulmadan TTS PASS yok |
| 6. Türkçe sesli yanıt | “Bana Türkçe tek kısa cümleyle yanıt ver” de. Duyduğun Türkçe yanıtı ve anlaşılırlığını bildir. Yanıtı kesip yeni cümle söyle; PC ve telefonu ayrı kaydet. | Türkçe duyulabilir TTS, interrupt ve yeni konuşma; sessiz UI animasyonu başarı kanıtı değil |
| 7. Süreklilik | Telefonu 60 saniye kilitle/aç; Wi-Fi'yi kısa süre kapat/geri aç. Sohbetin ve mevcut mikrofon kontrolünün tekrar çalışmasını kontrol et. | Reconnect, sohbet sürekliliği, auth/izin kaybı ve yeniden dinleme; sonuçlar mevcut live SHA'ya bağlı |

Bu sıra bir run receipt oluşturur: actual live SHA/dependency, cihaz, zaman, her satırın owner bildirimi ve PASS/FAIL/NOT_RUN. Yeni sürüm kolonları ayrı tutulur; eski sürüm başarısı yeni sürüme aktarılmaz. Owner bir hata bildirirse onu önce mevcut sürüm sorunu olarak kaydederiz; bakım izni çıkarmayız.

## Bakım öncesi karar noktası - henüz izin yok

Owner'a mevcut yedi adımın sonucu, remote/local exact HEAD, test bağları, açık güvenlik/kanıt sınırları ve backup/rollback preflight sunulur. Deploy/restart/Next.js 16.3.8 geçişi için **ayrı açık hedef-SHA onayı** istenir. 07.00 yalnız owner'ın hazır olduğu saattir. Reboot ayrıca onaylanır; deploy onayı reboot yetkisi değildir.

Yalnız bu ayrı karardan sonra mevcut Access/Autonomy mekanizmalarıyla writer quiescence ve doğrulanmış geri dönüş noktası hazırlanabilir. Writer'lar, Observer çocukları, Next ve Access auto-recovery birlikte değerlendirilir; süreç adı/sayısı durma kanıtı değildir. Yedek materialize/hash doğrulanmadan yeni sürüm kurulmaz.

Onaylı rollout sonrası önce build/source/lock/installed Next kimlikleri, tek listener/tunnel ve görevler ölçülür; ardından 1-7 yeni sürümde baştan yapılır. Gerçek reboot yalnız ayrıca onaylanır; reboot sonrası aynı kimlik ve cihaz kontrolleri tekrarlanır. Authority/journal otomatik onarılmaz, Recovery9 replay edilmez.

AYAS V1/Foundation BLOCKED; F98 writer/domain/gelir kanıtı, Recovery9 aktörleri, Lemon actual ingress/binding, Fiverr resmi kanıtı ve owner cihaz sonuçları açıktır. 12 Ekim Fatih düzeltme hedefi korunur; bu hazırlık render, ücretli servis veya YouTube yüklemesi başlatmaz.
