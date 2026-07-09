# Atolye V2 - Sprint Template

Bu belge Atolye V2 sprintlerinin analiz, uygulama, test, dokumantasyon ve git kapanis standardidir.

Her sprintte mevcut mimari korunur, mock-first yaklasimi bozulmaz ve gereksiz refactor yapilmaz.

---

## 1. Sprint Analiz Sirasi

Sprint baslamadan once asagidaki belgeler okunur:

1. README.md
2. ATOLYE_CHECKPOINT.md
3. ATOLYE_AI_RULES.md
4. ROADMAP.md
5. CHANGELOG.md

Ardindan sprintin etkileyecegi mevcut kod mimarisi incelenir.

Analiz raporunda en az sunlar bulunur:

- Mevcut mimari
- Sprint icin gerekli degisiklikler
- Degisecek dosyalar
- Riskler
- Uygulama plani

Kod yazmaya analiz tamamlandiktan sonra gecilir.

---

## 2. Kodlama Kurallari

- Mevcut mimari bozulmaz.
- Mock-first yaklasimi korunur.
- Yeni provider veya servis davranisi varsayilan olarak gercek API cagirmamalidir.
- Buyuk refactor yapilmaz.
- Gereksiz bagimlilik eklenmez.
- API katmani yalnizca orchestration yapar.
- Business logic service, manager, engine veya pipeline katmaninda tutulur.
- Manifest ve progress senkronizasyonu korunur.
- Hata durumlari kontrollu yonetilir.
- Geriye donuk uyumluluk bozulmaz.

---

## 3. Test Komutu

Her sprint sonunda mutlaka su komut calistirilir:

```bash
npx.cmd tsc --noEmit --incremental false
```

Bu komut basarisizsa sprint tamamlanmis sayilmaz.

---

## 4. Dokumantasyon Guncelleme Zorunlulugu

Her sprint sonunda commit/push yapilmadan once su dosyalar gozden gecirilecek ve gerekiyorsa guncellenecektir:

- ATOLYE_CHECKPOINT.md
- ROADMAP.md
- CHANGELOG.md

Guncellenecek alanlar:

- Aktif Sprint
- Tamamlanan Sprint
- Son Commit
- Last Updated
- Sprint ozeti
- Bir sonraki gorev
- Roadmap durumu
- Changelog kaydi

Kod ve dokumantasyon ayni sprint commit'i icinde birlikte kayit altina alinmalidir.

---

## 5. Git Oncesi Kontrol

Commit oncesi mutlaka calistirilir:

```bash
git diff --stat
git status
```

Beklenmeyen dosya degisikligi varsa durulur ve kullaniciya bildirilir.

---

## 6. Git Commit / Push Akisi

Kullanici onayi olmadan commit veya push yapilmaz.

Kullanici onayi geldikten sonra:

```bash
git add .
git commit -m "<uygun conventional commit mesaji>"
git push
```

Commit sonrasinda commit hash ve push sonucu raporlanir.

---

## 7. Son Rapor Formati

Sprint kapanis raporu yalnizca su bilgileri icermelidir:

- Sprint numarasi
- Yapilan gelistirme
- Guncellenen .md dosyalari
- Test sonucu
- Commit hash
- Push sonucu
- Son git status
