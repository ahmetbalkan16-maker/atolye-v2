---
Document: AI_MEMORY.md
Version: 1.0.0
Status: Active
Priority: High
Owner: Atölye V2
Last Updated: 2026-07-08
---

# Atölye V2 — AI Memory

## Amaç

Bu belge Atölye V2 geliştirme sürecinde edinilen deneyimleri, önemli dersleri ve tekrar edilmemesi gereken hataları kayıt altında tutar.

Bu belge teknik kuralları içermez.

Teknik kurallar için:

ATOLYE_AI_RULES.md

referans alınmalıdır.

---

# AI MEMORY-001

## Önce Mimari

### Öğrenilen Ders

Koddan önce mimari planlandığında hata oranı ciddi şekilde azalıyor.

### Sonuç

Her geliştirme önce analiz ile başlamalıdır.

---

# AI MEMORY-002

## Küçük Adımlar

### Öğrenilen Ders

Büyük refactor'lar risk oluşturuyor.

### Sonuç

Küçük ve kontrollü geliştirmeler tercih edilmeli.

---

# AI MEMORY-003

## Geriye Dönük Uyumluluk

### Öğrenilen Ders

Yeni özellikler mevcut sistemi bozmadan eklenebiliyor.

### Sonuç

Backward Compatibility korunmalı.

---

# AI MEMORY-004

## Service Layer

### Öğrenilen Ders

Business Logic UI içerisine taşındığında kod tekrarları oluşuyor.

### Sonuç

İş mantığı Service katmanında tutulmalı.

---

# AI MEMORY-005

## Manifest

### Öğrenilen Ders

Manifest sistemi proje ilerlemesini takip etmeyi kolaylaştırıyor.

### Sonuç

Yeni üretim aşamaları mümkün olduğunca manifest sistemine entegre edilmeli.

---

# AI MEMORY-006

## Asset Versioning

### Öğrenilen Ders

Asset geçmişinin korunması geliştirme sırasında büyük avantaj sağlıyor.

### Sonuç

Append-only yaklaşımı korunmalı.

---

# AI MEMORY-007

## AI Router

### Öğrenilen Ders

Tek AI sağlayıcısına bağımlı olmak uzun vadede risk oluşturuyor.

### Sonuç

Provider sistemi korunmalı.

---

# AI MEMORY-008

## Sprint Disiplini

### Öğrenilen Ders

Aşağıdaki sıra en güvenli yöntem oldu.

Analiz

↓

Onay

↓

Kod

↓

Test

↓

Rapor

↓

Checkpoint

↓

Git

---

# AI MEMORY-009

## Git Güvenliği

### Öğrenilen Ders

Her anlamlı geliştirme güvenli bir commit ile kayıt altına alınmalıdır.

### Sonuç

Uzun süre commit almadan çalışılmamalıdır.

---

# AI MEMORY-010

## Token Yönetimi

### Öğrenilen Ders

Token azaldığında yeni geliştirmeye başlamak risk oluşturuyor.

### Sonuç

Token düşükse;

- analiz hazırlanır,
- dokümantasyon geliştirilir,
- kodlama sonraki oturuma bırakılır.

---

# AI MEMORY-011

## Dokümantasyon

### Öğrenilen Ders

İyi dokümantasyon yeni AI oturumlarının adapte olma süresini ciddi şekilde azaltıyor.

### Sonuç

Kod kadar dokümantasyon da güncel tutulmalı.

---

# AI MEMORY-012

## Atölye Bir Platformdur

### Öğrenilen Ders

Bağımsız özellikler yerine üretim hattına entegre edilen modüller daha sürdürülebilir oluyor.

### Sonuç

Yeni geliştirmeler mevcut pipeline'a entegre edilmelidir.

---

# AI MEMORY-013

## Kullanıcı Tercihi

### Öğrenilen Ders

Projenin temel hedefi:

**En az hata ile en hızlı tamamlanan Atölye**

olmalıdır.

Hız önemlidir.

Ancak kalite ve sürdürülebilirlik daha önemlidir.

---

# AI MEMORY-014

## Yeni AI Oturumu

### Öğrenilen Ders

Yeni bir AI doğrudan kod yazmaya başlamamalıdır.

### Sonuç

Önce şu belgeler okunmalıdır:

- README.md
- ATOLYE_CHECKPOINT.md
- ATOLYE_AI_RULES.md
- ATOLYE_CONTEXT.md
- ROADMAP.md

---

# AI MEMORY-015

## Sürekli İyileştirme

### Öğrenilen Ders

Kod kadar süreç de geliştirilebilir.

Daha iyi bir yöntem bulunduğunda;

önce değerlendirilmeli,

uygunsa dokümantasyona eklenmelidir.

---

# Yeni Memory Ekleme

Yeni önemli deneyimler bu belgeye sıradaki AI MEMORY numarası ile eklenmelidir.

Eski kayıtlar silinmemelidir.

Bu belge Atölye V2'nin kurumsal hafızasıdır.