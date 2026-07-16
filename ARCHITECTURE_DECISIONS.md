---
Document: ARCHITECTURE_DECISIONS.md
Version: 1.0.0
Status: Active
Priority: High
Owner: Atölye V2
Last Updated: 2026-07-16
---

# Atölye V2 — Architecture Decision Records (ADR)

## Amaç

Bu belge Atölye V2 geliştirilirken alınan önemli mimari kararları kayıt altında tutar.

Kod değişebilir.

Sprintler değişebilir.

Ancak bu kararlar mümkün olduğunca korunmalıdır.

---

# ADR-001

## AI Router

### Karar

Provider seçimleri AI Router üzerinden yapılacaktır.

### Sebep

- Tek AI firmasına bağımlı olmamak
- Yeni provider ekleyebilmek
- Kod tekrarını önlemek

### Durum

Accepted

---

# ADR-002

## Provider Interface

### Karar

Tüm AI sistemleri ortak Provider interface'i kullanacaktır.

### Sebep

- Standart API
- Test kolaylığı
- Yeni AI ekleme kolaylığı

### Durum

Accepted

---

# ADR-003

## Service Layer

### Karar

Business Logic UI içerisine yazılmayacaktır.

### Sebep

Kod tekrarını önlemek.

Video Engine,

Mobile,

API,

CLI

aynı servisleri kullanabilmelidir.

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

İlk sürüm JSON tabanlı olacaktır.

### Sebep

Hızlı geliştirme.

Kolay test.

Kolay backup.

---

# ADR-006

## Asset Versioning

### Karar

Asset sistemi append-only olacaktır.

### Sebep

Eski üretimleri korumak.

Versiyon karşılaştırması.

Rollback.

---

# ADR-007

## Architecture First

### Karar

Koddan önce mimari.

### Sebep

Hataları azaltmak.

Tekrar eden refactor ihtiyacını önlemek.

---

# ADR-008

## Incremental Development

### Karar

Küçük ama güvenli geliştirmeler.

### Sebep

Daha az risk.

Kolay test.

Kolay geri dönüş.

---

# ADR-009

## Backward Compatibility

### Karar

Yeni özellik eski davranışı bozmamalıdır.

### Sebep

Kararlılık.

---

# ADR-010

## Documentation First

### Karar

Kod kadar dokümantasyon da önemlidir.

### Sebep

Yeni AI

Yeni geliştirici

Yeni bilgisayar

için hızlı adaptasyon.

---

# ADR-011

## Manifest Pipeline

### Karar

Her üretim aşaması mümkün olduğunca Manifest'e entegre edilir.

### Sebep

Pipeline takibi.

---

# ADR-012

## AI Independence

### Karar

Hiçbir modül tek AI firmasına bağımlı olmayacaktır.

### Sebep

Esneklik.

Maliyet.

Geleceğe hazırlık.

---

# ADR-013

## Atölye Platformdur

### Karar

Atölye;

tek özellik geliştiren uygulama değildir.

### Sebep

Uzun vadeli büyüme.

Yeni modül entegrasyonu.

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

# ADR-016

## Production Acceptance Marker Portability and Versioned Fingerprints

### Karar

Existing schema-2 production acceptance marker'lari migrate veya rewrite edilmeyecek; legacy aggregate configuration fingerprint ve validation davranisi aynen korunacaktir.

Future acceptance executions component-level hashed fingerprints tasiyan schema-3 marker olusturacaktir. Provider, model, token budget, durable execution mode ve API-key identity dahil acceptance configuration degisiklikleri fail-closed kalacaktir.

Machine-specific FFmpeg/FFprobe absolute path degerleri schema-3 identity olmayacaktir. Absolute executable ve capability admission readiness katmaninda zorunlu kalirken marker portability ayni binary content identity'sine baglanacaktir. Path degisikligi policy bypass saglamaz; missing/unreadable veya changed binary bloklanir.

Diagnostic contract read-only olacak ve yalniz guvenli component adlarini raporlayacaktir. Hash, absolute path, secret identity ve raw configuration output contract'ina dahil edilmeyecektir.

### Sebep

Prepared acceptance marker'larinin ayni guvenilir executable ve production configuration ile farkli machine path layout'larinda guvenli bicimde tasinabilmesi; mismatch nedeninin secret ifsa etmeden belirlenebilmesi; mevcut schema-2 marker'larinin geriye donuk uyumlulugunun korunmasi.

### Durum

Accepted

---

# ADR-017

## Controlled Existing-Marker Re-prepare and Fingerprint Profiles

### Karar

