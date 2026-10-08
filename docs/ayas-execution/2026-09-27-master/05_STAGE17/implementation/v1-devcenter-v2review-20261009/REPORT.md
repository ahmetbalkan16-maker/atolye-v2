# 8→9 Ekim gece — owner kararının uygulanması: push, V2 kaydı, Gelişim Merkezi adayı

**Özet:** Onaylı dört commit pushlandı. V2 çapraz incelemesi PASS_WITH_FINDINGS olarak kaydedildi; tam bağımsız inceleme yapılmadı. Gelişim Merkezi hatasının kök nedeni bulundu; düzeltme ve testler yalnız TEMP'te hazır, kaynağa uygulanmadı. V2 sıkılaştırma paketi ve `ayas-guard-*` temizlik planı da yalnız TEMP'te/kuru çalıştırmada hazır. Canlı sisteme dokunulmadı.

## 1. Push

`32e59c1..ad6c2a9` (c3d5530, f37d0e7, 8dce89b, ad6c2a9) normal fast-forward pushlandı; force yok, başka commit yok. Önce yeniden doğrulandı: `git ls-remote` gerçek remote `32e59c1`, ahead 4 / behind 0, worktree ve index temiz (untracked 0), eklenen 5.332 satırda kimlik bilgisi taraması 0 gerçek eşleşme (bir kod satırı `config.resolveSecret()` ve iki sentetik test anahtarı), Graphify grafiği `ad6c2a9`'a bağlı, bütünlük 0/0/0/0 (yinelenen düğüm/kenar, kopuk kenar, öz-döngü), PARTIAL9 / semantic PENDING beklenen durum. Push sonrası origin = `ad6c2a9`, 0/0.

## 2. V2 çapraz inceleme kaydı

Sonuç **PASS_WITH_FINDINGS** olarak korunur. **Tam bağımsız inceleme yapılmadı:** bu bir çapraz incelemedir; inceleme raporunun kendisi depoda değil, bulgular owner'ın 8 Ekim gece mesajından aktarıldı. Aktarılan bulgular: Gelişim Merkezi'nde yanlış otomatik devam mesajı ve görünmeyen YÜRÜT; R05c/d, R07, R10a/b doğrulamalarının zayıflığı; K3 actionRef replay korumasının V2'den bağımsız kaldırılmaması; süreçler arası yarış ve gerçek restart kanıtlarının NOT_RUN kalması; 12.398 `ayas-guard-*` klasörü. Bu kayıt hiçbir sessiz PASS üretmez.

## 3. Gelişim Merkezi — kök neden ve aday düzeltme (TEMP)

**Hata.** `AyasDevelopmentCenter.tsx` içinde "Onaylandı — Yürütme Bekleniyor" kartı "AYAS, yürütme etkinleştirildiğinde bu onayı … otomatik olarak sürdürecek" diyordu ve hiçbir kontrol sunmuyordu; `ExecuteControl` de owner-model onaylarını (`ownerApprovedPendingExecution`) bilerek gizliyordu. K3 (owner politikası 2026-10-08: `automaticResume: false`, `freshManualExecuteRequired: true`) resume işçisini manuel eyleme bağladı ama arayüz güncellenmedi. Canlıda `AYAS_AUTONOMOUS_EXECUTION_ENABLED=1` olduğundan normal öneride ONAYLA hemen yürütüp yayınlar; fakat **exact patch** önerisinde ONAYLA her zaman "owner-approved: exact patch awaiting local governed execution" olarak kaydedilir, resume exact patch'i zaten dışlar. Sonuç: o onay hiçbir yoldan yürütülemez, ekran ise yanlışlıkla kendiliğinden devam edeceğini söyler. Canlı kutu salt okunur incelendi: şu an APPROVED kayıt 0, RECOVERY_REQUIRED 9 (Recovery9, hepsi owner admission'sız), PENDING 1 (exact patch değil).

**Aday (yalnız TEMP klon `ad6c2a9`).** Sunucu tarafı ve K3 dosyaları değişmez; YÜRÜT mevcut `executeAyasApprovedProposal` eylemini kullanır (taze doğrulanmış EXECUTE + mühürlü APPROVE kontrolü zaten orada).

- Kart artık gerçeği söyler: "AYAS bunu kendiliğinden yürütmez; yürütme yalnız senin YÜRÜT eyleminle ve doğrulanmış owner oturumunla başlar."
- YÜRÜT yalnız sunucu APPROVE'un bu öneri ve hash için mühürlü owner admission taşıdığını doğruladığında (`manualExecution: AVAILABLE`) ve kutu hâlâ APPROVED okuduğunda görünür; önce onay ekranı açılır, tek dispatch noktası `ExecuteControl` olarak kalır.
- Admission'sız/eski/kurcalanmış onay: YÜRÜT yok, açık neden yazılır. Durum değiştiyse (RESERVED/COMPLETED/RECOVERY_REQUIRED/STALE) YÜRÜT yok, güncel durum yazılır; RECOVERY_REQUIRED'da tekrar çalıştırma yok.
- YÜRÜT onay ekranı yürütmenin ne yaptığını söyler: değişiklik bu bilgisayardaki çalışma kopyasında uygulanır ve test edilir, **commit/push yapılmaz**.
- Öneri kartındaki ONAYLA metni tıklamanın gerçek sonucuna göre değişir: exact patch veya canlı yürütme kapalıysa "kaydedilir, ayrıca YÜRÜT gerekir"; yalnız canlı ve exact olmayan durumda eski "tek commit olarak yayınlayacak" metni.
- `OWNER_ADMISSION_REQUIRED` gibi reddler düz Türkçe gösterilir.

