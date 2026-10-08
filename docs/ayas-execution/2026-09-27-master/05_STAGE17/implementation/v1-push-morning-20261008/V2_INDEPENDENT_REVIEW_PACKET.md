# Resume V2 - bağımsız inceleme paketi

**READY_FOR_INDEPENDENT_REVIEW; review NOT_RUN, sözleşme PROPOSED.** Bu dosya çalıştırılmış yeni bir test veya kabul kararı değildir. İncelenecek sürüm `32e59c1`; mevcut uygulama `dbf9542` ile Git içerik eşitliğine sahiptir. Yeni kaynak, approval altyapısı, runner, manifest/pin veya Golden kaydı eklenmedi.

## İnceleme girdileri

- `../v1-0700-preparation-20261008/RESUME_REGRESSION_V2_CONTRACT.md`: sürümlü taslak; dosya hash'i bu paketin index'inde dış referans olarak bağlıdır.
- `../v1-0700-preparation-20261008/LEGACY_RESUME_FAIL_ANALYSIS.json`: actual0/expected1, iki orijinal exit1 ve kaynak satırları.
- `../v1-k3-security-20261008/K3_RELEVANT_REGRESSIONS.raw.json`: değişmeyen orijinal raw FAIL.
- `../v1-k3-security-20261008/K3_SECURITY_FINAL_MAP.json`: onaylı 14 dosyanın exact hash'leri; bağımsız K3 incelemesi kendi kapsamıyla geçerlidir.
- `../v1-0700-preparation-20261008/K3_35_RECHECK.raw.log` ve `PUBLICATION_CHAIN_9.raw.log`: mevcut 35 güvenlik senaryosu ve gerçek service/gate/firewall/store kullanan dokuz izole publication kontrolü.
- `SOURCE_EQUIVALENCE_AND_FULL166.json`: Git içerik ve fiziksel EOL sınırı; yeni HEAD için baseline NOT_RUN.

## V2 kabul için neden gerekli?

Eski gate smoke'un 20e senaryosu, runtime bayrağı açılınca ikinci owner eylemi olmadan otomatik execution/publication ister. Eski resume smoke'un ilk senaryosu, kimliksiz tarihsel APPROVE'ı yürütme girişimine dönüştürüp STALE yazımı ister. Owner'ın yeni politikası ikisini de yasaklar. Worker bu durumda state erişiminden önce `[]` döndürür. Bu nedenle mevcut FAIL'i PASS'a çevirmek güvenlik politikasını geri almak olur.

Öte yandan yalnız beklentiyi 1'den 0'a düşürmek, stale HEAD ve multi-proposal kontrollerini artık çalıştırmayan bir teste sahte güven verir. Eski resume suite'in ikinci senaryosu ilk assertion'dan sonra hiç çalışmaz; gate smoke'un 20f ve sonraki senaryoları da bu koşuda çalışmış sayılmaz. V2, bu eski güvenlik kapsamını **geçerli güncel manuel yetkiyle** yeniden sınamak için gereklidir. Gelecekteki bir AYAS özelliği veya yeni genel kapanış şartı değildir. V2 kabul edilmeden eski iki suite'in güncel politikaya göre tamamı PASS veya resume kapsamı bütünüyle taşındı denemez.

## Reviewer'ın karar vereceği kontrol matrisi

