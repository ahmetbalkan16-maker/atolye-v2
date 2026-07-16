# Atölye V2 — Production Storage Relocation Audit

## Belge durumu

- Sprint: `Sprint 129.25 C.2B.3 — Production Storage Relocation Audit`
- Durum: `In Review`
- İncelenen HEAD: `6387e3d`
- Audit türü: salt-okunur mimari ve bağımlılık denetimi
- Yetki: relocation, candidate consume, restore, root/authority switch, cutover, rollback, Git untracking veya production execution yetkisi vermez

## Amaç ve sınır

Bu audit, bütün production runtime read/write/serve/recovery yollarını fiziksel storage root bağımlılığı açısından sınıflandırır. Çıktı gerçek relocation öncesindeki P0/P1 kapılarını, gerekli mimari kararları ve küçük uygulama sprintlerini belirler.

Bu sprintte kaynak/test kodu, `data/projects/**`, Git index, `.gitignore`, acceptance marker, backup, candidate veya production state değiştirilmez. Copy/move, execute/resume/retry/finalize, root switch ve authority switch yapılmaz.

## Sınıflandırma anahtarı

- `READY`: mevcut abstraction external runtime için doğru fiziksel çözümleme ve güvenlik sınırı sağlıyor.
- `REQUIRES ADAPTER`: primitive hazır; consumer operation-scoped context veya storage service üzerinden bağlanmalı.
- `REQUIRES MIGRATION`: veri/Git durumu daha sonraki kontrollü migration gerektiriyor.
- `REQUIRES POLICY DECISION`: implementasyondan önce otorite veya davranış kararı gerekiyor.
- `BLOCKING`: çözülmeden gerçek relocation başlatılamaz.
- Context: `Frozen` tek operation boyunca aynı `RuntimeStorageContext`; `Injectable` caller context verebilir; `Default-per-call` her çağrıda environment/cwd yeniden çözülebilir.

## Production storage entrypoint matrisi

Tablodaki `Safety` alanı containment ile symlink/junction/reparse davranışını; `State/Git` alanı durable state ve Git bağını birlikte gösterir.

