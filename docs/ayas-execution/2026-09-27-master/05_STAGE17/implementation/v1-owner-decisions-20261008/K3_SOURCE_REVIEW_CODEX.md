# K3 owner admission — kaynak uygulaması öncesi Codex incelemesi

**CHANGES_REQUIRED / GERÇEK KAYNAK UYGULAMASI BEKLİYOR.** İncelenen aday `bc9f5fd9ad77d14d14c1a09da28a845015b50f15`, patch SHA-256 `5deff0b53bed7e31292efff85493633bf330b30c24b12680ebfa2131cc341231`. [K3_OWNER_PROVENANCE.md](K3_OWNER_PROVENANCE.md) Claude'un orijinal raporudur ve byte'ları korunmuştur. Aşağıdaki delta, güvenlik kapanışı için onun PASS yorumunu sınırlar.

## Gerçek zincir ve mevcut korumalar

`accessGate.verifySession` → `app/brain/actions.requireBrainSession` → owner action → `AyasApprovalInboxStore.decide` / micro-batch karar deposu → proposal hash/base/scope yeniden kontrolü → `AyasProposalExecutionService` → `AyasAutonomyDaemon.executeApproved` → `reserveApproval` → execution authority lock/journal/gate/action firewall → mutation → Graphify/validator → yayın servisinde staging/commit/normal push.

Reservation, decision'ın tek kullanımlık authorization/reservation alanlarını bağlar. Journal aynı proposal/hash/base/exactFiles ve authorization/reservation kimliklerini taşır. SAFE sınıflandırması tek başına yetki değildir. Tarihsel recovery otomatik replay edilmez. Exact reviewed proof için otomatik yayın sınırı [K1_EXACT12_CONDITIONS.md](K1_EXACT12_CONDITIONS.md) içinde ayrıca doğrulanmıştır.

Graphify file/import yolu `decideAyasOwnerApproval → AyasAutonomousExecutionGate.ts → AyasProposalApprovalService.ts → publishAyasApprovedProposal` bulundu. Object method `executeApproved` / `reserveApproval` için tam CALLS yolu çıkarılamadı; bu kısımlar doğrudan kaynakla tamamlandı. Altı mevcut dosya impact taraması high blast radius / yedi community verdi; bu bir doğrulanmış güvenlik sonucu değildir. Graphify PARTIAL9 / semantic PENDING korunur.

## Bulgular ve yeniden üretim

[K3_PRIMARY_CODEX.raw.log](K3_PRIMARY_CODEX.raw.log): ayrı izole kopyada **25/25 senaryo PASS**. Claude'un [K3_MUTATIONS_CLAUDE.raw.json](K3_MUTATIONS_CLAUDE.raw.json) kaydı **22/22 killed**, korunmuş gerçek mutation kanıtıdır. Bu testlerin kapsamadığı sınırlar [K3_SECURITY_PROBES.json](K3_SECURITY_PROBES.json) ve yeniden çalıştırılabilir [K3_SECURITY_PROBES.cjs](K3_SECURITY_PROBES.cjs) ile incelendi: saf fonksiyonlar + gerçek YÜRÜT action gövdesi, NOOP executor, yalnız sentetik kimlik.

| Bulgu | Kanıt | Sonuç / tehdit sınırı |
|---|---|---|
| **MEDIUM: mühür karar/yürütme sınırında doğrulanmıyor** | P3/P4: seal sıfırla değiştirilince `verifyAyasOwnerAdmissionSeal=false`, fakat binding ve owner-admitted predicate true | Store/execute/resume yalnız şekil/subject/time kontrol ediyor. Persisted/in-process sahte kayıt doğrulanmış owner kaydı sayılabilir. Tarayıcıdan unauthenticated injection gösterilmedi; yerel kayıt bütünlüğü açığıdır |
| **MEDIUM: karar anında sona ermiş session kabul ediliyor** | P5: session doğrulama anından iki saniye sonra expired; karar binding'i true | `sessionExpiresAt > verifiedAt` var; `sessionExpiresAt > decidedAt` yok. Beş dakikalık admission penceresi session ömrünü fiilen uzatabilir |
| **MEDIUM: ayrı YÜRÜT oturumu kalıcı zincire bağlanmıyor** | P7: gerçek action farklı geçerli sessionRef ile executor'a ilerliyor; ürettiği EXECUTE admission saklanmıyor/iletilmiyor | İki geçerli owner oturumunun kullanımı kendi başına yetki bypass'ı değildir. Hangi oturumun yürüttüğü kanıtlanamıyor; tam approval→reservation→execution provenance eksik |
| **LOW: sessionRef benzersiz login kimliği değil** | P1: aynı saniyede iki `issueSession` çağrısı aynı token üretir | Mevcut token iat/exp'den türetilir. K3 login bazında ayrım iddiasını ancak token grubu düzeyinde sağlar; identity uydurulmaz |
| **POLICY: durable approval session sona erince düşmüyor** | P9: uygunluk kontrolü decidedAt'a bakar | Kalıcı owner rızasının daha sonraki resume'da korunması mevcut tasarım olabilir. Owner politikasını açıkça belirlemeden bunun replay koruması olduğu söylenemez |

