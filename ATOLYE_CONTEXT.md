---
Document: ATOLYE_CONTEXT.md
Version: 1.0.0
Status: Active
Priority: Critical
Owner: Atölye V2
Last Updated: 2026-07-08
---

# Atölye V2 — Project Context

## Amaç

Bu belge Atölye V2'nin amacı, vizyonu ve geliştirme felsefesini açıklar.

Teknik kurallar içermez.

Teknik kurallar için:

**ATOLYE_AI_RULES.md**

belgesi referans alınmalıdır.

---

# Atölye Nedir?

Belge rolu:

Bu belge Atolye'nin proje baglamini ve calisma felsefesini ozetler.

Nihai urun tarifi VISION.md belgesindedir. Projenin neden var oldugu PROJECT_PHILOSOPHY.md belgesinde, uzun vadeli fazlar ATOLYE_MASTER_ROADMAP.md belgesinde takip edilir.

Atölye V2;

Türkçe öncelikli,

Yapay zekâ destekli,

Kişisel içerik üretim stüdyosudur.

Temel amacı;

Profesyonel içerik üretim sürecini tek platform altında toplamaktır.

Buradaki platform ifadesi ticari SaaS onceligi anlamina gelmez. Atolye oncelikle kisisel, self-hosted ve guvenli remote erisim hedefleyen bir AI produksiyon studyosudur.

Kullanici yonetmendir; Atolye produksiyon ekibidir.

---

# Projenin Hedefi

Canonical uzun vadeli akis:

Tek konu -> Research -> Script -> Scene Planning -> Visual Production -> Animation -> Audio -> Video Editing -> Thumbnail -> SEO -> Publishing

Kullanıcı yalnızca bir konu girer.

Atölye ise;

Araştırır.

↓

Planlar.

↓

Senaryo oluşturur.

↓

Sahneleri üretir.

↓

Görseller oluşturur.

↓

Animasyon üretir.

↓

Ses üretir.

↓

Videoyu birleştirir.

↓

Thumbnail oluşturur.

↓

SEO üretir.

↓

YouTube yayınına hazır hale getirir.

---

# Kullanım Amacı

Bu proje;

öncelikle kişisel kullanım amacıyla geliştirilmektedir.

Ana hedef;

YouTube içerik üretimini hızlandırmak,

kaliteyi artırmak,

tekrarlayan işleri otomatikleştirmektir.

---

# İçerik Kapsamı

İlk odak alanı:

Tarih

Belgesel

Ancak mimari;

- Bilim
- Teknoloji
- Uzay
- Eğitim
- Gizem
- Kültür
- Sanat

gibi farklı içerik kategorilerini de destekleyecek şekilde tasarlanmıştır.

---

# Geliştirme Felsefesi

Her yeni özellik;

mevcut üretim hattına entegre edilmelidir.

Atölye;

bir özellik koleksiyonu değildir.

Tek bir üretim platformudur.

Bu ifade, cok kullanicili SaaS hedefinden cok entegre kisisel studyoyu anlatir.

---

# Mimari Yaklaşım

Atölye aşağıdaki prensiplere göre geliştirilmektedir.

- Modüler mimari
- Katmanlı yapı
- Service Layer
- AI Router
- Provider Architecture
- Manifest Pipeline
- Asset Versioning

Bu mimari uzun vadede korunmalıdır.

---

# AI Yaklaşımı

Atölye;

tek bir AI sağlayıcısına bağımlı olmayacaktır.

Desteklenmesi hedeflenen sağlayıcılar:

- OpenAI
- Gemini
- Claude
- OpenRouter
- Yerel modeller
- Gelecekte eklenecek diğer sistemler

AI Router bu esnekliği sağlamak için kullanılmaktadır.

---

# Manifest Yaklaşımı

Manifest;

projenin resmi üretim durumudur.

Yeni üretim aşamaları mümkün olduğunca manifest sistemine entegre edilmelidir.

---

# Asset Yaklaşımı

Asset sistemi append-only mantığıyla çalışır.

Eski üretimler korunur.

Yeni üretimler mevcut assetleri silmez.

Bu yaklaşım versiyon yönetimini mümkün kılar.

---

# Kullanıcı Deneyimi

Atölye;

teknik bir geliştirme aracı değil,

üretim odaklı bir stüdyo olmalıdır.

Kullanıcı mümkün olduğunca:

- az ayar yapmalı,
- az teknik detay görmeli,
- üretime odaklanmalıdır.

---

# Uzun Vadeli Vizyon

Atölye;

yalnızca video üreten bir sistem olmayacaktır.

Uzun vadede;

- AI Director
- Knowledge Engine
- Historical Documentary Engine
- Video Engine
- Voice Engine
- Publishing Studio

gibi modüllerle tam kapsamlı kişisel AI Production Studio haline gelecektir.

---

# Historical Documentary Engine

Bu proje için en önemli uzun vadeli vizyonlardan biridir.

Amaç;

Tarihi yalnızca anlatmak değil,

anlamak,

ilişkilendirmek,

haritalandırmak,

karakterleri analiz etmek,

olayları dramatize etmek,

ve profesyonel belgesel anlatımına dönüştürmektir.

---

# Platform Hedefi

Atölye;

ticari SaaS oncelikli bir platform olarak degil,

kullanicinin kendi sunucusunda calisan Secure Remote Personal Studio olarak konumlanir.

ileride

- Bilgisayar
- Telefon
- Tablet

üzerinden erişilebilen,

güvenli,

guvenli internet erisimli,

kişisel AI stüdyosu olacaktır.

---

# Temel İlke

Her yeni geliştirme şu soruya cevap vermelidir:

> Bu gelistirme Atolye'yi daha iyi bir kisisel AI produksiyon studyosu yapiyor mu?

Eğer cevap "hayır" ise,

özellik yeniden değerlendirilmelidir.

---

# Nihai Vizyon

Atölye;

bir sohbet uygulaması değildir.

Bir kod editörü değildir.

Bir video editörü değildir.

Atölye;

**kisisel AI destekli profesyonel icerik uretim studyosudur.**

Tüm mimari kararlar bu hedefe hizmet etmelidir.