| ID | Consumer / entrypoint ve kesin referans | Owner | Logical locator | Physical resolver | Context / frozen | Mode | Authority | Safety | State / Git | Legacy varsayımı ve external uyum | Sınıf | Blast | Sonraki sprint | P0/P1 gerekçesi |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R1 | [`createRuntimeStorageContext()`](../src/lib/runtime/RuntimeStoragePaths.ts#L69), [`resolveRuntimeLogicalPath()`](../src/lib/runtime/RuntimeStoragePaths.ts#L261) | Runtime | `projects/<slug>` ve `data/projects/<slug>/...` | `ATOLYE_RUNTIME_ROOT` veya legacy default | Frozen context üretilebilir | resolve/read/write foundation | project claim/lease temeli | ancestor-chain, containment, realpath, link rejection | authority claim physical root fingerprint taşır; Git bağı yok | Legacy default bilinçli; explicit external destekli | READY | HIGH | C.2B.4 | Primitive doğru; consumer’ların aynı context’i taşıması şart. |
| P1 | [`ProjectReader`](../src/lib/projects/ProjectReader.ts#L10), geniş `readJSON()` catch’i [L21](../src/lib/projects/ProjectReader.ts#L21) | Projects | project JSON adları | `getProjectRoot()` | Injectable; caller vermezse Default-per-call | read/list | read sırasında claim compatibility kontrolü | root abstraction var; `readJSON()` IO/parse ayrımını maskeler | manifest/jobs/history/AI dahil tüm project JSON | Repository path hard-code değil; external uyum primitive düzeyinde var | REQUIRES ADAPTER | HIGH | C.2B.4, C.2B.7 | P1: IO/security hatası `null`/missing gibi görülebilir; uzun operation context’i sabit değil. |
| P2 | [`ProjectWriter.writeJSONAtomically()`](../src/lib/projects/ProjectWriter.ts#L57) | Projects | project JSON adları | `getProjectRoot()` | Injectable; method içinde tek context | write/remove | `acquireProjectWriteAuthority()` | safe contained directory, temp + rename | project/manifest/jobs/history writer tabanı | External uyumlu; legacy varlığı dual-root fail-closed yapar | READY | HIGH | C.2B.4 | Primitive tek çağrı için güvenli; orchestration context propagation ayrıca gerekli. |
| S1 | [`FileStorage`](../src/lib/storage/FileStorage.ts#L12) | Storage | `data/projects/**` veya arbitrary relative path | Runtime resolver yalnız project prefix’inde; diğerleri workspace | Injectable | read/write/remove/list | project prefix’inde lease | project prefix’inde runtime containment; diğerlerinde recursive workspace mkdir | project assets/readiness kullanır; Git bağı dolaylı | Prefix dışı production path’lerin relocation kapsamı belirsiz | REQUIRES POLICY DECISION | MEDIUM | C.2B.4 | P1: yeni production locator project prefix’i dışında kalırsa repository write devam eder. |
| A1 | [`AssetManager.getAssetsPath()`](../src/lib/assets/AssetManager.ts#L17), context çözümü [L41](../src/lib/assets/AssetManager.ts#L41) | Assets | `data/projects/<slug>/assets/assets.json` | `FileStorage` | Injectable | read/write registry | FileStorage lease | RuntimeStoragePaths üzerinden | asset manifest locator’larını taşır | Logical locator external root’tan bağımsız | READY | HIGH | C.2B.4 | Operation caller context’i sabitlemelidir; locator formatı korunmalı. |
| A2 | [`ImageStorage.saveImage()`](../src/lib/assets/storage/ImageStorage.ts#L46), inspect [L92](../src/lib/assets/storage/ImageStorage.ts#L92) | Assets | `data/projects/<slug>/assets/images/*` | runtime logical resolver | Injectable; method içinde tek context | write/read/inspect | project lease | storage-root containment ve no-link file inspection | asset registry filePath/URL | External uyumlu | READY | HIGH | C.2B.5 | Storage service hazır; image API bunu bypass ediyor. |
| A3 | [`AudioStorage.saveAudio()`](../src/lib/assets/storage/AudioStorage.ts#L40), inspect [L89](../src/lib/assets/storage/AudioStorage.ts#L89) | Assets | `data/projects/<slug>/assets/audio/*` | runtime logical resolver | Injectable; method içinde tek context | write/read/inspect | project lease | containment, storage sentinel/file validation | audio assets ve assembly inputs | External uyumlu | READY | HIGH | C.2B.5 | Storage service hazır; audio API bunu bypass ediyor. |
| A4 | [`VideoStorage.createRenderPaths()`](../src/lib/assets/storage/VideoStorage.ts#L41), finalize [L92](../src/lib/assets/storage/VideoStorage.ts#L92), inspect [L200](../src/lib/assets/storage/VideoStorage.ts#L200) | Assets | `data/projects/<slug>/assets/videos/*` | runtime logical resolver | Injectable; render operation context taşınabilir | write/read/finalize/cleanup | project lease | containment, sentinel, exclusive temporary/final path policy | scene/final video manifests | External uyumlu | READY | HIGH | C.2B.4 | Caller context drift etmezse old-root output riski yok. |
| A5 | [`AnimationStorage.saveMotionPlan()`](../src/lib/animation/AnimationStorage.ts#L64), inspect [L118](../src/lib/animation/AnimationStorage.ts#L118) | Assets | `data/projects/<slug>/assets/animations/*` | runtime logical resolver | Injectable | write/read/cleanup | project lease | containment, sentinel, exact logical binding | asset registry/motion-plan binding | External uyumlu | READY | MEDIUM | C.2B.4 | Pipeline context propagation yine gerekli. |
| A6 | [`ThumbnailStorage.saveThumbnail()`](../src/lib/thumbnail/ThumbnailStorage.ts#L42), read [L178](../src/lib/thumbnail/ThumbnailStorage.ts#L178) | Assets | `data/projects/<slug>/assets/thumbnails/*` | runtime logical resolver | Injectable | write/read/serve helper | project lease on mutation | containment, real-file inspection | thumbnail manifest ve URL | External uyumlu | READY | MEDIUM | C.2B.5 | Route zaten service kullanıyor. |
| API1 | [Image GET route](../app/api/assets/images/[slug]/[fileName]/route.ts#L11) | API | URL `/api/assets/images/...` | `process.cwd()/data/projects/...` | Yok; module-level repository root | serve/read | Yok | yalnız lexical check; runtime realpath/reparse policy bypass | Asset registry’den bağımsız doğrudan file read | Legacy repository zorunlu; external uyumsuz, stale serve mümkün | BLOCKING | HIGH | C.2B.5 | P0: relocation sonrası eski root’tan asset serve ve direct filesystem bypass. |
| API2 | [Audio GET route](../app/api/assets/audio/[slug]/[fileName]/route.ts#L12) | API | URL `/api/assets/audio/...` | `process.cwd()/data/projects/...` | Yok; module-level repository root | serve/read | Yok | lexical check ve WAV parse; runtime containment/reparse bypass | Asset registry’den bağımsız doğrudan file read | Legacy repository zorunlu; external uyumsuz, stale serve mümkün | BLOCKING | HIGH | C.2B.5 | P0: relocation sonrası eski root’tan serve; core dual-root guard bypass edilir. |
| API3 | [Video GET route](../app/api/assets/videos/[slug]/[fileName]/route.ts#L12) | API | URL `/api/assets/videos/...` | `VideoStorage.inspectStoredMp4()` | Default-per-request service context | serve/read | read-only claim compatibility | storage service containment/reparse inspection | video manifest locator’ıyla uyumlu | External uyumlu | READY | HIGH | C.2B.5 | URL/physical ayrımı korunuyor; request composition context’i ileride açık bağlanmalı. |
| API4 | [Thumbnail GET route](../app/api/assets/thumbnails/[slug]/[fileName]/route.ts#L8) | API | URL `/api/assets/thumbnails/...` | `ThumbnailStorage.readThumbnail()` | Default-per-request service context | serve/read | read-only claim compatibility | storage service containment/reparse inspection | thumbnail locator’ıyla uyumlu | External uyumlu | READY | MEDIUM | C.2B.5 | URL root’tan bağımsız. |
| O1 | [`ProjectManager`](../src/lib/projects/ProjectManager.ts#L98), [`PipelineJobManager`](../src/lib/pipeline/PipelineJobManager.ts#L588), [`AIUsageManager`](../src/lib/ai/AIUsageManager.ts#L24), [`ProductionSnapshotSourceReader`](../src/lib/production/ProductionSnapshotSourceReader.ts#L107) | Projects / Production | project, manifest, jobs, history, AI usage, snapshot sources | ProjectReader/Writer | Default-per-call; operation boyunca frozen değil | read/write/snapshot | writer çağrısında ayrı lease | primitive güvenliği var; call-chain root drift edebilir | bütün proje ve pipeline state’i | External primitive uyumlu; orchestration split-brain riski | REQUIRES ADAPTER | HIGH | C.2B.4 | P0: aynı operation içinde farklı root çözümü; P1: stale/missing okuma. |
| O2 | [`VisualAssetPipeline`](../src/lib/assets/VisualAssetPipeline.ts#L62), [`AudioPipeline`](../src/lib/audio/AudioPipeline.ts#L73), [`AnimationAssetPipeline`](../src/lib/animation/AnimationAssetPipeline.ts#L75), [`VideoPipeline`](../src/lib/video/VideoPipeline.ts#L59), [`ThumbnailAssetPipeline`](../src/lib/thumbnail/ThumbnailAssetPipeline.ts#L92) | Assets / Production | asset registry ile image/audio/animation/video/thumbnail locator’ları | AssetManager ve ilgili storage service’leri | Pipeline input’unda context yok; her service call Default-per-call | read/write/inspect/cleanup | mutation başına ayrı project lease | primitive containment var; pipeline-wide authority snapshot yok | asset registry, stage manifests ve provider outputs | External primitive uyumlu; çok adımlı pipeline root drift edebilir | REQUIRES ADAPTER | HIGH | C.2B.4 | P0: provider output, registry write ve compensation cleanup farklı root’lara ayrışabilir. |
| PR1 | [`ProductionAcceptancePolicy`](../src/lib/production/ProductionAcceptancePolicy.ts#L169), marker writes [L194](../src/lib/production/ProductionAcceptancePolicy.ts#L194) | Production | `production-acceptance.json` | ProjectReader/Writer, ayrıca direct `fs.mkdir(projectFolder)` | Default-per-call; context parametresi yok | read/write marker | writer lease var; ön `mkdir` lease dışında | getProjectRoot guard var; direct mkdir ortak storage primitive dışında | marker/fingerprint production gate | External root seçilebilir fakat operation binding açık değil | REQUIRES ADAPTER | HIGH | C.2B.4 | P0/P1: marker reservation ve write farklı resolution anlarına dayanabilir. |
| PR2 | [Portable storage fingerprint](../src/lib/production/ProductionAcceptanceConfigurationFingerprint.ts#L132) | Production | logical `data/projects/<slug>` | physical path içermez | N/A | identity | marker policy | host path taşımıyor | marker schema/profile | External portable; `workspace-contained-no-links-v1` adı external semantiği tam yansıtmıyor | REQUIRES POLICY DECISION | MEDIUM | C.2B.8 | P1: policy anlamı değiştirilmeden marker validity kararı verilmeli; otomatik rewrite yasak. |
| PR3 | [`ProductionReadinessService`](../src/lib/production/ProductionReadinessService.ts#L88), context creation [L113](../src/lib/production/ProductionReadinessService.ts#L113), probe write [L498](../src/lib/production/ProductionReadinessService.ts#L498) | Production | temp project asset/readiness locators | FileStorage ve asset storages | Injectable; tek readiness çağrısında context oluşturuyor | probe/read/write/cleanup | project leases | probe-root containment ve service validation | runtime status ile birleşir | External destekli; composition aynı authority’ye açıkça bağlanmalı | REQUIRES ADAPTER | HIGH | C.2B.6 | P1: runtime status ve storage probe aynı frozen authority evidence’ını taşımalı. |
| RT1 | [`ProductionRuntimeCompositionRoot`](../src/lib/runtime/ProductionRuntimeCompositionRoot.ts#L14), durable root [L18](../src/lib/runtime/ProductionRuntimeCompositionRoot.ts#L18), project listing [L42](../src/lib/runtime/ProductionRuntimeCompositionRoot.ts#L42) | Runtime | projects root ve `<project>/production-execution` | context’siz ProjectReader callbacks | Startup’ta frozen context yok; callback başına default | recovery/startup/status | explicit authority token yok | ProjectReader guard var; lifecycle binding yok | recovery bootstrap ve worker lifecycle | Environment değişimi veya iki process farklı root seçebilir | BLOCKING | HIGH | C.2B.6 | P0: recovery başka root, worker başka root; iki aktif authority veya split-brain. |
| D1 | [`ProductionExecutionFilePersistenceAdapter`](../src/lib/production/ProductionExecutionPersistence.ts#L29), factory roots [L21](../src/lib/production/ProductionPipelineExecutionFactory.ts#L21), retry root [L53](../src/lib/production/ProductionPipelineRetryReconciliation.ts#L53) | Production | `<project>/production-execution/{attempts,claims,idempotency,reservations,...}` | caller-provided absolute trusted root, caller context’siz ProjectReader kullanıyor | Adapter root instance içinde frozen; aynı operation’ın tüm adapter creation’ları tek authority’ye bağlı değil | read/write/recovery | project authority claim/token persistence record’ına bağlı değil | adapter trusted-root checks; relocation authority evidence yok | attempts, claims, leases, idempotency, reservations, recovery | External root seçilebilir; aktif state iki ağaca ayrışabilir | BLOCKING | HIGH | C.2B.6 | P0: durable state split-brain, active lease/attempt varken unsafe relocation. |
| B1 | [`RuntimeBackupInventory`](../src/lib/runtime/backup/RuntimeBackupInventory.ts#L46), Git branch [L54](../src/lib/runtime/backup/RuntimeBackupInventory.ts#L54), repo containment [L190](../src/lib/runtime/backup/RuntimeBackupInventory.ts#L190) | Runtime | live `projects/**` inventory | context projects root | Injectable ve scan boyunca frozen | read/inventory/backup evidence | read-only authority compatibility | regular-file/no-link containment | repositoryRoot verilince Git ls-files metadata zorunlu | External root repo dışında ise Git metadata kolu uyumsuz | REQUIRES POLICY DECISION | HIGH | C.2B.8 | P1: byte authority ile informational Git evidence ayrılmalı. |
| C1 | [`RuntimeMigrationCandidatePreflight`](../src/lib/runtime/migration/RuntimeMigrationCandidatePreflight.ts#L108), repository cleanliness [L264](../src/lib/runtime/migration/RuntimeMigrationCandidatePreflight.ts#L264) | Runtime | live runtime freshness + candidate evidence | context inventory; Git status sabit repo `data/projects` pathspec’i | Caller context frozen; Git evidence farklı physical source ölçüyor | read/preflight | no mutation | protected-root ve verifier guard’ları | repository-local Git cleanliness hard-coded | Post-relocation external live runtime cleanliness’ini kanıtlamaz | REQUIRES ADAPTER | HIGH | C.2B.8 | P1: yanlış Git evidence kaynağı candidate consume/readiness kararını etkileyebilir. |
| SEC1 | [`RuntimeProtectedRoots`](../src/lib/runtime/security/RuntimeProtectedRoots.ts#L73) | Security | repository/runtime/live/backup/candidate/restore roles | explicit absolute roots | Context bazlı | security/admission | N/A | exact/ancestor/descendant, canonical/reparse-aware | durable binding taşımaz | Current roles hazır; relocation-target ve quarantine rolleri yok | REQUIRES POLICY DECISION | HIGH | C.2B.9 | P0: live, candidate, backup, target veya quarantine overlap edemez. |
| G1 | [Tracking inventory](../scripts/lib/runtime-tracking-inventory.ts#L22), Git pathspec [L36](../scripts/lib/runtime-tracking-inventory.ts#L36), ignored durable allowlist [L89](../scripts/lib/runtime-tracking-inventory.ts#L89) | Scripts | repository `data/projects/**` | Git top-level + physical repository tree | Repository-fixed | audit/read | N/A | realpath/regular-file admission for ignored durable | tracked files ve ignored durable kayıtlar | Bilinçli legacy-only audit; external runtime modeli yok | REQUIRES MIGRATION | HIGH | C.2B.12 | P0/P1: untracking sırası ve ignored durable state kaybı belirlenmeden Git mutation yapılamaz. |
| S2 | Repository-local runtime smoke/production scripts; 16 dosya `data/projects` varsayımı taşıyor | Scripts | fixture veya live repository paths | çoğunlukla `process.cwd()` | Script başına değişken; çoğu external context taşımıyor | test/audit/operator | çoğunlukla yok | fixture’a göre değişiyor | tracked/ignored baseline’a bağlı | External runtime regresyonunda yanlış root’a yönelme riski | REQUIRES ADAPTER | HIGH | C.2B.4, C.2B.8 | P1: test veya operator script’i eski/canlı root’a yazmamalı. |
| V1 | [`VisualManager`](../src/lib/projects/VisualManager.ts#L5) | Projects | `data/visuals` | `process.cwd()/data/visuals` | Module-level repository root | read/write | Yok | runtime containment policy dışında | `projects/**` backup/candidate scope’una dahil değil | Repository-local; production runtime kapsamı kayıtlı değil | REQUIRES POLICY DECISION | LOW | C.2B.8 | P1 yalnız production authority ise; aksi halde açıkça scope dışı ilan edilmeli. |
| F1 | [`FFmpegSceneVideoProvider`](../src/lib/video/providers/FFmpegSceneVideoProvider.ts#L44), [`FFmpegVideoAssemblyProvider`](../src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts#L92) | Assets / Production | logical image/audio/video locators | `resolveRuntimeLogicalPath()` + `VideoStorage` absolute temp/final | Her provider operation başında tek context; injectable | read/render/write/probe | VideoStorage mutation lease | storage containment; FFmpeg args absolute resolved paths | asset manifests ve acceptance media | External uyumlu; caller provider instance’i operation context’iyle bağlamalı | READY | HIGH | C.2B.4 | P1 regression gate: input, temp output ve final output aynı context/root’ta kalmalı. |

## Dağılım

### Relocation sınıfı

| Sınıf | Entry sayısı |
|---|---:|
| READY | 11 |
| REQUIRES ADAPTER | 7 |
| REQUIRES MIGRATION | 1 |
| REQUIRES POLICY DECISION | 5 |
| BLOCKING | 4 |

### Owner ve blast radius

| Owner | Başlıca sorumluluk | En yüksek blast radius |
|---|---|---|
| Runtime | context, composition root, backup/candidate evidence | HIGH |
| Projects | JSON/manifest/jobs/history ve operation context | HIGH |
| Storage | logical-to-physical resolver ve generic persistence | MEDIUM |
| Assets | image/audio/video/animation/thumbnail ve FFmpeg paths | HIGH |
| Production | marker, readiness, durable persistence/recovery | HIGH |
| API | asset serving | HIGH |
| Security | protected-root topology | HIGH |
| Scripts | Git tracking, ignored durable inventory, regression/operator paths | HIGH |

## Açık P0 gate’leri

1. Image ve audio API’lerinin repository-local direct filesystem read’i kaldırılmadan eski root serve edilmeye devam edebilir.
2. Production process startup’ında tek frozen runtime authority bağlanmadan recovery, worker ve request yolları farklı root seçebilir.
3. Attempt/claim/lease/idempotency/reservation/recovery state’i tek authority token’ına bağlanmadan iki durable state ağacı oluşabilir.
4. Active worker, lease, claim veya attempt varken relocation yapılamaz; explicit quiescence kanıtı gerekir.
5. Authority claim dosyasını silmek/değiştirmek geçiş değildir. Physical projects-root fingerprint’i versioned no-clobber transition ile değiştirilmelidir.
6. Legacy ve external root aynı anda aktif okunur/yazılır bırakılamaz. Eski root explicit salt-okunur quarantine olmalı ve serving’den çıkarılmalıdır.
7. Live, backup, candidate, relocation target, restore-verification ve quarantine root’ları exact/ancestor/descendant overlap edemez.
8. Existing runtime veya foreign target üzerine overwrite yasaktır; target empty/owned/exclusive ve publish no-clobber olmalıdır.
9. Runtime Git tarafından tracked kalırken stale repository data’nın API veya script yoluyla aktif authority olması engellenmelidir.

## Açık P1 gate’leri

1. `ProjectReader.readJSON()` IO/security/parse hatalarını `null` olarak maskeleyemez; missing ayrı, diğer hatalar fail-closed olmalıdır.
2. External live runtime byte evidence’i repository-local Git cleanliness ile karıştırılamaz.
3. Acceptance storage-policy kimliğinin external root için aynı kalması veya version artışı açıkça kararlaştırılmalıdır; otomatik marker rewrite yapılamaz.
4. Relocation-target ve old-root quarantine protected-root rolleri eklenmeden mutation planlanamaz.
5. Rollback authority token’ı, süresi ve izin verilen durumları belirlenmelidir.
6. Scripts fixture/live root ayrımını explicit context ile yapmalıdır.
7. Asset logical locator/URL sözleşmesi değişmemeli; physical absolute path manifest/URL’ye sızmamalıdır.
8. FFmpeg/FFprobe input, temp output, final output ve cleanup aynı frozen context altında kalmalıdır.
9. External root için filesystem class, ACL/write access, capacity, directory durability/fsync ve reparse policy kanıtı gerekir.

## Mimari karar seçenekleri

| Konu | Seçenekler | Artı / eksi | Önerilen karar |
|---|---|---|---|
| Relocation çalışma modeli | Online dual-write; online shadow-read; offline stop-the-world | Online modeller availability sağlar fakat mevcut single-authority ve durable modelde split-brain riski yüksektir. Offline model kısa kesinti karşılığında kanıtlanabilir tek authority sağlar. | **Offline stop-the-world.** Production admission kapatılır, worker drain edilir, durable quiescence kanıtlanır; sonra consume/materialize yapılır. |
| Authority ilanı | Environment değişikliği; mutable claim replace; versioned transition record + exclusive active marker | Env tek başına durable değildir. Mutable replace rollback/yarış kanıtını kaybeder. Versioned record audit ve no-clobber sağlar. | **Versioned authority transition + exclusive active-generation marker.** CAS/no-clobber ve exact previous generation binding zorunlu. |
| Worker/durable quiescence | Süre bekleme; process kill; lifecycle drain + durable scan | Süre/kill kalıcı state’i kanıtlamaz. Drain+scan active lease/claim/attempt olmadığını gösterir. | **Admission off → drain → zero active execution → durable recovery scan clean → quiescence artifact.** |
| Candidate consume | Candidate path’ini live root yapma; arbitrary copy; verified consume service | Direct use immutable candidate’ı live mutable root’a dönüştürür. Arbitrary copy binding kaybeder. | **Ayrı verified consume service:** strict final verify, backup binding, identity/policy, freshness/quiescence, exclusive empty target ve post-copy verify. |
| Eski root | Sil; writable rollback root; read-only quarantine | Silme rollback’i yok eder. Writable eski root iki authority yaratır. | **Identity-bound salt-okunur quarantine; serving ve resolver’dan çıkarılmış.** |
| Rollback | Env’i geri çevir; iki root arasında seçim; token-bound reverse transition | Env değişimi state bütünlüğünü kanıtlamaz. Serbest seçim split-brain yaratır. | **Yalnız cutover sonrası yeni root’ta mutation/production başlamamışsa veya explicit reverse migration doğrulanmışsa, tek-kullanımlık rollback authority token’ı.** |
| Git untracking sırası | Relocation öncesi; cutover ile aynı transaction; cutover doğrulamasından sonra ayrı sprint | Önce untracking source evidence’i kaybettirir. Aynı transaction blast radius’i büyütür. | **Verified external authority ve old-root quarantine doğrulandıktan sonra ayrı Git sprinti.** |
| Marker/fingerprint | Her root değişiminde rewrite; tamamen aynı tut; policy profile version artışı | Physical path rewrite portability’yi bozar. Aynı tutmak yanlış semantics’i saklayabilir. | **Marker physical path’ten bağımsız kalır; mevcut marker rewrite edilmez. External storage semantics değişirse yalnız future marker için versioned policy profile kararı alınır.** |
| External root admission | Path exists yeterli; active write probe; full capability profile | Exists güvenlik/durability kanıtlamaz. Probe side-effect üretir. | **Operation-owned temp probe:** fixed/local policy, ACL read/write, exclusive create/publish, cleanup, capacity, path limits, reparse rejection ve directory durability raporu. |
| Git evidence | External tree’yi Git ile eşleştir; Git’i tamamen kaldır; byte authority + ayrı repository evidence | External tree repo altında değildir. Git’i tamamen kaldırmak historical evidence’i kaybettirir. | **Byte/manifest authority zorunlu; Git HEAD/index yalnız informational repository evidence, live freshness kaynağı değil.** |
| `data/visuals` | Runtime’a dahil et; repository-local bırak; kaldır | Dahil etmek migration scope’unu büyütür. Belirsiz bırakmak gizli second root yaratır. | **Bu dosya kümesinin production authority olup olmadığı ayrı envanterle kararlaştırılsın; karar verilene kadar relocation scope dışı ve production input olarak yasak kabul edilsin.** |

## Önerilen sonraki sprint dizisi

Numaralar mimari onay sonrası kesinleşecek öneri sırasıdır; hiçbiri bu audit tarafından başlatılmaz.

| Sıra | Önerilen sprint | Amaç | Owner | Blast | Bağımlılıklar | Kapattığı gate | Kapsam dışı |
|---:|---|---|---|---|---|---|---|
| 1 | C.2B.4 — Operation-Scoped Runtime Context Propagation | Project/pipeline/asset/snapshot/FFmpeg çağrı zincirinde tek frozen context | Runtime + Projects | HIGH | C.2B.3 approval | split-brain context P0 | serving adapter, relocation |
| 2 | C.2B.5 — Runtime Asset Serving Adapters | Image/audio route’larını storage service’e taşımak; video/thumbnail contract’ını sabitlemek | API + Assets | HIGH | C.2B.4 | stale legacy serve/direct-fs P0 | URL değişikliği, migration |
| 3 | C.2B.6 — Production Composition & Durable Authority Binding | Startup, worker, recovery ve durable adapters’ı aynı authority generation’a bağlamak | Runtime + Production | HIGH | C.2B.4 | durable split-brain/two authority P0 | quiescence veya switch |
| 4 | C.2B.7 — Fail-Closed Project Read Semantics | missing, malformed, IO ve security hatalarını ayırmak | Projects | MEDIUM | C.2B.4 | missing masking P1 | schema migration |
| 5 | C.2B.8 — External Runtime Evidence Model | Backup/candidate Git evidence ayrımı, marker policy ve `data/visuals` kararları | Runtime + Production | HIGH | C.2B.4, C.2B.7 | wrong Git/policy P1 | candidate consume |
| 6 | C.2B.9 — Relocation Authority & Quiescence Protocol | Versioned authority generation, drain ve durable clean evidence sözleşmesi | Security + Production | HIGH | C.2B.6, C.2B.8 | authority/quiescence P0 | data copy, cutover |
| 7 | C.2B.10 — Verified Candidate Consume & Offline Materialization | Verified candidate’dan empty exclusive target’a no-clobber materialization | Runtime | HIGH | C.2B.9 | target overwrite/mix P0 | authority switch, production execution |
| 8 | C.2B.11 — Old-Root Quarantine & Rollback Contract | Eski root’u read-only quarantine yapmak ve rollback token kuralları | Security + Runtime | HIGH | C.2B.10 | two-root/rollback P0-P1 | Git untracking, cutover |
| 9 | C.2B.12 — Controlled Runtime Git Untracking | Verified external authority sonrasında tracked/ignored runtime Git policy’sini değiştirmek | Scripts + Git/Runtime | HIGH | C.2B.11 | stale tracked runtime P0 | root switch logic |
| 10 | C.2B.13 — Controlled Cutover & Production Validation | Tek authority switch, post-cutover readiness ve bounded production validation | Runtime + Production | HIGH | C.2B.4–C.2B.12 | final relocation gates | broad refactor, online dual-write |

## Gerçek relocation öncesi zorunlu kabul kriterleri

- BLOCKING sınıfındaki dört entrypoint ailesi kapanmış olmalı.
- Tek process/operation `RuntimeStorageContext` ve versioned authority generation taşımalı.
- Image/audio/video/thumbnail serving aynı logical locator authority’sini kullanmalı.
- Durable scan active lease/claim/attempt/worker olmadığını kanıtlamalı.
- Candidate strict final verify, exact backup binding, semantic identity ve policy identity ile consume edilmeli.
- Target empty, operation-owned, protected-root compatible ve no-clobber olmalı.
- Post-materialization byte inventory, marker, durable aggregate ve manifest binding exact olmalı.
- Old root serving/writing’den çıkarılmış read-only quarantine olmalı.
- Rollback tek authority token’ıyla ve açık precondition’larla sınırlı olmalı.
- Git untracking yalnız verified external authority sonrasında ayrı change set olarak yapılmalı.
- `cutoverAuthorized` ayrı onaylı sprint sonuçlanana kadar false kalmalı.

## C.2B.3 kabul kriterleri

- Bütün production storage entrypoint aileleri owner, locator, resolver, context, authority, safety, durable/Git bağı, external uyum, sınıf ve blast radius ile kayıtlıdır.
- P0/P1 gate’leri ve BLOCKING dosya referansları açıktır.
- Mimari seçenekler tek çözüm uygulanmadan artı/eksi ve önerilen kararlarla belgelenmiştir.
- Sonraki implementasyon işleri küçük, sıralı ve bağımlılıkları açık sprintlere ayrılmıştır.
- Audit mutation-free kalmıştır; production testleri çalıştırılmamıştır.
- C.2B.3 `In Review` durumundadır; independent audit review olmadan `Completed` değildir.

## Net audit sonucu

Mevcut repo gerçek relocation için hazır değildir; dört P0 BLOCKING ailesi ve bağlı policy/adapter işleri vardır. Bununla birlikte bağımlılık ve karar kapsamı mimari inceleme için yeterince kesindir. Bu belge yalnız independent audit review girdisidir ve relocation/cutover yetkisi üretmez.
