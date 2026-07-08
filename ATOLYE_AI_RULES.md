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
2. ATOLYE_CHECKPOINT.md
3. ATOLYE_AI_RULES.md
4. ATOLYE_CONTEXT.md
5. ROADMAP.md

Bu belgeler okunmadan geliştirmeye başlanmamalıdır.

---

# Temel İlke

Atölye'nin temel hedefi:

> **En az hata ile en hızlı tamamlanan Atölye.**

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

> Bu değişiklik Atölye'yi daha sağlam, daha sürdürülebilir ve daha profesyonel hale getiriyor mu?

Cevap "evet" ise geliştirme doğru yöndedir.