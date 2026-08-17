# AGENTS.md

# Atölye V2 AI Agent Guide

Bu proje profesyonel bir AI destekli içerik üretim stüdyosudur.

Her AI aşağıdaki sırayla hareket etmelidir.

---

## Başlangıç

İlk okunacak belgeler:

1. README.md
2. ATOLYE_CHECKPOINT.md
3. ATOLYE_AI_RULES.md
4. ATOLYE_CONTEXT.md
5. ROADMAP.md
6. ATOLYE_MASTER_ROADMAP.md
7. ARCHITECTURE_DECISIONS.md
8. CHANGELOG.md
9. AI_MEMORY.md

---

## Çoklu Bilgisayar Oturum Kuralları

Kullanıcı iki farklı bilgisayarda dönüşümlü çalışıyor. Bu yüzden aşağıdaki kurallar her oturumda
uygulanmalıdır.

### Oturum Başlangıcı

Her oturuma başlarken, herhangi bir dosya okumadan veya geliştirmeye başlamadan önce:

1. `git pull` çalıştırılmalı.
2. `git status` ile uzak dalla (`origin`) senkron olunduğu doğrulanmalı.
3. Çakışma veya senkron dışı bir durum varsa, devam etmeden önce kullanıcıya bildirilmelidir.

### Oturum Sonu

Her oturumun sonunda — geliştirme tamamlanmış olsun ya da olmasın — değişiklikler commit edilip
push edilmelidir. Bu, projenin genel "kullanıcı onayı olmadan commit/push yapılmaz" kuralına
istisnadır: oturum sonu kaydı için kullanıcı onayı zaten bu belgeyle önceden verilmiştir, tekrar
sorulmasına gerek yoktur.

- İş tamamlanmışsa normal commit kuralları (`ATOLYE_AI_RULES.md`) geçerlidir.
- İş yarım kalmışsa commit mesajı `wip:` öneki taşımalı ve mesaj gövdesinde tam olarak nerede
  kalındığı (hangi dosya/adım, sıradaki iş) açıkça yazılmalıdır.
- Bu adım atlanmamalı; oturum yarım kalan bir iş nedeniyle commit'siz/push'suz bitirilmemelidir.

### Checkpoint Güncelliği

`ATOLYE_CHECKPOINT.md` her oturum sonunda güncel tutulmalıdır. Diğer bilgisayarda oturuma
başlandığında yalnızca bu dosya okunarak nerede kalındığı anlaşılabilmelidir — bu yüzden yarım
kalan işler de (tamamlanmış sprintler gibi) checkpoint'e durumu net şekilde yansıtacak bir kayıtla
eklenmelidir.

---

## Çalışma Akışı

Her geliştirme aşağıdaki sırayla yapılmalıdır.

1. Mimari Analiz
2. Kullanıcı Onayı
3. Kodlama
4. TypeScript Testi
5. Rapor
6. Dokümantasyon
7. Git Commit
8. Git Push

---

## Temel Kurallar

- Mevcut mimari korunmalıdır.
- Geriye dönük uyumluluk bozulmamalıdır.
- Gereksiz refactor yapılmamalıdır.
- Küçük ve güvenli geliştirmeler tercih edilmelidir.
- Kod kadar dokümantasyon da önemlidir.

---

## Aktif Bilgi Kaynağı

En güncel geliştirme durumu:

ATOLYE_CHECKPOINT.md