Existing schema-2 acceptance marker'lari otomatik migrate edilmeyecektir. Schema-3 re-prepare yalniz explicit operator command'i, exact project slug ve ayri high-intent confirmation flag ile calisacaktir.

Schema-2 marker current legacy aggregate fingerprint dahil tamamen dogrulanmadan write baslamayacaktir. Schema-2 FFmpeg/FFprobe binary identity saklamadigi icin historical binary sameness iddia edilmeyecek; re-prepare anindaki validated current binary identity schema-3 portability baseline'i olacaktir. Schema-2 mismatch path-only varsayimiyla bypass edilmeyecektir.

Schema-3 component fingerprint profile'lari versioned olarak desteklenir. Existing profile-v1 valid kalir; profile-v2 canonical relative project storage identity ve strict/package-only environment policy identity ekler. Unknown profile fail-closed reddedilir.

Marker persistence synced unique temp, temp validation, compare-before-replace, atomic replace ve exact readback kullanir. Post-replace validation failure original raw marker byte'larini synced atomic compensation ile restore eder. Exact replay write-free kalir.

### Sebep

Existing prepared acceptance state'ini production execution baslatmadan portable hale getirmek; machine path farklarini binary identity'den ayirmak; marker disindaki runtime ve durable state'i byte-level korumak.

### Durum

Accepted

---

# ADR-018

## Production Storage Relocation Audit Decisions

### Durum

Proposed — Sprint 129.25 C.2B.3 Independent Audit Review

### Baglam

Mevcut runtime storage primitive'leri explicit external root, logical `projects/<slug>` identity, containment, reparse rejection ve project authority claim saglar. Buna karsin image/audio serving route'lari repository-local path'i dogrudan okur; production composition ve durable execution entrypoint'leri startup/operation boyunca tek frozen authority generation tasimaz; Git evidence ve protected-root rolleri post-relocation modeli tamamlamaz.

Kesin entrypoint matrisi, P0/P1 gate'leri ve sonraki sprint sirasi `docs/PRODUCTION_STORAGE_RELOCATION_AUDIT.md` belgesindedir.

### Onerilen kararlar

1. Relocation online dual-read/dual-write ile degil offline stop-the-world modeliyle tasarlanmalidir.
2. Production admission kapatilmali; worker drain, zero active execution ve clean durable recovery scan quiescence kaniti olmalidir.
3. Authority switch environment degisikligi veya mutable claim replace ile yapilmamalidir. Versioned, previous-generation-bound ve no-clobber transition record ile exclusive active-generation marker kullanilmalidir.
4. Candidate live root olarak dogrudan kullanilmamalidir. Strict candidate verification, exact backup binding, semantic/policy identity, freshness/quiescence ve empty exclusive target gerektiren ayri consume akisi tasarlanmalidir.
5. Eski root silinmemeli veya writable rollback root olarak birakilmamalidir. Serving/resolver disinda, identity-bound salt-okunur quarantine olmalidir.
6. Rollback yalniz tek-kullanimlik authority token'i ve acik precondition'larla yapilabilmelidir; iki root arasinda serbest authority secimi yasaktir.
7. Git untracking verified external authority ve old-root quarantine sonrasinda ayri sprint/change set olarak yapilmalidir.
8. Existing acceptance marker physical path'ten bagimsiz kalmali ve otomatik rewrite edilmemelidir. External storage semantics degisiyorsa yalniz future marker icin versioned policy profile karari alinmalidir.
9. External target admission fixed/local filesystem policy, ACL, capacity, exclusive create/publish, directory durability/fsync, cleanup ve reparse rejection kaniti istemelidir.
10. `data/visuals` production authority oldugu kanitlanana kadar relocation scope disi ve production input olarak yetkisiz kabul edilmelidir.

### Kisitlar

Bu ADR `Proposed` durumundadir. Relocation, candidate consume, restore, root/authority switch, cutover, rollback, Git untracking, marker rewrite veya production execution yetkisi vermez. Independent audit review ve sonraki ayri mimari onaylar olmadan `Accepted` yapilamaz.

### Sebep

Tek-authority, fail-closed ve no-clobber bir relocation tasarlamak; stale repository read/serve, durable split-brain, iki aktif authority, backup/candidate/live target karisimi ve kontrolsuz rollback risklerini implementasyon baslamadan kapatmak.

---

# Yeni ADR Ekleme

Yeni önemli mimari kararlar;

ADR numarası verilerek bu belgeye eklenmelidir.

Mevcut ADR'ler mümkün olduğunca değiştirilmemelidir.
