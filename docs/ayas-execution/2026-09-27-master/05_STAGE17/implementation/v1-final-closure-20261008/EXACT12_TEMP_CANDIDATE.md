# Exact12 evaluator succession — TEMP adayı, gerçek test sonuçları

**Durum: TEMP'TE UYGULANDI VE DOĞRULANDI / GERÇEK KAYNAĞA UYGULANMADI / OWNER ONAYI BEKLİYOR.** Aday yalnız izole bir TEMP clone'da (remote yok, `node_modules` junction) commit `a4db592163bf95dcdcfa030e2d50be5ad6742cb4` olarak var; temeli `a9dca74`. Ana worktree'ye, korunan grader'a, manifest'e veya golden vault'a dokunulmadı. İncelenecek tam değişiklik: [EXACT12_CANDIDATE_a4db592.patch](EXACT12_CANDIDATE_a4db592.patch) (SHA-256 `337ec9954de687bbe6d1bd2b4533d05c33164036b959602cecbdf508aa7c6323`). Makine kanıtı: [EXACT12_TEMP_CANDIDATE.json](EXACT12_TEMP_CANDIDATE.json).

## Değişiklik (6 dosya)

| Dosya | Değişiklik |
|---|---|
| `scripts/smoke-ayas-retrieval-evaluation-v3.ts` (yeni) | Orijinal grader + 1 başlık satırı − **tam 12** `KNOWN_LIMITATIONS` satırı. Gövde Codex taslağıyla byte olarak aynı; yalnız "DRAFT" başlığı değişti. SHA-256 `3c207d69…7d00` |
| `scripts/smoke-ayas-retrieval-evaluation.ts` | **Değişmedi** (`a92ceddb…5f9e`) |
| `src/lib/ayas/golden/AyasGoldenVaultRegistry.ts` | V1/V2 aynı; VERSION_3 eklendi; previousDigest `5f2fbf0b…a3f`, V3 digest `4cc87621…efd5`. Yalnız `golden.memory.retrieval-evaluation` vakası farklı |
| `scripts/smoke-ayas-golden-vault.ts` | Yayınlanmış digest listesine V3 eklendi + "V3 yalnız bu vakada V2'den farklı" doğrulaması. Hiçbir assertion silinmedi |
| `…/15F/EVAL_MANIFEST.json` | v58 → v59; `retrieval-evaluation` script'i v3, yeni v3 pini (orijinal pin korunur); `golden-vault` suite'inde smoke pini güncellendi. 166 suite; başka pin değişmedi |
| `…/15F/EVAL_MANIFEST_V58.json` (yeni) | v58'in byte-aynı arşivi (`588013da…7e4d`) |
| `src/lib/ayas/lifecycle/AyasLifecycleRegistry.ts` | Yeni evaluator kaydı `evaluator.retrieval.cf49-exact12-v3` (PINNED, admission NONE, rollbackTarget `pf15c-v2`) |

Fixture (`4061b710…8e23`), değerlendirme kütüphanesi (`d3c2f021…148e`), Golden V1/V2, frozen raw FAIL kanıtları ve CI'daki orijinal raw gate + CF49 review adımları değişmedi.

## Codex taslağına göre sapmalar — neden gerekliydi

1. **Golden V3 vakası orijinal grader'ı pinliyordu.** `smoke-ayas-golden-vault.ts` her vakanın pinlerinin script'in import closure'ına "ne fazla ne eksik" eşit olmasını ister. v3 orijinali import etmez; taslak kasa smoke'unu düşürürdü. Aday pinleri tam closure'dır. Orijinal grader V1/V2 pinleri sayesinde `AYAS_GOLDEN_VAULT_PINNED_FILES` içinde korunmaya devam eder.
2. **Taslak "mevcut pin değişikliği 0" diyordu; bu mümkün değil.** Kasa smoke'u yayınlanmış digest'leri sabit listeler ("Publishing a version appends one digest here"). V3 eklemek bu dosyayı ve manifest'teki pinini değiştirmeyi gerektirir. Bu, tasarlanmış bir koruma; zayıflatma değil.
3. Lifecycle kaydı taslakta yoktu. Zorunlu değil (orijinal kimlik eşleşmeye devam ediyor), ama evaluator değişimlerinin bu repoda kaydedildiği yer burası.

## Gerçek testler (hepsi TEMP)

