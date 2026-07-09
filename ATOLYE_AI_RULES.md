---
Document: ATOLYE_AI_RULES.md
Version: 1.0.0
Status: Active
Priority: Critical
Owner: AtÃ¶lye V2
Last Updated: 2026-07-08
---

# AtÃ¶lye V2 â€” AI Development Rules

## AmaÃ§

Bu belge AtÃ¶lye V2 geliÅŸtirilirken tÃ¼m AI araÃ§larÄ±nÄ±n uymasÄ± gereken resmi geliÅŸtirme kurallarÄ±nÄ± iÃ§erir.

Bu belge tavsiye niteliÄŸinde deÄŸildir.

MÃ¼mkÃ¼n olduÄŸu sÃ¼rece bu kurallar korunmalÄ±dÄ±r.

---

# Ã–ncelik SÄ±rasÄ±

Her yeni AI oturumunda aÅŸaÄŸÄ±daki belgeler okunmalÄ±dÄ±r.

1. README.md
2. PROJECT_PHILOSOPHY.md
3. VISION.md
4. ATOLYE_CHECKPOINT.md
5. ATOLYE_AI_RULES.md
6. ATOLYE_CONTEXT.md
7. ROADMAP.md

Bu belgeler okunmadan geliÅŸtirmeye baÅŸlanmamalÄ±dÄ±r.

---

# Temel Ä°lke

AtÃ¶lye'nin temel hedefi:

> **En az hata ile en hÄ±zlÄ± tamamlanan AtÃ¶lye.**

Urun pusulasi:

> Atolye kisisel AI produksiyon studyosudur. Kullanici yonetmendir; Atolye produksiyon ekibidir.

HÄ±z Ã¶nemlidir.

Ancak;

- mimari
- kalite
- sÃ¼rdÃ¼rÃ¼lebilirlik

her zaman Ã¶nceliklidir.

---

# Mimari KurallarÄ±

## Architecture First

Kod yazmadan Ã¶nce mevcut mimari analiz edilmelidir.

---

## ModÃ¼lerlik

Yeni Ã¶zellikler mevcut mimariye entegre edilmelidir.

BaÄŸÄ±msÄ±z sistemler oluÅŸturulmamalÄ±dÄ±r.

---

## Service Layer

Ä°ÅŸ mantÄ±ÄŸÄ± UI iÃ§erisine yazÄ±lmamalÄ±dÄ±r.

Business Logic;

- Service
- Manager
- Pipeline

katmanlarÄ±nda bulunmalÄ±dÄ±r.

---

## API

API katmanÄ± yalnÄ±zca orkestrasyon yapmalÄ±dÄ±r.

Ä°ÅŸ mantÄ±ÄŸÄ± mÃ¼mkÃ¼n olduÄŸunca Service katmanÄ±nda olmalÄ±dÄ±r.

---

## Provider Sistemi

Tek AI saÄŸlayÄ±cÄ±sÄ±na baÄŸÄ±mlÄ± kod yazÄ±lmamalÄ±dÄ±r.

AI Router korunmalÄ±dÄ±r.

Provider yapÄ±sÄ± bozulmamalÄ±dÄ±r.

---

# Kod KurallarÄ±

## TypeScript

Strict uyumluluk korunmalÄ±dÄ±r.

---

## Geriye DÃ¶nÃ¼k Uyumluluk

Ã‡alÄ±ÅŸan sistem bozulmamalÄ±dÄ±r.

Yeni Ã¶zellikler mevcut davranÄ±ÅŸÄ± deÄŸiÅŸtirmemelidir.

---

## Refactor

Gereksiz bÃ¼yÃ¼k refactor yapÄ±lmamalÄ±dÄ±r.

KÃ¼Ã§Ã¼k ve gÃ¼venli adÄ±mlar tercih edilmelidir.

---

## Dosya YapÄ±sÄ±

Sebepsiz yere dosya taÅŸÄ±nmamalÄ±dÄ±r.

Sebepsiz yere klasÃ¶r yapÄ±sÄ± deÄŸiÅŸtirilmemelidir.

---

