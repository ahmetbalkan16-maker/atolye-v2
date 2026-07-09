# ATOLYE_MASTER_ROADMAP.md

# AtÃ¶lye V2 â€” Master Roadmap

Son GÃ¼ncelleme:
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

AtÃ¶lye V2;

TÃ¼rkÃ§e Ã¶ncelikli, yapay zekÃ¢ destekli kiÅŸisel iÃ§erik Ã¼retim stÃ¼dyosudur.

Uzun vadeli hedef;

Tek bir konu verildiÄŸinde araÅŸtÄ±rmadan baÅŸlayarak, yayÄ±nlanmaya hazÄ±r profesyonel video Ã¼retebilen uÃ§tan uca bir AI Production Studio oluÅŸturmaktÄ±r.

Temel ilke:

> **En az hata ile en hÄ±zlÄ± tamamlanan AtÃ¶lye.**

---

# Temel TasarÄ±m Ä°lkeleri

* ModÃ¼ler mimari
* KatmanlÄ± yapÄ±
* AI Provider baÄŸÄ±msÄ±zlÄ±ÄŸÄ±
* Service tabanlÄ± iÅŸ mantÄ±ÄŸÄ±
* Manifest tabanlÄ± pipeline
* Geriye dÃ¶nÃ¼k uyumluluk
* Ã–nce mimari, sonra kod

---

# Ãœretim Pipeline'Ä±

Canonical uzun vadeli akis:

Tek konu -> Research -> Script -> Scene Planning -> Visual Production -> Animation -> Audio -> Video Editing -> Thumbnail -> SEO -> Publishing

Asagidaki mevcut modul isimleri, bu canonical akisin uygulamadaki karsiliklaridir.

AraÅŸtÄ±rma

â†“

Senaryo

â†“

Sahneler

â†“

GÃ¶rseller

â†“

Animasyon

â†“

Ses

â†“

Thumbnail

â†“

SEO

â†“

Montaj

â†“

YouTube

Bu pipeline AtÃ¶lye'nin temel Ã¼retim hattÄ±dÄ±r.

Yeni geliÅŸtirilecek tÃ¼m Ã¶zellikler mÃ¼mkÃ¼n olduÄŸunca bu yapÄ± iÃ§erisine entegre edilmelidir.

---

# PHASE 1 â€” Foundation âœ…

Durum:
TamamlandÄ±

Ä°Ã§erik:

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

AmaÃ§:

SaÄŸlam ve sÃ¼rdÃ¼rÃ¼lebilir temel mimari oluÅŸturmak.

---

# PHASE 2 â€” Production Engine

Durum:
Devam Ediyor

Hedef:

Video Ã¼retim hattÄ±nÄ± tamamlamak.

Planlanan modÃ¼ller:

* Animation Scene Regeneration
* Video Engine
* Video Timeline
* Video Provider
* Video Service
* Video Manifest
* Render Queue
* Render Job Management

AmaÃ§:

AnimasyonlarÄ± gerÃ§ek video Ã¼retim sÃ¼recine dÃ¶nÃ¼ÅŸtÃ¼rmek.

---

# PHASE 3 â€” Voice Engine

Planlanan modÃ¼ller:

* Voice Service
* Voice Provider
* ElevenLabs
* OpenAI Voice
* Ã‡oklu Voice Provider
* Narration Engine
* Voice Timeline
* Voice Manifest

AmaÃ§:

Profesyonel anlatÄ±cÄ± sistemi oluÅŸturmak.

---

# PHASE 4 â€” Assembly Engine

Planlanan modÃ¼ller:

* Video Assembly
* Scene Merge
* Subtitle Engine
* Music Layer
* Sound Effects
* Export Manager

AmaÃ§:

TÃ¼m iÃ§erikleri tek video haline getirmek.

---

# PHASE 5 â€” Publishing

Planlanan modÃ¼ller:

* Thumbnail Studio
* SEO Studio
* YouTube Studio
* Upload Manager
* Playlist Manager
* Schedule Manager

AmaÃ§:

