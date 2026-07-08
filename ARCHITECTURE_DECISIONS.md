---
Document: ARCHITECTURE_DECISIONS.md
Version: 1.0.0
Status: Active
Priority: High
Owner: Atölye V2
Last Updated: 2026-07-08
---

# Atölye V2 — Architecture Decision Records (ADR)

## Amaç

Bu belge Atölye V2 geliştirilirken alınan önemli mimari kararları kayıt altında tutar.

Kod değişebilir.

Sprintler değişebilir.

Ancak bu kararlar mümkün olduğunca korunmalıdır.

---

# ADR-001

## AI Router

### Karar

Provider seçimleri AI Router üzerinden yapılacaktır.

### Sebep

- Tek AI firmasına bağımlı olmamak
- Yeni provider ekleyebilmek
- Kod tekrarını önlemek

### Durum

Accepted

---

# ADR-002

## Provider Interface

### Karar

Tüm AI sistemleri ortak Provider interface'i kullanacaktır.

### Sebep

- Standart API
- Test kolaylığı
- Yeni AI ekleme kolaylığı

### Durum

Accepted

---

# ADR-003

## Service Layer

### Karar

Business Logic UI içerisine yazılmayacaktır.

### Sebep

Kod tekrarını önlemek.

Video Engine,

Mobile,

API,

CLI

aynı servisleri kullanabilmelidir.

---

# ADR-004

## Manifest

### Karar

Manifest projenin resmi durum bilgisidir.

### Sebep

Progress

Pipeline

Checkpoint

Resume

---

# ADR-005

## JSON Storage

### Karar

İlk sürüm JSON tabanlı olacaktır.

### Sebep

Hızlı geliştirme.

Kolay test.

Kolay backup.

---

# ADR-006

## Asset Versioning

### Karar

Asset sistemi append-only olacaktır.

### Sebep

Eski üretimleri korumak.

Versiyon karşılaştırması.

Rollback.

---

# ADR-007

## Architecture First

### Karar

Koddan önce mimari.

### Sebep

Hataları azaltmak.

Tekrar eden refactor ihtiyacını önlemek.

---

# ADR-008

## Incremental Development

### Karar

Küçük ama güvenli geliştirmeler.

### Sebep

Daha az risk.

Kolay test.

Kolay geri dönüş.

---

# ADR-009

## Backward Compatibility

### Karar

Yeni özellik eski davranışı bozmamalıdır.

### Sebep

Kararlılık.

---

# ADR-010

## Documentation First

### Karar

Kod kadar dokümantasyon da önemlidir.

### Sebep

Yeni AI

Yeni geliştirici

Yeni bilgisayar

için hızlı adaptasyon.

---

# ADR-011

## Manifest Pipeline

### Karar

Her üretim aşaması mümkün olduğunca Manifest'e entegre edilir.

### Sebep

Pipeline takibi.

---

# ADR-012

## AI Independence

### Karar

Hiçbir modül tek AI firmasına bağımlı olmayacaktır.

### Sebep

Esneklik.

Maliyet.

Geleceğe hazırlık.

---

# ADR-013

## Atölye Platformdur

### Karar

Atölye;

tek özellik geliştiren uygulama değildir.

### Sebep

Uzun vadeli büyüme.

Yeni modül entegrasyonu.

---

# Yeni ADR Ekleme

Yeni önemli mimari kararlar;

ADR numarası verilerek bu belgeye eklenmelidir.

Mevcut ADR'ler mümkün olduğunca değiştirilmemelidir.