**Testler (TEMP).** Yeni `scripts/smoke-ayas-development-center-owner-execute.ts` 13/13 PASS: D01–D10 gerçek bileşeni çizer, S01–S03 gerçek yürütme servisini TEMP Git repo + TEMP kutu + sentetik anahtarla çalıştırır (S01 admission'sız onay + geçerli taze EXECUTE → `OWNER_ADMISSION_REQUIRED`, sıfır etki; S02 EXECUTE yok / APPROVE admission'ı EXECUTE diye tekrar / bayat EXECUTE → red, sıfır etki; S03 iki saat önceki mühürlü APPROVE + taze EXECUTE → değişiklik yerelde bir kez, commit yok, aynı EXECUTE ikinci kez yürütemez). Mutasyon: 10/10 KILLED (yanlış metni geri getirme, admission kontrolünü kaldırma, durum kontrolünü kaldırma, eski görünmez-YÜRÜT koruması, çift YÜRÜT, ONAYLA metin sapmaları, bayrak sapması, fail-open). Regresyon (aday üstünde): Gelişim Merkezi 59/59, micro-batch 27, control center 39, homepage V2 11, owner UI V2 36, brain core UI 43, durable-state 24, K3 admission 35/35, resume V2 20/20, gate V2 6/6, execution service 29, firewall/authority/durable-task/lifecycle guard'ları PASS; tsc exit0; değişen 5 dosyada ESLint 0 uyarı. Beklenen tek kırılma: `smoke-ayas-owner-recommendations-view.ts:173` yanlış metni şart koşuyordu; aday o tek satırı günceller, suite 13/13. Önceden var olan iki FAIL (`smoke-ayas-publication-activity`, `smoke-ayas-autonomy-observer`) temiz `ad6c2a9`'da aynı assertion'la FAIL; adaydan bağımsız, manifest dışı.

**Kaynak uygulaması için kesin kapsam (ayrı onay gerekir):** [DEVCENTER_CANDIDATE.patch](DEVCENTER_CANDIDATE.patch), temiz `ad6c2a9`'a `git apply --check` ile uygulanabilir.

| Dosya | Değişiklik |
|---|---|
| `src/components/brain/AyasDevelopmentCenter.tsx` | kart, YÜRÜT yerleşimi, metinler, hata etiketleri |
| `src/lib/brain/autonomy/AyasOwnerRecommendationsView.ts` | `manualExecution`, `afterApproval` (salt okunur, gate/servis import etmez) |
| `src/lib/brain/autonomy/AyasApprovalInboxView.ts` | yalnız yorum |
| `scripts/smoke-ayas-development-center-owner-execute.ts` | yeni suite |
| `scripts/smoke-ayas-owner-recommendations-view.ts` | tek assertion satırı |

Dokunulmayan: `app/brain/actions.ts` ve 14 K3 dosyası, homepage dosyaları, `BrainCoreConsole`/`BrainConsoleView`, Full166 manifest/pin'leri. K3-L1 (gate başlığındaki eski yorum) bu pakette değil. `AyasControlCenterModel.ts`'deki "Onaylandı — otonom yürütme bayrağı bekleniyor" etiketi de yanlış ama homepage durum şeridini besliyor ve held-out H9 bunu sabitliyor; ayrı owner kararı.

**NOT_RUN:** gerçek tarayıcı hidrasyonu (TEMP build + CDP), gerçek telefon/PC denemesi, yeni HEAD için Full166. Uygulama onaylanırsa canlı deploy hedefi `32e59c1` yerine bu düzeltmeyi içeren yeni HEAD olmalı. Not: exact patch üzerinde YÜRÜT canlı repo çalışma ağacında commit'siz bir değişiklik bırakır (tasarlanmış yerel yönetimli yürütme); Observer bu sırada kirli ağaç nedeniyle bekler, commit kararı owner'ındır.

## 4. V2 sıkılaştırma paketi (TEMP)

Zayıflıklar: R05c/d "en fazla bir yayın" kabul eder, ikisi de başarısız olsa geçer; 8 Ekim kaydında ikinci tık servise hiç ulaşmamış (toplam attempts 1). R07 B'nin durumunu APPROVED ya da STALE diye gevşek bırakır. R10a/b reddin nedenini sabitlemez.

