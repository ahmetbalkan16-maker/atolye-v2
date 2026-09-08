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

# ADR-019

## Real Photo Sourcing for Visuals (Wikimedia Commons)

### Karar

Gerçek, telifsiz/ücretsiz-kullanım fotoğraf kaynağı, tek yeni bir `ImageProviderName` değeri olan
`"real"` üzerinden sunulur; bunu tek bir `RealPhotoImageProvider` implemente eder. Provider içeride
küçük, değiştirilebilir bir "source client" listesine (önce yalnız Wikimedia Commons) devreder.
Hangi kaynağın kullanıldığı asset'in `model` alanında saklanır (örn. `"wikimedia-commons"`); yeni
kaynak eklemek `ImageProviderName`'i, `ImageGenerationResult` union'ını veya
`VisualAssetPipeline.normalizeGenerationResult`'ı tekrar değiştirmeyi gerektirmez — yalnız provider
içindeki source router genişler.

Real-photo aramasının hiçbir eşleşme bulamadığı (veya teknik olarak başarısız olduğu) durumlarda,
provider kendi içinde sessizce AI görseli üretmez; `success:false` döner. AI'ya düşme kararı
`VisualAssetPipeline`'da açıkça verilir (mevcut `openai` provider'a yeniden dispatch edilerek) —
böylece her asset'in `provider`/`model` alanı, o görseli gerçekte neyin ürettiğinin dürüst bir
kaydı olarak kalır.

