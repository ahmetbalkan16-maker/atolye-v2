# Resume V2 — iki eski auto-resume testinin sürümlü halefi

**Durum: V2 testleri TEMP'te PASS, mutation kontrolüyle ayırt edici; yerel commit `f37d0e7`. Bağımsız inceleme NOT_RUN.** Eski iki suite (`smoke-ayas-owner-approval-resume.ts`, `smoke-ayas-autonomous-execution-gate.ts`) byte'ı değişmeden ve raw FAIL arşivleriyle yerinde kalır. Full166'nın `dbf9542` sonucu bu yeni HEAD'e taşınmaz.

## Auto-resume neden artık yasak — kanıt zinciri

1. **Owner kararı:** `../v1-k3-security-20261008/OWNER_DECISION_AND_PUSH_RECEIPT.json` (2026-10-08T16:47:16Z) `sessionPolicy`: `automaticResume: false`, `freshManualExecuteRequired: true`, `differentVerifiedSessionAllowed: true`, `historicalConsentPreserved: true`, `retroactiveRecoveryActors: false`.
2. **Kaynak:** `AyasOwnerApprovalResume.ts` (K3 exact map hash `72739aea…`) state okumadan önce `explicitManualOwnerAction !== true || !executionOwnerAdmission` ise `[]` döner; uygunluk ayrıca mühürlü owner APPROVE + taze, tek-subject EXECUTE ister.
3. **Gözlem:** V2 R01/R02 inbox `load()` çağrısını sayar: bayrak açıkken bile manuel eylem ya da EXECUTE yoksa **0 load, 0 attempt**. Unattended CLI (`scripts/ayas-owner-approval-resume.ts`) ikisini de vermez (gate V2 20j).
4. **Mutation:** Eski davranışı geri getiren mutant (MV2: manuel kapı yok + yalnız provenance reason ile uygunluk) gate V2'nin ilk senaryosunda **KILLED**.

Bu yüzden eski FAIL'i PASS'a çevirmek güvenlik politikasını geri almak olurdu; yalnız beklentiyi 1→0 yapmak da stale/multi-proposal kapsamını hiç çalıştırmazdı. V2 bu kapsamı **geçerli güncel manuel yetkiyle** yeniden sınar.

## Sözleşme eşlemesi (V2_INDEPENDENT_REVIEW_PACKET.md R01–R10)

| ID | V2 senaryosu | Sonuç (TEMP) | Not |
|---|---|---|---|
| R01 | R01a, R01b | PASS | Load-spy: 0 load; inbox byte-identical; commit/push/journal 0 |
| R02 | R02a (EXECUTE yok), R02b (bayrak kapalı) | PASS | Kombinasyonlar ayrı etiketli |
| R03 | R03 | PASS | APPROVE→EXECUTE replay, uyumsuz action, mühürsüz, sahte mühür, kullanımdan önce süresi biten oturum, gelecek tarihli, 5 dk'dan eski, cross-subject; eski nonce'suz cookie genel erişimde geçerli ama admission üretemez |
| R04 | R04 | PASS | 2 saat önceki mühürlü APPROVE + farklı oturumdan taze EXECUTE; 1 commit, local==bare remote; decision/auth/reservation/journal bağları; iki sessionRef/actionRef farklı |
| R05 | R05a, R05b, R05c, R05d, R05e | PASS | Tamamlanmış sonrası aynı EXECUTE; restart + yeni EXECUTE (servis de NOT_READY ile reddeder); arka arkaya çift tık; **gerçek iç içe yarış** (ikinci çağrı uygunluğu geçti, stability guard reddetti); her durumda ≤1 yayın, ≤1 reservation |
| R06 | R06a, R06b, R06c, R06d | PASS | Geçerli admission kontrolle bağımsız doğrulandıktan sonra: stale HEAD → `STALE_APPROVAL` + STALE; kirli ağaç → guard reddi, owner byte'ları dokunulmadı, onay tüketilmedi; hash korunarak scope sapması → `AYAS_PATCH_ARTIFACT_MUTATION_SCOPE_MISMATCH`; hash değişen sapma → hiç attempt yok |
| R07 | R07 | PASS | Aynı baseHead'de iki onaylı proposal: A'nın EXECUTE'u yalnız A'yı yayınlar; B rezerve/yayın edilmez (A sonrası B APPROVED kalır); B'nin kendi EXECUTE'u `STALE_APPROVAL`, B → STALE |
| R08 | R08 | PASS | Admission'sız owner-reason, eski ONAYLA (reason yok), admission'lı manuel ONAYLA (owner-reason yok): taze EXECUTE'a rağmen attempt yok, inbox byte-identical (aktör eklenmez) |
| R09 | R09 | PASS (sınırlı) | `exactPatchSafetyProof` işaretli proposal resume'a girmez; servis `EXACT_PATCH_LOCAL_EXECUTION_ONLY`. **Sınır:** yalnız varlık işareti; gerçek exact-proof üretimi çalıştırılmadı |
| R10 | R10a, R10b | PASS | Reservation sonrası EXECUTE oturumu sona erer / mühürlü APPROVE değiştirilir → `OWNER_ADMISSION_REQUIRED`, dosya yazılmaz, commit/push yok. Gözlem: proposal ve journal `RECOVERY_REQUIRED` (onay tüketilmiş; insan kurtarması gerekir) |

