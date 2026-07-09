---
Document: AI_MEMORY.md
Version: 1.0.0
Status: Active
Priority: High
Owner: AtÃ¶lye V2
Last Updated: 2026-07-08
---

# AtÃ¶lye V2 â€” AI Memory

## AmaÃ§

Bu belge AtÃ¶lye V2 geliÅŸtirme sÃ¼recinde edinilen deneyimleri, Ã¶nemli dersleri ve tekrar edilmemesi gereken hatalarÄ± kayÄ±t altÄ±nda tutar.

Bu belge teknik kurallarÄ± iÃ§ermez.

Teknik kurallar iÃ§in:

ATOLYE_AI_RULES.md

referans alÄ±nmalÄ±dÄ±r.

---

# AI MEMORY-001

## Ã–nce Mimari

### Ã–ÄŸrenilen Ders

Koddan Ã¶nce mimari planlandÄ±ÄŸÄ±nda hata oranÄ± ciddi ÅŸekilde azalÄ±yor.

### SonuÃ§

Her geliÅŸtirme Ã¶nce analiz ile baÅŸlamalÄ±dÄ±r.

---

# AI MEMORY-002

## KÃ¼Ã§Ã¼k AdÄ±mlar

### Ã–ÄŸrenilen Ders

BÃ¼yÃ¼k refactor'lar risk oluÅŸturuyor.

### SonuÃ§

KÃ¼Ã§Ã¼k ve kontrollÃ¼ geliÅŸtirmeler tercih edilmeli.

---

# AI MEMORY-003

## Geriye DÃ¶nÃ¼k Uyumluluk

### Ã–ÄŸrenilen Ders

Yeni Ã¶zellikler mevcut sistemi bozmadan eklenebiliyor.

### SonuÃ§

Backward Compatibility korunmalÄ±.

---

# AI MEMORY-004

## Service Layer

### Ã–ÄŸrenilen Ders

Business Logic UI iÃ§erisine taÅŸÄ±ndÄ±ÄŸÄ±nda kod tekrarlarÄ± oluÅŸuyor.

### SonuÃ§

Ä°ÅŸ mantÄ±ÄŸÄ± Service katmanÄ±nda tutulmalÄ±.

---

# AI MEMORY-005

## Manifest

### Ã–ÄŸrenilen Ders

Manifest sistemi proje ilerlemesini takip etmeyi kolaylaÅŸtÄ±rÄ±yor.

### SonuÃ§

Yeni Ã¼retim aÅŸamalarÄ± mÃ¼mkÃ¼n olduÄŸunca manifest sistemine entegre edilmeli.

---

# AI MEMORY-006

## Asset Versioning

### Ã–ÄŸrenilen Ders

Asset geÃ§miÅŸinin korunmasÄ± geliÅŸtirme sÄ±rasÄ±nda bÃ¼yÃ¼k avantaj saÄŸlÄ±yor.

### SonuÃ§

Append-only yaklaÅŸÄ±mÄ± korunmalÄ±.

---

# AI MEMORY-007

## AI Router

### Ã–ÄŸrenilen Ders

Tek AI saÄŸlayÄ±cÄ±sÄ±na baÄŸÄ±mlÄ± olmak uzun vadede risk oluÅŸturuyor.

### SonuÃ§

Provider sistemi korunmalÄ±.

---

# AI MEMORY-008

## Sprint Disiplini

### Ã–ÄŸrenilen Ders

AÅŸaÄŸÄ±daki sÄ±ra en gÃ¼venli yÃ¶ntem oldu.

Analiz

â†“

Onay

â†“

Kod

â†“

Test

â†“

Rapor

â†“

Checkpoint

â†“

Git

---

# AI MEMORY-009

## Git GÃ¼venliÄŸi

### Ã–ÄŸrenilen Ders

Her anlamlÄ± geliÅŸtirme gÃ¼venli bir commit ile kayÄ±t altÄ±na alÄ±nmalÄ±dÄ±r.

### SonuÃ§

