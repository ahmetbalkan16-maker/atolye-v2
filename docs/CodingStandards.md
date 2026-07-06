# Atölye V2 - Coding Standards

## Amaç

Bu belge, Atölye V2 projesinde tüm geliştiricilerin (insan veya AI) uyması gereken kodlama standartlarını tanımlar.

---

# Genel Kurallar

- TypeScript kullanılacaktır.
- `any` tipi kullanılmayacaktır. Gerektiğinde `unknown` veya uygun interface tanımlanacaktır.
- Fonksiyonlar tek bir sorumluluğa sahip olacaktır (Single Responsibility Principle).
- Büyük dosyalar küçük modüllere ayrılacaktır.

---

# Klasör Yapısı

app/
→ Sayfalar ve API route'ları

src/components/
→ UI bileşenleri

src/lib/
→ İş mantığı (Business Logic)

src/types/
→ Ortak tip tanımları

data/projects/
→ JSON proje kayıtları

docs/
→ Teknik dokümantasyon

---

# İsimlendirme

## Component

PascalCase

Örnek:

StudioCard.tsx

ProjectCard.tsx

---

## Class

PascalCase

Örnek

ProjectManager

VisualEngine

ResearchEngine

---

## Fonksiyon

camelCase

Örnek

createProject()

generatePrompt()

saveResearch()

---

## Dosya

PascalCase

Component dosyaları

camelCase

Utility dosyaları

---

# API Kuralları

Her API aşağıdaki formatta cevap döndürmelidir.

Başarılı

```json
{
  "success": true,
  "data": {}
}
```

Hata

```json
{
  "success": false,
  "error": "Mesaj"
}
```

---

# TypeScript Kuralları

Interface kullanılacaktır.

Magic string kullanılmayacaktır.

Tekrarlayan tipler ortak dosyada tutulacaktır.

---

# React Kuralları

Component'ler küçük tutulacaktır.

Tek component tek iş yapacaktır.

State minimum seviyede tutulacaktır.

---

# Git

Her sprint sonunda:

git add .

git commit -m "Sprint XX - Açıklama"

git push

---

# Code Review

Her büyük değişiklikten sonra:

- Kod ChatGPT tarafından incelenecek.
- Mimari kontrol edilecek.
- Gerekirse refactor yapılacak.

---

# AI Kullanımı

ChatGPT

- Tech Lead
- Architecture
- Code Review

Codex

- Kod yazımı
- Refactor
- Component geliştirme
- API geliştirme

---

# Hedef

Kodun okunabilir, sürdürülebilir ve genişletilebilir olması.