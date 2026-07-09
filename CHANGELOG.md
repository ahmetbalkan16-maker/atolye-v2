---
Document: CHANGELOG.md
Version: 1.0.0
Status: Active
Priority: Medium
Owner: Atölye V2
Last Updated: 2026-07-09
---

# Atölye V2 — Changelog

## Amaç

Bu belge Atölye V2'nin önemli geliştirme kilometre taşlarını kronolojik olarak kayıt altında tutar.

Bu belge gelecek planlarını içermez.

Gelecek geliştirmeler için:

ROADMAP.md

referans alınmalıdır.

---

# Version 1.x

## 2026-07

### Foundation

Tamamlandı

- AI Router
- Provider Architecture
- Project Manager
- Manifest System
- Asset Pipeline
- Progress System

---

### Research Engine

Tamamlandı

- Research API
- AI Integration
- JSON Storage
- Project Save

---

### Script Engine

Tamamlandı

- Script Generator
- AI Provider Integration
- Pipeline Connection

---

### Scene Engine

Tamamlandı

- Scene Generator
- Scene Mapping
- Scene Storage

---

### Visual Engine

Tamamlandı

- Visual Prompt Generator
- Asset Generation
- Provider Router

---

### Animation Engine

Tamamlandı

- Animation Prompt Builder
- Animation Prompt Generator
- Animation API
- Animation Service
- Animation UI
- Animation Manifest
- Animation Asset Pipeline

---

### Animation Scene-Level Regeneration

Tamamlandı

- Tek sahne animation regenerate akışı eklendi
- animation.json merge mantığı ile korunur hale getirildi
- Yeni animation asset outputAssetId ile ilgili sahneye bağlandı
- Animasyon kartlarında Yeniden Üret aksiyonu aktif edildi

---

### Video Engine Foundation

Tamamlandı

- Video type modeli eklendi
- Mock video provider mimarisi kuruldu
- Video pipeline ve service katmanı eklendi
- Aktif animation assetlerinden mock video üretimi eklendi
- video.json ve append-only video asset kaydı eklendi
- Manifest ve progress sırasına video aşaması eklendi

---

### Audio Engine Foundation

Tamamlandı

- Audio type modeli aktif asset alanlarıyla genişletildi
- Mock audio provider mimarisi kuruldu
- Audio pipeline ve service katmanı eklendi
- Mevcut audio plan üretimi korunarak mock audio asset üretimi eklendi
- audio.json ve append-only audio asset kaydı eklendi
- Audio paneline minimal Ses Üret aksiyonu eklendi

---

### Assembly Engine Foundation

Tamamlandı

- Assembly modeli final production package alanlarıyla genişletildi
- Video, audio ve animation aktif asset referansları assembly.json içine bağlandı
- Assembly API tüm proje üretim çıktılarını okuyacak şekilde genişletildi
- Kurgu paneline minimal Kurgu paketi oluştur aksiyonu eklendi
- Progress sırasında assembly audio sonrasına taşındı

---

### Final Pipeline Integration

Tamamlandı

- PipelineRunner tam üretim orchestrator'üne dönüştürüldü.
- Research → Export uçtan uca üretim hattı tamamlandı.
- Stage bazlı orchestration eklendi.
- Manifest ve progress senkronizasyonu güçlendirildi.
- Hata yönetimi iyileştirildi.
- Mock-first mimarisi korunarak mevcut engine'ler entegre edildi.

---

### AI Reliability & Observability Foundation

Tamamlandi

- AI cagri usage metadata modeli eklendi.
- Proje bazli append-only ai-usage.json kaydi eklendi.
- Provider, model, sure, fallback, hata ve prompt/response boyutu metadata olarak izlenebilir hale getirildi.
- Prompt ve response icerigi kaydedilmeden guvenli observability temeli kuruldu.
- Text AI manager cagrilari observed request helper uzerinden gecirildi.
- PipelineRunner AI cagrilarina projectSlug/stage context aktarmaya basladi.

---

### Usage Viewer / AI Diagnostics Panel

Tamamlandi

- AI usage kayitlari icin read-only public okuma metodu eklendi.
- GET /api/projects/[slug]/ai-usage endpoint'i eklendi.
- Proje workspace icinde AI Diagnostics paneli eklendi.
- Panel son AI usage kayitlarini stage, operation, provider, model, status, fallback, duration ve createdAt alanlariyla gosterir hale getirildi.
- PipelineRunner ve AI cagri davranisi degistirilmeden observability gorunurlugu saglandi.

---

### AI Usage Diagnostics Summary

Tamamlandi

- AI Diagnostics paneline toplam AI cagrisi, success, fallback ve failed summary kartlari eklendi.
- Ortalama sure ve son AI cagrisi zamani read-only usage kayitlarindan hesaplanir hale getirildi.
- Provider dagilimi kompakt metin olarak gosterildi.
- Mevcut son 20 kayit tablosu ve API contract korunarak UI okunabilirligi artirildi.

---

### AI Usage Filters & Diagnostics Search

Tamamlandi

- AI Diagnostics paneline stage, provider ve status filtreleri eklendi.
- Operation, stage, provider, model ve status alanlarinda basit text search eklendi.
- Summary metrikleri filtrelenmis kayitlar uzerinden hesaplanir hale getirildi.
- Mevcut son 20 kayit tablosu, API contract ve read-only davranis korundu.

---
### Studio

Tamamlandı

- Dashboard
- Project Workspace
- Pipeline Status
- Asset Gallery

---

### Documentation

Eklendi

- README.md
- ATOLYE_CHECKPOINT.md
- ATOLYE_AI_RULES.md
- ATOLYE_CONTEXT.md
- ROADMAP.md
- ATOLYE_MASTER_ROADMAP.md
- ARCHITECTURE_DECISIONS.md
- CHANGELOG.md
- AI_MEMORY.md

---

# Version History

## v1.0

İlk büyük mimari tamamlandı.

Foundation katmanı hazır.

Animation sistemi hazır.

Manifest sistemi hazır.

Pipeline sistemi hazır.

Atölye artık Video Engine geliştirme aşamasına geçmeye hazırdır.