Uzun sÃ¼re commit almadan Ã§alÄ±ÅŸÄ±lmamalÄ±dÄ±r.

---

# AI MEMORY-010

## Token YÃ¶netimi

### Ã–ÄŸrenilen Ders

Token azaldÄ±ÄŸÄ±nda yeni geliÅŸtirmeye baÅŸlamak risk oluÅŸturuyor.

### SonuÃ§

Token dÃ¼ÅŸÃ¼kse;

- analiz hazÄ±rlanÄ±r,
- dokÃ¼mantasyon geliÅŸtirilir,
- kodlama sonraki oturuma bÄ±rakÄ±lÄ±r.

---

# AI MEMORY-011

## DokÃ¼mantasyon

### Ã–ÄŸrenilen Ders

Ä°yi dokÃ¼mantasyon yeni AI oturumlarÄ±nÄ±n adapte olma sÃ¼resini ciddi ÅŸekilde azaltÄ±yor.

### SonuÃ§

Kod kadar dokÃ¼mantasyon da gÃ¼ncel tutulmalÄ±.

---

# AI MEMORY-012

## AtÃ¶lye Bir Platformdur

### Ã–ÄŸrenilen Ders

BaÄŸÄ±msÄ±z Ã¶zellikler yerine Ã¼retim hattÄ±na entegre edilen modÃ¼ller daha sÃ¼rdÃ¼rÃ¼lebilir oluyor.

### SonuÃ§

Yeni geliÅŸtirmeler mevcut pipeline'a entegre edilmelidir.

---

# AI MEMORY-013

## KullanÄ±cÄ± Tercihi

### Ã–ÄŸrenilen Ders

Projenin temel hedefi:

**En az hata ile en hÄ±zlÄ± tamamlanan AtÃ¶lye**

olmalÄ±dÄ±r.

HÄ±z Ã¶nemlidir.

Ancak kalite ve sÃ¼rdÃ¼rÃ¼lebilirlik daha Ã¶nemlidir.

---

# AI MEMORY-014

## Yeni AI Oturumu

### Ã–ÄŸrenilen Ders

Yeni bir AI doÄŸrudan kod yazmaya baÅŸlamamalÄ±dÄ±r.

### SonuÃ§

Ã–nce ÅŸu belgeler okunmalÄ±dÄ±r:

- README.md
- ATOLYE_CHECKPOINT.md
- ATOLYE_AI_RULES.md
- ATOLYE_CONTEXT.md
- ROADMAP.md

---

# AI MEMORY-015

## SÃ¼rekli Ä°yileÅŸtirme

### Ã–ÄŸrenilen Ders

Kod kadar sÃ¼reÃ§ de geliÅŸtirilebilir.

Daha iyi bir yÃ¶ntem bulunduÄŸunda;

Ã¶nce deÄŸerlendirilmeli,

uygunsa dokÃ¼mantasyona eklenmelidir.

---

# AI MEMORY-016

## Kisisel AI Produksiyon Studyosu

### Ogrenilen Ders

Atolye ticari SaaS oncelikli bir urun olarak degil, kullanicinin kendi sunucusunda calisan guvenli kisisel AI calisma arkadasi olarak dusunulmelidir.

Kullanici yonetmendir; Atolye produksiyon ekibidir.

### Sonuc

Her sprint VISION.md ve PROJECT_PHILOSOPHY.md belgelerindeki Personal AI Production Studio vizyonuna gore degerlendirilmelidir.

Korunacak uzun vadeli sistemler: AI Director, Historical Documentary Engine, Knowledge Engine, Production Memory, AI Provider Agnostic Architecture ve Secure Remote Personal Studio.

---

# Yeni Memory Ekleme

Yeni Ã¶nemli deneyimler bu belgeye sÄ±radaki AI MEMORY numarasÄ± ile eklenmelidir.

Eski kayÄ±tlar silinmemelidir.

Bu belge AtÃ¶lye V2'nin kurumsal hafÄ±zasÄ±dÄ±r.
