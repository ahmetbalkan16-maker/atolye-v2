# ATOLYE_MASTER_ROADMAP.md

# Atölye V2 — Master Roadmap

Son Güncelleme:
2026-07-08

---

# Vizyon

Belge rolu:

Bu belge Atolye'nin uzun vadeli fazlarini ve ana sistemlerini tarif eder.

Nihai urun vizyonu icin VISION.md, projenin neden var oldugu icin PROJECT_PHILOSOPHY.md referans alinmalidir.

Ortak vizyon dili:

- Atolye kisisel AI produksiyon studyosudur.
- Ticari SaaS onceligi yoktur.
- Kullanici yonetmendir; Atolye produksiyon ekibidir.
- Uzun vadede kendi sunucusunda calisan Secure Remote Personal Studio olacaktir.

Atölye V2;

Türkçe öncelikli, yapay zekâ destekli kişisel içerik üretim stüdyosudur.

Uzun vadeli hedef;

Tek bir konu verildiğinde araştırmadan başlayarak, yayınlanmaya hazır profesyonel video üretebilen uçtan uca bir AI Production Studio oluşturmaktır.

Temel ilke:

> **En az hata ile en hızlı tamamlanan Atölye.**

---

# Temel Tasarım İlkeleri

* Modüler mimari
* Katmanlı yapı
* AI Provider bağımsızlığı
* Service tabanlı iş mantığı
* Manifest tabanlı pipeline
* Geriye dönük uyumluluk
* Önce mimari, sonra kod

---

# Üretim Pipeline'ı

Canonical uzun vadeli akis:

Tek konu -> Research -> Script -> Scene Planning -> Visual Production -> Animation -> Audio -> Video Editing -> Thumbnail -> SEO -> Publishing

Asagidaki mevcut modul isimleri, bu canonical akisin uygulamadaki karsiliklaridir.

Araştırma

↓

Senaryo

↓

Sahneler

↓

Görseller

↓

Animasyon

↓

Ses

↓

Thumbnail

↓

SEO

↓

Montaj

↓

YouTube

Bu pipeline Atölye'nin temel üretim hattıdır.

Yeni geliştirilecek tüm özellikler mümkün olduğunca bu yapı içerisine entegre edilmelidir.

---

# PHASE 1 — Foundation ✅

Durum:
Tamamlandı

İçerik:

* AI Router
* Provider Architecture
* Research Engine
* Script Engine
* Scene Engine
* Visual Engine
* Animation Engine
* Manifest System
* Project Manager
* Asset Pipeline
* Pipeline Status
* Animation Service
* Animation API

Amaç:

Sağlam ve sürdürülebilir temel mimari oluşturmak.

---

# PHASE 2 — Production Engine

Durum:
Devam Ediyor

Hedef:

Video üretim hattını tamamlamak.

Planlanan modüller:

* Animation Scene Regeneration
* Video Engine
* Video Timeline
* Video Provider
* Video Service
* Video Manifest
* Render Queue
* Render Job Management

Amaç:

Animasyonları gerçek video üretim sürecine dönüştürmek.

---

# PHASE 3 — Voice Engine

Planlanan modüller:

* Voice Service
* Voice Provider
* ElevenLabs
* OpenAI Voice
* Çoklu Voice Provider
* Narration Engine
* Voice Timeline
* Voice Manifest

Amaç:

Profesyonel anlatıcı sistemi oluşturmak.

---

# PHASE 4 — Assembly Engine

Planlanan modüller:

* Video Assembly
* Scene Merge
* Subtitle Engine
* Music Layer
* Sound Effects
* Export Manager

Amaç:

Tüm içerikleri tek video haline getirmek.

---

# PHASE 5 — Publishing

Planlanan modüller:

* Thumbnail Studio
* SEO Studio
* YouTube Studio
* Upload Manager
* Playlist Manager
* Schedule Manager

Amaç:

Videoyu doğrudan yayınlanabilir hale getirmek.

---

# PHASE 6 — Intelligence

Uzun vadeli hedef.

Planlanan sistemler:

## AI Director

Görevleri:

* Pipeline yönetmek
* Eksik adımları tespit etmek
* Sonraki görevi önermek
* Kalite kontrolü yapmak

---

## Knowledge Engine

Görevleri:

* Bilgi doğrulama
* Kaynak yönetimi
* Tarihsel analiz
* Olay ilişkileri
* Karakter ilişkileri
* Timeline yönetimi

---

## Historical Documentary Engine

Uzun vadeli vizyon.

Hedef:

Atölye'nin tarihi olayları yalnızca anlatması değil;

* anlaması,
* analiz etmesi,
* dramatize etmesi,
* sahnelere dönüştürmesi,
* haritalar oluşturması,
* savaş hareketlerini canlandırması,
* belgesel diliyle sunması.

---

## Production Memory

Gorevleri:

* Kullanici tercihlerini hatirlamak
* Basarili uretim kararlarini tekrar kullanmak
* Hata ve recovery gecmisinden ogrenmek
* Kisisel produksiyon stilini korumak

---

# PHASE 7 — Platform

Uzun vadeli Secure Remote Personal Studio hedefleri.

Planlanan sistemler:

* Güvenlik
* Authentication
* Authorization
* API Key Management
* HTTPS ve guvenli remote erisim
* Dosya gizliligi
* Kisisel yedekleme ve istege bagli sync
* Self Hosting
* Mobil Erişim
* Çoklu cihaz desteği
* Proje yedekleme
* Gelişmiş ayarlar

---

# Mimari İlkeler

Atölye;

Hiçbir zaman tek bir AI sağlayıcısına bağımlı olmayacaktır.

AI Router mimarisi korunacaktır.

Provider sistemi geliştirilmeye devam edecektir.

İş mantığı mümkün olduğunca Service katmanlarında tutulacaktır.

UI yalnızca kullanıcı etkileşimini yönetecektir.

---

# Kalite Standartları

Her sprint sonunda:

* TypeScript kontrolü
* Kod incelemesi
* Checkpoint güncellemesi
* Git commit
* Git push

tamamlanmalıdır.

---

# Başarı Kriteri

Atölye V2 başarıya ulaşmış sayılır;

Kullanıcı yalnızca bir konu girdiğinde sistemin:

Araştırma

↓

Senaryo

↓

Sahneler

↓

Görseller

↓

Animasyon

↓

Seslendirme

↓

Montaj

↓

Thumbnail

↓

SEO

↓

YouTube

süreçlerini tek bir üretim hattı içerisinde yönetebildiği zaman.

---

# Nihai Hedef

Atölye yalnızca bir AI uygulaması değildir.

Uzun vadede;

**kişisel AI destekli profesyonel içerik üretim stüdyosu**

olması hedeflenmektedir.

Tüm mimari kararlar bu vizyona hizmet etmelidir.
