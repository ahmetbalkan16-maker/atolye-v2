---
Document: ARCHITECTURE_DECISIONS.md
Version: 1.0.0
Status: Active
Priority: High
Owner: AtÃ¶lye V2
Last Updated: 2026-07-08
---

# AtÃ¶lye V2 â€” Architecture Decision Records (ADR)

## AmaÃ§

Bu belge AtÃ¶lye V2 geliÅŸtirilirken alÄ±nan Ã¶nemli mimari kararlarÄ± kayÄ±t altÄ±nda tutar.

Kod deÄŸiÅŸebilir.

Sprintler deÄŸiÅŸebilir.

Ancak bu kararlar mÃ¼mkÃ¼n olduÄŸunca korunmalÄ±dÄ±r.

---

# ADR-001

## AI Router

### Karar

Provider seÃ§imleri AI Router Ã¼zerinden yapÄ±lacaktÄ±r.

### Sebep

- Tek AI firmasÄ±na baÄŸÄ±mlÄ± olmamak
- Yeni provider ekleyebilmek
- Kod tekrarÄ±nÄ± Ã¶nlemek

### Durum

Accepted

---

# ADR-002

## Provider Interface

### Karar

TÃ¼m AI sistemleri ortak Provider interface'i kullanacaktÄ±r.

### Sebep

- Standart API
- Test kolaylÄ±ÄŸÄ±
- Yeni AI ekleme kolaylÄ±ÄŸÄ±

### Durum

Accepted

---

# ADR-003

## Service Layer

### Karar

Business Logic UI iÃ§erisine yazÄ±lmayacaktÄ±r.

### Sebep

Kod tekrarÄ±nÄ± Ã¶nlemek.

Video Engine,

Mobile,

API,

CLI

aynÄ± servisleri kullanabilmelidir.

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

Ä°lk sÃ¼rÃ¼m JSON tabanlÄ± olacaktÄ±r.

### Sebep

HÄ±zlÄ± geliÅŸtirme.

Kolay test.

Kolay backup.

---

# ADR-006

## Asset Versioning

### Karar

Asset sistemi append-only olacaktÄ±r.

### Sebep

Eski Ã¼retimleri korumak.

Versiyon karÅŸÄ±laÅŸtÄ±rmasÄ±.

Rollback.

---

# ADR-007

## Architecture First

### Karar

Koddan Ã¶nce mimari.

### Sebep

HatalarÄ± azaltmak.

Tekrar eden refactor ihtiyacÄ±nÄ± Ã¶nlemek.

---

# ADR-008

## Incremental Development

### Karar

KÃ¼Ã§Ã¼k ama gÃ¼venli geliÅŸtirmeler.

### Sebep

Daha az risk.

Kolay test.

Kolay geri dÃ¶nÃ¼ÅŸ.

---

# ADR-009

## Backward Compatibility

### Karar

Yeni Ã¶zellik eski davranÄ±ÅŸÄ± bozmamalÄ±dÄ±r.

### Sebep

KararlÄ±lÄ±k.

---

# ADR-010

## Documentation First

### Karar

Kod kadar dokÃ¼mantasyon da Ã¶nemlidir.

### Sebep

Yeni AI

Yeni geliÅŸtirici

Yeni bilgisayar

iÃ§in hÄ±zlÄ± adaptasyon.

---

# ADR-011

## Manifest Pipeline

### Karar

Her Ã¼retim aÅŸamasÄ± mÃ¼mkÃ¼n olduÄŸunca Manifest'e entegre edilir.

### Sebep

Pipeline takibi.

---

# ADR-012

## AI Independence

### Karar

HiÃ§bir modÃ¼l tek AI firmasÄ±na baÄŸÄ±mlÄ± olmayacaktÄ±r.

### Sebep

Esneklik.

Maliyet.

GeleceÄŸe hazÄ±rlÄ±k.

---

# ADR-013

## AtÃ¶lye Platformdur

### Karar

AtÃ¶lye;

tek Ã¶zellik geliÅŸtiren uygulama deÄŸildir.

### Sebep

Uzun vadeli bÃ¼yÃ¼me.

Yeni modÃ¼l entegrasyonu.

---

# ADR-014

## Personal AI Production Studio

### Karar

Atolye ticari SaaS oncelikli bir urun olarak degil, kisisel AI produksiyon studyosu olarak gelistirilecektir.

Kullanici yonetmen, Atolye produksiyon ekibi rolundedir.

### Sebep

Urun kararlarinin cok kullanicili SaaS karmasasi yerine kisisel uretim hizi, dosya kontrolu, guvenlik ve tamamlanabilir pipeline uzerinden alinmasi.

### Durum

Accepted

---

# ADR-015

## Secure Remote Personal Studio

### Karar

Atolye uzun vadede kullanicinin kendi sunucusunda calisan, HTTPS ve guvenli login ile internet uzerinden erisilebilen kisisel studyoyu hedefler.

### Sebep

Proje dosyalari, API key bilgileri, production memory ve yayin paketleri kullanicinin kontrolunde ve gizli kalmalidir.

### Durum

Accepted

---

# Yeni ADR Ekleme

Yeni Ã¶nemli mimari kararlar;

ADR numarasÄ± verilerek bu belgeye eklenmelidir.

Mevcut ADR'ler mÃ¼mkÃ¼n olduÄŸunca deÄŸiÅŸtirilmemelidir.
