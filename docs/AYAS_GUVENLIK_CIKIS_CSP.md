# Sunucu tarafı çıkış iptali + tam CSP (19 Kasım 2026)

Owner onayı 19 Kas 2026: "onay bekleyenleri onaylıyorum, tasarım gerekenlerinde yap; bir şeyi yaparken başka bir şeyi
bozma". 14 Kas güvenlik denetiminden açık kalan iki iş.

## 1. Çıkış iptali — seçilen tasarım: Node.js middleware + çıkan çerezin sunucu kaydı

Sorun: "Çıkış" yalnız tarayıcıya çerezi unutturuyordu. Çerezin bir kopyası (çalınan çerez, eşitlenen tarayıcı profili)
7 günlük ömrü boyunca geçerli kalıyordu; middleware edge runtime'da çalıştığı için logout route'unun yazdığı hiçbir
şeyi göremiyordu.

Değerlendirilen seçenekler:

- **İmzalı "şundan sonra geçerli" damgası / oturum nesli:** damga ancak middleware'in okuyabildiği bir yerde
  tutulabilir. Edge middleware dosya okuyamaz, bellek paylaşmaz; env değişkeni sunucu yeniden başlamadan değişmez.
  Ya sunucuya her istekte iç HTTP isteği (yavaş, yeni hata yolu) ya da anahtar döndürme (bütün cihazları düşürür)
  gerekirdi. Ayrıca "şundan önceki her şey geçersiz" tek bir çıkışta owner'ın diğer cihazlarını da düşürür.
- **Middleware'i Node.js runtime'a almak (seçilen):** Next 16.4'te kararlı (`export const config.runtime = "nodejs"`;
  `proxy.ts` adına geçiş zorunlu değil — pinli `smoke-ayas-access-gate` `../middleware`'i içe aktarır). Middleware
  artık dosya okuyabilir; ek süreç, ek ağ yok. Dosya adı ve dışa aktarılan `middleware` aynı kaldı.

Kayıt biçimi: çıkan her çerez için bir dosya, `data/brain/phone-access/session-revocations/<id>.json` (klasör zaten
Git-ignore'lu; canlıda cwd canonical repo, diğer `data/brain` depoları gibi). `<id>` = erişim anahtarıyla
HMAC(`ayas-session-revocation\n` + çerezin imzalı gövdesi): her çerez için tek, kopyalar için aynı, çereze ya da anahtara
geri çevrilemez. İstek başına tek `stat`. Kayıt yalnız zamanları tutar ve çerezin kendi süresi dolunca silinir.

- Yalnız çıkış yapılan çerez biter; owner'ın diğer cihazları oturumda kalır.
- Eski (nonce'suz, 13 Kas öncesi) çerezler de aynı yolla iptal edilir; biçim değişmedi, **canlıya alınca hiçbir oturum
  düşmez, yeniden giriş gerekmez**.
- Fail-closed: kaydın okunması "dosya yok" dışında bir hatayla biterse çerez reddedilir (owner yeniden girer, yeni
  çerezin yeni kimliği vardır). Kayıt yazılamazsa logout yine çerezi temizler ve hatayı sunucu günlüğüne yazar.
- Kod: `src/lib/auth/sessionRevocation.ts`, `accessGate.sessionRevocationTarget`, `middleware.ts`,
  `app/api/auth/logout/route.ts`. Kanıt: `scripts/smoke-ayas-session-revocation.ts`.

Açık: "tüm cihazlardan çıkış" düğmesi yok (gerekirse aynı klasöre bir "şundan önce verilenler geçersiz" kaydı eklenir).

## 2. CSP — istek başına nonce, zorunlu (enforce)

`middleware.ts` her istekte 128 bitlik yeni bir nonce üretir; politika hem yanıtta hem Next'in render ettiği istek
başlığında durur, Next kendi script'lerine (framework, sayfa parçaları, satır içi RSC yükü) bu nonce'u basar. İstemcinin
gönderdiği CSP başlığı silinir (nonce'u o seçemez). `/api/*` yanıtlarına politika konmaz: Next, middleware'in koyduğu
başlığı route'unkinin önüne geçirir; SVG varlıklarının kendi "inert" politikası (`sandbox`) böylece korunur.

```
default-src 'self'; script-src 'self' 'nonce-…' 'wasm-unsafe-eval' https://cdn.jsdelivr.net/npm/onnxruntime-web@<sabit>/dist/;
style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:;
connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co <jsdelivr ort klasörü> [telefon gateway Worker'ı];
worker-src 'self' blob:; manifest-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self';
frame-ancestors 'self'
```

- Script'te `'unsafe-inline'` ve (üretimde) `'unsafe-eval'` yok. `next dev` yalnız `'unsafe-eval'` ve `ws:`/`wss:` ekler.
- `style-src 'unsafe-inline'`: 158 bileşen React `style={…}` kullanıyor; nonce stil özniteliklerini kapsamaz. Stil kod
  çalıştıramaz; kırmayan en sıkı hal budur.
- `'wasm-unsafe-eval'`: yalnız WebAssembly (uyanma motoru ve telefon modeli lab'ı onnxruntime-web).
- jsDelivr bütünüyle değil, Transformers.js'in yüklediği tek onnxruntime-web sürüm klasörü
  (`ONNXRUNTIME_WEB_FOR_TRANSFORMERS`); Transformers.js güncellenince smoke kırmızı yanar.
- Nonce yalnız render sırasında basılabildiği için kök layout `force-dynamic` (görsel değişiklik yok); `/offline`'ın
  `force-static`'i kaldırıldı (service worker HTML'i kendi CSP başlığıyla birlikte önbelleğe alır, tutarlı kalır).
- Acil anahtar: `.env.local`'a `AYAS_CSP=report-only` (yalnız konsola raporlar) ya da `AYAS_CSP=off` — kod değişmeden
  geri dönüş. Varsayılan: enforce.
- Kanıt: `scripts/smoke-ayas-content-security-policy.ts`; üretim derlemesi (`next build` + `next start`) üzerinde
  izole UI denetimi (`ayas-ui-audit`) ve CSP/çıkış probu.
