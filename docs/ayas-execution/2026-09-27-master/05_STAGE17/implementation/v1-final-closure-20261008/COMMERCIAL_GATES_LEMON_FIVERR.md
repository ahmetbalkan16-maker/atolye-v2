# Lemon Squeezy ve Fiverr — mevcut bağlantılar ve TEST gereksinimi

**Hiçbir ücretli veya gerçek ticari işlem başlatılmadı; hiçbir kapı ertelenmedi.** İnceleme kaynak, owner action register'ı (`../STAGE17_OWNER_ACTION_REGISTER_59e83cd.json`) ve yapılandırma adları üzerinden salt okunur yapıldı; gizli değer okunmadı veya yazılmadı.

## Lemon Squeezy — gerçek durum: UNBOUND, yalnız owner eylemiyle kapanamaz

| Bileşen | Kaynakta ne var |
|---|---|
| REST adapter | `AyasLemonSqueezyAdapter.ts`: yalnız GET facade (stores/products/orders/subscriptions/…). TEST ve LIVE modları var; `liveDefault: CLOSED`; yazma işlemleri owner onayı ister; `financialOperationsAutonomous: false` |
| Webhook doğrulama | `AyasLemonWebhook.ts`: ham gövde üzerinde HMAC-SHA256, olay türü eşleme. Başlığında açıkça: **"no HTTP route, store, queue or ledger write"** |
| Ingress | `app/api` altında Lemon/webhook route'u **yok**. Durable dedupe/journal store'u **yok**. `AyasRevenueCenterClosure.ts` bunu açıkça ertelenmiş nitelik olarak listeler: `LEMON_TEST_KEY_CONNECTION_DURABLE_INGRESS` (stage 16.8) |
| Yapılandırma | `.env.local` içinde LEMON/REVENUE adlı değişken yok (yalnız adlar kontrol edildi) |
| Owner beyanı | 5 Ekim: TEST-mode store/credential oluşturuldu (OWNER_REPORTED_SETUP; makine kanıtı değil) |

Register gereksinimi: TEST-mode store ve credential owner'ın secret store'unda; connector/ingress "Stage16.8 kapılarından" bağlanır; sonrasında TEST-mode ingress receipt + durable dedupe/journal doğrulaması. Register Lemon için **erteleme seçeneği tanımlamıyor**.

**Sonuç:** Lemon TEST binding bugün yalnız owner eylemiyle tamamlanamaz. Önce ingress route'u + durable dedupe/journal store'u (yeni geliştirme, owner onaylı ayrı paket) gerekir. Ardından owner secret'ı kendi store'una koyar ve Lemon panelinden TEST webhook gönderir. Owner'ın seçenekleri:
1. Ingress paketini V1 zorunluluğu olarak onaylamak (yeni geliştirme; video üretimini beklemez).
2. Register'ı açıkça değiştirip Lemon'u **owner-reviewed deferral** olarak kaydetmek: kapsam, gerekçe, yeniden değerlendirme koşulu, N05/N_LIVE'ın açık kaldığı yazılır. Bu bir sözleşme değişikliğidir; agent kendiliğinden yapmaz.

## Fiverr — gerçek durum: ACCOUNT_GIG_OWNER_REPORTED_ONLY

| Bileşen | Kaynakta ne var |
|---|---|
| Adapter | `AyasFiverrManualAdapter.ts`: `MANUAL_HANDOFF`, `credentialHandling: NONE`; yalnız yerel taslak (ilan, mesaj, teslimat). API bağlantısı tasarım gereği yok |
| Owner fact import | `AyasFiverrOwnerFacts.ts` / `AyasFiverrOwnerHandoff.ts`: owner'ın verdiği gerçekleri içe alan saf modüller |
| Gelir deposu | Combined audit'te `revenue` deposu **ABSENT**. Kaydedilmiş sipariş/gelir yok, uydurulmadı |
| Owner beyanı | 5 Ekim: hesap/kimlik doğrulandı, Gig aktif (OWNER_REPORTED_ACTIVE; sipariş/gelir kanıtı değil) |

Register gereksinimi: owner hesabından **resmi** Fiverr sipariş/teslimat/gelir/ledger dışa aktarımı **veya** owner'ın kaydettiği açık, incelenmiş erteleme kararı. Register Fiverr için ertelemeye **izin veriyor**.

**Owner'ın seçenekleri:**
1. Sipariş varsa Fiverr'in resmi dışa aktarımını vermek. Kişisel veri ve tutar maskelenmiş özet Git'e, ham dosya Git dışına.
2. Sipariş yoksa açık incelenmiş erteleme: "Fiverr N05 kanıtı yok; kapsam/gerekçe/yeniden değerlendirme koşulu", N05/N_LIVE açık kalır.

## Video üretimiyle ilişkisi

İki platform da MP4 üretim hattının teknik bağımlılığı değildir. Atölye CAN_START bunlara bağlı değil. Ticari bir erteleme auth, authority, no-replay, korunan kapsam veya writer attribution açıklarını kapatmaz.

## Düzeltme

`OWNER_GATES.md` §4'teki "mevcut 16.8 durable ingress/dedupe/journal kanıtı" ifadesi kaynağı abartıyordu: ingress ertelenmiş bir nitelik, mevcut değil. İlgili satır bu dosyaya göre düzeltildi.
