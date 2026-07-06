# Atölye V2 - Architecture Decisions

Bu belge, Atölye V2 geliştirilirken alınan önemli teknik kararları kayıt altına alır.

---

# ADR-001

## Konu

JSON tabanlı proje depolama

## Tarih

2026-07-06

## Karar

Projeler başlangıç aşamasında JSON dosyaları olarak saklanacaktır.

Her proje kendi klasörüne sahip olacaktır.

Örnek:

data/projects/

attila/

project.json

research.json

script.json

scenes.json

visuals.json

animation.json

voice.json

youtube.json

## Sebep

- Kurulumu kolaydır.
- Hızlı geliştirme sağlar.
- Debug işlemleri kolaydır.
- Git ile versiyon takibi yapılabilir.

## Gelecek

Project Storage katmanı sayesinde ileride SQLite veya PostgreSQL'e geçilecektir.

---

# ADR-002

## Konu

Tek AI modeline bağlı kalmamak

## Tarih

2026-07-06

## Karar

Atölye tek bir AI sağlayıcısına bağımlı olmayacaktır.

AI Orchestrator katmanı oluşturulacaktır.

Desteklenecek sağlayıcılar:

- OpenAI
- Gemini
- Claude
- Grok
- OpenRouter

## Sebep

- Daha kaliteli sonuç
- Maliyet optimizasyonu
- Gelecekte model değiştirebilme

---

# ADR-003

## Konu

Studio mimarisi

## Tarih

2026-07-06

## Karar

Tüm üretim modülleri ortak Studio Layout kullanacaktır.

Modüller

- Research Studio
- Script Studio
- Scene Studio
- Visual Studio
- Animation Studio
- Voice Studio
- YouTube Studio

## Sebep

- Tutarlı kullanıcı deneyimi
- Tek tip arayüz
- Daha kolay bakım

---

# ADR-004

## Konu

Sprint tabanlı geliştirme

## Tarih

2026-07-06

## Karar

Her geliştirme Sprint mantığıyla yapılacaktır.

Her Sprint için:

- Plan
- Mimari
- Kod
- Test
- Git Checkpoint

zorunludur.

## Sebep

- Düzenli ilerleme
- Daha az hata
- Kolay geri dönüş

---

# ADR-005

## Konu

ChatGPT + Codex çalışma modeli

## Tarih

2026-07-06

## Karar

Geliştirme süreci iki yapay zekâ ile yürütülecektir.

ChatGPT

- Tech Lead
- Software Architect
- Sprint Planning
- Code Review
- Roadmap
- Architecture

Codex

- Kod geliştirme
- Refactor
- Component geliştirme
- API geliştirme
- Test desteği

## Sebep

- Daha yüksek geliştirme hızı
- Daha iyi kod kalitesi
- Mimari bütünlüğün korunması

---

# ADR-006

## Konu

Atölye'nin uzun vadeli hedefi

## Tarih

2026-07-06

## Karar

Atölye, araştırmadan YouTube yayınına kadar tüm içerik üretim sürecini yöneten kişisel AI Documentary Studio olacaktır.

Pipeline

Research

↓

Script

↓

Scenes

↓

Visuals

↓

Animation

↓

Voice

↓

YouTube

## Nihai Hedef

Tek ekrandan yönetilen profesyonel AI içerik üretim platformu.