# Lemon Squeezy TEST ingress — durable aday (yalnız TEMP)

**Durum: UNBOUND. Gerçek route, webhook, hesap bağlantısı, ödeme veya ücretli API yok. Aday kaynağa uygulanmadı.** Yeni gelir altyapısı kurulmadı: aday mevcut `verifyAyasLemonWebhook` doğrulayıcısını ve repodaki `AyasExecutiveAlertStore` exclusive-create idiomunu (`wx` pending → fsync → `linkSync`) yeniden kullanır. Ledger, registry, ağ veya authority import etmez (L20).

## Neyi ilerletti

Önceki K4 kanıtı (12/12) bellek içi `Map` modeliydi; `actualDurability: NOT_QUALIFIED`. Bu aday aynı sözleşmeyi **gerçek dosya sistemiyle** sınar. Kaynak: [AyasLemonTestIngressCandidate.ts.txt](AyasLemonTestIngressCandidate.ts.txt) (`2f143fe7…`), test: [smoke-ayas-lemon-test-ingress-candidate.ts.txt](smoke-ayas-lemon-test-ingress-candidate.ts.txt) (`cb3be290…`), yarış worker'ı (`f7c6d94f…`). Sonuç: **20/20 PASS**, [LEMON_CANDIDATE_TEMP.raw.log](LEMON_CANDIDATE_TEMP.raw.log).

| İstenen güvenlik özelliği | Kanıt |
|---|---|
| İmza doğrulaması / yanlış imza reddi | L01; L05 bozuk imza, L06 imzadan sonra değişen raw body, L07 imzalı bozuk JSON → 400, hiçbir dosya yazılmaz |
| Duplicate event reddi | L02 aynı handle, L03 restart sonrası → 200 ama ikinci commit yok |
| Idempotency (süreçler arası) | L04: 4 ayrı süreç aynı anda aynı yeni bildirimi teslim eder → **tam 1 commit**, 3 duplicate, artık pending yok |
| Yetkisiz işlem engeli | Receipt yalnız pointer'dır (L19: ham gövde, müşteri verisi, secret, tutar, authority yok); L20 ledger/ağ/registry erişimi yok |
| TEST / production ayrımı | L17 kurulumda LIVE ve geçersiz store reddi; L08 imzalı LIVE bildirimi 400; L09 yabancı store 400; L18 istemci başlığı modu seçemez |
| Secret güvenliği | Secret yalnız çağrı anında resolver'dan okunur, tutulmaz/yazılmaz; L12 secret erişilemez/bozuk → 503, asla 200; L19 receipt'lerde secret yok |
| Ledger bütünlüğü | Ingress ledger'a hiç yazmaz (L20); bozulmuş committed receipt fail-closed 503 ve üzerine yazılmaz (L16) |
| Kalıcılık / çökme | L13 depolama hatası → 503, sağlayıcının retry'ı sonra commit eder; L14 commit öncesi çökme → retry commit; L15 commit sonrası temizlik öncesi çökme → retry duplicate |

Ayırt edicilik: 4 mutant, 4 KILLED ([LEMON_CANDIDATE_MUTATIONS.raw.json](LEMON_CANDIDATE_MUTATIONS.raw.json)): `linkSync`→`renameSync` (L04 yarışı), receipt bütünlük kontrolü kaldırma (L16), depolama hatasında 200 (L13), duplicate'ı yeniden commit (L02). Byte restore SHA ile doğrulandı.

## Sınırlar — kabul değildir

- Gerçek HTTP route yok; access gate'te yalnız tam route/method için HMAC istisnası gerekir, bu auth değişikliği ayrı owner incelemesi ister.
- `fsync` dosya düzeyindedir; Windows'ta dizin fsync'i yok (repodaki diğer store'larla aynı seviye). Güç kesintisi testi yapılmadı.
- Lemon imzalı zaman damgası veya benzersiz teslim kimliği vermez; freshness iddia edilmez. Aynı gövde = aynı olay.
- Receipt gelir kanıtı değildir; canonical TEST GET doğrulaması ve N05/N_LIVE değerlendirmesi ayrı adımlardır.

## Owner'ın sağlaması gerekenler (değer burada istenmez)

1. **Karar:** route + durable receipt + dar auth istisnası paketini V1 kapsamında onaylamak, ya da Lemon'u owner-reviewed deferral olarak kaydetmek (register değişikliği; agent kendiliğinden yapmaz).
2. **Hesap bilgisi (yalnız kendi secret store'unda):** TEST mode store kimliği (sayısal store id) ve TEST webhook signing secret. Production/LIVE secret kullanılmaz; değerler Git'e, rapora veya sohbete yazılmaz.
3. **Lemon panelinde (paket onayından ve deploy'dan sonra):** TEST webhook kaydı, gerçekten hazır olan callback URL'si ile; sonra panelden bir TEST event gönderimi.
4. **Gözlem:** imza → committed receipt → 200, duplicate'ta ikinci iş yok, retry ve canonical TEST okuma tanıkları exact kaynak digest'ine bağlanır.