`scripts/smoke-ayas-owner-approval-resume-v2-hardening.ts` (V2 dosyası byte'ı değişmeden kalır), 8/8 PASS: H05c/H05d tam olarak bir başarı, bir commit, bir reservation, ikinci tık RESERVED gördüğü için sıfır deneme; **H05f** aynı EXECUTE iç içe çalıştırılır (V2'de yoktu; R05e iki farklı EXECUTE kullanır) → ikinci çağrı servise ulaşır ve yayın kilidi (`AYAS_PROPOSAL_STABILITY_GUARD_REFUSED`) reddeder, tek yayın; H07 A sonrası B APPROVED ve byte'ı aynı, B'nin kendi EXECUTE'u tam bir `STALE_APPROVAL`; H10a/b `OWNER_ADMISSION_REQUIRED` @ EXECUTION, journal ve öneri RECOVERY_REQUIRED, sonraki taze EXECUTE resume'la da servisle de tekrar çalıştıramaz; **K3a/K3b** actionRef replay korumasını durum geçişlerinden bağımsız iki katmanda kanıtlar (resume filtresi ve servis). Mutasyon 5/5 KILLED: resume replay filtresi, daemon post-reservation owner kontrolü, servis replay kontrolü, resume EXECUTE şartı, stale uzlaştırması. Suite kendi `os.tmpdir()`'ini run root içine alır; `ayas-guard-*` sızıntısı 0.

**Kesin kapsam (ayrı onay):** [V2_HARDENING_CANDIDATE.patch](V2_HARDENING_CANDIDATE.patch): yalnız bu yeni dosya. Manifest/baseline'a eklenmez. Süreçler arası yarış ve gerçek restart **NOT_RUN** kalır. Eski raw FAIL arşivleri değişmedi.

## 5. `ayas-guard-*` geçici klasörleri

Salt okunur envanter: 13.552 klasör (6.244 sched, 6.244 tx, 1.064 inbox; owner'ın 12.398'i daha önceki sched+tx sayısı). Junction/symlink 0 (klasörün kendisi ve içi), alt klasör 0, yalnız `scheduler-state.json` / `stability-transactions.json` veya boş, toplam ~12,9 MB, içerikte gerçek runtime yolu 0. Kaynak: Full166'da pin'li `scripts/ayas-isolated-stability-guard.ts` klasörleri doğrudan `os.tmpdir()` altına açar; hiçbir suite silmez. Kök düzeltme pin değişikliği ister (ayrı karar).

Kuru çalıştırma: 13.184 klasör silinebilir (yeniden doğrulama şartıyla), 368 son 2 saatte yazıldığı için korunur, silinen 0. Kuru çalıştırma kendi script hatamı yakaladı: PowerShell `-notmatch` Türkçe kültürde büyük `I`'yı noktasız `ı`'ya katlıyor ve 1.269 geçerli adı dışarıda bırakıyordu; `-cnotmatch`/`-clike` ile düzeltildi. Silme script'i [GUARD_TEMP_CLEANUP.ps1.txt](GUARD_TEMP_CLEANUP.ps1.txt): varsayılan kuru; her klasörü silmeden hemen önce yeniden doğrular (tam ad, doğrudan TEMP altı, reparse yok, beklenen dosyalar, yaş, çalışan test süreci yok), dosyaları tek tek siler ve klasörü özyinelemesiz kaldırır, makbuz yazar. **Çalıştırılmadı.**

Ayrıca bildirim: `%TEMP%` altında başka suite'lerin bıraktığı on binlerce `ayas-*` klasörü daha var (ör. `ayas-proposal-approval-*` 11.009, `ayas-exec-authority-*` 10.111). Bazıları gerçek `node_modules`'a junction taşıyabilir; bu paketin kapsamı dışında, ayrı ve junction-önce bir plan ister.

## 6. Canlı sistem

Deploy, restart, Next yükseltmesi, reboot, APPROVE/YÜRÜT, ücretli servis veya YouTube yükleme yok. Tüm testler TEMP klonlarda, TEMP/TMP çalışma alanına yönlendirilerek çalıştı; canlı kutu yalnız okundu. Bu paketin yerel belge commit'i HEAD'i ilerletir; çalışan Observer bir sonraki turda `ad6c2a9`'a bağlı PENDING öneriyi STALE işaretleyebilir (8 Ekim'de iki kez görülen tasarlanmış davranış). AYAS V1 / Foundation **BLOCKED**; Atölye **CAN_START**; 12 Ekim Fatih planı korunur.

## 7. Owner onayı bekleyenler

1. Gelişim Merkezi kaynak uygulaması (5 dosya, `DEVCENTER_CANDIDATE.patch`).
2. V2 sıkılaştırma suite'i (1 dosya, `V2_HARDENING_CANDIDATE.patch`).
3. `ayas-guard-*` temizliğinin `-Execute` ile çalıştırılması.
4. Bu belge commit'inin push'u (dört commit izni kapsamaz).
5. `AyasControlCenterModel` etiketi ve K3-L1 yorumu için ayrı karar; guard helper pin değişikliği.