- **Kontrol, değişiklikten önce:** orijinal grader `a9dca74`'te exit 1, tam 12 gate hatası, hepsi IMPROVED. Küme öneri ve `CF49_REVIEW_IDS` ile aynı.
- **Aday:** v3 iki çalıştırmada exit 0, `PASS (74 cases, 4 determinism, 8 error, 8 isolation/privacy, 7 chat chains)`. Metrikler, hata satırları ve determinism orijinal raporla aynı; yalnız sınıflandırma değişti.
- **Negatif kontroller (5/5 beklendiği gibi):**
  - N1: CF49 slotu kaynakta devre dışı → v3 FAIL, tam 12 REGRESSION (küme exact12'ye eşit). Aynı durumda **orijinal grader PASS veriyor**.
  - N2: 12'den biri geri eklendi → FAIL (IMPROVED).
  - N3: kalan 16'dan biri silindi → FAIL (REGRESSION `syn-pc-colloquial`).
  - N4: floor ölçümün üstüne çıkarıldı → FAIL.
  Her kontrolden sonra baytlar geri yüklendi ve hash doğrulandı.
- **Golden:** zincir sorunu yok, pin drift yok, closure uyumsuzluğu yok.
- **Etkilenen 34 manifest suite'i**, declared baseline runner ile aday HEAD'de, manifest v59, digest `2661b3c5…3fcd`: **34/34 PASS**. Bunlar arasında v58'de preserved raw FAIL olan `retrieval-evaluation`, `golden-vault-run` ve `golden-sandbox-run` de var; v59'da üçü PASS. Seçim Graphify blast-radius analizi (29 dosya / 11 community) ve vault/lifecycle tüketicilerinden yapıldı.
- **TypeScript** exit 0; değişen 4 dosyada ESLint 0 uyarı. CI zinciri (orijinal raw gate → CF49 review → CF49 closure → tam ESLint) sonuçları JSON'da.
- **Bağımsız inceleme: PASS_WITH_FINDINGS.** Ayrı bir soğuk başlangıçlı inceleyici kendi TEMP kopyasında çalıştı; ana repoya yazmadı.
  - Bütün hash'leri yeniden üretti; zayıflatılmış bir kontrol bulmadı.
  - Golden vault mutasyonları 40/40 yakalandı.
  - Kendi negatif kontrolleri: süpersede satın alma planı geçirildiğinde v3 12 REGRESSION ile düştü, **orijinal grader yine PASS verdi**. Saat dilimine bağlı rerank'te ve conflict karantinası kaldırıldığında da v3 düştü.

## İnceleme bulguları ve davranış etkisi — onaydan önce okunmalı

1. **Onay nesnesi bu patch'tir, Codex taslağı değil (MEDIUM).** Aday baytlar `EVALUATOR_SUCCESSION_PROPOSAL.json` taslaklarından farklı: v3 `2194580a` → `3c207d69`, Golden V3 `e76d2117` → `4cc87621`. Fark, yukarıdaki zorunlu düzeltmelerden gelir. Taslak digest'ine (`fe61c521…`) bağlı bir onay bu baytları kapsamaz. Onay patch SHA-256'sı `337ec995…6323`'e bağlanmalı.
2. **Golden kapı yeniden yeşile döner; terfi yolunun golden adımı açılır (MEDIUM).**
   - V2'de vault, retrieval vakası yüzünden her zaman `PROMOTION_STOPPED` veriyordu. Bu, Stage 15O araştırma/deney terfi yolunun golden adımını fiilen kapalı tutuyordu.
   - V3 ile `ayasExperimentEvidenceGoldenHeld` yeniden true dönebilir. IMPROVED bir deneyin `REVIEW_REQUIRED` patch'i exact safety proof alabilir ve daemon onu **SAFE** olarak inbox'a koyar.
   - `AYAS_AUTONOMOUS_EXECUTION_ENABLED=1` canlıda açık. Bu yüzden böyle bir öneri owner'ın tek tıklamasıyla commit ve push edilebilir. Owner tıklaması yine zorunludur; ama tek tıkla yürütülebilir önerilerin kapsamı genişler.
   - Bu, kazara kapalı kalmış tasarlanmış davranıştır. Lifecycle kaydındaki "admission NONE" bunu kod düzeyinde engellemez.
   - V2 digest'ine bağlı eski kanıtlar artık reddedilir (fail-closed); repoda böyle kanıt bulunmadı.
   - Öneri: onay verilirse V1 kapanışı bitene kadar Gelişim Merkezi'nde APPROVE verilmez.
3. **Yerel Full166 artık orijinal raw gate'i koşmaz (LOW).** v59'da orijinal grader'ı veya CF49 review'u çalıştıran manifest suite'i yok. Hosted CI (`ayas-safe-ci.yml`) ikisini de koşmaya devam eder ve tam 12 ile exit 1 ister. Owner isterse ayrı bir pakette CF49 review bir manifest suite'i olarak eklenebilir; bu adaya karıştırılmadı.
4. **Floor/ceiling değerleri CF49 öncesi (LOW).** Bir regresyonda bütün toplu metrikler sınır içinde kaldı. 12 vakanın korunması tamamen vaka-bazlı katılığa dayanır. Floor'lar yalnız yükselebilir; yükseltmek ayrı bir karardır.
5. **Kozmetik (LOW, onaylanan baytlara karıştırılmadı).** v3 kullanım başlığı hâlâ orijinal script adını yazıyor; VERSION_3 sonrasında fazladan bir boş satır var. Mevcut vault pin-drift kontrolü orijinal grader'ı artık kapsamaz; orijinal yine `AYAS_GOLDEN_VAULT_PINNED_FILES`, `BrainPatchSafety` ve manifest pini ile korunur.

## Ne kanıtlanmadı

- Bu bir Full166 değildir. 166'nın 34'ü koştu. Final HEAD'de bir kez Full166 gerekir.
- Hosted CI'da koşmadı.
- Canlı sistemde hiçbir şey değişmedi. Canlı inbox'taki önerilerin V2 vault digest'ine bağlı kanıtları V3 sonrası yeni değerlendirmede bayat sayılabilir; bu doğrulanmadı.

## Owner kararı

**ONAY** verilirse: aynı baytlar (patch digest'i yukarıda) gerçek branch'e tek yerel commit olarak uygulanır. Ardından TypeScript/ESLint, Graphify güncellemesi ve final HEAD'de bir kez Full166. Full166 bu 34 suite'i de kapsar; ayrıca tekrar koşulmaz. Push ayrı onaydır.

**RET** verilirse: v58 ve 3 preserved raw FAIL olduğu gibi kalır.
