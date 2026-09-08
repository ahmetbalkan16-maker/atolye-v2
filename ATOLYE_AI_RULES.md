---
Document: ATOLYE_AI_RULES.md
Version: 1.0.0
Status: Active
Priority: Critical
Owner: Atölye V2
Last Updated: 2026-07-08
---

# Atölye V2 — AI Development Rules

## Amaç

Bu belge Atölye V2 geliştirilirken tüm AI araçlarının uyması gereken resmi geliştirme kurallarını içerir.

Bu belge tavsiye niteliğinde değildir.

Mümkün olduğu sürece bu kurallar korunmalıdır.

---

# Öncelik Sırası

Her yeni AI oturumunda aşağıdaki belgeler okunmalıdır.

1. README.md
2. PROJECT_PHILOSOPHY.md
3. VISION.md
4. ATOLYE_CHECKPOINT.md
5. ATOLYE_AI_RULES.md
6. ATOLYE_CONTEXT.md
7. ROADMAP.md

Bu belgeler okunmadan geliştirmeye başlanmamalıdır.

---

# Temel İlke

Atölye'nin temel hedefi:

> **En az hata ile en hızlı tamamlanan Atölye.**

Urun pusulasi:

> Atolye kisisel AI produksiyon studyosudur. Kullanici yonetmendir; Atolye produksiyon ekibidir.

Hız önemlidir.

Ancak;

- mimari
- kalite
- sürdürülebilirlik

her zaman önceliklidir.

---

# Mimari Kuralları

## Architecture First

Kod yazmadan önce mevcut mimari analiz edilmelidir.

---

## Modülerlik

Yeni özellikler mevcut mimariye entegre edilmelidir.

Bağımsız sistemler oluşturulmamalıdır.

---

## Service Layer

İş mantığı UI içerisine yazılmamalıdır.

Business Logic;

- Service
- Manager
- Pipeline

katmanlarında bulunmalıdır.

---

## API

API katmanı yalnızca orkestrasyon yapmalıdır.

İş mantığı mümkün olduğunca Service katmanında olmalıdır.

---

## Provider Sistemi

Tek AI sağlayıcısına bağımlı kod yazılmamalıdır.

AI Router korunmalıdır.

Provider yapısı bozulmamalıdır.

---

# Kod Kuralları

## TypeScript

Strict uyumluluk korunmalıdır.

---

## Geriye Dönük Uyumluluk

Çalışan sistem bozulmamalıdır.

Yeni özellikler mevcut davranışı değiştirmemelidir.

---

## Refactor

Gereksiz büyük refactor yapılmamalıdır.

Küçük ve güvenli adımlar tercih edilmelidir.

---

## Dosya Yapısı

Sebepsiz yere dosya taşınmamalıdır.

Sebepsiz yere klasör yapısı değiştirilmemelidir.

---

# Manifest Kuralları

Manifest;

projenin resmi durum kaynağıdır.

Yeni pipeline aşamaları mümkün olduğunca manifest sistemine entegre edilmelidir.

---

# Asset Kuralları

Asset sistemi append-only çalışmalıdır.

Eski assetler silinmemelidir.

Version mantığı korunmalıdır.

---

# Sprint Kuralları

Her sprint aşağıdaki sırayla ilerler.

1. Analiz
2. Kullanıcı onayı
3. Kodlama
4. Test
5. Rapor
6. Checkpoint
7. Git

Bu sıra mümkün olduğunca korunmalıdır.

---

# Graphify Sprint Protokolü

Graphify / Claude üzerinden yürütülen **her** sprint bu kapılardan sırayla geçer.
Bir kapı başarısızsa sonraki kapıya geçilmez; sprint `SPRINT = NOT READY` olarak
raporlanır ve sorun çözülene kadar devam edilir. "Sprint tamamlandı" ancak
tüm kapılar geçince söylenir.

```
INSPECT → PLAN → IMPLEMENT → TEST → AUDIT → CLEAN → COMMIT → FINAL VERIFY
```

## 1. INSPECT — implementasyondan önce zorunlu

```bash
git status --short
git branch --show-current
git log -5 --oneline
git diff
git diff --cached
```

Başlangıç durumu raporlanmadan koda başlanmaz. Kullanıcının mevcut değişiklikleri
**asla** ezilmez. Önce mevcut mimari taranır — tamamlanmış bir işi yeniden yapma.

## 2. PLAN

En güvenli, en küçük, geriye dönük uyumlu çözüm seçilir. Büyük plansız refactor
yok. İkinci bir orchestrator / provider router / storage root açma.

## 3. IMPLEMENT

Yalnız gerekli minimum değişiklik. Her yeni dosya için gerekçe: _neden gerekli,
nerede kullanılıyor, kalıcı mı, Git'te mi durmalı, runtime mı?_ Runtime /
generated / user data **kaynak repoya yazılmaz** (bkz. `docs/PROJECT_STORAGE.md`).

## 4. TEST

```bash
npx tsc --noEmit          # 0 error
npx eslint .              # 0 error, baseline warning korunur
```