Gate V2: 20e-v2 (bayrak açılınca otomatik alım yok; tek manuel eylem → tek yürütme; tekrar → yok), 20f-v2, 20g, 20h, 20i (eski suite'te hiç çalışmamıştı; HEAD kaynağında hâlâ geçerli), 20j (CLI sınırı). 6/6 PASS.

## Ayırt edicilik — mutation kontrolü (TEMP, byte restore SHA ile doğrulandı)

| Mutant | Kaldırılan koruma | Sonuç | Öldüren senaryo |
|---|---|---|---|
| MV1 | Manuel eylem kapısı | KILLED | R01b |
| MV2 | Eski otomatik resume (kapı yok, reason yeterli) | KILLED | 20e-v2 |
| MV3 | Uygunluktaki EXECUTE kontrolü | KILLED | R03 |
| MV4 | Daemon'un reservation sonrası owner yeniden kontrolü | KILLED | R10a |
| MV5 | Execution öncesi staleness uzlaştırması | KILLED | R06a |

Restore edilen hash'ler K3 exact map ile aynı: Resume `72739aea…`, Daemon `9da364cf…`, ExecutionService `e8272f36…`.

## İzolasyon ve doğrulama

Her senaryo TEMP Git repo + yerel bare remote; sentetik süreç-içi access key; `isolatedStabilityGuardDeps()`; `data/brain`, canlı runtime, ağ veya model yok. Run root sonda önce junction'lar kaldırılıp silinir (her koşu sonrası artık klasör 0). TEMP overlay: tsc exit0, iki dosyada `eslint --max-warnings=0` exit0. Repo genelinde metin/import tarayan guard'lar overlay ile PASS: firewall closure 12/12, durable-task-recovery 22/22, daemon authority boundary 23/23. `smoke-ayas-lifecycle.ts` arşiv-klonunda overlay **olmadan da** aynı şekilde FAIL: tarihsel revizyon `76aa4b1` git geçmişi olmayan klonda okunamıyor (ENVIRONMENT_ARTIFACT); bu suite yalnız `src`/`app` tarar, V2'den etkilenemez.

Commit sonrası `f37d0e7` exact arşiv klonundaki bağlı koşu: [BOUND_RUN_f37d0e7.json](BOUND_RUN_f37d0e7.json).

## Açık kalanlar

- **Bağımsız inceleme NOT_RUN.** Yazar (Claude) dışında ayrı bir reviewer bu oturumda çalıştırılmadı. K3'ün önceki PASS_WITH_FINDINGS sonucu V2 incelemesinin yerine geçmez. İnceleme `PASS_WITH_FINDINGS / CHANGES_REQUIRED / NOT_RUN` dışında sessiz PASS üretmemeli.
- V2 manifest/baseline'a eklenmedi; Full166'ya dahil değil. Eklemek ayrı açık kayıt ister.
- Üretimde `explicitManualOwnerAction: true` geçen bir server action yok; manuel yürütme yolu bugün YÜRÜT (`executeAyasApprovedProposal`) ve ONAYLA VE UYGULA. V2 resume primitive'ini kanıtlar; bir UI çağıranı varmış gibi okunmamalı.