Videoyu doÄŸrudan yayÄ±nlanabilir hale getirmek.

---

# PHASE 6 â€” Intelligence

Uzun vadeli hedef.

Planlanan sistemler:

## AI Director

GÃ¶revleri:

* Pipeline yÃ¶netmek
* Eksik adÄ±mlarÄ± tespit etmek
* Sonraki gÃ¶revi Ã¶nermek
* Kalite kontrolÃ¼ yapmak

---

## Knowledge Engine

GÃ¶revleri:

* Bilgi doÄŸrulama
* Kaynak yÃ¶netimi
* Tarihsel analiz
* Olay iliÅŸkileri
* Karakter iliÅŸkileri
* Timeline yÃ¶netimi

---

## Historical Documentary Engine

Uzun vadeli vizyon.

Hedef:

AtÃ¶lye'nin tarihi olaylarÄ± yalnÄ±zca anlatmasÄ± deÄŸil;

* anlamasÄ±,
* analiz etmesi,
* dramatize etmesi,
* sahnelere dÃ¶nÃ¼ÅŸtÃ¼rmesi,
* haritalar oluÅŸturmasÄ±,
* savaÅŸ hareketlerini canlandÄ±rmasÄ±,
* belgesel diliyle sunmasÄ±.

---

## Production Memory

Gorevleri:

* Kullanici tercihlerini hatirlamak
* Basarili uretim kararlarini tekrar kullanmak
* Hata ve recovery gecmisinden ogrenmek
* Kisisel produksiyon stilini korumak

---

# PHASE 7 â€” Platform

Uzun vadeli Secure Remote Personal Studio hedefleri.

Planlanan sistemler:

* GÃ¼venlik
* Authentication
* Authorization
* API Key Management
* HTTPS ve guvenli remote erisim
* Dosya gizliligi
* Kisisel yedekleme ve istege bagli sync
* Self Hosting
* Mobil EriÅŸim
* Ã‡oklu cihaz desteÄŸi
* Proje yedekleme
* GeliÅŸmiÅŸ ayarlar

---

# Mimari Ä°lkeler

AtÃ¶lye;

HiÃ§bir zaman tek bir AI saÄŸlayÄ±cÄ±sÄ±na baÄŸÄ±mlÄ± olmayacaktÄ±r.

AI Router mimarisi korunacaktÄ±r.

Provider sistemi geliÅŸtirilmeye devam edecektir.

Ä°ÅŸ mantÄ±ÄŸÄ± mÃ¼mkÃ¼n olduÄŸunca Service katmanlarÄ±nda tutulacaktÄ±r.

UI yalnÄ±zca kullanÄ±cÄ± etkileÅŸimini yÃ¶netecektir.

---

# Kalite StandartlarÄ±

Her sprint sonunda:

* TypeScript kontrolÃ¼
* Kod incelemesi
* Checkpoint gÃ¼ncellemesi
* Git commit
* Git push

tamamlanmalÄ±dÄ±r.

---

# BaÅŸarÄ± Kriteri

AtÃ¶lye V2 baÅŸarÄ±ya ulaÅŸmÄ±ÅŸ sayÄ±lÄ±r;

KullanÄ±cÄ± yalnÄ±zca bir konu girdiÄŸinde sistemin:

AraÅŸtÄ±rma

â†“

Senaryo

â†“

Sahneler

â†“

GÃ¶rseller

â†“

Animasyon

â†“

Seslendirme

â†“

Montaj

â†“

Thumbnail

â†“

SEO

â†“

YouTube

sÃ¼reÃ§lerini tek bir Ã¼retim hattÄ± iÃ§erisinde yÃ¶netebildiÄŸi zaman.

---

# Nihai Hedef

AtÃ¶lye yalnÄ±zca bir AI uygulamasÄ± deÄŸildir.

Uzun vadede;

**kiÅŸisel AI destekli profesyonel iÃ§erik Ã¼retim stÃ¼dyosu**

olmasÄ± hedeflenmektedir.

TÃ¼m mimari kararlar bu vizyona hizmet etmelidir.