- İlgili tüm Brain/AYAS smoke suite'leri.
- Değişen `src/lib/...` dosyası için `grep scripts/` ile ilgili smoke'lar.
- Yeni davranış için yeni/genişletilmiş smoke; regresyon testi.
- Storage'a dokunulduysa `npx tsx scripts/smoke-project-storage-hygiene.ts`.

## 5. AUDIT — Graphify kendine sorar

**CODE:** Eski storage path'i / hardcoded proje yolu / duplicate helper /
kullanılmayan import kaldı mı?
**DATA:** Runtime data repoya yazılıyor mu? Generated artifact / temp dosya /
untracked kullanıcı verisi oluştu mu?
**SECURITY:** Path traversal / arbitrary FS write / external root dışına çıkış
mümkün mü?
**TEST:** Yeni davranış test edildi mi? Regression var mı? Mevcut smoke'lar
geçiyor mu?
**GIT:** `git status --short`, `git diff`, `git diff --cached` — üçü de beklenen
temiz durumu gösteriyor mu?

## 6. CLEAN — repo hijyeni zorunlu

Sprint sonunda `git status --short` **boş** olmalı. Yeni oluşan runtime data /
proje dosyası / medya / pipeline çıktısı / temp / test artifact / log / lock /
cache Git çalışma ağacını kirletmez. Ancak **gerçek source-code değişikliği
gizlenmez veya blanket ignore ile örtülmez**.

Her artık dosya şu sınıflara ayrılır:
`SOURCE · CONFIG · TEST · DOCUMENTATION · RUNTIME · GENERATED · TEMPORARY · USER DATA`

### Silinebilir (kesin doğrulama ile)
abandoned draft · test artifact · diagnostic artifact · temporary output · cache
· lock · generated disposable data

### Silinemez (açık doğrulama olmadan)
gerçek kullanıcı projesi · medya · production output · tracked milestone ·
canonical source · kullanıcı tarafından oluşturulan veri

Şüpheli dosya → **SİLME, RAPORLA.** `git reset --hard` / `git clean -fdx`
sınıflandırma bitmeden kullanılmaz.

## 7. COMMIT

Kullanıcı onayı olmadan commit/push yok — **istisna:** kullanıcı açıkça commit
istediğinde. Push her zaman ayrı onay ister. Mantıklı, açık mesajlı commit(ler);
gereksiz commit üretme. `data/projects/**` runtime verisi, CRLF gürültüsü ve
generated artifact commit'e dahil edilmez.

## 8. FINAL VERIFY + RAPOR

```bash
git status --short        # boş
git diff                  # boş
git diff --cached         # boş
git status --ignored --short
git log -1 --oneline
```

Rapor: değişen/yeni dosyalar · çalışma mantığı · test sonuçları (tsc/eslint/smoke)
· riskler · commit hash(ler)i · working tree durumu · push yapıldı mı ·
sonraki önerilen adım. Kapılardan biri geçilmediyse `SPRINT = NOT READY` +
gerekçe.

---

# Test Kuralları

Her sprint sonunda en az:

```bash
npx.cmd tsc --noEmit
```

çalıştırılmalıdır.

Test geçmeden sprint tamamlanmış sayılmaz.

---

# Git Kuralları

Kullanıcı onayı olmadan:

- Commit yapılmaz.
- Push yapılmaz.

Git işleminden önce:

```bash
git status
```

kontrol edilmelidir.

Git işleminden sonra raporlanmalıdır:

- Commit hash
- Push sonucu
- Working tree durumu

---

# Raporlama Kuralları

Her geliştirme sonunda aşağıdaki bilgiler verilmelidir.

- Yapılan değişiklikler
- Değişen dosyalar
- Çalışma mantığı
- Test sonucu
- Riskler
- Sonraki önerilen görev

---

# Dokümantasyon Kuralları

Her önemli geliştirme sonrası aşağıdaki belgeler gözden geçirilmelidir.

- ATOLYE_CHECKPOINT.md
- ROADMAP.md
- CHANGELOG.md

Gerekiyorsa güncellenmelidir.

---

# AI Davranış Kuralları

AI aşağıdaki davranışları benimsemelidir.

- Önce analiz yap.
- Gereksiz dosya değiştirme.
- Tamamlanan sprintleri tekrar yapma.
- Önce mevcut kodu incele.
- Gereksiz bağımlılık ekleme.
- Gereksiz mimari değişiklik önerme.
- Her zaman mevcut sistemi koruyarak ilerle.

---

# Yasaklar

Aşağıdaki davranışlardan kaçınılmalıdır.

- Büyük kapsamlı plansız refactor
- Çalışan sistemi bozacak değişiklikler
- Kullanıcı onayı olmadan Git işlemleri
- Tek AI sağlayıcısına bağımlı mimari
- Test yapılmadan sprint tamamlama

---

# Başarı Kriteri

Her yeni geliştirme sonunda şu soru sorulmalıdır:

> Bu gelistirme Atolye'yi daha iyi bir kisisel AI produksiyon studyosu yapiyor mu?

Cevap "evet" ise geliştirme doğru yöndedir.
