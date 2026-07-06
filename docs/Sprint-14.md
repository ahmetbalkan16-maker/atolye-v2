# Sprint 14 — Project Workspace

## Sprint Durumu

🚧 In Progress

---

# Amaç

Atölye'nin tek proje mantığından çıkarılıp çoklu proje mimarisine hazırlanması.

Her proje bağımsız olarak:

- Research
- Script
- Scenes
- Visuals
- Animation
- Voice
- YouTube

verilerini saklayabilmelidir.

---

# Bu Sprintte Yapılacaklar

## 1. ProjectManager V2

Sorumluluklar

- createProject()
- getProject()
- updateProject()
- updateStatus()
- getProjects()

---

## 2. ProjectReader

JSON okuma işlemleri

---

## 3. ProjectWriter

JSON yazma işlemleri

---

## 4. Dashboard

Dashboard gerçek proje listesini gösterecek.

---

## 5. Studio

Studio aktif projeyi gösterecek.

---

# Değişecek Dosyalar

src/lib/projects/

ProjectManager.ts

ProjectReader.ts

ProjectWriter.ts

getProjects.ts

---

src/types/

project.ts

---

app/api/

projects/

---

components/

Dashboard

ProjectCard

StudioSidebar

---

# Kabul Kriterleri

Yeni proje oluşturulabiliyor.

JSON dosyası oluşuyor.

Dashboard'da listeleniyor.

Status güncelleniyor.

updatedAt değişiyor.

Hiçbir mevcut özellik bozulmuyor.

---

# Test Senaryoları

## Test 1

Yeni proje oluştur.

Beklenen:

project.json oluşmalı.

---

## Test 2

Research kaydet.

Beklenen:

research.json oluşmalı.

---

## Test 3

Status değiştir.

Beklenen:

project.json güncellenmeli.

---

## Test 4

Dashboard aç.

Beklenen:

Projeler listelenmeli.

---

# Sprint Sonu

Git Commit

Sprint 14 - Project Workspace