P2 geçerli seal/binding, P6 tekrar actionRef ve başka proposalHash reddi, P8 admission'sız APPROVE'un executor öncesi reddi PASS. Bunlar yukarıdaki bulguları kapatmaz. Supplemental probe exit 0, **bulguların yeniden üretildiğini** ifade eder; güvenlik PASS değildir. Yerel kabuk sahibinin anahtarı da ele geçirmesine karşı koruma iddiası yoktur.

## Owner incelemesine sunulan dar düzeltme paketi

Kaynak uygulaması yapılmadı. Önerilen kapsam, mevcut K3'ün on dosyalık adayını aşağıdaki şekilde tamamlar; ikinci approval sistemi, store root, daemon veya homepage özelliği açılmaz:

1. `AyasOwnerApprovalAdmission.ts`: karar anında expiry; cryptographic seal doğrulamasını owner decision/execute/resume sınırında zorunlu kılan doğrulayıcı; action/subject uyumu. Şekil kontrolü doğrulanmış owner kanıtı yerine kullanılmaz.
2. `AyasApprovalInboxStore.ts` / `AyasMicroBatch.ts` ve mevcut servis deps: strict owner yolunda trusted server verification zorunluluğu, exact subject ve actionRef tekrar kontrolü. İç sistem REJECT/LATER kayıtları owner atfedilmeden mevcut davranışı korur. Eski raw kayıtlar yeniden yazılmaz.
3. `app/brain/actions.ts`, `AyasProposalExecutionService.ts`, `AyasOwnerApprovalResume.ts`, gerekiyorsa `AyasAutonomyDaemon.ts` / mevcut `AyasExecutionJournal.ts`: doğrulanmış APPROVE ve taze EXECUTE admission'ı mevcut reservation/decision/execution kimliklerine bağlanır, yürütme oturumu mevcut kayıt zincirinde tutulur. Kimlik eksik/bozuk/anahtar yoksa reservation veya mutation öncesi fail-closed. Default production deps bunu atlayamaz; test seam yalnız izole fixture'a ait olur.
4. `accessGate.ts`: eski signed cookie'leri bozmadan yeni login'lere random session nonce ekleme **ayrı owner alt kararıdır**. Onaylanmazsa sessionRef tanımı dürüstçe token-group reference olarak daraltılır. Aynı saniye çakışması gizlenmez.
5. Yeni K3 smoke'u genişletilir: invalid seal/expired-at-decision, eski attribution yokluğu, değişmiş proposal, duplicate execution/actionRef, cross-session provenance ve reservation öncesi zero-effect negatif kontroller. Frozen grader/fixture/manifest pinleri değiştirilmez.

İki bilgisayar kullanımı nedeniyle önerilen politika: farklı **doğrulanmış** owner oturumuyla manuel YÜRÜT mümkün kalır, approval ve execute sessionRef ayrı saklanır; kimliği client'tan alınmaz. Aynı sessionRef zorunluluğu ancak owner onu özellikle seçerse eklenir. Resume, önceki rızanın tam subject/authorization ve seal bütünlüğünü doğrular; kararın max-age/re-auth politikasını owner seçer. Bu seçimler source digest'ine dahil edilir.

**İstenen karar:** bu kapsamı kabul / daralt / ret; farklı doğrulanmış oturuma izin + iki oturum kaydı; session nonce dahil / kapsam dışında; durable resume rızasını koru / taze owner re-auth iste. Mevcut patch'e toplu ONAY önerilmez. Revize byte'lar ve testler hazır olduğunda yeni patch digest'i ayrı owner incelemesine ve bağımsız incelemeye bağlanır. Exact12'nin önceki patch'i değişmediği için kendi incelemesi geçerlidir; K3 düzeltme incelemesi yerine geçmez.

Canlı autonomy ayarı değiştirilmedi. Kapanış boyunca APPROVE verilmez. Yeni Git push ve deploy/restart/bakım bu kapsam kararından ayrı kalır.
