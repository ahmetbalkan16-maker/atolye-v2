# AYAS V1 — altı owner kapısı ve kararlar

Kaynak: `58ec1bd`; önceki contract: `../STAGE17_OWNER_ACTION_REGISTER_59e83cd.json`. Aşağıdaki durumlar agent kararıyla kapatılmadı. CAN_START yalnız Atölye'nin read-only/editoryal/izole hazırlığını ifade eder; production execution veya yayın izni değildir.

## 1. AUTHENTICATED_RUNTIME_IDENTITY — authenticated canlı runtime kimliği

| Alan | Karşılığı |
|---|---|
| Mevcut durum | UNQUALIFIED; canlı sağlık401 ve protected studio307 yalnız kimliksiz gate tanığı |
| Gerekli owner kararı/işlemi | Owner kendi oturumunda canlı kimliği görür; yalnız non-secret source/build/lock/gate sonucunu bildirir. Credential/cookie paylaşılmaz |
| Risk | Yanlış runtime/source instance'ını kabul etmek; auth provenance eksikliği |
| Atölye engeli | Offline hazırlığı engellemez. Authenticated canlı kullanım, production execution ve V1/final Stage17 kabulü için zorunlu |

## 2. REAL_PHONE_VOICE_MEDIA_CONTINUITY — gerçek telefon, ses, medya ve devamlılık

| Alan | Karşılığı |
|---|---|
| Mevcut durum | NOT_QUALIFIED; fiziksel telefon, microphone, audible Turkish voice ve gerçek media/E2E kabulü NOT_RUN |
| Gerekli owner kararı/işlemi | Bakım planındaki fiziksel checklist; mevcut designated production/media gates üzerinden onaylı çıktıyı izleyip dinleme |
| Risk | PWA/mic/wake/TTS/interrupt/bağlantı sorunlarını synthetic PASS ile gizlemek; MP4 container'ını kaliteli içerik sanmak |
| Atölye engeli | PC'de read-only hazırlık engellenmez. Telefon AYAS V1 kabulü ve gerçek video yayımlama öncesi medya incelemesi engeli |

## 3. ACTUAL_REBOOT_CONTINUITY — gerçek reboot sonrası devamlılık

| Alan | Karşılığı |
|---|---|
| Mevcut durum | NOT_RUN; mevcut listener/tasks gözlemi gerçek reboot değildir |
| Gerekli owner kararı/işlemi | Ayrı bakım onayında owner Windows'u yeniden başlatır; sonraki tek origin/tunnel, gate, iki task ve observer sürekliliği kaydedilir |
| Risk | Restart/autostart veya session devamlılık hatası; canlı owner makinesinde kesinti |
| Atölye engeli | Hazırlığı engellemez. V1 operational/Stage17 kabulünü engeller; owner'ın canlı makinesini agent kendiliğinden reboot etmez |

## 4. LEMON_TEST_BINDING — Lemon Squeezy TEST binding

| Alan | Karşılığı |
|---|---|
| Mevcut durum | UNBOUND; önceki owner-reported TEST setup gerçek connector/ingress/durable receipt değildir |
| Gerekli owner kararı/işlemi | Owner kontrollü TEST-mode account/secret store binding ve 16.8 durable ingress/dedupe/journal kanıtı. **Düzeltme (Claude, 8 Ekim):** ingress route'u ve durable store kaynakta yok; `LEMON_TEST_KEY_CONNECTION_DURABLE_INGRESS` ertelenmiş nitelik. Register Lemon için erteleme tanımlamaz. Seçenekler: ingress paketi (yeni geliştirme) veya register'ı açıkça değiştiren owner-reviewed deferral. Bkz. [COMMERCIAL_GATES_LEMON_FIVERR.md](COMMERCIAL_GATES_LEMON_FIVERR.md) |
| Risk | Gerçek bağlantı/mode/parent/ledger kanıtını fixture PASS sanmak; production ödeme yetkisini yanlış açmak |
| Atölye engeli | MP4 hazırlığının teknik bağımlılığı değildir. Mevcut N05/N_LIVE ve Stage17 kapanışında kanıt/izinli açık karar eksikliği engeldir |

## 5. FIVERR_ORDER_REVENUE_LEDGER — resmi Fiverr order/revenue/ledger kanıtı

| Alan | Karşılığı |
|---|---|
| Mevcut durum | ACCOUNT_GIG_OWNER_REPORTED_ONLY; resmi order/delivery/revenue/ledger export bulunmuş sayılmaz |
| Gerekli owner kararı/işlemi | Owner resmi export/receipt sağlar veya mevcut register'da izin verilen kapsam için açık reviewed deferral verir |
| Risk | Aktif Gig veya gelen mesajı sipariş/gerçekleşmiş gelir olarak kaydetmek; sahte ledger kapanışı |
| Atölye engeli | MP4 hazırlığının teknik bağımlılığı değildir. Mevcut N05/N_LIVE kapanış şartı henüz açık; agent kendiliğinden ertelemez |

## 6. FINAL_BOUND_OWNER_REVIEW — nihai digest'e bağlı owner kabulü

| Alan | Karşılığı |
|---|---|
| Mevcut durum | NOT_READY; ownerReviewDigest null. Bu hazırlık paketinin index'i final Foundation review değildir |
| Gerekli owner kararı/işlemi | Teknik güvenlik/kapsam/final HEAD testleri ve gerekli canlı/platform kanıtları tamamlanınca gerçek son paket digest'ini inceleyip kabul/ret/kapsam kararı verir |
| Risk | Genel devam et talimatını veya eski push onayını final acceptance/authority grant saymak |
| Atölye engeli | Ayrı güvenli hazırlık CAN_START. FOUNDATION_CLOSED ve AYAS V1 tam kabulü için owner kararı zorunlu |

## Bunlardan ayrı, hazırlanmış teknik kararlar

| Karar | Somut inceleme nesnesi | Yetki sınırı |
|---|---|---|
| Frozen evaluator succession | EVALUATOR_SUCCESSION_PROPOSAL.json + plaintext successor + v59/V3 drafts; proposal SHA256 `fe61c521184c75305ccaee3da3fd90b083a56067284d9d8748bc5a5a04f5f5d0` | Yalnız exact12 sınıflandırma geçişi; original grader/fixture/raw FAIL/V1-V2 değişmez. Owner onayı yok; candidate çalıştırılmadı |
| Recovery9 incelemesi | RECOVERY9_RECONCILIATION_PROPOSAL.json, her satırda exact proposal/artifact/decision/execution/journal/base bindings | Missing actor uydurulmaz; raw RECOVERY_REQUIRED korunur; replay/APPROVE/DONE/capability yok. Yeni runtime receipt/store/projection uygulanması ayrıca açık yetki ve doğrulama ister |
| Canlı bakım | LIVE_MAINTENANCE_AND_PHONE_CHECKLIST.md | Final teknik HEAD ve tek baseline hazır olmadan uygulamaya geçilmez; exact-source deployment/restart/reboot onayı ayrıdır |
| Yeni Git push | Bu paketin yerel doc commit'i, final doğrulama sonrası gerçek SHA ile raporlanır | Önceki58ec1bd push onayı yeni commit'i kapsamaz; normal push için ayrı owner onayı gerekir |

Lemon/Fiverr konusunda şu an **DEFERRED kararı yoktur**. Owner video üretimi için ticari gate'leri ertelemek isterse platform, kapsam, şartlar, review digest'i ve açık kalan Stage17/financial sınırlamalar ayrı kaydedilir. Bu ticari karar protected-store, auth, authority, no-replay veya runtime integrity açıklarını kapatmaz.