| ID | İncelenecek beklenen davranış | Mevcut tanık / açık alan |
|---|---|---|
| R01 | Flag açık, manuel eylem yok: state load dahi yapılmaz; attempt0, mutation/commit/push0 | K3 35 ve publication historical no-manual kontrolü; load-spy assertion V2 planında |
| R02 | EXECUTE mevcut ama açık manuel eylem yok; veya manuel işaret var ama current EXECUTE yok: no-op | K3 35; kombinasyonların ayrı etiketlenmesi gerekir |
| R03 | APPROVE admission EXECUTE diye kullanılamaz; malformed/invalid seal/expired/future/legacy nonce'suz oturum reddedilir | K3 35 + publication negatifleri; timestamp ve error kodları raw sonuçla bağlanmalı |
| R04 | Geçerli historical consent, güncel same-owner/farklı verified session, exact subject/hash | Ayrı sessionRef/actionRef, decision/auth/reservation/journal bağları mevcut 35 ve publication pozitifinde kanıtlı |
| R05 | Kullanılmış actionRef/reservation veya completed proposal ikinci execution üretmez | Mevcut replay/duplicate tanıkları; fresh yeni handle ile restart varyantı ayrı raporlanmalı |
| R06 | Geçerli fresh manuel admission ile stale HEAD, dirty repo ve değişen exact scope reddedilir | Eski sözleşmenin kapsamı korunmalı; yeni V2 altında bu üç fixture NOT_RUN |
| R07 | Aynı baseHead'deki iki onaylı proposal: tek exact EXECUTE yalnız seçilen proposal'ı yürütür | Eski otomatik toplu resume beklentisi geçersiz. İkinci subject için ayrı fresh manuel action gerekir; ilk commit sonrası ikinci baseHead stale olabilir. V2 fixture NOT_RUN |
| R08 | Unattributed/historical APPROVE ve Recovery9 otomatik replay edilemez; tarihsel aktör eklenmez | K3 negatifleri, gerçek Recovery9 dokuz hash'i aynı; gerçek Recovery9 üzerinde hiçbir execution testi yapılmaz |
| R09 | Exact-patch safety proof publication resume dışında; mevcut local-governed sınırı korunur | Exact12 publication guard + kaynak sınırı; V2 kapsamı bu exclusion'ı daraltamaz |
| R10 | Async gate sonrası expiry/provenance değişimi mutation callback'i öncesi reddedilir | K3 35; commit/push'un her satırında yeni login yapıldığı iddiası bu tanıktan çıkarılamaz |

R07'de seçilmeyen subject için reservation/execution/publication olmaması zorunludur. Mevcut reconciliation'ın ürettiği STALE metadata etkisi varsa ayrı kaydedilir; bütün inbox'ın hiçbir koşulda byte-identical kalacağı iddia edilmez. R01/R02'nin erkenden no-op olması ile R06'nın kimlik doğrulaması sonrası mevcut staleness kontrolüne ulaşması birbirine karıştırılmaz.

## Kabul ve red ölçütleri

Reviewer en az şu sorulara yazılı cevap vermelidir: (1) otomatik execution beklentisi tamamen kaldırılırken staleness/duplicate kapsamı korunuyor mu; (2) fresh EXECUTE yalnız tek exact subject için mi; (3) farklı verified session aynı tek-owner auth modeline uygun mu; (4) negatif fixture'lar gerçekten auth/gate sınırına ulaşıyor mu; (5) state/repo/journal/commit/push gözlemleri beklentiye uygun ve bağımsız mı; (6) eski raw FAIL ve frozen byte'lar korunuyor mu; (7) mevcut 35+9 tanıkların sınırı dürüst mü?

Kabul kararı taslak digest'i, kaynak HEAD'i, fixture önkoşulları ve case IDs ile bağlanmalıdır. Sonuç alanları `PASS_WITH_FINDINGS / CHANGES_REQUIRED / NOT_RUN` olabilir; sessiz PASS yok. Eksik R06/R07/restart/load-spy tanıkları **NOT_RUN** kalır. K3'ün önceki bağımsız PASS_WITH_FINDINGS sonucu V2 bağımsız incelemesi yerine kullanılamaz.

Sonraki implementasyon önerisi, ancak inceleme sonrasında ayrı adlandırılmış V2 smoke ve yeni receipt'tir; eski dosyalar, raw loglar, grader/fixture ve manifest tarihçesi yerinde kalır. Manifest/baseline geçişi bu hazırlık oturumunda yapılmaz.