Sahne bazlı override (`overrides?: Record<sceneId, "ai" | "real">`) yalnız batch provider `"real"`
iken devreye girer; `"ai"` real aramayı tamamen atlar, `"real"` ise o sahne için AI fallback'ini
kapatır (bulunamazsa sahne `failed` olur, sessizce AI'ya düşmez). Bu sürümde herhangi bir yeni UI
eklenmedi — override yalnız pipeline-stage/servis katmanında (`PipelineStageExecutor.execute`'ün
yeni `visualSourceOverrides` parametresi → `VisualAssetPipeline.generateAssets`) sunulur.

### Sebep

`ImageGenerationResult` ve `normalizeGenerationResult` bu projede kasıtlı olarak provider başına
elle yazılmış, exhaustive doğrulama dalları kullanır (her provider'ın sonuç şekli ayrı ayrı
doğrulanır, generic değil). Her kaynak için ayrı bir `ImageProviderName` açmak, gelecekteki her yeni
kaynak (Openverse, LOC/Archive.org, NASA, Pexels/Pixabay/Unsplash) için bu iki dosyayı tekrar
değiştirmek anlamına gelirdi. Tek `"real"` provider + içeride genişleyen source listesi, mevcut
mimariye en az invaziv yoldur.

Fallback kararının provider içinde değil pipeline seviyesinde verilmesi, bu projenin zaten her
asset için sıkı tuttuğu provenance (provider, model, generationMode) takibini korur; lisans/atıf
bilgisi eklendiğinde bu doğruluk daha da önem kazanır.

### Durum

Accepted — Sprint 130 (Wikimedia Commons). Openverse, Library of Congress/Archive.org, NASA Image
Library ve Pexels/Pixabay/Unsplash ayrı, bağımsız sprintler olarak planlanır; hiçbiri bu ADR'yi
değiştirmeden aynı source-router'a eklenmelidir. Gerçek stok **video** kaynağı bu ADR kapsamı
dışıdır — mevcut Visuals aşaması yalnız durağan görsel üretir; video kaynağı ayrı bir mimari karar
gerektirir.

---

# ADR-020

## Real Video Ingestion & Segment Rendering for the Documentary Pipeline (Faz 3)

### Karar

Gerçek arşiv/stok video, belgesel görsel diline **fotoğraf ve AI görselinin yanında** üçüncü bir
sahne-görsel kaynağı olarak girer. Video, `ImageProviderName`'i, `VideoProviderName`'i veya mevcut
`FFmpegSceneVideoProvider`/`VideoPipeline`/assembly sözleşmelerini yeniden yazmadan, **additive** bir
"video media ingestion" katmanı üzerinden pipeline'a alınır:

1. **Aday keşfi** ADR-019 + Faz 2'nin (`ResearchMediaDiscovery`) aynı `MediaSearchClient`
   arayüzünden gelir. `ResearchMediaCandidate.mediaType` zaten `"video"` değerini destekliyordu;
   Faz 3 buna yalnız `durationSeconds?`, `segmentStartSeconds?`, `segmentEndSeconds?` ekler. Yeni
   bir candidate modeli veya ikinci bir discovery yolu **oluşturulmaz**.

2. **Ingestion** yeni, tek amaçlı `VideoMediaIngestion` modülüdür. Enjekte edilebilir bağımlılıklar
   (`download`, ffmpeg/ffprobe `runner`, storage) alır; hiçbir yerden ambient network veya binary
   çağırmaz. İndirmeden **önce** ve **sonra** fail-closed doğrulama yapar.

3. **Segment**: gerçek video bütün halinde kullanılmak zorunda değildir. `segmentStartSeconds` /
   `segmentEndSeconds` verildiğinde FFmpeg ile yalnız o aralık üretilir. Segment kuralları bir
   `videoIngestionPolicy` sabitinden gelir (magic number dağıtımı yok).

4. **Sahne seçimi** yeni `SceneMediaSelection` modülüdür: sahne başına deterministik olarak
   **admissible gerçek video > admissible gerçek fotoğraf > AI görsel** önceliğiyle bir kaynak seçer.
   Bir aday birden çok sahnede kullanılamaz (cross-scene reuse yasak). Seçim, Faz 1'in
   `visualMediaAdmissionPolicy.maxAiImages = 4` guard'ını **hiçbir şekilde gevşetmez** — seçim
   yalnızca hangi sahnelerin AI'ya düşeceğini belirler; cap'i `VisualAssetPipeline` uygular.

5. **Ortak scene-video sözleşmesi**: ingest edilmiş bir video segmenti, `FFmpegSceneVideoProvider`'ın
   ürettiğiyle aynı `VideoSceneGenerationSuccess` şekline normalize edilir (`filePath`, `url`,
   `mimeType: "video/mp4"`, `durationSeconds`, `width/height/frameRate`, `transition`). Assembly
   katmanı kaynağın gerçek klip mi Ken Burns mü olduğunu bilmek zorunda değildir; final videoda
   ikisi ve narration serbestçe karışır.

### Zorunlu alanlar ve kurallar

Her gerçek video asset'i için (additive, `Asset` üzerinde):
`mediaOrigin = "real"`, `mediaType = "video"`, `sourceName`, `sourceUrl` (**zorunlu**, doğrulanabilir
https), `mediaUrl` (**zorunlu**, https + izinli host), `license`, `attribution`,
`rightsStatus` (deterministik, `MediaRightsPolicy` ile), `durationSeconds`,
`segmentStartSeconds?`, `segmentEndSeconds?`, `checksum` (indirilen ham dosyanın SHA-256'sı),
`selectionReason`, `discoveredAt`, `width`, `height`, deterministic asset id.

**Download integrity / güvenlik:**
- Yalnız `https:` ; yalnız `videoIngestionPolicy.allowedMediaHosts` (Wikimedia `upload.wikimedia.org`
  ve gelecekte ADR ile eklenecek doğrulanabilir açık-lisans host'ları). Redirect izlenmez
  (`redirect: "error"`).
- İndirilen boyut `videoIngestionPolicy.maxDownloadBytes` sınırında; aşan indirme iptal + reject.
- İndirmeden sonra **ffprobe** ile gerçek container + video codec + süre doğrulanır. Beklenen
  container/codec dışındaysa reject.
- Bildirilen MIME `video/*` değilse reject.
- Partial / corrupt / probe-edilemeyen dosya production asset olarak **kabul edilmez** —
  quarantine edilir veya silinir.
- `checksum` deterministiktir; aynı kaynak + aynı segment → aynı asset identity.

**Rights gate (fail-closed):**
- `rightsStatus ∈ {public-domain, open-license, verified}` **değilse** ingest reddedilir.
- `sourceUrl` veya `mediaUrl` yoksa reddedilir.
- Lisansı bilinmeyen (`unknown`) veya `restricted`/NC/ND/all-rights-reserved medya production'a
  **alınmaz**. `verified` asla otomatik atanmaz.

**Segment kuralları (fail-closed):**
- `start >= 0`, `end > start`, `end <= sourceDuration` (küçük ffprobe toleransı ile).
- `videoIngestionPolicy.minSegmentSeconds <= (end - start) <= maxSegmentSeconds`.
- Geçersiz segment → reject (deterministik).
- Geçerli segment → deterministik MP4 çıktısı.

**Cross-scene reuse:** bir video (veya foto) aday'ı yalnız bir sahneye atanır. Kalan sahneler için
başka admissible aday yoksa o sahne AI'ya düşer (cap dahilinde) veya `override: "real"` ise sahne
`failed` olur.

**AI fallback ile ilişki:** gerçek video bulunan sahne → 0 AI görsel. Gerçek foto bulunan sahne →
0 AI görsel. Hiç admissible gerçek medya yoksa → Faz 1 AI fallback (en fazla `maxAiImages`).
16 sahnelik hedef: mümkün olduğunca gerçek medya, en fazla 4 AI; cap aşılırsa
`VISUAL_AI_IMAGE_BUDGET_EXCEEDED` ile fail-closed.

### Sebep

Video download/segment/probe/checksum mantığı, mevcut `FFmpegSceneVideoProvider` ve
`FFmpegVideoAssemblyProvider`'ın FFmpeg altyapısıyla (aynı `VideoAssemblyProcessRunner`,
`VideoStorage`) tamamen uyumlu ama ayrı bir sorumluluktur; onları değiştirmek en çok denetlenen
render/durable yolunu riske atardı. Ingestion'ı ayrı, enjekte edilebilir bir katman yapmak
fixture + local ffmpeg ile test edilebilir kılar, gerçek network'ü testlerin dışında tutar ve
provenance/rights doğruluğunu (ADR-019'un ısrar ettiği) korur.

Seçimin (`SceneMediaSelection`) provider içinde değil pipeline seviyesinde deterministik yapılması,
Faz 1 cap'inin ve Faz 2 dedup/determinism garantilerinin bozulmamasını sağlar.

### Kapsam dışı (bu ADR'de karar verilmez)

- Google/Bing veya kontrolsüz web scraping ile video indirme — **yasak**.
- LLM'in uydurduğu URL'lerin kaynak kabul edilmesi — **yasak** (Faz 2 kuralı).
- `mediaSearchClient` / ingestion'ın production pipeline'da default açılması — Faz 6.
- Music / SFX / ambience — Faz 4.
- `$1` cost guard — Faz 5.
- Whisper/altyazı transkripsiyonu, video stabilizasyon, renk düzeltme.

### Durum

Accepted — Sprint 169 (foundation: types + `VideoMediaIngestion` + `SceneMediaSelection` +
fixture/local-ffmpeg smoke). Production wiring (opt-in → default), acceptance rights/cost gate ve
music/SFX ayrı fazlardır.

---

# ADR-021

## Atölye Brain — Deterministic-First Intelligence Layer (PHASE 6)

### Karar

`ATOLYE_MASTER_ROADMAP.md` PHASE 6 (AI Director + Production Memory + Knowledge Engine) tek bir
`src/lib/brain/` modülü olarak, mevcut mimariye **eklemeli** (additive) biçimde uygulanır. Brain
ikinci bir orkestratör, tek bir dev LLM prompt'u veya paralel bir state store **değildir**; mevcut
`src/lib/pipeline` ve `src/lib/production` katmanlarının *üstünde* duran, çoğunlukla **deterministik**
bir karar katmanıdır. Ne ve ne zaman yapılacağına Brain karar verir; işi hâlâ mevcut servisler yapar.

Bağlayıcı kurallar (koda gömülü):

1. **Sınırsız self-modification yok.** Brain analiz / araştırma / plan / temp-workspace testi /
   teşhis / öneri taslağı yapabilir. Production davranışını, güvenlik politikasını, kritik kodu veya
   veri silme/değiştirmeyi **kullanıcı onayı olmadan** yapamaz. `BrainAutonomyPolicy` (sabit tablo,
   yorum değil) + `BrainImprovementProposal` / `BrainSelfImprovementLoop` onay durum makineleri
   uygular. `apply` durumu, kayıtlı bir `user-approve` olayı olmadan erişilemez (fail-closed).
2. **Güvenlik kod seviyesinde, model seviyesinde değil.** Allowlist/denylist/sandbox/path-containment/
   secret-redaction deterministik fonksiyonlardır (`BrainSecurityPolicy`, `BrainRedaction`).
3. **Memory/log/rapor'da secret yok.** Brain'in yazdığı her string `redactBrainText`'ten geçer;
   redaction sonrası hâlâ secret içeren memory kaydı reddedilir (`BRAIN_MEMORY_SECRET_LEAK`).
4. **Varsayılan $0.** Yerel modeller (Ollama `qwen2.5:3b`), ücretsiz kaynaklar, mevcut asset'ler.
   Ücretli provider koşu-başına açık kullanıcı onayı ister; `OPENAI_API_KEY`'in varlığı onay değildir.
5. **Muhafazakâr donanım.** `BrainSafetyGovernor` termal tavandan *önce* davranır (asla "80 °C'yi
   bekle" değil). `thermal-slowdown`/`driver-reset`/`tdr`/`bsod`/`fatal-whea`/`display-loss` →
   anında abort. ≤ 5 GB VRAM kartta 7B yasak. Snapshot `unavailable` ise "her şey yolunda" değil —
   muhafazakâr kısıt paketi uygulanır.
6. **İzole & geri alınabilir.** Brain tamamen `src/lib/brain/` + `src/types/brain*.ts` içindedir.
   `src/lib/pipeline` / `src/lib/production` hiçbir dosyası Brain'i import etmez. Bu fazda Brain
   hiçbir model / binary / ağ çağrısı yapmaz.

Rol mimarisi: planner / researcher / critic / executor **/ security-guard / memory /
approval-manager**. Son üçü **deterministik** (modelsiz); diğerleri varsayılan olarak tek yerel
model (`qwen2.5:3b`) + sabit sistem-prompt "şapkası". Ayrı fiziksel model zorunlu değildir.

Server-side "Brain Worker" (PC kapalıyken çalışan görev kuyruğu) mimarisi **tasarlandı**: kuyruk
modeli (`BrainTaskQueue`), otonomi kapısı (`BrainAutonomyPolicy`), sabah raporu
(`BrainWorkerReport`). Çalışan runner + durable store + deployment ayrı, onaylı fazlardır — ücretli
bulut servisi **kullanılmayacak**.

### Sebep

`ProductionOperationJournal`, `RealPhotoImageProvider` fail-closed gate, `QualityPreset`, grammar-
constrained structured output ve `PipelineRecoveryPlanner` gibi mevcut desenler zaten "deterministik,
şema-versiyonlu, fail-closed, sanitize edilmiş kanıt" prensibiyle çalışıyor. Brain aynı prensibi
karar katmanına taşır: zekâ = daha küçük model değil, mevcut kaynaklarla en iyi sonucu kontrollü
biçimde üretmek. Kritik kararların son sözü her zaman kullanıcıda.

### Durum

Accepted — Sprint 180 (foundation: `src/types/brain*.ts` + tüm saf karar/güvenlik/kalite/deneyim/
memory/worker/self-improvement modülleri + 50 smoke senaryosu, GPU'suz, $0). Pipeline'a bağlama,
rol implementasyonları, durable store'lar, host resource probe, `ffprobe` adaptörü, Brain Worker
runner ve `/api/brain/*` route'ları ayrı, kullanıcı-onaylı fazlardır. Bkz `docs/brain/ATOLYE_BRAIN.md`.

---

# ADR-022

## Atölye Brain — Read-Only Adapters + Durable Experience Store (PHASE 6, Sprint 181)

### Karar

Sprint 180'in saf karar katmanına **yalnızca read-only / geri alınabilir** dört yapı taşı eklenir.
Hiçbiri production'a bağlanmaz, hiçbiri gerçek LLM inference / GPU işi başlatmaz, hiçbiri public
server açmaz.

1. **`scripts/brain-plan.ts` — dry-run plan CLI.** Bir konudan 14 fazlık `BrainRunPlan`'ı
   deterministik biçimde üretip gösterir. Pipeline / PipelineRunner / Ollama / GPU / `nvidia-smi` /
   ağ çağrısı **yapmaz**; `--record-experience` dışında dosya yazmaz. `requestedAt` sabit
   varsayılan → aynı seçenekler her zaman aynı `planId`.

2. **`src/lib/brain/store/BrainExperienceStore.ts` — durable JSON-file experience store.**
   `BrainExperienceStore` port'unun arkasındaki tek küçük adaptör. `data/brain/experience/<yyyy-mm>.json`.
   - Atomic write: temp dosya → `fsync` → `rename` (yarıda kalan yazım eski shard'ı bozmaz).
   - Her string `redactBrainText`'ten geçer; redaction sonrası hâlâ secret eşleşen kayıt reddedilir
     (`BRAIN_EXPERIENCE_RECORD_REJECTED`).
   - Bozuk JSON shard → `BRAIN_EXPERIENCE_STORE_CORRUPT_SHARD` fırlatır; asla "sessizce boş" sayılmaz
     (veri kaybı gibi görünmesin + iyi veriyi ezmesin).
   - `list()` / `recent()` deterministik sıra (`completedAt` desc, sonra `recordId`).
   - `append()` `recordId` üzerinde idempotent; yazımdan hemen önce shard yeniden okunur (proses-yerel
     birleştirme — `PipelineJobMutationLock` ile aynı sınır, dağıtık garanti değil).
   - Testler daima temp workspace kullanır; `data/brain/` yalnızca README tutar.

3. **`src/lib/brain/BrainDryRunExperience.ts` — plan → `mode: "dry-run"` deneyim kaydı.**
   `BrainExperienceRecord`'a eklemeli `mode?: "production" | "dry-run"` alanı (yoksa `production`).
   Dry-run kaydı dürüst sıfırlar taşır (`stages: []`, `qualityScore: 0`, `aiCostUsd: 0`),
   `finalStatus: "dry-run-planned"`, ve `deriveBrainExperienceInsights` + store `list()` tarafından
   öğrenmeden **dışlanır**. Sahte başarı / uydurma GPU sonucu asla üretilmez.

4. **`src/lib/brain/probe/BrainResourceProbe.ts` + `BrainRenderProbe.ts` — read-only probe'lar.**
   - Resource probe: `nvidia-smi --query-gpu=... --format=csv` (telemetri okuması — ayar/fan/power/
     clock/undervolt/BIOS/driver **yok**, inference **yok**, stress **yok**) + `node:os` RAM.
     GPU okunamazsa `source: "unavailable"` → Safety Governor muhafazakâr paket ("bilgi yok = güvenli"
     **değil**). RTX A2000 için **60 °C hard stop** ayrı, deterministik bir kontrol olarak korunur
     (`evaluateBrainResourceHardStop`) — genel 80 °C tavanın yanında, onu gevşetmeden.
   - Render probe: `ffprobe -show_format -show_streams -of json` (yalnız metadata — re-encode / render
     / mux / silme **yok**) → `BrainFinalRenderReport`. Gerçek dosya yoksa `{ available: false }`;
     sahte container/stream üretilmez.

Ek olarak `docs/brain/ATOLYE_BRAIN_SERVER.md`: Server Brain / Secure Gateway / Brain API / Local
Atölye Agent / Task Queue / Approval Manager / Notification-Event katmanı + proaktif iletişim
(`CRITICAL`/`IMPORTANT`/`APPROVAL_REQUIRED`/`INFO`) + gece öğrenme + PHASE 7 güvenlik backlog'u
**tasarım olarak** dokümante edildi. Public server / domain / port / Tailscale / remote access
**açılmadı**.

### Sebep

Sprint 180 "henüz yapamadıkları" listesindeki maddeler tek tek, en düşük riskli sırayla kapatılıyor:
önce planı *görünür* kılan read-only bir arayüz, sonra deneyimi *saklayan* durable bir adaptör, sonra
gerçek host/render verisini *ölçen* (ama değiştirmeyen) probe'lar. Her biri mevcut port arayüzüne
(`BrainContracts.ts`) oturur, mevcut redaction/fail-closed/deterministik-id desenlerini kullanır ve
`src/lib/brain/` izolasyonunu korur (pipeline/production hâlâ Brain'i import etmiyor).

### Durum

Accepted — Sprint 181. `tsc` temiz, `eslint .` 0 error / 22 warning (hepsi önceden var). 5 Brain
smoke suite ~83 senaryo PASS (GPU'suz zorunlu; probe suite'i `nvidia-smi`/`ffprobe` + MP4 varsa 2
opsiyonel read-only canlı çağrı yapar). Pipeline'a bağlama, rol model çağrıları, `BrainTaskQueue`
durable store'u, Server Brain / Local Agent runner'ları ve `/api/brain/*` + Secure Gateway ayrı,
kullanıcı-onaylı fazlardır. Bkz `docs/brain/ATOLYE_BRAIN.md`, `docs/brain/ATOLYE_BRAIN_SERVER.md`.

---

# Yeni ADR Ekleme

Yeni önemli mimari kararlar;

ADR numarası verilerek bu belgeye eklenmelidir.

Mevcut ADR'ler mümkün olduğunca değiştirilmemelidir.
