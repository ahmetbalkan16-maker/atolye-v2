# Lemon Squeezy TEST ingress — izinli tasarım ve izole kontrat kontrolü

**TASARIM HAZIR / 12 KONTRAT SENARYOSU PASS / GERÇEK INGRESS YOK / DURABLE KABUL YOK / HESAP UNBOUND.** [K4_LEMON_INGRESS_CONTRACT.json](K4_LEMON_INGRESS_CONTRACT.json) ve [betik](K4_LEMON_INGRESS_CONTRACT.cjs) bellek içi modeldir; live HTTP veya production bağlantısı açmaz.

8 Ekim'de [resmî imza belgesi](https://docs.lemonsqueezy.com/help/webhooks/signing-requests), [webhook request belgesi](https://docs.lemonsqueezy.com/help/webhooks/webhook-requests) ve [TEST webhook API alanı](https://docs.lemonsqueezy.com/api/webhooks/create-webhook) kontrol edildi. İmza raw gövde HMAC-SHA256'dır. Başarılı capture HTTP 200 ister; diğer durumlarda sınırlı retry vardır. Bu yüzden kalıcı commit doğrulanmadan 200 gönderilmez. Kaynak `AyasLemonWebhook.ts` mevcut ham doğrulama, sabit store/mode binding ve pointer üretimini zaten sağlar; route/store/ACK sağlamaz.

## Uygulanmamış kaynak sözleşmesi

- Önerilen tek POST route mevcut `app/api` ağacında yer alır; route henüz oluşturulmadı. Lemon makine çağrısı owner session cookie taşımayacağından mevcut access gate'e yalnız tam route/method için ayrı, owner-incelenmiş HMAC ingress istisnası gerekir. `/api` veya auth genel olarak açılmaz. Bu auth değişikliği hazırlık onayından kaynak uygulaması onayı çıkarmaz.
- Server tarafında sabit TEST storeRef ve TEST-only secret reference. Client store/mode/identity seçemez. Secret kendi owner secret store'unda kalır, Git'e ve receipt'e girmez. LIVE/gerçek ödeme reddedilir.
- Boyut limiti 262.144 byte; parse etmeden raw signature doğrulaması; bozuk/duplicate header, bilinmeyen event, yanlış store/mode, invalid JSON reddedilir. Mevcut helper'ın imza formatı ve redaction sınırları korunur.
- İdempotency anahtarı mevcut event/body/store/mode digest'idir. Yeni unique delivery id veya imzalı zaman alanı uydurulmaz; sağlayıcının garantilemediği freshness iddiası kurulmaz.
- Durable committed receipt minimal pointer/hash/mode/state taşır; raw gövde, müşteri e-postası, lisans, key ve gelir tutarı receipt'e alınmaz. Mevcut atomik fsync/journal ve tek-writer lock idiomları yeniden kullanılır. Aynı digest'in paralel gelişi ikinci iş doğurmaz. Tam kalıcı kayıt sonrası 200; duplicate yalnız daha önce committed receipt doğrulanınca 200; kayıt/lock hatası 503.
- Sonraki işlem mevcut registry/read policy üzerinden canonical TEST GET ve parent/store/mode eşleşmesini ister. Pointer veya sentetik kontrat kaydı gelir kanıtı değildir. Ledger append, hesap bağlantısı veya mali işlem yetkisi yoktur.

İzole 12 senaryo: valid TEST receipt-before-ACK, tekrar ve paralel tekrar, bozuk signature/raw/JSON, LIVE ve foreign store reddi, duplicate-case header, oversized body, storage failure→503→retry, receipt gizlilik sınırı. Map'in atomik insert'i durable storage için **modeldir**; crash/fsync/restart/gerçek HTTP E2E test edilmiş sayılmaz.

## Gerçek TEST kabulü için gereken owner işlemi

1. Route + durable receipt + exact auth istisnası paketi ayrıca owner incelemesi/onayı ve bağımsız güvenlik testi ister.
2. Owner TEST store ve secret'ı kendi private secret store'una bağlar; burada değer istenmez. Production secret kullanmaz.
3. Ayrı izinli TEST connection sonrası owner Lemon panelinden TEST event gönderir. Callback URL yalnız bu adım için gerçekten hazırsa kullanılır; bugün varmış gibi yazılmaz.
4. İmza→committed receipt→200, duplicate/no-second-job, crash/retry ve canonical TEST read tanıkları exact source digest'e bağlanır. N05/N_LIVE durumu ancak bu kanıtla değerlendirilir; otomatik erteleme veya kapanış yoktur.

Fiverr resmî export/ledger hazırlığı [K5_FIVERR_EVIDENCE_PLAN.md](K5_FIVERR_EVIDENCE_PLAN.md) içinde korunur. Sipariş varlığı owner yanıtı bekliyor. Atölye'nin MP4 hazırlığı her iki ticari gate'ten bağımsızdır.
