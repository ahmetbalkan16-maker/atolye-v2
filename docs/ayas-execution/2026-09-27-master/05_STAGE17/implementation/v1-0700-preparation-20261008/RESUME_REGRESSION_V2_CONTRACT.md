# Owner-gated resume regression sözleşmesi — V2 önerisi

Durum: **PROPOSED; eski testlerin yerine sessizce geçirilmedi.** Runtime, grader, fixture, manifest ve Golden Vault değişmez. Yeni runner/pin geçişi bu oturumda uygulanmaz; gelecek özellik veya ek release şartı değildir. Mevcut K3 35 senaryosu ve bu paketteki dokuz publication kontrolü yeni owner politikasının dar kanıtıdır.

V1 iki FAIL'i güvenlik politikasına ters beklentidir: `smoke-ayas-autonomous-execution-gate.ts:348–362` senaryo20e bayrak açılınca ikinci owner click olmadan bir execution/commit bekler. `smoke-ayas-owner-approval-resume.ts:103–111` güncel kimliksiz tarihsel APPROVE için bir resume attempt ve STALE yazımı bekler. Gerçek worker ikisinde de manuel eylem ve EXECUTE yokluğunda state okumadan `[]` döner; raw actual0/expected1 korunur. V1'in bu ilk FAIL sonrasındaki senaryoları çalışmış veya PASS sayılmaz.

V2 aynı güvenlik hedeflerini güncel yetki önkoşullarıyla sınar:

| Durum | Beklenti |
|---|---|
| Bayrak açık, eski/unattributed APPROVE, manuel eylem yok | 0 attempts; karar/repo/journal aynı; commit/push yok |
| Geçerli tarihsel APPROVE, EXECUTE yok veya manuel eylem yok | 0 attempts; tarihsel rıza execution yetkisi değildir |
| APPROVE admission EXECUTE diye replay edilir | Reddet; mutation/commit/push yok |
| Bozuk mühür, expired/future/legacy nonce'suz oturum, subject/hash farkı | Reddet; yetki üretilmez veya rezerve edilmez |
| Güncel mühürlü exact EXECUTE, açık manuel owner eylemi, aynı owner'ın farklı doğrulanmış oturumu | Mevcut gate/firewall/validator zinciri çalışır; iki sessionRef ve iki actionRef ayrı kaydedilir |
| Bu geçerli manuel yetkiyle stale HEAD/dirty repo/scope farkı | Mevcut stale/dirty/scope koruması reddeder; kimlik yokken worker'a yazma yaptırılmaz |
| Kullanılmış EXECUTE/reservation veya COMPLETED proposal | İkinci mutation/commit/push yok |
| Recovery9 belirsiz/historical execution | Otomatik replay veya geriye dönük aktör ekleme yok |
| Exact-patch safety proof | Resume publication dışında kalır; mevcut local-governed execution sınırı korunur |

Sürümleme yapılırsa V1 dosyaları/hash'leri ve raw FAIL yerinde kalır; V2 ayrı isim/receipt ile raporlanır. Yeni sürümün stale/scope testleri için geçerli manuel admission sağlanmalıdır; yalnız beklentiyi `1` yerine `0` yapmak yeterli değildir. Manifest değişimi ve son baseline bağının değişmesi ayrı, açık kayıt gerektirir.