# Manifest KurallarÄ±

Manifest;

projenin resmi durum kaynaÄŸÄ±dÄ±r.

Yeni pipeline aÅŸamalarÄ± mÃ¼mkÃ¼n olduÄŸunca manifest sistemine entegre edilmelidir.

---

# Asset KurallarÄ±

Asset sistemi append-only Ã§alÄ±ÅŸmalÄ±dÄ±r.

Eski assetler silinmemelidir.

Version mantÄ±ÄŸÄ± korunmalÄ±dÄ±r.

---

# Sprint KurallarÄ±

Her sprint aÅŸaÄŸÄ±daki sÄ±rayla ilerler.

1. Analiz
2. KullanÄ±cÄ± onayÄ±
3. Kodlama
4. Test
5. Rapor
6. Checkpoint
7. Git

Bu sÄ±ra mÃ¼mkÃ¼n olduÄŸunca korunmalÄ±dÄ±r.

---

# Test KurallarÄ±

Her sprint sonunda en az:

```bash
npx.cmd tsc --noEmit
```

Ã§alÄ±ÅŸtÄ±rÄ±lmalÄ±dÄ±r.

Test geÃ§meden sprint tamamlanmÄ±ÅŸ sayÄ±lmaz.

---

# Git KurallarÄ±

KullanÄ±cÄ± onayÄ± olmadan:

- Commit yapÄ±lmaz.
- Push yapÄ±lmaz.

Git iÅŸleminden Ã¶nce:

```bash
git status
```

kontrol edilmelidir.

Git iÅŸleminden sonra raporlanmalÄ±dÄ±r:

- Commit hash
- Push sonucu
- Working tree durumu

---

# Raporlama KurallarÄ±

Her geliÅŸtirme sonunda aÅŸaÄŸÄ±daki bilgiler verilmelidir.

- YapÄ±lan deÄŸiÅŸiklikler
- DeÄŸiÅŸen dosyalar
- Ã‡alÄ±ÅŸma mantÄ±ÄŸÄ±
- Test sonucu
- Riskler
- Sonraki Ã¶nerilen gÃ¶rev

---

# DokÃ¼mantasyon KurallarÄ±

Her Ã¶nemli geliÅŸtirme sonrasÄ± aÅŸaÄŸÄ±daki belgeler gÃ¶zden geÃ§irilmelidir.

- ATOLYE_CHECKPOINT.md
- ROADMAP.md
- CHANGELOG.md

Gerekiyorsa gÃ¼ncellenmelidir.

---

# AI DavranÄ±ÅŸ KurallarÄ±

AI aÅŸaÄŸÄ±daki davranÄ±ÅŸlarÄ± benimsemelidir.

- Ã–nce analiz yap.
- Gereksiz dosya deÄŸiÅŸtirme.
- Tamamlanan sprintleri tekrar yapma.
- Ã–nce mevcut kodu incele.
- Gereksiz baÄŸÄ±mlÄ±lÄ±k ekleme.
- Gereksiz mimari deÄŸiÅŸiklik Ã¶nerme.
- Her zaman mevcut sistemi koruyarak ilerle.

---

# Yasaklar

AÅŸaÄŸÄ±daki davranÄ±ÅŸlardan kaÃ§Ä±nÄ±lmalÄ±dÄ±r.

- BÃ¼yÃ¼k kapsamlÄ± plansÄ±z refactor
- Ã‡alÄ±ÅŸan sistemi bozacak deÄŸiÅŸiklikler
- KullanÄ±cÄ± onayÄ± olmadan Git iÅŸlemleri
- Tek AI saÄŸlayÄ±cÄ±sÄ±na baÄŸÄ±mlÄ± mimari
- Test yapÄ±lmadan sprint tamamlama

---

# BaÅŸarÄ± Kriteri

Her yeni geliÅŸtirme sonunda ÅŸu soru sorulmalÄ±dÄ±r:

> Bu gelistirme Atolye'yi daha iyi bir kisisel AI produksiyon studyosu yapiyor mu?

Cevap "evet" ise geliÅŸtirme doÄŸru yÃ¶ndedir.
