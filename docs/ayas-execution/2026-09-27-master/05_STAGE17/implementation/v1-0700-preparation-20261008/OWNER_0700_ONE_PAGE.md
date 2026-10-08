# 9 Ekim Cuma 07.00 — AYAS bakım ve cihaz kontrol listesi

**07.00 çalışma izni değildir.** İlk altı adım mevcut canlı **e974614 / Next.js 16.2.10** içindir. Deploy, restart, Next yükseltmesi ve reboot ayrı, kesin owner onayı ister. Gelişim Merkezi'nde APPROVE/YÜRÜT başlatılmaz. Cookie, passcode, ses kaydı veya secret rapora eklenmez.

Owner: ______  Başlangıç: ______  Telefon/OS: ______  PC: ______

Her hücreye **PASS / FAIL / NOT_RUN**, saat ve kısa gözlem yazılır. Boş veya kısmi test PASS sayılmaz. Yeni sürüm sütunu ancak onaylı deployment sonrası doldurulur; mevcut sürüm başarısı yeni sürüme aktarılmaz.

| Sıra / uygulanacak kontrol | Mevcut canlı sonucu | Yeni sürüm sonucu |
|---|---|---|
| 1. PC ve telefonda https://ayas.atolyeayas.com/ aç; owner girişini ve korumalı `/brain` erişimini doğrula. Girişsiz ayrı tarayıcıda korumalı erişim reddedilmeli. Kimliği doğrulayamıyorsan dur. | NOT_RUN | NOT_RUN |
| 2. PC'de “Bugün hangi işleri sırayla yapacağız?” metin sohbetini dene. Gerçek provider/model durumunu kaydet; yerel modelden cevap geldiğini durum/kayıtla doğrula. Yerel model kanıtı yoksa yalnız sohbet PASS, model NOT_RUN/FAIL. Ücretli fallback başlatma. | NOT_RUN | NOT_RUN |
| 3. Telefonda kurulu PWA'yı kapat/aç; doğru ana sayfa, giriş, menü ve sohbeti kontrol et. Eski görünüm varsa önce normal yeniden açma; site verisini topluca silme. | NOT_RUN | NOT_RUN |
| 4. Mikrofon izni ver; kısa Türkçe cümleyi söyle. Dinleme göstergesi ve doğru metne dönüşmeyi, mevcut wake davranışını ayrı kaydet. | NOT_RUN | NOT_RUN |
| 5. Türkçe sesli yanıt iste; sesi fiziksel olarak duy, anlaşılır olduğunu ve yanıtı kesip yeni cümle başlatabildiğini doğrula. PC/telefon sonuçlarını ayır. | NOT_RUN | NOT_RUN |
| 6. Telefonu 60 saniye kilitle/aç; Wi-Fi'yi kısa süre kes/geri getir. Yeniden bağlanma, sohbet sürekliliği ve mikrofonu yeniden başlatmayı dene. Kopma/giriş/izin hatasını aynen kaydet. | NOT_RUN | NOT_RUN |
| 7. **Yalnız deployment/bakım onayından sonra:** hedef SHA, bağımlılık ve exact kapsamı yaz; writer'ları kontrollü durdur; mevcut build/source/lock, görev/tunnel yapılandırması ve authority kayıtlarının güvenli yerel yedeğini doğrula. Geri dönüş yolu hazır olmadan deploy yok. | NOT_RUN | NOT_RUN |
| 8. **Ayrı reboot onayından sonra:** reboot yap; tek origin/tunnel, mevcut görevler, gerçek build/model/giriş kimliğini doğrula; 1–6'yı yeniden çalıştır. Otomatik approval/resume/replay/commit/push olmamalı. | NOT_RUN | NOT_RUN |

**Deployment karar alanı:** hedef SHA ______; backup yolu/hash ______; owner'ın açık deploy/restart/Next onayı ______; ayrı reboot onayı ______. Yazılmamış onay mevcut değildir.

**Dur/rollback:** yedek doğrulanmıyorsa veya writer quiescence kanıtlanamıyorsa deployment başlamaz. Auth/güvenlik ihlali, duplicate listener veya deployment kaynaklı erişim/sohbet kaybında ilerleme durur; onaylı eski build + eşleşen bağımlılık ve görev/tunnel ayarı geri alınır. Authority/journal kayıtları körlemesine geri sarılmaz; Recovery9 replay edilmez. Eski sürümde 1–6 tekrar doğrulanır.

**Açık kayıt:** iki eski auto-resume smoke raw FAIL; arşiv CommonJS lint düzeltildi, 13 mevcut uyarı; Graphify PARTIAL9/semantic PENDING. Full166 **166/166 PASS yalnız dbf9542**; yeni HEAD için tekrar çalıştırıldığı iddia edilmez. F98/Recovery9/Lemon/Fiverr eksikleri ve gerçek cihaz kanıtı açık; AYAS V1/Foundation BLOCKED. 12 Ekim Fatih üretim hedefi korunur; bu oturum render/ücretli servis/YouTube yüklemesi başlatmaz.
