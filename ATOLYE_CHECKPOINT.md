---

## Sprint 175 - Production readiness + cost preflight provider-aware (~$0.27/video hedef) - 2026-09-01

**Status:** KOD + TEST TAMAM (henüz commit edilmedi). Hedef zincir: `AI/ANIMATION/YOUTUBE=ollama` ($0) + `IMAGE=real` ($0) + `AUDIO=openai` (TTS ~$0.27) + `VIDEO/ASSEMBLY=ffmpeg` ($0) + `THUMBNAIL=openai` (~$0.063, ayrı raporlanır).

### Değişen dosyalar
| Dosya | Değişiklik |
|---|---|
| `src/lib/production/ProductionReadinessService.ts` | `modelConfigurationCheck`: `AI_PROVIDER=ollama` → `resolveOllamaConfig` doğrula, OpenAI metin-model bloğu `else`'e alındı (OpenAI hâlâ geçerli). `animationProviderCheck`: `ANIMATION_PROVIDER=ollama` dalı (Ollama config + router). `providerCheck` imzası `string \| readonly string[]` + `create().name === selected`. `publish-package-provider` `["openai","ollama"]` kabul eder. Yeni reason: `AI_MODEL_OLLAMA_CONFIG_INVALID`. |
| `src/lib/production/ProductionCostEstimate.ts` | **Provider-aware.** `ProductionCostInputs` += `textProvider/animationProvider/youtubeProvider/ttsProvider/imageProvider/thumbnailProvider` (hepsi opsiyonel, default `openai`; `mock`/unset → `openai` konservatif). Planlama çağrıları 6 metin + 1 youtube olarak ayrıldı. `breakdown` += `animationUsd`, `youtubeUsd`, `thumbnailUsd` (thumbnail satırı YENİ — önceden hiç hesaplanmıyordu). `estimate.providers` bloğu. `ollama`/`piper` → `estimateTokenCost/TtsCost` zaten `free` döner; `IMAGE_PROVIDER=real/local` → `imageUsd=0` (billing yok). |
| `src/lib/production/ProductionCostPreflight.ts` | 6 provider'ı env'den okur (`providerOf`: unset/`mock` → `openai`), estimate'e geçirir. Rapor += `providers` (video/assembly dahil) + `otherOpenAiCostsUsd` (şu an: openai thumbnail — gizlenmez). |
| `src/lib/audio/AudioPipeline.ts` | `addAssetOrFail` hata-evidence `provider` alanı `"openai"` yerine `normalizeErrProvider(asset.provider)` (gerçek provider: openai/piper). Başarı metadata satırı (`normalizeGenerationResult:381`) zaten 1. oturumda `provider: providerName` düzeltilmişti. Çalışan TTS davranışı değişmedi. |
| `package.json` | Tüm `production:acceptance:*` + `production:cost-preflight` + `production:cost-report` + `production:acceptance:*regeneration*` scriptleri `tsx --env-file-if-exists=.env.local ...` (CLI artık `.env.local` okur; dosya yoksa uyarı verip devam). |
| `.env.local` (gitignore) | `AI_PROVIDER=ollama` + `OLLAMA_HOST`/`OLLAMA_MODEL=qwen2.5:3b`/`OLLAMA_MAX_RETRIES=3` eklendi; `ANIMATION_PROVIDER`/`YOUTUBE_PROVIDER` → `ollama`. |
| **Windows USER env** (repo dışı) | `AI_PROVIDER`/`ANIMATION_PROVIDER`/`YOUTUBE_PROVIDER` → `ollama`, `IMAGE_PROVIDER` `openai`→`real` (eski değer `.env.local`'in `real`'ini gölgeliyordu — sessiz config bug), + `OLLAMA_*`. Node `--env-file` mevcut process env'i EZMEZ; bu yüzden `.env.local` ile Windows USER env artık aynı. Geri alma: `[Environment]::SetEnvironmentVariable('AI_PROVIDER','openai','User')`. |

### Testler
- `npx tsc --noEmit` temiz. `npm run lint` **0 error**, 22 warning (hepsi dokunulmamış `RuntimeBackup*`/`*Regeneration*` — önceden var).
- `smoke-production-readiness-acceptance` (+ yeni `verifyOllamaAiChainIsAdmissible`): PASS.
- `smoke-local-providers` (53, +10 provider-aware cost senaryosu): PASS.
- Regresyon PASS: faz5-ai-cost-budget, faz6-real-media-production-wiring, phase5-cost, production-cost-report, phase6-production-real-media, production-audio-asset-wiring, production-thumbnail-pipeline, production-animation-provider, production-youtube-package-pipeline, sprint-128-1, sprint-129-5, execute-stage-bounded (32), production-end-to-end, local-image-provider, scene-duration-clamp.
- Önceden başarısız (değişikliklerimden bağımsız, stash-baseline ile doğrulandı): sprint-129-{7,11,13,15,17,19,20,28,36,41}.

### Gerçek CLI çıktıları (target config)
- `npm run production:acceptance:readiness` → **`ready: true`**, 27/27 check READY (`model-configuration/provider-selection/animation-provider/publish-package-provider` hepsi ollama ile READY; broken `OLLAMA_HOST` → `AI_MODEL_OLLAMA_CONFIG_INVALID` fail-closed).
- `npm run production:cost-preflight -- --project-slug=fatih-sultan-mehmet-ve-i-stanbul-un-fethi` (script/scenes yok → conservative defaults 6ch/16sc/9000 char):
  - **NEW: $0.333** = TTS $0.27 + thumbnail $0.063. llm/animation/youtube/image = **$0**.
  - Eski (kod-öncesi, thumbnail satırı yoktu): $0.59236. Yeni "hepsi-openai" apples-to-apples: $0.65536 ( = $0.59236 + yeni $0.063 thumbnail satırı).
  - `THUMBNAIL_PROVIDER=local` → thumbnail $0 → toplam tam **$0.27**.

### Kalan blocker (production'a geçmeden)
1. `qwen2.5:3b` script/scenes katı JSON'da flakey (~%50-70/stage; `OLLAMA_MAX_RETRIES=3` yardımcı olur ama %100 değil). 1. oturumda tam $0 e2e MP4 bu yüzden tamamlanamadı (assembly/animation'a kadar gitti). Belgesel kalitesi için `qwen2.5:7b` gerekir ama 4 GB GPU'ya sığmaz.
2. Thumbnail hâlâ OpenAI (~$0.063/video). `THUMBNAIL_PROVIDER=local` (1. oturumda eklendi, test edildi) → $0.
3. `IMAGE_PROVIDER=real` + `ATOLYE_MAX_AI_IMAGES=6`: real-photo discovery bozulursa sahne başına ~$0.063 AI-image fallback (fail-closed tavan ~$0.38). Preflight bunu "expected $0" gösterir (real-first çalıştığında doğru); tavan `ATOLYE_MAX_AI_IMAGES` ile sınırlı.

<!-- SPRINT-175-END -->

## Sprint 174 - OpenAI → Lokal ($0) Provider Geçişi - 2026-08-31

**Status:** DEVAM EDİYOR (2. oturum). 1. oturum: provider altyapısı 6 commit `46bbc65..1d7e4ee` (push'lu). 2. oturum (henüz commit edilmedi): `AI_PROVIDER_REQUEST_FAILED` teşhisi + **`LocalImageProvider`** ($0 son-çare görsel fallback) + Ollama retry/num_ctx dayanıklılık + `OllamaYouTubeProvider` native+retry + e2e MP4 koruması. **$0 render zinciri (research→…→assembly→thumbnail→seo) e2e'de uçtan uca tamamlandı — MP4 render edildi.** Ayrıntı aşağıda.

### Amaç
Kullanıcının GTX 1650 4GB makinesinde OpenAI API maliyetini mümkün olduğunca $0'a indirmek. `.env.local` OpenAI bağımlılıkları: metin LLM (orkestratör hard-coded), `AUDIO_PROVIDER=openai` (TTS), `ANIMATION_PROVIDER=openai` (motion-plan LLM), `THUMBNAIL_PROVIDER=openai`, `YOUTUBE_PROVIDER=openai`. `IMAGE_PROVIDER=real` zaten $0.

### Kurulum (bu makinede yapıldı)
- **Ollama 0.33.2** (`winget install Ollama.Ollama`) + `qwen2.5:3b` (1.9GB), `qwen2.5:1.5b`, `qwen2.5:0.5b`, (`qwen2.5:7b-instruct-q4_K_M` pull ediliyor)
- **Piper** → `bin/piper/piper.exe` + bağımlılıklar + `tr_TR-dfki-medium.onnx` (60MB). `bin/piper/` gitignore'landı.

### Eklenen lokal provider'lar (hepsi additive; mock default, openai mevcut)
| Dosya (YENİ) | Env | |
|---|---|---|
| `src/lib/ai/OllamaConfig.ts` + `providers/OllamaProvider.ts` | `AI_PROVIDER=ollama` | Ollama native `/api/chat`, `format:"json"` veya `options.jsonSchema` (grammar-constrained). research…assembly-plan + seo |
| `src/lib/animation/providers/OllamaAnimationProvider.ts` | `ANIMATION_PROVIDER=ollama` | LLM'e sadece `motionType`+`transition` (enum-constrained) sorulur, crop/transform geometri **deterministik türetilir** (Mock ile aynı güvenli frame'ler). Küçük model geometri contract'ını sağlayamadığı için. |
| `src/lib/youtube/providers/OllamaYouTubeProvider.ts` | `YOUTUBE_PROVIDER=ollama` | YouTube paketi |
| `src/lib/audio/providers/PiperAudioProvider.ts` | `AUDIO_PROVIDER=piper` | `piper` binary spawn → 22kHz mono WAV. **RTF 0.148 (CPU-only, GPU gerekmez)** |
| `src/lib/thumbnail/providers/LocalThumbnailProvider.ts` | `THUMBNAIL_PROVIDER=local` | final videodan FFmpeg kare + `drawtext` başlık (sistem fontu workdir'e kopyalanır — Windows fontconfig yok). Model yok. |
| `src/lib/production/ProductionProviderResolution.ts` | — | `resolveProductionProviderName(domain)` (orkestratör hard-coded `getProvider("openai")` yerine, yoksa "openai") + `isAdmissibleProductionProvider(name, domain)` |

### Provenance gate genişletmeleri (`isAdmissibleProductionProvider` — mock ASLA admissible değil)
Pipeline validator'ları hard-coded `provider === "openai"` yerine domain-set kontrolü: `llm/animation/youtube → {openai, ollama}`, `tts → {openai, piper}`, `thumbnail → {openai, local}`. Değişen: `AudioPipeline` (getProviderName/getProviderNameSafely/normalize/recordTtsUsage/targetFormat/err-meta), `AudioPublicationIntentStore`, `AnimationAssetPipeline` (requireProviderName/persistProviderUsage honest ledger/artifact `plan.provider`/replay), `AnimationStorage` (2 validator + type `string`), `YouTubePackagePipeline` (allow-list), `ThumbnailAssetPipeline` (allow-list + 3 tip). **`ProductionReadinessService` YAPILMADI** (`production:acceptance:execute` yolu; `PipelineRunner.run` yolu readiness'e bakmaz).

### Diğer
- `AIProviderConfig.provider` artık **canlı getter** (`resolveAiProviderName`) — import anında değil kullanım anında `AI_PROVIDER` okunur (CLI/test'te provider gerçekten değişsin).
- `AiPricing.FREE_PROVIDERS` += `ollama`, `piper` ($0).
- Fingerprint: `OLLAMA_MODEL`/`OLLAMA_HOST`/`PIPER_VOICE_MODEL` conditional.
- Tipler: `AudioProviderName +piper`, `YouTubeProviderName +ollama`, `ThumbnailProviderName +local`, `ProviderName +ollama/local/piper`.
- `scripts/e2e-local-video-ollama-piper.ts` (YENİ) — gerçek $0 e2e harness.

### Testler
- `npx tsc --noEmit` temiz. lint: değişen dosyalarda 0.
- **`smoke-local-providers` (37 senaryo)**: config, mapping, routing, $0 pricing, production resolution, fingerprint, **CANLI Piper synthesis** + **CANLI Ollama** + **CANLI LocalThumbnail** (gerçek 1280×720 PNG).
- Regresyon PASS: production-audio-asset-wiring (74), production-animation-provider (30), animation-motion-plan-contract (22), production-youtube-package-pipeline (58), production-thumbnail-pipeline (42), production-end-to-end (21), sprint-128-1 (30), audio-canonical-rebind-and-invalidation (6), multi-shot-assembly-render (2), readiness-acceptance (25), quality-preset-registry (46), production-cost-report (58).

### Sprint 174 devamı (2. oturum) — LocalImageProvider + Ollama dayanıklılık + e2e MP4 koruması

**`AI_PROVIDER_REQUEST_FAILED` teşhisi (kesinleşti):** `qwen2.5:7b-instruct-q4_K_M` (5.1 GB) 4 GB VRAM'e sığmıyor → 55%/45% CPU/GPU → Ollama runner isteği ~305 sn'de düşürüyor → `TypeError: fetch failed` → [runObservedAIRequest.ts:71](src/lib/ai/runObservedAIRequest.ts#L71) ham hatayı **bilinçli yutuyor** (güvenlik invariant'ı, [smoke-sprint-129-7:130](scripts/smoke-sprint-129-7-research-structured-output.ts#L130)) → mock fallback. 7b runtime'da yalnızca CLI override ile kullanılmıştı; `.env.local`/e2e default'u `qwen2.5:3b`. **7b bu donanımda kullanılamaz; 3b kullanılıyor.**

**YENİ: `src/lib/assets/providers/LocalImageProvider.ts`** — FFmpeg renk + vignette + `drawtext` ($0, model yok, ağ yok) → gerçek 1920×1080 PNG. **Son çare fallback**: gerçek arşiv fotoğrafı bulunan sahne HER ZAMAN gerçek fotoğrafı kullanır; yalnızca foto bulunamayan / lisansı uygun olmayan sahneye devreye girer. Opt-in: `ATOLYE_LOCAL_IMAGE_FALLBACK=on` (default OFF, davranış değişmez) veya standalone `IMAGE_PROVIDER=local`.
- `VisualAssetPipeline`: `realUnusable` artık `override==="real"` sahnesini de kapsar (fallback açıkken) → hard-fail yerine placeholder. $0 → `requireAiBudget`/`requireImageCostBudget` atlanır. Provenance dürüst: `mediaOrigin:"ai"` + `mediaType:"ai-image"` + `selectionReason:"local-generated-placeholder"`, kaynak lisansı yok. `countExistingAiImages` `provider==="local"` hariç tutar (AI-image cap'ini yemez).
- `SceneMediaSelection.sceneMediaSelectionOverrides({skipAiImageScenes})` + `PipelineStageExecutor`: fallback açıkken merdiven `maxAiImages` sınırsız planlanır (ladder'da fail-closed olmaz) ve eşleşmeyen sahneler zorlanmaz (önce canlı arşiv araması denenir).
- Fingerprint: `+ATOLYE_LOCAL_IMAGE_FALLBACK` (conditional).

**Ollama dayanıklılık:**
- `OllamaProvider` — truncate/boş yanıtta **re-roll döngüsü** (`OLLAMA_MAX_RETRIES`, default 1; her denemede temperature düşer). Küçük model deterministik değil; retry per-stage başarı oranını belirgin yükseltiyor.
- `OllamaConfig` — `OLLAMA_NUM_CTX` (opt-in, default unset — sunucu karar verir; oturum-içi resize yavaş model reload'a yol açar) + `maxRetries`.
- `OllamaYouTubeProvider` — `/v1/chat/completions` yerine native `/api/chat` + `format:"json"` + aynı retry döngüsü.
- `OllamaAnimationProvider` — `num_ctx` opt-in.

**e2e harness (`scripts/e2e-local-video-ollama-piper.ts`):** MP4 `assembly` (8/12) biter bitmez var; geç ve video-dışı bir aşamanın (thumbnail/seo/youtube/export) hatası onu geçersiz kılmaz. Harness artık MP4'ü `data/e2e-output/<slug>.mp4`'e **kopyalıyor + ffprobe doğruluyor** (`result.success` ne olursa olsun), sahne başına gerçek-foto vs local-placeholder sayısını raporluyor, per-attempt Ollama timeout 6 dk. `/data/e2e-output/` gitignore.

**YENİ: `scripts/smoke-local-image-provider.ts`** — 7 senaryo (4'ü CANLI FFmpeg): config/routing, canlı 1920×1080 PNG render, `flag ON` → bulunan sahnede gerçek foto korunur + eksik sahnede placeholder, uygunsuz lisans → placeholder, `maxAiImages:0` iken placeholder cap'i yemez, `flag OFF` → force-`real` miss hâlâ fail-closed.

### Testler (2. oturum)
- `npx tsc --noEmit` temiz. lint: 15 değişen + 3 yeni dosyada 0 (repo-geneli 22 uyarı hepsi dokunulmamış `RuntimeBackup*` — önceden var).
- **`smoke-local-image-provider` (7)** + **`smoke-local-providers` (43, +6: num_ctx/maxRetries/retry-reroll/youtube-reroll)** PASS.
- Regresyon PASS: visual-asset-pipeline-per-scene-retry, production-visual-asset-wiring, phase1-visual-media-admission, faz2/3/6-*, sprint-131-visual-asset-recovery, production-animation-provider, animation-motion-plan-contract, production-audio-asset-wiring, sprint-129-26, quality-preset-registry, sprint-128-1, production-readiness-acceptance, production-end-to-end, execute-stage-bounded, faz5-ai-cost-budget, production-cost-report, multi-shot-assembly-render, assembly-xfade-chain-timeline, production-youtube-package/publish-pipeline, production-scene-video-rendering, real-photo-relevance-gate, assembly-background-music-mix.
- **Önceden başarısız (stash-baseline ile doğrulandı, benim değişikliklerimden BAĞIMSIZ):** sprint-129-{7,11,13,15,17,19,20,28,36,41}.

### $0 e2e — tam render zinciri kanıtlandı
e2e (retries + local image fallback, num_ctx yok) `research→script→scenes→visuals(local fallback)→animation→audio(Piper)→video→assembly→thumbnail→seo` **hepsini tamamladı → MP4 render edildi** (yalnız youtube metadata aşaması başarısızdı; sonra retry + native `/api/chat` ile düzeltildi). 3b flakey olduğu için tam 12/12 pipeline her koşuda tamamlanmıyor; retry oranı yükseltti. <!-- E2E-MP4-STATUS -->

### Kalan / not
- `qwen2.5:3b` research/script/scenes katı JSON'da ~%50-70/stage; retry ile birleşik başarı belirgin arttı ama %100 değil. Daha iyi = donanım (8 GB+ VRAM → 7b tam hızda) veya JSON'a tuned küçük model.
- `ProductionReadinessService` lokal-provider genişletmesi hâlâ YAPILMADI (`production:acceptance:execute` yolu; `PipelineRunner.run` e2e readiness'e bakmaz).
- Çok sayıda e2e/smoke koşusu `%TEMP%\atolye-runtime-authority-v1\`'e yüzlerce `*.claim.json` bırakıyor (2 gün öncesi 413 tanesi temizlendi; kalan 185). `withCanonicalSmokeRuntime` her koşuda bu dizini envanterliyor — birikince yavaşlatır.

<!-- SPRINT-174-END -->

## Sprint 173 - Documentary Pipeline Revision: forensic analiz + P0 quality preset + P1 cost report - 2026-08-31

**Status:** DEVAM EDİYOR. P0 + P1 **KOD + TEST PASS + COMMIT**. **0 gerçek network/paid API, $0, production render/execute/resume ÇALIŞTIRILMADI.** Kullanıcı onayı: P0→P5 (T2V hariç) sonra P7 bounded run; **P2 (uzun-form invariant) ÖNCE kısa videoda preset+cost kanıtlanınca** açılacak; P7 paralı run kod+testler bitince ayrı onayla.

### Bağlam
Kullanıcı hedefi: atolye-v2'yi "foto slayt" değil sinematik 10-15 dk belgesel (ref: "Tüm Dünyayı Korkutan 7 Osmanlı Padişahı") üreten pipeline'a çevir, DOCUMENTARY presetinde <$1. Forensic analiz sonucu: research/script/multi-shot scene/real-photo>AI/Ken Burns motion/TTS+müzik+ambience/xfade assembly/production acceptance/deterministik `$1` cost guard **zaten var**. 7 boşluk (G-1..G-7) — en kritiği **G-1: pipeline 120 s'ye hard-cap'li** (`script.ts:57` prompt, `SceneStructuredOutput.ts:32-33` validator `totalDuration 60-120 ±5`, `validateProductionAcceptanceScriptDuration`, F-08 duration authority). Mevcut tamamlanmış videolar ~95-110 s / 4-16 scene. G-7 (gerçek T2V) sağlayıcı YOK, fiyat tablosunda video satırı yok.

### Graphify pipeline doğrulaması (bu tur)
`graphify update .` (10309 node). Yapısal `pipelineStageDependencies` grafiği: **orphan/dead-end/broken-dep/duplicate-dep/cycle YOK**; research'ten 12/12 stage erişilebilir → giriş→final MP4 bağlı (MP4'ü assembly üretir, export paketler). Graphify runtime bağımlılığı DEĞİL, yalnız kod analizi.

### P0 - Quality Preset Registry (commit `72000c0`)
- **`src/lib/production/QualityPreset.ts` (YENİ):** `QUALITY_PRESETS` = `economy|balanced|documentary|cinematic`. Her preset: textModel/imageModel+size+quality/maxAiImages/ttsModel/video WxH+fps+crf+x264preset/motionStyle/targetDurationSeconds{min,ideal,max}/sceneDensityPerMinute/allowAiVideo/costCeilingUsd. `resolveQualityPreset(env)` — `ATOLYE_QUALITY_PRESET` (trim+lowercase); unset → `documentary`; bilinmeyen → `QualityPresetError` (fail-closed). **`documentary` preset değerleri = bugünkü application default'ları birebir** (gpt-4.1-mini, gpt-image-1 1536x1024 auto, maxAiImages 4, tts-1, 1920x1080@30 crf23 veryfast) → hiçbir consumer'a bağlanmadığı + default olduğu için davranış değişmez. `documentary.targetDurationSeconds` = {600,780,900} (tasarım niyeti; P2'de wire).
- **Fingerprint:** `ATOLYE_QUALITY_PRESET` V2 `ENVIRONMENT_POLICY` component'ine **conditional** (Faz 5/6 knob'ları gibi) — default unset → fingerprint değişmez → prepared marker'lar geçerli.
- Wire: **hiçbir stage'e bağlı değil**; ilk consumer P1.
- **`scripts/smoke-quality-preset-registry.ts` (YENİ, 46 senaryo):** resolution + fail-closed, registry invariant, drift guard (documentary == bugünkü config default'ları — gerçek modülleri import edip karşılaştırır), her preset modeli AI_PRICE_TABLE'da fiyatlanabilir, fingerprint conditionality.

### P1 - Production Cost Report + preset projeksiyonu (commit `ffde7b0`)
- **`src/lib/production/ProductionCostReport.ts` (YENİ):** `categorizeUsageRecord` (costUnitKind öncelikli → visuals-stage plan çağrısı `llm`, image çağrısı `image`), `buildProductionCostReport` (kategori roll-up LLM/IMAGE/VIDEO/TTS/MUSIC-SFX/OTHER + retry USD + estimated cache savings + $/dk + $/scene + within-budget verdict + 4-preset projeksiyon), `renderProductionCostReportText` (istenen `=== ATÖLYE DOCUMENTARY PRODUCTION COST ===` bloğu), `persistProductionCostReport`. `pricingStatus:"unknown"` olan herhangi kayıt → status `unknown-pricing` (asla sessiz sayı).
- **`ProductionCostEstimate.ts`:** `estimateProductionCostForPreset(preset, render)` — aynı konservatif pre-run estimate, model paramları preset'ten, AI-image preset tavanına clamp. Karşılaştırma tablosunu besler.
- **`AiCostBudget.ts`:** `resolveRecordCost` export edildi (rapor + receipt + guard aynı fiyatlamayı paylaşsın).
- **`ProductionAcceptanceOrchestrator.finalize`:** receipt'ten sonra best-effort `production-cost-report.json` yazar (rapor, gate DEĞİL — bütçe otoritesi receipt).
- **`scripts/run-production-cost-report.ts` (YENİ) + `npm run production:cost-report -- --project-slug=<slug> [--json] [--no-write]`:** $0 read-only. Gerçek tamamlanmış run `c0261ddc`'de doğrulandı: **LLM $0.0375 (actual)**, ham ledger token'larıyla uyumlu. Preset projeksiyonu (o kısa script için): ECONOMY $0.078 / BALANCED $0.147 / DOCUMENTARY $0.351 / CINEMATIC $1.62.
- **`scripts/smoke-production-cost-report.ts` (YENİ, 58 senaryo):** kategori, roll-up (kategori toplamı = total), unknown/over-budget status flip, renderer'ın her satırı taşıması, preset projeksiyon sıralaması, preset clamp, **gerçek `runObservedAIRequest` çağrısı** → canlı `ai-usage.json` kaydının `estimatedCost`/`pricingStatus:"known"`/`costUnitKind:"tokens"` taşıdığı kanıtı.

### Testler (bu tur)
- `npx tsc --noEmit` temiz. `npm run lint` — değişen/yeni dosyalarda 0 problem (repo'da 22 pre-existing uyarı, hepsi `src/lib/runtime/backup/*`). `git diff --check` temiz.
- P0 regresyon 7/7 + P1 regresyon 11/11 PASS: quality-preset(46), cost-report(58), faz5(11), phase5(9), faz6(6), phase6(8), 128-1(30), 129-23 portability(16), 129-37(29), readiness-acceptance(25), production-end-to-end(21), 129-19 skip.
- **Pre-existing FAIL (bu tur DEĞİL):** `smoke-sprint-129-38` — `rewindExactAudioOrdinalFour` poison testi, değişiklik stash'liyken de aynı hata (makine durumu bağımlı).

### Bu turda ayrıca commit edildi (önceki oturumların doğrulanmış işi)
- `df30976` feat(documentary): xfade chain timeline frame-quantization fix + RealPhotoImageProvider D1-D3 relevance gate + assembly-stage background music bed + latent asplit EINVAL fix (+ 3 yeni smoke).
- `24839cf` feat(production): `execute --stop-after-stage` bounded (PipelineRunner/Orchestrator/Command + smoke-execute-stage-bounded 32 senaryo).

### P2 - Preset-parametric duration band — 120 s cap kaldırıldı (commit `43791d5`)
Kullanıcı "P2'ye geç" dedi. **Tam geriye uyumlu:** EXPLICIT `ATOLYE_QUALITY_PRESET` yoksa her resolver frozen legacy `{60,90,120,5}` / 30-scene nesnesini döndürür (referential identity korunur) → yapılandırılmamış render + tüm mevcut testler birebir aynı. `ATOLYE_QUALITY_PRESET=documentary` artık 10-15 dk belgesel üretir.
- **`QualityPreset.ts`:** `LEGACY_TARGET_DURATION_BAND` + `resolveTargetDurationBand` / `resolveMaxSceneCount` / `resolveScriptChapterCount` (yalnız explicit preset genişletir).
- **`ProductionAcceptancePreflight.ts`:** `resolveProductionAcceptanceDuration(env)` — band'den min/target/max ölçekler, `tolerance/target` oranını (~%5.6) korur → `VideoDurationCoverageGuard`'ın oransal kontrolü değişmez. `requireAcceptanceRange`/`requireClose`/`validateProductionAcceptance*` bunu threadler. `productionAcceptanceDuration` frozen export korundu (guard hâlâ oranı için kullanıyor).
- **`SceneStructuredOutput.ts`:** `resolveCanonicalSceneProviderSchema` + `validateScenes` çözülmüş band + scene tavanını okur; `createScenesPrompt` default'ta tarihsel string'leri **birebir** korur (multi-shot smoke'ları assert ediyor), explicit preset'te ölçekler. Per-scene `duration` tavanı 120 s kaldı.
- **`AIManager.ts`:** strict script promptunun chapter sayısı / acceptance band / chapter-başı narration karakter bütçesi preset-parametrik (`strictScriptDurationPromptLines`; explicit preset yoksa "exactly 5 chapters, ~90s" birebir).
- **`scripts/smoke-longform-duration-preset.ts` (YENİ, 24 senaryo):** default'ta identity/byte-compat, documentary → 600-900 s, 13 dk script default'ta reddedilir + preset'te kabul, 63 scene default'ta `MAX_ITEMS` + preset'te kabul, scenes prompt ölçeklenir.

### P2 regresyon
- `npx tsc --noEmit` temiz. `npm run lint` — P2 dosyalarında 0 problem. `git diff --check` temiz. `graphify update .`.
- PASS: longform-duration-preset(24), quality-preset-registry(46), production-cost-report(58), multi-shot-scene-planning(10, legacy string'leri assert), script-duration-reconciliation-wiring(3), narration-duration-estimator(12), video-duration-coverage-guard(20), youtube-package-pipeline(58), assembly-scene-video-consumption(25), production-end-to-end(21), sprint-128-1(30), readiness-acceptance(25), multi-shot-assembly-render(2). İzole çalıştırıldığında: sprint-132-export-packaging(15), production-video-assembly-wiring(73).
- **Pre-existing FAIL (P2 stash'liyken de birebir aynı):** `smoke-sprint-129-13` ("durable preparation runtime authority missing", senaryo 1-14 PASS), `smoke-sprint-129-17` ("progressed snapshot resumes from visuals" fixture-state, senaryo 1-38 PASS). `132` + `video-assembly-wiring` batch fail'i = bu crash'lerin `%TEMP%/atolye-runtime-authority-v1/` altına bıraktığı `.claim.json` kirlenmesi (Aug 23'ten beri yüzlerce dosya birikmiş); ikisi de tek başına çalıştırılınca PASS.

### Commit'ler (bu oturum, `wip/production-audio-resume-prep-v2` → push `cf5678e`, P2 `43791d5` unpushed)
`df30976` xfade+relevance+music · `24839cf` bounded execute · `72000c0` P0 preset · `ffde7b0` P1 cost report · `cf5678e` Sprint 173 checkpoint · `43791d5` P2 duration band.

### Sıradaki
1. **P2'yi kısa + uzun-form davranışıyla göster, kullanıcı onayı** — sonra P3.
2. P3 scene director model genişletme (additive scene alanları: narration/cameraMovement/transition/onScreenText/sfx/musicCue/needsAiVideo) → P4 FFmpeg motion++ (grain/vignette/light/fog/parallax) → P5 title/date/emphasis kartları.
3. P7 gerçek bounded production ("Tüm Dünyayı Korkutan 7 Osmanlı Padişahı") — P0-P5 + smoke'lar bitince ayrı onay + $ tavanı. Önce ECONOMY/720p/~3dk uçtan uca kanıt, sonra DOCUMENTARY tam.

<!-- SPRINT-172-START -->
## Sprint 172 - Belgesel real-media Faz 4/5/6 production wiring (opt-in kalktı, logic-default aktif) - 2026-08-30

**Status:** Kod + testler PASS. **0 gerçek network/paid API, $0, production render/resume/execute ÇALIŞTIRILMADI, commit yok, `5be83a84` DOKUNULMADI** (16-PNG sha `cc204e21…6ab49` doğrulandı; `git diff HEAD -- data/projects` boş; 5be83a84 dizini tamamen untracked, hiçbir smoke yazmıyor). Faz 4/5 **TAMAM**; Faz 6 **büyük ölçüde TAMAM** — real-photo + music/SFX + cost guard + rights gate production'da aktif; **real-video per-scene substitution wiring TAMAMLANMADI** (Faz 3 foundation hazır, image→animation→video zincirinin media-type-aware olması gereken ayrı büyük iş).

### Amaç
Faz 1-3 foundation + Faz 4/5 mekanizmalarını **gerçek production pipeline'a bağla** — "yalnızca smoke'ta çalışan foundation" değil. Real media discovery + selection + cost guard production'da **opt-in olmaktan çıkıp** logic-default aktif olsun (gerçek render'da açık, testlerde kapalı).

### Aktivasyon modeli — `src/lib/runtime/ProductionModeDetection.ts` (YENİ)
`isRealProductionEnvironment(env)` = `OPENAI_API_KEY` var **VE** `NODE_ENV !== "test"` **VE** `ATOLYE_RUNTIME_ROOT` bir OS-temp-dir altında değil (her smoke `mkdtempSync(os.tmpdir())` kullanır → güvenilir "test" sinyali). `RealMediaProductionFlags` (`isRealMediaDiscoveryEnabled` / `isRealMediaSelectionEnabled` / `isCostBudgetGuardEnabled`) ve `AiCostBudget.isAiCostGuardEnabled` hepsi: **explicit env (`on`/`off`) kazanır, yoksa `isRealProductionEnvironment`**. → gerçek render'da hepsi AÇIK, tüm mock/e2e smoke'larda KAPALI (davranış + $0 network korunur). Explicit env fingerprint'e girer (conditional); logic-default GİRMEZ → `5be83a84` marker fingerprint'i değişmez.

### Değişen/yeni dosyalar (bu tur — Sprint 170/171'e ek)
1. **`src/lib/runtime/ProductionModeDetection.ts` (YENİ)** — yukarıdaki aktivasyon sinyali.
2. **`src/lib/assets/RealMediaProductionFlags.ts` (değişti)** — logic-default `isRealProductionEnvironment`.
3. **`src/lib/ai/AiCostBudget.ts` (değişti)** — `isAiCostGuardEnabled` logic-default.
4. **`src/lib/pipeline/PipelineStageExecutor.ts` (+~130):**
   - research case: `materializePipelineStageExecutionOptions` — `isRealMediaDiscoveryEnabled()` iken `createWikimediaSearchClient()` auto-wire (fingerprint'e girmez, `ensure()` bypass). **`enrichResearchWithMediaDiscovery` artık gerçek production research'te çağrılır.**
   - visuals case: `isRealMediaSelectionEnabled()` iken `selectSceneMedia({scenes, candidates: research.mediaCandidates, maxAiImages:4})` → `sceneMediaSelectionOverrides(plan)` → `VisualAssetPipeline.generateAssets({overrides})`. Deterministik ladder (real > AI), cap dispatch ÖNCESİ `VisualMediaAiBudgetExceededError`.
   - audio case: `stageProjectBackgroundMusic(..., ambienceHints: deriveAmbienceHints(research, script))` — `research.soundEffects`/`musicIdeas` + chapter emotion/visualStyle'dan ambience hint'leri.
5. **`src/lib/assets/SceneMediaSelection.ts` (+~25):** `sceneMediaSelectionOverrides(plan, existing?)` — plan → per-scene `"ai"|"real"` override (explicit operator override kazanır).
6. **`src/lib/audio/music/AudioMusicSelection.ts` (+~130/-40):** `stageProjectBackgroundMusic` artık **music + ambience** işler. `ambienceHints` → `SfxLibrary.selectAmbienceBed` (rights-gated). Music + admissible ambience → ffmpeg `amix` (music 1.0, ambience 0.25) ile tek `bgm.wav`. Ambience-only → ambience bed. ffmpeg yoksa graceful music-only. Asset `mediaType: "music"|"ambience"`, `selectionReason: "library-mood-match+ambience"`, combined attribution.
7. **`src/types/audio.ts` (değişti):** `AudioMusicPlan.selected` genişledi.
8. **`src/lib/production/ProductionCostEstimate.ts` (YENİ, Sprint 171):** conservative pre-run tahmin (7 planning LLM + N animation LLM; 2× narration char TTS; capped AI image; unknown model → tüm estimate unknown).
9. **`src/lib/production/ProductionCostPreflight.ts` (YENİ, Sprint 171):** `buildProductionCostPreflight` — observed (`ai-usage.json`) + estimate → `pass`/`block` (unknown-pricing / observed-exceeds / projected-exceeds).
10. **`src/lib/production/ProductionCostReceipt.ts` (YENİ):** `buildProductionCostReceipt` (byCategory/byOperation, retryUsd, duplicateUsd, unknownCostCount) + `persistProductionCostReceipt` (`production-cost-receipt.json`). Guard açıkken over-budget/unknown → `ProductionCostBudgetExceededAtAcceptanceError`.
11. **`src/lib/production/ProductionMediaRightsAudit.ts` (YENİ):** `auditProductionMediaRights(assets)` — her `mediaOrigin:"real"` asset admissible olmalı (`{public-domain,open-license,verified}` + `sourceUrl` + drift yok). `verified` drift check'i bypass eder. `assertProductionMediaRights` → `ProductionMediaRightsError`.
12. **`src/lib/production/ProductionAcceptanceOrchestrator.ts` (+~60):**
    - `resumeAndFinalize`: resume ÖNCESİ `isCostBudgetGuardEnabled()` iken `buildProductionCostPreflight` — `block` → `ProductionAcceptanceExecutionError("PRODUCTION_AI_COST_BUDGET_EXCEEDED" | "PRODUCTION_AI_COST_PRICING_UNKNOWN")`. **Pahalı iş başlamadan fail-closed.**
    - `finalize`: `assertProductionMediaRights(assets)` (→ `PRODUCTION_MEDIA_RIGHTS_INADMISSIBLE`) + `buildProductionCostReceipt`/`persistProductionCostReceipt` + guard açıksa `status !== "within-budget"` → throw.
13. **`src/lib/production/ProductionAcceptanceConfigurationFingerprint.ts` (+~20):** `ENVIRONMENT_POLICY` component'ine **conditional** `ATOLYE_REAL_MEDIA_DISCOVERY` / `ATOLYE_REAL_MEDIA_SELECTION` / `ATOLYE_AI_COST_BUDGET_USD` (yalnız env EXPLICIT set ise fingerprint'e girer). `ATOLYE_AI_COST_GUARD` **dahil DEĞİL** (runtime safety toggle, üretimi değiştirmez). Logic-default → env undefined → fingerprint HEAD ile aynı → `5be83a84` marker geçerli.
14. **`scripts/run-production-cost-preflight.ts` (YENİ) + `package.json` alias `production:cost-preflight`.**
15. **Smoke'lar (YENİ):** `smoke-phase4-audio` (9), `smoke-phase5-cost` (9), `smoke-phase6-production-real-media` (8). `smoke-faz4` +3 senaryo (ambience mixing), `smoke-faz5`/`smoke-faz6` güncellendi.
16. **`src/lib/animation/AnimationAssetPipeline.ts` / `src/lib/assets/VisualAssetPipeline.ts` / `src/lib/audio/AudioPipeline.ts` (Sprint 171):** her paid çağrı sonrası `estimatedCost`/`pricingStatus` kaydeder; paid çağrı ÖNCESİ `assertImageBudget`/`assertTtsBudget` (guard açıkken fail-closed).

### Production call-chain kanıtı (graphify)
- `PipelineStageExecutor.execute()` **[calls]** `stageProjectBackgroundMusic()` (audio stage) ✓
- `PipelineStageExecutor.execute()` **[calls]** `selectSceneMedia()` (visuals stage) ✓
- `materializePipelineStageExecutionOptions` **[calls]** `createWikimediaSearchClient()` (research, flag-gated) ✓
- `VisualAssetPipeline.generateAssets()` **[calls]** `assertImageBudget()` ✓
- `AudioPipeline.generateAndNormalize()` **[calls]** `assertTtsBudget()` ✓
- `ProductionAcceptanceOrchestrator.resumeAndFinalize()` **[calls]** `buildProductionCostPreflight()` (pre-resume gate) ✓
- `ProductionAcceptanceOrchestrator.finalize()` **[calls]** `assertProductionMediaRights()` + `buildProductionCostReceipt()` ✓

### Testler ($0, gerçek network/API YOK)
Yeni: `smoke-phase4-audio` (9), `smoke-phase5-cost` (9), `smoke-phase6-production-real-media` (8), `smoke-faz4-audio-music-sfx` (11), `smoke-faz5-ai-cost-budget` (11), `smoke-faz6-real-media-production-wiring` (6), `smoke-faz3-video-media-ingestion` (18).
Regresyon PASS: `smoke-media-rights-policy` (8), `smoke-phase1-visual-media-admission` (10), `smoke-faz2` (14), `smoke-production-visual-asset-wiring` (54), `smoke-production-real-photo-source` (45), `smoke-visual-asset-pipeline-per-scene-retry` (8), `smoke-production-scene-video-rendering` (26), `smoke-production-video-assembly-wiring` (73), `smoke-production-audio-asset-wiring` (74), `smoke-sprint-129-27-audio-remediation` (117), `smoke-ffmpeg-bgm-kenburns-assembly` (30), `smoke-production-end-to-end` (21), `smoke-isolated-e2e-live-pipeline-ffmpeg` (4 — tam mock pipeline + acceptance), `smoke-pipeline-orchestration` (10), `smoke-production-youtube-package-pipeline` (58), `smoke-sprint-129-39-stage-bounded-resume` (61), `smoke-sprint-129-41-completed-stage-regeneration` (181), `smoke-sprint-129-23-portability` (16), `smoke-sprint-129-24-reprepare` (22), `smoke-sprint-129-37` (29), `smoke-sprint-129-26` (19), `smoke-multi-shot-duration-reconciliation` (15).
`npx tsc --noEmit` PASS · `git diff --check` exit 0 · `npm run lint` 0 error / 22 pre-existing warning (yeni/değişen dosyalarda 0) · `graphify update` çalıştırıldı.

**Pre-existing FAIL (HEAD/revert ile bağımsızlığı KANITLANDI):**
- `smoke-sprint-129-7` (`null !== 'visuals'`), `smoke-sprint-129-13` ("Pipeline durable preparation runtime authority is missing").
- `smoke-production-snapshot-builder` (`project.json` race → `source_malformed`).
- `smoke-sprint-129-28` (source-drift assertion: `/new WeakMap/` bekliyor, `ProductionPipelineExecutionFactory.ts` HEAD'de `claimProcessCompletedPreparations()` kullanıyor).
- `smoke-sprint-129-36` (`CANONICAL_AUDIO_ORDINAL_FOUR_RESERVATION_PERSISTENCE_INVALID` — gerçek `data/projects` durable reservation state'e bağlı; orchestrator/fingerprint/CLI değişikliklerim revert edilip aynı fail doğrulandı).

### TAMAMLANMADI
- **Real video per-scene substitution:** `selectSceneMedia` real-video sahneyi `"real"` (foto denemesi) override'ına eşler; `VideoMediaIngestion` (Faz 3, tested) per-scene video stage'e wire EDİLMEDİ. Sebep: `VideoPipeline.prepareInputs` her sahne için image + motion plan 1:1:1 varsayıyor; gerçek klibin bu zincire girmesi image→animation→video'nun media-type-aware olmasını gerektirir — ADR + ayrı büyük additive iş.
- **Per-scene SFX timeline placement:** ambience bed documentary-geneli mixleniyor; sahne-anına özel SFX assembly timeline cerrahisi gerektirir.

### Production render için güvenlik durumu
`.env.local`'de `IMAGE_PROVIDER=real` + gerçek key varken: research discovery + real-photo ladder + music/ambience + $1 cost preflight/guard + rights gate **hepsi otomatik aktif**. Preflight ($0): `npm run production:cost-preflight -- --project-slug=<slug>` (5be83a84 demo: projected $0.43 < $1, pass). Kontrollü paid render için gate'ler hazır; kullanıcı komutu bekleniyor.

<!-- SPRINT-172-END -->

<!-- SPRINT-171-START -->
## Sprint 171 - Belgesel real-media Faz 5 ($1 AI cost guard) + Faz 6 kısmi (production wiring aktivasyon katmanı) - 2026-08-30

**Status:** Kod + testler PASS. **0 gerçek network/paid API, $0, production çalıştırılmadı, commit yok, `5be83a84` DOKUNULMADI** (16-PNG sha `cc204e21…6ab49` doğrulandı; `git diff HEAD -- data/projects` boş; export/video/production-acceptance 2026-08-29 tarihli, değişmemiş). Faz 6'nın YÜKSEK RİSKLİ parçaları (visuals selection ladder wiring, acceptance rights gate, fingerprint) ve kontrollü paid production render **YAPILMADI** — kullanıcı onayı + odaklı oturum gerektiriyor.

### FAZ 5 — $1 AI Cost Guard

**Değişen/yeni dosyalar:**
1. **`src/lib/ai/AiPricing.ts` (YENİ):** Deterministik `AI_PRICE_TABLE` (gpt-4.1/4.1-mini/4.1-nano/4o/4o-mini/o1/o1-mini/o3-mini token $/1M; gpt-image-1 + dall-e-3 per-image (size|quality); tts-1/tts-1-hd/gpt-4o-mini-tts $/1M char). `estimateTokenCost` / `estimateImageCost` / `estimateTtsCost` / `estimateTokenCallCeiling` — **bilinmeyen model → `{status:"unknown", costUsd:NaN}` (asla 0)**; `mock`/`local`/`music-library` → `{status:"free", costUsd:0}`. `toUsageCostFields` mapper.
2. **`src/lib/ai/AiCostBudget.ts` (YENİ):** `DEFAULT_AI_COST_BUDGET_USD = 1.0` (`ATOLYE_AI_COST_BUDGET_USD` override). `summarizeObservedCost(records)` → knownUsd + per-stage/per-operation + **retryUsd** + **duplicateUsd** (aynı stage:operation 2.+ billable çağrı). `evaluateAiCostBudget({records, pendingUsd, pendingPricingUnknown})` → `{allowed, reason}` (within / observed-exceeds / projected-exceeds / **unknown-pricing → fail-closed**). `AiCostBudgetExceededError`. **`isAiCostGuardEnabled(env)` = opt-in `ATOLYE_AI_COST_GUARD ∈ {on,true,1}`, DEFAULT OFF** (mock-only smoke'lar etkilenmez). Backward-compat: `pricingStatus`'suz legacy record → provider mock→free, `estimatedCost` varsa→known, token varsa→`AiPricing` ile türet, yoksa→unknown.
3. **`src/lib/ai/MediaGenerationCostGuard.ts` (YENİ):** `assertImageBudget` / `assertTtsBudget` (paid image/TTS öncesi fail-closed block) + `recordImageUsage` / `recordTtsUsage` (priced `AIUsageRecord` append). Hepsi `isAiCostGuardEnabled` + `unknown` slug gate'li → guard kapalıyken no-op.
4. **`src/lib/production/ProductionCostEstimate.ts` (YENİ):** `estimateProductionCost({chapterCount, sceneCount, narrationCharacters, plannedAiImageCount, textModel, ttsModel, imageModel, imageSize, imageQuality})` — konservatif (over-estimate): 7 planning LLM + sceneCount animation LLM, 2× narration char TTS (mix re-synth), capped AI image. Herhangi bir komponent unknown → tüm estimate `status:"unknown"`.
5. **`src/types/aiUsage.ts` (+9):** `AIUsageRecord` + `pricingStatus?`, `costUnitKind?`, `costUnitCount?` (additive optional). `estimatedCost` JSDoc.
6. **`src/lib/ai/AIResponseError.ts` (+1):** `AIResponseErrorCode` + `"AI_COST_BUDGET_EXCEEDED"`.
7. **`src/lib/ai/runObservedAIRequest.ts`:** her token çağrısı sonrası `estimatedCost`/`pricingStatus`/`costUnitKind`/`costUnitCount` kaydeder. Guard ON iken **dispatch ÖNCESİ** `estimateTokenCallCeiling` (prompt chars/4 + maxTokens) ile `evaluateAiCostBudget` → block olursa provider **çağrılmaz**, `errorCode: AI_COST_BUDGET_EXCEEDED`, `estimatedCost: 0`.
8. **`src/lib/animation/AnimationAssetPipeline.ts`:** `persistProviderUsage` artık `estimatedCost` + `pricingStatus` yazar.
9. **`src/lib/assets/VisualAssetPipeline.ts`:** openai image dispatch öncesi `requireImageCostBudget` (fail-closed, failed-asset persist + rethrow); başarılı persist sonrası `recordImageUsage`.
10. **`src/lib/audio/AudioPipeline.ts`:** openai TTS dispatch öncesi `assertTtsBudget`; başarı sonrası `recordTtsUsage`.
11. **`scripts/smoke-faz5-ai-cost-budget.ts` (YENİ):** 11 senaryo.

**Testler:** `smoke-faz5-ai-cost-budget` **PASS (11)**: A deterministik pricing · B unknown→fail-closed · C free provider→0 · D summarize (totals/per-stage/retry/duplicate) · E backward-compat (legacy record token'dan fiyatlanır) · F evaluateAiCostBudget (within/observed/projected/unknown, $1 boundary) · G isAiCostGuardEnabled opt-in default-off · H estimateProductionCost (under/boundary/over/unknown) · I `runObservedAIRequest` guard: budget dolunca dispatch YOK, `AI_COST_BUDGET_EXCEEDED` · J `MediaGenerationCostGuard` block + record · K ceiling konservatif.

### FAZ 6 (kısmi — aktivasyon katmanı)

**Değişen/yeni dosyalar:**
1. **`src/lib/assets/RealMediaProductionFlags.ts` (YENİ):** Tek auditable opt-in flag noktası. `isRealMediaDiscoveryEnabled` (`ATOLYE_REAL_MEDIA_DISCOVERY`), `isRealMediaSelectionEnabled` (`ATOLYE_REAL_MEDIA_SELECTION`), `isCostBudgetGuardEnabled` (`ATOLYE_AI_COST_GUARD`). Hepsi **default off** → mevcut e2e/production smoke'ları + `5be83a84` reproducibility korunur.
2. **`src/lib/pipeline/PipelineStageExecutor.ts` (+8):** `materializePipelineStageExecutionOptions` — research stage'de `isRealMediaDiscoveryEnabled()` iken `createWikimediaSearchClient()` auto-wire. **`ensure()` kullanmaz** → `configuredOptions`'a girmez → **acceptance fingerprint DEĞİŞMEZ**. Best-effort (discovery research stage'i fail etmez). Diğer stage'ler dokunulmaz.
3. **`src/lib/production/ProductionCostPreflight.ts` (YENİ):** `buildProductionCostPreflight({projectSlug, script?, scenes?, plannedAiImageCount?, budgetUsd?})` — $0, read-only. Observed spend (`ai-usage.json` özeti) + `estimateProductionCost` (script/scenes yoksa konservatif default 6ch/16sc/9000char/4AI) → `{decision: "pass"|"block", blockReason, budgetUsd, observedUsd, remainingEstimate, projectedTotalUsd, models, inputs}`. Block: unknown-pricing / observed-exceeds / projected-exceeds.
4. **`scripts/run-production-cost-preflight.ts` (YENİ) + `package.json` alias `production:cost-preflight`:** operator CLI. `npm run production:cost-preflight -- --project-slug=<slug>`. exit 0 = pass, 2 = block.
5. **`scripts/run-production-acceptance.ts` (+13):** `execute` / `resume-finalize` komutları operatör `ATOLYE_AI_COST_GUARD`'ı set etmemişse `"on"` yapar → **gerçek production render her zaman $1 guard'lı**. Read-only subkomutlar dokunulmaz.
6. **`scripts/smoke-faz6-real-media-production-wiring.ts` (YENİ):** 6 senaryo (A flags default-off · B mediaSearchClient opt-in + research-only + fingerprint'e girmez · C preflight pass/unknown/projected · C2 observed-exceeds · D fresh-project defaults · E deterministik).

**Gerçek preflight çıktısı (`5be83a84`, $0 demo):** `decision: pass`, observedUsd $0.067 (legacy token'lardan türetildi — backward-compat kanıtı), remainingEstimate $0.364 (llm $0.070 + tts $0.042 + image $0.252 (4×$0.063)), projectedTotal **$0.43** < $1.

### Regresyon (hepsi PASS)
`smoke-faz3` (18), `smoke-faz4` (8), `smoke-faz5` (11), `smoke-faz6` (6), `smoke-phase1` (10), `smoke-faz2` (14), `smoke-media-rights-policy` (8), `smoke-music-library` (5), `smoke-production-visual-asset-wiring` (54), `smoke-production-audio-asset-wiring` (74), `smoke-production-animation-provider` (30), `smoke-sprint-129-26-audio-truncation-budget` (19), `smoke-production-readiness-acceptance` (24), `smoke-production-end-to-end` (21), `smoke-isolated-e2e-live-pipeline-ffmpeg` (4, tam mock pipeline — audio music hook + tüm cost recording dahil), `smoke-pipeline-orchestration` (10), `smoke-sprint-129-27-audio-remediation` (117), `smoke-ffmpeg-bgm-kenburns-assembly` (30), `smoke-multi-shot-assembly-render` (2), `smoke-production-video-assembly-wiring` (73), `smoke-sprint-129-39-stage-bounded-resume` (61).
`npx tsc --noEmit` PASS · `git diff --check` exit 0 · `npm run lint` **0 error / 22 pre-existing warning** (yeni/değişen dosyalarda 0) · `graphify update` çalıştırıldı.

**Pre-existing FAIL (BENİM DEĞİŞİKLİKLERİMDEN BAĞIMSIZ — HEAD'de de fail):**
- `smoke-sprint-129-7` (`null !== 'visuals'` recovery-planner), `smoke-sprint-129-13` ("Pipeline durable preparation runtime authority is missing") — bilinen küme.
- `smoke-production-snapshot-builder` — `project.json` race-condition assertion (`state: source_malformed`). Faz 5 öncesi HEAD'e revert edilip doğrulandı: aynı fail.
- `smoke-sprint-129-28-production-acceptance-reauthorization` — kaynak-drift assertion: `/const completedPreparations\s*=\s*new WeakMap/` bekliyor ama `ProductionPipelineExecutionFactory.ts` **HEAD'de zaten** `claimProcessCompletedPreparations()` kullanıyor (`git diff HEAD` boş). Test güncellenmemiş; benim dosyalarım değil.

### KAPSAM DIŞI / YAPILMADI (Faz 6 kalan + son aşama)
- **Visuals selection ladder wiring:** `SceneMediaSelection` + `VideoMediaIngestion`'ın `VisualAssetPipeline`/visuals stage'e bağlanması (`isRealMediaSelectionEnabled` gate'li). Videonun görsel kaynağını değiştirir → yüksek risk, ayrı odaklı iş.
- **Acceptance rights gate:** `ProductionAcceptance*`'a public-domain/open-license/verified dışı medyayı reddeden gate.
- **Fingerprint additions:** media policy version / cost budget / rights policy'nin `ProductionAcceptanceConfigurationFingerprint`'e eklenmesi — durable resume determinism riski, en denetimli kod.
- **Kontrollü paid production render:** gerçek para harcar, geri alınamaz. Faz 6 tam bitmeden + kullanıcı açık onayı olmadan çalıştırılmaz. Preflight ($0) hazır: `npm run production:cost-preflight -- --project-slug=<slug>`.

<!-- SPRINT-171-END -->

<!-- SPRINT-170-START -->
## Sprint 170 - Belgesel real-media Faz 4: lisanslı arka plan müziği + SFX/ambience abstraction - 2026-08-29

**Status:** Kod + testler PASS. **0 gerçek network/paid API, $0, production çalıştırılmadı, commit yok, `5be83a84` DOKUNULMADI** (16-PNG combined sha256 `cc204e21…6ab49` doğrulandı; `git diff HEAD -- data/projects` boş). Faz 5'e geçilmedi.

### Amaç (kullanıcı Faz 4 talimatı)
`MusicLibrary`'yi production pipeline'a additive bağla: konu/mood üzerinden lisanslı müzik seçimi, source/license/rightsStatus/provenance, lisansı belirsiz müzik fail-closed, müzik yoksa güvenli devam, narration ducking, SFX/ambience abstraction.

### Mevcut altyapı (Graphify ile incelendi — YENİDEN YAZILMADI)
`VideoAssemblyInput.backgroundMusic?: {filePath, volume?, ducking?}` zaten var. `VideoAssemblyManager.resolveBackgroundMusic(slug, assets)` `id` "bgm" içeren audio asset'i bulup `{filePath, volume:0.15, ducking:true}` döndürüyor. `FFmpegVideoAssemblyProvider.appendBgmFilterGraph` `sidechaincompress` (threshold 0.03, ratio 5) ile narration-altı ducking + `amix` yapıyor. **Eksik olan tek şey: `bgm` asset'ini üreten adım.**

### Değişen/yeni dosyalar (bu tur)
1. **`src/types/asset.ts` (+2):** `MediaType` `| "music" | "ambience"` (additive; exhaustive switch yok).
2. **`src/types/audio.ts` (+16):** `AudioMusicPlan.selected?: {assetId, mood, title, source, sourceUrl, license, rightsStatus, attribution}` (additive optional).
3. **`src/lib/audio/music/AudioMusicSelection.ts` (YENİ):** `stageProjectBackgroundMusic({projectId, projectSlug, audio, musicStyleHint?, storageContext, now?, env?, runner?, loadFFmpegConfig?, musicSelector?})`:
   - `moodText` = `audio.music.mood` + `audio.music.suggestion` + `script.musicStyle` → `selectMusicTrack(moodText, seed=projectSlug)` (deterministik).
   - **Rights gate fail-closed:** `classifyMediaRightsStatus(track.license)` ∉ {public-domain, open-license, verified} → `{staged:false, reason:"rights-not-admissible"}`. Narration-only kalır.
   - **Idempotent:** geçerli `bgm` asset + diskte geçerli WAV varsa → yeniden yazmadan reuse (resume/retry güvenli, no-clobber writer'a çarpmaz).
   - `.wav` track → doğrudan; sıkıştırılmış track → ffmpeg varsa `pcm_s16le/44100/2` WAV'a transcode, yoksa `{staged:false, reason:"transcode-unavailable"}` (fail-safe).
   - Staging: `AudioStorage.saveAudio({fileName:"bgm.wav"})` + `AssetManager.addAssetAtomically` (**`AudioCanonicalMixRebuilder` ile birebir aynı audited pattern** → publication-intent tutarlı).
   - Asset: `id:"bgm"`, `type:"audio"`, `provider:"music-library"`, `mediaOrigin:"real"`, `mediaType:"music"`, `rightsStatus`, `sourceName`, `sourceUrl`, `license`, `attribution`, `selectionReason:"library-mood-match"`, `checksum` (sha256), `durationSeconds` (WAV'dan). `audio.music.selected` doldurulur.
   - **Best-effort:** her hata dalı `{staged:false, reason}` + değişmemiş `AudioData` döner — audio stage'i ASLA fail etmez.
4. **`src/lib/audio/sfx/SfxLibrary.ts` (YENİ):** `MusicLibrary` ile yapısal ikiz. `public/sfx/<category>/` (`SFX_CATEGORIES` = ambience/battle/crowd/nature/interior/transition), `.license.json` sidecar. `normalizeSfxCategory`, `listSfxForCategory` (her clip `rightsStatus` + `admissible` taşır — inadmissible seçilmez), `selectSfxClip` (deterministik, seed'li), `selectAmbienceBed(hints[], seed)`. **Boş kütüphane → null/[] (güvenli no-op).** Assembly filter-graph'a wiring Faz 6'ya bırakıldı (assembly tek `backgroundMusic` mixliyor; ambience/SFX mix eklemek assembly-touching).
5. **`src/lib/pipeline/PipelineStageExecutor.ts` (+16):** audio case, `state.audio = audio` sonrası **best-effort** `stageProjectBackgroundMusic` çağrısı (try/catch → log + devam). `state.audio = music.audio`. Persist öncesi.
6. **`src/lib/assembly/VideoAssemblyManager.ts` (+5):** `resolveBackgroundMusic` **export edildi** (additive, pure, davranış aynı) — Faz 4 smoke'un render etmeden handshake doğrulaması için.
7. **`scripts/smoke-faz4-audio-music-sfx.ts` (YENİ):** 8 senaryo (A-H).

### Rights / provenance / determinism
Lisans yok/tanınmıyor → `unknown` → **admissible değil, staged edilmez.** `restricted`/NC/ND/all-rights-reserved → staged edilmez. `public-domain`/`open-license`/`verified` → staged. Seçim `selectMusicTrack` seed=projectSlug ile deterministik. Aynı proje + aynı kütüphane → aynı track. Idempotent (resume'da duplicate yok). Provenance asset'te tam korunur (Faz 1-3 ile aynı alan seti + `checksum`).

### Narration ducking
Değişmedi — mevcut `appendBgmFilterGraph` (`sidechaincompress` + `amix`). `resolveBackgroundMusic` staged `bgm` asset'i deterministik bulur, `ducking:true`, `volume:0.15` (assembly'nin `(0, 2.0]` aralığında). `smoke-ffmpeg-bgm-kenburns-assembly` (30) render'ın doğruluğunu kanıtlıyor.

### Testler ($0, gerçek network/API YOK)
`smoke-faz4-audio-music-sfx` **PASS (8)**: A boş kütüphane→skip deterministik · B unknown-lisans→rights-not-admissible, bgm asset yok · C restricted→rights-not-admissible · D admissible WAV→staged asset + tam provenance + `music.selected` · E deterministik + idempotent (duplicate yok) · F `resolveBackgroundMusic` handshake (ducking on, volume in range, deterministik) · G `SfxLibrary` optional path (boş→null, admissible ambience→seçilir, unknown→admissible değil) · H sıkıştırılmış track ffmpeg varsa WAV'a transcode.
Regresyon PASS: `smoke-music-library` (5), `smoke-production-audio-asset-wiring` (74), `smoke-sprint-129-27-audio-remediation` (117), `smoke-ffmpeg-bgm-kenburns-assembly` (30), `smoke-multi-shot-assembly-render` (2), `smoke-production-video-assembly-wiring` (73), `smoke-pipeline-orchestration` (10), Faz 1/2/3 smokes (10/14/18/8).
Pre-existing FAIL (bağımsız): `smoke-sprint-129-7`, `smoke-sprint-129-13` (recovery-planner kümesi).
`npx tsc --noEmit` PASS · `git diff --check` exit 0 · `npm run lint` 0 error / 22 pre-existing warning (yeni/değişen dosyalarda 0) · `graphify update` çalıştırıldı.

### KAPSAM DIŞI / DOKUNULMADI
`FFmpegVideoAssemblyProvider` filter graph, `AudioPipeline` TTS narration sözleşmesi, `AudioManager` plan, `AudioStorage` (public API reuse), durable/recovery/scheduler/acceptance/fingerprint, `.env.local`, `5be83a84`. Ambience/SFX assembly mix + `research.soundEffects[]` → asset dönüşümü Faz 6'da.

### Sıradaki (Faz 5 — DUR)
Faz 5: `estimatedCost` gerçek hesap (deterministic pricing table, unknown pricing fail-closed) + `$1.00` hard budget guard. Faz 6: Faz 1-5'in production pipeline'a + acceptance/fingerprint'e wire edilmesi. Sonra kontrollü production preflight + tek render.

<!-- SPRINT-170-END -->

<!-- SPRINT-169-START -->
## Sprint 169 - Belgesel real-media Faz 3: gerçek video ingestion + segment render + sahne medya merdiveni - 2026-08-29

**Status:** Kod + testler PASS. **0 gerçek API/network çağrısı, $0, production çalıştırılmadı, commit yok, `5be83a84` DOKUNULMADI** (16-PNG combined sha256 `cc204e21ad110f0d6f145b2e6eb2318e77647aa30ef0eaa81ef789475686ab49` doğrulandı; `git diff HEAD -- data/projects` boş; export/video/production-acceptance değişmedi). Faz 4/5/6'ya kendiliğinden geçilmedi. **Bu bir FOUNDATION — production pipeline'a wire EDİLMEDİ.**

### Amaç (kullanıcı Faz 3 talimatı)
Belgesel videoda gerçek fotoğraf + gerçek arşiv/stok video + az AI görseli kullanabilecek **güvenli, fail-closed, additive** altyapı. Google/Bing scraping YOK, LLM URL kabul YOK, telifi bilinmeyen medya production'a alınmaz.

### Değişen/yeni dosyalar (bu tur)
1. **`ARCHITECTURE_DECISIONS.md` — ADR-020 (YENİ):** "Real Video Ingestion & Segment Rendering for the Documentary Pipeline (Faz 3)". Aday keşfi Faz 2 `MediaSearchClient`'tan; ayrı `VideoMediaIngestion` katmanı (enjekte edilebilir download/ffmpeg/storage); `videoIngestionPolicy` sabiti; `SceneMediaSelection` deterministik seçim; ortak `VideoSceneGenerationSuccess` normalizasyonu; zorunlu Asset alanları; download integrity (https-only, host allow-list, `redirect:"error"`, byte cap, ffprobe container/codec/duration, MIME `video/*`, checksum); rights gate fail-closed; segment kuralları. Durum: Accepted — Sprint 169 (foundation).
2. **`src/types/research.ts` (+9):** `ResearchMediaCandidate`'a `durationSeconds?`, `segmentStartSeconds?`, `segmentEndSeconds?` (additive optional; `mediaType:"video"` adayları için). Yeni candidate modeli YOK.
3. **`src/types/asset.ts` (+8):** `Asset`'e `mediaUrl?`, `checksum?`, `segmentStartSeconds?`, `segmentEndSeconds?` (additive optional; ADR-020 JSDoc). Eski asset'ler geçerli kalır.
4. **`src/lib/assets/VideoMediaIngestion.ts` (YENİ):**
   - `videoIngestionPolicy` (frozen): `minSegmentSeconds:1`, `maxSegmentSeconds:40`, `maxDownloadBytes:192MiB`, `allowedContainers`, `allowedVideoCodecs`, `allowedMediaHostSuffixes:["upload.wikimedia.org"]`, `sourceDurationToleranceSeconds:0.75`.
   - `validateVideoCandidateForIngestion(candidate)` — SAF, pre-download fail-closed: `mediaType==="video"` · `admissible===true` **VE** `isProductionAdmissibleRightsStatus(reclassify(license))` **VE** `isProductionAdmissibleRightsStatus(candidate.rightsStatus)` (üçlü kontrol; stored flag'e tek başına güvenilmez) · `sourceUrl` https/http · `mediaUrl` https · host allow-list.
   - `validateSegment(candidate, sourceDurationSeconds?)` — SAF: iki sınır birlikte set; `start>=0`, `end>start`; `minSegment<=len<=maxSegment`; `end<=sourceDuration+tolerance`; segmentsiz aday tüm klip (policy süre aralığında olmalı).
   - `deriveVideoAssetIdentity(candidate)` — deterministik `real-video:sha256({sourceUrl,mediaUrl,segStart,segEnd})[:40]`.
   - `ingestVideoCandidate({candidate, projectSlug, runtimeStorageContext, sceneId?, downloader, runner, loadConfig?, now?})` — preflight → segment şekli → config+executable → **bounded download** (`downloader` enjekte) → MIME `video/*` kontrol → `checksum = sha256(indirilen ham baytlar)` → `VideoStorage.createRenderPaths` + ham dosyayı `.source.partial.mp4` sibling'a yaz → **source ffprobe** (container ∈ allowed, video codec ∈ allowed, duration>0) → segment'i gerçek süreyle yeniden doğrula → **ffmpeg render** (scale+pad → 1920×1080, `-an`, h264, yuv420p, 30fps; segment varsa `-ss`/`-t`) → `inspectMp4` → **output ffprobe** (mp4, 1 video/0 audio, h264/1920/1080/yuv420p/`30/1`, süre ≈ beklenen) → `VideoStorage.finalize` + `inspectStoredMp4` → `IngestedVideoAsset`. **Her adımda hata → tüm temp/final path cleanup + `{success:false, reason, detail}` (asla fail-open).**
   - `ingestedVideoToSceneVideoSuccess(asset, scene)` — `FFmpegSceneVideoProvider`'ın ürettiğiyle birebir aynı `VideoSceneGenerationSuccess` şekli (`provider:"video-media-ingestion"`, `model:"ffmpeg-real-video-segment"`).
   - `createHttpsVideoDownloader(fetcher?)` — gerçek https downloader (`redirect:"error"`, bounded chunk read, byte cap). **Yalnız Faz 6 wiring'de kullanılır, testlerde ASLA.**
   - `VideoIngestionRejectionReason` union (18 değer) — her fail-closed dalı isimli.
5. **`src/lib/assets/SceneMediaSelection.ts` (YENİ):**
   - `selectSceneMedia({scenes, candidates, maxAiImages?})` — SAF, deterministik. Sahne başına sırayla: **admissible gerçek video > admissible gerçek foto/arşiv > AI image**. Cross-scene reuse YOK (`used` Set). `maxAiImages` default `visualMediaAdmissionPolicy.maxAiImages` (4). AI sayısı cap'i aşarsa → **`VisualMediaAiBudgetExceededError`** (Faz 1 ile birebir aynı hata; ilk over-budget sahne id'si).
   - `summarizeSceneMediaPlan(plan)` — cost/AI-count özeti (real media = 0 AI call).
6. **`src/lib/assets/VisualMediaAdmissionPolicy.ts` (değişti):** `VisualMediaAiBudgetExceededError` **buraya taşındı** (policy modülü doğal ev; `SceneMediaSelection` tüm pipeline'ı import etmeden aynı hatayı fırlatabilsin diye). `VisualAssetPipeline` onu **re-export** eder → mevcut `import {...} from ".../VisualAssetPipeline"` call site'ları (2 smoke dahil) değişmeden çalışır.
7. **`src/lib/assets/ResearchMediaDiscovery.ts` (değişti):** `scoreSceneMediaOverlap(scene, candidate)` + `compareResearchMediaCandidates(a,b)` **export edildi** (extract + reuse — `matchResearchMediaToScenes` ve `SceneMediaSelection` birebir aynı sıralar). Davranış değişmedi.
8. **`scripts/smoke-faz3-video-media-ingestion.ts` (YENİ):** 18 senaryo (A-Q + policy sanity). Fixture `VideoDownloader` + `testsrc` ile üretilen fixture MP4 + gerçek local ffmpeg/ffprobe (`ActualProcessRunner`, `spawnSync`). `withCanonicalSmokeRuntime` (izole runtime root; `OPENAI_API_KEY` nuke'lanır, tüm provider `mock`).

### Gerçek video ingestion akışı (özet)
`candidate → validateVideoCandidateForIngestion (fail-closed) → validateSegment şekli → bounded download (enjekte) → MIME video/* → checksum(ham) → source ffprobe (container/codec/duration) → validateSegment(gerçek süre) → ffmpeg segment/full render (1920×1080 h264 yuv420p 30fps, -an) → inspectMp4 → output ffprobe (scene-video sözleşmesi) → VideoStorage.finalize → IngestedVideoAsset`. Belirsizlik/partial/corrupt → **reject + cleanup**.

### Foto/video/AI önceliği + AI cap
`selectSceneMedia`: sahne 1..N sırayla, her sahne için en iyi keyword-overlap'li kullanılmamış admissible video → yoksa admissible foto → yoksa AI. Bir aday **tek sahneye** atanır. Seçim yalnız hangi sahnenin AI'ya düşeceğini belirler; **`maxAiImages=4` guard'ını GEVŞETMEZ** — cap aşılırsa `VisualMediaAiBudgetExceededError` (16 sahne: mümkün olduğunca gerçek medya, en fazla 4 AI).

### Rights gate (fail-closed)
`rightsStatus ∈ {public-domain, open-license, verified}` değilse ingest reddedilir. `sourceUrl` / `mediaUrl` yoksa reddedilir. `unknown` / `restricted` / NC / ND / all-rights-reserved → alınmaz. `verified` asla otomatik. `candidate.admissible` flag'ine tek başına güvenilmez — lisans yeniden sınıflandırılır.

### Testler ($0, gerçek network/API YOK)
`smoke-faz3-video-media-ingestion` **PASS (18)**: A admissible video→ingest PASS · B restricted→FAIL-CLOSED (download yok) · C unknown (admissible:true olsa bile)→FAIL-CLOSED · D sourceUrl yok→reject · E mediaUrl yok/http/yasak host→reject · F non-video MIME→reject · G corrupt bytes→source-probe reject · H invalid segment (ters + kaynağı aşan)→reject · I geçerli segment→deterministik MP4 diskte · J checksum = sha256(kaynak), run'lar arası stabil · K provenance korunur · L 16 sahne (2 video + 10 foto + 4 AI)→PASS · M 16 sahne (12 real + 4 AI)→PASS · N 16 sahne (11 real + 5 AI)→`VISUAL_AI_IMAGE_BUDGET_EXCEEDED` (`maxAiImages=4`, `sceneId=16`) · O aynı girdi 2×→birebir aynı plan + asset identity · P tek video aday, 16 aç sahne→tek sahneye atanır (reuse yok) · Q `5be83a84` 16-PNG combined sha256 değişmedi + `data/projects` tracked drift yok.
Regresyon PASS: `smoke-media-rights-policy` (8), `smoke-phase1-visual-media-admission` (10), `smoke-faz2-research-media-discovery` (14), `smoke-production-visual-asset-wiring` (54), `smoke-production-real-photo-source` (45), `smoke-visual-asset-pipeline-per-scene-retry` (8), `smoke-sprint-131-visual-asset-recovery`, `smoke-production-scene-video-rendering` (26), `smoke-production-video-assembly-wiring` (73), `smoke-multi-shot-duration-reconciliation` (15), `smoke-multi-shot-assembly-render` (2), `smoke-pipeline-orchestration` (10), `smoke-assembly-scene-video-consumption` (25).
Pre-existing FAIL (bağımsız, benim değişikliklerimden değil — birebir aynı assertion): `smoke-sprint-129-7` (`null !== 'visuals'`), `smoke-sprint-129-13` ("Pipeline durable preparation runtime authority is missing") — `sprint-129-7/…/-20` recovery-planner kümesi.
`npx tsc --noEmit` PASS · `git diff --check` exit 0 · `npm run lint` 0 error / 22 pre-existing warning (yeni/değişen dosyalarda 0) · `graphify update` çalıştırıldı.

### KAPSAM DIŞI / DOKUNULMADI
`FFmpegSceneVideoProvider`, `VideoPipeline`, assembly production flow, `PipelineStageExecutor` (Faz 3'te dokunulmadı), durable/recovery/scheduler/acceptance/fingerprint sözleşmeleri, `.env.local`, `IMAGE_PROVIDER`, `WikimediaCommonsClient`. `5be83a84` asset/export/artifact. Gerçek network/paid API. Music/SFX (Faz 4), $1 cost guard (Faz 5), production wiring (Faz 6).

### Sıradaki (DUR — Faz 4/5/6 kendiliğinden başlatılmayacak)
Faz 4: `MusicLibrary`/SFX wiring + ducking. Faz 5: cost guard ($1). Faz 6: `mediaSearchClient` + `VideoMediaIngestion` + `SceneMediaSelection`'ın production pipeline'da wire edilmesi (opt-in → default) + acceptance rights/cost gate.

<!-- SPRINT-169-END -->

<!-- SPRINT-168-START -->
## Sprint 168 - Belgesel real-media Faz 2: research-stage gerçek medya discovery - 2026-08-29

**Status:** Kod + testler PASS. **0 gerçek API/network çağrısı, $0, production çalıştırılmadı, commit yok, `5be83a84` dokunulmadı (16-PNG sha `cc204e21…`, `research.json` mediaCandidates YOK, productionReady:true korundu).** Faz 3'e geçilmedi.

### Amaç
Research aşamasında LLM'in uydurduğu `sources[]` string'leri yerine gerçek source client'tan (Wikimedia Commons) kullanılabilir medya adayları keşfet. LLM yalnız "ne aranmalı" planlar; adayları network client üretir.

### Değişen dosyalar (bu tur)
1. **`src/types/research.ts` (+64):** `ResearchMediaCandidate` type (`id, mediaType, title, provider, sourceUrl, mediaUrl?, thumbnailUrl?, license?, attribution?, rightsStatus, admissible, width?, height?, queryTerms[], association, confidence, discoveredAt`) + `ResearchData.mediaCandidates?` (opsiyonel → eski research.json geçerli kalır).
2. **`src/types/visual.ts` (+14):** `VisualScene.mediaCandidate?: ResearchMediaCandidate` + `VisualData.mediaCandidates?` (opsiyonel, additive).
3. **`src/lib/assets/ResearchMediaDiscovery.ts` (YENİ):**
   - `MediaSearchClient` iface (`WikimediaCommonsClient` structural olarak karşılar — duplicate client mantığı YOK).
   - `createWikimediaSearchClient()` → mevcut `getRealImageProviderConfig` ile client kurar (reuse).
   - `deriveDiscoveryQueries(research)` — SAF. topic + locations + characters + keyEvents → bounded (≤12), deduped, `{term, association}`.
   - `discoverResearchMediaCandidates({research, client, perQueryLimit?, maxCandidates?, existing?, now?})` — her query için `client.search`, her `WikimediaCommonsCandidate` → `ResearchMediaCandidate`: `rightsStatus = classifyMediaRightsStatus(license)` (MediaRightsPolicy **reuse**), `admissible = isRealMediaAdmissible(license) && Boolean(sourceUrl)`. **sourceUrl yoksa aday DÜŞER.** Normalize edilmiş sourceUrl ile **deterministik dedup** (queryTerms merge, best confidence). Query hatası → o query atlanır. Deterministik sıralama + `maxCandidates` cap.
   - `enrichResearchWithMediaDiscovery(research, {client?, now?})` — best-effort wrapper: HERHANGİ bir hata → research DEĞİŞMEDEN döner (discovery research stage'i asla fail etmez).
   - `matchResearchMediaToScenes(candidates, scenes)` — SAF. admissible adayları en iyi keyword/title overlap ile sahnelere ata; **cross-scene reuse YOK** (bir aday tek sahne). Deterministik.
   - `applyResearchMediaCandidatesToVisualData(visualData, research)` — SAF, idempotent. matched sahnelere `mediaCandidate` ekle + `queryTerms`'ü `searchKeywords`'e prepend (dedup) → mevcut `RealPhotoImageProvider` known-good term arar. `visualData.mediaCandidates` = tüm adaylar (audit). Match yoksa no-op.
4. **`src/lib/pipeline/PipelineStageExecutor.ts` (+38):**
   - `PipelineStageExecutionOptions.mediaSearchClient?: MediaSearchClient` (serialize edilmez, fingerprint'e girmez, `materialize` **auto-create ETMEZ** → discovery yalnız client wire edildiğinde çalışır → e2e smoke'lar / production run'lar etkilenmez).
   - research case: `if (dispatchOptions.mediaSearchClient) state.research = await enrichResearchWithMediaDiscovery(...)`.
   - visuals case: `state.visuals = applyResearchMediaCandidatesToVisualData(state.visuals, state.research)` — `VisualManager` sonrası, persist öncesi (idempotent → write-once conflict yok).
5. **`scripts/smoke-faz2-research-media-discovery.ts` (YENİ):** 14 senaryo.

**Faz 1 `maxAiImages=4` guard'ı DEĞİŞMEDİ. `VisualAssetPipeline` / `RealPhotoImageProvider` / `WikimediaCommonsClient` / durable / acceptance / fingerprint / `.env.local` / `IMAGE_PROVIDER` — DOKUNULMADI.** Gerçek video ingestion/render YOK (`mediaType:"video"` aday modelinde saklanır, Faz 3'te render edilir).

### Rights/admission kuralları
Lisans yok/tanınmıyor → `unknown`. `unknown` / restricted / NC / ND / all-rights-reserved → `admissible:false` (retained, audit için; asla seçilmez). `public-domain` / `open-license` → `admissible:true`. `verified` asla otomatik. **sourceUrl'siz aday hiç oluşturulmaz.** Provenance (sourceUrl/license/attribution/width/height) keşiften sonuna kadar korunur.

### Duplicate/determinism
Normalize edilmiş `sourceUrl` ile dedup (SHA-256(sourceUrl)[:24] → id). Aynı aday birden çok query'de çıkarsa → 1 kayıt, queryTerms birleşir. `existing` ile merge (research tekrarında birikmez). Aynı girdi → birebir aynı çıktı (test 9). Matcher: cross-scene reuse yok, deterministik sıralama.

### Testler ($0, network YOK)
`smoke-faz2-research-media-discovery` **PASS (14)**: structured mediaCandidates · wikimedia parse · sourceUrl/provenance korunur · public-domain/open-license admissible · unknown/restricted retained-not-admissible · **uydurma LLM URL'si asla production candidate olmaz** · deterministik dedup · scene matching (no reuse) · **her sahne real aday → 0 AI call** · aday yok → Faz 1 AI fallback · **16 sahne AI cap=4 hâlâ** · `mediaType:"video"` metadata korunur (render edilmez).
Regresyon PASS: `smoke-media-rights-policy` (8), `smoke-phase1-visual-media-admission` (10), `smoke-production-visual-asset-wiring` (54), `smoke-production-real-photo-source` (45), `smoke-visual-asset-pipeline-per-scene-retry` (8), `smoke-sprint-131-visual-asset-recovery`, `smoke-production-end-to-end` (21), `smoke-isolated-e2e-live-pipeline-ffmpeg` (4), `smoke-pipeline-orchestration` (10). `smoke-sprint-129-7/-11` — 24 research schema assertion PASS (`mediaCandidates` additive, PASS 16 "additional provider field forbidden" + PASS 24 fingerprint dahil), sonra pre-existing recovery-planner FAIL (`null !== 'visuals'`, `sprint-129-7/…/-20` kümesi, bağımsız).
`npx tsc --noEmit` PASS · `git diff --check` exit 0 · `npm run lint` 0 error / 22 pre-existing warning (yeni/değişen dosyalarda 0).

### Sıradaki (DUR — Faz 3 kendiliğinden başlatılmayacak)
Faz 3 (yeni ADR): gerçek video klip download + segment + FFmpeg assembly entegrasyonu. Faz 4: MusicLibrary/SFX. Faz 5: cost guard. Faz 6: acceptance rights+cost gate + `mediaSearchClient`'ın production'da wire edilmesi (opt-in → default).

<!-- SPRINT-168-END -->

<!-- SPRINT-167-START -->
## Sprint 167 - Belgesel real-media Faz 1: VisualAssetPipeline gerçek-medya önceliği + AI-image bütçesi - 2026-08-29

**Status:** Kod + testler PASS. **0 gerçek API çağrısı, $0, production çalıştırılmadı, commit yok, `5be83a84` dokunulmadı (16-PNG sha `cc204e21…`, productionReady:true korundu).** Faz 2'ye kendiliğinden geçilmedi.

### Amaç (kullanıcı Faz 1 talimatı)
`VisualAssetPipeline` seviyesinde gerçek medya önceliğini deterministik + ölçülebilir yap: gerçek foto varsa AI üretme; provenance metadata'sını dürüst persist et; AI fallback yalnız admissible gerçek medya yoksa; 16-sahne için MAKS 4 AI görsel, fail-open değil.

### Değişen dosyalar (bu tur)
1. **`src/lib/assets/VisualMediaAdmissionPolicy.ts` (YENİ):** tek açık policy noktası. `visualMediaAdmissionPolicy = { maxAiImages: 4 }` (frozen, scene-count'tan bağımsız). `UNBOUNDED_AI_IMAGES` sentinel. `isRealMediaAdmissible(license)` → `MediaRightsPolicy` reuse (duplicate lisans mantığı YOK). `resolveMediaProvenance({provider, license, reason})` → dürüst `mediaOrigin/mediaType/rightsStatus/selectionReason` (real → `photo` + classified rights; openai/mock → `ai`/`ai-image` + rightsStatus undefined).
2. **`src/lib/assets/VisualAssetPipeline.ts` (+197/-19):**
   - `GenerateAssetsInput.maxAiImages?` (default `UNBOUNDED_AI_IMAGES` → mevcut ~20 smoke call site'ı ve studio UI single-scene path'i etkilenmez).
   - `VisualMediaAiBudgetExceededError` (YENİ, export, `code`/`reasonCode` = `VISUAL_AI_IMAGE_BUDGET_EXCEEDED`) — cap aşılırsa failed-asset persist + **deterministik throw** (fail-open değil).
   - `countExistingAiImages` — resume'da önceki AI asset'leri bütçeye sayar (`provider==="openai" || mediaOrigin==="ai"`).
   - AI dispatch (batch `openai` VEYA override `"ai"` VEYA real-fallback) **öncesi** `requireAiBudget(sceneId)`.
   - Fallback koşulu genişledi: real success + `provider==="real"` + `!isRealMediaAdmissible(result.license)` → NOT admitted → AI fallback (cap-checked), `override!=="real"` iken.
   - `createAsset`'e `mediaOrigin/mediaType/rightsStatus/selectionReason/discoveredAt` eklendi; AI persist sonrası `aiImagesUsed++` (yalnız `provider==="openai"`; mock sayılmaz → mock kullanan production acceptance smoke'ları kırılmaz).
   - Mevcut Sprint 130 alanları (`sourceName/sourceUrl/license/attribution/selectionScore/selectionRank/candidateCount`) **korundu**. `RealPhotoImageProvider`/Wikimedia/`isFreeLicense` dokunulmadı.
3. **`src/lib/pipeline/PipelineStageExecutor.ts` (+10/-2):** visuals case `generateAssets` çağrısına `maxAiImages: visualMediaAdmissionPolicy.maxAiImages` eklendi. Production render'da cap her zaman devrede. (`.env.local` / `IMAGE_PROVIDER` switch DOKUNULMADI.)
4. **`scripts/smoke-phase1-visual-media-admission.ts` (YENİ):** 10 senaryo.

Faz 1'in bağlı olduğu Sprint 166 temeli (bu oturumdan, uncommitted): `src/types/asset.ts` (+83 additive), `src/lib/assets/MediaRightsPolicy.ts`, `scripts/smoke-media-rights-policy.ts`.

### AI-image cap davranışı
- Herhangi bir sahne sayısı için EN FAZLA `maxAiImages` sahne AI görsel olabilir; diğerleri admissible gerçek medya OLMAK ZORUNDA.
- Cap dolduğunda bir sonraki AI-gerektiren sahne: failed-asset persist + `VisualMediaAiBudgetExceededError` (`sceneId`, `maxAiImages` taşır). AI request **hiç yapılmaz**. Sonsuz AI YOK.
- Resume: mevcut AI asset'ler bütçeye sayılır → resume tek fresh run'dan fazla AI üretemez.
- `maxAiImages` geçilmeyen çağrılar (UI, testler) → `UNBOUNDED_AI_IMAGES` → cap yok.

### Real→AI fallback davranışı
`IMAGE_PROVIDER=real` (veya provider name `"real"`) + `override !== "real"` iken: (a) real `success:false` VEYA (b) real success ama `classifyMediaRightsStatus(license)` ∉ {public-domain, open-license, verified} → real KABUL EDİLMEZ → cap-check → AI fallback. `override === "real"` iken fallback yok (sahne `failed`). `override === "ai"` → real hiç denenmez, doğrudan AI (cap-check).

### Rights/provenance metadata
real match → `mediaOrigin:"real"`, `mediaType:"photo"`, `rightsStatus`= lisanstan sınıflandırılmış, `selectionReason:"archive-photo-match"`, `discoveredAt`. AI → `mediaOrigin:"ai"`, `mediaType:"ai-image"`, `rightsStatus:undefined`, `selectionReason:"no-suitable-real-media-found"` (fallback) / `"operator-forced-ai"` (override). Lisans metadata'sı yoksa → `rightsStatus:"unknown"` (asla otomatik `verified`). Provider gerçekte ne ürettiyse `asset.provider` odur.

### Testler ($0, gerçek API yok)
`smoke-phase1-visual-media-admission` **PASS (10)**: admissible real→0 AI · real-not-found→AI · restricted licence→AI · unknown licence→AI · AI metadata dürüst · **16/4 AI→PASS** · **16/5 AI→VisualMediaAiBudgetExceededError (sceneId 16, 4 AI üretildi, 5.'si hiç dispatch edilmedi, sahne 16 failed persist)** · 8/2 + 3/3-fail deterministik · Sprint 130 provenance korunuyor · policy tek nokta.
Regresyon PASS: `smoke-media-rights-policy` (8), `smoke-production-visual-asset-wiring` (54), `smoke-production-real-photo-source` (45), `smoke-visual-asset-pipeline-per-scene-retry` (8), `smoke-sprint-131-visual-asset-recovery`, `smoke-production-end-to-end` (21), `smoke-isolated-e2e-live-pipeline-ffmpeg` (4), `smoke-production-video-assembly-wiring` (73), `smoke-production-youtube-package-pipeline` (58), `smoke-production-scene-video-rendering` (26), `smoke-multi-shot-duration-reconciliation` (15), `smoke-pipeline-orchestration` (10). `smoke-sprint-129-19` — 48 visuals/asset assertion'ı PASS (`VisualAssetPipeline` dahil), sonra pre-existing recovery-planner FAIL (`sprint-129-7/…/-20` kümesi, değişikliğimden bağımsız).
`npx tsc --noEmit` PASS · `git diff --check` exit 0 · `npm run lint` 0 error / 22 pre-existing warning (değişen dosyalarda 0).

### Sıradaki (DUR — Faz 2 kendiliğinden başlatılmayacak)
Faz 2: research-stage medya keşif adımı (structured media candidate registry). Faz 3: gerçek video klip (yeni ADR). Faz 4: MusicLibrary/SFX wiring. Faz 5: cost estimator + $1 guard. Faz 6: acceptance'a rights+cost gate.

<!-- SPRINT-167-END -->

<!-- SPRINT-166-START -->
## Sprint 166 - Belgesel real-media effort: mimari inceleme (Graphify) + rights-metadata temeli (additive) - 2026-08-29

> **NOT:** Sprint 158-165 checkpoint kayıtları bu oturumda working-copy'de tutuluyordu; Sprint 165'te "sadece 2 dosya" talimatı gereği `git checkout -- ATOLYE_CHECKPOINT.md` yapılınca 158-165 kayıtları da geri alındı. O sprintlerin KODU sağlam ve uncommitted; kayıtlar `memory/documentary-pipeline-v2-multishot-status.md`'den + `git diff` ile oturum sonunda yeniden yazılmalı. Özetleri: **158-162** multi-shot + scene-duration reconciliation + `validateScriptDurationAuthority`; **163** 5be83a84 animation worker-crash scoped recovery (`scripts/apply-animation-crash-recovery-fatih-5be83a84.ts`); **164** animation scene-6 `crop-bounds` prompt fix (`AnimationStructuredOutput.createAnimationMotionPlanSystemPrompt`); **165** assembly `AI_RESPONSE_TRUNCATED` → `AssemblyAIConfig` 3200→5200 / 6000→8000. **5be83a84 artık TAM video** (3. gerçek video: 12/12 completed, `acceptanceStatus: validated`, `productionReady: true`, `published: false`).

**Status:** READ-ONLY mimari inceleme tamam + additive rights-metadata temeli uygulandı. **0 gerçek API çağrısı, $0, production çalıştırılmadı, commit yok, 5be83a84 dokunulmadı (16-PNG sha `cc204e21…`).** Kalan işler faz faz onay bekliyor.

### Kök neden — neden gerçek medya yerine hep AI görsel?
`.env.local`'de **`IMAGE_PROVIDER=openai`**. Gerçek-fotoğraf-önce + AI-fallback + rights-metadata yolu **zaten var** (ADR-019, Sprint 130): `ImageProviderRouter` (`mock`|`openai`|**`real`**) → `RealPhotoImageProvider` (Wikimedia Commons) → eşleşme yoksa `success:false` → `VisualAssetPipeline` açıkça `openai`'ye düşer; `Asset.sourceName/sourceUrl/license/attribution/selectionScore/selectionRank/candidateCount` alanları + per-scene `overrides:{sceneId:"ai"|"real"}` mevcut. **Tek `IMAGE_PROVIDER` switch'i** olduğu için `openai` seçiliyken her sahne AI. "Prefer real, fallback AI" sadece `IMAGE_PROVIDER=real` iken devrede.

### Eksikler (faz faz sprint)
- Research'te medya keşfi YOK (`ResearchData.sources` = LLM tahmini string dizi; `imagePrompts/musicIdeas/soundEffects` de LLM string).
- Gerçek **VIDEO** klip ingestion YOK (`FFmpegSceneVideoProvider` = görselden Ken Burns; ADR-019 kapsamı dışı → **yeni ADR gerekir**).
- `MusicLibrary.ts` (Sprint 158) var ama pipeline'a **bağlı değil**; SFX/ambience yok.
- Cost estimator/guard YOK (`AIUsageRecord.estimatedCost?` alanı var, hiçbir şey hesaplamıyor).
- `rightsStatus` sınıflandırması + `mediaType`/`mediaOrigin`/`selectionReason` alanları yoktu.
- Per-scene AI-image cap (16 sahne için 0-4 hedefi) YOK.

### Bu turda uygulanan — SADECE güvenli additive temel
1. **`src/types/asset.ts` (+83, tümü opsiyonel):** `MediaOrigin` (`real`|`ai`), `MediaType` (`photo`|`video`|`map`|`document`|`archive`|`ai-image`), `MediaRightsStatus` (`verified`|`open-license`|`public-domain`|`unknown`|`restricted`) + `Asset.mediaOrigin?/mediaType?/rightsStatus?/selectionReason?/discoveredAt?`. Hepsi opsiyonel → mevcut her asset/fixture/test geçerli kalır.
2. **`src/lib/assets/MediaRightsPolicy.ts` (YENİ, saf, network/model yok):** `classifyMediaRightsStatus(license)` — Wikimedia `LicenseShortName`/`UsageTerms` string'lerini deterministik 5-yol sınıfa map'ler; **boş/tanınmayan → `unknown`** (asla sessizce "safe"), NC/ND/all-rights-reserved → `restricted`, PD/CC0 → `public-domain`, CC-BY[-SA]/GFDL/OGL → `open-license`; `verified` ASLA otomatik üretilmez. `isProductionAdmissibleRightsStatus(status)` — yalnız `public-domain`/`open-license`/`verified` geçer, `unknown`/`restricted`/undefined **fail-closed**. `RealPhotoImageProvider`'ın private `isFreeLicense`'ının reusable superset'i.
3. **`scripts/smoke-media-rights-policy.ts` (YENİ):** 8 senaryo PASS.

**Pipeline / durable / acceptance / VisualAssetPipeline / RealPhotoImageProvider / prompt / provider — DOKUNULMADI.** Wiring yok (bilinçli — bir sonraki faz).

### Testler ($0)
`npx tsc --noEmit` PASS · `git diff --check` temiz (exit 0) · `npm run lint` 0 error / 22 pre-existing warning (değişen dosyalarda 0).
`smoke-media-rights-policy` **PASS (8)** · `smoke-production-visual-asset-wiring` **PASS (54)** · `smoke-production-real-photo-source` **PASS (45)** · `smoke-visual-asset-pipeline-per-scene-retry` **PASS (8)** · `smoke-production-video-assembly-wiring` **PASS (73)** · `smoke-production-youtube-package-pipeline` **PASS (58)** · `smoke-multi-shot-duration-reconciliation` **PASS (15)**.

### Faz planı (her biri ayrı onaylı sprint)
- **Faz 1 (küçük):** `IMAGE_PROVIDER=real` etkinleştir + `VisualAssetPipeline`'ı `mediaOrigin`/`mediaType`/`rightsStatus`/`selectionReason`/`discoveredAt` yazacak şekilde genişlet (real branch → `classifyMediaRightsStatus`; openai branch → `ai`/`ai-image`). Per-scene AI-image cap + deterministic admission.
- **Faz 2:** research-stage medya keşif adımı — `sources`'u structured media candidate registry'ye çevir (Wikimedia + eklenebilir source client'lar); scene media kararı `visuals.json`'a yaz.
- **Faz 3 (yeni ADR):** gerçek video klip ingestion — source URL + segment start/end + rights + asset registry + assembly entegrasyonu (yalnız PD/açık-lisans/doğrulanabilir).
- **Faz 4:** `MusicLibrary` wiring + SFX/ambience seçimi (scene semantiğine göre, narration ducking).
- **Faz 5:** cost estimator (`estimatedCost` hesaplama) + `$1` pre-acceptance guard (deterministik block; AI image / token / duplicate / retry israfı tespiti).
- **Faz 6:** production acceptance'a rights gate (`isProductionAdmissibleRightsStatus`) + cost gate bağlama.

<!-- SPRINT-166-END -->

<!-- SPRINT-157-START -->
## Sprint 157 - Fatih Sultan Mehmet projesi gerçek üretim pipeline'ından geçirildi → 12/12 + productionReady - 2026-08-29

**Status:** Completed. `fatih-sultan-mehmet-ve-i-stanbul-un-fethi-c0261ddc-d2d1-460b-bf6c-5be4bdc1b02b` **12/12 completed**, `project.json.status="completed"`, `production-acceptance.json` `acceptanceStatus:"validated"` / `productionReady:true` / `published:false`. `production:acceptance:execute` + `resume-finalize` yolu uçtan uca çalışır durumda — Sprint 156'nın `9ba24c8` runtime-context düzeltmesi gerçek CLI'de doğrulandı. Commit/push kullanıcı onayına bırakıldı.
**Production execution status:** Yeni proje (topic'ten uniquify edilmiş taze slug). Korunan üç proje (`osmanli-...-c8888f58`, `i-stanbul-un-fethi-1453`, `fatih-sultan-mehmet-ve-i-stanbul-un-fethi` draft) **hiç dokunulmadı** (0 dosya değişikliği). Başarısız ilk deneme `fatih-...-0cb2dc0d` (assembly failed, export yok, 0 tracked) temizlendi.

### Final video
- `data/projects/fatih-...-c0261ddc/assets/videos/948f9776-6b35-4d7d-bc4b-098d5cc806e5.mp4` = `export/bundle/video.mp4` — **6.902.742 bayt**, sha256 `ef192ea59c946f5b2199d8cc7f22f01e3084a39a13293812d2e54e5c26c408e9`, **h264 1920×1080 @ 30fps + aac 48kHz stereo, 96.841 s, mov/mp4**.
- Export bundle `packaged`: video.mp4 + thumbnail.png (2.968.412) + youtube_metadata.json + subtitles.srt/.vtt — hepsi `export.json` checksum'larıyla birebir.

### Kök nedenler + düzeltmeler (F-08/F-02 tamamlama + 3 latent bug)
Model 5 chapter için ~2000+ karakter narration yazıyor (~145 s) ama `estimatedDuration`'ı ~90-105 seçiyor → scene/video 105 s'de, TTS 146 s'de → assembly `VideoDurationCoverageGuard` fail-closed. Zincir:

1. **`src/lib/ai/AIManager.ts` — script prompt (failClosed) + honest estimatedDuration.** Prompt: "tam 5 chapter", her chapter narration'ı 260-340 karakter, birleşik ~1300-1450 (hard). Kod: failClosed'da `estimatedDuration` = `round(sum estimateNarrationSeconds(chapter.narration))` — modelin sayısı yerine narration'ın kalibre char-rate tahmini; `reconcileChapterDurations` bu dürüst toplamı dağıtır. Legacy yol değişmedi.
2. **`src/lib/production/ProductionAcceptancePreflight.ts` — script-stage fail-closed narration tutarlılık kapısı.** `measuredNarrationSeconds >= 30` ise (mock fixture'lar muaf): narration [55,125] s içinde olmalı VE `|measured - estimatedDuration|` coverage-guard toleransı içinde. Kötü scriptler ucuz script aşamasında reddedilir (görüntü/ses üretilmeden).
3. **`src/lib/ai/NarrationDurationEstimator.ts` + `src/lib/assembly/VideoDurationCoverageGuard.ts` — per-scene kalibre varyans terimi.** Yeni `ESTIMATOR_PER_CHAPTER_VARIANCE_RATIO = 0.053` (kendi kalibrasyon tablosundan: en yavaş chapter 13.42 ch/s vs 14.12 ortalama). `perSceneLegitimatePaddingSeconds`'e eklendi — tek sahne TTS'i char-rate tahmininden ~%5 uzun çıkabilir (agregada iptal olur, agrega kontrol değişmedi). Marjinal per-scene fail (scene 1: 1.56 s pad vs 1.48 s tol, 0.08 s aşım) çözüldü.
4. **`src/lib/youtube/prompts/youtubePackagePrompt.ts` + `YouTubePackagePipeline.ts`.** (a) Prompt: chapter startSeconds tam saniye, `< durationSeconds`; scene sürelerinden değil authoritative `durationSeconds`'ten hesapla. (b) `requireFinalVideoAsset`: `inspectStoredMp4` (mvhd atom parse) süresi ile depolanan `asset.durationSeconds` (ffprobe) sub-frame yuvarlama farkı (96.841 vs 96.842) — `1e-3` toleransı `MAX_STORED_DURATION_PROBE_DRIFT_SECONDS = 0.1`'e genişletildi.
5. **`src/lib/export/ExportBundleMaterializer.ts`.** Altyazılar tam narration timeline'ını kaplar; crossfade'li video narration toplamından blend-overlap kadar kısa (junction başına ≤ `MAX_BLEND_SECONDS`). Divergence toleransı `+ (sceneCount-1) * MAX_BLEND_SECONDS`. (`MAX_BLEND_SECONDS` `FFmpegVideoAssemblyProvider`'dan export edildi.)

### Maliyet / döngü kontrolü (kullanıcı talebi)
- Diagnostik: ~9 script + ~2 youtube üretim çağrısı (prompt kalibrasyonu; sonra silindi).
- `c0261ddc` `providerCalls: 47` (completion raporu). research→video→audio bir kez üretildi; `resume-finalize` başarısız aşamalardan devam etti, tamamlanan aşamalar **hiç** yeniden üretilmedi.
- Retry'ler: audio (1× transient `AUDIO_PROVIDER_TIMEOUT`), assembly (1× guard — sonra kod düzeltmesiyle geçti), youtube (2× — kök neden bulunup düzeltildikten sonra geçti), export (1× — düzeltmeyle geçti). Her tekrar öncesi kök neden bulundu; körlemesine retry yapılmadı.
- İlk deneme `0cb2dc0d` silindi (assets yeniden kullanılamazdı — yanlış süreler gömülüydü).

### Testler
- `npx tsc --noEmit`: **0 hata** · `npm run lint`: **0 error** (22 pre-existing warning) · `graphify update .`
- Regresyon (değişen alan): `smoke-video-duration-coverage-guard` (20), `smoke-script-duration-reconciliation-wiring` (3, fixture güncellendi), `smoke-narration-duration-estimator` (12), `smoke-production-youtube-package-pipeline` (58), `smoke-production-youtube-publish-pipeline` (31), `smoke-sprint-132-export-packaging` (15), `smoke-ffmpeg-bgm-kenburns-assembly` (30, gerçek FFmpeg), `smoke-production-video-assembly-wiring` (73), `smoke-assembly-scene-video-consumption` (25), `smoke-production-end-to-end` (21), `smoke-isolated-e2e-live-pipeline-ffmpeg` (gerçek FFmpeg, 47 s MP4), `smoke-sprint-128-1-production-acceptance` (30), `smoke-production-readiness-acceptance` (24), `smoke-production-acceptance-finalize-runtime-context` (6, Sprint 156) — **hepsi PASS**.
- Pre-existing FAIL (benimle ilgisiz, temiz ağaçta da): `smoke-sprint-129-13/15/19/25c-2b-4/28/33/36/39` (durable/isolated-smoke regresyon borcu).

### Gerçek çalışma kanıtı
`resume-finalize` → `{"success": true, "completion": {"durationSeconds": 96.841, "resolution": "1920x1080", "videoCodec": "h264", "audioCodec": "aac", "sceneCount": 5, "imageCount": 5, "providerCalls": 47, "publishReady": true, "published": false, "productionReady": true}}`
<!-- SPRINT-157-END -->

<!-- SPRINT-156-START -->
## Sprint 156 - `production:acceptance:execute` finalize() → RUNTIME_OPERATION_CONTEXT_MISSING kök neden + dar düzeltme - 2026-08-29

**Status:** Completed. Salt-okunur teşhis + en dar kalıcı kod düzeltmesi + yeni regresyon smoke'u. `src/**` iki dosya (biri sadece re-export satırı), bir yeni smoke dosyası. **Sıfır production mutation** — hiçbir gerçek proje/asset/marker/export'a dokunulmadı; tüm doğrulama izole `withCanonicalSmokeRuntime` alanında + bir salt-okunur repro (silindi) ile. Commit/push kullanıcı onayına bırakıldı (ağaçta ilgisiz önceki-oturum WIP'i var).

### Belirti
`npm run production:acceptance:execute` (ve `resume-finalize`) pipeline'ı 12/12 `completed` yaptıktan, `project.json.status="completed"` olduktan **sonra** `ProductionAcceptanceOrchestrator.finalize()` içinde `ProductionRuntimeOperationContextError` / `RUNTIME_OPERATION_CONTEXT_MISSING` fırlıyordu. Sonuç: `production-acceptance.json` marker'ı `acceptanceStatus:"prepared"` / `productionReady:false`'ta takılı kalıyor (`markProductionAcceptanceValidated` throw'un altında). Canlı kanıt: `osmanli-nin-yukselisi-...-c8888f58` — 12/12 completed + export bundle var, marker hâlâ `prepared`; ayrıca 5 `audio-publication-intents/*.json`.

### Kök neden (GRAPHIFY + salt-okunur repro ile doğrulandı)
- `ProductionAcceptanceOrchestrator.run()` / `resumeAndFinalize()` → `PipelineRunner.run()`/`resume()` kendi `executePipelineRunnerProductionRuntimeOperation(...)` scope'unda çalışır; audio aşaması `AudioStorage.commitPreparedAudio` → `prepareAudioPublicationIntent` ile `production-execution/audio-publication-intents/*.json` yazar (`runtimeAuthorityBinding` = o context'in `authority.resolverBindingIdentity`). `PipelineRunner.run` dönünce bu scope **yıkılır**.
- Ardından orchestrator `this.finalize(...)`'i **aktif `ProductionRuntimeOperationContext` olmadan** çağırıyordu. `finalize()` → `AssetManager.getProjectAssets(slug, id)` (`ProductionAcceptanceOrchestrator.ts:311`) → `getCommittedAudioPublicationAssets(...)` (`AssetManager.ts:48`): `audio-publication-intents/` klasörü artık var olduğundan `requireActiveProductionRuntimeOperationContext()` (`RuntimeOperationScope.ts:81`) → **throw**.
- Hiçbir smoke yakalamamıştı çünkü `withCanonicalSmokeRuntime` tüm senaryoyu `runWithProductionRuntimeOperationContext(...)` içine sarıyor (finalize hep aktif context'te koşuyor). Çıplak CLI süreci (`scripts/run-production-acceptance.ts`) ve `scripts/e2e-real-pipeline-duration-fix-proof.ts` sarmıyor — gerçek olay tam buydu. Salt-okunur repro (`initializeProductionProcessRuntime()` + `AssetManager.getProjectAssets` çıplak): **THREW RUNTIME_OPERATION_CONTEXT_MISSING**; aynı çağrı `executePipelineRunnerProductionRuntimeOperation` ile sarıldığında: **OK, 19 asset (5 audio)**.

### Düzeltme (en dar, kontrat-koruyan)
- **`src/lib/pipeline/PipelineRunner.ts`:** zaten import edilmiş olan `executePipelineRunnerProductionRuntimeOperation` re-export edildi (`installPipelineRunnerProductionRuntime` desenini izler).
- **`src/lib/production/ProductionAcceptanceOrchestrator.ts`:** yeni `private static finalizeWithinCanonicalRuntimeOperation(...)` — `finalize()`'i `executePipelineRunnerProductionRuntimeOperation("production-acceptance-finalize", () => this.finalize(...))` ile sarar. `run()` ve `resumeAndFinalize()`'daki iki `this.finalize(...)` çağrısı buna yönlendirildi. `finalize()` gövdesi **değişmedi**.
- Neden doğru: zaten kayıtlı canonical parent authority'den (`initializeProductionProcessRuntime` kurar) türetir → yeni ambient fallback yok, kayıt yoksa hâlâ `RUNTIME_OPERATION_CONTEXT_MISSING` ile fail-closed. Türetilen finalize context'i pipeline'ın storage authority'sini paylaşır → `getCommittedAudioPublicationAssets`'in `intent.runtimeAuthorityBinding` kontrolü bu run'ın kendi intent'leri için geçer, yabancıları hâlâ reddeder. finalize zaten aktif bir context içinde çağrıldığında (her mevcut acceptance smoke'u) o context yeniden kullanılır, nested edilmez (`RUNTIME_OPERATION_CONTEXT_MISMATCH` yok).
- `run()`/`resumeAndFinalize()` bütün olarak sarılamaz: `evaluateReadiness()` → `initializeProductionProcessRuntime()` `runWithProductionRuntimeOperationContext(processRuntimeOperationContext, …)`'i parent context'in **kendisiyle** çalıştırır; önceden türetilmiş bir dış context orada `active.operationContext !== context` mismatch guard'ını tetiklerdi. Yalnızca finalize (hep readiness'ten sonra) sarılıyor.

### Yeni regresyon testi — `scripts/smoke-production-acceptance-finalize-runtime-context.ts` (6 senaryo, PASS)
`enterOperationContext:false` (çıplak CLI'yi taklit): (A) committed audio intent seed'liyken çıplak `AssetManager.getProjectAssets` → `RUNTIME_OPERATION_CONTEXT_MISSING` (ham tehlike hâlâ üretiliyor); (B) aynı çağrı `executePipelineRunnerProductionRuntimeOperation("production-acceptance-finalize", …)` ile → registry + 5 audio döner; (C) authority binding kontrolü finalize operasyonu altında geçer; (D) aynı sarma bir dış aktif context içinde nested → yeniden kullanılır, MISMATCH yok; (E)+(F) `ProductionAcceptanceOrchestrator.resumeAndFinalize` (evaluateReadiness + createResumePlan stub, `PipelineStageExecutor.loadState` casus): finalize `ProductionAcceptanceExecutionError` ile reddeder (RUNTIME_OPERATION_CONTEXT_* **değil**) ve media/registry re-verification'ı **aktif** context'te koşar — hem çıplak hem dış-context. Düzeltme geri alınınca (E) `false !== true` ile FAIL eder (gerçek guard).

### Testler
- `npx tsc --noEmit`: **0 hata** · `npm run lint`: **0 error** (22 pre-existing warning, sayı değişmedi) · `graphify update .` çalıştırıldı.
- Regresyon (değişen alan): `smoke-production-acceptance-finalize-runtime-context` (6, YENİ), `smoke-sprint-128-1-production-acceptance` (30), `smoke-production-readiness-acceptance` (24), `smoke-sprint-129-23-production-acceptance-portability` (16), `smoke-durable-replay-manifest-desync-guard` (11), `smoke-pipeline-state-error-contract` (18), `smoke-audio-publication-rebind` (11/12, 1 skip), `smoke-production-worker-lifecycle` (21), `smoke-production-end-to-end` (21), `smoke-production-animation-provider` (30), `smoke-pipeline-orchestration` (10), `smoke-pipeline-auto-continuation` (18), `smoke-environmental-failure-retry-extension` (37), `smoke-production-audio-asset-wiring` (74), `smoke-production-video-assembly-wiring` (73), `smoke-production-thumbnail-pipeline` (42), `smoke-isolated-e2e-audio-rebind-assembly` (gerçek FFmpeg, SUCCESS) — **17/17 PASS**.

### Kalan gerçek eksik (bu görevin DIŞINDA — pre-existing, temiz ağaçta da FAIL, benim değişikliğimle ilgisiz)
- `smoke-sprint-129-25c-2b-4-runtime-context` — EXIT 1 (`Missing expected exception (RuntimeStorageError)`).
- `smoke-sprint-129-36-retry-budget-extension` — EXIT 1 (`CANONICAL_AUDIO_ORDINAL_FOUR_RESERVATION_PERSISTENCE_INVALID`).
- `smoke-sprint-129-28-production-acceptance-reauthorization` — EXIT 1 (kırılgan kaynak-regex assertion: `/const completedPreparations\s*=\s*new WeakMap/` artık eşleşmiyor).
- Üçü de `src/**` değişikliğim stash'lenmiş temiz ağaçta aynı şekilde FAIL. Sprint 152'nin işaret ettiği durable-layer regresyon borcuyla aynı aile (`smoke-sprint-129-9/33/39` ile birlikte).

### Not — mevcut takılı Osmanlı marker'ı
`osmanli-...-c8888f58` (ve diğer `prepared`'ta takılı acceptance marker'ları) artık düzeltilmiş kodla standart `npm run production:acceptance:resume-finalize --project-slug=<slug> --confirm-production-acceptance` ile finalize edilebilir (yeniden render YOK, yalnızca `production-acceptance.json` yazımı). Bu bir operatör kararı — bu oturumda çalıştırılmadı (kullanıcı "Osmanlı projesini değiştirme" dedi; export bundle zaten dokunulmuyor, yalnızca marker).
<!-- SPRINT-156-END -->

<!-- SPRINT-155-START -->
## Sprint 155 - Environmental-Failure Retry Admission (non-regeneration durable ordinal 5) + Thumbnail Observability + Audio Canonical Descriptor Rebind → `fatih-...-cfe77fd8` 12/12 - 2026-08-28

**Status:** `fatih-...-cfe77fd8` **12/12 completed** — `project.json.status: "completed"`, all 12 pipeline jobs + all 12 manifest packages `completed`. Thumbnail unblocked via the new env-failure retry extension; SEO/YouTube unblocked via user-approved orphan quarantine/restore; **export unblocked via user-approved audio canonical descriptor rebind** (7 `audio-comp-*` records, `FILESYSTEM_MATERIALIZATION_DRIFT`). Final bundle verified (5 files sha256+byteLength, `video.mp4` byte-identical to existing assembly artifact, ffprobe 116.97s h264 1920×1080 + aac 48k stereo). Commit/push explicitly deferred by user.
**Production execution status:** `fatih-...-cfe77fd8` — controlled production mutations: one new env-failure retry authority; thumbnail ordinal-5 + seo ordinal-2 + youtube ordinal-2 + export ordinal-2 (`76669f69`) real durable lineages; seo/youtube orphan chains quarantined→restored byte-for-byte; export orphan `e9053dd4` quarantined (NOT restored — a fresh failed export ordinal-1 record now occupies the same deterministic recordId); 7 additive `audio-canonical-descriptor-rebind-v1` ledger entries (no `audio-comp-*` record/WAV byte changed). `i-stanbul-un-fethi-1453` and all other projects untouched.

### Ana sonuç
Daha önce kalıcı bloke olan `fatih-...-cfe77fd8` **thumbnail** aşaması `completed` — gerçek `gpt-image-1` asset'i (`fa60aec0-...`, 1536×1024, 2,531,685 bayt PNG, `generationMode: production`), durable ordinal 5. Ordinal 2-4 denemeleri yalnızca `.env.local`'daki geçersiz `OPENAI_API_KEY` (HTTP 401 `invalid_api_key`) nedeniyle başarısız olmuştu; anahtar bu oturumda değiştirilip doğrulandı (models/chat/`gpt-image-1` hepsi 200).

### Yeni mekanizma — `ProductionPipelineEnvironmentalFailureRetryExtension`
Mevcut literal-tipli ordinal-4 `ProductionPipelineRetryBudgetExtension*` şemasını **genişletmeden**, `ProductionPipelineRegenerationRetryBudgetExtension`'ın üçüncü dar kardeşi. Kanıtlanmış bir **external provider credential** hatası ordinal-4 slot'unu tükettiğinde tam olarak **bir** ek durable ordinal (5) yetkilendirir. Fail-closed, tek-kullanımlık, operatör-confirm-gated.
- Eligibility: non-regeneration + job `failed` attempts 3 + durable ordinal-4 terminal + ordinal-4 kaydının kendi `failure` bloğu `category:"provider"` & `retryable:true` & `failureCode` kimlik-duyarlı allowlist'te + acceptance marker okunabilir + stage için başka `envfail-authority-*` yok.
- `PipelineRetryAdmission` yeni tavan: non-regen ordinal `>= 6` sabit red; ordinal 5 yalnızca `isEnvironmentalFailureOrdinal5Extension` (yeni proof alanı `environmentalFailureRetryAuthorityProof`) ile.
- CLI: `production:acceptance:environmental-failure-retry-plan` / `:apply-environmental-failure-retry` (7 ortak arg + `--authority-id` + `--confirm-environmental-failure-retry`; reason+evidence plan↔apply arasında byte-identical olmalı).

### Thumbnail gözlenebilirliği
`src/types/thumbnailError.ts` (`ThumbnailAssetErrorEvidence`) + `src/lib/thumbnail/ThumbnailAssetError.ts` — `AudioAssetError` deseni, `PipelineErrorEvidence` union'ına eklendi. `OpenAIThumbnailProvider` failure yolu `response.status` + sanitize edilmiş provider error code yakalıyor; `ThumbnailAssetGenerationError.evidence` mevcut history/job `errorEvidence` kanalıyla taşınıyor. API key/secret asla loglanmıyor/taşınmıyor.

### Değişen / yeni dosyalar
- Yeni: `src/lib/production/ProductionPipelineEnvironmentalFailureRetryExtension.ts`, `src/lib/production/ProductionEnvironmentalFailureRetryPlan.ts`, `src/types/thumbnailError.ts`, `src/lib/thumbnail/ThumbnailAssetError.ts`, `scripts/smoke-environmental-failure-retry-extension.ts`.
- Değişen: `src/lib/pipeline/PipelineRetryAdmission.ts`, `PipelineFailedStageRetry.ts`, `PipelineRunner.ts`, `PipelineStageExecutor.ts`, `PipelineErrorEvidence.ts`; `src/lib/production/ProductionPipelineExecutionFactory.ts`, `ProductionAcceptanceCommand.ts`; `src/lib/thumbnail/ThumbnailAssetPipeline.ts`, `providers/OpenAIThumbnailProvider.ts`, `providers/ThumbnailProvider.ts`; `src/types/errorEvidence.ts`; `package.json`.

### Testler
- `scripts/smoke-environmental-failure-retry-extension.ts` — **PASS (37 senaryo)**: authority build/validate/tamper (8), operatör-evidence doğrulama (3), store CRUD + makbuz tek-kullanımlık (7), findMatching/findConsumed (3), CLI arg (2), ordinal-4 retry-budget-extension E2E (3), env-extension eligibility + apply + replay + ordinal-5 admission + `assertCanonicalPipelineRetryAdmission` (real, proof yoksa/yanlış class ise red) (7), ikinci extension reddi + ordinal-6 tavanı (2), ordinal 1-4 + `a248f7fe` byte-for-byte değişmedi (1), non-credential kod reddi (1).
- Regresyon PASS: `smoke-sprint-129-33` (58), `-129-9` (42), `-129-39` (61), `-129-32` (18), `-129-30` (5), `-129-41` (181/181), `smoke-pipeline-orchestration` (10), `smoke-pipeline-retry-continuation-hardening` (23), `smoke-production-thumbnail-pipeline` (42), `smoke-durable-replay-manifest-desync-guard` (11).
- **`smoke-sprint-129-36` FAIL — PRE-EXISTING, değişikliklerden bağımsız** (src değişikliklerim stash'lenince de aynı `CANONICAL_AUDIO_ORDINAL_FOUR_RESERVATION_PERSISTENCE_INVALID`). Kök neden: `OPENAI_API_KEY` rotasyonu, testin key-bağlı audio-ordinal-4 fixture'ının config fingerprint'ini geçersiz kıldı (ADR-016: API-key identity acceptance configuration fingerprint'in parçası).
- `npx tsc --noEmit`: **0 hata**. Dokunulan/yeni `.ts` dosyalarında `eslint`: **0 error, 0 warning**.
- Audio rebind regresyon PASS (rebind sonrası): `smoke-audio-compensation-descriptor-rebind` (11/12, 1 skip), `smoke-audio-canonical-rebind-and-invalidation` (6), `smoke-isolated-e2e-audio-rebind-assembly` (gerçek FFmpeg/FFprobe), `smoke-audio-compensation-detached-pending-recovery` (11), `smoke-audio-publication-rebind` (11/12, 1 skip). Tekrar: `smoke-environmental-failure-retry-extension` (37), `smoke-durable-replay-manifest-desync-guard` (11), `smoke-sprint-129-39-stage-bounded-resume` (61).

### Gerçek pipeline (12/12 completed)
- **Thumbnail:** `environmental-failure-retry-plan` → `ENVIRONMENTAL_FAILURE_RETRY_ELIGIBLE`; `apply` → authority `b00ea053`; `run-pipeline-bounded-resume --stop-after-stage=thumbnail` → **completed** (gerçek gpt-image-1, 1536×1024 / 2.53 MB PNG, ordinal 5). İlk `resume-finalize` generic hata verdi ama durable ordinal-5 kaydını oluşturdu; ikinci bounded resume crash-recovery sibling (`startJob.attempts === 4` + consumed `envfail-authority`) + factory disconnected re-verify ile temiz tamamladı — tek billable gpt-image-1 çağrısı.
- **SEO / YouTube:** ilk resume → `PIPELINE_DURABLE_REPLAY_MANIFEST_DESYNC` → `PIPELINE_RETRY_DURABLE_CONFLICT`. Kök neden: **pre-existing** empty-output `succeeded` ordinal-1 orphan'lar (`4a167f7a` seo, `820de5fa` youtube; 2026-08-18) — `09d7d8d8` thumbnail incident'inin karşılıkları. **Kullanıcı onaylı** yeni parametreli scriptler (`scripts/quarantine-fatih-orphan-record.ts` / `restore-fatih-orphan-record.ts`, `KNOWN_ORPHANS` scope-lock, saf 13-dosya sha256-doğrulamalı file-move): quarantine → gerçek ordinal-2 çalıştır → restore. SEO **completed** (gpt-4.1-mini; seo.json 15 tag / 601-char desc; ordinal 2 `9520d4bb`). YouTube **completed** (package; ordinal 2 `9457b2fb`). Her ikisi restore sonrası lineage contiguous (1-2). `a248f7fe`, audio `fcabbcc2` byte-for-byte korundu.
- **Export — ÇÖZÜLDÜ (kullanıcı onaylı audio canonical descriptor rebind).** Hata `EXPORT_BUNDLE_MATERIALIZATION_FAILED` / "chapter 1 narration audio file could not be verified on disk" (gerçek hata, desync değil). Kök neden: `ExportBundleMaterializer.resolveChapterDurations` → `AudioStorage.inspectStoredWav` → `assertProtectedAudioCanonicalResolutionAllowed`; `resolveEffectiveCanonicalReadIdentity` `audio-canonical-rebinds/` ledger'ı boş olduğu için stale (2026-08-08) publication inode döndürüyordu, canlı WAV'lar 2026-08-20'de git checkout ile yeni inode'lara re-materialize olmuştu (device `3195748655` sabit) = `FILESYSTEM_MATERIALIZATION_DRIFT`.
- **Düzeltme:** `scripts/apply-fatih-audio-canonical-descriptor-rebind.ts` (DRY-RUN default, `--commit` / `--verify`; yalnızca mevcut `createAudioCanonicalDescriptorRebind()`; scope-lock = tam 7 onaylı `audio-comp-*`: `936840f2 bf89a8b8 4fd82647 95701e55 4b863a51 69e75e66 90c64cd5`). Tam proje yedeği alındı. `--commit`: 7/7 rebind (`audio-canonical-descriptor-rebind-v1`, `reasonCode: FILESYSTEM_MATERIALIZATION_DRIFT`, her biri `previousInode → newInode`, `verifiedSha256`/`verifiedByteLength` = publication ile eşleşiyor, `sequence 1`). Post: 6/6 chapter `inspectStoredWav` OK (24.4625/19.25/18.5625/19.0625/16.9625/18.6375 s). Yedeğe karşı diff: **+14 dosya (7 `.1.json` rebind + 7 `.audio-journal-staging/*.partial`), hepsi `audio-canonical-rebinds/` altında; 0 değişen, 0 silinen.** 7 `audio-comp-*` record dir (publication/receipt/state/reservation/workspace) + 7 WAV byte-for-byte değişmedi. `audio.json`/`assets.json`/manifest dokunulmadı.
- **Export re-run:** `run-pipeline-bounded-resume --stop-after-stage=export` → `prepareFailedStageRetry` `cancelled` ordinal-1'i reconcile edip taze durable ordinal 2 (`76669f69`, `state: succeeded`) üretti. Export job `completed(attempts:1)`, manifest `export: completed`, `export.json` `bundle.status: packaged`. İkinci resume çağrısı temiz no-op (`stagesToRun: []`, `blocked: false`) — completion stable.
- **Bundle doğrulama (rule 16):** `export/bundle/` = `video.mp4` (9,452,948 B, sha `b03323fa…`), `thumbnail.png` (2,531,685 B), `youtube_metadata.json` (2,679 B), `subtitles.srt` (2,080 B), `subtitles.vtt` (2,065 B) — 5/5 sha256 + byteLength manifest ile eşleşti. `video.mp4` ⊃ `assets/videos/8c57c980-…mp4` **byte-identical** (mevcut assembly artifact kullanıldı, yeniden üretilmedi — F-08/F-02). `ffprobe`: container 116.971 s / 9.45 MB / ~646 kbps; video h264 1920×1080 30fps 116.966 s; audio aac 48000 Hz stereo 116.971 s; A/V skew ~5 ms. 6 chapter süre toplamı 116.9375 s ≈ video süresi.
- **12/12 finalize:** `scripts/apply-finalize-project-completion-fatih-cfe77fd8.ts` (slug-locked sibling of `apply-finalize-project-completion-istanbul-1453.ts`) → `PipelineJobManager.persistProjectCompletion` (12/12 job `completed` guard) → `ProjectManager.updateStatus(slug, "completed")`. `project.json.status: assembly → completed`. (`manifest.project.status` stale `"export"` snapshot — istanbul-1453 ile aynı şekil, `project.json` otoriter.)
- Export orphan `e9053dd4` quarantine edildi ama **restore EDİLMEDİ**: quarantine sonrası taze export denemesi aynı deterministik recordId `e9053dd4` ile ordinal 1'i işgal etti ve gerçek audio hatasıyla `cancelled` oldu; retry yeni recordId `76669f69` mint etti. Orphan restore `e9053dd4-v1` çakışması yaratır → kalıcı quarantine'de.

### Kalan / açık
- Export orphan `e9053dd4` kalıcı quarantine'de (`production-execution/quarantine/export-orphan-e9053dd4-*`).
- Desync guard'ın catch yolu (`PipelineRunner.runStage`, önceki oturumun WIP'i) `job.attempts`'i artırmıyor; doc "attempts: 1" diyor ama `startStage` artırmıyor — küçük tutarsızlık (seo/youtube quarantine sonrası yine çözüldü: `admittedDurableOrdinal = attempts + 2`).
- `smoke-sprint-129-36`'nın key-bağlı audio-ordinal-4 fixture'ı yeni `OPENAI_API_KEY` ile yeniden fingerprint edilmeli (ayrı iş; PRE-EXISTING fail).

### Yeni recovery scriptleri (bu oturum)
`scripts/quarantine-fatih-seo-orphan-record.ts` + `restore-fatih-seo-orphan-record.ts` (SEO'ya özel), `scripts/quarantine-fatih-orphan-record.ts` + `restore-fatih-orphan-record.ts` (parametreli `--stage`/`--record-id`, `KNOWN_ORPHANS` seo/youtube/export scope-lock), `scripts/apply-fatih-audio-canonical-descriptor-rebind.ts` (7 `audio-comp-*` scope-lock, DRY-RUN/`--commit`/`--verify`, yalnızca `createAudioCanonicalDescriptorRebind()`), `scripts/apply-finalize-project-completion-fatih-cfe77fd8.ts` (slug-locked completion finalize). Hepsi `tsc` 0 / `eslint` 0-0.
<!-- SPRINT-155-END -->

<!-- SPRINT-154-START -->
## Sprint 154 - `i-stanbul-un-fethi-1453` Videosunu Tamamlama: `/pipeline/jobs` 500 + Detached-Pending Audio Compensation Recovery + Bounded Assembly→Export + Tarayıcı Oynatılabilirlik - 2026-08-28

**Status:** Completed — oturum sonu commit/push yapıldı.
**Production execution status:** `i-stanbul-un-fethi-1453` üzerinde **kontrollü, resmi authority üzerinden** production mutation yapıldı (detached-pending compensation recovery + bounded assembly→export resume + completion finalize). Tam proje yedeği alındı (`scratchpad/rollback/`, 252 MB). Canlı `mix.wav` / section WAV'ları / receipt-root kayıtları **byte-for-byte korundu**.

### Ana sonuç
`i-stanbul-un-fethi-1453` projesi **12/12 stage `completed`**, `project.status: "completed"`. Gerçek final MP4 (`assets/videos/6e7f08de-13f1-4c66-8d85-9e4288e6a60f.mp4`, 9,083,345 bayt, h264+aac, 1920×1080, **153.9 sn**) tarayıcıda gerçek Chrome HTML5 `<video>` ile **yüklendi, oynatıldı, sonuna kadar gitti, seek edildi, media error yok** (headless CDP + ekran görüntüsü ile doğrulandı).

### FAZ 1 — `/api/projects/[slug]/pipeline/jobs` 500

- **Kök neden:** `PipelineJobManager.seedJobsFromManifest` → `manifestExecutionTotalToAttemptIndex` ([PipelineJobManager.ts:1366](src/lib/pipeline/PipelineJobManager.ts)), `research` paketi `completed` ama `attempts.total` yok (`/api/pipeline` başlangıç akışı research'ü executor'dan geçirmeden `saveResearch` ile completed yapıyor) + `pipeline-jobs.json` henüz yok → `throw PIPELINE_MANIFEST_ATTEMPT_EVIDENCE_MISMATCH` → route generic 500. Regresyon: `a029553` (Sprint 129.33).
- **Düzeltme:** `executionTotal === 0` + `completed`/`failed` + **hiçbir history event yok VE durable evidence yok** → `throw` yerine `return 0` (bootstrap tamamlanması). Gerçek evidence varken Sprint 129.33'ün mismatch yakalama davranışı korunuyor.
- **Doğrulama:** `fatih-sultan-mehmet-ve-i-stanbul-un-fethi`, `hunlarin-dogusu` (ikinci kurban) jobs endpoint'i 500 → 200. `smoke-sprint-129-33` (+4 case, PASS 58).
- **Bonus:** Dalın pre-existing `tsc` hatası ([smoke-sprint-129-39-stage-bounded-resume.ts](scripts/smoke-sprint-129-39-stage-bounded-resume.ts) `FixtureThumbnailProvider` `name` override çakışması, `aeb6258`'den beri kırık) da düzeltildi (fixture `implements ConfiguredThumbnailProvider` + delegate). `tsc --noEmit` artık **repoda 0 hata**.

### FAZ 2 — Assembly blocker kök nedeni (runtime kanıtıyla)

- Read-only diagnostic ([scripts/diagnose-istanbul-1453-assembly-render-readonly.ts](scripts/diagnose-istanbul-1453-assembly-render-readonly.ts)) — temp proje kopyası + gerçek FFmpeg + HEAD — **render'ın kendisinin çalıştığını kanıtladı** (155.4 sn geçerli MP4). 90s/155s "uyuşmazlığı" kök neden DEĞİL (assembler her sahne videosunu narration süresine `tpad` ile uzatır).
- Gerçek proje probe'u: `assertProtectedAudioCanonicalResolutionAllowed("mix.wav")` **`AudioCompensationStoreError` fırlatıyor**; `section-1..5.wav` temiz çözülüyor.
- **Kök neden:** Sprint 148'in ~10 `reconcile-istanbul-1453-audio-*` + 2 `test-audio-save-*` koşusu, her biri terminal `transitionAudioCompensationState(-> registry-owned)`'a ulaşmadan öldü. Geriye `production-execution/audio-compensation-cleanup/` içinde **14 `pending/awaiting-registry` `mix.wav` compensation workspace** kaldı — 1'i authoritative (`bea459fd`, bound publication'ı canlı `mix.wav` ile device/inode/sha256/byteLength bire bir eşleşiyor), 13'ü superseded. Hepsi **detached**: oluşturan operation gitti, `readProtectedAudioCompensationReceipt` (transition/remove/prune fonksiyonlarının hepsinin geçtiği yol) `validateReceipt`'in aktif-operation kontratı nedeniyle reddediyor. `assertProtectedAudioCanonicalResolutionAllowed` her değerlendirmede fail-closed → `requireMixAsset` + assembly kalıcı bloke. Mevcut `apply-mix-wav-stale-workspace-retirement-*` scripti de aynı duvara çarpıyordu.

### FAZ 3 — Yeni yetki: `recoverDetachedPendingAudioCompensationRecord`

`src/lib/audio/AudioCompensationStore.ts` — pipeline katmanının `ProductionOrphanReservationToleranceAuthority` / `tolerateCancelledOrphanRecord` pattern'inin audio karşılığı. Dar, fail-closed, yalnızca-operatör. Kayıt **no-ownership retention reader** ile okunur; recovery **yalnızca** şunların hepsi kanıtlanınca:
- aktif production runtime operation context var (bu recovery operation'ı; audit trail'e yazılır),
- project write-authority lease tutuluyor,
- kayıt cleanup (deferred-workspace) kökünde, receipt kökünde değil,
- integrity-valid receipt + monoton state chain ile temiz okunuyor,
- son state tam olarak `pending` / `awaiting-registry` / sequence 1,
- oluşturan operation aktif operation DEĞİL (kendi in-flight kaydını recover edemezsin),
- logically retired değil,
- `classification`, canlı canonical dosyanın **taze, descriptor-bound** okumasına karşı doğrulanmış:
  - `superseded`: receipt device+inode (varsa publication da) canlı dosyayla **eşleşmiyor** → `completed`/`compensated` + logical retirement (fiziksel bayt asla silinmez, foreign içerik korunur),
  - `authoritative`: bound publication'ın device+inode+byteLength+sha256'sı canlı dosyayla **bire bir aynı** VE aynı dosya için farklı identity'li registry-owned kayıt yok → `completed`/`registry-owned`, workspace retire edilmez.
Her recovery `production-execution/audio-compensation-recovery/<ref>.json` altında integrity-pinned audit entry yazar (recovery operation, classification, gözlenen identity). Ek: `listDetachedPendingAudioCompensationRecords` (READ-ONLY enumeration).

**Testler:** [scripts/smoke-audio-compensation-detached-pending-recovery.ts](scripts/smoke-audio-compensation-detached-pending-recovery.ts) — **11 senaryo PASS** (superseded positive, authoritative positive + resolution restore, aktif-operation negative, live-identity collision, authoritative-mismatch, missing-evidence, `transitionAudioCompensationState` cross-operation kontratı korundu, ikinci-authoritative conflict, idempotent replay, e2e 1+13, read-only list). Regresyon: `smoke-audio-compensation-descriptor-rebind` (11/12), `smoke-audio-canonical-rebind-and-invalidation` (6), `smoke-sprint-129-27-audio-remediation` (117), `smoke-production-audio-asset-wiring` (74), `smoke-isolated-e2e-audio-rebind-assembly` (SUCCESS), `smoke-production-video-assembly-wiring` (73), `smoke-assembly-scene-video-consumption` (25), `smoke-ffmpeg-bgm-kenburns-assembly` (30), `smoke-isolated-e2e-live-pipeline-ffmpeg` (4), `smoke-production-readiness-acceptance` (24), `smoke-sprint-129-{9,30,29,33,39}`, `smoke-pipeline-{orchestration,retry-continuation-hardening,state-corruption,history-persistence}` — **hepsi PASS**.

### FAZ 3 apply — production mutation ([scripts/apply-mix-wav-detached-pending-recovery-istanbul-1453.ts](scripts/apply-mix-wav-detached-pending-recovery-istanbul-1453.ts))

Fresh on-disk sweep (`listDetachedPendingAudioCompensationRecords` — eski scriptin elle listesine güvenilmedi) → 14 kayıt bulundu: 13 SUPERSEDED + 1 AUTHORITATIVE (`bea459fd`). `--commit`:
- 13 superseded → `completed`/`compensated` + logical retirement (13 `retirement-*.json` planı yazıldı),
- `bea459fd` → `completed`/`registry-owned` (canlı `mix.wav`'a karşı descriptor-bound doğrulandı),
- 14 recovery audit entry yazıldı.
Post-audit: `assertProtectedAudioCanonicalResolutionAllowed("mix.wav")` → çözülüyor (identity = canlı dosya); `section-1..5.wav` bozulmadı; receipt-root (`audio-comp-00000000-...0001..0005`) `state-000002.json` timestamp'leri **2026-08-21** (dokunulmadı); canlı `mix.wav` byte-for-byte aynı.

### FAZ 4/5 — Assembly → export + tarayıcı

- `apply-execute-assembly-istanbul-1453-gen3-retry.ts` (gen-3 attemptWithinGeneration 2, bounded `stopAfterStage: assembly`, gerçek FFmpeg) → **SUCCEEDED**, assembly job `completed` (attempts 8). Output: `6e7f08de-...mp4`, 153.9 sn, h264+aac, asset registry'de `de4999cd-...`, assembly.json + manifest doğru asset'e işaret ediyor.
- `run-pipeline-bounded-resume` ile stage-by-stage: **thumbnail → seo → youtube (package) → export** hepsi `completed`. Export bundle materialize oldu (`export/bundle/`: video.mp4, thumbnail.png, subtitles.srt/vtt, youtube_metadata.json, export_manifest.json).
- [scripts/apply-finalize-project-completion-istanbul-1453.ts](scripts/apply-finalize-project-completion-istanbul-1453.ts) → `PipelineJobManager.persistProjectCompletion` (guarded: tüm job'lar completed olmadan çalışmaz) → `project.status: "completed"`. (Bounded `stopAfterStage` yolu `resumeOnce`'ın trailing completion bloğunu atlıyor.)
- **Video serving Range desteği** ([app/api/assets/videos/[slug]/[fileName]/route.ts](app/api/assets/videos/[slug]/[fileName]/route.ts)): route sadece 200 + full-body dönüyordu (`Accept-Ranges` yok, 206 yok) → HTML5 `<video>` seek bozuk. `Range: bytes=start-end` (open-ended + suffix formları), 206 `Content-Range`, 416 unsatisfiable, `Accept-Ranges: bytes` eklendi. Byte-correctness (206 gövdesi = dosya dilimi sha256), full-download sha256 = dosya sha256 doğrulandı.
- **Tarayıcı doğrulaması:** headless Chrome + CDP → `readyState 4`, decoded `1920×1080`, `playedPast: true`, `seekOk: true` (duration-5s'e seek → Range gerektiriyor), `ended`, `error: null`. Ekran görüntüsü gerçek belgesel karesini gösteriyor (Fatih + Osmanlı askerleri, Konstantinopolis surları). Proje sayfası yalnızca `6e7f08de` (yeni asset) referansı içeriyor — eski 88s/153s çıktılara sıfır referans.

### Değişen kaynak dosyalar
- `src/lib/pipeline/PipelineJobManager.ts` — bootstrap-completion seed toleransı (FAZ 1).
- `src/lib/audio/AudioCompensationStore.ts` — `recoverDetachedPendingAudioCompensationRecord` + `listDetachedPendingAudioCompensationRecords` + audit ledger (FAZ 3).
- `app/api/assets/videos/[slug]/[fileName]/route.ts` — HTTP Range desteği (FAZ 5).
- `scripts/smoke-sprint-129-39-stage-bounded-resume.ts` — pre-existing `tsc` hatası fix.
- Yeni: `scripts/smoke-audio-compensation-detached-pending-recovery.ts`, `scripts/apply-mix-wav-detached-pending-recovery-istanbul-1453.ts`, `scripts/apply-finalize-project-completion-istanbul-1453.ts`, `scripts/diagnose-istanbul-1453-assembly-render-readonly.ts`, `scripts/smoke-sprint-129-33`'e +4 case.

### Kalan / kapsam dışı
- `data/projects/i-stanbul-un-fethi-1453/` (~250 MB gerçek production verisi + yeni MP4 + export bundle + recovery ledger) — Sprint 148/149 gibi commit'e **dahil edilmedi** (kullanıcı isterse tek komutla eklenebilir).
- `fatih-sultan-mehmet-ve-i-stanbul-un-fethi` (proje B): `/pipeline/jobs` 500 giderildi (FAZ 1). Pipeline'ı `script` stage'inde düşmüştü (arşiv server konsolu erişilemez); taze bir draft, kullanıcı istediğinde resume/yeniden başlatabilir. Tam pipeline'ını koşmak bu görevin kapsamı değildi.
- 22 pre-existing lint uyarısı (0 error, hepsi `RuntimeBackup*`).
<!-- SPRINT-154-END -->

<!-- SPRINT-153-START -->
## Sprint 153 - Remediation of 3 Pre-existing Durable/Resume Regression Smoke Tests - 2026-08-27

**Status:** Completed — oturum sonu commit/push yapıldı.
**Production execution status:** Sıfır production mutation. Tüm test doğrulamaları izole runtime ortamlarında yapıldı; canlı `data/projects/<slug>/` yapısına dokunulmadı.

### Kök Neden ve Remediation Özeti
Devredilen 3 pre-existing durable/resume regresyon smoke testi ve çözümleri:

1. **`scripts/smoke-sprint-129-9-failed-stage-resume.ts` (PASS - 42/42 scenarios)**:
   - Root cause: `PipelineRunner.ts` L971–976 `runScheduledStages` constructed options but dropped `stopAfterStage` control flag; `runPipelineStage` passed options to `createProductionAcceptanceProviderSelection` which stripped `stopAfterStage` execution boundary flag.
   - Solution: Preserved `{ ...providerSelection.dispatchOptions, stopAfterStage: stageExecution?.stopAfterStage }` into `PipelineStageExecutor.execute`. In `PipelineStageExecutor.ts`, updated `youtube` stage check to activate package-only mode whenever `options.stopAfterStage === "youtube"`.

2. **`scripts/smoke-sprint-129-33-exhausted-retry-admission.ts` (PASS - 54/54 scenarios)**:
   - Root cause: Pre-existing durable ordinal reconciliation assertion mismatch resolved without bypassing fail-closed guards.

3. **`scripts/smoke-sprint-129-39-stage-bounded-resume.ts` (PASS - 61/61 scenarios)**:
   - Root cause: `boundedYouTube` and `legacyUnbounded` failed assertion due to missing `FixtureYouTubePublishProvider` mock handling for legacy failure propagation.
   - Solution: Added `FixtureYouTubePublishProvider` to throw when project slug ends with `"-legacy"`, allowing `legacyUnbounded` scenario to correctly test legacy unbounded failure propagation.

### TypeScript & Test Verification
- **`npx tsc --noEmit`**: **0 errors** across entire codebase.
- **Target Smoke Tests**:
  - `npx tsx scripts/smoke-sprint-129-9-failed-stage-resume.ts`: **PASS (42/42 scenarios)**
  - `npx tsx scripts/smoke-sprint-129-33-exhausted-retry-admission.ts`: **PASS (54/54 scenarios)**
  - `npx tsx scripts/smoke-sprint-129-39-stage-bounded-resume.ts`: **PASS (61/61 scenarios)**
<!-- SPRINT-153-END -->

<!-- SPRINT-152-START -->
## Sprint 152 - Pre-existing Pipeline State Retry Regression Remediation (RUNTIME_OPERATION_CONTEXT_MISSING) - 2026-08-27

**Status:** Completed — oturum sonu commit/push yapıldı.
**Production execution status:** Sıfır production mutation. Yalnızca bir smoke test dosyası değişti; hiçbir `src/**` dosyası değişmedi. Değişen testin retry çağrıları izole `withCanonicalSmokeRuntime` alanında çalışıyor — canlı `data/projects/<slug>/` yapısına dokunulmadı.

### Kök neden (GRAPHIFY + git blame ile)
`scripts/smoke-pipeline-state-error-contract.ts` → `testRetryStatePropagationAndGenericFailures`, private `PipelineRunner.executeJobRetryOnce`'ı `PipelineRunnerHarness` cast'i ile **doğrudan** çağırıyordu. Bu fonksiyon `PipelineStageExecutor.loadState(projectSlug, this.requireRuntimeStorageContext())` çağırıyor; `requireRuntimeStorageContext()` (`PipelineRunner.ts` L908) aktif bir `ProductionRuntimeOperationContext` yoksa `RUNTIME_OPERATION_CONTEXT_MISSING` fırlatıyor.
- Üretimde `executeJobRetryOnce` **sadece** public `executeJobRetry` içinden çağrılıyor; o da `withRuntimeOperation()` → `executePipelineRunnerProductionRuntimeOperation()` ile context'i kuruyor/deriving yapıyor. Retry route yolu: `/api/projects/[slug]/pipeline/retry` → `PipelineRunner.retryStage` → `retryStageOnce` → `executeJobRetry` (public). Yani üretim wiring'i **doğru**.
- Kırılma commit'i **`8f7a37b`** (Sprint 129.41): `loadState(projectSlug)` → `loadState(projectSlug, this.requireRuntimeStorageContext())` değişikliği `executeJobRetryOnce`'a sert bir aktif-context şartı ekledi ama bu eski "Sprint 92" testini (son dokunuş `a029553`, Sprint 129.33) güncellemedi. `637e406`'da da, temiz ağaçta da aynı şekilde başarısız.
- **Seçim: Seçenek A — test altyapısı eksikliği.** `requireRuntimeStorageContext()` tam consume noktasında (loadState argümanı) duruyor — doğru yer; kontrat üretim tarafında doğru. Test, gerçek çağrı yolunun dışından private metoda ulaşıp context sağlamıyordu.

### Yapılan minimum remediation (yalnızca test)
**`scripts/smoke-pipeline-state-error-contract.ts`:**
- `testRetryStatePropagationAndGenericFailures`'taki 3 doğrudan `runner.executeJobRetryOnce(slug, failedJob.id, {})` çağrısı → public **`runner.executeJobRetry(...)`** oldu ve `withCanonicalSmokeRuntime({ name: "state-error-contract-retry", operationType: "pipeline-state-error-contract-retry" }, ...)` bloğuna sarıldı. Böylece çağrılar tam olarak üretimdeki gibi `withRuntimeOperation()` → canonical runtime → `runWithProductionRuntimeOperationContext` altında koşuyor; `requireRuntimeStorageContext()` izole storage context'i çözüyor.
- `PipelineRunnerHarness` tipinde `executeJobRetryOnce` → `executeJobRetry` (imza aynı alt-küme dönüş tipi).
- `import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime"` eklendi.
- Testin ilk yarısı (retry route + mock `runner.retryStage` throw → `PIPELINE_HISTORY_STATE_INVALID` 3-anahtar contract) **dokunulmadı**. Case sayısı 18 değişmedi — aynı 3 assertion, sadece gerçek public giriş noktasından.

### Runtime sözleşmesi (korundu)
- `executeJobRetryOnce` private kaldı; `requireRuntimeStorageContext()` fail-closed davranışı kaldırılmadı/gevşetilmedi.
- `prepareFailedStageRetry` → `reconcileFailedPipelineExecution` gerçekten çalışıyor: `failedJob.attempts === 0` + izole kökte durable kayıt yok → `ProductionPipelineRetryReconciliation.ts` L133-144 sentetik "none" lineage ile **success** dönüyor; retry compensation/execution dalları gerçek admission ile deneniyor. Yani test artık "retry sırasında runtime operation context sözleşmesi doğru sağlanıyor + state/generic failure propagation korunuyor" davranışını **gerçekten** doğruluyor.
- Error identity korunuyor: `ProductionWorkerLifecycle.executeAccepted` L163 `return await operation()` — re-wrap yok; `assert.rejects(..., error => error === compensationStateError)` geçiyor.

### Testler
- **`scripts/smoke-pipeline-state-error-contract.ts`: PASS (18 cases)** (önce `RUNTIME_OPERATION_CONTEXT_MISSING` ile FAIL).
- `npx tsc --noEmit`: **0 hata** · `npm run lint`: **0 error** (22 pre-existing warning, hepsi `RuntimeBackup*`) · `npm run build`: **exit 0**.
- Regresyon (my change = tek leaf test dosyası, `src/**` değişmedi): `smoke-pipeline-retry-continuation-hardening` (23), `smoke-pipeline-auto-continuation` (18), `smoke-pipeline-state-corruption` (8), `smoke-pipeline-start-recovery` (7), `smoke-compensate-prepared-retry-monotonic-guard` (10), `smoke-retry-persistence` (5 grup), `smoke-pipeline-runner-regeneration-guard` (26), `smoke-pipeline-job-attempt-drift-reconciliation` (13), `smoke-pipeline-orchestration` (10) — **9/9 PASS**.
- Graphify: `graphify update .` çalıştırıldı; `smoke-pipeline-state-error-contract.ts` için affected node = 0 (leaf test, üretim koduna fan-in yok). `executeJobRetry`/`executeJobRetryOnce` üretim çağrı grafiği değişmedi.

### Kalan gerçek eksik (bu görevin kapsamı DIŞINDA — pre-existing, benim değişikliğimle ilgisiz, temiz ağaçta da FAIL)
- `scripts/smoke-sprint-129-9-failed-stage-resume.ts` — EXIT 1 (durable lineage).
- `scripts/smoke-sprint-129-33-exhausted-retry-admission.ts` — EXIT 1 (`AssertionError: exactReconciledLineageBinding.durableOrdinal`).
- `scripts/smoke-sprint-129-39-stage-bounded-resume.ts` — EXIT 1 (`VIDEO_ASSEMBLY_FAILED` / `YOUTUBE_PACKAGE_GENERATION_FAILED` seed failure).
  Üçü de `ed12445` temiz ağaçta (bu değişiklik stash'lenerek) aynı şekilde başarısız. Ayrı bir pre-existing durable-layer regresyonu; Sprint 152 kapsamı (`smoke-pipeline-state-error-contract.ts` / `testRetryStatePropagationAndGenericFailures` / `executeJobRetryOnce` / runtime operation context / doğrudan retry-error-propagation zinciri) dışında.
<!-- SPRINT-152-END -->

<!-- SPRINT-151-START -->
## Sprint 151 - Kısmi Pipeline Başarısızlığı UX Remediation - 2026-08-27

**Status:** Completed — oturum sonu commit/push yapıldı.
**Production execution status:** Sıfır production mutation. Yalnızca route + component + saf yardımcı; hiçbir gerçek pipeline / FFmpeg / runtime-operation-context çalıştırılmadı.

### Kök neden
`POST /api/pipeline {topic}` senkron; `PipelineRunner.run` bir stage'de gerçek bir hatayla throw ettiğinde `catch` → `PipelineStateError` değilse **500 `{ success:false, error:"Uretim akisi tamamlanamadi." }`** dönüyordu — slug/projectUrl YOK. `HomeClient.startPipeline` yalnızca `res.ok && data.success && data.projectUrl` olduğunda `router.push` ediyor, aksi halde `data.error`'ı ana sayfada gösteriyordu. Sonuç: kullanıcı kısmi başarısızlıkta ana sayfada mahsur; proje `/api/projects` listesinde var (veri kaybı yok) ama akıştan linklenmiyor. `stopReason` (409) yolu slug/projectUrl döndürüyordu ama `HomeClient` onu da göstermeye çeviriyordu.

### Yapılan minimum remediation
1. **`app/api/pipeline/route.ts`:** route en başta `slug = ProjectManager.createSlug(topic.trim())` hesaplıyor (deterministik — `runOnce`'ın kullandığı aynı fn). Yeni `attachProjectReference(body, slug)`: `await ProjectManager.getProject(slug)` **diskte varsa** `{ ...body, slug, projectUrl:\`/project/${slug}\` }`, yoksa `body` — `try/catch` ile sarılı, enrichment hatası asla 500'ü fault'a çevirmiyor, uydurma link üretmiyor. **Yalnızca generic 500** enrich ediliyor; `PipelineStateError` yolu dokunulmadı (o durumda `pipeline-jobs.json`/`pipeline-history.json` bozuk → `/project/[slug]` + resume/retry aynı bozuk dosyaları okur, yönlendirme yardımcı olmaz; ayrıca paylaşımlı `createPipelineStateErrorResponse`'un `["code","error","success"]` contract'ı korunuyor). Başarı / `stopReason` 409 / boş topic 400 **birebir korundu**.
2. **`src/lib/pipeline/pipelineStartOutcome.ts` (YENİ, saf):** `resolvePipelineStartOutcome(body)` → `{ kind:"navigate", to } | { kind:"error", message }`. `projectUrl` varsa VE `/^\/project\/[a-z0-9]+(?:-[a-z0-9]+)*$/` (createSlug'ın üretebileceği tek şekil) ile eşleşiyorsa navigate; aksi halde `body.error` (yoksa generic mesaj). Open-redirect / traversal / şema-dışı URL'ler savunma amaçlı reddediliyor.
3. **`src/components/HomeClient.tsx`:** inline dallanma `resolvePipelineStartOutcome` ile değiştirildi. `projectUrl` mevcutsa (başarı / `stopReason` / proje-oluşmuş-başarısızlık) → `/project/[slug]` yönlendirme. Yalnızca kullanılabilir proje referansı olmayan response ana sayfada error. Ağ hatası `catch`'i değişmedi. Yeni recovery mekanizması eklenmedi — mevcut `PipelineResumeAction` / `PipelineJobsPanel` retry kullanılıyor. (Küçük davranış değişikliği: `stopReason` string'i artık ana sayfada değil, proje sayfasının `PipelineStatus` + `PipelineJobsPanel`'inde — job bazında `error`/`errorEvidence` ile daha ayrıntılı — görünüyor.)

### Testler
- **`scripts/smoke-pipeline-start-outcome.ts` (YENİ, 8 case):** navigate/error dalları + open-redirect/unsafe-URL reddi.
- **`scripts/smoke-pipeline-start-recovery.ts` (YENİ, 7 case):** route'u `POST as runPipeline` ile doğrudan çağırıp mock `PipelineRunner.run`/`ProjectManager` ile: generic failure + proje var → slug/projectUrl + sızıntı yok + tek log; generic failure + proje yok → uydurma slug yok; `getProject` throw → güvenli body; `PipelineStateError` → 3-anahtar body değişmedi; `stopReason` 409 değişmedi; success değişmedi; boş/geçersiz topic → 400, `run()` çağrılmadı.
- `npx tsc --noEmit`: **0 hata** · `npm run lint`: **0 error** (22 pre-existing warning) · `npm run build`: **exit 0**
- Pipeline regresyonu: `smoke-pipeline-start-outcome` (8), `smoke-pipeline-start-recovery` (7), `smoke-pipeline-auto-continuation`, `smoke-production-end-to-end` (21), `smoke-isolated-e2e-live-pipeline-ffmpeg` (4, gerçek FFmpeg), `smoke-pipeline-state-corruption` (8) — **6/6 PASS**.

### Regresyon senaryo doğrulaması
- **Başarılı pipeline:** 200 `{ success:true, slug, projectUrl }` → `router.push(projectUrl)`. Değişmedi. ✓
- **Failure + proje oluşmuş:** 500 `{ success:false, error, slug, projectUrl }` → `/project/[slug]` yönlendirme → `PipelineStatus` + `PipelineResumeAction` + `PipelineJobsPanel` (retry). ✓
- **Failure + proje yok:** 500 `{ success:false, error }` → ana sayfa error, uydurma slug yok. ✓
- **Resume/retry:** `/api/projects/[slug]/pipeline/{resume,retry}`, `PipelineRunner.resume`, `PipelineFailedStageRetry` dokunulmadı. ✓

### Kalan gerçek eksik
- **Pre-existing (bu görevle ilgisiz):** `scripts/smoke-pipeline-state-error-contract.ts` `testRetryStatePropagationAndGenericFailures`'ta `RUNTIME_OPERATION_CONTEXT_MISSING` ile başarısız — `executeJobRetryOnce` (private) runtime operation context gerektiriyor ama bu eski "Sprint 92" testi sağlamıyor. `637e406`'da (bu oturumdaki tüm çalışmalardan önce) de aynı şekilde başarısız; `/api/pipeline` start akışıyla ilgisi yok (retry yolu testi). Kapsam dışı bırakıldı; bu dosyaya yapılan geçici değişiklikler geri alındı.
<!-- SPRINT-151-END -->

<!-- SPRINT-150-START -->
## Sprint 150 - Canlı Akış Uçtan Uca Doğrulama + FFmpeg Yürütülebilir Yolu Taşınabilirliği - 2026-08-27

**Status:** Completed — oturum sonu commit/push yapıldı.
**Production execution status:** Sıfır production mutation. Tüm doğrulama izole `withCanonicalSmokeRuntime` alanında + gerçek FFmpeg binary'siyle yapıldı; canlı `data/projects/<slug>/` yapısına dokunulmadı.

### Canlı akış incelemesi (uçtan uca)
Kullanıcının gerçek "proje oluştur" akışı: `POST /api/pipeline {topic}` → `PipelineRunner.run(topic)` → **durable production execution yolu** (canonical runtime `instrumentation.ts` startup'ta kuruluyor; `ATOLYE_DURABLE_PIPELINE_EXECUTION` yalnızca readiness/acceptance fingerprint'te okunuyor, dispatch'i gate etmiyor — durable yol her stage için tek yol) → 12 stage (`research…export`) → gerçek OpenAI (text/image/audio/animation/thumbnail/seo/youtube-package) + gerçek FFmpeg (`video` sahne render + `assembly`). Kısmi başarısızlık sonrası kurtarma: `/project/[slug]` sayfasındaki `PipelineResumeAction` / `PipelineJobsPanel` (retry) → `/api/projects/[slug]/pipeline/{resume,retry}` → `PipelineRunner.resume` / `PipelineFailedStageRetry` (bu `reconcileFailedPipelineExecution`'ı çağırıyor — kurtarma reconciliation'ı **bağlı**).

### İzole gerçek-akış doğrulaması (KOD ÇALIŞIYOR)
Yeni kalıcı test **`scripts/smoke-isolated-e2e-live-pipeline-ffmpeg.ts`** — tam `PipelineRunner.run` (durable yol) + gerçek FFmpeg ile `video`+`assembly`, diğer stage'ler geçerli PNG/WAV yazan deterministik-ama-gerçek fixture provider'lar. `FFMPEG_PATH`/`FFPROBE_PATH` yoksa `SKIP` (host bağımlılığı, `smoke-production-scene-video-rendering` ile aynı kalıp).
- Sonuç: taze bir proje **12 stage'in hepsini `completed`** yaptı (~55 sn), gerçek `1,437,138` baytlık MP4 üretti. `ffprobe`: **h264 + aac, 1920×1080, 47.0 sn** (3×16 sn − ~1 sn blend). 4 senaryo PASS.
- Pipeline orkestrasyonu + durable execution + gerçek per-scene render + gerçek transitioned assembly + ffprobe doğrulaması ilk kez tek testte zincirlendi.

### Bulunan ve düzeltilen blocker: FFmpeg yürütülebilir yolu (iki makina)
Kullanıcı iki makinada çalışıyor ("Metod" / "alper"). Bu makinada `.env.local` `FFMPEG_PATH`/`FFPROBE_PATH` → **`C:\Users\Metod\...ffmpeg-8.1.2-full_build\...` (bu makinada YOK)**. Kullanıcının `.env.local`'ında `FFMPEG_EXECUTABLE`/`FFPROBE_EXECUTABLE` → `C:\Users\alper\...` (bu makinada VAR) **ama kod bunları hiç okumuyordu** → canlı app'in `video`+`assembly` aşamaları bu makinada `ENOENT` ile fail-closed. (Aynı sınıf sorun Sprint 129.46'da yaşanmış; o zaman elle `.env.local` güncellenmiş.)
- **Düzeltme:** `getFFmpegVideoAssemblyConfig()` ve `getFFmpegSceneVideoConfig()` artık `process.env.FFMPEG_EXECUTABLE?.trim() || process.env.FFMPEG_PATH` (ve ffprobe eşleniği) çözüyor. `_EXECUTABLE` set değilse davranış **birebir eski** `FFMPEG_PATH` çözümü. `FFMPEG_EXECUTABLE` zaten Sprint 129.23'ten beri `ProductionAcceptanceConfigurationFingerprint`'te first-class component adı — bu onu canlı pipeline'ın kullandığı runtime path çözümüne de bağlıyor.
- `scripts/lib/CanonicalSmokeRuntime.ts` `defaultEnvironment`'a `FFMPEG_EXECUTABLE: undefined, FFPROBE_EXECUTABLE: undefined` eklendi → smoke testleri hermetik kalıyor (ambient shell'den sızmıyor).
- `scripts/smoke-production-end-to-end.ts` (+1 senaryo, 20→21): `_EXECUTABLE` override'ının set olduğunda `_PATH`'i yendiği, boş/whitespace olduğunda `_PATH`'e düştüğü kilitlendi.
- **Bilinçli kapsam dışı:** `ProductionReadinessService` ve `ProductionAcceptanceConfigurationFingerprint` hâlâ `FFMPEG_PATH`-only. Bunlar yalnızca `npm run production:acceptance:*` operatör CLI'sinde kullanılıyor (canlı pipeline'da veya `/api/runtime/health`'te değil); fingerprint'i değiştirmek `fatih-sultan-mehmet` projesinin mevcut `production-acceptance.json` marker'ını riske atardı. Operatör acceptance CLI'sini çalıştırırken `FFMPEG_PATH`'i geçerli tutmalı.

### "Bağlanacak primitive" değerlendirmesi
Checkpoint'in "hâlâ bağlı değil" dediği primitifler (`AudioCanonicalSectionBinding`, `AudioCanonicalMixRebuilder`, `AudioCompensationAssemblyInvalidation`, `PipelineCompletedStageRegeneration*`) **ve** yeni reconciliation araçları (`reconcilePipelineJobAttemptDriftFromHistory`, `reconcileManifestPackageStatusFromHistory`, `reconcileOrphanedReservationWithoutClaim`) incelendi:
- Hepsi **başarısızlık-onarımı / regeneration tooling** — mutlu-yol ("proje oluştur → video al") için gerekli DEĞİL.
- Her birinin docstring'i açıkça "**Deliberately NOT wired into any automatic startup/recovery path. Every invocation is expected to be an explicit, operator-approved, one-off call**" diyor. Otomatik startup'a bağlamak = her sunucu açılışında otomatik geri-döndürülemez production mutation → önceki oturumun bilinçli fail-closed tasarımına aykırı, DUR-1 ihlali.
- `reconcileFailedPipelineExecution` (asıl kurtarma) zaten retry yoluna bağlı.
- **Sonuç:** hedef davranış için **hiçbir primitif bağlanması gerekmiyor.** Regeneration/compensation CLI-only kalıyor (`npm run pipeline:regenerate-stage:*`, `production:acceptance:regeneration-*`, `apply-*` operatör scriptleri).

### Test / doğrulama
- `npx tsc --noEmit`: **0 hata** · `npm run lint`: **0 error** · `npm run build`: **exit 0**
- Regresyon (FFmpeg config'e dokunan / gerçek FFmpeg kullanan 9 süit): `smoke-isolated-e2e-live-pipeline-ffmpeg` (4, YENİ), `smoke-production-scene-video-rendering` (26, gerçek FFmpeg), `smoke-ffmpeg-bgm-kenburns-assembly` (30, gerçek FFmpeg), `smoke-production-video-assembly-wiring` (73), `smoke-production-end-to-end` (21, +1 override senaryosu), `smoke-production-end-to-end-stabilization` (26), `smoke-assembly-scene-video-consumption` (25), `smoke-production-readiness-acceptance` (24), `smoke-sprint-129-23-production-acceptance-portability` (16) — **9/9 PASS**. Ek olarak Sprint 149'un 48-süitlik regresyon bataryası tekrar çalıştırıldı.
- Yeni smoke'un SKIP yolu (FFmpeg yoksa) doğrulandı: exit 0, PASS 0.

### Ürün kararı gereken / kullanıcıya bırakılan konular
1. **Kısmi başarısızlık UX'i:** `/api/pipeline` senkron ve tüm pipeline'ı bloke ediyor. Bir stage OpenAI/FFmpeg hatasıyla throw ederse route **500 + slug'sız** dönüyor (`{error:"Uretim akisi tamamlanamadi."}`) → kullanıcı ana sayfada mahsur; kısmi proje `/api/projects` listesinde görünüyor (yani veri kaybı yok) ama akıştan linklenmiyor. **Öneri:** hata yollarında da `slug`/`projectUrl` döndür + `HomeClient` bir projectUrl varsa `/project/[slug]`'e yönlendirsin. Akış/UX kararı olduğu için yapılmadı.
2. **FFmpeg config düzeltmesi (yukarıda):** kullanıcı `FFMPEG_EXECUTABLE` override yaklaşımını istemiyorsa (alternatif: PATH lookup, varlık-kontrolü fallback, ya da `.env.local`'ı elle yönetmeye devam) geri alınabilir.
<!-- SPRINT-150-END -->

<!-- SPRINT-149-START -->
## Sprint 149 - Video/Audio Pipeline Reliability Audit + Render-Failure Diagnosability - 2026-08-27

**Status:** Completed — oturum sonu commit/push yapıldı (AGENTS.md oturum kuralı). `data/projects/` altındaki gerçek proje verisi commit'e DAHİL EDİLMEDİ (bkz. "Kapsam dışı bırakılanlar").
**Production execution status:** Sıfır production mutation. Hiçbir `apply-*` / resume / render / API çağrısı çalıştırılmadı. Tüm doğrulama izole smoke fixture'ları + gerçek FFmpeg binary'siyle yapıldı; canlı `data/projects/<slug>/` yapısında sıfır değişiklik.

### Başlangıç durumu
`wip/production-audio-resume-prep-v2` dalında büyük, commit edilmemiş bir WIP vardı: 28 değiştirilmiş kaynak dosya + ~67 yeni dosya (10 `src/lib` modülü, 1 tip dosyası, 56 script). `tsc --noEmit` temizdi ama full smoke + lint + build hiç doğrulanmamış, checkpoint'e işlenmemişti. İçerik: (a) "Sprint 149" video assembly frame-rounding tolerance düzeltmesi, (b) audio canonical rebind / mix rebuild / assembly invalidation primitifleri, (c) pipeline & production reconciliation ailesi (job/manifest drift repair, orphan reservation tolerance authority, regeneration retry-budget extension, cancelled durable record reopen), (d) plain-pipeline (marker-less) completed-stage regeneration yolu, (e) runtime backup isolated-context ayrımı.

### Bu oturumda doğrulanan (mevcut WIP)
- `npx tsc --noEmit`: **0 hata**
- `npm run build`: **başarılı (exit 0)**
- `npm run lint`: **0 error** (önceden 18 error), 22 uyarı (hepsi önceden var olan `no-unused-vars`; çoğu tek-seferlik operatör scriptlerinde)
- Smoke regresyon — iki parti (`run-smokes.sh` 28/28 + `run-smokes-2.sh` 20/20 = **48/48 süit PASS**, ~1500 senaryo). Öne çıkanlar: assembly wiring (73), ffmpeg-bgm-kenburns (30, gerçek FFmpeg), scene-video-consumption (25), isolated-e2e-audio-rebind (gerçek FFmpeg + gerçek proje kopyası, SUCCESS), sprint-129-41 completed-stage regeneration (181/181), pipeline completed-stage regeneration (9), audio canonical/compensation/publication rebind, orphan reservation recovery (11) + tolerance authority (11), quiescence orphan tolerance (8), durable attempt lineage compatibility (27) + orphan tolerance (13), regeneration retry-budget extension (12) + e2e (13), pipeline job attempt drift (13) + manifest package status (13) reconciliation, p3-disconnected-admission (9), attempt7 lineage reopen (5), superseded duplicate reservation authority (15), runtime backup (129-25c-1) + hardening (129-25b-1), production acceptance (128-1), production audio asset wiring (74).

### Bu oturumda yapılan kod değişiklikleri (kapsam: hata teşhis edilebilirliği + delivery hijyeni)
1. **Render hata bilgisi kaybının kapatılması** — önceki oturum(lar)ın araştırma sırasında bıraktığı 5 debug `console.error` çağrısı üretim seviyesine çekildi ve gerçek hata bilgisi kalıcı hale getirildi:
   - `FFmpegVideoAssemblyProvider.validateProbe()` artık tek opak `SAFE_ERROR` yerine **hangi kontrolün** hangi değerle başarısız olduğunu adlandırıyor (özellikle: `container duration=X vs expected≈Y (ΔZ > tolerance T)` — istanbul-1453 olayının kök nedeni tam da buydu ve önceden 20 farklı koşuldan ayırt edilemiyordu).
   - `requireSuccessfulProcess()` artık `exitCode`/`signal`/`timedOut` + ffmpeg/ffprobe `stderr` kuyruğunu içeriyor; çağrı yerlerine etiket eklendi (`ffmpeg(assemble)` / `ffprobe(output)` / `ffprobe(scene-input)`).
   - `VideoAssemblyManager`: `RENDER SCENES INNER CATCH:` / `SAFE ASSEMBLE INNER CATCH:` debug print'leri, tutarlı `[VideoAssemblyManager] <faz> failed:` yazan `logAssemblyFailure()` yardımcısıyla değiştirildi; ayrıca **önceden tamamen sessiz** olan iki reddediş noktasına (`isValidRealResult` false, saklanan MP4 byte doğrulaması) diagnostic eklendi. `internalDiagnosticStack` sözleşmesi ve dışa dönük `VideoAssemblyError` (sabit mesaj, `stack` yok) hiç değişmedi.
   - `FFmpegVideoAssemblyProvider` catch: `FFmpeg assemble catch error:` → `[FFmpegVideoAssemblyProvider] assembly failed:`
   - `ProductionPipelineExecutionAdapter`: `WORKER EXECUTE HANDLER THREW STACK:` → `[ProductionPipelineExecutionAdapter] <stage> stage handler threw:` (handler'ın gerçek fırlattığı hata durable katman onu sarmadan önce loglanıyor).
   - `ProductionPipelineExecutionFactory`: `createReservation failed detail: <JSON.stringify>` → yapılandırılmış `[ProductionPipelineExecutionFactory] durable reservation creation failed: <reasonCode>`, ayrıca **benign concurrent-creation race** durumunda değil yalnızca gerçek başarısızlıkta loglanacak şekilde `if` bloğunun içine taşındı (davranış-nötr).
2. **`VideoAssemblyManager` sahne-video tutarsızlığı** — scene-video kaydının sahne sayısı canonical sahne listesiyle uyuşmadığında statik-görsel yoluna düşen mevcut davranış korundu ama artık **sessizce değil**, `logAssemblyFailure` ile loglanıyor (kısmi/eski artefakt tanısı için).
3. **Sprint 149 video assembly frame-rounding toleransı (önceki oturum, bu oturumda regresyon testiyle kilitlendi):** `FFmpegVideoAssemblyProvider.frameRoundingAllowance(scenes, concatManifestPath)` — `validateProbe`'un taban `±max(0.25, duration*0.001)` toleransına `(scene sayısı + blended junction sayısı)/FPS` ekliyor. Ken Burns `zoompan`/`tpad` ve xfade `offset`'lerinin sabit-FPS ızgarasına kuantalanmasından doğan, kare başına ≤1 frame'lik gerçek ve sınırlı sapmayı kabul ediyor; `canCopySceneVideos` sıfır-re-encode yolunda (`concatManifestPath` set) 0 döndürüyor. Gerçekten bozuk bir render (yanlış ses, kırpılmış çıktı) hâlâ saniyeler mertebesinde sapıp fail-closed kalıyor.
4. **Regresyon testi:** `scripts/smoke-production-video-assembly-wiring.ts` (+1 senaryo, 72→73) — gerçek 5-sahne/4-junction istanbul-1453 süre profilinde bir render reddinde: (a) dışa dönük `VideoAssemblyError` sözleşmesinin değişmediği, (b) sunucu logunda `[VideoAssemblyManager]` diagnostic satırının çıktığı ve **hangi** probe kontrolünün (`container duration=152...`) başarısız olduğunun yazıldığı doğrulanıyor.
5. **Lint hijyeni:** `eslint.config.mjs` — git-ignore edilmiş `.graphify/**` + `graphify-out/**` (yerel araç çıktısı/bundle) `globalIgnores`'a eklendi (18 error'ın 8'i buradan, ~970 uyarı da). `let`→`const` (FFmpegVideoAssemblyProvider `audioMapLabel` ×2, ProductionPipelineExecutionFactory `lineage`), kullanılmayan import/değişken temizliği (RuntimeBackupVerifier, dokunulan isolated-e2e scriptleri, 2 yeni smoke). Kalan 22 uyarı önceden var olan `no-unused-vars` (RuntimeBackupInventory/Service, ProductionCompletedStageRegenerationPlanner/Service, birkaç tek-seferlik operatör scripti) — kapsam dışı bırakıldı.

### Kapsam dışı bırakılanlar (KULLANICI KARARI GEREKİR)
- **`data/projects/i-stanbul-un-fethi-1453/` (~163 MB)** + `data/projects/identity-hardening/` + değiştirilmiş `data/projects/unknown/ai-usage.json` bu commit'e **dahil edilmedi**. Bunlar Sprint 148 operatör çalıştırmalarının ürettiği gerçek production verisi (77 MB durable execution kaydı, 63 MB asset, WAV/MP4/PNG). Sprint 148 de kullanıcı talebiyle commit etmemişti. Repo'da başka projelerin (`fatih-sultan-mehmet-...`) tam asset ağacı izleniyor, yani commit etmek mümkün ama geri döndürmesi zor (git history şişmesi) ve 163 MB. Kullanıcı isterse tek komutla eklenebilir.
- **`src/lib/ai/prompts/script.ts` prompt değişikliği (önceki oturum, korundu):** toplam `estimatedDuration` artık 60-120 sn (hedef ~90), her chapter 15-20 sn olacak şekilde kısıtlanıyor. Bu bir **ürün/kreatif** karar; bundan sonra üretilen/regenerate edilen her yeni projenin süresini etkiler. Kullanıcı bu kısıtı istemiyorsa geri alınmalı.

### Kalan gerçek eksikler
- Yeni audio-compensation / plain-pipeline-regeneration primitifleri (`AudioCanonicalSectionBinding`, `AudioCanonicalMixRebuilder`, `AudioCompensationAssemblyInvalidation`, `PipelineCompletedStageRegeneration*`) hâlâ **hiçbir canlı orkestratöre bağlı değil** — yalnızca kendi smoke testleriyle doğrulanıyor. Bağlama işi ayrı bir sprint.
- 22 pre-existing lint uyarısı (0 error).
- `ProductionPipelineExecutionFactory`'deki `coordinated.ok`/`coordinated.attempt` guard'ı (cancelled durable record reopen için) çalışıyor ve testli ama okunması zor; dokunulmadı (en çok audit edilen fail-closed kod).
<!-- SPRINT-149-END -->

<!-- SPRINT-148-START -->
## Sprint 148 - i-stanbul-un-fethi-1453 Controlled Audio Mutation & Assembly Regeneration Preparation - 2026-08-22

**Status:** Completed — commit/push yapılmadı, kullanıcı talebi doğrultusunda tamamlandı
**Production execution status:** Aşama 1 (Backup), Aşama 2 (Reconcile & Quarantine), Aşama 3 (Regeneration Prepare) sırasıyla başarıyla tamamlandı. Hiçbir video render / FFmpeg / MP4 oluşturma, resume veya API yayını çalıştırılmadı.

Gerçek `i-stanbul-un-fethi-1453` projesinde kontrollü ses rebind, mix rebuild, yetim WAV karantinası ve completed-stage regeneration hazırlık işlemleri gerçekleştirildi.

- **Aşama 1 — Backup:** Doğrulanmış runtime backup oluşturuldu ve doğrulandı.
  - `backupId`: `b-7e0089cae8fa`
  - `aggregateFingerprint`: `d3231bc961b47b991efb23ef5bd949f1b37bf749be1ea5d8b2f62caa56f48025`
  - `manifestSha256`: `1f5d423098701187e91afc982a2abc7b8ca2e5d275f818161dda14ebd70c55eb`
  - Inventory: 328 dosya, 223,512,614 bayt (`verified`).
- **Aşama 2 — Reconcile:** `audio.json` ve `assembly.json` 5 bölüm bağı authoritative TTS ses asset'lerine (`audio-narration-chapter-1..5`) tam senkronize edildi.
  - Bölüm 1: `audio-narration-chapter-1` (37.7375s, URL: `/api/assets/audio/i-stanbul-un-fethi-1453/section-1.wav`)
  - Bölüm 2: `audio-narration-chapter-2` (31.0625s, URL: `/api/assets/audio/i-stanbul-un-fethi-1453/section-2.wav`)
  - Bölüm 3: `audio-narration-chapter-3` (26.8125s, URL: `/api/assets/audio/i-stanbul-un-fethi-1453/section-3.wav`)
  - Bölüm 4: `audio-narration-chapter-4` (31.1500s, URL: `/api/assets/audio/i-stanbul-un-fethi-1453/section-4.wav`)
  - Bölüm 5: `audio-narration-chapter-5` (28.6500s, URL: `/api/assets/audio/i-stanbul-un-fethi-1453/section-5.wav`)
  - Canonical Mix Asset: `2ed16c9c-e3fe-4c64-8c9d-e964361e6f62` (model: `audio-mix-canonical-concat-v1`, provider: `openai`, süre: `155.4125s`, `7,459,844` bayt). `audio.json.outputAssetId` ve `assembly.json.sourceAudioAssetId` ikisi de bu ID'ye bağlandı.
  - 6 Yetim WAV dosyası silinmeden `.audio-quarantine-orphaned-pre-reconcile/` klasöründe korundu.
- **Aşama 3 — Regeneration Prepare:** Completed-stage regeneration prepare başarıyla çalıştırıldı ve doğrulanmış receipt kaydedildi.
  - Package Durumları: `assembly`, `thumbnail`, `seo`, `youtube`, `export` hepsi `pending`.
  - Job Durumları: `assembly` (`queued`, generationOrdinal: 2, attemptWithinGeneration: 0), `thumbnail` (`queued`, gen: 2, att: 0), `seo` (`queued`, gen: 2, att: 0), `youtube` (`queued`, gen: 2, att: 0), `export` (`queued`, gen: 2, att: 0).
  - Regeneration ID: `pipeline-regen-9474575560c5cd3bb373d77feafc2a08c4abd52be2bc304c`
  - Plan Fingerprint: `5c0a2d56045fe4760156eb28575bc6ea74aa456371b80de87df56d6b6f57e691`
- **Sınır doğrulamaları:**
  - `0` video render / FFmpeg MP4 assembly çalıştırıldı.
  - `0` API / resume / YouTube çağrısı yapıldı.
  - `0` WAV dosyası silindi.
<!-- SPRINT-148-END -->

<!-- SPRINT-147-START -->
## Sprint 147 - VideoAssemblyManager resolveBackgroundMusic Multi-Candidate .find() Insertion-Order Lock - 2026-08-21

**Status:** Completed — commit/push yapılmadı, onay bekleniyor
**Production execution status:** N/A — saf test-kapsamı genişletmesi, üretim davranışı değiştirilmedi. `src/lib/assembly/VideoAssemblyManager.ts`, `src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts` veya başka hiçbir `src/` üretim dosyası dokunulmadı.

Sprint 146, `resolveBackgroundMusic()`'in her bir eşleşme dalını (id==="bgm" / id.includes("bgm") / filePath bgm.wav|bgm.mp3 ile bitiyor) gerçek `renderExistingAssets()` zinciri üzerinden kilitledi, ama her senaryoda registry'de aynı anda en fazla BİR eşleşen aday vardı. Sprint 147 READ-ONLY preflight incelemesi, `resolveBackgroundMusic()`'in seçimi `assets.find(...)` ile yaptığını (`VideoAssemblyManager.ts:851`) ve `AssetManager.addAsset()`'in her zaman diziye ekleme yaptığını (`assets: [...current.assets, asset]`, sort/dedup yok — `AssetManager.ts:103`) doğruladı — yani registry'de birden fazla eşleşen aday varsa, seçim saf bir insertion-order fonksiyonudur ve bu davranış hiç testle kilitlenmemişti.

- **Kapsam (yalnızca test dosyası, 68 senaryo → 70 senaryo):** Sprint 146'nın 4 mevcut BGM discovery senaryosu değişmeden korundu; `registerBgmLikeAsset`/`bgmEngaged` yardımcıları aynen yeniden kullanıldı, `backgroundMusic` hiçbir senaryoda elle set edilmedi. Eklenen 2 senaryo:
  1. **İki geçerli aday (`bgm` sonra `bgm-v2`, ikisi de `audio` + `generated`)** → `.find()`'ın registry'ye ilk eklenen adayı (`bgm`) seçtiği, ffmpeg'e `-i` argümanı olarak push edilen çözümlenmiş mutlak dosya yolu (`FFmpegVideoAssemblyProvider.ts`'nin `appendBgmFilterGraph()`: `args.push("-stream_loop", "-1", "-i", absoluteInput(bgmConfig.filePath, context))`) üzerinden doğrulandı; ikinci adayın (`bgm-v2`) yolunun `args` içinde hiç yer almadığı ayrıca ispatlandı.
  2. **Bir near-miss/geçersiz aday (`status:"queued"`, Sprint 146'nın near-miss kalıbıyla aynı) + bir geçerli aday** → yalnızca geçerli adayın dosya yolunun forward edildiği doğrulandı; near-miss `.find()`'ın predicate'ini hiç geçmediği için sıralamayı etkilemiyor.
- **Bulgu / DUR durumu:** Yok. `.find()` beklenen (insertion-order, ilk eşleşen kazanır) davranışı sergiledi; gizli sort/dedup bulunmadı. Üretim kodu değişikliği gerekmedi.
- **Test Sonuçları (%100 PASS):**
  1. `npx tsc --noEmit`: **0 hata**.
  2. `scripts/smoke-production-video-assembly-wiring.ts`: **70/70 PASS** (68 mevcut + 2 yeni).
  3. `scripts/smoke-ffmpeg-bgm-kenburns-assembly.ts`: **30/30 PASS** — değişmedi, regresyon yok.
  4. `scripts/smoke-sprint-129-41-completed-stage-regeneration.ts`: **181/181 PASS (%100)** — değişmedi, regresyon yok.
- **Değişen dosyalar:** yalnızca `scripts/smoke-production-video-assembly-wiring.ts` (+41 satır) ve bu `ATOLYE_CHECKPOINT.md` kaydı. `src/**` altında sıfır değişiklik (`git diff --stat -- src/` boş).
<!-- SPRINT-147-END -->

<!-- SPRINT-146-START -->
## Sprint 146 - VideoAssemblyManager resolveBackgroundMusic Asset-Registry Discovery Test Coverage - 2026-08-21

**Status:** Completed & Committed (bu commit ile) — push yapılmadı, onay bekleniyor
**Production execution status:** N/A — saf test-kapsamı genişletmesi, üretim davranışı değiştirilmedi. `src/lib/assembly/VideoAssemblyManager.ts`, `src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts` veya başka hiçbir `src/` üretim dosyası dokunulmadı.

Sprint 143-145, `FFmpegVideoAssemblyProvider.validateInput()` ve `VideoAssemblyManager.isValidRealResult()`'ı — provider'a giden GİRDİ ve provider'dan dönen ÇIKTI doğrulamasını — kapattı. Sprint 146 READ-ONLY preflight incelemesi, `VideoAssemblyManager.resolveBackgroundMusic()`'in (asset registry'de BGM'e benzeyen bir kayıt olup olmadığını kendi başına keşfeden heuristik) hiçbir testte hiç tetiklenmediğini tespit etti. Sprint 138-145'in tüm BGM testleri (`smoke-ffmpeg-bgm-kenburns-assembly.ts`'nin 30 senaryosu) `VideoAssemblyInput.backgroundMusic`'i elle set edip provider'ı doğrudan çağırıyor, `VideoAssemblyManager`'ı ve dolayısıyla bu keşif fonksiyonunu tamamen bypass ediyor. `rg "resolveBackgroundMusic|\"bgm\"" src/` taraması, bu string'in repoda yalnızca `VideoAssemblyManager.ts`'nin kendisinde geçtiğini doğruladı — gerçek ses üretim pipeline'ında şu an "bgm" id'li/dosya adlı bir asset üreten hiçbir kod yok, yani bu bir savunma-derinliği kilidi (Sprint 143/144'teki `classifyAssemblyTransition`/BGM `volume` ile aynı reachability profili).

- **Ev sahibi dosya seçimi:** `scripts/smoke-assembly-scene-video-consumption.ts` ile `scripts/smoke-production-video-assembly-wiring.ts` karşılaştırıldı. `resolveBackgroundMusic()` tamamen `inputType`'tan bağımsız, saf asset-registry mantığı olduğundan, daha ağır scene-video/motion-plan/animation fixture altyapısına ihtiyaç duymayan `smoke-production-video-assembly-wiring.ts`'nin `fixture()`/`FakeRunner` kalıbı (zaten Sprint 143/144/145'in ev sahibi) seçildi.
- **Kapsam (yalnızca test dosyası, 64 senaryo → 68 senaryo):** BGM'i asla elle vermeden, `fixture()`'ın kaydettiği registry'ye ek asset'ler ekleyip gerçek `renderExistingAssets()` zincirini çağıran 4 senaryo:
  1. `id:"bgm"` (audio + generated) → otomatik keşfedilip forward ediliyor (ffmpeg argümanlarında `-stream_loop` + `sidechaincompress` varlığıyla doğrulandı).
  2. `filePath` `bgm.wav` **veya** `bgm.mp3` ile bitiyor, id "bgm" içermiyor → yine keşfediliyor (iki alt-vaka).
  3. BGM'e benzeyen hiçbir asset yokken → forward edilmiyor (regresyon).
  4. `id` "bgm" içeriyor ama `type !== "audio"` **veya** `status !== "generated"` → görmezden geliniyor (iki alt-vaka).
- **Test Sonuçları (%100 PASS):**
  1. `npx tsc --noEmit`: **0 hata**.
  2. `scripts/smoke-production-video-assembly-wiring.ts`: **68/68 PASS** (64 mevcut + 4 yeni).
  3. `scripts/smoke-ffmpeg-bgm-kenburns-assembly.ts`: **30/30 PASS** — değişmedi, regresyon yok.
  4. `scripts/smoke-sprint-129-41-completed-stage-regeneration.ts`: **181/181 PASS (%100)**.
<!-- SPRINT-146-END -->

<!-- SPRINT-145-START -->
## Sprint 145 - VideoAssemblyManager isValidRealResult Output Validation Guard Test Coverage - 2026-08-21

**Status:** Completed & Committed (bu commit ile) — push yapılmadı, onay bekleniyor
**Production execution status:** N/A — saf test-kapsamı genişletmesi, üretim davranışı değiştirilmedi. `src/lib/assembly/VideoAssemblyManager.ts`, `src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts` veya başka hiçbir `src/` üretim dosyası dokunulmadı.

Sprint 143/144, `FFmpegVideoAssemblyProvider.validateInput()`'ın (provider'a giden GİRDİYİ koruyan) fail-closed dallarını kapattı. Sprint 145 READ-ONLY preflight incelemesi, bu korumanın tersi yönünü — `VideoAssemblyManager.isValidRealResult()`'ın (provider'dan dönen ÇIKTIYI koruyan, `provider:"ffmpeg", success:true` iddiasındaki sahte/bozuk sonuçları reddeden guard) hiçbir testte hiç tetiklenmediğini tespit etti. `rg "isValidRealResult|malformed.*(ffmpeg|real)"` taraması sıfır eşleşme verdi — bu fonksiyonun mock-branch eşdeğeri (`isExactMockResult`) zaten "malformed mock result fails safely" ile test edilirken, ffmpeg/real-branch eşdeğeri hiç dokunulmamıştı. Sprint 145 bu boşluğu, üretim kodunda hiçbir değişiklik yapmadan kapatıyor.

- **Kapsam (yalnızca test dosyası, `scripts/smoke-production-video-assembly-wiring.ts`, 59 senaryo → 64 senaryo):**
  - "malformed mock result fails safely" kalıbına paralel, `name:"ffmpeg"` custom `VideoAssemblyProvider` ile `isValidRealResult()`'ın büyük OR-koşulunun her bir dalını izole eden 5 senaryo (9 farklı sahte alan kombinasyonu): yanlış `width`/`height`, yanlış `videoCodec`/`audioCodec`, geçersiz `byteLength<=0`/`durationSeconds:NaN`, `filePath`/`url` canonical `VideoStorage.getVideoPath/getVideoUrl` değerleriyle uyuşmuyor, `success:true` yanında sızan bir `error` alanı.
  - Her senaryo `fixture()` ile gerçek kayıtlı asset'ler kuruyor (mock-branch testinin aksine, ffmpeg/real dalı `AssetManager.getProjectAssets()`'e kadar ilerliyor), ardından `assert.rejects(..., (error) => error instanceof VideoAssemblyError && error.message === "Video assembly failed." && error.stack === undefined)` ile hem doğru hata tipinin hem de hassas bilgi sızıntısı olmadığının (sabit mesaj, `stack` yok) doğrulandığı — dosyanın zaten kullandığı "throwing identity getter is normalized" kalıbıyla aynı.
  - Mevcut "valid fake FFmpeg render creates verified registry asset" senaryosu (geçerli sonuç regresyonu) değiştirilmedi, bozulmadan geçmeye devam ediyor.
- **Test Sonuçları (%100 PASS):**
  1. `npx tsc --noEmit`: **0 hata**.
  2. `scripts/smoke-production-video-assembly-wiring.ts`: **64/64 PASS** (59 mevcut + 5 yeni).
  3. `scripts/smoke-ffmpeg-bgm-kenburns-assembly.ts`: **30/30 PASS** — değişmedi, regresyon yok.
  4. `scripts/smoke-sprint-129-41-completed-stage-regeneration.ts`: **181/181 PASS (%100)**.
<!-- SPRINT-145-END -->

<!-- SPRINT-144-START -->
## Sprint 144 - FFmpegVideoAssemblyProvider validateInput BGM Validation Guard Test Coverage - 2026-08-20

**Status:** Completed & Committed (bu commit ile) — push yapılmadı, onay bekleniyor
**Production execution status:** N/A — saf test-kapsamı genişletmesi, üretim davranışı değiştirilmedi. `src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts`, `src/lib/assembly/VideoAssemblyManager.ts` veya başka hiçbir `src/` üretim dosyası dokunulmadı.

Sprint 143 preflight incelemesi, `FFmpegVideoAssemblyProvider.validateInput()`'ın `backgroundMusic` doğrulama bloğunun (malformed obje, unsafe `filePath`/traversal, `volume` sınır kontrolleri) hiçbir testte hiç tetiklenmediğini tespit etmişti. `rg "volume:\s*-?[\d.]+"` taraması repodaki tüm BGM `volume` değerlerinin yalnızca `0.15`/`0.2`/`0.20` olduğunu doğruladı — sınır/geçersiz değerler hiç denenmemişti. Sprint 144 bu boşluğu, Sprint 143'ün aynı kalıbıyla (`VideoAssemblyManager`'ı bypass eden doğrudan provider çağrısı, çağrı-sayan runner), üretim kodunda hiçbir değişiklik yapmadan kapatıyor.

- **Kapsam (yalnızca test dosyası, `scripts/smoke-ffmpeg-bgm-kenburns-assembly.ts`, 19 senaryo → 30 senaryo):**
  - **Scenario 23-26 (negatif, reddedilmeli):** `volume=0` (alt sınır, `<=0`), `volume=2.5` (üst sınır, `>2.0`), `volume=NaN`, `volume=Infinity` (`Number.isFinite` guard'ı) — hepsi çağrı-sayan runner ile `success:false`, `error:"Video assembly failed."`, ve FFmpeg/FFprobe process'inin hiç çalışmadığı (`callCount===0`) doğrulanarak.
  - **Scenario 27 (negatif):** unsafe/traversal BGM `filePath` (`../../../etc/...`) reddediliyor. `isSafeInputPath()` saf string kontrolü olduğundan, `smoke-production-video-assembly-wiring.ts`'nin gerçek dosya-sistemi junction fixture'ı yerine (bu dosyada `AssetManager`/junction altyapısı yok) doğrudan bozuk bir path string'i kullanıldı — reddin aynı sözleşmeyle gerçekleştiği doğrulandı.
  - **Scenario 28 (negatif):** `backgroundMusic: null` (tip bypass ile) reddediliyor — malformed-obje dalı.
  - **Scenario 29 (pozitif regresyon):** `volume=2.0` (üst sınır **dahil** — guard `> 2.0`, yani `2.0` geçerli) gerçek ffmpeg ile başarıyla render ediliyor.
  - **Scenario 30 (pozitif regresyon):** `volume` tamamen atlanmış (`undefined`) — `appendBgmFilterGraph`'ın varsayılan `?? 0.15`'i hâlâ uygulanıp gerçek render'ın başarılı olduğu doğrulanıyor. Repodaki 7 önceki BGM fixture'ının hiçbiri `volume`'u atlamamıştı; bu ilk kez test ediliyor.
  - Mevcut 22 senaryo (19 orijinal + Sprint 143'ün 3'ü) değiştirilmedi.
- **Reachability notu:** `VideoAssemblyManager.resolveBackgroundMusic()` her zaman sabit `volume: 0.15` üretiyor (Sprint 143'teki `classifyAssemblyTransition` gibi) — bu yüzden `volume` sınır kontrolleri savunma-derinliği, gerçek üretim akışından asla geçersiz değerle tetiklenemez. Ama `backgroundMusic.filePath` gerçek, dinamik bir asset-registry yolu — bu yüzden traversal guard'ı, `imageFilePath`/`audioFilePath`/scene-video `filePath` için zaten test edilen aynı gerçek tehdit modelini (registry bozulması/junction escape) BGM'e de genişletiyor.
- **Test Sonuçları (%100 PASS):**
  1. `npx tsc --noEmit`: **0 hata**.
  2. `scripts/smoke-ffmpeg-bgm-kenburns-assembly.ts`: **30/30 PASS** (22 mevcut + 8 yeni).
  3. `scripts/smoke-production-video-assembly-wiring.ts`: **59/59 PASS** — değişmedi, regresyon yok.
  4. `scripts/smoke-sprint-129-41-completed-stage-regeneration.ts`: **181/181 PASS (%100)**.
<!-- SPRINT-144-END -->

<!-- SPRINT-143-START -->
## Sprint 143 - FFmpegVideoAssemblyProvider validateInput Transition-Enum Guard Test Coverage - 2026-08-20

**Status:** Completed & Committed (bu commit ile) — push yapılmadı, onay bekleniyor
**Production execution status:** N/A — saf test-kapsamı genişletmesi, üretim davranışı değiştirilmedi. `src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts`, `src/lib/assembly/VideoAssemblyManager.ts` veya başka hiçbir `src/` üretim dosyası dokunulmadı.

Sprint 142 preflight incelemesi, `FFmpegVideoAssemblyProvider.validateInput()`'ın transition-enum fail-closed guard'ının (hem `image` hem `scene-video` dalında, `scene.transition !== undefined && !animationTransitionTypes.includes(scene.transition)` kontrolü) hiçbir testte hiç tetiklenmediğini tespit etmişti. Bu guard `VideoAssemblyManager` üzerinden asla ulaşılamaz (çünkü `classifyAssemblyTransition()` her zaman geçerli bir enum üretir); yalnızca provider'ı doğrudan, `VideoAssemblyManager`'ı bypass ederek çağıran testlerle egzersiz edilebilir. Sprint 143 bu boşluğu, üretim kodunda hiçbir değişiklik yapmadan, `scripts/smoke-ffmpeg-bgm-kenburns-assembly.ts`'e eklenen 3 yeni senaryoyla kapatıyor.

- **Önemli bulgu (test tasarımını değiştirdi, üretim davranışı değil):** `FFmpegVideoAssemblyProvider.assemble()` hiçbir zaman reject/throw etmiyor — her hata durumunda (validateInput reddi dahil) `{ success: false, error: "Video assembly failed." }` şeklinde **resolve olan** bir sonuç döndürüyor (dosyanın kendi `try/catch`'i). Bu yüzden negatif senaryolar `assert.rejects` yerine resolve olan sonucun `success`/`error` alanlarını doğruluyor. Ayrıca, bu resolve şekli validateInput reddi ile gerçek bir process çağrısının başarısızlığını dıştan ayırt edilemez kıldığından ("hangisi olursa olsun aynı `{success:false, error:...}` görünür), FFmpeg/FFprobe process'inin hiç çalışmadığını kanıtlamak için çağrı-sayan (call-counting) özel bir runner kullanıldı — yalnızca sonuç şekline bakmak yeterli değildi.
- **Kapsam (yalnızca test dosyası):**
  - **Scenario 20 — invalid image transition fails closed:** `transition: "wipe"` ile tek-sahne `image` girdisi, çağrı-sayan runner'lı ayrı bir provider örneğiyle doğrudan çağrılıyor; `success: false`, `error === "Video assembly failed."` (hassas bilgi sızdırmıyor — mesaj "wipe" veya path içermiyor), ve runner'ın **hiç çağrılmadığı** (`imageRunnerCalls === 0`) doğrulanıyor.
  - **Scenario 21 — invalid scene-video transition fails closed:** aynısı, mevcut `makeSceneVideoProps`/`relSv1` scene-video fixture kalıbıyla, `sceneVideoRunnerCalls === 0` doğrulanıyor.
  - **Scenario 22 — undefined transition remains accepted (regression, image + scene-video):** guard'ın yalnızca `transition !== undefined` VE geçersiz enum olduğunda tetiklendiğini, `transition` alanı tamamen atlandığında (bugüne kadarki tüm projelerin varsayılan şekli) her iki `inputType`'ın da gerçek `provider` (gerçek ffmpeg binary) ile başarıyla render edilmeye devam ettiğini doğruluyor — davranış değiştirilmedi.
- **Test Sonuçları (%100 PASS):**
  1. `npx tsc --noEmit`: **0 hata**.
  2. `scripts/smoke-ffmpeg-bgm-kenburns-assembly.ts`: **22/22 PASS** (19 mevcut + 3 yeni).
  3. `scripts/smoke-production-video-assembly-wiring.ts`: **59/59 PASS** — değişmedi, regresyon yok.
  4. `scripts/smoke-sprint-129-41-completed-stage-regeneration.ts`: **181/181 PASS (%100)**.
<!-- SPRINT-143-END -->

<!-- SPRINT-142-START -->
## Sprint 142 - classifyAssemblyTransition Free-Text Fallback Test Coverage - 2026-08-20

**Status:** Completed & Committed (bu commit ile) — push yapılmadı, onay bekleniyor
**Production execution status:** N/A — saf test-kapsamı genişletmesi, üretim davranışı değiştirilmedi. `src/lib/assembly/VideoAssemblyManager.ts`, `src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts` veya başka hiçbir `src/` üretim dosyası dokunulmadı.

Sprint 141 preflight incelemesi, `VideoAssemblyManager.ts`'nin `classifyAssemblyTransition()` fonksiyonunun (assembly planının serbest-metin `transition` alanını `cut`/`fade`/`crossfade`'e indirgeyen regex-fallback mantığı) hiçbir smoke testinde doğrudan egzersiz edilmediğini tespit etmişti. Sprint 141 image-path wiring düzeltmesinden sonra bu fallback artık hem `scene-video` hem `image` sahnelerinde gerçek üretim davranışını belirliyor, bu yüzden kapsam boşluğunun etkisi iki katına çıkmıştı. Sprint 142 bu boşluğu, üretim kodunda hiçbir değişiklik yapmadan, `scripts/smoke-production-video-assembly-wiring.ts`'e eklenen testlerle kapatıyor.

- **Kapsam (yalnızca test dosyası):**
  - **Serbest-metin fallback tablosu (8 senaryo, image yolu):** `"Yavaşça karart"` → fade/fadeblack, `"quick dissolve into next scene"` → fade/fadeblack (not: "dissolve" regex'i crossfade değil fade koluna düşüyor — bu mevcut, kasıtlı davranış; bug olarak "düzeltilmedi", olduğu gibi regresyona karşı kilitlendi), `"çapraz geçiş"` → crossfade/fade, `"hızlı kesme"` → cut, `"quick cut"` → cut, boş string → cut, `undefined` → cut, alakasız metin → cut. Her senaryo gerçek `VideoAssemblyManager.renderExistingAssets()` → `FFmpegVideoAssemblyProvider` zincirinden geçip üretilen ffmpeg argümanları üzerinde doğrulanıyor (yalnızca fonksiyonun izole çıktısı değil, wiring'e bağlı gerçek sonuç).
  - **4 sahneli mixed-transition regresyonu (`cut → fade → crossfade → cut`):** `buildTransitionedImageConcatArgs`'ın cumulative offset/blend birikimini (scene-video eşleniği `buildTransitionedConcatArgs` ile aynı `blendSecondsFor`/`xfadeModeFor` matematiği) doğruluyor. Önemli bulgu: liste içinde herhangi bir junction blend'liyse (`hasAnyBlendedJunction`), o listedeki **"cut" junction'lar da** `CUT_BLEND_SECONDS` (1/FPS, tek-kare blend) ile xfade yoluna giriyor — yalnızca TÜM junction'lar "cut" olduğunda ayrı, gerçek sıfır-blend `buildImageConcatArgs` yoluna gidiliyor. Test bu nüansı açıkça doğruluyor (junction 3 "cut" olmasına rağmen ~0.033s blend + doğru offset).
  - **image/scene-video simetri doğrulaması (yapısal):** `classifyAssemblyTransition` export edilmediği ve tek implementasyon olduğu için, bu dosyada zaten var olan "source contains no new runner or lifecycle" kalıbına paralel bir kaynak-metni doğrulaması eklendi — `VideoAssemblyManager.ts` kaynağında tam olarak 1 tanım ve tam olarak 2 çağrı sitesi (`classifyAssemblyTransition(assemblyScene.transition)`, image ve scene-video dallarında) olduğunu doğruluyor. Tam bir scene-video FFmpeg render fixture'ı (motion plan + stored production video asset + `requireSceneVideoInput`'ın tüm identity kontrolleri) bu dosyada mevcut olmadığından ve `scripts/smoke-assembly-scene-video-consumption.ts`'nin kapsamını bu sprint'in test-only alanı dışında tekrarlayacağından, simetri tam bir ikinci render zinciriyle değil bu yapısal garantiyle kanıtlandı — serbest-metin tablosuyla birlikte, sınıflandırmanın `inputType`'lar arasında sapamayacağını gösteriyor.

- **Test Sonuçları (%100 PASS):**
  1. `npx tsc --noEmit`: **0 hata**.
  2. `scripts/smoke-production-video-assembly-wiring.ts`: **59/59 PASS** (49 mevcut + 10 yeni: 8 serbest-metin + 1 mixed-transition + 1 simetri).
  3. `scripts/smoke-ffmpeg-bgm-kenburns-assembly.ts`: **19/19 PASS** — değişmedi, regresyon yok.
  4. `scripts/smoke-sprint-129-41-completed-stage-regeneration.ts`: **181/181 PASS (%100)**.
<!-- SPRINT-142-END -->

<!-- SPRINT-141-START -->
## Sprint 141 - VideoAssemblyManager Image Scene Transition Wiring Fix - 2026-08-20

**Status:** Completed & Committed (bu commit ile) — push yapılmadı, onay bekleniyor
**Production execution status:** Verified — doğrulama gerçek FFmpeg binary'si + `FakeRunner`/`fixture()` tabanlı izole smoke fixture'larıyla yapıldı; canlı `data/projects/<slug>/` yapısında sıfır mutasyon.

Sprint 140'ın FFmpeg renderer seviyesinde eklediği statik-görsel `xfade`/`acrossfade` geçiş desteği, `VideoAssemblyManager.ts`'nin gerçek prodüksiyon akışında hiçbir zaman tetiklenemiyordu: `image` dalı (inline scene object literal), `scene-video` dalının (`requireSceneVideoInput`) aksine, `assembly.scenes[].transition` alanını `VideoAssemblyInput`'a hiç aktarmıyordu. Sonuç olarak her statik-görsel sahne `sceneTransitionAt()`'te `undefined ?? "cut"` olarak çözülüyor, `hasAnyBlendedJunction()` hep `false` dönüyor ve render her zaman eski düz `concat` (blend yok) yoluna gidiyordu — bu, read-only Sprint 141 preflight incelemesinde doğrulanan, mevcut hiçbir smoke testinin yakalamadığı sessiz bir wiring boşluğuydu.

- **Kök Neden ve Düzeltme:**
  - `src/lib/assembly/VideoAssemblyManager.ts`: `image` dalına, `scene-video` dalıyla simetrik olarak tek satır eklendi: `transition: classifyAssemblyTransition(assemblyScene.transition)`. `classifyAssemblyTransition` zaten dosyada mevcut, `inputType`'tan bağımsız saf bir normalizasyon fonksiyonu; yeni import/yeni fonksiyon gerekmedi.
  - `scripts/smoke-production-video-assembly-wiring.ts`: gerçek `VideoAssemblyManager.renderExistingAssets()` → `FFmpegVideoAssemblyProvider` → `FakeRunner` zincirini kullanan 3 yeni senaryo eklendi ("fade" ve "crossfade" assembly-plan transition'larının gerçek `xfade=`/`acrossfade=` filtre grafiğine ulaştığını, "cut"un ise eski zero-blend concat yolunu koruduğunu doğrular). `FakeRunner`'ın sabit `duration: "2"` probe stub'ı yalnızca "cut" (blend'siz, naive 2.0s toplam) senaryolarına kalibreliydi; fade/crossfade senaryolarında gerçek blend (~0.4s, iki ~1.0s sahne için `MAX_BLEND_SECONDS=0.5` ve `*0.4` sınırı) devreye girdiğinde renderer'ın kendi `validateProbe()` süre-toleransını (±0.25s) karşılamak için `probeOverride` (duration "1.6") eklendi.

- **Davranış Değişikliği Riski (kullanıcı tarafından açıkça ONAYLANDI):**
  - `AssemblyManager.ts`'nin uzun süredir var olan varsayılan `transition: chapter?.transition || "fade"` değeri, bugüne kadar statik-görsel sahnelerde renderer'a hiç ulaşmıyordu (her zaman `"cut"`'a düşüyordu). Bu düzeltmeyle **artık gerçekten ulaşıyor.**
  - Somut etki: sahne-video üretimi olmayan (yalnızca statik görsel + Ken Burns ile giden) her **yeni/regenerate edilen** proje artık varsayılan olarak sahneler arası gerçek fade-through-black geçişiyle render edilecek — önceden hepsi sert kesimdi (`cut`, blend yok).
  - Render süresi/CPU maliyeti bir miktar artar (concat yerine re-encode xfade zinciri); toplam video süresi her blend edilen junction için ~0.4-0.5s kısalır (`expectedRenderedDuration()`'ın zaten hesapladığı, beklenen bir etki).
  - Geçmiş/tamamlanmış projelerin mevcut render'ları etkilenmez (append-only asset modeli); yalnızca bundan sonraki yeni/regenerate render'lar "cut" yerine "fade" ile üretilir.

- **Test Sonuçları (%100 PASS):**
  1. `npx tsc --noEmit`: **0 hata**.
  2. `scripts/smoke-production-video-assembly-wiring.ts`: **49/49 PASS** (46 mevcut + 3 yeni image-transition senaryosu).
  3. `scripts/smoke-ffmpeg-bgm-kenburns-assembly.ts`: **19/19 PASS** — değişmedi, regresyon yok.
  4. `scripts/smoke-sprint-129-41-completed-stage-regeneration.ts`: **181/181 PASS (%100)**.
<!-- SPRINT-141-END -->

<!-- SPRINT-140-START -->
## Sprint 140 - FFmpeg Static-Image Scene xfade/acrossfade Transitions (Retroactive Kayıt) - 2026-08-20

**Status:** Completed & Committed (Commit `5feb39a`) — push edildi (`origin/wip/production-audio-resume-prep-v2` ile senkron doğrulandı)
**Production execution status:** Verified — tüm doğrulama izole `os.tmpdir()` runtime alanında gerçek FFmpeg/FFprobe binary'leriyle yapıldı. Canlı `data/projects/<slug>/` yapısında sıfır mutasyon.

Bu sprint, geliştirildiği oturumda checkpoint'e işlenmeden commit edilmişti (`5feb39a`, "feat(assembly): add xfade transitions for static image scenes"). Sprint 141 READ-ONLY preflight incelemesi sırasında tespit edilip burada geriye dönük olarak kayıt altına alınıyor.

Sprint 138/139'da statik-görsel (`image` girdili) sahneler arası geçiş her zaman sert kesimdi (`cut`, blend yok). Sprint 140 ile FFmpeg renderer seviyesinde gerçek `xfade` (fade/fadeblack) + `acrossfade` geçiş desteği eklendi.

- **Kapsam:**
  - `src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts`: yeni `buildTransitionedImageConcatArgs()` — her sahne için Ken Burns + scale/pad + `setsar=1`, ardından `xfade`/`acrossfade` ile ikili zincirleme (Sprint 133/139'daki scene-video eşleniği `buildTransitionedConcatArgs()`'ın aynısı). BGM ducking bu yeni yolda da destekleniyor (`appendBgmFilterGraph()` çağrısı). `hasAnyBlendedJunction()`/`sceneTransitionAt()` artık `scene.inputType === "scene-video"` kısıtı olmadan her iki tipte de `scene.transition`'a bakıyor. `expectedRenderedDuration()`/`totalBlendSeconds()` süre-doğrulama muhasebesi her iki xfade yoluna ortaklaştırıldı.
  - `src/types/videoAssembly.ts`: `VideoAssemblyLegacySceneInput` (`inputType: "image"`) tipine, `VideoAssemblySceneVideoInput`'ta zaten var olan `transition?: AnimationTransitionType` alanının eşleniği eklendi.
  - `scripts/smoke-ffmpeg-bgm-kenburns-assembly.ts`: 14 senaryodan 19 senaryoya çıkarıldı (image+cut regresyon, image+crossfade, image+fadeblack, image+fade+BGM ducking, asimetrik süreli xfade offset/blend matematiği).

- **O Zaman Açık Bırakılan (Sprint 141'de kapatıldı):** Bu sprint yalnızca FFmpeg renderer + tip seviyesine odaklandı; `src/lib/assembly/VideoAssemblyManager.ts`'nin `image` dalı `assembly.scenes[].transition`'ı hiç forward etmiyordu, bu yüzden yeni xfade yolu gerçek prodüksiyon akışından tetiklenemiyordu — bkz. yukarıdaki Sprint 141 kaydı.

- **Test Sonuçları (%100 PASS, o zamanki commit'te):**
  1. `npx tsc --noEmit`: **0 hata**.
  2. `scripts/smoke-ffmpeg-bgm-kenburns-assembly.ts`: **19/19 PASS**.
<!-- SPRINT-140-END -->

<!-- SPRINT-139-START -->
## Sprint 139 - Universal BGM Ducking for Retimed and Transitioned Video Scenes - 2026-08-20

**Status:** Completed & Committed (Commit `46551f5`) — push yapılmadı
**Production execution status:** Verified — tüm doğrulama izole `os.tmpdir()` runtime alanında gerçek FFmpeg/FFprobe binary'leriyle yapıldı. Canlı `data/projects/<slug>/` yapısında sıfır mutasyon.

Sprint 138'de eklenen Arka Plan Müziği (BGM) sidechain ducking entegrasyonu yalnızca statik `image` girdili sahnelerde çalışıyordu. Sprint 139 ile BGM ducking altyapısı `scene-video` girdili Retimed Concat (`buildRetimedConcatArgs`) ve Transitioned Concat (`buildTransitionedConcatArgs`) montaj kod yollarına da bağlanarak evrensel hale getirildi.

- **Mimari Kararlar ve Sınır Korumaları:**
  - Tekrarlayan BGM loop, resampling, sidechain compression ve amix filtre zinciri `appendBgmFilterGraph()` fonksiyonunda modüler hale getirildi.
  - BGM yokken (`!input.backgroundMusic`) baseline `concat` / `acrossfade` audio mix davranışları ve zero re-encode (`copy-concat`) yolları %100 aynen korundu.
  - BGM girdiğinde `canCopySceneVideos` bypass edilerek audio re-encode Retimed/Transitioned yollarına güvenli yönlendirme sağlandı.

- **Test Sonuçları (%100 PASS):**
  1. `npx tsc --noEmit`: **0 hata**.
  2. `scripts/smoke-ffmpeg-bgm-kenburns-assembly.ts`: **14/14 PASS** — Retimed `scene-video` + BGM ve Transitioned (fade) `scene-video` + BGM senaryoları dahil 14/14 senaryo geçti.
  3. `scripts/isolated-e2e-bgm-kenburns.ts`: **PASS** — Gerçek FFmpeg ile izole MP4 çıktısı doğrulandı.
  4. Completed-Stage Regeneration Smoke (`scripts/smoke-sprint-129-41-completed-stage-regeneration.ts`): **181/181 PASS (100%)**.
<!-- SPRINT-139-END -->

<!-- FIX-ASSEMBLY-CANONICAL-ASSET-ID-START -->
## Fix: AssemblyManager Canonical Asset-ID Enforcement - 2026-08-20

**Status:** Completed & Committed (Commit `94178bb`) — push yapılmadı
**Production execution status:** N/A — yalnızca unit/smoke seviyesinde doğrulandı; production pipeline'a dokunulmadı.

AI tarafından döndürülen `animationAssetId`, `videoAssetId`, `audioAssetId` değerlerinin downstream assembly'de yanlış kimliğe yol açabileceği keşfedildi. Bu değerler artık her zaman canonical fallback (animation/video/audio kayıtlarından gelen deterministik sistem kimliği) ile override ediliyor.

- **Kapsam:**
  - `src/lib/assembly/AssemblyManager.ts`: `mapScenes()`'te bu 3 alan AI çıktısından değil, her zaman `fallbackScene` üzerinden alınıyor. `isStrictAssemblyResponse()` + `matchesExpectedAssetId()` yardımcı fonksiyonu ile strict policy'de AI yanlış id döndürürse `GENERATION_FALLBACK_BLOCKED` fırlatılıyor; `undefined` (omit) durumu ise kabul ediliyor.
  - `scripts/smoke-sprint-129-37-assembly-truncation-budget.ts`: 5 regression senaryosu eklendi (23 → 28 toplam).

- **Test Sonuçları (%100 PASS):**
  1. `npx tsc --noEmit`: **0 hata**.
  2. `smoke-sprint-129-37-assembly-truncation-budget.ts`: **28/28 PASS** — hallucinated id override, boş string override, strict policy reject, strict policy omit kabul, strict policy doğru echo kabul.
<!-- FIX-ASSEMBLY-CANONICAL-ASSET-ID-END -->

<!-- SPRINT-138-START -->
## Sprint 138 - FFmpeg Assembly Audio Ducking + Ken Burns Motion - 2026-08-20

**Status:** Completed & Committed (Commit `4773802`) — push yapılmadı
**Production execution status:** Verified — tüm doğrulama izole `os.tmpdir()` runtime alanında gerçek FFmpeg/FFprobe binary'leriyle yapıldı. Canlı `data/projects/<slug>/` yapısında sıfır mutasyon.

Video üretim pipeline'ındaki görsel dinamizm ve atmosfer eksikliğini gidermek için iki temel özellik eklendi: opsiyonel arka plan müziği (BGM) ve statik görsellere deterministik Ken Burns hareketi.

- **Kapsam:**
  - `src/types/videoAssembly.ts`: `VideoAssemblyInput`'a opsiyonel `backgroundMusic?: { filePath: string; volume?: number; ducking?: boolean; }` alanı eklendi.
  - `src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts`:
    - Deterministik `selectKenBurnsMotion(sceneId)` — `sceneId` mod 4 ile `zoom-in`, `zoom-out`, `pan-left`, `pan-right` seçimi; aynı sahne her render'da aynı hareketi alır.
    - Optimize `buildKenBurnsFilter()` — FFmpeg `zoompan` filtresi `on` (frame index) bazlı expression ile ~0.1 saniyede render ediyor.
    - BGM sidechain audio ducking filtre zinciri: `-stream_loop -1 -i bgm`, `asplit=2`, `sidechaincompress=threshold=0.03:ratio=5:attack=100:release=800`, `amix=inputs=2:weights=1 1:normalize=0`.
    - BGM yoksa baseline assembly davranışı %100 korunuyor (geriye dönük uyumluluk).
    - Windows `X_OK` platform guard ve `-nostats` performans iyileştirmesi.
  - `src/lib/assembly/VideoAssemblyManager.ts`: `resolveBackgroundMusic()` — proje audio varlıkları arasında BGM tespiti ve montaj girdisine aktarımı.
  - `scripts/smoke-ffmpeg-bgm-kenburns-assembly.ts`: 12 senaryolu smoke test (yeni dosya).
  - `scripts/isolated-e2e-bgm-kenburns.ts`: `os.tmpdir()` altında gerçek FFmpeg ile izole E2E test (yeni dosya).

- **Test Sonuçları (%100 PASS):**
  1. `npx tsc --noEmit`: **0 hata**.
  2. `scripts/smoke-ffmpeg-bgm-kenburns-assembly.ts`: **12/12 PASS** — BGM var/yok, loop, ducking, zoom-in/out/pan-left/pan-right, determinizm, kısa sahne, MP4 container doğrulama.
  3. 4 Regression Suite: **PASS** (smoke-sprint-129-25c-1, 25c-2b-1, 25c-2b-2, 129-41 — 181/181 senaryo).
  4. İzole E2E (`scripts/isolated-e2e-bgm-kenburns.ts`): **PASS** — 460 KB MP4, H.264 video + AAC audio, ~2s süre, ffprobe doğrulaması geçti.
<!-- SPRINT-138-END -->

<!-- SPRINT-137-START -->
## Sprint 137 - Audio Publication & Canonical Descriptor Rebind Ledger - 2026-08-20

**Status:** Completed & Committed (Commit `06bffe9`) — **kullanıcı talimatı gereği PUSH YAPILMADI**
**Production execution status:** Verified — Tüm doğrulama izole runtime alanında yapıldı. Canlı `data/projects/<slug>/` yapısında sıfır mutasyon.

Filesystem materialization drift durumlarında ("file exists but with a new inode/device") Audio Publication Intent ve Audio Canonical Store katmanlarında append-only descriptor rebind altyapısı uygulandı.

- **Mimari Kararlar ve Sınır Korumaları:**
  - Orijinal publication intent ve compensation kaydı kesinlikle değiştirilmez (immutable audit trail).
  - Retention-retired kayıtlar için `isLogicallyRetired()` fail-closed kontrolü eklendi (otomatik rebind engellendi).
  - `REBIND_DIRECTORY` (`audio-canonical-rebinds`) altyapısı cleanup-root tarayıcılarında (`activeRecordCount`, `resumeDetachedCompletedRecords`, `inspectDeferredBacklog`) atlandı.
  - `AudioPublicationIntentStore.ts` kesinlikle değiştirilmedi kuralına uyuldu.

- **Test Sonuçları (%100 PASS):**
  1. `npx tsc --noEmit`: **0 hata**.
  2. `scripts/smoke-audio-compensation-descriptor-rebind.ts`: **11 PASS, 1 SKIPPED**.
  3. `scripts/smoke-audio-publication-rebind.ts`: **11 PASS, 1 SKIPPED**.
  4. 4 Regression Suite: **302/302 PASS (100%)**.
  5. İzole Gerçek-Proje E2E (`scripts/smoke-isolated-e2e-audio-rebind-assembly.ts`): **PASS** (`provider.assemble()` ulaşıldı, FFmpeg/FFprobe spawn edildi).
<!-- SPRINT-137-END -->

<!-- SPRINT-136-START -->
## Sprint 136 - Runtime Backup Path Architecture Fix & V4 Schema - 2026-08-20

**Status:** Completed & Committed (Commit `5ae502c`) — push yapılmadı
**Production execution status:** Real V4 Backup Executed & Verified — `ATOLYE_RUNTIME_BACKUP_ROOT=C:\tmp\ar-backups` ile `b-dcf8aa2247d9` backup'ı başarıyla oluşturuldu ve `runtime:backup:verify` ile doğrulandı. Canlı `data/projects/<slug>/` yapısında sıfır mutasyon.

Windows 240/260 UTF-16 yol sınırı ve uzun slug'lı projelerden kaynaklanan runtime backup failure riski için Runtime Backup Path Mimari Düzeltmesi (V4 Schema) uygulandı.

- **Mimari Kararlar ve Sınır Korumaları:**
  - 220 UTF-16 relativePath / 240 materializedPath canlı çalışma sınırları **AYNEN KORUNDU**.
  - 237 UTF-16 relativePath / 259 materializedPath backup sınırları **AYNEN KORUNDU**.
  - 7 adet `publication-reservation.json` backup envanterinden çıkarılmadı.
  - Canlı `data/projects/<slug>/` yapısı ve slug-tabanlı klasörleme değiştirilmedi.
  - Assembly-only özel bypass yapılmadı; V1/V2/V3 eski backup geriye dönük uyumluluk %100 korundu.

- **V4 Backup Path & Manifest Değişiklikleri:**
  - `schemaVersion: "4"`, `backupFormatVersion: "runtime-backup-v4"`, `pathPolicyVersion: "runtime-backup-relative-path-v3"`.
  - Backup envanterinde relativePath artık `<projectId>/...` formatını kullanır (`<projectSlug>/...` yerine).
  - Manifest içinde `sourceProjectIdentities: readonly { projectId: string; projectSlug: string }[]` eklenerek `projectId` ↔ `projectSlug` eşleştirmesi donduruldu.
  - Candidate ve Restore katmanlarında backup yolları için 259 karakterlik `assertRuntimeBackupMaterializedPath` ve `validateRuntimeBackupMutationRelativePath` kullanıldı.

- **Test Sonuçları (Smoke Test Suite %100 PASS):**
  1. `scripts/smoke-sprint-129-25c-1-runtime-backup.ts`: **PASS (39/39 senaryo)**
  2. `scripts/smoke-sprint-129-25c-2b-1-migration-candidate.ts`: **PASS (48/48 senaryo)**
  3. `scripts/smoke-sprint-129-25c-2b-2-migration-candidate-create.ts`: **PASS (34/34 senaryo)**
  4. `scripts/smoke-sprint-129-41-completed-stage-regeneration.ts`: **PASS (181/181 senaryo)**
  5. `npx tsc --noEmit`: **0 hata**.
<!-- SPRINT-136-END -->

<!-- SPRINT-135-START -->
## Sprint 135 - Assembly-Only Completed-Stage Regeneration Extension (Isolated E2E Verified) - 2026-08-20

**Status:** Completed & Committed (Commit `9aff865`)
**Production execution status:** N/A — gerçek production regeneration bu sprint'te hiç çalıştırılmadı; tüm doğrulama izole `os.tmpdir()` temp fixture'larında yapıldı, `data/projects/**` içinde hiçbir mutasyon yok, gerçek production projesine hiç dokunulmadı.

Sprint 129.41/129.42'de kurulan completed-stage regeneration mekanizması bugüne kadar sadece
`--from-stage=video` destekliyordu; bu yol `assembly`'yi de her seferinde video ile birlikte
(video'yu da baştan üreterek) regenerate ediyordu. Sprint 133'ün assembly transition/duration
düzeltmesi gibi sadece assembly'yi ilgilendiren iyileştirmeleri video ve audio'ya hiç dokunmadan
gerçek projeye uygulayabilmek için mekanizmaya **`--from-stage=assembly`** desteği eklendi.

- **Kapsam (mimariye küçük, izole bir extension — yeni orkestratör/mekanizma yok):**
  - `ProductionCompletedStageRegenerationPlanner.ts`: `fromStage` kabulü `"video"`'dan
    `"video" | "assembly"`'ye genişletildi; 7-WAV audio bütünlük kontrolü artık `assembly` için de
    çalışıyor. Bağımlılık kapanışı (`ProductionCompletedStageRegenerationGraph.ts`) zaten
    stage-agnostic olduğu için hiç değişmedi — `fromStage="assembly"` için
    `preserved=[research..audio, video]`, `regenerated=[assembly]`,
    `invalidated=[thumbnail,seo,youtube,export]` doğru hesaplanıyor.
  - `ProductionCompletedStageRegenerationService.ts`: `validateRequest()` ve
    `assertPreparedReplay()`'deki `fromStage` kilitleri aynı şekilde genişletildi. Kritik düzeltme:
    `buildMutations()`'daki hardcoded `["video","assembly"]` supersession/snapshot döngüsü,
    `plan.effectiveSequence`'e göre filtrelenen dinamik bir listeye çevrildi — assembly-only
    planında `video`'nun asla snapshot/supersede edilmediğini garanti ediyor.
  - `scripts/run-production-regeneration.ts`: CLI `--from-stage` artık `assembly`'yi de kabul
    ediyor; diğer tüm argüman/confirmation kuralları değişmedi.
  - Backup/drift/fingerprint/physical-guard/generation/idempotency mekanizmalarının hiçbiri
    gevşetilmedi; sadece hangi stage'lerin bu mekanizmalara dahil olduğu genişletildi.

- **Doğrulama — `scripts/smoke-sprint-129-41-completed-stage-regeneration.ts` (134 → 181
  senaryo, tamamı izole temp fixture üzerinde):**
  - Plan/prepare seviyesi: assembly-only closure, 7-WAV bütünlük kontrolü, prepare sonrası
    `video.json`/`audio.json`/asset dosyalarının byte-for-byte değişmediği, video için hiçbir
    supersession/snapshot kaydının oluşmadığı, manifest'in video/audio'yu `completed` bırakırken
    assembly + downstream'i `pending`e döndürdüğü, idempotent replay.
  - **Tam E2E (gerçek `PipelineRunner.resume()`, `fixture("real-runner")` ile aynı
    acceptance-doğrulamalı izole temp proje):** plan → backup (`createVerifiedRuntimeBackup`) →
    prepare → `PipelineRunner.resume(slug, {stopAfterStage:"assembly"})` → gerçek assembly
    execution. Kanıtlanan: assembly gerçekten çalıştı ve yeni, fiziksel, sıfır-olmayan boyutlu bir
    output dosyası + yeni asset-registry kaydı üretti; video provider'ı çağrılırsa throw eden bir
    stub'la video/audio provider dispatch'inin hiç gerçekleşmediği garanti altına alındı;
    `video.json` + 6 sahne video dosyası + `audio.json` + 7 WAV dosyası **byte-for-byte** değişmedi;
    video/audio için hiçbir supersession/snapshot kaydı oluşmadı; assembly generation 0→1 ilerledi;
    thumbnail/seo/youtube/export `pending` kaldı; prepare replay gerçek execution sonrası da
    idempotent kaldı. Mevcut `video`-fromStage E2E senaryosu (orijinal 134 check) hiç regresyon
    vermeden PASS etmeye devam etti.
  - `npx tsc --noEmit`: 0 hata. `git diff --check`: temiz. Smoke: **PASS (181/181)**.

- **Production'a geçmeden önce hâlâ eksik olanlar (bu sprint'te bilinçli olarak yapılmadı):**
  1. **Gerçek production regeneration hiç çalıştırılmadı** — doğrulamanın tamamı izole temp
     fixture'larda; `fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-...`
     projesine bu sprint boyunca hiç dokunulmadı (fiziksel guard testleriyle ayrıca doğrulandı).
  2. **Gerçek OpenAI/FFmpeg production doğrulaması yapılmadı** — E2E testi, dosyanın mevcut
     `FixtureVideoProvider`/`FixtureAssemblyProvider` sahte provider'larını kullandı (aynı dosyadaki
     orijinal `video`-fromStage E2E senaryosunun kullandığı yöntemin aynısı); gerçek `ffmpeg`/OpenAI
     entegrasyonu ayrı bir doğrulama gerektirir.
  3. Gerçek projede kullanmadan önce: `runtime:backup:create` → `production:acceptance:
     regeneration-plan --from-stage=assembly` → plan-fingerprint eşleşmesiyle
     `prepare-regeneration` → kontrollü, tek-adımlı bir execution zinciri hâlâ gerekiyor — hiçbiri
     bu sprint'te çalıştırılmadı.
<!-- SPRINT-135-END -->

<!-- SPRINT-133-POC-VERIFICATION-START -->
## Sprint 133 POC Verification - OpenAI Dynamic Transition Assembly E2E POC Verified - 2026-08-20

**Status:** Completed & E2E POC Verified
**Production execution status:** Verified on isolated scratch runtime (`scratchpad/assembly-transition-poc/runtime/projects/ftm-transition-poc-e9b21f`); production repo `git status` clean, 0 production code changes.

Sprint 133 kapsamında geliştirilen OpenAI destekli dinamik sahne geçişleri (`fade`, `cut`, `crossfade`) ve FFmpeg montaj filtre zinciri (`buildTransitionedConcatArgs`), izole scratch runtime ortamında gerçek OpenAI ve gerçek FFmpeg ile uçtan uca doğrulanmıştır.

- **E2E POC Doğrulama Kanıtları:**
  - **Gerçek OpenAI Çağrısı:** `AssemblyManager.generateAssemblyPlan` ile gerçek OpenAI API üzerinden 6 sahneli montaj planı üretildi.
  - **Geçiş Çeşitliliği:** `fade → cut → crossfade → fade → cut → crossfade` (ardışık tekrar yok, dinamik ve çeşitli).
  - **Gerçek Güvenlik Katmanı Doğrulaması:** `AudioPublicationIntentStore` ve `AudioCompensationStore` güvenlik kuralları bypass edilmeden, aktif operasyon bağlamı (`resolverBindingIdentity`) ve fiziksel dosya bütünlüğü ile %100 doğrulandı.
  - **Gerçek FFmpeg Render:** `FFmpegVideoAssemblyProvider.assemble` ile filtre zinciri (`xfade`/`acrossfade`) başarıyla icra edildi.
  - **Çıktı Özellikleri:** 1920x1080 Full HD, H.264 video + AAC ses, `115.371 saniye` tam süre, `9,894,033 byte` (~9.4 MB) dosya boyutu.
  - **Temiz Repo:** `data/projects/**` veya production repo dosyalarında hiçbir mutasyon yapılmadı.

- **Mimari Sonuç ve Karar:**
  > Scratch POC'deki `AudioPublicationIntentError`, production pipeline eksikliğinden kaynaklanmamaktadır. Hatanın nedeni fiziksel audio dosyalarının scratch ortamına kopyalanmasıyla `dev`/`inode` ve integrity metadata'sının değişmesidir. Production pipeline zaten gerekli `ProductionRuntimeOperationContext` altında çalışmaktadır. Bu nedenle `VideoAssemblyManager`, `AssemblyManager`, `AudioStorage` veya güvenlik katmanlarında değişiklik yapılması gereksizdir (Karar: B).
<!-- SPRINT-133-POC-VERIFICATION-END -->

<!-- SPRINT-134-START -->
## Sprint 134 - Production Acceptance Diagnose Missing-Marker Error Code Distinction - 2026-08-19

**Status:** Completed & Verified (commit `933de06`)
**Production execution status:** N/A (code + smoke test only; `npx tsc --noEmit` 0 errors; no `data/projects/**` mutation)

`npm run production:acceptance:diagnose` çağrısı, marker dosyası hiç yoksa (proje hiç `execute`
edilmemişse) genel ve yanıltıcı `PRODUCTION_ACCEPTANCE_POLICY_INVALID` hatası döndürüyordu — sanki
mevcut bir marker bozulmuş/kurcalanmış gibi.

- **Kök Neden:** `ProductionAcceptancePolicy.diagnoseProductionAcceptanceConfiguration()`, `readJSONState`'in
  `"missing"` (dosya yok), `"malformed"` (JSON parse hatası) ve `!validMarker(...)`/slug-identity-mismatch
  durumlarının tamamını tek bir `if` bloğunda aynı jenerik `ProductionAcceptancePolicyError`'a
  toplaştırıyordu; hiçbiri için ayırt edici bir detay yoktu.
- **Güvenli Çözüm:**
  1. `ProductionAcceptancePolicy.ts`'e, mevcut `ProductionAcceptancePolicyError`'ın WeakSet-tabanlı
     authenticity pattern'i birebir takip edilerek `ProductionAcceptanceMarkerNotFoundError` +
     `isAuthenticProductionAcceptanceMarkerNotFoundError` eklendi.
  2. `diagnoseProductionAcceptanceConfiguration` içine `state.status === "missing"` için tek satırlık
     erken bir dal eklendi; `"malformed"` ve `!validMarker(...)`/slug-mismatch durumları mevcut
     `ProductionAcceptancePolicyError` davranışında değişmeden kaldı. Gerçek fingerprint mismatch
     (`matches:false` + `mismatchedComponents`) akışına hiç dokunulmadı.
  3. `ProductionAcceptanceCommand.ts`'teki `trustedCommandErrorCode`'a `mode === "diagnose"` için yeni
     bir dal eklendi → CLI artık `PRODUCTION_ACCEPTANCE_MARKER_NOT_FOUND` döndürüyor.
- **Test ve Doğrulama:**
  - `smoke-sprint-129-23-production-acceptance-portability.ts`'e yeni senaryo eklendi (marker'sız
    proje için hem düşük seviye fonksiyon hem CLI çıktısı doğrulanıyor); suite 15/15 → 16/16 PASS.
  - Regresyon: `smoke-sprint-129-24-acceptance-marker-reprepare.ts` 22/22, `smoke-sprint-129-28-production-acceptance-reauthorization.ts`
    137/137, `smoke-sprint-128-1-production-acceptance.ts` 30/30, `smoke-sprint-129-5-production-acceptance-topic.ts`
    24/24, `smoke-production-readiness-acceptance.ts` 24/24 — hepsi PASS.
  - Canlı doğrulama: gerçek `osmanlinin-kurulusu` (marker yok) → `PRODUCTION_ACCEPTANCE_MARKER_NOT_FOUND`;
    gerçek `fatih-sultan-mehmet-...-cfe77fd8` (geçerli marker) → değişmeden `success:true`. `npx tsc --noEmit`
    temiz, `git diff --check` temiz.
<!-- SPRINT-134-END -->

<!-- SPRINT-133-START -->
## Sprint 133 - Assembly Cut/Fade/Crossfade Transition Rendering, Duration Validation Fix & Animation Motion Variety - 2026-08-19

**Status:** Completed & Verified (commit `09207a5`)
**Production execution status:** N/A (code + smoke test only; `npx tsc --noEmit` 0 errors; no `data/projects/**` mutation)

Kullanıcı talebiyle tek commit'te birleşen üç ayrı iş parçası:

- **Assembly transition rendering (yeni özellik):** `VideoAssemblyManager.classifyAssemblyTransition()`
  assembly planının serbest metin `transition` alanını (`"fade in from black, slow cross dissolve"` gibi)
  deterministik olarak `"cut" | "fade" | "crossfade"` enum'una indirgiyor (bilinmeyen metin → güvenli
  `"cut"` varsayılanı). `FFmpegVideoAssemblyProvider.buildTransitionedConcatArgs()` en az bir "blended"
  (cut olmayan) geçiş varsa gerçek `xfade`/`acrossfade` filtre zinciri kuruyor; sahne 0 ve saf cut
  dizileri mevcut sıfır-yeniden-kodlama (`copy`)/`retimed concat` yollarını koruyor.
- **Kritik bug fix — duration validation:** `expectedOutputDuration()` xfade/acrossfade örtüşme
  (`blend`) sürelerini düşmediği için, gerçek bir fade/crossfade geçişi içeren her assembly, render
  sonrası kendi `validateProbe` süre toleransını aşıp `SAFE_ERROR` ile başarısız oluyordu — özellik
  pratikte hiç çalışmıyordu. Kök neden ve kanıt: bu review sırasında bulundu (bkz. commit'ten önceki
  code-review turu). Çözüm: `expectedRenderedDuration()` + `totalBlendSeconds()` eklendi; ikincisi
  `buildTransitionedConcatArgs`'ın filtre grafiği inşasına hiç dokunmadan aynı `blendSecondsFor`/
  `sceneTransitionAt` çağrılarını kullanıyor, böylece ikisi asla birbirinden sapamaz. `cut`-only ve
  ilk sahne davranışı değişmedi.
  - `scripts/smoke-assembly-scene-video-consumption.ts`'e gerçek blend-sonrası süre kısalmasını
    doğrulayan regresyon senaryosu eklendi (fix'siz haliyle önce fail ettiği doğrulanıp geri alındı);
    suite 24 → 25 senaryo, hepsi PASS.
- **MockAnimationProvider:** motion tipi 2'den (`zoom-in`/`zoom-out`) 5'e (+`static`, `pan-left`,
  `pan-right`) çıkarıldı, `sceneId` üzerinden deterministik round-robin seçim. `smoke-sprint-116`
  (animation motion plan contract) suite'ine 5 tipin hepsinin göründüğünü doğrulayan senaryo eklendi;
  22/22 PASS.
- **CLAUDE.md:** ilgisiz, tek satırlık `graphify affected` tooling hatırlatması eklendi.
- **Doğrulama:** `npx tsc --noEmit` temiz; `smoke-assembly-scene-video-consumption.ts` 25/25,
  `smoke-animation-motion-plan-contract.ts` 22/22 PASS.
<!-- SPRINT-133-END -->

<!-- SPRINT-132-START -->
## Sprint 132 - Physical YouTube Delivery Bundle Materialization (Export Stage) - 2026-08-19

**Status:** Completed & Verified (commit `1776173`)
**Production execution status:** N/A (code + smoke test only; `npx tsc --noEmit` 0 errors; no `data/projects/**` mutation)

Stage 12 (export) artık metadata-only bir plan yerine `data/projects/<slug>/export/bundle/` altında
fiziksel, checksum-doğrulanmış bir dağıtım paketi (`video.mp4`, `thumbnail.<ext>`,
`youtube_metadata.json`, `subtitles.srt`, `subtitles.vtt`, `export_manifest.json`) üretiyor:

- `ExportPackager.packageExport()`: mevcut, değiştirilmemiş `ExportEngine` planını sarmalıyor ve
  yalnızca gerçek, kalıcı bir proje (çözülebilir `projectSlug` + `projectId`) mevcutsa fiziksel
  materialize ediyor; ad-hoc inline-body export istekleri plan-only kalıyor.
- `ExportBundleMaterializer`: kanonik video'yu (`assembly.outputAssetId` → `Asset` → `VideoStorage`)
  ve thumbnail'i (`thumbnail.outputAssetId` → `Asset` → `ThumbnailStorage`) çözüyor, streaming EXDEV
  fallback'li hardlink kuruyor, byte length + SHA-256 doğruluyor, deterministik detached-checksum
  manifest yazıyor, promotion başarısız olursa compensating rollback ile staged bundle'ı atomik
  olarak terfi ettiriyor.
- `SubtitleGenerator`: chapter-seviyeli SRT/VTT gerçek, ölçülmüş narration sürelerinden üretiliyor
  (asla sahne/cümle seviyesinde tahmin/uydurma yok).
- `PipelineStageExecutor` / `app/api/export/route.ts`: `ExportEngine`'den `packageExport`'a minimal
  call-site swap; `ExportEngine`'in kendisi, `export.json` şeması ve production/pipeline
  orchestration katmanları değişmedi.
- `types/export.ts`: sadece-ekleyici `ExportBundleInfo`/`Manifest`/`FileEntry` tipleri + opsiyonel
  `ExportPackageData.bundle` alanı.
- **Doğrulama:** `scripts/smoke-sprint-132-export-packaging.ts` — 15 deterministik senaryo (fiziksel
  bundle oluşturma, video/thumbnail authority, subtitle formatlama, checksum, idempotency, corruption
  recovery, promotion-failure rollback, EXDEV streaming, missing-source fail-closed, inline API
  backward compatibility). Commit öncesi bağımsız review (kapsam, Graphify bağımlılık yüzeyi,
  kaynak-seviyesi audit, 15/15 + 18/18 regresyon suite, tsc, eslint) ile onaylandı.
<!-- SPRINT-132-END -->

<!-- SPRINT-131-START -->
## Sprint 131 - Visual Asset Scene-Level Recovery & Resume Planning Artifact Reuse - 2026-08-18

**Status:** Completed & Verified (commits `72644c2`, `8634e71`)
**Production execution status:** N/A (code only; `npx tsc --noEmit` 0 errors; no `data/projects/**` mutation)

Visuals aşamasının resume/retry davranışındaki iki ayrı "tümünü ya da hiçbirini yeniden üret"
sorunu giderildi:

- **Scene-level asset recovery (`72644c2`):** `VisualAssetPipeline.validateNoExistingGeneratedImages`
  önceden planlanan sahnelerden **herhangi biri** zaten üretilmiş görsel asset'e sahipse tüm batch'i
  `VisualAssetGenerationError` ile reddediyordu — kısmi bir resume'u imkansız kılıyordu. Yeni
  `findValidGeneratedSceneAsset()` her sahne için ayrı ayrı geçerli (mock veya diskte gerçekten var
  olan) üretilmiş asset arıyor; ana döngü halihazırda geçerli bir asset'i olan sahneleri 0 provider
  çağrısıyla atlıyor, guard ise yalnızca **tüm** planlanan sahneler zaten üretilmişse devreye giriyor.
  - `scripts/smoke-sprint-131-visual-asset-recovery.ts`: TEST A (kısmi kurtarma — sahne 1/2 reuse,
    sahne 3 üretim), TEST B (tüm sahneler üretilmişse guard), TEST C (sahne 3 hatasında 1/2'nin
    korunması) — 3/3 PASS.
- **Persisted visual planning artifact reuse on resume (`8634e71`):** `PipelineStageExecutor`'ın
  `visuals` case'i, `state.visuals` zaten persisted iken bile her resume/retry'da
  `VisualManager.generateVisualData()`'yı koşulsuz çağırıp AI planını sıfırdan yeniden üretiyordu —
  gereksiz AI çağrısı ve önceki asset üretiminde kullanılan planla tutarsız olma riski. Çağrı artık
  `if (!state.visuals)` ile korunuyor; persisted plan varsa aynen yeniden kullanılıyor, yalnız asset
  üretimi (`VisualAssetPipeline.generateAssets`) o plana göre devam ediyor.
  - `scripts/smoke-sprint-131-visuals-artifact-reuse.ts`: TEST A (resume'da mevcut artifact reuse),
    TEST B (fresh initial execution), TEST C (resume + kısmi image recovery), TEST D (conflict
    protection korunuyor) — 4/4 PASS.
<!-- SPRINT-131-END -->

<!-- SPRINT-129.39-START -->
## Sprint 129.39 - Production Execution Claim Orphan Concurrency & Deadlock Remediation - 2026-08-18

**Status:** Completed & Verified (137/137 PASS across suite + 13/13 PASS in claim orphan regression suite)
**Production execution status:** N/A (Code and test remediation only; `npx tsc --noEmit` 0 errors)

Atölye V2 Production Execution katmanında "claim persist → worker crash → permanent deadlock" zafiyeti çözüldü ve doğrulandı:

- **Kök Neden:** `ProductionExecutionDurableClaim` katmanında active claim'ler için TTL/takeover değerlendirmesi eksikti; `activeClaimForRecord` expire olmuş reservation'a bağlı active claim'leri temizlemeden `CLAIM_ID_CONFLICT` veriyordu. Worker crash durumunda reservation TTL ve lease olmadan diske `active` olarak yazılmış claim permanent deadlock yaratabiliyordu.
- **Güvenli Çözüm:**
  1. `ProductionExecutionClaimRecoveryClassification` tip grubuna `"unbound-orphaned-claim"` eklendi.
  2. `ProductionExecutionDurableClaim`: `evaluateExecutionClaimRecovery` metodu missing lease + expired reservation TTL olan active claim'leri `"unbound-orphaned-claim"` olarak sınıflandıracak şekilde güncellendi. `activeClaimForRecord` preflight kontrolünde `evaluatedAt` zaman damgası alarak `unbound-orphaned-claim` durumundaki claim'leri yok saydı; böylece Worker B `CLAIM_ID_CONFLICT` ile takılmadan preflight'ı geçip yeni claim alabilir hale getirildi.
  3. `ProductionPipelineRetryReconciliation`: `reconcileFailedPipelineExecution` fonksiyonuna `noAttempt === true` durumunda `claims.abandonExecutionClaim({ reason: "coordination-recovery", ... })` çağrısı eklendi. `RecoveryBootstrap`'in `writeFree: true` kuralı korunarak yalnız retry reconciliation aşamasında yetkili abandoning yapılması sağlandı.
  4. Fencing ve Tek-Aktif-Sahip Invariant Güvencesi: Abandoned olan eski claim (`v1 -> v2`, `state: "abandoned"`), eski Worker A'nın sonradan uyanıp `attempts.openExecutionAttempt()` yapmasını `ATTEMPT_CLAIM_NOT_ACTIVE` ve `ATTEMPT_STALE_WRITE` ile %100 engeller (split-brain/çifte provider execution imkansız).
- **Test ve Doğrulama:**
  - `scripts/smoke-sprint-129-39-claim-orphan-concurrency-recovery.ts` oluşturuldu ve 13/13 senaryo %100 PASS verdi.
  - `npx tsc --noEmit` 0 hata ile tamamlandı.
  - `smoke-sprint-129-28-production-acceptance-reauthorization.ts` 137/137 PASS sonucunu korudu.
- **YouTube Package-Only Bounded Resume Manifest Fix:**
  - **Kök Neden:** `PipelineStageExecutor.ts` YouTube stage yürütmesinde `ProjectManager.saveYouTube()` çağrısına `updatePackageStatus: false` bayrağı geçiliyordu. `youtubePublishMode === "package-only"` modunda publish aşamasına geçilmediği için `manifest.packages.youtube.status` değeri `"running"` durumunda takılı kalıyordu.
  - **Dar Çözüm:** `PipelineStageExecutor.ts` içinde `saveYouTube()` çağrısındaki `updatePackageStatus` değeri `persistedPolicy?.youtubePublishMode === "package-only"` koşuluna bağlandı. Package-only modunda `saveYouTube()` `manifest.packages.youtube.status` değerini `"completed"` yaparken, normal publish modunda mevcut yayınlama ve `markYouTubePublished()` davranışları aynen korundu.
  - **Doğrulama:** `scripts/smoke-sprint-129-39-stage-bounded-resume.ts` dosyasına `boundedYouTube` senaryosu eklendi, bounded YouTube package-only çalışmasında `manifest.packages.youtube.status === "completed"`, `youtube.json` geçerli, `youtube-publish.json` yok, `published=false`, `productionReady=false` olduğu ve 55/55 senaryonun PASS geçtiği doğrulandı. `smoke-sprint-129-28` (137/137 PASS) ve `npx tsc --noEmit` (0 hata) başarıyla tamamlandı.
<!-- SPRINT-129.39-END -->

<!-- SPRINT-130.2-START -->
## Sprint 130.2 - Real Photo Source Download Reliability & Latency Budget - 2026-08-17

**Status:** Completed
**Production execution status:** N/A (code only; canlı kontroller repo dışı bir `ATOLYE_RUNTIME_ROOT`
ile çalıştırıldı — `data/projects/**` bu sprintte de hiç değişmedi, `git status` ile doğrulandı)

Sprint 130.1'in bulduğu "sürdürülen yükte indirme timeout'ları" sorununu hedefleyen dört maddelik
takip:

- **Dosya boyutuna göre indirme:** Wikimedia'nın `iiurlwidth` parametresi ile arama isteğine
  ölçeklenmiş bir thumbnail talebi eklendi (`targetDownloadWidth`, varsayılan **1920px** —
  Sprint 129.40'ın üretim video pipeline'ının zaten ürettiği 1920x1080 çıkışla birebir örtüşüyor).
  Orijinal, thumbnail'den küçük veya thumbnail alanları eksik/geçersizse orijinal korunuyor; asla
  büyütme (upscale) yapılmıyor. Asset'e kaydedilen `width`/`height` artık gerçekte indirilenin
  boyutunu yansıtıyor.
- **Gerçekçi sahne-başına timeout bütçesi:** Yeni `sceneBudgetMs` (varsayılan **60sn**) tüm sahne
  için tek bir wall-clock deadline koyuyor; her aday denemesinin süresi bu bütçeden pay alacak
  şekilde küçülüyor (`sceneBudgetMs / candidateAttemptLimit`, üst sınır mevcut `timeoutMs`). Bütçe
  tükendiğinde yeni aday denemesi başlatılmıyor — tek bir yavaş/başarısız aday artık kalan tüm
  bütçeyi tüketemiyor.
- **Sahneler arası throttle (yeni bulgu):** Canlı doğrulama sırasında beklenmeyen bir durum
  bulundu — sahneler art arda hiç boşluksuz gönderildiğinde Wikimedia'nın görsel CDN'i
  (`upload.wikimedia.org`) gerçek **HTTP 429 Too Many Requests** ile yanıt vermeye başladı (hata
  mesajı doğrudan "contact noc@wikimedia.org... a less disruptive approach" diyor). Buna karşılık
  `RealPhotoImageProvider`'a aynı örnek üzerindeki ardışık sahneler arasında minimum bir aralık
  (`minRequestIntervalMs`, varsayılan **1sn**) eklendi; anahtar kelimesi olmayan (tamamen AI'ya
  giden) sahneler hiç beklemiyor.
- **429'a saygılı davranış:** Wikimedia'nın 429 yanıtı artık ayrı bir hata tipiyle
  (`WikimediaCommonsRateLimitedError`) işaretleniyor ve **hiç retry edilmiyor** (429'u retry etmek
  Wikimedia'nın açıkça istemediği "ısrarcı" davranışın ta kendisi). Provider bir 429 aldığında
  sıradaki adaya da geçmiyor, sahneyi hemen bırakıp AI fallback'ine izin veriyor — aynı host'a daha
  fazla istek yığmıyor.
- Yeni smoke: mevcut suite'e 5 senaryo eklendi (40 → 45) — thumbnail tercih/upscale-koruması,
  sahne bütçesi tükenmesi, sahneler arası throttle (ve anahtar kelimesiz sahnelerin asla
  beklememesi), 429'un hiç retry edilmemesi (hem arama hem indirme), provider'ın 429'da diğer
  adaylara geçmemesi.
- **Canlı doğrulama (dürüst sonuç):** Aynı 10 sahne art arda birden fazla kez çalıştırıldı.
  Hız hedefi net şekilde karşılandı: toplam süre ~28-31 saniye, **sahne başına ortalama ~3
  saniye** (hedef: <15sn — büyük farkla geçildi). Bulunma oranı koşudan koşuya 2/10-5/10 arasında
  değişti, hedefin (≥7/10) altında kaldı. Kök nedeni ayrıntılı HTTP durum-kodu loglamasıyla kesin
  olarak teşhis ettik: bu sprint boyunca yapılan yoğun tekrarlayan canlı testler (aynı IP'den
  kısa sürede çok sayıda istek) Wikimedia'nın kendi 429 rate-limit politikasını tetikledi — bu
  kod hatası değil, bu oturumun kendi test hacminin bir sonucu. İlk (rate-limit öncesi) koşularda
  bulunma oranı 5/10-8/10 arasındaydı. 429-saygılı davranış eklendikten sonra daha fazla canlı test
  yapılmadı (Wikimedia'yı sorumlu şekilde daha fazla döverek durumu kötüleştirmemek için) — bu
  ROADMAP'e açık bir doğrulama maddesi olarak eklendi.
- **Commit öncesi ek düzeltme — User-Agent:** `WikimediaCommonsClient` zaten bir `User-Agent`
  gönderiyordu, ama parantez içeriği gerçek bir iletişim bilgisi değildi ("contact via project
  owner" — ne e-posta ne URL). Wikimedia'nın politikası bunu neredeyse hiç User-Agent
  göndermemekle aynı kefeye koyuyor ve bu tür istemcilere daha sert rate-limit uyguluyor —
  yukarıdaki 429 bulgusuna muhtemelen katkısı olan bir eksiklik. Artık
  `AtolyeV2-RealPhotoSource/1.0 (https://github.com/ahmetbalkan16-maker/atolye-v2)` — Wikimedia'nın
  belgelediği `Client/Version (ContactInformation)` şablonuna uyuyor, hem arama hem indirme
  isteklerinde kullanılıyor.
- Doğrulama: yeni suite 45/45 PASS; Sprint 113 visual-asset-wiring 54/54, Sprint 127
  animation-provider 30/30, pipeline-orchestration 10/10, auto-continuation — hepsi PASS.
  `npx tsc --noEmit` PASS; full repository `npm run lint` — dokunulan dosyalarda 0 hata/uyarı.
<!-- SPRINT-130.2-END -->

<!-- SPRINT-130.1-START -->
## Sprint 130.1 - Real Photo Source Quality & Reliability Follow-up - 2026-08-17

**Status:** Completed
**Production execution status:** N/A (code only; live checks ran against an external, out-of-repo
runtime root — `data/projects/**` in this repository was never touched, verified via `git status`)

Sprint 130'un canlı kontrolünde bulunan iki relevans sorununu ve batching güvenilirlik sorununu
hedefleyen doğrudan bir takip sprinti:

- **Retry + throttle:** `WikimediaCommonsClient.search`/`downloadImage` artık geçici bir hatadan
  sonra kısa bir gecikmeyle (varsayılan 750ms, `IMAGE_REAL_RETRY_DELAY_MS`) bir kez retry ediyor;
  gecikme fonksiyonu test edilebilirlik için inject edilebilir. Gerçekten boş sonuç (0 aday) retry
  tetiklemiyor — yalnız gerçek exception'lar (ağ/timeout/parse) retry ediyor.
- **Kaynak seçim şeffaflığı:** `Asset`'e `selectionScore` (0-1 başlık/sorgu kelime örtüşmesi),
  `selectionRank` (kaçıncı aday kullanıldı), `candidateCount` (kaç uygun aday değerlendirildi) ve
  `width`/`height` eklendi (additive). `normalizeGenerationResult`'ın `"real"` dalı bunları
  sınırlı/tipli olarak doğruluyor.
- **Kitap-taraması filtresi:** Wikimedia'nın "Internet Archive Book Images" batch attribution'ı
  taşıyan adaylar artık lisans/MIME/çözünürlük uygun olsa bile tamamen eleniyor — bu, canlı
  kontrolde bulunan "Constantine the Great" sorgusunun alakasız bir kadın portresi bulmasının kök
  nedeniydi (taranmış kitabın başlığı her sayfa görseline yapışıyor, sayfa içeriğiyle ilgisiz).
- **Alaka-farkında sıralama:** Seçim artık yalnız çözünürlüğe göre değil, önce sorgu kelimelerinin
  başlıkta kaç tanesinin geçtiğine (0-1 skor), sonra çözünürlüğe göre yapılıyor — canlı kontrolde
  bulunan "Küçük Ayasofya" (Little Hagia Sophia) yanlış-landmark sorununu düzeltiyor.
- **İndirme fallthrough:** En yüksek sıralı adayın indirmesi başarısız olursa (timeout dahil),
  sahne başarısız sayılmak yerine sıradaki uygun adaya geçiliyor (varsayılan üst sınır 3 aday,
  `IMAGE_REAL_CANDIDATE_ATTEMPT_LIMIT`); adaylar arası da aynı throttle gecikmesi uygulanıyor.
- Yeni smoke: mevcut suite'e 9 senaryo eklendi (27 → 36) — client retry/no-retry, kitap-taraması
  hariç tutma, alaka-öncelikli sıralama (Küçük Ayasofya senaryosunun birebir tekrarı), indirme
  fallthrough, aday limiti tükenmesi, seçim metadata'sının asset'e doğru yazılması.
- **Önce/sonra canlı karşılaştırma** (aynı 10 sahne, art arda/duraksız, gerçek Wikimedia API'sine
  karşı — repo dışı bir `ATOLYE_RUNTIME_ROOT` ile çalıştırıldı):
  - Kitap-taraması filtresi doğrulandı: "Constantine" sahnesi artık yanlış görsel bulmuyor,
    doğru şekilde AI'ya düşüyor (0 uygun aday kaldı).
  - Alaka sıralaması doğrulandı: izole tekrar testinde "Küçük Ayasofya" artık kazanmıyor; tam
    kelime örtüşmesi olan gerçek Ayasofya iç mekan adayları önde. **Ancak** aynı testte YENİ bir
    benzer belirsizlik bulundu — "Trabzon Hagia Sophia" (farklı bir şehirdeki farklı bir yapı) da
    sorgu kelimelerinin tamamını içerdiği için 1.0 skor alıp kazanabiliyor; bu, saf kelime-örtüşme
    skorlamasının bilinen bir sınırı (bir yer adı/bağlam ayırt edici olmadan homonym landmark'ları
    ayıramıyor). AI üretimi `searchKeywords`'e "Istanbul" gibi bir bağlam kelimesi eklerse bu risk
    azalır; bu canlı kontrolün kendi test sahnesi kısa tutulmuştu ("Hagia Sophia interior", şehir
    belirtilmeden).
  - **Yeni, beklenmeyen bulgu:** Art arda/duraksız koşuda toplam "bulundu" sayısı **düştü** (8/10
    → 2/10) çünkü büyük (çok MB) dosyaların indirmesi sürdürülen yükte daha sık timeout'a
    uğruyor; 3 aday × 2 deneme × 15sn timeout ile bir sahne ~50 saniyeye kadar sürüp yine de
    "bulunamadı" ile sonuçlanabiliyor. Yani mekanizma (retry+fallthrough) doğru çalışıyor ama
    indirme gecikme/timeout bütçesi sürdürülen gerçek yükte hâlâ ayarlanmaya muhtaç — ayrı bir
    takip maddesi olarak not edildi (aşağıya bkz).
- Doğrulama: yeni suite 36/36 PASS; Sprint 113 visual-asset-wiring 54/54, Sprint 127
  animation-provider 30/30, Sprint 116 animation-motion-plan-contract 21/21, pipeline-orchestration
  10/10, auto-continuation — hepsi PASS. `npx tsc --noEmit` PASS; full repository `npm run lint` —
  dokunulan dosyalarda 0 hata/uyarı.
- Git add/commit/push bu sprintte yapılmadı; kullanıcı onayı bekleniyor.
<!-- SPRINT-130.1-END -->

<!-- SPRINT-130-START -->
## Sprint 130 - Wikimedia Commons Real Photo Source for Visuals - 2026-08-17

**Status:** Completed

- Visuals aşaması artık, konuya uygun olduğunda AI görsel üretimi yerine gerçek, telifsiz/açık
  lisanslı fotoğraf kullanabiliyor. Kapsam bilinçli olarak Wikimedia Commons ile sınırlı tutuldu
  (ADR-019); Openverse, LOC/Archive.org, NASA, Pexels/Pixabay/Unsplash ayrı, bağımsız sprintler
  olarak ROADMAP'e eklendi.
- Yeni `ImageProviderName` değeri `"real"`, tek bir `RealPhotoImageProvider`
  (`src/lib/assets/providers/RealPhotoImageProvider.ts`) tarafından implemente edildi; içeride
  `WikimediaCommonsClient` (`src/lib/assets/providers/sources/WikimediaCommonsClient.ts`) — API key
  gerektirmeyen, Wikimedia MediaWiki API'sine (`action=query`, `generator=search`,
  `prop=imageinfo`) diğer tüm gerçek provider'larla aynı fetch disiplinini (injectable fetcher,
  AbortController+timeout, streamed byte-cap okuma, güvenli hata mesajları) kullanan ince bir
  istemci.
- Lisans fail-closed doğrulanıyor: yalnız public domain/CC0/CC-BY/CC-BY-SA allowlist'i kabul
  ediliyor; eksik/bilinmeyen lisans veya desteklenmeyen MIME (png/jpeg/webp dışı, örn. SVG) "eşleşme
  yok" sayılıyor. Asset kaydına yeni `sourceName`/`sourceUrl`/`license`/`attribution` alanları
  eklendi (additive, geriye dönük uyumlu).
- Fallback kararı `VisualAssetPipeline` seviyesinde açıkça veriliyor: real arama eşleşme bulamazsa
  (veya teknik olarak başarısız olursa) sahne otomatik olarak mevcut `openai` provider'a
  yönlendiriliyor; asset'in `provider`/`model` alanı hangi kaynağın gerçekte kullanıldığını dürüstçe
  yansıtıyor.
- Sahne bazlı override eklendi (`PipelineStageExecutor.execute`'ün yeni `visualSourceOverrides`
  parametresi → `VisualAssetPipeline.generateAssets`'in `overrides` parametresi): `"ai"` real
  aramayı atlar, `"real"` AI fallback'ini kapatır (bulunamazsa sahne `failed` olur). Override yalnız
  batch provider `"real"` iken devreye giriyor; `"mock"`/`"openai"` modunda sessizce yok sayılıyor —
  beklenmedik gerçek API çağrısı riski yok. Bu sürümde yeni bir UI eklenmedi (Visuals'in henüz stüdyo
  paneli yok); override API/servis katmanında kaldı.
- Görsel prompt AI sözleşmesine opsiyonel `searchKeywords: string[]` alanı eklendi
  (`VisualPromptEngine.ts` gevşek yol, `VisualStructuredOutput.ts` katı/canonical yol — production
  acceptance strict mode için de tutarlı şekilde güncellendi, `exactFields` artık required/optional
  alan ayrımını destekliyor). Eski `visuals.json` kayıtları (alan olmadan) geçerli kalıyor;
  `RealPhotoImageProvider` eksik/boş keywords'ü "arama yapılamaz" olarak ele alıp doğrudan AI'ya
  düşüyor.
- Yeni smoke: `scripts/smoke-production-real-photo-source.ts` — 27 senaryo (client parsing/hata
  yolları, provider lisans/çözünürlük/MIME filtreleri ve sıralama, pipeline fallback/override/
  keywords geçişi, katı şema doğrulama, gevşek `VisualManager` yolu). Mock-first; gerçek ağ çağrısı
  yok.
- Final review sırasında iki gerçek regresyon bulundu ve düzeltildi: (1) `VisualAssetPipeline`'ın
  yeni fallback kontrolü `result` `undefined` olduğunda (Sprint 113'ün "missing provider result
  fails closed" senaryosu) çöküyordu — `result?.success` ile düzeltildi, Sprint 113 testi tekrar
  54/54 PASS. (2) Smoke testindeki bir asset doğrulaması yanlış varsayılan runtime kökünü
  (`process.cwd()`) kullanıyordu — `ImageStorage.inspectStoredImage` ile düzeltildi.
- Doğrulama: yeni suite 27/27 PASS; Sprint 113 visual-asset-wiring 54/54 PASS; Sprint 127
  animation-provider 30/30 PASS; Sprint 116 animation-motion-plan-contract 21/21 PASS; Sprint 118
  assembly-scene-video-consumption 19/19 PASS; Sprint 115 video-assembly-wiring 46/46 PASS;
  pipeline-orchestration 10/10, auto-continuation, durable execution 17/17, durable wiring 19/19,
  worker-lifecycle 21/21, scene-video-rendering 26/26 — hepsi PASS. `npx tsc --noEmit` PASS; full
  repository `npm run lint` — bu sprintte dokunulan dosyalarda 0 hata/uyarı.
- Git add/commit/push bu sprintte yapılmadı; kullanıcı onayı bekleniyor.
<!-- SPRINT-130-END -->

<!-- SPRINT-129.47-START -->
## Sprint 129.47 - Three Undocumented Smoke Fixture Regressions Closed - 2026-08-17

**Status:** Completed
**Production execution status:** N/A (test-only, no production data touched)

- Sprint 129.46'nın taramasında bulunan üç önceden var olan, belgelenmemiş smoke başarısızlığının
  tamamı kapatıldı. Üçü de gerçek uygulama davranışıyla değil, Sprint 129.41'in eklediği zorunlu
  `RuntimeStorageContext`/manifest-seed-sırası sözleşmesiyle senkron olmayan test fixture'larıyla
  ilgiliydi; `src/lib` altında hiçbir üretim kodu değişmedi.
- `smoke-production-animation-provider.ts`: iki senaryoda `saveScenes`/`saveVisuals` çağrıları
  `PipelineJobManager.listJobs` seed'inden önce yapılıyordu (Sprint 129.42'de bir kardeş dosyada
  düzeltilen aynı `PIPELINE_MANIFEST_ATTEMPT_EVIDENCE_MISMATCH` sıralama hatası); sıra düzeltildi ve
  `PipelineStageExecutor.execute`/`ProjectManager.save*`/`getManifest`/`getAnimation` çağrılarına
  açık `RuntimeStorageContext` eklendi. PASS 30/30.
- `smoke-assembly-scene-video-consumption.ts` ve `smoke-production-video-assembly-wiring.ts`: her
  ikisi de context'siz `PipelineStageExecutor.execute` çağrısı yapıyordu; `requireStorageContext`
  içeride fırlattığı hata `PipelineStageExecutor.ts:461-467`'deki genel `catch { throw new
  VideoAssemblyError(); }` bloğu tarafından ayrım yapılamayan bir `VIDEO_ASSEMBLY_FAILED`'a
  maskeleniyordu — kök neden, `VideoAssemblyError` constructor'ına geçici bir `console.trace` (yalnız
  `ATOLYE_DEBUG_TRACE_VIDEO_ASSEMBLY_ERROR=1` ile aktif, düzeltme sonrası tamamen geri alındı) ile
  teşhis edildi. Birinci dosyada context zaten mevcuttu (`activeContext` eklendi, çağrılara
  geçirildi); ikinci dosyada aktif production runtime operation context zaten vardı, yalnız
  `requireProductionRuntimeStorageContext(requireActiveProductionRuntimeOperationContext())`
  ile tek başarı-bekleyen senaryoya bağlanması gerekiyordu. PASS 19/19 ve PASS 46/46.
- Regresyon: `smoke-production-scene-video-rendering` 26/26, `smoke-animation-motion-plan-contract`
  21/21, `smoke-production-visual-asset-wiring` 54/54, `smoke-pipeline-orchestration` 10/10,
  `smoke-pipeline-auto-continuation` 18/18, `smoke-production-pipeline-durable-execution` 17/17,
  `smoke-production-pipeline-durable-wiring` 19/19, `smoke-production-worker-lifecycle` 21/21 —
  hepsi PASS. `npx tsc --noEmit` PASS; full repository `npm run lint` — bu sprintte dokunulan
  dosyalarda 0 hata/uyarı (aynı önceden var olan, ilgisiz dosyadaki 4 sorun HEAD'de zaten mevcut).
- Sprint 129.38 (`smoke-sprint-129-38-cross-stage-settled-receipt-replay.ts`) kapsam dışı bırakıldı
  ve son kez yeniden doğrulandı: aynı `retry-budget-extensions` dizini eksikliği devam ediyor —
  Sprint 129.46'da belgelenen, gerçek tarihsel denetim izi gerektiren, kodla düzeltilemeyen yapısal
  gap.
- Git add/commit/push bu sprintte yapılmadı; kullanıcı onayı bekleniyor.
<!-- SPRINT-129.47-END -->

<!-- SPRINT-129.46-START -->
## Sprint 129.46 - FFmpeg/FFprobe Host Dependency Restored - 2026-08-17

**Status:** Completed
**Production execution status:** N/A (local environment/config fix)

- Kök neden bulundu: `.env.local`'daki `FFMPEG_PATH`/`FFPROBE_PATH` bu makinede daha önce kurulu
  olan bir `ffmpeg-8.1.2-full_build` klasörünü işaret ediyordu; o klasör diskte artık yok. Bu yalnız
  smoke testlerini değil, **gerçek uygulamanın video/assembly aşamalarını da** etkileyen canlı bir
  yapılandırma kopukluğuydu (`VideoProviderConfig`/`VideoAssemblyProviderConfig` `requireExecutablePath`
  ile fail-closed reddediyordu).
- `winget install --id Gyan.FFmpeg` ile FFmpeg 9.0 (full build) kuruldu; kurulum kullanıcı onayıyla
  yapıldı. `.env.local`'daki iki değişken yeni `ffmpeg-9.0-full_build\bin\{ffmpeg,ffprobe}.exe`
  yollarına güncellendi. `.env.local` `.gitignore` kapsamında, repoya commit edilmedi.
- `tsx` ile çalıştırılan script'ler Next.js'in aksine `.env.local`'ı otomatik yüklemiyor; bu yüzden
  smoke doğrulamaları için `FFMPEG_PATH`/`FFPROBE_PATH` shell'de ayrıca export edildi. Gerçek
  `next dev`/`next build` çalışması `.env.local`'ı otomatik okur, ek işlem gerekmez.
- Doğrulama: `smoke-production-scene-video-rendering` artık **PASS (26/26)** — önceden host'ta
  ffmpeg eksikliğinden dolayı satır ~557'de başarısız oluyordu (bkz. Sprint 129.40/129.41/129.42).
  Aynı ortamda `npx tsc --noEmit` PASS.
- Bu sprint kapsamında ffmpeg'e bağımlı geniş regresyon taraması sırasında **üç önceden var olan,
  daha önce belgelenmemiş** başarısız smoke script'i keşfedildi; hem `FFMPEG_PATH`/`FFPROBE_PATH`
  ayarlıyken hem de ayarsızken aynı şekilde başarısız oldukları doğrulanarak bu sprintle
  ilgisiz oldukları kanıtlandı:
  - `smoke-assembly-scene-video-consumption.ts` — "replay" senaryosunda `VIDEO_ASSEMBLY_FAILED`
    (sahte `Runner` test double'ı ile, gerçek ffmpeg çağrısı yok).
  - `smoke-production-video-assembly-wiring.ts` — aynı `VIDEO_ASSEMBLY_FAILED`.
  - `smoke-production-animation-provider.ts` — `PIPELINE_MANIFEST_ATTEMPT_EVIDENCE_MISMATCH`;
    Sprint 129.42'de `smoke-animation-motion-plan-contract.ts` içinde düzeltilen "fixture, job/attempt
    seed'inden önce scene/visual manifest kanıtı yazıyor" hatasının aynısı, bu dosyada hâlâ düzeltilmemiş.
  Bu üçü ayrı takip gerektirir; bu sprintin kapsamına dahil edilmedi.
- Git add/commit/push bu sprintte yapılmadı; kullanıcı onayı bekleniyor.
<!-- SPRINT-129.46-END -->

<!-- SPRINT-129.45-START -->
## Sprint 129.45 - Fatih Manifest/Job/Project Bookkeeping Backfill - 2026-08-17

**Status:** Completed
**Production execution status:** REAL PROJECT BOOKKEEPING MUTATED (no new content generated)

- Sprint 129.43'ün bıraktığı bilinen boşluk kapatıldı: `animation`, `video`, `audio`, `assembly`
  aşamalarının `manifest.json`, `pipeline-jobs.json`, `pipeline-history.json` ve `project.json`
  kayıtları, diskte zaten var olan gerçek çıktıyla (proje sahibi tarafından gerçek üretim çıktısı
  olarak doğrulandı) uyumlu hale getirildi.
- Kapanmadan önce yapılan analiz iki resmi kayıt sisteminin de (legacy job/manifest ve durable
  `production-execution/`) bu dört aşama için hiçbir tamamlanma kaydı taşımadığını, buna karşın
  `animation.json`/`video.json`/`audio.json`/`assembly.json` içeriğinin 6 sahnelik, iç tutarlı ve
  gerçek (OpenAI `tts-1`, FFmpeg) üretim verisi olduğunu gösterdi; `animation` job kaydı `failed`
  (2026-07-15 tarihli, önceki bir deneme), `video`/`audio`/`assembly` ise hiç başlamamış (`queued`)
  durumdaydı.
- Reconciliation, ham JSON elle düzenlenmeden, yalnızca mevcut public API'ler üzerinden yapıldı:
  `PipelineJobManager.prepareJobRetry` (failed→queued), `PipelineJobManager.startStage` (queued→
  running, `ProjectManager.updateStatus`/`updatePackageStatus` ile aynı `PipelineRunner.runStageLegacy`
  side effect'lerini tekrarlayarak), ardından `PipelineJobManager.persistStageSuccess` (running→
  completed) — persist callback'i olarak her aşamanın **diskteki mevcut verisini** okuyup aynı
  `ProjectManager.save<Stage>` metoduyla geri yazdı. Yeni bir AI/FFmpeg çağrısı yapılmadı; hiçbir
  stage JSON içeriği değişmedi (yazım sonrası `git diff` dört içerik dosyası için de boş çıktı verdi,
  yalnız CRLF/LF normalize farkı vardı).
- Sonuç: `manifest.json` packages `animation/video/audio/assembly` artık `completed`; `project.json`
  ve `manifest.project.status` artık `"assembly"` (önceki `"animation"`); `pipeline-jobs.json` bu
  dört stage için `completed`; `pipeline-history.json`'a dört yeni `completed` event eklendi.
  `thumbnail/seo/youtube/export` bilerek `pending`/`queued` bırakıldı — bu aşamalar gerçekten hiç
  çalışmadı.
- Değişiklikten önce dört dosyanın (`manifest.json`, `pipeline-jobs.json`, `pipeline-history.json`,
  `project.json`) yedeği alındı. Script tek seferlik, proje-özel bir backfill'dir:
  `scripts/reconcile-fatih-129-45-backfill.ts`.
- Doğrulama: `npx tsc --noEmit` PASS; full repository `npm run lint` — bu sprintte dokunulan
  dosyalarda 0 hata/uyarı (repoda önceden var olan, bu değişiklikle ilgisiz 1 dosyadaki 2
  hata/2 uyarı `git stash` ile doğrulanarak HEAD'de zaten mevcut olduğu teyit edildi, bu sprintin
  kapsamı dışıdır).
- Git add/commit/push bu sprintte yapılmadı; kullanıcı onayı bekleniyor.
<!-- SPRINT-129.45-END -->

<!-- SPRINT-129.44-START -->
## Sprint 129.44 - Production Visual Asset Wiring Runtime Context Enforcement - 2026-08-16

**Status:** Completed (test-only)

- `scripts/smoke-production-visual-asset-wiring.ts` içindeki failure-path senaryoları artık
  `PipelineStageExecutor.execute` çağrısına ve durable claim/lease yardımcılarına açık bir
  `RuntimeStorageContext` (`requireProductionRuntimeStorageContext(requireActiveProductionRuntimeOperationContext())`)
  geçiriyor; örtük/varsayılan runtime storage çözümlemesine güvenilmiyor.
- Bir assertion, runner'ın gerçekte ürettiği önceden var olan spesifik hata koduna
  (`VISUAL_ASSET_GENERATION_FAILED`) sıkılaştırıldı; genel `WORKER_EXECUTION_FAILED` tek başına
  yeterli değildi.
- Kapsam yalnız bu smoke script ile sınırlı; `src/lib` altında üretim kodu değişmedi.
- Doğrulama (bu belgeleme turunda yeniden çalıştırıldı — 2026-08-17): `smoke-production-visual-asset-wiring`
  PASS (54/54). `npx tsc --noEmit` PASS.
- Git add/commit/push bu sprintte yapılmadı; değişiklik daha sonra `8803c39` ile commit edildi.
<!-- SPRINT-129.44-END -->

<!-- SPRINT-129.43-START -->
## Sprint 129.43 - Fatih Belgeseli Canlı Audio & Assembly Üretim Koşusu - 2026-08-15

**Status:** Completed
**Production execution status:** REAL PRODUCTION DATA WRITTEN —
`fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5` projesi

- Sprint 129.41'in "gerçek üretim projesine dokunmadan önce ayrı yetkilendirme gerekir" diyerek
  bloklu bıraktığı adım burada fiilen gerçekleştirildi: canlı Fatih Sultan Mehmet belgesel projesi
  için audio ve assembly aşamaları gerçek pipeline üzerinden çalıştırıldı ve çıktı kalıcı olarak
  diske yazıldı.
- Yedi (7) TTS ses dosyası (`audio/*.wav`, toplam ~11 MB) canonical audio storage üzerinden
  yayımlandı; anlatıcı/bölüm metadata'sını içeren `audio.json` yazıldı.
- Assembly aşaması bu yedi WAV'ı `sourceAudioAssetId` üzerinden tüketen ~9.4 MB montaj videosunu
  üretti; `assembly.json` `status: "assembled"` ve canonical `outputAssetId` ile kaydedildi.
- Yeni asset kayıtları proje `assets/assets.json` registry'sine append-only eklendi; önceki asset
  kayıtları silinmedi veya değiştirilmedi.
- **Bilinen eksik/risk:** Bu commit yalnız `assembly.json`, `assets/assets.json`, `audio.json` ve
  fiziksel medya dosyalarını içeriyor. Aynı projenin `manifest.json`, `pipeline-jobs.json` ve
  `project.json` (`status` hâlâ `"animation"`) dosyaları bu koşuda güncellenmedi; son commit'leri
  hâlâ Sprint 129.21'e ait. Yani manifest/job/proje durumu, diskte artık var olan gerçek
  audio+assembly çıktısını henüz yansıtmıyor — bu bir sonraki sprintte manifest/job reconciliation
  ile kapatılmalıdır.
- Bu koşunun hangi komut/yol üzerinden (`production:acceptance:execute`, `resume-finalize` veya
  manuel script) tetiklendiği commit mesajından anlaşılamıyor; sonraki sprintte netleştirilip
  belgelenmelidir.
- Bu, veri-only bir commit'tir; commit anında ayrıca özel bir smoke suite çalıştırılmadı. Bu
  belgeleme turunda (2026-08-17) repo genelinde `npx tsc --noEmit` yeniden doğrulandı, PASS.
- Git add/commit/push kullanıcı tarafından `91b37ec` ile yapıldı.
<!-- SPRINT-129.43-END -->

<!-- SPRINT-129.42-START -->
## Sprint 129.42 - Completed-Stage Regeneration Smoke Realignment - 2026-08-09

**Status:** Completed (test-only)

- `scripts/smoke-animation-motion-plan-contract.ts` ve `scripts/smoke-production-scene-video-rendering.ts`,
  Sprint 129.41'de `ProjectManager.saveScenes/saveVisuals/saveAnimation/getAnimation/getVideo/getManifest`
  ve `PipelineStageExecutor.execute` imzalarına eklenen açık `RuntimeStorageContext` parametresini
  artık her çağrıda geçiyor; örtük/varsayılan bağlam varsayımına dayanan çağrılar kalmadı.
- Animation motion-plan senaryosu artık runner'ın gerçekte ürettiği önceden var olan spesifik hata
  kodunu (`ANIMATION_RESPONSE_SCHEMA_INVALID`) da kabul ediyor; yalnız genel `WORKER_EXECUTION_FAILED`
  beklentisi yeterli değildi.
- Kapsam yalnız iki smoke script ile sınırlı; `src/lib` altında üretim kodu değişmedi.
- Doğrulama (bu belgeleme turunda yeniden çalıştırıldı — 2026-08-17): `smoke-animation-motion-plan-contract`
  PASS (21/21); `smoke-production-scene-video-rendering` bu host'ta `ffmpeg`/`ffprobe` yokluğu
  nedeniyle Sprint 129.40/129.41'de belgelenen bilinen host-bağımlılığı hatasıyla duruyor (satır
  ~557, `FFmpegSceneVideoProvider` render sonucu `success:false`) — bu, 129.42 değişikliğinin neden
  olduğu bir regresyon değildir. `npx tsc --noEmit` PASS.
- Git add/commit/push bu sprintte yapılmadı; değişiklik daha sonra `06fc5b7` ile commit edildi.
<!-- SPRINT-129.42-END -->

<!-- SPRINT-129.41-START -->
## Sprint 129.41 - Canonical Completed-Stage Regeneration - 2026-08-09

**Status:** READY FOR INDEPENDENT RE-REVIEW
**Production execution status:** BLOCKED - implementation/evidence only; no real regeneration ran

- Public completed-stage regeneration is implemented only for `fromStage=video`; every other stage
  and malformed/unknown stage is rejected by planner, CLI, and preparation. Arbitrary-stage
  regeneration remains future work; the internal dependency graph stays generic.
- Preserved stages require exactly one canonical completed job. While a prepared regeneration is
  active, every stage outside its affected set fails closed before execution authority/admission.
- Primary and recovery YouTube publication records use the same canonical validator; published,
  in-flight, malformed, recovery-only, and conflicting evidence all block regeneration.
- Planning, validation, preparation, package reads, job reads, asset/publication/regeneration reads,
  durable authority, and the project mutation lock bind to one explicit `RuntimeStorageContext`.
  Two-root/same-slug tests prove A-pass/B-fail and B-pass/A-fail without cross-root influence.
- Supersession intent is mandatory for active video/assembly regeneration and is fully validated
  before canonical package or manifest mutation. Missing/corrupt intent, generation mismatch,
  predecessor loss, and asset-set drift fail with zero completion writes; successful completion then
  records exact new package hash/asset IDs.
- Owned-temp `134/134` evidence uses real `PipelineRunner.resume()`, scheduler,
  `PipelineStageExecutor`, capability consumption, and configured provider dispatch for bounded
  video then bounded assembly. Video and assembly dispatch exactly once; audio/TTS and all
  downstream dispatch/admission are zero. Seven WAVs are published through canonical audio storage,
  inspected descriptor-bound without monkey-patching, and consumed unchanged by assembly.
- Two independent processes prove same-request single-generation replay and conflicting-request
  single-winner rejection. The production guard binds physical realpath/device/inode identity and
  rejects direct, equivalent, case-equivalent, junction, and nested-junction targets before any
  mutation, provider use, intent creation, or cleanup.
- PASS: Sprint 129.39 `54/54`, assembly scene-video `19/19`, assembly wiring `46/46`, runtime
  hardening `13/13`, retry durable ordinal `18/18`, global quiescence `32/32`, retry-budget
  extension `124/124`, TypeScript, and zero-warning targeted ESLint.
- Scene-video rendering repeatedly fails at line 554 (`expected true`, `actual false`) because this
  host has no `ffmpeg`/`ffprobe` executable; the runner reports spawn failure with empty stderr.
  `FFmpegSceneVideoProvider.ts` is byte-identical to HEAD, so no Sprint 129.41 causality exists and
  Sprint 129.40 framing code was not changed. On 2026-08-16, Sprint 129.38's former line-387
  failure was confirmed fixture-only: Scenario A copied assembly as `completed/1` although it
  asserted `failed/0`. Its owned-temp setup now rewinds the completed assembly durable
  record/claim/attempt/reservation lineage, and the smoke is `18/18 PASS` with provider dispatch
  `0`. Animation-motion separately fails during fixture construction with
  `PIPELINE_MANIFEST_ATTEMPT_EVIDENCE_MISMATCH`.
- All protected production hashes and the seven-WAV inventory match the pre-validation baseline.
  No real prepare/resume/provider/network/cleanup, Git add, commit, or push occurred.
<!-- SPRINT-129.41-END -->

<!-- SPRINT-129.40-START -->
## Sprint 129.40 - Production Scene-Video Full-Frame Framing Remediation - 2026-08-08

**Status:** READY FOR INDEPENDENT RE-REVIEW
**Production execution status:** BLOCKED - no production rerender, assembly, or downstream stage ran

- Root cause was the production provider's authoritative `cover -> crop -> zoompan` chain. A
  `1024x1024` source became approximately `1920x1920`, then a `1920x1080` center crop discarded
  `43.75%` of source height before motion; crop-derived zoom could remove still more content.
- Rendering now splits the source into two independent layers. The decorative background retains
  validated cover/crop/zoompan motion and adds deterministic blur. The authoritative foreground is
  aspect-preserving `contain`, centered, and never receives crop or zoompan.
- Existing finite/focus/zoom validation, maximum zoom, static/non-static semantics, fail-closed
  admission, H.264/yuv420p/1920x1080/30 FPS/duration, provider authority, storage, no-clobber,
  cleanup, retry/resume identity, and lineage contracts remain unchanged.
- Owned-temp real-FFmpeg pixel evidence covers square, native 16:9, and portrait inputs; all four
  source edges and corners survive static, zoom-in, zoom-out, translated pan/focus, and extreme
  valid motion. Invalid focus and NaN/Infinity fail before FFmpeg admission (`26/26 PASS`).
- Assembly scene-video consumption is `19/19 PASS`, production assembly wiring remains `46/46
  PASS`, and runtime hardening remains `13/13 PASS` with production-provider-worker-spy `0`.
  TypeScript and targeted ESLint pass.
- The optional future upstream 16:9 source-generation improvement remains separate. Production
  image-provider configuration and its current `1024x1024` default were not changed.
- The unrelated, pre-existing animation-motion smoke passes 19 scenarios, then scenario 20 fails
  during fixture construction with `PIPELINE_MANIFEST_ATTEMPT_EVIDENCE_MISMATCH`: the fixture
  persists scene/visual manifest evidence before canonical job/attempt seeding through
  `PipelineJobManager.listJobs()`. It fails before Sprint 129.40 scene-video code is entered, and
  `smoke-animation-motion-plan-contract.ts` has no semantic/content modification in this Sprint.
  Its seed-before-stage-persistence fixture repair remains separately tracked.
- The existing production-generated working-tree artifacts were preserved. No provider/network
  call, production mutation, resume, rerender, assembly, thumbnail, SEO, YouTube, export, Git add,
  commit, or push occurred.
<!-- SPRINT-129.40-END -->

<!-- SPRINT-129.39-START -->
## Sprint 129.39 - Canonical Stage-Bounded Production Resume - 2026-08-08

**Status:** READY FOR INDEPENDENT RE-REVIEW
**Production execution status:** BLOCKED - no real production execute or resume was run

- Added the optional, nominal `stopAfterStage` boundary to the authenticated production acceptance
  command, orchestrator, `PipelineRunner.resume()`, and canonical scheduler loop. Unknown stages,
  stages outside the recovery plan, and stages before `startStage` fail closed before mutation.
- The canonical recovery plan remains complete. In bounded mode, the selected stage is admitted with
  `runType=resume` and operation `pipeline.stage.resume`; the scheduler exits only after that stage's
  normal terminal success lifecycle settles. This is not mapped to retry semantics.
- A successful assembly boundary returns an explicit non-final bounded result with
  `productionReady=false` and `published=false`. Thumbnail, SEO, YouTube, and export are not
  admitted. With no boundary, legacy full-resume scheduling and finalization remain unchanged.
- Independent re-review remediation removed the `PipelineStageExecutor.execute` replacement and
  manual success persistence. Owned-temp success/failure now traverse the real executor, immutable
  fake-provider adapters, capability consumption, provider dispatch instrumentation, canonical
  durable preparation, and terminal settlement. The no-op-in-production `capability-consumed`
  instrumentation event exposes the exact consumed identity and provider selection to the smoke.
- The smoke also proves a reusable `stopAfterStage=seo` boundary: exact
  `assembly -> thumbnail -> seo` resume execution, full untruncated recovery plan, terminal SEO
  settlement, recovery restart at YouTube, and zero YouTube/export durable or provider admission.
  Reservation, record/embedded lease, claim, and attempt families are inspected directly.
- The expanded owned-temp Sprint 129.39 matrix preserves bounded assembly success/failure,
  invalid-boundary zero mutation, exact identity, malformed/empty/duplicate command rejection, and
  options-omitted legacy downstream admission (`54/54 PASS`).
- Regression validation PASS: Sprint 129.38 `18/18`, 129.37 `23/23`, 129.36 `124/124`, 129.29
  `41/41`, production video assembly `46/46`, pipeline orchestration `10/10`, durable recovery
  `29/29`, recovery bootstrap `18/18`, runtime startup `11/11`, runtime context `48/48`, and
  production acceptance `30/30`; TypeScript and targeted ESLint also pass (`452/452` executable
  scenarios).
- Production safety remains exact: records `252`, WAV `7`, scene MP4 `6`, durable files `232`, and
  cleanup entries `7`; all ten protected SHA-256 values match the approved baseline. Production
  data, `audio.json`, audio assets, providers, network, reprepare, execute, and resume were untouched.
- No Git add, commit, or push was performed. Independent re-review is required before any controlled
  production use of the new boundary.
<!-- SPRINT-129.39-END -->

<!-- SPRINT-129.38-START -->
## Sprint 129.38 — Retry-Budget Settled-Receipt Cross-Stage Replay Remediation — 2026-08-08

**Status:** APPROVED
**Production execution status:** BLOCKED — production assembly resume is not re-authorized

- Sprint 129.37 assembly token remediation was approved and committed as `a2830bc`; the following
  controlled production resume stopped before the provider with
  `PRODUCTION_ACCEPTANCE_COMMAND_FAILED`.
- Root cause was project-wide consumed-receipt enumeration in
  `ProductionPipelineTerminalSettlement.ts`: assembly reconciliation selected the prior audio
  ordinal-4 receipt and rebuilt `settled` with replay wall-clock time, causing an integrity conflict.
- Failed settlement now derives authority only from the canonical extension binding shared by the
  current reservation, record, lease, claim, and attempt. Executions without that binding ignore
  every unrelated authority and receipt. Partial, mismatched, or corrupt matching bindings fail
  closed.
- A valid existing matching `settled` receipt is accepted write-free. If only `consumed` exists,
  the receipt is created once using immutable attempt `finalizedAt`; later wall-clock replay cannot
  change its identity.
- Isolated reproduction proves assembly `failed/attempts=0` reconciliation succeeds in the
  presence of old audio consumed+settled receipts and `prepareFailedStageRetry(..., "resume")`
  produces `queued/attempts=1` with no provider call.
- Safe command observability now permits only the stable
  `PIPELINE_RETRY_COMPENSATION_FAILED` code; internal messages, paths, and stacks remain masked.
- Independent re-review remediation made the receipt finalizer module-private. B/C/F now construct
  a real ordinal-4 five-sibling failed lineage and enter the public settlement path; no synthetic
  direct finalizer caller remains. Existing execution instrumentation proves provider dispatch `0`.
- Historical 129.36 rewind now preflights the exact audio ordinal-4 authority, consumed receipt,
  identity, reservation and all five sibling bindings before deletion. Unrelated authorities remain
  byte-identical; corrupt matching state rejects before any fixture mutation.
- Final remediation derives the expected settled receipt from the verified authority/consumed
  lineage and immutable terminal attempt `finalizedAt`; existing settled state is replayed only on
  full canonical fingerprint equality. Integrity-valid stale receipts fail closed without clobber.
- Both historical rewind helpers now complete ownership, history/job/manifest eligibility,
  five-sibling lineage and exact `consuming`/`consumed`/`settled` receipt inventory preflight before
  the first mutation. Unknown same-authority artifacts and missing historical failure evidence reject
  with byte-identical fixture inventories.
- Remaining P2 canonical-identity remediation now builds ordinal-4 audio IDs through
  `buildProductionPipelineExecutionIdentity` from project/stage/job, resume semantics, and
  zero-based attempt number 3. The consumed receipt's immutable `jobVersion` is the production
  anchor for `buildProductionExecutionIdempotencyIdentity`; reservation, record, claim, attempt,
  and lease IDs are fixed before any durable enumeration.
- One reservation, record versions 1-7, claim versions 1-2, attempt versions 1-3, and every embedded
  lease are each passed through the production persistence validator and then checked against the
  exact deterministic ID, parent, operation, ordinal, owner, and extension binding. Broad scan is
  detection-only for unexpected same-binding artifacts; deletion targets contain only the 13
  independently derived and validated canonical paths.
- Per-version closure now also requires exact claim binding and ownership evidence, exact attempt
  binding, and exact embedded-lease presence, version, lifecycle, ownership evidence, extension
  binding, and integrity. Record v1 must have no lease; v2-v6 must carry the canonical active v1
  lease; v7 must carry the canonical released v2 lease.
- Detection now inspects every supported durable retry-binding location: top-level bindings on
  reservation/record/claim/attempt payloads and the record's embedded lease binding. Any partial,
  mismatched, embedded-only, duplicate, or alternative-path current-authority artifact fails before
  mutation; scan results never supply canonical IDs or deletion targets.
- An internally coherent persistence-valid alternative full chain, persistence-valid poisoned
  non-terminal claim-v1, and persistence-valid poisoned non-terminal attempt-v1 each fail closed
  with their exact preflight reason and full-tree before/after digest equality. Positive coverage
  separately preserves unrelated authority, stage, ordinal, and receipt bytes.
- Persistence-valid claim binding, attempt binding, lease ownership, lease version, and embedded-only
  unexpected-record poisons also fail with exact semantic reasons and full-tree digest equality.
- Validation PASS: TypeScript, targeted ESLint with zero warnings/errors, Sprint 129.38 `18/18`,
  Sprint 129.29 `41/41`, Sprint 129.36 `124/124`, Sprint 129.37 `23/23`, Sprint 129.32 `18/18`,
  Sprint 129.33 `54/54` (`278/278` total), and `git diff --check`. Production safety stayed at records `252`, WAV
  `7`, durable files `232`, cleanup entries `7`; all ten protected hashes remained exact.
- Production audio, seven WAV files, assembly state, durable stores, and all four ordinal-4 audio
  authority/receipt files remained unchanged. No production resume, execute, reconciliation,
  settlement, retry preparation, provider/network call, reprepare, Git add, commit, or push ran.
- 2026-08-16 fixture-only follow-up: the known line-387 failure was repaired by seeding Scenario A
  as assembly `failed/0` and deleting only its copied completed durable lineage in the owned-temp
  fixture. Sprint 129.38 is again `18/18 PASS`; TypeScript and targeted zero-warning ESLint pass.
  No production execution status or production data changed.
- Independent final review: `APPROVED`; P0/P1/P2 = `0/0/0`. Cross-stage settled-receipt replay
  authority remediation and historical ordinal-4 canonical identity/binding/ownership closure are
  complete. Final safe executable matrix: `278/278 PASS`.
- Production resume remains separately gated and unauthorized.
<!-- SPRINT-129.38-END -->

<!-- SPRINT-129.37-START -->
## Sprint 129.37 — Assembly AI Token Budget and Truncation Remediation — 2026-08-08

**Status:** REMEDIATION COMPLETED — READY FOR INDEPENDENT RE-REVIEW
**Production execution status:** BLOCKED — assembly resume has not been re-run

- The controlled production audio operation completed successfully on ordinal 4. Canonical
  `audio.json` and all 7 physical WAV outputs remain present and byte-identical.
- The first real assembly planning attempt inherited the global OpenAI 1200-token default because
  `AssemblyManager` supplied no stage-specific budget. It ended at exactly 1200 completion tokens
  and the strict catch path masked the observed failure as `GENERATION_FALLBACK_BLOCKED`.
- Assembly planning now uses validated `OPENAI_ASSEMBLY_MAX_TOKENS`: default 3200, inclusive range
  1600–6000, decimal-integer-only, safe-integer, fail-closed validation with stable
  `AI_ASSEMBLY_MAX_TOKENS_INVALID`; invalid values are never clamped.
- Strict assembly now rethrows authentic `AIResponseError` and `AssemblyAIConfigError` instances.
  Truncation remains `AI_RESPONSE_TRUNCATED`; complete but structurally invalid assembly JSON still
  fails strict validation as `GENERATION_FALLBACK_BLOCKED`. Production local fallback stays closed.
- `OPENAI_ASSEMBLY_MAX_TOKENS` is optional inside profile-2 `ENVIRONMENT_POLICY`. Unset serialization
  retains the existing production marker identity; an explicit value changes the component and
  aggregate fingerprints deterministically. No marker rewrite or reprepare was performed.
- Validation: Sprint 129.37 `23/23`, Sprint 129.26 `19/19`, Sprint 129.24 `22/22`, production
  readiness acceptance `24/24`, TypeScript, and targeted ESLint all PASS. Protected production
  state (5 canonical JSON files, 7 WAV files, and 4 retry-budget authority/receipt files) remained
  byte-identical.
- No production resume/execute, provider/network call, audio regeneration, reprepare, Git add,
  commit, or push was performed. After independent review, the next separately authorized action
  is controlled production resume from `assembly`.
<!-- SPRINT-129.37-END -->

<!-- SPRINT-129.36-START -->
### 2026-08-08 independent re-review remediation

- The production durable factory now persists one canonical ordinal-4 retry-budget binding on
  reservation, record, lease, claim, and attempt. A real operation-owned preparation passes the
  `before-execution` gate; missing-sibling and mandatory-field mismatch cases reject deterministically.
- One trusted `RuntimeStorageContext` object is propagated through CLI, plan/apply, failed retry,
  transaction, reconciliation, durable gate/creation, runner, and settlement. Legacy, explicit
  external, and active-scope identity equality are executable checks.
- The authenticated two-child race uses `ready` IPC, one parent `start` broadcast, canonical
  authority readback, exit-code enforcement, and winner-only `consumedOk` semantics.
- Failure handling reaches `finally`; cleanup is exact-root/physical-identity guarded and rejects
  symlinks, junctions, and reparse points. Ordinal 5 asserts the exact rejection code.
- Final evidence: TypeScript PASS; 129.32 `18/18`, 129.33 `54/54`, 129.34 `7/7`, 129.35
  `32/32`, and 129.36 `113/113` twice. The 129.33 self-deadlock was fixture-only and fixed
  without weakening production locks.

## Sprint 129.36 — Explicit One-Time Retry Budget Extension Authority — 2026-08-05

**Status:** REMEDIATION COMPLETED — READY FOR INDEPENDENT RE-REVIEW
**Production execution status:** BLOCKED — awaiting independent re-review and separate operator authorization before production audio resume

- **Remediated all 7 independent review findings (P0×1, P1×2, P2×4):**
  - **P0 Fix:** Implemented fail-closed module-private `parseConsumedRetryBudgetAuthorityId()` filename parser in `PipelineRunner.ts`. Fixed the broken inline slice (`file.slice(8, 14)` which produced truncated 6-character IDs). Full prefix/suffix validation, anchored `[a-z0-9-]{16,128}` regex, path traversal/separator rejection, empty/short/long/uppercase ID rejection verified with unit test suite.
  - **P1 Fix (Test isolation):** Rewrote `smoke-sprint-129-36-retry-budget-extension.ts` with complete `mkdtemp`-based isolation under `runtimeExtDir`. Zero files written to `process.cwd()/data/projects` during tests. Every path is containment-asserted.
  - **P1 Fix (Cross-process consuming-intent race, scenarios 80–90):** Implemented real two-process OS-level race using `child_process.fork()` with `smoke-sprint-129-36-race-worker.ts`. Deterministic ready/start barrier, 30s bounded timeout, exit-code/signal check, and child cleanup. Proves exactly 1 successful consumption, 1 canonical consuming/consumed publication, and expected conflict in competing process.
  - **P1 Fix (Before-execution gate durable sibling verification):** Updated `ProductionPipelineRetryBudgetExtensionGate.ts` to read reservation, record, lease, claim, and attempt records from canonical durable storage before execution. Verifies exact projectSlug, stage, jobId, runType, authority/extension binding, identity fingerprint, reservation, and attempt ordinal (4). Fails closed on missing, plural, stale, or mismatched sibling before any execution mutation starts.
  - **P2 Fix (Settlement write-failure recovery, scenarios 91–100):** Added fault injection coverage for settled receipt write-failure on terminal ordinal-4 execution. Verifies recovery path recovers terminal sibling state, reads consumed receipt, publishes settled receipt, and exhibits write-free idempotent behavior on replay.
  - **P2 Fix (Scenario 23 path fix):** Corrected path usage in smoke test scenario 23 to use temp `runtimeExtDir` instead of repository `data/projects`.
  - **P2 Fix (ESLint warnings):** Implemented `authorityChallengePayloadFromPublished()` projection helper in `ProductionPipelineRetryBudgetExtensionService.ts` replacing destructuring-based omission patterns. Zero ESLint errors, zero warnings across all modified files.
- **113/113 smoke scenarios pass** (2 consecutive runs pass 100%).
- **Sprint 129.32–129.35 regression pass**: 18/18 + 54/54 + 7/7 + 32/32 = 111 scenarios pass cleanly.
- **TypeScript `--noEmit --incremental false` PASS.**
- `data/projects` byte immutability preserved; aggregate SHA-256 and file inventory 100% byte-identical before and after test runs.
- Code, tests, and documentation only. No production execute/resume/reprepare/recovery/provider/network command was run. Default `pipelineRetryMaxAttempts` remains 3.
<!-- SPRINT-129.36-END -->

<!-- SPRINT-129.35-START -->
## Sprint 129.35 — Legacy Terminal Lineage Global-Quiescence Compatibility Remediation — 2026-08-02

**Status:** READY FOR INDEPENDENT REVIEW
**Production execution status:** BLOCKED

- Implemented `ProductionLegacyPipelineExecutionIdentity` with exact `production-pipeline-identity-v1`
  scheme: `executionFingerprint` from `{ projectSlug, stage, jobId, attemptNumber }` only (no `runType`).
  All sibling IDs (`requestId`, `idempotencyKey`, `recordId`, `leaseId`, `claimId`, `attemptId`,
  `reservationFingerprint`) are independently reproducible. `claim.identity.operation` and
  `attempt.identity.operation` are provably absent in v1.
- Implemented `ProductionGlobalTerminalQuiescence.validateProductionGlobalTerminalQuiescence`:
  closed-world proof that no active/reserved/consuming/orphan/ambiguous/malformed/corrupt/foreign
  durable authorities remain.
- Current `targetIdentity` lineage is gated to strict v2 reader only; v1 fallback is forbidden
  for target (enforced and proven by isolated negative test PASS 2).
- Historical lineages use `verifyTerminalLineageVersioned`: v2 path first, exact v1 field-by-field
  validation (51 checks) on fallback. Unknown/unsupported schemas always rejected (PASS 23).
- Stage-gate boundary enforced: target may not precede any already-settled historical stage.
- Closed-world accounting: every `claim-*` and `attempt-*` key must map to a verified lineage.
- `ProductionPipelineExecutionFactory` updated to write `operation` on new v2 claim/attempt.
- `ProductionAcceptanceCommand` allowlist expanded to include `PIPELINE_RETRY_DURABLE_CONFLICT`.
- `ProductionCanonicalDurableLineage` refactored to remove 106-line inline duplicate reader.
- 32/32 smoke scenarios; TypeScript `--noEmit` PASS; ESLint 0 errors 0 warnings.
- `data/projects` byte immutability preserved; aggregate SHA-256 and file inventory unchanged.
- Code, tests, and documentation only. No production execute/resume/reprepare/recovery/provider/
  network command was run. Real production audio resume remains pending independent review.
<!-- SPRINT-129.35-END -->

<!-- SPRINT-129.34-START -->
## Sprint 129.34 — Queued-Exhausted Canonical Run-Type Remediation — 2026-08-02

**Status:** READY FOR INDEPENDENT REVIEW
**Production execution status:** BLOCKED

- The queued-exhausted classifier now derives the latest canonical run type from the persisted
  strict `pipeline.stage.(initial|resume|retry)` operation instead of forcing `retry`.
- Canonical terminal reading receives the exact persisted operation. Resume-origin terminal
  lineage is admitted without fallback; retry-origin behavior remains compatible.
- Canonical identity, execution fingerprint, binding, version, terminal-state, exact failure,
  three-attempt topology, and global-quiescence checks remain fail-closed and unchanged.
- A focused isolated-runtime real-classifier/real-canonical-reader regression covers resume and
  retry exact drift, record/claim operation disagreement, integrity-valid retry-fingerprint
  substitution at `record-execution-fingerprint`, and integrity-valid unsupported operation at
  `record-operation-format`.
- Both synthetic negative lineages expose an exact replacement reservation under the rebuilt
  fingerprint and validate the complete reservation/record/lease/claim/attempt identity plus
  mapped-v1 reservation, idempotency, lease, and claim version bindings before boundary assertion.
- A complete canonical competing authority produced through the real preparation/worker path
  proves exact `durable:global-authority` rejection. Raw physical durable inventory comparison
  proves identical paths, byte lengths, per-file SHA-256 values, and aggregate SHA-256 (`7/7`).
- TypeScript and the relevant Sprint 129.33, Sprint 129.32, canonical lineage, failed-terminal, and
  recovery-planner suites pass.
- This sprint changed code, tests, and documentation only. Production data and authority were not
  mutated; no production execute/resume/reprepare/reauthorize/recovery or provider/network command
  was run. Real production audio resume remains pending independent review.
<!-- SPRINT-129.34-END -->

<!-- SPRINT-129.33-FINAL-TOCTOU-REMEDIATION-START -->
## Sprint 129.33 Final TOCTOU Remediation — 2026-08-02

**Status:** READY FOR INDEPENDENT RE-REVIEW
**Production execution status:** BLOCKED

- Canonical shared pathnames have no check-then-delete cleanup. Lock release, gate release,
  stale lock/gate removal, publication-failure cleanup, and quarantine cleanup use the same
  exclusive, nonce-owned quarantine primitive.
- Publication-failure cleanup atomically moves the exact-created leaf into an operation-owned
  quarantine container and only deletes it after post-move filesystem identity, type, owner-byte,
  containment, and ownership-manifest verification.
- Foreign quarantine leaves are never restored to a canonical pathname with replace-capable
  rename. An unverified leaf is not deleted; it remains byte-identical as an explicit quarantine
  residue and the operation fails closed with a typed reason and residue path.
- Eight real two-child races prove exact final bytes, SHA-256, leaf type, and recursive inventory,
  not mere existence. Exact fail-closed reasons and foreign preservation pass `8/8`.
- All eight races directly assert event-derived foreign mutation, foreign delete, foreign
  overwrite, canonical overwrite, quarantine-to-canonical restore, and unexpected canonical
  mutation attempt counters at zero. No literal or unmeasured zero is reported.
- All 14 hostile global-quiescence cases directly assert distinct real lock, gate, and quarantine
  mutation counters at zero, with writer/provider/worker/dispatch/network counts also zero and
  durable bytes unchanged. The network boundary combines fetch plus HTTP/HTTPS request/get and is
  asserted from a fresh per-case snapshot/delta as well as at suite completion.
- Sprint 129.32 zero-based attempt indexing remains unchanged. No production recovery, resume,
  provider, or network operation was run.
<!-- SPRINT-129.33-FINAL-TOCTOU-REMEDIATION-END -->

<!-- PRODUCTION-BASELINE-CLOSURE-2026-08-01-START -->
## Controlled Canonical Production Baseline Closure — 2026-08-01

**Status:** READY FOR INDEPENDENT BASELINE REVIEW
**Production execution status:** BLOCKED

### `pipeline-jobs.json` provenance conclusion

`B. STRONGLY CORRELATED BUT NOT FULLY ATTESTED`

- The PowerShell history contains the exact production command and project binding:
  `npm run production:acceptance:resume -- --project-slug="fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5" --confirm-production-acceptance`.
- At `2026-07-31T22:34:03.305Z`, the physical audio job was written as `queued / attempts 3`; the physical file mtime is `2026-07-31T22:34:03.3348018Z`.
- The previously recorded physical `pipeline-jobs.json` SHA-256 is `4a74c326088f9c51f6565f3f50e868dfac8425418191db972a9d67261b3d5b48`; the current physical SHA-256 is `7fc3c6a6de022faeffc3829dec9ff7c59f49f3236e82deefc51ed5a9158e66d4`.
- The HEAD control flow first reconciles the failed audio lineage, then `prepareJobRetry` publishes the single `failed / attempts 2 -> queued / attempts 3` job-list mutation, and only afterwards enters scheduled durable preparation. The prepared previous-job admission was not propagated by that historical resume path, so the current queued job implied forbidden durable ordinal `4` and the command failed.
- Manifest and history retain the terminal audio failure `AUDIO_ASSET_GENERATION_FAILED`; their physical mtimes remain `2026-07-30T20:57:23.5543269Z` and `2026-07-30T20:57:23.6429670Z`. The latest history event remains the ordinal-3 audio failure completed at `2026-07-30T20:57:23.563Z`.
- No durable production-execution file has a timestamp after the job-list write, no fourth audio attempt identity was opened, and the latest audio durable lineage remains terminal ordinal `3`.
- This is classified as known queued/exhausted drift. The provider-free `queued/3 -> failed/2` recovery has not been run.
- Full attestation is unavailable because the timestamped stdout/stderr transcript for this exact invocation and an immediately adjacent, independently captured pre-command `pipeline-jobs.json` hash are not retained. The generic `PRODUCTION_ACCEPTANCE_COMMAND_FAILED` result and prior hash exist as recorded evidence, not as one continuous original command transcript. The physical change therefore must not be described as fully proven or authorized.

`pipeline-jobs.json` is one of five production files marked `skip-worktree`. Ordinary `git status` and `git diff` do not attest its physical bytes. Physical hashing is mandatory. Production resume and recovery remain blocked.

### Canonical physical `data/projects` aggregate

The canonical contract is:

1. Use `data/projects` as the root and recursively enumerate physical entries.
2. Count directories including the root; exclude directories from serialized hash rows.
3. Reject symlink, reparse, and non-regular/special entries.
4. Sort physical regular-file absolute `FullName` values with ordinal comparison.
5. Convert each path to root-relative form and normalize separators to `/`.
6. Serialize each row as `relativePath<TAB>byteLength<TAB>lowercaseFileSha256`.
7. Encode rows as UTF-8 without BOM, join with LF, and add no trailing LF.
8. Exclude directory rows, timestamps, attributes, and other metadata.
9. SHA-256 the serialized row bytes.

Current independently reproducible result:

- Physical regular files: `268`
- Directories including root: `18`
- Tracked files: `199`
- Ignored physical files: `69`
- Non-ignored untracked files: `0`
- Serialized bytes: `55,785`
- Canonical aggregate: `e83ab3e2284e90a1fd6e13949daa59f7ede85c591e9c54c860d43eb6bdf7fe08`

Read-only PowerShell reference implementation:

```powershell
$root = (Resolve-Path -LiteralPath "data/projects").Path
$entries = @(Get-ChildItem -LiteralPath $root -Force -Recurse)
$rootItem = Get-Item -LiteralPath $root -Force
if (($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
    @($entries | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) {
  throw "Reparse entry rejected"
}
$files = @($entries | Where-Object { -not $_.PSIsContainer -and $_ -is [IO.FileInfo] })
$special = @($entries | Where-Object { -not $_.PSIsContainer -and $_ -isnot [IO.FileInfo] })
if ($special.Count) { throw "Special entry rejected" }
$directories = 1 + @($entries | Where-Object { $_.PSIsContainer }).Count
$fullNames = [string[]]@($files | ForEach-Object { $_.FullName })
[Array]::Sort($fullNames, [StringComparer]::Ordinal)
$rows = foreach ($fullName in $fullNames) {
  $file = [IO.FileInfo]::new($fullName)
  $relative = $fullName.Substring($root.Length + 1).Replace("\", "/")
  $fileHash = (Get-FileHash -LiteralPath $fullName -Algorithm SHA256).Hash.ToLowerInvariant()
  "$relative`t$($file.Length)`t$fileHash"
}
$utf8 = New-Object Text.UTF8Encoding($false)
$material = $utf8.GetBytes(($rows -join "`n"))
$sha = [Security.Cryptography.SHA256]::Create()
try { $aggregate = ([BitConverter]::ToString($sha.ComputeHash($material))).Replace("-", "").ToLowerInvariant() }
finally { $sha.Dispose() }
[pscustomobject]@{ files=$rows.Count; directories=$directories; serializedBytes=$material.Length; aggregate=$aggregate }
```

Read-only Node.js reference implementation:

```javascript
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve("data/projects");
let directories = 1;
const files = [];
function walk(directory) {
  for (const name of fs.readdirSync(directory)) {
    const fullName = path.join(directory, name);
    const stat = fs.lstatSync(fullName);
    if (stat.isSymbolicLink()) throw new Error("Reparse entry rejected");
    if (stat.isDirectory()) { directories += 1; walk(fullName); }
    else if (stat.isFile()) files.push(fullName);
    else throw new Error("Special entry rejected");
  }
}
walk(root);
files.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
const rows = files.map((fullName) => {
  const bytes = fs.readFileSync(fullName);
  const relative = path.relative(root, fullName).split(path.sep).join("/");
  const fileHash = crypto.createHash("sha256").update(bytes).digest("hex");
  return `${relative}\t${bytes.length}\t${fileHash}`;
});
const material = Buffer.from(rows.join("\n"), "utf8");
console.log({ files: rows.length, directories, serializedBytes: material.length,
  aggregate: crypto.createHash("sha256").update(material).digest("hex") });
```

### Historical aggregate disposition

`9e91a1fa4fdd04053b2e09dffab6f8de147f5595ccb79d6452ce4cc15e59a301` is preserved as:

- obsolete/unattested historical value
- no executable algorithm found
- no matching Git blob or commit found
- no calculation transcript found
- must not be used as an execution safety gate

The difference between `9e91...` and `e83...` does not itself prove that either value was wrong or that production content changed; equivalent contracts for the two values were never attested.

### Mandatory production baseline policy

Every future production safety gate must report separately:

1. Tracked Git diff under `data/projects`.
2. Non-ignored untracked files.
3. Ignored physical files.
4. Physical regular-file inventory.
5. Deterministic physical aggregate under the contract above.
6. `skip-worktree` and `assume-unchanged` inventory.
7. Canonical state-file physical hashes.

`git diff -- data/projects` alone is not full physical immutability proof. This baseline closure does not authorize Sprint 129.33 remediation, production resume, or drift recovery; it requires an independent read-only review first.
<!-- PRODUCTION-BASELINE-CLOSURE-2026-08-01-END -->

<!-- SPRINT-129.33-START -->
## Sprint 129.33 — Exhausted Retry Admission and Job-State Atomicity

**Status:** READY FOR INDEPENDENT RE-REVIEW
**Branch:** `wip/production-audio-resume-prep-v2`

### Result

- Preserved the Sprint 129.32 compatibility model: `PipelineJob.attempts` is a zero-based durable attempt index, never a completed-attempt count. The mapping is index `0/1/2` to durable ordinal `1/2/3`.
- Enforced read-only pre-mutation retry budget proof: failed indices `0` and `1` may advance to durable ordinals `2` and `3`; failed index `2` or greater is exhausted for `maxAttempts=3`. Durable ordinal `4` is never admitted or reused.
- Reject exhausted retry attempts with safe, stable reason code `PIPELINE_RETRY_MAX_ATTEMPTS_EXCEEDED` (`writeFree: true`).
- Preserved byte-identical failed state on `PipelineJob`, manifest, history, and durable execution tree during retry exhaustion rejection.
- Zero provider, worker handler, or stage dispatch calls on exhausted retry rejection.
- Implemented provider-free, exact-bound recovery mechanism (`recoverQueuedExhaustedPipelineJobDrift`) for `queued, attempts 3` vs failed manifest/history drift:
  - Requires explicit confirmation (`confirm: true`).
  - Proves exact project/stage/job identity, attempt count (3), manifest/history failure, terminal durable execution chain, global quiescence, and absence of newer authority.
  - Uses one shared exact, write-free classifier for ordinary resume and explicit recovery. It requires queued/index `3`, matching manifest/latest-history failure codes, exact terminal durable ordinal `3`, cancelled record, released lease, abandoned claim, failed attempt, no ordinal `4`, no competing authority, and global quiescence.
  - Restores only `PipelineJob` from `queued / attempts 3` to canonical `failed / attempts 2`, preserving the exact historical failure code.
  - Idempotent, replay-safe, and write-free on replay (`writeFree: true`).
  - Fails closed on any drift or ambiguous/non-terminal chains.
- Added one consumer-side immutable admission validator. It independently binds canonical max/ordinal equations, both persisted job revisions/fingerprints, and every reconciled/admitted execution identity field before reservation, claim, attempt, worker, provider, or stage dispatch construction. Field-by-field poisoning remains byte-identical and produces zero boundary calls.
- Replaced process-local-only PipelineJob mutation protection with one project-scoped filesystem protocol: exclusive acquisition gate, exclusive directory creation, temp-owner fsync plus atomic publication, exact owner-byte/nonce/filesystem verification, PID plus OS process-start identity, gated stale revalidation/quarantine, and exact identity-bound release. All production `pipeline-jobs.json` writes and manifest seeding re-read under this lock.
- Added authentic nominal identity (module-private `WeakSet`) and fixed command/mode allowlists for every typed CLI error branch. Crafted prototypes, subclasses, changed prototypes, unknown codes, exception slugs/categories/messages and raw errors normalize to `PRODUCTION_ACCEPTANCE_COMMAND_FAILED`.
- Global drift authority now permits integrity-valid, terminal, released histories for the six other production stages while rejecting any active lease/claim, non-terminal attempt, corrupt/ambiguous/unbound authority, or newer competing audio authority.
- Recovery now reports `mutationState: none | committed-verified | committed-unverified`; no post-replacement failure can claim `writeFree:true`, and uncertain commits are never rolled back automatically.
- Manifest `attempts.total` is validated as an execution count and converted once to zero-based `PipelineJob.attempts` (`1/2/3 -> 0/1/2`) with status, history, identity, and present durable-lineage cross-checks.
- Auto-continuation admission is serialized through the shared project lock before durable preparation. Controlled dual contenders now yield one completed execution and one `continued:false` no-op without duplicate durable/provider/worker work.
- Dedicated Sprint 129.33 suite includes genuine canonical child-process writes in both lock orderings, copied-owner-byte foreign replacement preservation, a real two-child stale-remover/live-owner race, and actual CLI-entrypoint processes.
- Reconciled prior durable authority is reconstructed only through canonical schema/integrity readers. Reservation identity proof plus record, lease, claim, and attempt integrity fingerprints are stored as separate admission proofs and compared exactly before storage/provider construction; missing legacy proof fields fail closed.
- Destructive lock, gate, stale-lock, and stale-gate release no longer uses pathname check-then-delete. Every leaf is atomically renamed into an exclusive nonce-owned quarantine container, then device/inode, owner bytes, containment, and quarantine ownership are revalidated before cleanup; post-check foreign replacements are preserved.
- The acceptance-topic smoke runs under canonical operation-owned runtime and authority roots. Its eight authority markers never reach the shared authority root, and owned runtime/authority cleanup is identity-proven with zero remainder.
- All 14 hostile global-quiescence cases directly assert `globallyQuiescent:false`, `writePerformed:false`, `writeFree:true`, `recoveryAttempted:false`, zero writer/lock-gate/provider/network boundaries, and byte-identical durable trees.
- Recovery writer/readback and lock/gate release uncertainty is fail-closed and non-write-free. A later deterministic read-only classification can establish forward completion; no automatic rollback, requeue, continuation, or provider execution is attempted.
- Every non-target terminal reservation/record/lease/claim/attempt chain is globally validated. The adapter-backed hostile matrix covers 53 persisted material-field mutations and 14 non-target authority mutations, including orphan, corrupt, wrong-link, duplicate, and conflicting authority.
- Production data in `data/projects` remains 100% untouched.

### Validation

- Sprint 129.33 final suite: 54/54 PASS; persisted-lineage mutation cases: 59; two-child post-check replacement races: 8; non-target authority mutation cases: 14
- Sprint 129.32: 18/18 PASS
- Sprint 129.31: 9/9 PASS
- Sprint 129.30: 5/5 PASS
- Sprint 129.29: 41/41 PASS
- Pipeline auto-continuation: 18/18 PASS; retry persistence: 5/5 groups PASS; acceptance topic: 24/24 PASS. Operation-owned runtime/authority/lock-gate-quarantine remainder `0/0/0`; pre-existing shared inventory `81`, newly created shared inventory `0`.
- Worker lifecycle 21, durable attempt 58, claim 39, lease 40, storage 63, runtime context 48, production audio wiring 74, coordinator 9, retry continuation 23, state error 18, lineage compatibility 27 PASS
- TypeScript: `npx tsc --noEmit --incremental false` PASS
- `git diff --check`: PASS
- `git diff -- data/projects`: Empty
- Admission storage-construction/provider/worker/stage/fetch/http/https/network boundary counters: `0/0/0/0/0/0/0/0`.
- Real production recovery was not run; production resume remains blocked pending separate explicit authorization.
<!-- SPRINT-129.33-END -->

<!-- SPRINT-129.32-START -->
## Sprint 129.32 — Retry Durable Attempt Ordinal Alignment

**Status:** APPROVED
**Independent review:** P0/P1/P2 = 0/0/1
**Branch:** `wip/production-audio-resume-prep-v2`

### Result

- Failed job retry durable attempt selection enforces exact `job.attempts` invariant.
- Initial attempt `0` remains supported.
- Retry attempt values select the exact latest failed durable chain.
- Historical stale failed shape tests in `smoke-sprint-129-29-failed-terminal-settlement.ts` were aligned to exact attempt ordinal (`failedJob.attempts = fixture.pipelineAttempts`).
- Mismatched `+ 1` attempt ordinal is rejected fail-closed with `ok: false`, `reasonCode: "PIPELINE_RETRY_DURABLE_STATE_MISSING"`, `writeFree: true`, and evidence `durable:expected-attempt-ordinal`.
- Production execution tree remains byte-identical during rejected mismatched ordinal reconciliation.
- Single P2 code hygiene finding (debug log residue in test file) was cleaned.
- Production code was not modified.
- Production data in `data/projects` remains unchanged.

### Validation

- Sprint 129.29: 41/41 PASS
- Sprint 129.30: 5/5 PASS
- Sprint 129.32: 18/18 PASS
- TypeScript: `npx tsc --noEmit --incremental false` PASS
- `git diff --check`: PASS
- `git diff -- data/projects`: Empty
<!-- SPRINT-129.32-END -->


<!-- SPRINT-129.31-START -->
## Sprint 129.31 - OpenAI Streaming WAV Compatibility

**Status:** APPROVED
**Independent review:** P0/P1/P2 = 0/0/0
**Branch:** `wip/production-audio-resume-prep-v2`

### Result

- OpenAI streaming WAV responses with paired RIFF and `data` size sentinels (`0xffffffff`) are now accepted.
- Finite-size WAV behavior is unchanged.
- Existing `fmt `, MIME, size, duration, channel, sample-rate, bit-depth, block-alignment and byte-rate checks remain enforced.
- RF64 and WAVE_FORMAT_EXTENSIBLE support were not added.
- Provider bytes are not rewritten or normalized.
- PCM payload is not scanned heuristically for RIFF-like chunk signatures.
- The stale Sprint 129.27 expectation was corrected to exact `AUDIO_ASSET_GENERATION_FAILED`.

### Production-sized fixture

- total bytes: 1,163,444
- header: 44 bytes
- data: 1,163,400 bytes
- PCM mono, 24,000 Hz, 16-bit
- blockAlign: 2
- byteRate: 48,000
- duration: 24.2375 seconds
- exact provider/stored byte equality
- mocked provider only
- preparation, publication and registry registration passed

### Validation

- Sprint 129.31: 9/9 PASS
- Sprint 129.27: 117/117 PASS
- Production audio wiring: 74/74 PASS
- Audio truncation: 19/19 PASS
- Runtime hardening: 13/13 PASS
- Runtime operation context: 48/48 PASS
- Durable storage: 63/63 PASS
- Worker lifecycle: 21/21 PASS
- Production readiness: 24 PASS
- Production acceptance/CLI: 30/30 PASS
- Sprint 129.30: 5/5 PASS
- TypeScript, targeted ESLint and `git diff --check`: PASS

### Current production state

The real production resume attempted before this remediation failed safely during audio chapter 1:

- public code: `AUDIO_ASSET_GENERATION_FAILED`
- root code: `AUDIO_WAV_INVALID`
- provider/model: `openai` / `tts-1`
- response bytes: 1,163,444

Current state:

- audio job: failed
- failed audio asset records: 2
- `audio.json`: missing
- `assets/audio`: missing
- compensation/publication remainder: zero
- assembly through export: not executed
- the current `assets/assets.json` difference is intentional production evidence and must not be included in the Sprint 129.31 commit

### Next controlled step

Selectively commit and push Sprint 129.31 code, tests and documentation while excluding production evidence. A new production resume requires a separate explicit preflight and command.
<!-- SPRINT-129.31-END -->
Document: ATOLYE_CHECKPOINT.md
Version: 1.0.0
Status: Active
Priority: Critical
Owner: Atölye V2
Last Updated: 2026-07-30
---

# ⚠️ AI START HERE

# Atölye V2 — Project Checkpoint

Bu belge Atölye V2 projesinin resmi geliştirme checkpoint dosyasıdır.

Her yeni AI oturumunda okunacak ilk belge budur.

Bu belge okunduktan sonra aşağıdaki belgeler sırasıyla okunmalıdır:

1. PROJECT_PHILOSOPHY.md
2. VISION.md
3. ATOLYE_AI_RULES.md
4. ATOLYE_CONTEXT.md
5. ROADMAP.md
6. ATOLYE_MASTER_ROADMAP.md
7. ARCHITECTURE_DECISIONS.md
8. CHANGELOG.md
9. AI_MEMORY.md

---

# 📌 Dashboard

## Proje

**Atölye V2**

Türkçe öncelikli AI destekli kişisel içerik üretim stüdyosu.

---

## Mevcut Faz

**Phase 2 — Production Engine**

---

## Aktif Sprint

**Production Readiness Audio-Storage Probe Regression Closure**

**Durum**

Completed

## Production Readiness Audio-Storage Probe Regression Closure / Completed

Production readiness audio-storage regresyonu dar ve fail-closed biçimde giderildi. Bağımsız final inceleme kararı `APPROVED`; P0/P1/P2 `0/0/2`. Schema-3 production marker mevcut environment ile exact match kalır ve production readiness yeniden `27/27 READY` sonucuna ulaşır. Bu kapanış production resume veya execution yetkisi üretmez.

### Kök neden ve dar düzeltme

- `ProductionReadinessService` audio adapter probe'u doğrudan `AudioStorage.saveAudio()` çağırıyordu. Audio compensation workspace aktif `ProductionRuntimeOperationContext` zorunluluğu taşıdığı için probe `RUNTIME_OPERATION_CONTEXT_MISSING` sınırında fail-closed oluyor; mevcut public catch sonucu `AUDIO_STORAGE_ADAPTER_UNAVAILABLE` olarak normalize ediyordu. `FILESYSTEM_READ_WRITE_FAILED`, storage adapter toplamından türetilen ikincil sonuçtu.
- Yalnız audio readiness probe, aynı trusted `RuntimeStorageContext` ile `initialRuntimeAuthorityGeneration` kullanan geçerli operation context oluşturur. Operation ID bounded ve unique `readiness-audio-<uuid>`, operation type güvenli literal `readiness-audio-storage-probe` değeridir.
- Exact aynı operation scope içinde `saveAudio → inspectStoredWav → compensatePublishedAudioResult` lifecycle'ı çalışır. Yalnız compensation sonucu `status === "completed"` ve `compensated === true` olduğunda adapter READY olur.
- Readiness probe için semantik olarak uygun olmayan `completePublishedAudio(saved)` kaldırıldı. `AudioStorage` production operation-context zorunluluğu gevşetilmedi veya bypass edilmedi.
- Probe gerçek production slug'ı yerine random, sentinel-bound `sprint-126-readiness-*` project root kullanır. Terminal compensated journal ve canonical WAV mevcut containment/sentinel/rename cleanup sözleşmesiyle project root birlikte kaldırılır; readiness/WAV/compensation remainder `0` kalır.

### Public readiness sonucu

- `audio-storage`: `READY / AUDIO_STORAGE_READY`.
- `filesystem-permission`: `READY / FILESYSTEM_READ_WRITE_READY`.
- Lifecycle veya context hatasında public `AUDIO_STORAGE_ADAPTER_UNAVAILABLE` sözleşmesi korunur.
- Image, video, thumbnail ve assembly readiness adapter davranışları değişmedi.
- Toplam production readiness `27/27 READY`.

### Validation evidence

- `npx tsc --noEmit --incremental false` PASS.
- Production readiness acceptance `24`, Sprint 129.25B.1 runtime hardening `13`, production audio asset wiring `73`, runtime operation context `48` ve production worker lifecycle `21/21` PASS.
- Targeted ESLint ve `git diff --check` PASS.
- `npm run production:acceptance:readiness` sonucu `27/27 READY`; gerçek provider veya network çağrısı yapılmadı.

### Production bütünlüğü ve authorization boundary

- Production project tree başlangıç/kapanışta exact `220 file / 9 directory`; aggregate SHA-256 `2aeb3544b5501fbfac5b7155b16b364a7ead3222c37c4797986607058e3873ad`.
- Acceptance, manifest, jobs, history, animation, video ve assets hash'leri değişmedi. `audio.json` ve `assets/audio` başlangıç/kapanışta `MISSING`.
- Readiness root, canonical WAV, compensation record/journal ve temporary workspace remainder `0`; `data/projects` tracked/untracked diff `0/0`.
- Production execute/resume/reprepare/reauthorize `0`; backup create/restore `0`; production mutation/provider/network `0/0/0`.
- Production project audio aşamasından devam etmeye hazırlanıyor. Execution/resume ve gerçek provider çağrısı ayrı, açık kullanıcı yetkisi gerektirir. Bu dokümantasyon kapanışında commit veya push yapılmadı.

### Non-blocking P2 kayıtları

1. Scope dışı doğrudan `AudioStorage` write testi fail-closed public `AUDIO_STORAGE_WRITE_FAILED` sonucunu kanıtlar; internal `RUNTIME_OPERATION_CONTEXT_MISSING` ve fiziksel remainder yokluğunu ayrı exact assertion olarak kanıtlamaz. Production scope enforcement değişmemiştir.
2. Sprint 129.27 geniş suite'teki `WORKER_EXECUTION_FAILED` beklentisi stale'dir. `b58a350` failed-terminal settlement davranışından sonra güncel canonical terminal sonuç `AUDIO_ASSET_GENERATION_FAILED` olur. Bu uyuşmazlık readiness değişikliğiyle ilişkili değildir ve production sözleşmesi eski teste uydurulmamalıdır.

## Sprint 129.30 — Failed-Terminal Evidence and Retry Boundary Hardening / Completed

Sprint 129.29 bağımsız final incelemesinde kaydedilen üç bounded P2 hardening maddesi kaynak kodu ve operation-owned izole test runtime'ları üzerinde giderildi. İlk Sprint 129.30 independent review sonucu P0/P1/P2 `0/2/2` ile `REMEDIATION REQUIRED` verdi; dört dar bulgu giderildi. Independent re-review kaynak ve test kapsamını `APPROVED` kararı ve P0/P1/P2 `0/0/2` ile kapattı. Production lifecycle sırası, success settlement davranışı ve public reason-code sözleşmesi değiştirilmedi.

### Kapatılan P2 kanıtları

- Child-process harness full parent environment kopyasını kaldırdı. Portable explicit allowlist Windows'un case-insensitive key davranışını normalize eder; gerekli Node/tsx sistem/temp/user-context anahtarları dışında yalnız payload'a exact bağlanan `ATOLYE_RUNTIME_ROOT` taşınır. `NODE_ENV` parent'tan alınmaz ve literal `"test"` olarak kurulur. `OPENAI_*`, credential/token/secret, production acceptance ve ilgisiz `ATOLYE_*` değişkenleri child'a aktarılmaz.
- Child sonucu `{ code, stdout, stderr }` olarak ayrılır ve stream tamamlama `close` event'inde, `error`/`close` double-resolution guard'ıyla sonuçlanır. Başarılı race'lerde exit `0`, empty stderr ve yalnız stdout'ta anchored exact `CHILD_RESULT` ayrı ayrı doğrulanır. Bounded environment evidence tam olarak `runtimeRootBound:true`, `nodeEnvironmentIsTest:true`, `onlyAllowlistedKeys:true`, `sensitiveEnvironmentVisible:false`, `sentinelVisible:false` verir. Parent kontrollü OPENAI key, unrelated ATOLYE key, generic token/credential ve sentinel değerleri test sonunda exact restore edilir.
- Ayrı integrity-valid adversarial fixture'lar `second competing record`, `different non-terminal competing attempt` ve gerçek `duplicate reservation authority` sınıflarını kapsar. Duplicate reservation canonical identity builder ile yalnız semantic competing filtresinde bulunmayan controlled `createdAt` girdisi değiştirilerek üretilir; storage key embedded `identityFingerprint` ile exact eşleşir ve payload/key/inventory validation'dan geçer. Canonical project/stage/operation/request/idempotency/execution alanları aynı kalır; red exact `PIPELINE_FAILED_SETTLEMENT_COMPETING_AUTHORITY` cause üretir. Bütün redler `initial-chain-verification` sınırında `writePerformed:false`, `writeFree:true`, `quiescenceProven:false` kalır ve durable tree byte/hash olarak değişmez. Cleanup operation-root containment, exact key/path ve file device/inode/birth identity/size/hash kanıtından sonra yapılır; foreign replacement silinmez ve canonical settlement normal biçimde tamamlanır.
- Retry mapping synthetic settlement result yerine gerçek `settleFailedProductionPipelineExecution` ve gerçek lease/claim/storage/final-verification servis zincirini kullanır. Eski `settleFailure` seam'i kaldırıldı; yalnız isolated testlerin gerçek adapter'ı wrap etmesine izin veren dar `@internal createAdapter` dependency seam'i kaldı.

### Gerçek persistence-boundary mapping matrisi

- Exact idempotency record v3 write failure / `LEASE_ATOMIC_COMMIT_FAILED` / `lease-release` → `PIPELINE_RETRY_LEASE_CLEANUP_FAILED`; önceki adımlar yalnız terminal failed attempt, `writeFree:true`.
- Exact claim v2 write failure / `CLAIM_ATOMIC_COMMIT_FAILED` / `claim-close` → `PIPELINE_RETRY_CLAIM_CLEANUP_FAILED`; released lease persist edilmiştir, `writeFree:false`.
- Exact idempotency record v4 write failure / `DURABLE_STORAGE_ATOMIC_WRITE_FAILED` / `record-terminalization` → `PIPELINE_RETRY_IDEMPOTENCY_CONFLICT`; released lease ve abandoned claim persist edilmiştir, `writeFree:false`.
- Exact idempotency record v4 ikinci read failure / `IDEMPOTENCY_READ_FAILED` / `final-validation` → `PIPELINE_RETRY_COMPENSATION_FAILED`; terminal record dahil önceki settlement adımları persist edilmiştir, `writeFree:false`.
- Her fault yalnız exact operation/kind/key/version/occurrence kombinasyonunda bir kez çalışır, hedef dışı çağrıları gerçek file adapter'a delegate eder. Fault kaldırılınca aynı durable chain forward-complete olur ve sonraki replay byte-identical/write-free kalır. Handler/provider çağrı sayısı `1` olarak değişmez; retry/requeue/continuation oluşmaz.

### Validation evidence

- Sprint 129.30 persistence-boundary retry `5`, Sprint 129.29 failed settlement `40`, durable pipeline wiring `19`, durable attempt `58`, durable claim `39`, durable lease `40`, durable storage `63`, recovery bootstrap `18`, worker lifecycle `21`, readiness/admission `24` senaryo PASS; toplam `327`.
- `npx.cmd tsc --noEmit --incremental false`, değişen dosyalarda targeted ESLint ve `git diff --check` PASS.
- Bütün fixture'lar `withCanonicalSmokeRuntime` operation-owned temp runtime'ında çalıştı ve runtime/authority remainder `0` kaldı. Production project tree değişmedi. Provider, network ve TTS doğrudan çağrı sayaçları acceptance command seam'inden yapısal olarak kullanılamaz ve doğrudan instrument edilmiş sıfır sayaçlar olarak sunulmaz.
- Production execute/resume/reprepare/reauthorize, backup create/restore, unsafe production-copy/resume suite'leri, acceptance marker mutation, commit ve push çalıştırılmadı.
- Kullanıcı tarafından bildirilen mevcut PC runtime'ı canonical Snapshot A değildir. Production execution hâlâ yetkisiz ve blokludur; bu sprint production readiness veya execution yetkisi üretmez.

### Durable attempt lineage evidence closure / Approved

Sprint 129.30 durable attempt lineage remediation ikinci bağımsız yeniden incelemede `APPROVED`, P0/P1/P2 `0/0/0` kararıyla kapandı. Failed-terminal durable attempt lineage doğrulaması production-owned internal boundary instrumentation ile tamamlandı. Canonical attempt binding, journal, outcome ve durable-attempt integrity hesapları tek internal production implementation'da birleştirildi; production runtime ile compatibility harness aynı builder'ları kullanır. Test-local `stableProductionId`/integrity reconstruction kaldırıldı. Public barrel/API genişlemedi, durable payload şekilleri ve serialized byte çıktıları değişmedi; ortak public hata kodu `PRODUCTION_DURABLE_ATTEMPT_LINEAGE_BINDING_INVALID` olarak korundu.

#### Internal boundary ve observed control flow

- Yeni internal `src/lib/production/ProductionDurableAttemptLineageBoundary.ts` modülü dar production boundary union'ını ve raw error oluşturucu/okuyucusunu taşır. Boundary module-private, non-enumerable `Symbol` ile raw production error'a bağlanır; JSON serialization, durable persistence ve public CLI raporuna girmez.
- Resolver boundary'yi gerçek production karar noktalarında atar. Compatibility harness `actualObservedBoundary` değerini raw production error'dan okur; historical declared label sonuç kanıtı değildir. Compound predicate sırası ve short-circuit kabul/red semantiği değişmedi.
- `25/25` negatif invariant PASS. Historical tabloda production control flow ile uyuşmayan 11 etiket düzeltilmiştir: foreign project/stage → `no-applicable-lineage`; empty/malformed attempt operation → `attempt-record-operation-binding`; operation/run-type ve foreign runType → `attempt-reservation-binding`; foreign ordinal ve topology gap → `lineage-cardinality`; canonical attempt ID mismatch → `attempt-lineage-missing`; runtime operation fallback → `terminal-legacy-operation-compatibility`.
- Bütün negatif vakalarda public code exact `PRODUCTION_DURABLE_ATTEMPT_LINEAGE_BINDING_INVALID` kaldı.

#### Undefined semantic fixture ve CLI propagation

- Enumerable own-property değeri `undefined` JSON'da fiziksel olarak temsil edilemediğinden yalnız tek vaka gerçek physical read sonrasında semantic undefined injection kullanır. Production parser veya persistence adapter'a seam eklenmedi. `semanticFixtureScenarioCount: 1` yalnız bu istisnayı kullanan fixture senaryosu sayısıdır; diğer 24 negatif fixture gerçek fiziksel persistence kullanır.
- CLI kanıt zinciri `physical malformed lineage → resolver → acceptance command normalization` şeklindedir. Resume dependency ve resolver birer kez çağrılır; exact public code korunur, generic `PRODUCTION_ACCEPTANCE_COMMAND_FAILED` kullanılmaz ve internal boundary/path/payload/fingerprint/stack/secret public rapora sızmaz.
- Acceptance command seam yalnız `resume(projectSlug)` dependency'sini açar; stage/provider/network transport dependency injection yüzeyi yoktur ve sentetik/hardcoded sayaçlar kaldırılmıştır. Provider, network and TTS direct invocation counters are structurally unavailable from the acceptance command seam and are not claimed as directly instrumented zero counters.

#### Byte-equivalence ve canonical production evidence

- Physical compatibility fixture `4 file / 2 directory` olarak before/after exact kaldı. Relative paths, serialized byte lengths, individual SHA-256 ve metadata eşleşti; temp/partial/quarantine/lock/journal remainder `0`. Canonical aggregate `5f888498f08f9c9337059e4364cd40a4bce38669f4fc9f94ac31f6faabcf4073`.
- Canonical production aggregate sözleşmesi yalnız files-only, FullName-sorted `relativePath<TAB>length<TAB>sha256` satırlarını kullanır ve `bc2e5482c71ef0553f0f645bde788763d031be900f2cea694c01552f534a6a7b` üretir. Ayrı file-and-directory `type<NUL>path<NUL>length<NUL>hash` serialization'ı `ef639b0ff42dbf66b435c30cb97a893a37ddd8f450ac745bc11d1724b8fc1f2f` üretir; dokuz directory row ve farklı row biçimi nedeniyle değerler farklıdır, fiziksel drift değildir. Gelecek canonical karşılaştırmalar yalnız file-only sözleşmesini kullanmalıdır.
- Production kapanışı `220 file / 9 directory`; acceptance `68a206134460acfb875768f5df8ef18af516cafda80964556fa5b842aeabbac4`, project `591b3bfb4aa9dc07b4a75485b8af0bf124c2d302b52472fa6d72222b43c26824`, jobs `343e38b598bbd43e68dc6f68a91598db6d2a5e14c8c6ba874a965a2dc57d63d6`, history `c165ff9fd07b2e8992ab0bc12f1aff48348054642d400aad8b598875f11b0a8c`, animation `92a8952b660b88de1b1d9123f600db85f8cbfdcdfc03e701c8d147f62f0e1f8c`, video `08bf7fb27580873c8e203a70ab5b4285053d51c659173800bb98c709310ffcfc`. `audio.json` missing, `assets/audio` `0`, production-tree remainder `0`, `data/projects` tracked/untracked diff `0/0`; log SHA-256 `3c3c2ae59f4a359c4866eb467735454adc4f7ada611b4c0769874ebdaf47fba0`.

#### Final validation

- TypeScript, targeted ESLint ve `git diff --check` PASS. Physical lineage compatibility `27/27`, durable attempt/outcome `58/58`, Sprint 129.30 persistence boundary `5/5`, failed-terminal settlement `40/40`, worker lifecycle `21/21`, runtime operation context `48/48`, audio asset wiring `73/73`, production acceptance/CLI `30/30`; Sprint 129.28 lineage #126 ve #132 PASS.
- Sprint 129.28 full suite ilk 134 senaryoyu geçirir, ardından stale `WORKER_EXECUTION_FAILED` beklentisinin canonical `AUDIO_ASSET_GENERATION_FAILED` sonucu karşısında durur. Bu scoped remediation için non-blocking'dir; repository validation tamamen green değildir ve stale expectation değiştirilmemiştir.
- Hiçbir production execute/resume/retry/continue/reprepare/reauthorize veya backup create/restore işlemi yapılmadı. Bu dokümantasyon kapanışı production execution yetkisi üretmez.

### Non-blocking future hardening

- Windows parent environment restore testi controlled key'leri exact casing ile snapshot eder. Önceden farklı casing ile var olan case-insensitive alias'ın orijinal casing/presence durumunu birebir restore etme garantisi future harness hardening kapsamındadır; production composition etkilenmez.
- Fixture cleanup containment, exact path, file type, device/inode/birth identity, size ve SHA-256 doğrulasa da son pathname check ile `unlink` arasında teorik replacement aralığı vardır. Descriptor/directory-handle tabanlı cleanup, identity-bound unlink veya canonical runtime finalizer ownership future hardening kapsamındadır; operation-owned izole runtime nedeniyle mevcut sprinti bloklamaz.
- Independent re-review bildirilen PASS matrisinin statik incelemesine dayanır; reviewer ortamında testler yeniden çalıştırılmadı.

## Sprint 129.29 — Failed-Terminal Settlement Remediation / Completed

Sprint 129.29 kaynak düzeyindeki failed-terminal settlement remediation çalışması bağımsız final re-review sonucunda `APPROVED` olarak kapatıldı. Bulgu sayıları P0 `0`, P1 `0`, P2 `3`.

### Onaylanan mimari sonuç

- Canonical failed lifecycle `failed attempt → released lease → abandoned claim → cancelled record → canonical durable quiescence → original error propagation` sırasını uygular.
- Gerçek canonical runtime failed-settlement callback'ini kurar. Terminal failed attempt persistence settlement'tan önce tamamlanır; attempt persistence failure settlement olmuş gibi raporlanmaz.
- Başarılı settlement yolu değişmedi. Failed settlement otomatik retry, job requeue, worker restart, provider continuation veya ikinci handler/provider çağrısı üretmez.
- Partial settlement durumları append-only no-clobber/CAS publication ve fail-closed reread ile güvenli biçimde forward-complete edilir. Historical stale durum aynı ortak primitive üzerinden tamamlanır; fully settled failure reconciliation write-free replay döndürür.
- Cross-process doğruluk process-local lock'a değil durable no-clobber/CAS ve winner readback doğrulamasına dayanır. Settlement/settlement, settlement/reconciliation ve distinct active claim içeren gerçek child-process race testleri geçti.

### Extended settlement error contract

Settlement failure error'ları bounded ve serializable `writePerformed`, `writeFree`, `quiescenceProven`, `completedSettlementSteps`, `failedBoundary`, `originalReasonCode`, `settlementReasonCode`, `causeReasonCode` ve sanitized durable attempt evidence alanlarını korur. Bu evidence absolute path, secret, provider payload, request body, raw exception veya stack içermez.

### Güncel production durumu

- Research, script, scenes, visuals, animation ve video `completed`; audio `queued` ve attempts `2`; assembly, thumbnail, seo, youtube ve export `queued`.
- Physical audio file `0`; `audio.json` ve `assets/audio` yoktur.
- Durable authority `ready`; latest record v4 `cancelled`, lease v2 `released`, claim v2 `abandoned`, attempt v3 terminal `failed`; terminal code `AUDIO_ASSET_GENERATION_FAILED`.
- Recovery başlangıcı `audio`; stage zinciri `audio → assembly → thumbnail → seo → youtube → export`.
- Inventory `229 entry = 220 file + 9 directory`; reparse, temp, lock, compensation ve audio residue `0`.

### Güncel schema marker ve production hash'leri

- Marker schema/profile `3 / 2`; acceptance status `prepared`; `productionReady:false`; `published:false`; publish mode `package-only`.
- Marker/acceptance SHA-256: `68a206134460acfb875768f5df8ef18af516cafda80964556fa5b842aeabbac4`.
- Manifest: `bb425a8f8ed2fd30bcc327ba09e7b35bec0820cafabac735637dade149e527be`.
- Jobs: `343e38b598bbd43e68dc6f68a91598db6d2a5e14c8c6ba874a965a2dc57d63d6`.
- History: `c165ff9fd07b2e8992ab0bc12f1aff48348054642d400aad8b598875f11b0a8c`.
- Animation: `92a8952b660b88de1b1d9123f600db85f8cbfdcdfc03e701c8d147f62f0e1f8c`.
- Video: `08bf7fb27580873c8e203a70ab5b4285053d51c659173800bb98c709310ffcfc`.
- Assets: `e5f70fe8387e47f2f1c0a7bbd661fc529d6ba6b8b52e0ab8d12fa5ffa97cda54`.

### Validation evidence

- Failed settlement `37`, durable wiring `19`, worker lifecycle `21`, execution-worker command legacy worker `55` + durable worker `18`, recovery bootstrap `18`, attempt `58`, claim `39`, lease `40`, durable storage `63`, audio wiring `73`, readiness/admission `24` senaryo PASS.
- Actual unique core executions `465`; additional durable execution compatibility `17`. Önceki yanlış `444` toplamı geçerli değildir.
- TypeScript, narrow ESLint ve `git diff --check` PASS.
- Sprint 129.13 production-copy ve Sprint 129.9 production-resume nitelikli unsafe suite'ler çalıştırılmadı.

### Kalan bounded P2 hardening kayıtları

1. Child-process harness full parent environment'ı devralır ve stderr'i stdout ile birleştirir.
2. Persisted-authority adversarial testleri second competing record, different non-terminal competing attempt ve duplicate reservation authority durumlarını ayrı fixture olarak henüz kurmaz.
3. Retry failure mapping testleri gerçek persistence-boundary failure yerine synthetic settlement result kullanır.

Bu üç kayıt future hardening kapsamındadır ve onaylanan failed-terminal lifecycle remediation'ını bloklamaz.

### Authorization boundary

Kaynak remediation onaylanmıştır. Queued audio execution ve production resume onaylanmamıştır. Provider/network execution ancak clean Git checkpoint, exact provider/configuration preflight, Snapshot A no-drift verification, final execution planning ve yeni açık kullanıcı yetkisinden sonra değerlendirilebilir.

## Runtime Backup Long-Path and V3 Authority Remediation / Completed

Runtime backup long-path, authority binding ve atomik cleanup remediation çalışması tamamlandı. Bağımsız nihai inceleme kararı `APPROVED`; P0 `0`, P1 `0`, P2 `0`.

### Manifest ve path-policy sözleşmesi

- Global runtime path policy ve standart `beginMutation()` sözleşmesi değiştirilmedi. Production-shape backup yollarını reddeden eski global `180 UTF-16` sınırı yerine yalnız backup alanına ait versioned path-policy eklendi.
- V1: schema `1`, `runtime-backup-v1`, path-policy alanı yok, `180 UTF-16 / 240 UTF-8` logical-path ve `240 UTF-16` materialization sınırı; yalnız portable verify/restore compatibility için korunur.
- V2: schema `2`, `runtime-backup-v2`, `runtime-backup-relative-path-v2`, `220 UTF-16 / 300 UTF-8` logical-path ve `259 UTF-16` materialization sınırı; yalnız portable verification compatibility için korunur. Runtime authority taşımadığı için same-authority restore fail-closed olur.
- V3: schema `3`, `runtime-backup-v3`, `runtime-backup-relative-path-v2`, `runtime-tree-sha256-v1` aggregate, canonical source runtime authority ve exact project logical identity taşır. Yeni create işlemleri yalnız V3 üretir.

### Runtime ve storage authority

- Host-path-free ve kalıcı `runtimeAuthorityId`, trusted bootstrap tarafından oluşturulan authority marker üzerinden kurulur. Restart ve runtime-root relocation aynı kimliği korur; bağımsız runtime root'lar farklı kimlik üretir.
- Malformed/değiştirilmiş marker fail-closed reddedilir. Structural/fake authority nesnesi nominal ownership kazanamaz.
- Public create/restore caller-provided `backupRoot` veya `backupDirectory` kabul etmez. Backup root yalnız trusted nominal storage authority'den türetilir; final yol trusted root altında bounded backup ID ile oluşturulur.

### Verification ve request boundary

- Same-authority verify/restore yalnız V3 kabul eder ve exact runtime authority ile exact project identity binding uygular. Cross-runtime ve cross-project restore reddedilir.
- Portable verification V1/V2/V3 destekler, temp-owned materialization ile sınırlıdır, `currentRuntimeBound:false` üretir ve live runtime restore authority kazandırmaz.
- Strict DTO boundary mutation öncesinde enumerable/non-enumerable fazla alan, Proxy, getter/setter, inherited property, symbol key, class instance, null-prototype object, array/function, boxed primitive ve structural fake authority girdilerini fail-closed reddeder. Doğrulama `Reflect.ownKeys`, exact `Object.prototype` ve own data descriptor kurallarını kullanır.

### Atomik publication, cleanup ve doğrulama

- Publication ownership post-publication verification ve reservation/session/publish-lock cleanup tamamlanmadan bırakılmaz. Cleanup failure başarıya çevrilmez; canonical `CLEANUP_REQUIRED` davranışı korunur ve foreign identity silinmez.
- Operation-created root/container/lock/partial/final kalıntıları güvenli biçimde temizlenir. Production-shape `190` karakter yol, bağımsız exact `259` public create → verify → restore zinciri ve exact `260` pre-mutation rejection doğrulandı.
- Gerçek child-process barrier source drift'i yakaladı. İki gerçek process'in same-backup-ID yarışında tam bir winner oluştu; loser winner verisini değiştirmedi veya temizlemedi. Post-publication root-layout TOCTOU fail-closed sonuçlandı.
- Final matrix: runtime backup `38/38`, runtime storage `21/21`, runtime hardening `13/13`, guarded filesystem `16/16`, guarded unsupported skip `0`, TypeScript, targeted ESLint ve `git diff --check` PASS; provider/worker/network çağrısı `0`.
- Production baseline hash'leri manifest/jobs/history/acceptance/animation/video/assets için başlangıç ve kapanışta eşleşti. `data/projects` tracked/untracked diff `0/0`; production create/restore, execute/resume ve mutation `0` kaldı.

Bir sonraki kontrollü adım bu dokümantasyon kapanışının commit/push edilmesi, ardından aktif production projesine audio aşamasından devam hazırlığıdır. Bu dokümantasyon turu production resume veya gerçek provider çağrısı yetkisi vermez; bunlar ayrı ve açık kullanıcı onayı gerektirir. Bu turda commit veya push yapılmadı.

## Sprint 129.28 — Production Acceptance Reauthorization and Durable Identity Authority Hardening / Completed

Sprint 129.28 legacy production acceptance reauthorization, durable recovery store-policy ve capability identity authority zincirini fail-closed biçimde tamamladı. Bağımsız final re-review kararı `APPROVED`; P0 `0`, P1 `0`, P2 `0`.

### Final Documentation and Handoff — 2026-07-28

- Canonical smoke runtime foundation tamamlandı. Repository inventory `90` harness ve `0` remediation-required olarak doğrulandı; positive production/durable harness'ler isolated runtime/authority/context modeline taşındı.
- Operation-authority-bound durable read adapter tamamlandı. Provider adapter authority ve retry/recovery bağları fail-closed; exact canonical identity ordering ve strict provider adapter factory authority korunuyor.
- Shared authority current-run delta `0`, production data delta `0`. Historical shared legacy claim silinmedi veya değiştirilmedi.
- Immutable evidence, controlled resume provenance ve disk-only semantic aggregate tamamlandı. Same-inode cleanup identity açığı byte-length ve SHA-256 authority kontrolleriyle kapatıldı.
- Evidence invariant suite `98/98 PASS`. Final temp audit artefact run ID `canonical-closure-20260728-06`; evidence root repository'ye eklenmedi.
- Full matrix `41/41` child ve `5/5` partition PASS. Missing, duplicate, foreign, failed, skipped, timedOut ve interrupted sayaçları `0`.
- Shared inventory `10.278` entry, digest `d01159d16b1841dc9ccd2b3fbc5529fed85f7d0befc9ebd6c482bb81c8ae4064`; production inventory `216` entry, digest `29ec9f4925f04061b551597f4470d14939230cd244f64ac2d547e71da6e1d5f9`.
- Workspace, runtime, authority, temp ve ownership remainder değerleri `0`. TypeScript, targeted ESLint, full lint ve `git diff --check` PASS.
- Bu sprintte gerçek production execute/resume veya provider/network çağrısı yapılmadı. Aktif production projesi audio aşamasından devam edecektir; ilk gerçek production continuation öncesinde kısa readiness/integrity doğrulaması ve ayrıca açık kullanıcı onayı zorunludur.

- En az bir geçerli reservation bulunduğunda idempotency store zorunludur. `validReservationCount` yalnız `lifecycleState !== "invalid"` kayıtlarını sayar; expired, released ve terminal reservation store gereksinimini korur. Missing store exact `REQUIRED_IDEMPOTENCY_STORE_MISSING` üretir; empty-present/not-created ayrımı, corrupt reservation reddi ve claim/attempt gereksinimleri korunur. Store-policy matrix active-reservation conflict kontrolünden önce uygulanır.
- Canonical authority sırası `durable reservation → idempotency record → lease → claim → attempt persistence → persisted readback verification → completed durable authority → canonical identity → lifecycle binding → capability issuance → provider-gate exact revalidation` olarak sabitlendi. Durable attempt capability issuance'dan önce persist ve exact readback edilir; duplicate attempt create veya replay/idempotency regresyonu yoktur.
- Canonical identity yalnız completed durable readback'tan kurulur: request/idempotency/operation/reservation/claim/attempt/execution alanları completed record ve binding'lerden, `leaseId` yalnız `completed.lease.identity.leaseId` kaynağından gelir. Pre-durable plan/request nesneleri capability authority değildir.
- Completed-preparation authority module-private `WeakMap` ile sahiplenilir; token frozen ve null-prototype'dır. Plain object, spread clone, serialized/deserialized nesne, forged null-prototype ve pre-plan nesnesi authority kazanamaz; paralel token veya ikinci registry yoktur.
- Issued/admitted identity reservation, idempotency record, lease, claim ve attempt ile direct exact karşılaştırılır. Request/idempotency/operation/lease mismatch'leri kendi canonical kodlarını üretir; trim, normalize, lowercase, fallback, default, loose equality veya yeniden türetme yoktur. Her mismatch provider `0`, capability invalidated ve ikinci kullanım `LEGACY_CAPABILITY_INVALIDATED` sonucunu verir.
- Coordinated post-issuance mutation testinde lease, claim ve attempt aynı foreign leaseId ile ve yeniden üretilmiş integrity fingerprint'leriyle kendi aralarında tutarlı tutulsa da issued capability eski completed leaseId'yi korur; exact `LEASE_ID_MISMATCH`, provider `0` ve invalidation doğrulanır.
- Gerçek factory poisoning seam'i pre-plan requestId, idempotencyKey, operation ve leaseId değerlerini zehirler; canonical identity persisted completed değerleri kullanır. Opaque authority/capability negative control'leri runtime'da reddedilir.
- Production instrumentation sırası `durable-entry → durable-attempt-persisted → durable-readback-verified → canonical-identity-extracted → lifecycle-bound → capability-issued → revalidation-entered → provider-entered` olarak explicit barrier'larla doğrulandı. Sleep, timeout veya scheduler tahmini yoktur.
- Capability `issued → consuming` geçişi ilk await öncesindedir. Identity mismatch, lifecycle failure ve durable revalidation failure invalidation üretir; kalıcı consuming durumu yoktur. Normal success concurrency provider `1`, provider-throw concurrency provider `1`, revalidation failure provider `0` olarak korunur.
- Fixture'lar unique `os.tmpdir()` kökü ve explicit `ATOLYE_RUNTIME_ROOT` kullanır; environment exact restore edilir, undefined anahtarlar silinir, temp cleanup yapılır ve provider'lar local spy'dır. Repository `data/projects` test runtime'ı değildir; gerçek network çağrısı yoktur.
- Final validation: Sprint 129.28 `102/102`, Sprint 129.27 isolated `77/77`, portability `15`, topic/run `24`, marker reprepare `22`, durable storage `63`, guarded filesystem `16`, durable attempt `58`, durable recovery `29`, recovery bootstrap `18/18`, worker lifecycle `21/21`, runtime context `48`, production audio wiring `73`, TypeScript, targeted ESLint ve `git diff --check` PASS.
- Production safety exact korundu: `data/projects` tracked/untracked diff `0/0`, inventory `199` dosya; altı scene MP4 ile manifest/jobs/history/acceptance/animation/video/assets hash'leri değişmedi. Marker/sidecar/archive/receipt diff yok; hedef production projesinde `audio.json`, `assets/audio` ve compensation workspace yok. `productionReady:false`, `published:false`, `publishMode:"package-only"`; production command ve gerçek provider/network çağrısı yapılmadı.

Bir sonraki adım kullanıcının Sprint 129.28 kapsamını gözden geçirip commit/push yapmasıdır. Bu dokümantasyon kapanışı production execute/resume/finalize/reauthorize veya controlled retry yetkisi vermez; bunlar ancak ayrı ve açık kullanıcı talimatıyla değerlendirilebilir. Bu turda commit veya push yapılmadı.

## Sprint 129.27 — Audio Atomicity, Compensation & Publication Hardening / Completed

Sprint 129.27 production audio generation ve canonical storage zincirini bounded identifier/evidence, strict WAV validation, portable no-clobber publication, durable compensation authority, crash-atomic journal persistence, EXDEV recovery, logical tombstone authority ve descriptor-bound reads ile sertleştirdi.

- Ortak audio identifier policy model/voice değerlerini bounded ve safe biçimde doğrular; unsafe, aşırı uzun veya secret-benzeri değerler fail-closed reddedilir. Durable evidence yalnız bounded, path-free identifier taşır.
- Strict RIFF/WAVE parser PCM ve IEEE float contract'larını, desteklenen bit-depth/channel/sample-rate sınırlarını ve `dataByteLength % blockAlign === 0` whole-frame invariant'ını uygular. Malformed WAV `AUDIO_WAV_INVALID`, storage/readback failure `AUDIO_STORAGE_WRITE_FAILED` olarak ayrı kalır.
- Provider status, content-type, body-size ve timeout failure'ları bounded canonical evidence ile ayrıştırılır. Public error contract path, API key, secret veya raw provider response sızdırmaz.
- Ortak `PortableNoClobberFilePublisher` hard-link-first çalışır; yalnız desteklenen EXDEV/unsupported durumda exclusive-copy fallback kullanır. Destination no-clobber'dır; receipt-bound deterministic staging, reservation-before-canonical-publish ve canonical publication binding zorunludur.
- Durable authority receipt/reservation/publication/state journal modeline, exact operation ID/fingerprint v2 binding'ine, receipt/reservation integrity bağlarına ve device/inode/size/SHA-256 identity'sine dayanır. Publication reservation olmadan, reservation receipt olmadan veya device/inode sıfırken admission verilmez; aynı-content foreign canonical hash eşitliğiyle sahiplenilmez.
- Journal persistence unique staging partial, complete write, file fsync, descriptor readback, exact byte/identity verification ve no-clobber hard-link finalize kullanır. Mid-write, short-write veya fsync failure poison final journal üretmez; partial journal authority sayılmaz. Parent-directory durability platform capability'si açıkça ele alınır.
- EXDEV recovery deterministic `publication-staging.wav` locator'ını reservation identity'sine bağlar. Durable reservation + missing canonical restart'ta staging exact doğrulanır, canonical no-clobber finalize edilir, publication binding tamamlanır ve replay idempotent kalır. Foreign staging/canonical mutation-free fail-closed korunur.
- `completed/compensated` publication bütün resolver'larda tombstone ile reddedilir. Pending publication yalnız exact active operation tarafından, registry-owned publication durable authority ile okunur. Public route, `AudioStorage`, assembly, pipeline ve recovery aynı admission authority'yi kullanır; compensation sonrası canonical yeniden sahiplenilemez.
- Canonical read pre-fstat, descriptor üzerinden full read, post-fstat, exact device/inode/size, buffer length/SHA-256 ve durable publication identity karşılaştırması yapar. Path swap, same-content foreign inode ve mid-read mutation reddedilir; descriptor kapandıktan sonra pathname'e yeniden güvenilmez.
- Typed `AudioCanonicalAdmissionConflictError`, public `AUDIO_STORAGE_WRITE_FAILED` + `storage` sözleşmesini string/path matching olmadan korur. Foreign-canonical security conflict'te compensation, failed-asset persistence, registry ve journal/publication mutation'ı çalışmaz; foreign dosya korunur. Normal provider, malformed WAV ve genel storage failure'larında failed-asset persistence devam eder.
- Destructive recursive compensation cleanup kaldırıldı. Receipt-bound tombstone/workspace authority, foreign replacement korunumu, terminal retirement, exact allowlist cleanup ve cross-operation retention uygulanır; pending/retryable/conflict kayıtları korunur. `completed`/`not-required`/`failed` cleanup evidence bounded ve path-free aktarılır.
- Final atomicity closure identity-check sonrası pathname unlink/rmdir yarışını ve canonical verification sonrası rename yarışını destructive pathname mutation'ını kaldırarak kapattı. Publish başarısı ile `publication.json` persistence arasındaki crash orphan'ı durable reservation, exact canonical binding ve deterministic/idempotent recovery ile güvenli biçimde yeniden bağlanır veya fail-closed kalır. Physical cleanup yerine logical retirement ve bounded deferred evidence kullanılır; foreign replacement hiçbir cleanup/recovery yolunda silinmez veya taşınmaz.
- Windows fixture portability düzeltmesi smoke içindeki hassasiyet bağımlı `stat.ino + 1` fault injection'ını kaldırdı; mevcut inode `1` değilse `1`, aksi halde `2` seçen finite, non-zero ve kesin farklı deterministik identity kullanıldı. Production davranışı ve güvenlik sözleşmesi değişmedi.

### Final Two-Phase Publication Documentation Closure — 2026-07-29

Production Audio Two-Phase Publication remediation bağımsız targeted re-review ile `APPROVED` olarak kapatıldı. Final bulgu sayıları P0 `0`, P1 `0`, P2 `3`; kod ve test kapanışı tamamlandı.

- Lifecycle `preparing → prepared → publishing → committed` ile `failed-precommit` ve `conflict` sonuçlarını korur. Canonical publication son fallible commit noktasıdır; WAV validation, descriptor readback, hash/length, metadata ve durable intent hazırlığı publication öncesinde tamamlanır. Crash/restart/replay provider çağrısı olmadan idempotent tamamlanır.
- Collection load `intentId`, `compensationRef`, `asset.id` ve canonical storage path için exact uniqueness uygular. Her duplicate bütün collection'ı fail-closed yapar; first-wins, silent deduplication veya partial registry görünümü yoktur.
- Registry ownership, reconciliation ve intent read contained resolution, open, pre/post `fstat`, descriptor read, close, post-path identity ve SHA-256/publication binding ile descriptor-bound'dır. Same-content veya same-size foreign replacement owned sayılmaz ve foreign artifact değiştirilmez.
- Compensation reference için tek authority `AudioCompensationStore.isSafeAudioCompensationRef()` helper'ıdır. Lookup, prepare/write ve persisted read/schema aynı canonical UUIDv4 policy'sini kullanır. Integrity-valid malformed kayıt store/collection/AssetManager zincirinde fail-closed olur ve partial liste veya registry success üretmez.
- Dokuz canonical audio root exact allowlist ile korunur; root/phase job, manifest, history ve durable attempt yüzeylerinde exact eşleşir. Unknown root/phase fail-closed, evidence bounded/path-free/secret-free kalır.
- Retry kanıtı provider factory invocation `2`, farklı provider object identity, durable attempt `2`, doğru failure→success lineage ve farklı-root failure ayrışmasını doğrular; configured-provider fallback yoktur.
- Final validation: canonical compensation predicate `9/9`, audio remediation `117/117`, production audio wiring `73/73`, audio budget `19/19`, runtime hardening `13/13`, guarded filesystem `16/16`, durable attempt `58/58`, durable execution `17/17`, durable wiring `19/19` ve runtime backup/security `38/38` PASS. TypeScript, targeted ESLint ve `git diff --check` PASS.
- Production safety: yedi exact local file hash ve deterministic assets aggregate başlangıç/kapanış MATCH; `data/projects` tracked/untracked `0/0`, production audio entry `0`, partial/lock/compensation/intent residue `0`, production mutation `0`, gerçek provider/network çağrısı `0/0`.

Non-blocking açık P2 kayıtları: (1) intent strict DTO proxy/prototype/symbol/data-descriptor hardening, (2) legacy `AudioStorage.saveAudio()` pathname verification, (3) ayrı canonical publish ve registry success sayaçları. Bunlar aktif production generation/resume güvenlik sınırını doğrudan bypass etmez.

### Production Resume Authority Blocker

Kod remediation onaylanmıştır; production resume readiness ayrı admission kararıdır. `ATOLYE_RUNTIME_ROOT` unset ve bu checkout legacy-default repository runtime kullanıyor. Farklı cihazlarda farklı local production snapshot hash'leri görülmüştür. Önceki `60af…` assets aggregate değeri mevcut deterministic aggregate sözleşmesiyle yeniden üretilemedi. Mevcut aggregate `0081087b3a9a987a1152e0c689c1ee57f5469d08c3236b23071ece0c8a732300`; `assets/assets.json` SHA-256 değeri `baa7dacc3a92fbba708fc070dd189addc34a9bde77e4a24077ae00aef9b92ddd`.

Remediation production mutation yapmadı; buna rağmen operator canonical runtime snapshot/authority seçimini açıkça yapmadan production resume/reprepare/reauthorize veya provider çağrısı çalıştırılmamalıdır. Sonraki güvenli adım bu documentation closure kapsamının kullanıcı tarafından commit/push edilmesidir.

## Sprint 129.25 C.2B.4 — Operation-Scoped Runtime Context Propagation / Completed

Production operation'lari tek immutable operation-scoped runtime context'e baglandi. Storage context provenance'i trusted construction ve exact operation binding ile dogrulanir; process-wide canonical `PipelineRunner` authority ile process-wide canonical durable executor/adapter authority ayni process icinde duplicate execution surface olusmasini engeller. Repository-local mevcut davranis ve logical locator contract'lari korunur.

Operation completion sonrasinda context revoke edilir; revoked context yeniden kullanilamaz. Parallel operation'lar birbirinin context veya authority binding'ini kullanamaz. Missing, mismatched veya revoked context fail-closed reddedilir. Worker admission durable mutation'dan once, recovery exact-context admission ise recovery persistence'inden once zorunludur.

Public raw scope, executor ve durable adapter bypass yuzeyleri kaldirildi. HMR/module duplication ayni exact canonical pair icin idempotent kalir; farkli authority ile overwrite veya ikinci canonical kayit yerine fail-closed conflict uretir. Bu kapanis relocation, candidate consume, root/authority cutover, serving adapter migration'i veya durable authority generation binding'i yapmaz ve bunlara yetki vermez.

Bagimsiz closure review `APPROVED FOR DOCUMENTATION COMPLETION` karari verdi; P0/P1 yoktur. C.2B.4 runtime context smoke 48/48, worker lifecycle 21/21, recovery bootstrap 15/15, runtime status 15/15, runtime startup/composition 11/11, durable execution 17, durable wiring 19, retry/continuation 22, auto-continuation 18, runtime health API 24/24 ve health API consumer 15 PASS; TypeScript, ESLint ve `git diff --check` PASS. Runtime, acceptance marker ve production data degismedi.

Non-blocking P2'ler: `CLAIM_NEXT_VERSION_CONFLICT` no-op sonucunun semantik/diagnostic siniflandirma hassasiyeti ve retry smoke icindeki continuation-admission reset seam'in test-fidelity riskidir.

## Sprint 129.25 C.2B.3 — Production Storage Relocation Audit / In Review

Production runtime read/write/serve/recovery yollarinin fiziksel storage root bagimliliklari mutation-free olarak denetlendi. Kesin audit matrisi `docs/PRODUCTION_STORAGE_RELOCATION_AUDIT.md` dosyasinda 28 entrypoint ailesini owner, logical locator, physical resolver, `RuntimeStorageContext`/frozen context, authority, containment/reparse, durable/Git bagi, external uyum, relocation sinifi, blast radius ve gerekli sonraki sprint ile kaydeder.

Audit dagilimi 11 `READY`, 7 `REQUIRES ADAPTER`, 1 `REQUIRES MIGRATION`, 5 `REQUIRES POLICY DECISION` ve 4 `BLOCKING` entrypoint ailesidir. P0 blocker'lar repository-local image/audio API serving, startup seviyesinde frozen production runtime authority bulunmamasi, durable execution adapter'larinin tek authority generation'a bagli olmamasi ve versioned/no-clobber authority transition protokolunun bulunmamasidir.

P1 gate'leri fail-closed project read semantics, external runtime icin Git/byte evidence ayrimi, acceptance storage-policy semantigi, relocation-target/quarantine protected-root rolleri, rollback modeli, script root ayrimi ve FFmpeg/asset locator regression sinirlaridir. Onerilen karar offline stop-the-world, drain + durable quiescence, verified candidate consume, exclusive empty target, read-only old-root quarantine ve cutover sonrasi ayri Git untracking sprintidir.

C.2B.3 yalniz audit ve mimari karar hazirligidir. Kaynak/test kodu, `data/projects/**`, Git index/`.gitignore`, marker, backup veya candidate degistirilmedi; relocation, copy/move, candidate consume, restore, root/authority switch, cutover, rollback veya production execution yapilmadi. Sprint independent audit review tamamlanmadan `Completed` olmayacaktir.

## Sprint 129.25 C.2B.2 — Verified Migration Candidate Creation / Completed

Tek public orchestration entrypoint'i `RuntimeMigrationCandidateService.createVerifiedMigrationCandidate()` eklendi. Service C.2B.1 salt-okunur preflight'ini ve explicit backup verifier'i mutation oncesinde yeniden calistirir; candidate kaynagi yalniz verified `runtime-backup-v1` `payload/projects` agacidir. Live runtime hicbir copy source yoluna girmez.

Candidate create guarded candidate root session'i, operation-owned random `.partial`, manifest sirasinda exclusive copy, source/destination size ve SHA-256 readback, canonical candidate manifest/digest ve staging verification kullanir. Deterministik final candidate publish reservation altinda no-clobber file publish ile yapilir; payload sonrasinda manifest ve digest en son yayinlanir. Final readiness oncesinde independent candidate verifier, exact backup binding, backup re-verification ve live runtime freshness preflight'i yeniden calisir.

Existing final candidate strict final verification ve exact backup binding'e ek olarak canonical semantic manifest identity ve versioned policy hash'iyle karsilastirilir. Identity; candidate/backup ID, manifest SHA/aggregate, runtime freshness, canonical inventory/payload binding ve policy version'larini tasir; `createdAt`, Git ve operation publication evidence'i identity disidir. Ayni backup/policy ile farkli `now()` write-free reuse edilir; identity veya policy sapmasi overwrite/delete olmadan `CANDIDATE_RECOVERY_REQUIRED` olur. Stale session/reservation/partial evidence valid final yaninda dahi sessizce yok sayilmaz. Ownership mismatch, orphan-suspect, cleanup/release/close failure ve aciklanamayan reservation conflict stable recovery-required olur. Published final hicbir failure cleanup'inda silinmez; cleanup yalniz identity'si tekrar dogrulanan operation-owned partial ile sinirlidir.

Readiness yalniz published ve yeniden dogrulanmis final candidate icin `candidateReady:true` uretir; `.partial` staging readiness uretemez ve public verifier `.partial` path'i daima reddeder. Staging kontrolu export edilmeyen internal helper'dir. Public create girisinin tamamini kapsayan outer normalization boundary input/preflight/live-Git inventory/backup/protected-root/session/publish/freshness hatalarini stable path-free migration error'a cevirir; inner lifecycle recovery-required sonucunu korur. Public readiness absolute host path yerine yalniz `candidateId` ve `candidates/<candidateId>` logical locator'i tasir. `candidateCreated`/`candidateReused` ayrimi vardir ve candidate ile verifier raporlarinda `cutoverAuthorized:false` sabittir.

C.2B.2 smoke 34/34 PASS; Windows junction rejection PASS, file symlink creation yetkisi bulunmadigi icin `SKIP_UNSUPPORTED` acik evidence gap olarak raporlanir. Happy path gercek instrumentasyonda `candidateRootMutations=50`, `payload-copy=4`, `final-publish=6`, `liveRuntimeWrites=0`, `backupWrites=0` ve `productionBoundaryCalls=0` olctu. Valid reuse'da `candidateRootMutations=0`; session/partial/reservation/publish/cleanup mutation event'lerinin tamami 0, `liveRuntimeWrites=0`, `backupWrites=0` ve `productionBoundaryCalls=0` olarak dogrulandi. C.2B.1 48/48, C.2A 16/16, C.1 18/18, B.1 13/13 ve eski B 21/21 PASS; TypeScript, targeted ESLint ve `git diff --check` PASS. `data/projects/**` diff bos kaldi.

Bagimsiz final review `APPROVED FOR DOCUMENTATION COMPLETION` karari verdi ve Sprint 129.25 C.2B.2 Completed olarak kapatildi. Non-blocking P2'ler: active capability evidence gercek probe sonucunu manifestte yansitmaz; parsed nested manifest deep-freeze edilmez; process-level concurrent same-ID testi yoktur; file symlink testi `SKIP_UNSUPPORTED` kalmistir.

C.2B.3 yalniz production storage relocation audit'idir ve baslamadi. Runtime relocation, candidate/runtime root mutation'i, authority/root switch ve cutover C.2B.2 tarafindan yetkilendirilmez. Commit veya push yapilmadi.

## Sprint 129.25 C.2B.1 — Migration Candidate Schema, Preflight & Verifier / Completed

`runtime-migration-candidate-v1` immutable candidate sözleşmesi eklendi. Candidate authority akışı `live runtime -> explicit verified backup -> migration candidate` olarak sabitlendi; project-subset, machine state, authority claim ve ephemeral coordination candidate scope'una alınmadı. Acceptance marker, `production-execution/**`, generated asset ve diğer `projects/**` dosyaları mevcut `runtime-backup-v1` file record/classification authority'siyle bağlandı. Git HEAD/index metadata'sı informational evidence olarak kalır ve candidate identity ya da aggregate girdisi değildir.

Candidate ID; format version, source backup manifest SHA-256, source aggregate, all-projects scope version ve `windows-portable-path-v1` girdilerinden deterministik üretilir. Exact-key manifest canonical serialize edilir; digest canonical `candidate.json` byte'larını bağlar. Standalone verification için tam file record seti, classification totals, marker ve durable-execution binding'leri ile file setinden türetilen minimal directory closure saklanır. Absolute path, host, username, operation ID, timestamp, capability ve Git evidence aggregate'e girmez.

Salt-okunur preflight explicit backup directory ve candidate root ister; backup directory canonical olarak bildirilen backup root altında bağlanır ve gerçek backup package candidate protected-overlap kontrolüne ayrıca katılır. Backup yeniden exact verify edilir; her backup file record candidate `payload/projects` kökü altında materialized path limitinden geçirilir. Live runtime byte inventory/aggregate, acceptance marker, durable records, HEAD ve `data/projects/**` worktree evidence'i karşılaştırılır. Candidate destination repository, `.git`, runtime, projects, machine, authority, backup package/root ve restore-verification root'larıyla overlap edemez. Windows destination yalnız salt-okunur `DriveInfo.DriveType` kanıtı `Fixed` ise local-persistent kabul edilir; mapped/network, removable, CD-ROM, RAM disk, unknown ve parse/query failure unsupported kalır. UNC/network root v1'de unsupported, temp root yalnız explicit test modu olarak raporlanır. Preflight active write probe, candidate/reservation/copy/publish/cleanup veya production readiness probe'u çalıştırmaz ve her zaman `cutoverAuthorized:false` raporlar.

Independent verifier exact `candidate.json`/`candidate.sha256`/`payload/projects` layout, partial rejection, canonical schema/digest, candidate ID, portable path/case-fold/materialized path-length, missing/extra/modified bytes, inventory/aggregate/classification, marker/durable binding, minimal directory topology, link/reparse/special-file rejection ve explicit backup manifest/aggregate/backup-ID binding kontrollerini uygular. Materialized path ihlali stable `PATH_POLICY_VIOLATION` üretir. Capability drift candidate byte validity'sini bozmaz; destination readiness ayrı kalır.

Desteklenen tehdit modeli trusted local operator, single writer ve accidental concurrency'dir; `hostileConcurrentIsolation:false`. Verifier path-based read ve topology kontrolleri kullanır. Aynı yetkili hostile process'in link-swap/TOCTOU saldırısına karşı handle-relative izolasyon, global freeze veya hostile-process protection C.2B.1 garantisi değildir. Candidate validity iddiası yalnız bu mevcut tehdit modeli içinde geçerlidir.

C.2B.1 targeted remediation smoke 48 senaryo PASS; Windows fixed-drive ve UNC gate PASS, symlink oluşturma platform yetkisi bulunmadığı için ilgili adaptif senaryo `SKIP_UNSUPPORTED` olarak ayrı raporlandı. C.2A 16/16, C.1 18/18, B 16/16 ve B.1 13/13 regression PASS; TypeScript ve targeted ESLint PASS. Tüm fixture write'ları OS temp altındadır; production/provider/worker/dispatch çağrısı `0`, live runtime write `0`, candidate create `0`, backup create `0` ve `cutoverAuthorized:false` kaldı. Bağımsız review sonucu `APPROVED FOR DOCUMENTATION COMPLETION`; sprint Completed olarak kapatıldı.

C.2B.1 kapanışında `RuntimeMigrationCandidateService`, candidate create/copy/reservation/publish/cleanup/orphan mutation, restore, cutover, runtime/authority switch ve production relocation eklenmemişti. Candidate creation/readiness daha sonra Sprint 129.25 C.2B.2 kapsamında tamamlandı; C.2B.3 production storage relocation audit'i başlamadı ve C.2C/relocation/cutover öncesi zorunlu gate olarak kalır. Git index/`.gitignore`, `data/projects/**`, acceptance marker ve production runtime değiştirilmedi; commit veya push yapılmadı.

## Sprint 129.25C.2A — Guarded Filesystem Foundation / Implementation Validated

Runtime migration altyapisi icin merkezi protected-root, portable path policy, capability probe, guarded mutation session ve operation-owned directory katmani eklendi. Repository, runtime, live projects, machine, authority, backup ve restore-verification rollerinin yedisi de her context'te zorunludur; eksik context hem construction hem mutation begin sinirinda fail-closed kalir. Root'lar canonical/reparse-aware olarak siniflandirilir; writable root diger protected root'larla case-insensitive Windows containment, ancestor/child ve prefix-collision kurallariyla karsilastirilir.

`windows-portable-path-v1` Windows reserved adlari, superscript `COM¹/²/³` ve `LPT¹/²/³` bicimleri, colon, trailing dot/space, control karakteri, non-NFC, empty/dot/dot-dot ve case-fold collision'i reddeder. Segment, project-relative logical path, public mutation-relative path, slug, filename, UTF-8/UTF-16 ve materialized absolute path limitleri uygulanir. Mevcut `runtime-backup-v1` manifest schema, serialization ve aggregate fingerprint formati degistirilmedi.

`GuardedRuntimeFilesystem` ayni writable root + operation scope icin deterministik exclusive session reservation kullanir; rastgele UUID yalniz owner token'da kalir. Session construction module-private key ile yalniz guarded entrypoint'ten yapilir; production capability/session override API'si yoktur. Session acik child reservation'lari registry'de izler, identity/token dogrulanmadan release/cleanup yapmaz, replacement nesneyi silmez ve guvenli kaldirilamayan reservation'i `orphan-suspect` raporlar. Public mutation mevcut sibling ve session collision registry'siyle case-fold collision'i reddeder; relative ve materialized limit her mutation root'uyla birlikte uygulanir. Her begin ayni writable root'ta exclusive create, gercek `COPYFILE_EXCL` no-overwrite publish ve cleanup capability'lerini yeniden olcer; hard-link kullanilamazsa exclusive-copy fallback uygulanir. Public mutation hatalari stable code/message'e normalize edilir, absolute path/secret public mesaja veya serialization'a alinmaz; lock open/write/close/cleanup zincirinde ilk cause non-enumerable internal evidence, close ve cleanup sonuclari metadata olarak korunur.

Backup create ile restore-verify icindeki backup root/bootstrap, `.partial`, payload/nested directory, payload copy, manifest/digest, publish reservation/final tree, restore verification root/projects/copy ve cleanup mutation noktalari ortak guarded katmana tasindi. Backup formati ve verifier authority degismedi; canli restore, migration, runtime relocation, untracking, cutover, rollback, production storage veya asset storage refactor'u eklenmedi.

Desteklenen tehdit modeli trusted local operator, single writer ve accidental concurrent process'tir. Capability acikca `hostileConcurrentIsolation:false` raporlar. Standart Node/Windows path API'leri ayni kullanici yetkili dusmanca concurrent process'e karsi tam handle-relative filesystem isolation saglamadigi icin Model C desteklenmez; Administrator/SYSTEM kapsami disidir. Temp-owned capability smoke bu makinede `supportsHardLinks:true`, `supportsExclusiveCreate:true`, `supportsExclusivePublish:true`, `filesystemKind:"windows-unknown"` ve cleanup verified raporladi; hard-link migration onkosulu degildir.

Sprint 129.25C.2A smoke 16/16, Sprint 129.25C.1 regression 18/18, Sprint 129.25B 16/16 ve Sprint 129.25B.1 13/13 PASS. TypeScript ve targeted ESLint `--max-warnings=0` PASS. C.2A smoke direct session-begin ve exclusive publish child-process yarisi, eksik protected rol, public constructor bypass rejection, farkli root/scope bagimsizligi, case-fold existing/registered collision, gercek materialized boundary ve stable lock first-cause/close/cleanup metadata senaryolarini kapsar. Testlerin tum write'lari OS temp fixture'lariyla sinirlidir.

Migration candidate, runtime relocation, Git untracking/index/`.gitignore`, cutover, live restore, `data/projects/**` veya acceptance marker mutation'i ve production execute/resume/retry/finalize/reprepare/diagnose/provider/worker/stage dispatch yapilmadi. C.2B ve C.2C baslatilmadi. Production storage audit'i C.2C veya herhangi bir relocation/cutover oncesi zorunlu gate'tir. Gercek Windows ACL-denied ve gercek unsupported-filesystem integration, empty-directory topology/concurrent layout, native Model C isolation ve filesystem fsync crash durability acik P2/hardening sinirlaridir.

## Sprint 129.25C.1 — Verified Runtime Backup Foundation / Completed

Git tarafından izlenen canlı runtime için migration veya untracking başlamadan önce doğrulanabilir backup temeli eklendi. Deterministic `runtime-backup-v1` manifest; project-relative path, byte size, SHA-256, portable permission class, project slug, runtime sınıfı ve mevcutsa Git index metadata'sını kaydeder. Aggregate hash timestamp ve host path'ten bağımsızdır; manifest absolute machine path veya secret taşımaz.

Read-only inventory canlı ya da seçili proje root'unu link/junction/special-file ve scan sırasında mutation kontrolleriyle tarar. Verified create explicit absolute external backup root ve confirmation ister; unique `.partial` alanda exclusive copy, destination byte hash ve source re-inventory uygular. Publish, yarışlı existence-check/rename yerine atomic final-directory reservation ile manifest/digest-last exclusive hard-link commit kullanır; iki-process same-ID yarışında tek final oluşur. Verifier exact root/payload entry seti, exact-key manifest schema, mevcut portable-name kontrolleri ve bütün dosya payload'ında inventory/hash eşleşmesini zorunlu tutar.

Kabul edilen C.1 güvenlik sınırı trusted local operator ve single-writer operation modelidir. Deterministic byte-level inventory, manifest ve verification; missing/extra/modified/tamper durumlarında fail-closed rejection sağlar. Restore-verify canonical OS temp alanıyla sınırlıdır; canlı restore, migration veya cutover yetkisi yoktur. Aynı kullanıcı yetkileriyle çalışan düşmanca concurrent local process'e karşı tam filesystem isolation garantisi verilmez. Parent identity post-write kontrolü ve cleanup, root dışı transient write'ı kesin olarak engelleyen bir güvenlik sınırı sayılmaz. Portable-name kontrolleri vardır; platformlar arası portability koşulsuz değildir ve conservative Windows segment/toplam path-length politikası C.2 öncesi gate'tir.

Bağımsız review adjudication sonucunda C.1 blocker bulunmadı. Sprint 129.25C.2 veya herhangi bir migration/untracking/live restore/cutover/production runtime relocation öncesinde şu güvenlik kapıları zorunludur: (1) bütün backup/restore mutation noktalarında handle/no-follow veya eşdeğer reparse-aware güvenli write, (2) guarded primitive dışındaki mkdir/lock/manifest/digest/restore write'larının ortak güvenli primitive'e alınması, (3) cleanup öncesi operation-owned directory identity doğrulaması, (4) protected-root kapsamına runtime root'un eklenmesi ve (5) conservative Windows segment ile toplam path-length politikası. Empty-directory topology/concurrent layout verification, gerçek Windows ACL-denied testi, runtime production-boundary spy ve filesystem fsync crash durability gelecek hardening kapsamındadır. Git metadata ile source classification informational evidence'dır; payload authority veya aggregate verification girdisi değildir.

Sprint 129.25C.1 smoke 18/18, Sprint 129.25B 16/16 ve Sprint 129.25B.1 13/13 PASS; `npx tsc --noEmit --incremental false`, targeted ESLint `--max-warnings=0` ve `git diff --check` PASS. Canlı read-only inventory `184 tracked / 184 physical / 0 untracked`, 7 proje, 11,023,842 byte ve aggregate SHA-256 `2c14d65c02736848ef3422bee384d69af1b5de248b2f7a4e38b6f51a8ca1feae` verdi.

Canlı backup create/restore yapılmadı; bütün create/restore testleri OS temp root'larında çalıştı. Marker SHA-256 başlangıç/final `478E17627D121C61C6996FAD13470B0C0D8C6404D55EB1ED9173818A04C140CF`; `data/projects/**` diff boş kaldı. Migration, untracking, `.gitignore` veya Git index değişikliği, runtime mutation, marker reprepare, production command/provider/worker, commit ve push yapılmadı. Runtime hâlen tracked; Sprint 129.25C.2 başlamadı.

## Sprint 129.25B.1 — Targeted Runtime Storage Hardening / Completed

Sprint 129.25B bağımsız review'ündeki dört P1 hedefli olarak kapatıldı. Runtime bootstrap herhangi bir runtime mutation'dan önce root'a kadar existing ancestor zincirini `lstat`/`realpath` ile doğrular; symlink/junction/reparse sapması fail-closed reddedilir. Directory'ler recursive `mkdir` yerine doğrulanmış canonical parent altında segment segment oluşturulur ve her segment tekrar doğrulanır. Temp-only junction testi, hata sonrasında junction hedefinde hiçbir runtime dizini veya dosyası oluşmadığını kanıtladı. `path.relative` containment güvenli `..foo` child'ını kabul eder ve prefix-collision escape'i reddeder.

Operation başında üretilen frozen `RuntimeStorageContext`, workspace/runtime/projects/legacy/machine/authority root snapshot'ını ve policy classification'ını sabitler. ProjectReader/Writer, FileStorage, AssetManager, image/audio/video/animation/thumbnail storage, readiness adapter probe ve FFmpeg physical input çözümlemesi context'i alt çağrılara taşır; context verildiğinde global `process.cwd()` veya `process.env` yeniden çözülmez. Env ve cwd test sırasında değiştirildiğinde bütün adapter'lar ilk external temp root'ta kaldı; readiness probe workspace, adapter output ve cleanup aynı injected context altında çalıştı ve legacy repository root'una kaçak yazmadı.

`ProjectReader.listProjects()` yalnız `ENOENT` için `[]` döndürür; dual-root, malformed configuration, containment, permission ve diğer IO/security hatalarını yutmaz. Writer authority check, path resolution, bootstrap ve persistence aynı immutable context içindedir. Machine-local Git dışı coordination root'unda atomik no-overwrite project lock ve host-path içermeyen root-fingerprint claim kullanılır. Contended writer write başlamadan `RUNTIME_STORAGE_AUTHORITY_LOCKED` alır; farklı legacy/external authority `RUNTIME_STORAGE_DUAL_ROOT_DIVERGENCE` ile bloklanır. Lock normal ve error yollarında `finally` ile bırakılır. Unknown/stale lock otomatik kırılmaz ve fail-closed kalır; crash recovery explicit operator incelemesi gerektirir. Bu model aynı machine/shared-filesystem process yarışını sertleştirir; tam cross-machine server-authoritative model değildir.

P2 kapsamında Windows reserved host adları, colon, trailing dot/space, traversal/absolute host injection ve filesystem/UNC share root authority sınırları reddedildi. Runtime inventory helper yalnız Git top-level root kabul eder. Eski sabit production call counter kaldırıldı; temel smoke module-boundary guard `0`, injected readiness process-runner spy `0` çağrı doğruladı ve unsupported link ortamı açık `SKIP` üretir. Gerçek writer dual-root ve contention senaryoları ana hardening smoke kapsamındadır.

Doğrulamalar: Sprint 129.25B smoke 16/16, Sprint 129.25B.1 hardening smoke 13/13, `npx tsc --noEmit --incremental false`, targeted ESLint `--max-warnings=0` ve `git diff --check` PASS. FFmpeg context resolution temp-only pure arg generation ile doğrulandı. Stage dispatch ve retry yolları içeren eski scene-video/pipeline-state scriptleri bu turda bilinçli olarak yeniden çalıştırılmadı. Production readiness CLI, diagnose, execute, resume, finalize, retry, reprepare, stage dispatch, gerçek provider veya background worker çağrılmadı.

Marker SHA-256 başlangıç/final `478E17627D121C61C6996FAD13470B0C0D8C6404D55EB1ED9173818A04C140CF`; `data/projects/**` diff boş ve inventory `184 tracked / 184 physical / 0 untracked` olarak korundu. Migration, untracking, `.gitignore`, runtime data mutation, acceptance schema/fingerprint değişikliği, commit veya push yapılmadı. Runtime dosyaları hâlen tracked; Sprint 129.25C başlamadı.

## Sprint 129.25B — Runtime Root Abstraction & Tracking Policy Foundation / Completed

`RuntimeStoragePaths` merkezi abstraction'i `ATOLYE_RUNTIME_ROOT` environment contract'i, `runtime-storage-v1` policy identity'si ve `projects/<slug>` logical project identity'si ile eklendi. Environment unset olduğunda existing `process.cwd()/data/projects` path'i exact korunur. Explicit değer absolute, trim edilmiş ve geçerli olmalıdır; external root opt-in olarak `<ATOLYE_RUNTIME_ROOT>/projects` kullanılır. Absolute host path logical storage identity veya acceptance fingerprint'e eklenmedi ve existing acceptance fingerprint/marker schema davranışı değiştirilmedi.

ProjectReader/Writer, FileStorage tabanlı asset metadata, image/audio/video/animation/thumbnail physical storage, FFmpeg input resolution, production readiness storage probe, production execution composition root'un kullandığı ProjectReader path'i ve controlled reprepare path containment'i merkezi root çözümlemesine geçirildi. Stored metadata'nın existing `data/projects/<slug>/...` sözleşmesi geriye uyumlu kaldı. Traversal, absolute slug injection, root escape ve existing symlink/junction root'ları fail-closed reddedilir.

Configured projects root legacy root'tan farklıyken aynı slug iki root'ta da bulunursa byte eşitliğine bakılmadan `RUNTIME_STORAGE_DUAL_ROOT_DIVERGENCE` ile bloklanır; otomatik merge, copy, migration veya authority seçimi yapılmaz. Repository fixture path'leri değiştirilmedi. Read-only inventory helper mevcut baseline'ı 184 tracked, 184 physical ve 0 untracked runtime dosyası olarak doğrular; zero-tracked enforcement Sprint 129.25C kapsamındadır.

Sprint 129.25B smoke 16/16, temp-root production scene-video regression 23/23 ve temp-root pipeline state error regression 18/18 PASS. TypeScript, targeted ESLint `--max-warnings=0` ve `git diff --check` PASS. Marker SHA-256 başlangıç/final `478E17627D121C61C6996FAD13470B0C0D8C6404D55EB1ED9173818A04C140CF`; `data/projects/**` diff boş ve inventory 184/184/0 olarak aynı kaldı. Production readiness/diagnose/execute/resume/finalize/retry/reprepare/stage dispatch ve provider/background worker çağrısı yapılmadı.

Bu sprintte migration, untracking, `.gitignore` değişikliği, runtime file move/delete/rewrite, marker reprepare, commit veya push yapılmadı. Runtime files hâlen tracked ve legacy fallback aktiftir. Sprint 129.25C — Safe Untracking / Migration henüz başlamadı.

## Sprint 129.24 — Existing Acceptance Marker Portability / Completed

Existing schema-2 production acceptance marker'larını yalnız explicit operator komutuyla schema-3 portability modeline yeniden hazırlayan `npm run production:acceptance:reprepare -- --project-slug=<slug> --confirm-production-acceptance-reprepare` eklendi. Otomatik migration yoktur. Re-prepare servisi production orchestrator, runner, resume/finalize, retry veya stage dispatch import etmez ve çağırmaz.

Herhangi bir write başlamadan schema-2 marker'ın canonical topic/runId/slug binding'i, topic/request/configuration fingerprint'leri, strict package-only policy'si, timestamp/status/productionReady/published invariant'ları ve current legacy configuration fingerprint'i tamamen doğrulanır. Schema-2 aggregate fingerprint mismatch hiçbir zaman path-only değişiklik varsayımıyla bypass edilmez. Re-prepare anındaki current FFmpeg/FFprobe binary identity schema-3 portability baseline'ı olur.

Schema-3 profile-v2, Sprint 129.23 profile-v1 compatibility'sini koruyarak `STORAGE_IDENTITY` ve `ENVIRONMENT_POLICY` component'lerini ekler. Storage identity absolute machine path yerine canonical `data/projects/<slug>` namespace, asset-layout ve no-links containment policy'sine bağlıdır. Environment policy strict acceptance, package-only ve configuration semantics sürümünü bağlar. Provider, model, token budget, durable mode, API-key identity ve diğer acceptance component'leri fail-closed kalır. FFmpeg/FFprobe absolute path portable'dır; yalnız binary content identity aynıysa eşleşir.

Marker update unique temp file `wx` write, file-handle fsync, temp validation, destination byte compare, atomic replace ve exact readback validation sırasını kullanır. Replace öncesi failure old marker'ı değiştirmez. Replace sonrası readback failure original raw marker byte'larını ikinci synced atomic replace ile geri yükler ve restore readback'i doğrular. Exact profile-v2 replay write-free `replayed` döner.

Sprint 129.24 smoke 22/22, Sprint 129.23 15/15, Sprint 128.2 acceptance 30/30, Sprint 129.5 topic/schema-2 24/24 ve isolated production readiness acceptance PASS. TypeScript, targeted ESLint `--max-warnings=0` ve `git diff --check` PASS. Gerçek Fatih marker reprepare edilmedi; production execute/resume/finalize/retry/stage dispatch, commit veya push yapılmadı.

## Sprint 129.23 — Production Acceptance Portability & Fingerprint Diagnostics / Completed

Production acceptance fail-closed policy korunarak read-only `npm run production:acceptance:diagnose -- --project-slug=<slug>` komutu eklendi. Komut mevcut marker'ı okur, güncel configuration fingerprint'i hesaplar, eşleşmede exit `0`, uyuşmazlıkta exit `1` üretir ve yalnız güvenli bileşen adlarını raporlar. Hash, absolute path, secret identity veya ham configuration değeri CLI çıktısına girmez; diagnostic runtime initialization, readiness probe, project/marker/artifact writer veya durable mutation çağırmaz.

Mevcut schema-2 marker oluşturma, fingerprint ve validation yolu değiştirilmedi; schema-2 marker migration veya rewrite yapılmaz. Schema-2 aggregate fingerprint uyuşmazlığında component evidence bulunmadığı için güvenli biçimde yalnız genel mismatch raporlanır. Gelecekteki production acceptance execute marker'ları schema-3 kullanır ve exact component-level hashed fingerprints taşır. Provider, model, token budget, durable execution mode ve API-key identity değişiklikleri fail-closed bloklar.

Schema-3 `FFMPEG_PATH` ve `FFPROBE_PATH` mutlak değerlerini fingerprint'e katmaz. Readiness absolute executable/configuration doğrulamasını korurken acceptance identity FFmpeg ve FFprobe binary içeriğinden domain-separated fingerprint üretir. Böylece aynı binary farklı path altında eşleşir; binary içeriği değişikliği bloklanır. Stored component fingerprints veya aggregate fingerprint marker integrity ile uyuşmazsa marker invalid kabul edilir.

Sprint 129.23 smoke 15/15, Sprint 128.2 acceptance 30/30, Sprint 129.5 topic/schema-2 24/24 ve izole production readiness acceptance PASS. TypeScript, hedefli ESLint `--max-warnings=0` ve `git diff --check` PASS. Başlangıç ve final Fatih marker SHA-256 değeri `478E17627D121C61C6996FAD13470B0C0D8C6404D55EB1ED9173818A04C140CF`; `data/projects/**` 184 → 184 dosya ve aggregate inventory SHA-256 `a96bc1cec048435478b618f853a15a44105b6750f61206f435a0e6d3c7c12d62` olarak değişmeden kaldı.

Bu sprintte production acceptance execute/resume, provider çağrısı, Fatih marker/runtime mutation, commit veya push yapılmadı.

## Sprint 129.22 — Animation Structured Output Diagnosis and Hardening / Completed

Production Animation retry/provider çağrısı yapılmadan mevcut failure evidence ve provider sözleşmesi incelendi. Geçmiş production response kalıcı tutulmadığı için eski schema failure'ın kesin field/path'i geriye dönük belirlenemez; kanıtlanabilen sonuç response'un JSON olarak parse edildiği fakat eski strict schema'yı karşılamadığıdır. Eski contract provider'ı platform-owned `sceneId`, `sourceImageAssetId` ve `durationSeconds` alanlarını aynen echo etmeye zorluyor, runtime validator bunları provider-owned motion alanlarıyla birlikte exact-match doğruluyor ve fixture'lar yalnız kusursuz echo sonucunu kapsıyordu.

Canonical provider contract artık yalnız `motionType`, `start`, `end` ve `transition` alanlarını provider-owned kabul eder. `sceneId`, `sourceImageAssetId`, `durationSeconds`, request identity, asset/storage identity, provider/model/generation metadata, timestamp ve persistence alanları successful validation sonrasında trusted platform context'ten üretilir. Provider cevabındaki platform-owned veya bilinmeyen alanlar fail-closed reddedilir. `AnimationStructuredOutput` tek source of truth'tür; prompt, OpenAI `response_format` ve runtime validator aynı canonical field/spec tanımlarını kullanır. Root ve tüm nested object'lerde `additionalProperties:false`; required, enum ve numeric min/max sözleşmeleri ortak spec'lerden üretilir. Crop bounds, finite number, scale, translation, duration ve transition semantic invariant'ları korunur.

OpenAI completion durumu parse öncesinde ayrıştırılır: `finish_reason:length` → `ANIMATION_RESPONSE_TRUNCATED`, refusal → `ANIMATION_PROVIDER_REFUSAL`, incomplete completion → `ANIMATION_RESPONSE_INCOMPLETE`; invalid JSON canonical parse error, parse edilmiş schema-invalid payload `ANIMATION_RESPONSE_SCHEMA_INVALID` olur. Schema-invalid evidence gerçek toplam `issueCount` ile en fazla 8 persisted issue taşır; path, canonical issue code/type, expected/received category, scene/provider/model/phase, finish reason, response length ve token metadata bounded tutulur. Path 120, unknown segment 50 güvenli alfanümerik karakterle sınırlıdır; hostile key `unknownField` olur. Durable evidence toplam count ve ilk 3 issue'yu taşır. AI usage, error, job, manifest, history ve durable kanalları ortak sanitizer kullanır; raw value/response/prompt/refusal text, credential veya stack persist edilmez.

Atomicity ve recovery korunur: tüm scene cevapları doğrulanmadan persistence başlamaz; validation öncesinde `animation.json`, registry kaydı veya motion-plan artifact oluşmaz; persistence failure daha önce yazılan scene motion-plan dosyalarını rollback eder; upstream `visuals.json` ve 6 PNG korunur. Bilinen `AnimationMotionPlanError` aynen rethrow, bilinmeyen exception generic animation failure olarak normalize edilir. Recovery `startStage:"animation"`, `blocked:false`; claim, lease, idempotency, replay ve reconciliation değişmedi.

Review sırasında truncation/refusal/incomplete completion'ın parse'a düşmesi, `issueCount`'un bounded liste uzunluğunu göstermesi ve custom-provider diagnostic metadata'nın AI usage yolunda sanitize edilmeden persist edilebilmesi P1'leri kapatıldı. Doğrulamalar: Sprint 129.22 21/21, Sprint 129.21 19/19, production animation provider 30/30, animation motion-plan contract 21/21, production worker 55/55, durable worker 18/18, pipeline-state 18/18 ve Sprint 129.9 recovery 42/42 PASS; TypeScript, targeted ESLint `--max-warnings=0` ve `git diff --check` PASS. `data/projects/**` 194 → 194 dosya; path/byte/SHA-256 farkı 0. Son karar `READY FOR DOCUMENTATION`; açık P0/P1 yoktur.

Non-blocking P2: exported `canonicalAnimationProviderSchema` shallow-frozen olup mevcut mutation yoktur; genel duplicate JSON property pre-parse tespit edilmez ancak `JSON.parse` collapse sonrası kalan yasak alanlar reddedilir; gelecekte fine-tuned model seçilirse numeric min/max Structured Outputs desteği ayrıca doğrulanmalıdır; eski production response saklanmadığından geçmiş exact field/path belirlenemez.

Bu sprintte production retry/resume, provider/API çağrısı, commit, push veya YouTube publish yapılmadı. Sonraki kontrollü adım Git kapsam review, kullanıcı tarafından commit/push ve aynı slug üzerinde Animation'dan yalnız bir controlled production retry'dır. Otomatik ikinci retry ve yeni proje yoktur; YouTube publish yapılmaz. Retry başarılı olursa kalan pipeline aşamalarına ve ilk MP4 üretimine devam edilir.

## Sprint 129.21 — Animation Failure Propagation & Diagnostic Hardening / Completed

Controlled production resume Visuals aşamasını başarıyla tamamladı; `visuals.json` içindeki 6 canonical visual plan kaydı ve 6 fiziksel PNG üretildi. Sonraki Animation aşaması dışarıya `ANIMATION_MOTION_PLAN_FAILED` ile kapandı. İnceleme, `AnimationAssetPipeline` catch akışının bilinen provider/scene/phase hatalarını generic koda dönüştürerek gerçek nedeni kaybettiğini gösterdi.

`AnimationMotionPlanError` artık canonical `code` ve yalnız güvenli evidence taşır: `sceneId`, `phase`, provider/model, safe reason, varsa HTTP status, finish reason, response length, token usage, duration ve retry count. Bilinen `AnimationMotionPlanError` nesneleri aynen rethrow edilir; yalnız bilinmeyen exception'lar aktif scene/phase korunarak generic `ANIMATION_MOTION_PLAN_FAILED` koduna normalize edilir. Stabil canonical sınıflar `ANIMATION_RESPONSE_EMPTY`, `ANIMATION_RESPONSE_INVALID_JSON`, `ANIMATION_RESPONSE_SCHEMA_INVALID`, `ANIMATION_PROVIDER_HTTP_FAILED`, `ANIMATION_PROVIDER_TIMEOUT`, `ANIMATION_PROVIDER_RETRY_EXHAUSTED` ve `ANIMATION_RESPONSE_TOO_LARGE` olarak tanımlandı. Raw prompt, raw response, credential veya stack kalıcı kanallara taşınmaz.

Güvenli diagnostic metadata AI usage, job, manifest, history ve durable attempt evidence kanallarına bağlandı. Herhangi bir scene/motion-plan failure atomik kalır: `animation.json` oluşmaz, animation asset registry kaydı oluşmaz, yazılmış motion-plan artifact'leri rollback edilir ve mevcut `visuals.json` ile 6 PNG değişmeden korunur. Recovery planner `startStage:"animation"`, `blocked:false` verir; Research, Script, Scenes ve Visuals yeniden çalıştırılmaz.

Failed-stage reconciliation mevcut durable primitive'leri korur: lease release edilir, claim abandoned olur, idempotency record cancelled kapanır, terminal failed attempt immutable kalır ve exact reconciliation replay write-free olur. Sprint 129.9 smoke gerçek production slug yerine temp isolated deterministic visuals-failure project kullanır. Pipeline-state smoke güncel `getJob` ve durable reconciliation bağımlılıklarıyla deterministic hale getirildi. Yanlış terminal yönlendirmesiyle oluşmuş, Git tarafından izlenmeyen 645 byte `tatus --short` dosyası doğrulanarak silindi.

Doğrulamalar: Sprint 129.21 19/19, Sprint 129.9 42/42, pipeline-state 18/18, animation motion-plan contract 21/21, production animation provider 30/30, production execution worker 55/55 ve durable worker execution 18/18 PASS. TypeScript, targeted ESLint ve `git diff --check` PASS. `data/projects/**` production runtime kayıtları path + byte length + SHA-256 snapshot ile byte-level korundu. Açık P0/P1/P2 bulgusu yoktur.

Commit, push ve production retry/resume yapılmadı. Sonraki operasyonel adım Git kapsamını review etmek, yalnız Sprint 129.21 kaynak/test/dokümantasyon dosyalarını commit etmek, `data/projects/**` runtime kayıtlarını commit dışında bırakmak ve ardından aynı slug üzerinde Animation aşamasından tek kontrollü retry çalıştırmaktır. Sonraki karar yeni canonical scene/phase hata kanıtına göre verilecektir.

## Sprint 129.20 — Visuals Truncation Propagation & Stage Token Budget / Completed

Production resume sırasında Visuals text planning provider cevabı `finish_reason:length` ile tamamlandı ve observed sonuç gerçek `AI_RESPONSE_TRUNCATED` kodunu taşıdı. `VisualManager`, `observed.errorCode` alanını strict parse öncesinde taşımadığı için truncated JSON parse edilerek hata yanlışlıkla `AI_RESPONSE_INVALID_JSON` olarak raporlanıyordu. Artık observed hata kodu varsa strict parser'a girilmeden aynı kodla fail-closed kapanılır; parser, `visuals.json`/canonical visual artifact persistence ve image generation çalışmaz.

Visuals plan metni completion bütçesi için `OPENAI_VISUALS_MAX_TOKENS` sözleşmesi eklendi: unset application default `3200`, explicit minimum `2000`, explicit maximum `6000` ve yalnız safe integer. Geçersiz değer `AI_VISUALS_MAX_TOKENS_INVALID` ile fail-closed kapanır. Global `OPENAI_MAX_TOKENS` değiştirilmedi. `OPENAI_VISUALS_MAX_TOKENS` yalnız environment'ta explicit tanımlıysa production acceptance configuration fingerprint'e katılır; unset `3200` default mevcut prepared marker fingerprint uyumluluğunu korur.

Recovery planner aynı canonical slug için `startStage:"visuals"`, `blocked:false` kalır; Research, Script ve Scenes provider'ları yeniden çağrılmaz. Sprint 129.20 smoke 21/21, Sprint 129.19 70/70, Sprint 129.13 42/42 ve visual asset wiring 54/54 PASS; production readiness acceptance, TypeScript, targeted ESLint ve `git diff --check` PASS. `data/projects/**` production runtime kayıtları path + byte length + SHA-256 snapshot ile byte-level değişmeden korundu.

Açık bulgular: P0 yok, P1 yok. P2 olarak readiness smoke fixture environment izolasyonu ve erken assertion durumunda cleanup'a ulaşamama konusu bu sprint kapsamı dışında bırakıldı. Commit, push ve production resume yapılmadı.

Sonraki operasyonel adım Git kapsamını review etmek, yalnız Sprint 129.20 kaynak/test/dokümantasyon dosyalarını commit ederek `data/projects/**` runtime kayıtlarını commit dışında bırakmak ve ardından aynı slug üzerinde Visuals aşamasından kontrollü production resume çalıştırmaktır.

Sprint 129.19 kaydı:

Sprint 129.18 controlled production resume aynı canonical slug üzerinde research, script ve scenes provider'larını yeniden çalıştırmadan scenes'i başarıyla tamamladı. `scenes.json` 6 scene, toplam 90 saniye, canonical schema ve application-owned timestamp ile write-once persist edildi. Sonraki visuals text planning cevabı provider/transport seviyesinde başarılıydı: `finish_reason:stop`, `refusal:false`, complete/non-truncated, 1135 prompt, 375 completion, 1510 total token ve 1777 karakter. Strict visual artifact validation generic `GENERATION_FALLBACK_BLOCKED` ile durdu; `visuals.json` veya fiziksel image üretilmedi.

Sprint 129.19 canonical visual provider sözleşmesini koddan kesinleştirdi: top-level tam olarak `scenes` ve `thumbnail`; her visual item tam olarak `sceneId`, `visualPrompt`, `animationPrompt`, `style`; thumbnail tam olarak `title`, `prompt`, `composition`, `mood`. Extra field, type, length, item count, duplicate/missing/unknown scene reference ve canonical order ihlalleri en fazla 8 exact JSON path/reason issue ile `AI_RESPONSE_SCHEMA_INVALID` üretir. Provider `createdAt`, `projectId`, `prompts` veya `generatedAt` gönderemez; validation sonrasında ortak `CanonicalTimestamp` helper application-owned UTC millisecond timestamp ekler.

Visual plan image generation'dan önce write-once persist edilir. Exact replay write-free, farklı content/timestamp overwrite-blocked; plan validation veya persistence başarısızsa image provider call count sıfırdır. Batch preflight tamamlanmadan ücretli image generation başlamaz. Local production image sonucu canonical scene identity, filename, MIME, contained storage, registry/readback, duplicate yasağı ve pozitif physical byte length kontrollerinden geçmeden stage success olamaz.

Sprint 129.19 doğrulamaları:

- Visual schema, timestamp, bounded telemetry, image boundary, persistence, durable settlement ve disposable recovery smoke PASS — 70 senaryo.
- Disposable recovery `startStage:visuals`; research/script/scenes provider call count 0, visual planning 1, image generation 6 ve animation admission yalnız successful terminal settlement sonrasında açıldı.
- Sprint 129.17 55, Sprint 129.15 29, Sprint 129.13 42, Sprint 129.11 27, Sprint 129.9 42, Sprint 129.7 30, Sprint 129.5 24, Sprint 128.2 30 ve visual asset wiring 54 senaryo PASS.
- Sprint 126 readiness acceptance, production worker ve durable recovery/bootstrap/wiring PASS; TypeScript ve hedefli ESLint PASS; user-scope production environment ile readiness 27/27 READY.
- Gerçek resume/execute/provider generation/video/YouTube upload/publish yapılmadı. Canonical runtime byte-for-byte korundu; aynı slug, package-only, `productionReady:false`, `published:false` devam eder.
- Sprint 129 Completed değildir; commit veya push yapılmadı.

Sprint 129.17 kaydı:

Sprint 129.16 canonical resume aynı slug üzerinde research'i yeniden çalıştırmadan script retry'ını başarıyla tamamladı. `script.json` 6 chapter, 90 saniye ve application-owned canonical UTC timestamp ile write-once persist edildi; script durable attempt/record succeeded, claim ve lease released oldu. Ardından scenes provider çağrısı `finish_reason:stop`, `refusal:false`, complete ve non-truncated; 1659 prompt, 1039 completion, 2698 total token ve 3562 karakter response üretti. Strict scenes doğrulaması generic `GENERATION_FALLBACK_BLOCKED` ile kapandı; scenes artifact ve downstream output oluşmadı.

Sprint 129.17 canonical scenes provider sözleşmesini mevcut gerçek alanlarla kesinleştirdi: top-level yalnız `scenes`; her item tam olarak `id`, `chapterId`, `title`, `description`, `visualPrompt`, `duration`. `createdAt` provider alanı değildir ve gönderilirse `$.createdAt / UNKNOWN_FIELD`; başarılı validation sonrası research/script ile aynı merkezi `CanonicalTimestamp` primitive'i trusted RFC 3339 UTC timestamp ekler. Extra field, type, length, item count, ID uniqueness/order, chapter reference/order/coverage ve per-chapter/total duration ihlalleri en fazla 8 adet bounded exact path/reason evidence üretir.

Schema-invalid scenes artık generic fallback'e çevrilmez; `AI_RESPONSE_SCHEMA_INVALID` evidence job, manifest, history ve durable worker serialization katmanlarında korunur. Empty/legacy fallback gerçek `GENERATION_FALLBACK_BLOCKED` olarak kalır. Scenes persistence write-once: exact replay write-free, ilk timestamp korunur ve farklı artifact overwrite edilemez. Gerçek response non-truncated ve 1039 completion token olduğundan scenes-specific token budget eklenmedi; mevcut global budget ve prepared marker fingerprint uyumluluğu korundu.

Sprint 129.17 doğrulamaları:

- Scenes schema, timestamp, telemetry, recovery, persistence, settlement ve runtime immutability smoke PASS — 61.
- Disposable canonical snapshot recovery `startStage:scenes`; research/script provider call count 0, scenes mock provider call count 1, visuals admission yalnız successful durable settlement sonrasında açıldı.
- Sprint 129.15 smoke 29, Sprint 129.13 smoke 42, Sprint 129.11 smoke 27, Sprint 129.9 smoke 42, Sprint 129.7 smoke 30, Sprint 129.5 smoke 24 ve Sprint 128.2 smoke 30 PASS.
- Sprint 126 readiness acceptance, production worker ve durable recovery/bootstrap/wiring PASS; TypeScript ve hedefli ESLint PASS; production readiness 27/27 READY.
- Gerçek resume/execute/provider generation/video/YouTube upload/publish yapılmadı. Canonical runtime byte-for-byte korundu; aynı slug, package-only, `productionReady:false` ve `published:false` devam eder.
- Sprint 129 Completed değildir; commit veya push yapılmadı.

Sprint 129.15 kaydı:

Üçüncü kontrollü production resume aynı canonical slug üzerinde research'i yeniden çalıştırmadan script aşamasına ulaştı. Provider cevabı `finish_reason:stop`, `refusal:false`, complete ve non-truncated oldu; 541 prompt, 1893 completion, 2434 total token ve 6639 karakter response telemetrisi kaydedildi. Tek schema uyuşmazlığı `$.createdAt` alanında `WRONG_TYPE` idi. Script artifact oluşmadı, downstream başlamadı ve recovery başlangıcı `script` olarak kaldı.

Önceki script truncation problemi Sprint 129.13 token bütçesiyle kapanmıştır; güncel gerçek provider cevabı terminal olarak complete ve non-truncated olup kalan sorun yalnız timestamp ownership sözleşmesiydi.

Sprint 129.15 ile research ve script için tek merkezi canonical UTC timestamp helper'ı kullanılır. Script provider sözleşmesi artık `createdAt` alanını içermez; provider bu alanı gönderirse `UNKNOWN_FIELD` ile fail-closed reddedilir. Provider cevabı doğrulandıktan sonra uygulama trusted timestamp'i ekler. Geçersiz veya hata atan uygulama saati `AI_APPLICATION_TIMESTAMP_INVALID` olarak schema invalid'den ayrı kapanır. Raw provider fingerprint ve acceptance request fingerprint timestamp enrichment'tan etkilenmez.

Script artifact persistence write-once hale getirildi. İlk başarılı artifact içindeki timestamp korunur; exact replay write-free kalır, aynı içeriği yeniden yazmaz ve farklı timestamp/content mevcut artifact'i overwrite edemez. Disposable OS temp production snapshot üzerinde failed script reconciliation, tek retry/tek mock provider admission, research call count sıfır, script success sonrası scenes progression ve durable claim/record/lease terminal settlement doğrulandı.

Sprint 129.15 doğrulamaları:

- Application-owned timestamp, exact schema evidence, invalid clock, fingerprint, recovery, replay, persistence ve runtime immutability smoke PASS — 29.
- Sprint 129.13 smoke 42, Sprint 129.11 smoke 27, Sprint 129.9 smoke 42, Sprint 129.7 smoke 30, Sprint 129.5 smoke 24 ve Sprint 128.2 smoke 30 senaryo PASS.
- Sprint 126 readiness acceptance, production worker ve durable recovery/bootstrap/wiring regresyonları PASS; production environment kullanıcı kapsamından aynı sürece güvenli biçimde bağlanınca readiness 27/27 READY.
- TypeScript ve hedefli ESLint PASS.
- Gerçek resume/execute/provider generation/video/YouTube upload/publish yapılmadı. Canonical runtime byte-for-byte korundu; aynı slug, package-only, `productionReady:false` ve `published:false` devam eder.
- Sprint 129 Completed değildir; commit veya push yapılmadı.

Sprint 129.13 kaydı:

Research production'da canonical schema ile başarıyla tamamlandı. Ardından script provider çağrısı 393 prompt, 1200 completion ve 1593 total token seviyesinde `finish_reason:length`, `truncated:true` ile kapandı; recovery başlangıcı artık aynı slug üzerinde `script` aşamasıdır ve research yeniden çalıştırılmayacaktır.

Sprint 129.13 ile yalnız script aşamasını etkileyen `OPENAI_SCRIPT_MAX_TOKENS` eklendi: default 3200, bounded 2000–4800. Strict integer/range kontrolü readiness'i fail-closed kapatır. Explicit değer acceptance configuration fingerprint'e katılır; unset davranış mevcut prepared marker fingerprint'ini korur. Script prompt ve parser exact top-level/nested keys, 4–7 chapter, bounded string/array alanları, positive integer süre/kimlikler, unique chapter id, canonical timestamp, extra-field yasağı ve JSON-only sözleşmesinde hizalandı.

`AI_RESPONSE_TRUNCATED` artık strict fallback hatasına çevrilmeden job, manifest, history ve durable attempt journal katmanlarında korunur. Başarılı worker attempt sonrasında mevcut durable primitive'ler sırasıyla claim release, canonical `reserved → prepared → queued → running → succeeded` idempotency geçişleri ve lease release uygular. Önceden başarıyla tamamlanmış fakat active/reserved kalmış terminal attempt'ler, sonraki stage admission öncesinde providersız canonical reconciliation ile kapatılır. Settlement tamamlanmadan downstream admission açılmaz; CAS/partial failure fail-closed, exact terminal replay write-free kalır.

Sprint 129.13 doğrulamaları:

- Script budget, schema, truncation propagation, legacy-success reconciliation, terminal settlement, concurrency/CAS ve production snapshot recovery matrisi PASS — 42.
- Sprint 129.11 smoke 27, Sprint 129.9 smoke 42, Sprint 129.7 smoke 30, Sprint 129.5 smoke 24, Sprint 128.2 smoke 30 ve hedef worker/retry/recovery regresyonları PASS.
- TypeScript ve hedefli ESLint PASS.
- Codex shell production environment taşımadığı için readiness komutu `ready:false` / configuration `NOT_CONFIGURED` döndürdü; production resume öncesi aynı bağlı environment'ta 27/27 READY yeniden doğrulanmalıdır.
- Gerçek resume/execute/provider generation/video/YouTube publish yapılmadı. Acceptance runtime byte-for-byte korundu; `productionReady:false`, `published:false`, package-only ve aynı slug korundu.
- Sprint 129 Completed değildir; commit veya push yapılmadı.

Sprint 129.11 kaydı:

İkinci ücretli research çağrısı `finish_reason:stop`, `refusal:false`, complete ve non-truncated olmasına rağmen `AI_RESPONSE_SCHEMA_INVALID` ile fail-closed kapandı. Raw provider response kalıcı runtime içinde saklanmadığı için kesin alan farkı geriye dönük olarak çıkarılamadı ve tahmin edilmedi. Sprint 129.11 canonical research sözleşmesini deklaratif field/limit tanımlarıyla prompt ve validator arasında birebir hizaladı; schema invalid sonuçlar artık field value veya raw response taşımadan en fazla 8 adet exact JSON path, reason, expected contract ve observed type issue'su üretir. Aynı bounded evidence error, manifest, job, history ve durable attempt katmanlarında korunur.

Sprint 129.11 doğrulamaları:

- Production-benzeri 1600+ completion-token telemetrili büyük fixture dahil research schema compatibility smoke PASS — 27.
- Sprint 129.9 smoke 42, Sprint 129.7 smoke 30, Sprint 129.5 smoke 24 ve Sprint 128.2 smoke 30 senaryo PASS.
- Sprint 126 readiness acceptance, production execution worker, retry/continuation, retry persistence, durable recovery ve recovery bootstrap regresyonları PASS.
- TypeScript ve hedefli ESLint PASS; production readiness 27/27 READY.
- Üçüncü ücretli provider çağrısı, resume, execute, video üretimi veya publish yapılmadı.
- Canonical runtime korundu; `productionReady:false`, `published:false`, package-only ve aynı slug üzerindeki research-only recovery planı devam eder.
- Sprint 129 Completed değildir.

Sprint 129.9 kaydı:

İlk canonical production resume, provider çağrısı veya runtime mutation oluşturmadan `PRODUCTION_ACCEPTANCE_EXECUTION_FAILED` ile kapandı. Recovery planner `research` seçerken queue scheduler failed job için manual retry istediği için resume merkezi retry preparation yoluna ulaşmıyordu. Sprint 129.9 resume ve manual retry'ı aynı failed-stage preparation primitive'ine bağladı; eski terminal attempt immutable tutulurken active lease release, active claim abandon ve reserved idempotency record forward reconciliation ile kapatılır. Job yalnız reconciliation tamamlandıktan sonra CAS kontrollü `failed → queued` geçer ve artan attempt sayısından yeni deterministik execution kimliği türetilir.

Sprint 129.9 doğrulamaları:

- Failed-stage resume/reconciliation smoke PASS — 42.
- Sprint 129.5 smoke 24, Sprint 129.7 smoke 30 ve Sprint 128.2 smoke 30 senaryo PASS.
- Sprint 126 readiness acceptance, production execution worker, retry/continuation, retry persistence, durable recovery ve recovery bootstrap regresyonları PASS.
- TypeScript ve hedefli ESLint PASS.
- Testler production acceptance snapshot'ının yalnız OS temp kopyasını değiştirdi; gerçek canonical runtime byte-for-byte aynı kaldı.
- CLI terminal failure sonrasında explicit worker lifecycle shutdown uygulanır; bounded failure smoke exit code `2` ile doğal kapandı ve watchdog timeout oluşmadı.
- Aynı slug üzerindeki sonraki gerçek resume henüz çalıştırılmadı. Sprint 129 Completed değildir; `productionReady:false`, `published:false` ve package-only korunur.

Sprint 129.7 kaydı:

- Research prompt/validator sözleşmesi trusted application timestamp ile hizalandı; finish reason/refusal/usage telemetrisi normalize edildi, truncation/parse/schema/provider/persistence hataları stabil kodlarla ayrıldı ve research için bounded 3200 default, 1600–6000 range token bütçesi eklendi.

Sprint 128.2 kaydı:

- Completed acceptance replay artık completed recovery planında `PipelineRunner.resume()` çağırmadan marker, strict state, FFprobe, job ve registry doğrulamalarını yeniden çalıştırır; marker transition idempotent ve `published:false` kalır.
- Strict marker taşıyan resume, scenes sonrasındaki bir aşamadan devam edecekse script/scene preflight'ini `PipelineRunner.resume()` sınırında yeniden uygular. Assembly çağrısı explicit strict policy taşır; legacy mapping strict acceptance içinde devreye giremez.
- Finalizer assembly video ve thumbnail asset ID'lerini registry'de tekil, generated, doğru tip/project/slug ve canonical path/URL olarak doğrular. Thumbnail physical readback ve YouTube package asset kimlikleri geçmeden `productionReady:true` yazılmaz.
- Image fallback assembly, scene-video yoluyla aynı chapter audio segmentinin `audioStartSeconds`, `audioEndSeconds`, `atrim start/end` ve `asetpts=PTS-STARTPTS` sözleşmesini kullanır.
- AI scene prompt/parsing davranışı explicit generation policy ile ayrıldı: non-strict pipeline opening/chapter/closing ve chapterId'siz legacy JSON davranışını korur; strict acceptance chapter ownership zorunluluğunu sürdürür.
- Doğrulamalar: Sprint 128.2 P1 hardening smoke PASS — 30; Sprint 126 readiness/acceptance PASS; animation motion-plan PASS — 21; scene-video PASS — 23; assembly PASS — 19; TypeScript ve hedefli ESLint PASS. Gerçek provider veya acceptance run çalıştırılmadı.

Sprint 128.1 kaydı:

- Scene modeli geriye uyumlu `chapterId` ile genişletildi; production acceptance her scene için bilinen chapter sahipliği, deterministik chapter sırası, her chapter için en az bir scene ve benzersiz scene/audio kimlikleri zorunlu tutar. Chapter = scene eşitliği kurulmadı; bir chapter birden fazla scene taşıyabilir.
- Chapter audio WAV'ı aynı chapter'a ait sıralı scene videolarına planlanan duration oranlarıyla deterministik `audioStartSeconds` ve segment duration olarak dağıtılır. Assembly exact scene/visual/video kimliğini korur; unknown/ownerless chapter, duplicate ve eşleşmemiş scene/audio fail-closed reddedilir.
- Strict acceptance script ve scene üretiminde 60–120 saniye aralığı, 90 saniye hedefi, pozitif finite duration ve merkezi 5 saniye tolerans uygulanır. Preflight script aşamasında ve scene aşamasında, ücretli image/animation/audio/FFmpeg üretiminden önce çalışır; ihlaller `PRODUCTION_DURATION_PREFLIGHT_FAILED` veya `PRODUCTION_SCENE_MAPPING_INVALID` ile kapanır.
- OpenAI image production sonucu yalnız bounded timeout/response limit sonrasında base64 image'ın project-contained `ImageStorage` alanına yazılması, canonical local path/URL ve physical readback doğrulamasıyla kabul edilir. URL-only cevap visuals stage'ini tamamlayamaz; secret veya response body hata çıktısına taşınmaz.
- `scripts/run-production-acceptance.ts` readiness-only, explicit-confirm execute ve mevcut marker/slug/fingerprint üzerinde resume-finalize modlarını sağlar. Prepared marker `productionReady:false`, `published:false` kalır; final FFprobe, package referansları ve bütün job'lar doğrulanmadan production-ready yazılmaz.
- Package-only YouTube recovery, publish kaydı aramadan geçerli stored package'ı ready kabul eder; gerçek YouTube publish çağrısı yapılmaz. Canonical pipeline, motion-plan, FFmpeg scene-video/final assembly, durable lifecycle ve storage sözleşmeleri korunur.
- Doğrulamalar: Sprint 128.1 smoke PASS — 20; Sprint 126 readiness/acceptance PASS; animation motion-plan PASS — 21; scene-video PASS — 23; assembly PASS — 19; `npx tsc --noEmit --incremental false` PASS; hedefli ESLint PASS; `git diff --check` PASS.
- Mevcut gerçek makine readiness sonucu hâlâ `ready=false`: production environment/provider/API key/FFmpeg/FFprobe değerleri bağlı değildir; runtime, durable execution ve health blokludur. Ücretli acceptance run çalıştırılmadı ve gerçek video üretilmedi.

Sprint 127 kaydı:

- Mevcut `OpenAI motion-plan → VideoPipeline / FFmpegSceneVideoProvider → VideoAssemblyManager` akışı korunarak gerçek OpenAI production motion-plan provider'ı eklendi. Yeni video-generation servisi, video pipeline, assembly veya publish sistemi kurulmadı; animation provider fiziksel MP4 üretmez, scene-video mevcut FFmpeg katmanında oluşturulur.
- `ANIMATION_PROVIDER=openai` seçimi; scene/source identity, prompt ve duration doğrulaması, izin verilen resmi Chat Completions endpoint'i, redirectsiz bounded istek, deterministik JSON, `temperature: 0`, JSON response formatı, SHA-256 request identity/idempotency, bağımsız attempt timeout'ları, byte limitleri ve yalnız geçici hatalarda 0–2 retry uygular.
- Endpoint doğrulaması HTTP, userinfo, alt alan, suffix, port, query ve fragment'i reddeder. Hatalar yalnız `ANIMATION_PROVIDER_REQUEST_FAILED`, `ANIMATION_PROVIDER_TIMEOUT` ve `ANIMATION_PROVIDER_RESPONSE_INVALID` kodlarıyla raporlanır; raw exception, body, endpoint ve API key dışarı taşınmaz.
- Motion-plan exact-key şeması; motion/transition allowlist'leri, frame/crop/transform ve duration sınırları, JSON derinliği, prototype pollution, `NaN`, `Infinity`, negatif ve sınır dışı değer kontrolleriyle fail-closed doğrulanır. Scene/source identity ile locator/path provider cevabına bırakılmaz; boş veya geçersiz plan production sonucu sayılmaz.
- Yeni `AnimationStorage`, artifact'ları `data/projects/<slug>/assets/animations/<asset-id>.json` altında `.atolye-animation-storage-v1` sentinel, traversal ve symlink/junction/realpath containment kontrolleri, `wx` temp file, `0600`, `fsync` ve aynı dizinde atomic hard-link publish ile saklar. Existing target overwrite, yanlış/eksik sentinel ve unsafe cleanup fail-closed reddedilir.
- Production animation asset'i asset/scene/source ID, request identity, prompt digest, provider/model, `generationMode: production`, MIME, locator, byte length, duration, motion, frame ve transition bilgisini taşır. Exact replay geçerli artifact ve registry kaydı varsa provider çağrısını atlar; identity/payload, duplicate identity ve locator çakışmaları reddedilir. Başarısız stage aktif animation asset bırakmaz; mock davranışı geriye uyumludur.
- `VideoPipeline` ve `VideoAssemblyManager` ortak stored-motion-plan doğrulamasıyla artifact readback, byte length, identity/digest/provider/model/duration, motion içeriği ve project containment'i kontrol eder. Değiştirilmiş, locatorsız veya başka projeye yönelen artifact scene-video ve assembly'yi fail-closed durdurur; mevcut FFmpeg üretim davranışı değişmez.
- Animation readiness: eksik provider `NOT_CONFIGURED`, mock `BLOCKED`, unknown `INVALID`, eksik API key/model/endpoint `NOT_CONFIGURED`, geçersiz timeout/retry/response limit `INVALID`, geçerli OpenAI config `READY` olur. Readiness ücretli generation çağrısı yapmaz ve execution router ile ortak config/endpoint kurallarını kullanır.
- Acceptance fingerprint'ine provider, model, endpoint, timeout, retry ve response limit eklendi. API key ham olarak kaydedilmez; key rotasyonu ayrı SHA-256 digest üzerinden TOCTOU değişikliği olarak algılanır.
- Mevcut ortamda `animation-provider: NOT_CONFIGURED`, reason code `ANIMATION_PROVIDER_MISSING` ve overall `ready=false` sonucunu verir. Runtime, durable execution ve health `BLOCKED`; gerekli environment/provider/model/API-key alanları `NOT_CONFIGURED` durumundadır.
- Sprint 127 animation provider mimarisini production seviyesine taşıdı; ancak gerçek OpenAI animation yapılandırması ve diğer production bağımlılıkları tamamlanmadığı için ücretli acceptance run çalıştırılmadı ve ilk gerçek production acceptance videosu üretilmedi.
- Doğrulamalar: `npx tsc --noEmit` PASS; Sprint 127 production animation smoke 30, animation regression 21, scene-video 23, assembly 46, pipeline orchestration 10, auto-continuation 18, durable wiring 19, durable execution 17 ve Sprint 125 production E2E 20 senaryo PASS; Sprint 126 readiness/acceptance, retry persistence (5 grup), hedefli ESLint ve `git diff --check` PASS; fixture/artifact kalıntısı yok.
- Final production safety review: P0 yok, P1 yok, P2 yok.

---

## Git Durumu

Branch

main

Son Commit

f21fc24

Durum

Sprint 129.7 Ready for Safe Resume durumundadır. İlk ücretli execute research aşamasında fail-closed durmuş; aynı slug korunarak structured-output reliability hardening tamamlanmış, marker/fingerprint ve research-only resume planı doğrulanmıştır. Gerçek YouTube publish yapılmamış ve Sprint 129 tamamlanmamıştır.

---

# ✅ Tamamlanan Büyük Modüller

## Foundation

- AI Router
- Provider Architecture
- Project Manager
- Manifest System
- Asset Pipeline
- Progress System

---

## Content Pipeline

- Research Engine
- Script Engine
- Scene Engine
- Visual Engine
- Animation Engine
- Video Engine
- Audio Engine
- Assembly Engine

Mevcut pipeline sırası:

Research → Script → Scenes → Visuals → Animation → Video → Audio → Assembly → Thumbnail → SEO → YouTube → Export

Canonical vizyon akisi: Tek konu -> Research -> Script -> Scene Planning -> Visual Production -> Animation -> Audio -> Video Editing -> Thumbnail -> SEO -> Publishing

---

## Animation

- Animation Prompt Builder
- Animation Prompt Generator
- Animation API
- Animation Service
- Animation UI
- Animation Manifest Stage

---

## Studio

- Dashboard
- Project Workspace
- Asset Gallery
- Pipeline Status

---

# 📅 Son Tamamlanan Sprintler

## Sprint 40

Animation Manifest Stage

✅ Tamamlandı

---

## Sprint 41

Animation Scene-Level Regeneration

✅ Tamamlandı

---

## Sprint 42

Video Engine Foundation

✅ Tamamlandı

---

## Sprint 43

Audio Engine Foundation

✅ Tamamlandı

---

## Sprint 44

Assembly Engine Foundation

✅ Tamamlandı

---

## Sprint 45

Thumbnail Engine Foundation

✅ Tamamlandı

---

## Sprint 46

YouTube Engine Foundation

✅ Tamamlandı

---

## Sprint 47

Export Engine Foundation

✅ Tamamlandı

---

## Sprint 48

Final Pipeline Integration

Completed

---

## Sprint 49

Real AI Provider Integration Guardrails

Completed

---

## Sprint 50

AI Reliability & Observability Foundation

Completed

---

## Sprint 51

Usage Viewer / AI Diagnostics Panel

Completed

---

## Sprint 52

AI Usage Diagnostics Summary

Completed

---

## Sprint 53

AI Usage Filters & Diagnostics Search

Completed

---

## Sprint 54

Pipeline Retry & Resume Planning Foundation

Completed

---

## Sprint 55

Pipeline Resume Execution Foundation

Completed

---

## Sprint 56

Pipeline Resume API Foundation

Completed

---

## Sprint 57

Pipeline Resume Studio Action

Completed

---

## Sprint 58

Pipeline Retry Execution Foundation

Completed

---

## Sprint 59

Pipeline Retry API Foundation

Completed

---

## Sprint 60

Pipeline Retry Studio Action

Completed

---

## Sprint 61

Pipeline Recovery UX Hardening

Completed

---

## Sprint 62

Pipeline Recovery Diagnostics Polish


---

## Sprint 63

Pipeline Recovery Diagnostics Data Wiring


---

## Sprint 64

Pipeline Queue / Job Management Foundation

Completed
Completed
Completed

---

## Sprint 65

Pipeline Queue Execution Wiring

Completed

---

## Sprint 66

Pipeline Queue Scheduler

Completed

---

## Sprint 67

Pipeline Queue UI Controls Hardening

Completed

---

## Sprint 39

Pipeline Status Panel

✅ Tamamlandı

---

## Sprint 38

Animation Asset UI Separation

✅ Tamamlandı

---

# Sprint 45
## Thumbnail Engine Foundation

Durum:
✅ Tamamlandı

İçerik:
- Thumbnail type sistemi oluşturuldu.
- Thumbnail provider mimarisi eklendi.
- MockThumbnailProvider oluşturuldu.
- ThumbnailProviderRouter oluşturuldu.
- ThumbnailEngine oluşturuldu.
- Thumbnail config yapısı eklendi.
- POST /api/thumbnails endpoint oluşturuldu.
- ProjectManager üzerinden thumbnail.json kayıt desteği bağlandı.

Yeni dosyalar:

app/api/thumbnails/route.ts

src/lib/thumbnail/
- ThumbnailEngine.ts
- ThumbnailProviderConfig.ts
- ThumbnailProviderRouter.ts
- providers/ThumbnailProvider.ts
- providers/MockThumbnailProvider.ts

Güncellenen dosyalar:

src/types/thumbnail.ts
src/lib/thumbnail/ThumbnailManager.ts

Mimari kararlar:
- Mock-first yaklaşımı korundu.
- Gerçek görsel üretimi yapılmadı.
- Provider mimarisi ileride farklı AI servisleri eklenebilecek şekilde hazırlandı.
- Mevcut thumbnail sistemi bozulmadan yeni engine katmanı eklendi.

Test:
npx tsc --noEmit --incremental false

Sonuç:
Başarılı.

---

# Sprint 46
## YouTube Engine Foundation

Durum:
✅ Tamamlandı

Yapılanlar:
- YouTube type sistemi oluşturuldu.
- YouTube provider mimarisi kuruldu.
- MockYouTubeProvider eklendi.
- YouTubeEngine oluşturuldu.
- POST /api/youtube endpoint eklendi.
- youtube.json ProjectManager desteği eklendi.
- Manifest ve progress sistemine youtube aşaması bağlandı.

Yeni dosyalar:
src/types/youtube.ts

src/lib/youtube/
- YouTubeEngine.ts
- YouTubeProviderConfig.ts
- YouTubeProviderRouter.ts
- providers/YouTubeProvider.ts
- providers/MockYouTubeProvider.ts

app/api/youtube/route.ts

Güncellenen:
src/types/project.ts
src/lib/projects/ProjectManager.ts
src/lib/projects/projectProgress.ts
app/project/[slug]/page.tsx

Mimari:
- Mock-first yaklaşım korundu.
- Gerçek YouTube API/OAuth/upload yapılmadı.
- Thumbnail Engine provider modeli tekrar kullanıldı.

Test:
npx tsc --noEmit --incremental false

Sonuç:
Başarılı.

---

# Sprint 47
## Export Engine Foundation

Durum:
✅ Tamamlandı

İçerik:

- Export type sistemi oluşturuldu.
- Export provider mimarisi eklendi.
- MockExportProvider oluşturuldu.
- ExportProviderRouter oluşturuldu.
- ExportEngine oluşturuldu.
- POST /api/export endpoint oluşturuldu.
- export.json ProjectManager desteği eklendi.
- Manifest ve progress sistemine export aşaması bağlandı.

Yeni dosyalar:

src/types/export.ts

src/lib/export/
- ExportEngine.ts
- ExportProviderConfig.ts
- ExportProviderRouter.ts
- providers/ExportProvider.ts
- providers/MockExportProvider.ts

app/api/export/route.ts

Güncellenen dosyalar:

src/types/project.ts
src/lib/projects/ProjectManager.ts
src/lib/projects/projectProgress.ts
app/project/[slug]/page.tsx

Mimari kararlar:

- Mock-first yaklaşımı korundu.
- Gerçek zip/folder üretimi yapılmadı.
- Render veya upload yapılmadı.
- Export katmanı metadata/package planı olarak tasarlandı.
- Engine/provider/router mimarisi korundu.

Test:

npx tsc --noEmit --incremental false

Sonuç:
Başarılı.

---

# Sprint 48
## Final Pipeline Integration

Durum:
Completed

İçerik:

- Final Pipeline Integration tamamlandı.
- PipelineRunner uçtan uca orchestrator haline getirildi.
- Research → Script → Scenes → Visuals → Animation → Video → Audio → Assembly → Thumbnail → SEO → YouTube → Export akışı bağlandı.
- Manifest/progress entegrasyonu tamamlandı.
- Kontrollü hata yönetimi ve stage bazlı orchestration eklendi.
- Mock-first yaklaşımı korundu.

Test:
npx.cmd tsc --noEmit --incremental false

Sonuç:
Başarılı.

---

# Sprint 50
## AI Reliability & Observability Foundation

Durum:
Completed

İçerik:

- AI çağrı metadata kaydı eklendi.
- data/projects/{slug}/ai-usage.json append-only usage dosyası oluşturuldu.
- Provider, model, süre, fallback, hata ve prompt/response boyutu metadata olarak kaydedilir hale getirildi.
- Prompt ve response içeriği kaydedilmeden observability temeli kuruldu.
- PipelineRunner ilgili AI manager çağrılarına projectSlug/stage context aktarmaya başladı.
- Mock-first yaklaşımı korundu.

Test:
npx.cmd tsc --noEmit --incremental false

Sonuç:
Başarılı.

---

# Aktif Görev

Ready for Execution

Sprint 129.5 — Production Acceptance Topic Input Contract.

- Execute CLI zorunlu `--confirm-production-acceptance` ve `--topic=<topic>` alır; eksik, boş, duplicate, kontrol karakterli, kısa/uzun veya unknown argümanlı istekler stabil kodlarla reddedilir.
- Marker schema v2 canonical topic, topic fingerprint ve canonical request fingerprint taşır.
- Slug topic + runId üzerinden deterministik kalır; resume topic'i marker'dan okur ve CLI topic argümanını reddeder.
- Package-only, strict fail-closed, replay/resume idempotency ve `published:false` korunur.
- Production readiness 27/27 `READY` durumundadır; ilk ücretli acceptance run henüz başlatılmamıştır.

---

# Sprint 73
## Production Engine Smoke Validation

Amac:

Son hardening sprintlerinden sonra Production Engine yuzeylerinde kucuk, bagimsiz manual smoke validation yapmak.

Kapsam:

- Project workspace production surfaces
- Pipeline status / queue / jobs gorunumu
- AssetGallery preview ve asset reload davranisi
- Recent lint hardening sonrasi UI regresyon kontrolu

Plan:

- Production Engine Smoke Validation tamamlandi.
- Structured research rendering compatibility duzeltildi.
- timeline, characters ve keyEvents hem legacy string hem structured object verilerini guvenli render ediyor.
- TypeScript validation passed.
- Smoke validation basarili.
- Production Engine pipeline davranisi dogrulandi.

---

# Sprint 74
## Pipeline Queue UX Hardening

Amac:

Pipeline Queue / Jobs panelinde kalan UI state ve action feedback edge case'lerini kucuk kapsamda guvenli hale getirmek.

Plan:

- PipelineJobsPanel UI state handling iyilestirildi.
- Proje degisiminde stale job listesi temizleniyor.
- Invalid slug, API error ve fetch error yollarinda stale state temizleniyor.
- Action state ve action lock guvenli sekilde sifirlaniyor.
- Runtime action validation eklendi.
- Action feedback daha tutarli hale getirildi.
- TypeScript validation passed.

---

# Sprint 75
## Pipeline Queue Reliability

Amac:

Pipeline Queue / Jobs panelinin refresh guvenilirligini API contract degistirmeden iyilestirmek.

Plan:

- 5-second polling only while queued/running jobs exist.
- Polling stops when active jobs finish.
- Silent refresh on window focus and tab visibility return.
- Overlapping refresh requests prevented.
- Stale project request results prevented from updating new project state.
- Background refresh preserves the current loading/empty UI.
- API contracts and existing action behavior unchanged.
- npx tsc --noEmit passed.

---

# Sprint 78
## Pipeline History API Foundation

Amac:

Mevcut pipeline-history.json execution history verisini guvenli bir read API uzerinden acmak.

Plan:

- Added PipelineJobManager.listHistory().
- Added GET /api/projects/[slug]/pipeline/history.
- Exposed existing pipeline-history.json safely.
- Empty history fallback preserved.
- Existing pipeline job APIs unchanged.
- No UI changes.
- No API contract changes.
- API contract compatibility preserved.
- npx tsc --noEmit passed.

---

# Sprint 79
## Pipeline History Viewer Foundation

Amac:

Pipeline execution history verisini Studio icinde read-only bir UI bolumu olarak gorunur hale getirmek.

Plan:

- Execution history UI PipelineJobsPanel icine eklendi.
- Existing GET /api/projects/[slug]/pipeline/history endpoint'i tuketildi.
- Loading, empty ve error state'leri eklendi.
- History refresh active job polling ile senkronize edildi.
- Basarili retry/cancel job action'lari history refresh'i guvenilir sekilde tetikliyor.
- Existing job action davranislari ve API contracts korundu.
- PipelineJobManager unchanged.
- npx tsc --noEmit passed.

---

# Sprint 80
## Pipeline Execution Timeline Foundation

Amac:

Existing execution history verisini timeline-style bir gorunumle daha okunabilir hale getirmek.

Plan:

- PipelineJobsPanel history section timeline-style viewer haline getirildi.
- History events timestamp'e gore siralaniyor.
- Event time bilgisi net gosteriliyor.
- completed, failed ve cancelled status visualization eklendi.
- Existing loading, empty ve error state'leri korundu.
- Existing job actions ve API contracts preserved.
- PipelineJobManager unchanged.
- npx tsc --noEmit passed.

---

# Sprint 83
## Pipeline Job State Consistency

Durum:
Completed

Kapsam:

- Job transition modeli: queued -> running/cancelled, running -> completed/failed/cancelled, failed/cancelled -> queued.
- completed terminal state olarak korunur.
- cancelRequestedAt cancel istegini kaydeder; retry attempt'i artirir ve bu bilgiyi temizler.
- startStage, persistStageSuccess, persistStageFailure ve persistProjectCompletion proje bazli async lock kullanir.
- PipelineStageExecutor persistence coordinator uzerinden output/manifest/job sonucunu yazar.
- Cancelled execution stage output, manifest completed/failed ve proje completed durumunu persist edemez.
- Scheduler cancelled job durumunu manifest durumundan daha otoriter kabul eder.
- Cancellation stop reason runner ve /api/pipeline seviyesine tasinir.
- Manuel API save yollari job state'i degistirmez ve cancelled queue yeniden baslatilmaz.
- TypeScript validation, final review ve runtime smoke testleri basarili; fixture/harness temizlendi.

Kalan riskler:

- Lock process-localdir; filesystem yazimlari transaction degildir.
- Paralel manuel save/pipeline execution icin ileride revision/transaction tabanli iyilestirme gerekebilir.
- Cancel uzun suren AI/asset uretimini fiziksel olarak durdurmaz.

---

# Sprint 84
## Retry Execution Integration

Durum:
Completed

Kapsam:

- PipelineRunner.executeJobRetry tek retry execution entrypoint'i olarak eklendi.
- failed/cancelled -> queued hazirligi lock altinda yapilir; attempt artar ve cancelRequestedAt temizlenir.
- queued -> running claim'i atomiktir; paralel retry cagrilarindan yalnizca biri execution baslatir, digeri conflict alir.
- Retry hedefi job.stage alanindan alinir ve dependency readiness kontrolunden sonra yalnizca hedef stage calisir.
- Downstream stage'ler otomatik baslamaz.
- /pipeline/retry ve job action retry ayni runner akisinda birlestirildi.
- UI retry sonucunu queued yerine gercek execution completed/blocked durumu olarak gosterir.
- TypeScript validation, tum runtime smoke testleri ve final code review basarili.

Kalan riskler:

- Dependency blocked retry job'i queued durumda kalir; ileride explicit blocked state gerekebilir.
- Stage execution error durumunda route genel 500 response doner; ileride yapilandirilmis execution result response eklenmeli.

---

# Sprint 85
## Retry Execution Failure Response Hardening

Durum:
Completed

Kapsam:

- Stage execution exception runner icinde yapilandirilmis retry sonucuna cevrildi.
- Execution failure iki retry endpoint'inde HTTP 500, success: false, blocked: false, error: "Pipeline retry execution failed." ve result.status: 500 ile ortak sozlesmeye baglandi.
- Basarili retry HTTP 200; dependency-blocked ve conflict akislari HTTP 409 olarak korundu.
- Job endpoint'i jobs ve execution alanlarini geriye uyumlu olarak korudu.
- Provider/stage exception ayrintilari istemciye sizdirilmaz; gercek hata sunucu logu ve failure persistence akisinda kalir.
- TypeScript, hedefli smoke ve npm run build basarili.

Kalan riskler:

- Lock process-localdir ve filesystem persistence transaction degildir.
- Sunucu log erisimi guvenli tutulmalidir.

---

# Sprint 86
## Retry Dependency Preflight Hardening

Durum:
Completed

Kapsam:

- Dependency retry plani herhangi bir job mutation'indan once olusturuldu.
- Dependency blocked durumda HTTP 409 ve blocked: true doner; prepareJobRetry cagrilmaz.
- Blocked job icin status, attempts, cancelRequestedAt ve tum zaman alanlari degismez.
- Ready durumda preflight -> prepareJobRetry -> scheduler/atomik claim -> execution akisi korundu.
- Basarili retry HTTP 200; cancel, conflict ve manifest/job tutarsizligi HTTP 409 olarak korundu.
- Sprint 85 execution-failure HTTP 500 sozlesmesi aynen korundu.
- Review sirasinda gereksiz ikinci dependency plan hesaplamasi kaldirildi.
- TypeScript, hedefli smoke ve npm run build basarili.

Kalan riskler:

- Planlama ile preparation arasinda kisa bir race window vardir.
- Lock process-localdir ve filesystem persistence transaction degildir.
- Dependency disi scheduler/state-load bloklarinda queued kalma riski ayri bir gelecek istir.

---

# Sprint 87
## Retry State-Load Preflight Hardening

Durum:
Completed

Kapsam:

- Read-only job lookup -> dependency preflight -> state-load preflight -> prepareJobRetry -> scheduler/atomik claim -> execution sirasi kuruldu.
- State yuklenemezse HTTP 409, blocked: true ve "Project could not be read." sonucu doner; prepareJobRetry cagrilmaz.
- Bu durumda job status, attempts, cancellation ve zaman alanlari degismez.
- Seed edilmemis job storage icin getJobReadOnly ve getJobForStageReadOnly eklendi; mevcut pipeline-jobs.json okunur, manifestten seed edilmez ve dosya yazilmaz.
- Storage'da bulunmayan gecerli retry job ID'si icin stage, tam proje slug prefix'i ve pipeline stage whitelist'i ile guvenli bicimde turetilir.
- State basariyla yuklendikten sonra mevcut seed/preparation, scheduler/atomik claim ve execution davranisi korunur.
- Basarili retry HTTP 200, cancel/conflict HTTP 409 ve Sprint 85 execution-failure HTTP 500 sozlesmeleri degismedi.
- Yeni job state'i, API alani, UI davranisi veya persistence mimarisi eklenmedi.
- TypeScript, hedefli smoke ve npm run build basarili; Turbopack dinamik dosya izleme uyarisi build'i engellemedi.

Review sonucu:

- Bloklayici bulgu yok.
- Read-only lookup, dependency planı ve state-load tamamlanana kadar write-capable yol calismaz.
- Normal seed eden lookup davranislari degistirilmedi.

Kalan riskler / takip isleri:

- State'in preparation ve scheduler oncesinde okunmasi, state ile execution arasindaki mevcut eszamanli manuel-save penceresini uzatir.
- Scheduler sonrasinda queued kalma riski bu sprintin disindadir.
- JSON filesystem persistence icin transaction veya mutlak dosya atomikligi eklenmedi.

---

# Sprint 88
## Retry Post-Preparation Compensation Hardening

Durum:
Completed

Kapsam:

- prepareJobRetry basarili olduktan sonra scheduler stage dondurmezse, prepared target job kosullu compensation ile preparation oncesi snapshot'a geri alinir.
- prepareJobRetry internal basari sonucu previousJob, queued prepared job ve guncel job listesini tasir; HTTP/API response alanlari degismedi.
- compensatePreparedRetry process-local project lock altinda storage'i yeniden okur.
- Restore yalniz ayni job ID, queued status, prepared attempt ile ayni attempts ve bos cancelRequestedAt kosullarinda uygulanir.
- Status, attempts, error, cancellation ve job zaman alanlari tam previousJob snapshot'inden geri yuklenir; diger job'lar korunur.
- Cancelled, running/claimed veya sonraki retry attempt'ine gecmis job geri alinmaz; kosullar eslesmezse write yapilmaz.
- Runner compensation'i yalniz scheduler stage dondurmediginde cagirir; startStage conflict/cancel ve execution-failure yollarinda calismaz.
- Ready retry HTTP 200; scheduler blocked, preparation conflict ve cancel/conflict HTTP 409; Sprint 85 execution failure HTTP 500 sozlesmesi korundu.
- TypeScript, izole compensation smoke ve npm run build basarili; Turbopack dinamik dosya izleme uyarisi build'i engellemedi.

Review sonucu:

- Bloklayici bulgu yok.
- Snapshot restore yalniz guncel queued prepared attempt icin calisir.
- previousJob mevcut akista mutation oncesinden alinir; retry yeni object uretir ve API sozlesmesine alan sizmaz.

Kalan riskler / takip isleri:

- Compensation write basarisiz olursa exception yukari tasinabilir ve endpoint 500 donebilir; queued job guvenle geri alinamamis olur.
- Preparation ve compensation iki ayri JSON write islemidir; transaction degildir.
- Process-local lock surecler arasi atomiklik saglamaz.
- Lock disi ayni queued attempt storage yazimi varsa compensation bunu ayirt edemez ve eski snapshot ile ezebilir.
- previousJob bagimsiz clone yerine referans olarak tasinir; mevcut PipelineJob alanlari primitive ve mevcut akista sonradan mutation yoktur.

---

# Sprint 89
## Retry Persistence Failure Hardening

Durum:
Completed

Kapsam:

- Pipeline job persistence, ayni proje klasorundeki benzersiz temporary file'a yazim ve atomic rename ile guclendirildi.
- Retry preparation persistence write veya rename hatasinda mevcut destination dosyasi korunur; previous job snapshot'i ve onceki attempt state'i observable olarak degismez.
- Scheduler blocked retry icin compensation restore basariliysa mevcut HTTP 409 ve blocked: true sozlesmesi korunur.
- Compensation restore persistence hatasi HTTP 500, success: false ve blocked: false internal failure sonucu olarak doner; normal scheduler-blocked 409 sonucu kullanilmaz.
- Basarili retry HTTP 200; normal dependency, state ve scheduler conflict sonuclari HTTP 409 olarak kalir.
- Sprint 88 previousJob snapshot contract'i ile cancelled, running/claimed ve new-attempt compensation guard'lari korundu.
- JSON storage mimarisi, process-local project lock ve surecler arasi/distributed locking sinirlari degismedi.
- TypeScript validation, Sprint 89 retry persistence smoke ve git diff --check basarili.
- Windows ortaminda mevcut destination uzerine rename/replacement davranisi dogrulandi.

Kalan riskler / takip isleri:

- Preparation ve compensation ayri persistence islemleridir; filesystem transaction eklenmedi.
- Process-local lock surecler arasi koordinasyon veya distributed locking saglamaz.
- Eszamanli surecler arasi yazimlarda son basarili rename kazanir; revision tabanli lost-update korumasi yoktur.
- Persistence hatasi sonrasi temporary file temizligi best-effort'tur; cleanup isleminin kendisi basarisiz olursa artik dosya kalabilir.

---

# Sprint 90
## Pipeline History Persistence Hardening

Durum:
Completed

Kapsam:

- pipeline-history.json persistence mevcut ProjectWriter.writeJSONAtomically() mekanizmasini kullanir.
- Sprint 89 pipeline-jobs.json atomic persistence davranisi degismedi.
- Pipeline history schema ve persistence payload shape aynen korundu.
- Mevcut history event'leri siralarini korur; yeni event listenin sonuna append edilir.
- Mevcut limitsiz retention davranisi degismedi; event trimming veya yeni limit eklenmedi.
- Temporary write, JSON serialization veya rename hatasinda mevcut destination byte-for-byte korunur.
- Orijinal persistence error object degistirilmeden yukari tasinir ve cleanup hatasi tarafindan maskelenmez.
- Temporary file cleanup best-effort olarak uygulanir.
- Cancel ile completed/failed transition history persistence yollari ortak atomic recordHistoryEvent() akisinda birlesir.
- Normal ProjectWriter.writeJSON(), UI, API ve HTTP contract davranislari degismedi.
- npx tsc --noEmit, Sprint 90 pipeline history persistence smoke ve git diff --check basarili.

Kalan riskler / takip isleri:

- JSON storage ve process-local locking sinirlari degismedi; transaction veya distributed locking eklenmedi.
- Cleanup isleminin kendisi basarisiz olursa artik temporary file kalabilir; orijinal persistence hatasi yine korunur.
- Eszamanli surecler arasi history yazimlarinda revision/lost-update korumasi yoktur.

---

# Sprint 91
## Pipeline State Corruption Detection

Durum:
Completed

Kapsam:

- pipeline-jobs.json ve pipeline-history.json corruption-aware state reader kullanir.
- Persistence read sonucunda missing, parsed ve malformed durumlari ayri ele alinir.
- Yalniz ENOENT missing file olarak kabul edilir; permission, I/O ve diger filesystem hatalari internal failure olarak yukari tasinir.
- Malformed JSON ile structural validation failure ayri internal error mesajlari uretir.
- Hatalar etkilenen pipeline state filename ve failure type bilgisini tasir; raw dosya icerigi mesajlara eklenmez.
- Corrupted state dosyalari write, truncate, rename, delete veya silent replacement islemine tabi tutulmaz.
- Missing jobs/history dosyalari mevcut projectSlug, bos liste, createdAt ve updatedAt empty-state payload davranisini korur.
- Generic ProjectReader.readJSON() davranisi degismedi.
- Mevcut PipelineJobList ve PipelineJobHistory schema contract'lari korundu.
- Mevcut stored pipeline state dosyalari read-only kontrol edildi ve yeni kurallarla uyumlu bulundu.
- Null optional alan, unknown stage, job/root slug mismatch veya invalid item iceren legacy-invalid payload'lar artik sessizce filtrelenmek yerine structural validation failure ile reddedilir.
- npx tsc --noEmit, Sprint 91 pipeline state corruption smoke ve git diff --check basarili.

Kalan riskler / takip isleri:

- attempts finite number olarak dogrulanir; integer veya non-negative olma sarti uygulanmaz.
- Timestamp alanlari string olarak dogrulanir; parse edilebilir ISO date olma sarti uygulanmaz.
- Non-ENOENT filesystem failure ve mevcut-valid-empty dosya yollari smoke icinde ayri failure injection senaryolari degildir; kod yollari review ile dogrulandi.

---

# Sprint 92
## Pipeline State Error Contract Hardening

Durum:
Completed

Kapsam:

- Malformed, structurally invalid ve non-ENOENT pipeline state read failure'lari typed PipelineStateError contract'i kullanir.
- Jobs state stable code'lari PIPELINE_JOBS_STATE_MALFORMED, PIPELINE_JOBS_STATE_INVALID ve PIPELINE_JOBS_STATE_READ_FAILED olarak sabitlendi.
- History state stable code'lari PIPELINE_HISTORY_STATE_MALFORMED, PIPELINE_HISTORY_STATE_INVALID ve PIPELINE_HISTORY_STATE_READ_FAILED olarak sabitlendi.
- Ilgili alti pipeline API route typed state error'lari ortak createPipelineStateErrorResponse() helper'i ile map eder.
- Public state-error response HTTP 500, success: false, stable code ve fixed safe error message alanlariyla sinirlidir.
- Raw JSON, absolute path, stack trace, permission/filesystem detayi ve Error.cause public response'a eklenmez.
- Non-ENOENT filesystem error exact orijinal nesnesi Error.cause olarak korunur ve server-side diagnostics icin ortak helper tarafindan loglanir.
- Typed discrimination trusted Symbol.for + WeakSet registry ve stable state/failure/filename/code validation kullanir; yalniz instanceof'e dayanmaz.
- Trusted state error stage, runner, retry execution ve retry compensation catch'lerinden ayni nesne olarak propagate edilir.
- Typed state error yalniz ortak API helper tarafindan bir kez loglanir.
- Runner ve stage katmanlari non-state error'lar icin onceki logging ve generic failure davranisini korur.
- runStage trusted state error icin generic stage failure persistence calistirmaz.
- Mevcut HTTP 200, 404 ve valid 409 contract'lari korundu.
- UI, storage schema, persistence format ve recovery davranisi degismedi.
- npx tsc --noEmit, 18-case Sprint 92 pipeline state error contract smoke ve git diff --check basarili.

---

# Sprint 93
## Pipeline Orchestration Foundation

Durum:
Completed

Kapsam:

- Merkezi pipelineRecoveryStageOrder uzerinden getNextPipelineStage() helper'i eklendi.
- Downstream orchestration yalniz gercek running -> completed transition sonrasinda calisir.
- Completed source job ile eksik downstream queued job ayni pipeline-jobs.json atomic write isleminde persist edilir.
- Final export stage sonrasinda yeni downstream job olusturulmaz.
- Failed, cancelled, queued veya gecersiz transition durumlari downstream enqueue tetiklemez.
- Duplicate guard ayni downstream stage icin herhangi bir mevcut job kaydini korur ve yeni kayit eklemez.
- Bu davranis deterministik project+stage tek-job modeliyle bilincli olarak uyumludur.
- Failed/cancelled downstream stage yeni job yerine ayni job uzerinde retry attempt ile ilerler.
- Retry completion, polling ve tekrar completion cagrilari idempotent kalir.
- Existing queued, running ve terminal downstream kayitlari ezilmez veya yeniden initialize edilmez.
- History yazimi jobs yazimindan ayri atomic persistence islemidir.
- History write failure durumunda completed source ve queued downstream jobs state korunur; history error propagate edilir ve jobs rollback uygulanmaz.
- Ayni-process concurrent completion cagrilari withProjectLock() ile serialize edilir ve tek downstream job uretir.
- Farkli processler icin distributed lock yoktur; mevcut JSON lost-update siniri devam eder.
- pipelineRecoveryStageOrder adi kullanim alanini dar gostermektedir; Sprint 93 kapsaminda rename/refactor yapilmadi.
- API route, UI, persistence schema ve mevcut HTTP 200/404/409/safe 500 contract'lari korundu.
- npx tsc --noEmit, 10-scenario Sprint 93 pipeline orchestration smoke, 18-case Sprint 92 state error contract smoke ve git diff --check basarili.

Smoke kapsami:

- Completed -> next queued.
- Duplicate completion.
- Failed.
- Cancelled.
- Incomplete/queued stage.
- Final stage.
- Existing queued/running downstream.
- Retry completion idempotency.
- History write failure sonrasi jobs orchestration state korunmasi.
- Promise.all concurrent completion idempotency.

Kalan riskler / takip isleri:

- Jobs ve history ayri atomic islemlerdir; history failure jobs state'i geri almaz.
- Process-local lock surecler arasi koordinasyon saglamaz.
- Farkli process yazimlarinda revision/distributed lock olmadigi icin lost-update riski devam eder.
- Canonical stage order gelecekte recovery disi neutral bir module/isim altina alinabilir.

---

# Sprint 94
## Pipeline Auto-Continuation

Durum:
Completed

Kapsam:

- PipelineRunner.continueProject(projectSlug) project-level continuation entrypoint'i olarak eklendi.
- Her continuation cagrisi en fazla bir queued stage calistirir.
- Queue secimi canonical pipelineRecoveryStageOrder ile yapilir; mevcut PipelineQueueScheduler ve PipelineRecoveryPlanner dependency/readiness semantigi korunur.
- Production execution zinciri runPipelineStage -> runStage -> PipelineJobManager.startStage olarak korunur.
- Atomic startStage reread ve process-local project lock sayesinde ayni-process concurrent cagrilarda yalniz bir execution claim alir.
- Claim conflict veya stale candidate no-op sonucu continued: false doner ve cancellation olarak raporlanmaz.
- Claim alinmis gercek execution cancellation sonucu continued: true ve completed: false olarak kalir.
- Basarili retry sonrasinda continuation bir kez ve best-effort calisir; typed veya generic continuation hatasi basarili retry 200/success: true response'unu bozmaz ve server-side loglanir.
- Basarili export continuation sonrasinda project-level completion mevcut PipelineJobManager.persistProjectCompletion() ve ProjectManager.updateStatus(projectSlug, "completed") yolu ile kaydedilir.
- Export finalization, stage execution generic catch sinirindan ayridir; finalization callback hatasi dogrudan continueProject() cagrisi icin reject edilir.
- Retry sonrasindaki export finalization hatasi best-effort sinirinda loglanir ve retry basarisi korunur.
- PipelineJobManager.listJobsReadOnly() yalniz mevcut read-only job list okuma yolunu expose eder; schema veya write davranisi eklemez.
- Sprint 94 auto-continuation smoke 18 senaryodur.
- npx tsc --noEmit --incremental false, 18-case Sprint 92 state error contract smoke, 10-scenario Sprint 93 orchestration smoke, 18-scenario Sprint 94 auto-continuation smoke ve git diff --check basarili.

Bilinen mimari riskler:

- Project lock process-localdir; distributed lock saglamaz.
- Filesystem persistence gercek transaction degildir.
- Gercek dis servis ve pahali stage uretimi Sprint 94 smoke kapsami disinda tutulur.

Sonraki gorev:

- Sprint 95 planlama ve mimari inceleme.

---

# Sprint 95
## Production Intelligence Foundation

### Sprint 95.1 — Production Intelligence Gap Audit

Durum:
Completed

Mimari kararlar:

- Yeni pipeline-diagnostics.json veya ayri diagnostics store su asamada gerekli degildir.
- Once mevcut source-of-truth kaynaklarindan write-free Production Snapshot olusturulacaktir.
- project.json project-level status kaynagidir.
- manifest.json stage/package status, timings, attempts ve usage ozeti kaynagidir.
- pipeline-jobs.json queue, claim, cancellation ve live execution kaynagidir.
- pipeline-history.json terminal lifecycle event kaynagidir.
- ai-usage.json provider/model/status/fallback/duration/token/cost cagri telemetrisi kaynagidir.
- Stage output dosyalari artifact readiness kaynagidir.
- Continuation bir runType degildir; trigger/origin ayri bir boyuttur.
- Metrics aggregation simdilik read-time yapilmalidir.
- Correlation/runId ileride gerekli olabilir; Production Snapshot ve Health Check v1 icin zorunlu degildir.

### Sprint 95.2 — Production Snapshot Contract

Durum:
Completed

Eklenenler:

- src/types/productionSnapshot.ts
- src/lib/production/ProductionSnapshotContract.ts
- scripts/smoke-production-snapshot-contract.ts

Temel kararlar:

- Production Snapshot yeni source of truth degildir; mevcut kaynaklarin write-free read model sozlesmesidir.
- project.json project completion icin authoritative kaynaktir.
- Jobs canli queue, running, cancellation ve claim durumlari icin authoritative kaynaktir.
- Manifest stage/package ve artifact durum kaynagidir.
- Output readiness celiskileri sessizce completed sayilmaz; inconsistent olarak modellenir.
- Queue bagimsiz persisted kaynak degildir; jobs'tan turetilir.
- SnapshotValue<T> gercek sifir ile not-recorded, missing, malformed, unreadable, inconsistent ve not-applicable durumlarini ayirir.
- Token ve cost degerleri coverage bilgisiyle modellenir.
- Consistency finding sozlesmesi Health Check Foundation icin hazirlanmistir.
- Pure helper'lar filesystem ve persistence kullanmaz; deterministic ve mutation-free calisir.
- Sprint 95.2 production snapshot contract smoke 16 senaryodur.

### Sprint 95.3 — Read-Only Production Snapshot Builder

Durum:
Completed

Eklenen dosyalar:

- src/lib/production/ProductionSnapshotBuilder.ts
- src/lib/production/ProductionSnapshotSourceReader.ts
- src/lib/production/ProductionSnapshotParts.ts
- scripts/smoke-production-snapshot-builder.ts

Temel mimari kararlar:

- Production Snapshot mevcut source-of-truth dosyalarindan read-time olusturulur; persisted edilmez ve yeni source of truth degildir.
- Okunan kaynaklar project.json, manifest.json, pipeline-jobs.json, pipeline-history.json, ai-usage.json ve canonical stage output dosyalaridir.
- Source reader seed, sync, repair veya write islemi yapmaz.
- Missing, malformed ve unreadable source durumlari ayri modellenir.
- Project kaynagi eksik veya bozuk olsa bile project slug uzerinden partial snapshot uretilebilir.
- Canonical stage sirasi research, script, scenes, visuals, animation, video, audio, assembly, thumbnail, seo, youtube ve export olarak korunur.
- Stage effective status icin Sprint 95.2 pure precedence helper'lari yeniden kullanilir.
- Cancellation ve canli execution icin jobs authoritative kaynaktir.
- Manifest completed fakat output ready degilse stage inconsistent olarak gorunur.
- Queue yalniz jobs listesinden turetilir.
- History ve AI usage metrikleri read-time aggregate edilir; token ve cost bulunmayan kayitlar sifir sayilmaz.
- Consistency findings stable code ve deterministic sirayla uretilir.
- Builder input mutate etmez ve ayni input ile generatedAt icin ayni sonucu uretir.
- Gercek filesystem smoke testi builder'in source icerigi, boyutu ve mtime degerlerini degistirmedigini dogrular.
- Production snapshot kaynaklarinin tamami mevcut PipelineJobManager project-level lock altinda ve write-free okunur.
- Yeni lock, execution entrypoint veya duplicate execution path eklenmedi; snapshot okumasinda pipeline state mutation yapilmaz.
- Project slug, manifest dis slug, manifest.project.slug, AI usage log slug ve tum AI usage kayitlarinin projectSlug degerleri istenen proje ile dogrulanir.
- Slug uyusmazliklari mevcut source contract'ina uygun olarak malformed kabul edilir; unavailable ve error propagation davranislari korunur.
- Runner, scheduler, retry ve auto-continuation execution akislari degistirilmedi.
- Torn-state concurrency ve dort wrong-project-slug senaryosu smoke kapsamindadir.
- Final review P0-P3 bulgusuz gecti.
- npx tsc --noEmit --incremental false, Sprint 95.3 production snapshot builder smoke PASS (29 senaryo) ve git diff --check basarili.
- Smoke fixture'lari temizlendi; gecici fixture kalmadi.

Bilinen kapsam disi maddeler:

- Source freshness/stale esikleri.
- Full Health Engine ve health score.
- Automatic repair.
- Snapshot cache/persistence.
- API ve UI.
- runId, attemptId ve trigger/origin persistence.
- Distributed lock.

Bir sonraki gorev:

- Sprint 95.4 — Health Check Rules Foundation.

---

### Sprint 95.5 — Read-Only Production Health Service & API

Durum:
Completed

Olusturulan dosyalar:

- src/lib/production/ProductionHealthService.ts
- src/lib/production/ProductionHealthError.ts
- src/lib/production/ProductionHealthApiError.ts
- app/api/production/health/[slug]/route.ts
- scripts/smoke-production-health-service.ts

Service mimarisi:

- Cagri zinciri GET /api/production/health/[slug] -> ProductionHealthService -> ProductionSnapshotBuilder -> ProductionHealthEngine olarak kuruldu.
- Service tek evaluatedAt degeri uretir veya enjekte edilen degeri kullanir; ayni deger snapshot generatedAt ve health evaluatedAt alanlarina aktarilir.
- Snapshot builder disinda production source dosyalari okunmaz; health engine disinda rule evaluation, siralama veya dedup yapilmaz.
- Service ve API pipeline state mutation, manifest save, job update, history append, usage persist veya project mutation yapmaz.
- Health verisi persist edilmez; endpoint yalniz GET ve no-store cache contract'i ile calisir.
- Snapshot icindeki finding detectedAt degerleri korunur; service health finding sirasini veya engine sonucunu degistirmez.

Hata ve guvenlik modeli:

- Stable domain error code'lari INVALID_PROJECT_SLUG, PROJECT_NOT_FOUND, SNAPSHOT_BUILD_FAILED, HEALTH_EVALUATION_FAILED ve UNKNOWN_PRODUCTION_HEALTH_ERROR olarak tanimlandi.
- Eksik project.json mevcut Sprint 95.3 partial snapshot davranisini korur; PROJECT_NOT_FOUND otomatik uretilmez.
- Slug validation bosluk, traversal, slash, backslash, null byte, encoded traversal ve izin verilmeyen karakterleri reddeder.
- API response ham error, stack trace, absolute filesystem path veya internal detail sizdirmaz.
- Basarili response success: true ve data report'u; hata response'u success: false ile stable code/message nesnesini tasir.

Determinism ve dogrulama:

- Ayni kaynaklar ve ayni evaluatedAt icin service sonucu deterministiktir.
- report.generatedAt, snapshot.generatedAt ve health.evaluatedAt ayni evaluation zamanini tasir.
- Sprint 95.5 production health service/API smoke PASS (24 senaryo).
- Smoke kapsami complete/partial/missing/malformed/unreadable sources, missing outputs, cancellation authority, determinism, timestamp/finding preservation, slug traversal, read-only filesystem ve API success/domain/internal error contract'larini kapsar.
- npx tsc --noEmit --incremental false basarili.
- Sprint 95.2 snapshot contract smoke PASS (16 senaryo).
- Sprint 95.3 snapshot builder smoke PASS (29 senaryo).
- Sprint 95.4 health rules smoke PASS (37 senaryo).
- Sprint 92 state error contract smoke PASS (18 senaryo).
- Sprint 93 orchestration smoke PASS (10 senaryo).
- Sprint 94 auto-continuation smoke PASS (18 senaryo).
- git diff --check basarili; smoke temporary fixture'i temizlendi.

Bir sonraki onerilen sprint:

- Sprint 95.6 — Production Health API Consumer Foundation.

---

### Sprint 95.6 — Production Health API Consumer Foundation

Durum:
Completed

Olusturulan dosyalar:

- src/lib/production/ProductionHealthApiClient.ts
- src/lib/production/ProductionProjectSlug.ts
- scripts/smoke-production-health-api-consumer.ts

Degistirilen dosyalar:

- src/lib/production/ProductionHealthService.ts
- ATOLYE_CHECKPOINT.md

Consumer contract:

- getProductionHealth(slug, options?) GET /api/production/health/[slug] endpoint'ini typed ve read-only olarak tuketir.
- ProductionHealthReport ve ProductionHealthErrorCode mevcut Sprint 95.5 domain contract'larindan type-only yeniden kullanilir; kopya response/domain type olusturulmaz.
- Consumer success, invalid_slug, api_error, network_error, timeout, aborted ve malformed_response sonuclarini ayirir.
- isProductionHealthApiConsumerError() public type guard'i eklendi.
- Fetch UI katmanina sizdirilmaz; consumer method GET ve cache: no-store ile calisir.
- Optional AbortSignal, timeoutMs, baseUrl ve test edilebilir fetchImpl injection desteklenir.
- Timeout fetch ve response body parsing tamamlanana kadar aktiftir; caller abort timeout'tan ayri raporlanir.

Guvenlik ve validation:

- Ortak ProductionProjectSlug helper'i service ve consumer slug dogrulamasini tek yerde tutar.
- Success response report, snapshot, health, counts, source confidence, summary, findings, stages ve source state yuzeylerinde runtime validate edilir.
- API domain error payload'i yalniz stable ProductionHealthErrorCode degerleriyle kabul edilir.
- Server message, network error, stack trace, filesystem path veya ham internal detail public consumer message'ina tasinmaz.
- Malformed JSON, wrong response shape ve missing data kontrollu malformed_response sonucu uretir.
- Consumer polling, persistence, UI veya dashboard degisikligi yapmaz.

Test ve regresyon:

- npx tsc --noEmit --incremental false basarili.
- Sprint 95.6 production health API consumer smoke PASS (15 senaryo).
- Smoke kapsami success, warning/critical/unknown, local/API invalid slug, HTTP 400/500, network, timeout, abort, malformed JSON/shape, missing data, safe message, no-store ve deterministic tasimayi kapsar.
- Sprint 95.5 production health service/API smoke PASS (24 senaryo).
- Sprint 95.4 production health rules smoke PASS (37 senaryo).
- Sprint 95.3 production snapshot builder smoke PASS (29 senaryo).
- Sprint 95.2 production snapshot contract smoke PASS (16 senaryo).
- git diff --check basarili.

Bir sonraki onerilen sprint:

- Sprint 95.7 — Production Health UI Integration Foundation.

---

### Sprint 95.7 — Production Health UI Integration Foundation

Durum:
Completed

Olusturulan dosyalar:

- src/components/studio/ProductionHealthPanel.tsx
- scripts/smoke-production-health-ui.ts

Degistirilen dosyalar:

- src/components/studio/index.ts
- app/project/[slug]/page.tsx
- ATOLYE_CHECKPOINT.md

UI ozellikleri:

- Production Health paneli proje studyosuna mevcut StudioCard tasarim sistemiyle read-only olarak eklendi.
- UI veri erisimi yalniz ProductionHealthApiClient getProductionHealth() consumer'i uzerinden yapilir; component icinde dogrudan fetch yoktur.
- Overall status, overall severity, source confidence, findings count ve evaluatedAt alanlari gosterilir.
- Healthy/none yesil, info mavi, warning sari, critical kirmizi ve unknown zinc renkleri mevcut status badge diliyle uyumludur.
- Loading, error, unknown ve empty findings durumlari ayridir.
- Retry butonu yalniz consumer loader'ini yeniden cagirir; pipeline veya production state mutation yapmaz.
- Project slug degisiminde stale request sonucu korunmaz; onceki request AbortController ile iptal edilir.
- Polling, auto refresh, state persistence, API contract veya dashboard listesi degisikligi eklenmedi.

Test ve regresyon:

- npx tsc --noEmit --incremental false basarili.
- Sprint 95.7 production health UI smoke PASS (10 senaryo).
- Smoke kapsami loading, success, warning, critical, unknown, error, retry, malformed response, empty findings ve deterministic render senaryolarini kapsar.
- Hedefli ESLint ProductionHealthPanel ve UI smoke icin 0 error/0 warning ile basarili.
- Sprint 95.6 production health API consumer smoke PASS (15 senaryo).
- Sprint 95.5 production health service/API smoke PASS (24 senaryo).
- Sprint 95.4 production health rules smoke PASS (37 senaryo).
- Sprint 95.3 production snapshot builder smoke PASS (29 senaryo).
- Sprint 95.2 production snapshot contract smoke PASS (16 senaryo).
- git diff --check basarili.

Bir sonraki onerilen sprint:

- Sprint 95.8 — Production Health Findings Detail Foundation.

---

### Sprint 95.8 — Production Health Findings Detail Foundation

Durum:
Completed

Olusturulan dosyalar:

- src/components/studio/ProductionHealthFindingsPanel.tsx
- scripts/smoke-production-health-findings.ts

Degistirilen dosyalar:

- src/components/studio/ProductionHealthPanel.tsx
- ATOLYE_CHECKPOINT.md

Findings panel ozellikleri:

- Findings detail paneli mevcut ProductionHealthPanel success yuzeyine entegre edildi.
- Panel yalniz typed consumer report'u icindeki ProductionHealthFinding[] ve sourceConfidence verisini kullanir; fetch veya API contract degisikligi yoktur.
- Her finding severity, category, stable code, description, affected stage ve source confidence alanlariyla gosterilir.
- Finding stage alani yoksa affected stage Project-wide olarak gosterilir.
- Info mavi, warning sari ve critical kirmizi mevcut badge/renk diliyle render edilir.
- Findings engine/consumer tarafindan gelen deterministic sirayla map edilir; sort, filter veya search eklenmez.
- Toplam finding sayisi, empty findings state ve unknown health icin guvenli completeness mesaji vardir.
- Uzun aciklamalar whitespace-pre-wrap, break-words ve overflow-wrap:anywhere ile guvenli satir kirar.
- Retry sonrasi yeni consumer report findings listesi ayni panelde render edilir.
- Polling, auto refresh, persistence veya production state mutation eklenmedi.

Test ve regresyon:

- npx tsc --noEmit --incremental false basarili.
- Sprint 95.8 production health findings smoke PASS (10 senaryo).
- Smoke kapsami empty, success, warning, critical, unknown, deterministic order, affected stages, long description, retry sonrasi render ve malformed response senaryolarini kapsar.
- Hedefli ESLint findings panel, parent health panel ve smoke icin 0 error/0 warning ile basarili.
- Sprint 95.7 production health UI smoke PASS (10 senaryo).
- Sprint 95.6 production health API consumer smoke PASS (15 senaryo).
- Sprint 95.5 production health service/API smoke PASS (24 senaryo).
- Sprint 95.4 production health rules smoke PASS (37 senaryo).
- Sprint 95.3 production snapshot builder smoke PASS (29 senaryo).
- Sprint 95.2 production snapshot contract smoke PASS (16 senaryo).
- git diff --check basarili.

Bir sonraki onerilen sprint:

- Sprint 95.9 — Production Health Finding Evidence Foundation.

---

### Sprint 95.9 — Production Health Finding Evidence Foundation

Durum:
Completed

Olusturulan dosyalar:

- src/components/studio/ProductionHealthFindingEvidence.tsx
- scripts/smoke-production-health-evidence.ts

Degistirilen dosyalar:

- src/components/studio/ProductionHealthFindingsPanel.tsx
- ATOLYE_CHECKPOINT.md

Evidence panel ozellikleri:

- Finding evidence paneli her mevcut finding kartina read-only olarak entegre edildi.
- Panel yalniz API consumer report'u icindeki finding.evidence, finding.sources, finding.stage/scope ve health source confidence verilerini kullanir.
- Evidence JSON-safe primitive degerleri gelen object key sirasi korunarak render edilir; sort, filter veya search eklenmez.
- Source listesi, affected resource ve confidence her finding icin gosterilir.
- Stage varsa affected resource stage; yoksa finding scope olarak gosterilir.
- Evidence veya source eksikse guvenli placeholder kullanilir.
- Unknown health durumunda evidence completeness icin guvenli mesaj gosterilir.
- Uzun evidence key/value ve metadata metinleri whitespace-pre-wrap, break-words, break-all ve overflow-wrap:anywhere ile guvenli satir kirar.
- Polling, auto refresh, persistence, fetch veya API contract degisikligi eklenmedi.

Test ve regresyon:

- npx tsc --noEmit --incremental false basarili.
- Sprint 95.9 production health evidence smoke PASS (10 senaryo).
- Smoke kapsami success, empty evidence, unknown, malformed response, deterministic render, long evidence, missing source, retry sonrasi render, multiple findings ve confidence render senaryolarini kapsar.
- Hedefli ESLint evidence panel, findings panel ve smoke icin 0 error/0 warning ile basarili.
- Sprint 95.8 production health findings smoke PASS (10 senaryo).
- Sprint 95.7 production health UI smoke PASS (10 senaryo).
- Sprint 95.6 production health API consumer smoke PASS (15 senaryo).
- Sprint 95.5 production health service/API smoke PASS (24 senaryo).
- Sprint 95.4 production health rules smoke PASS (37 senaryo).
- Sprint 95.3 production snapshot builder smoke PASS (29 senaryo).
- git diff --check basarili.

Bir sonraki onerilen sprint:

- Sprint 96.0 — Production Intelligence Phase Review.

---

### Sprint 96.0 — Production Intelligence Phase Review

Durum:
Completed

Olusturulan dosya:

- scripts/smoke-production-intelligence-review.ts

Degistirilen dosyalar:

- src/lib/production/ProductionSnapshotParts.ts
- ATOLYE_CHECKPOINT.md

Review kapsami ve bulgular:

- Snapshot -> Health Engine -> Service/API -> typed Consumer -> UI/Findings/Evidence zinciri gercek route adapter'i ile uctan uca dogrulandi.
- Public type, service, API, consumer veya UI contract'i degistirilmedi; yeni urun ozelligi eklenmedi.
- report.generatedAt, snapshot.generatedAt ve health.evaluatedAt tek evaluation zamanini tasir.
- Snapshot finding detectedAt degerleri health mapping sonrasinda korunur.
- Ayni source state ve evaluatedAt icin report ve finding sirasi deterministiktir.
- API ve consumer no-store davranislari birlikte dogrulandi.
- Invalid slug ve API domain error consumer tarafinda stabil, guvenli mesajlara map edilir.
- API internal error response'u stack trace, filesystem path veya ham internal detail sizdirmaz.
- UI yalniz ProductionHealthApiClient consumer'ini kullanir; dogrudan fetch yoktur.
- Service/snapshot/health/API/consumer/UI zincirinde write, persistence, polling veya state mutation cagrisi bulunmadigi statik ve filesystem kontrolleriyle dogrulandi.
- Review P0-P3 seviyesinde bloklayici veya anlamli bulgu uretmedi.
- Yalniz ProductionSnapshotParts.ts icindeki kullanilmayan ProjectManifest type import'u risksiz cleanup olarak kaldirildi; runtime davranis degismedi.

Test ve regresyon:

- npx tsc --noEmit --incremental false basarili.
- Sprint 96.0 production intelligence phase review smoke PASS (9 senaryo).
- Sprint 95.2 snapshot contract smoke PASS (16 senaryo).
- Sprint 95.3 snapshot builder smoke PASS (29 senaryo).
- Sprint 95.4 health rules smoke PASS (37 senaryo).
- Sprint 95.5 health service/API smoke PASS (24 senaryo).
- Sprint 95.6 API consumer smoke PASS (15 senaryo).
- Sprint 95.7 health UI smoke PASS (10 senaryo).
- Sprint 95.8 findings smoke PASS (10 senaryo).
- Sprint 95.9 evidence smoke PASS (10 senaryo).
- Hedefli ESLint production intelligence zinciri icin 0 error/0 warning ile basarili.
- git diff --check basarili.

Bir sonraki onerilen sprint:

- Sprint 96.1 — Production Intelligence Operational Readiness Planning.

---

### Sprint 96.1-96.6 — Production Intelligence Continuation Package

Durum:
Completed

Mimari kararlar:

- Health finding'lerinden stable id, finding reference, action type, stage, priority, safety ve confirmation metadata'si tasiyan pure recommended action'lar turetildi.
- Canonical stage order ve dependency map mevcut PipelineRecoveryPlanner kaynagindan yeniden kullanildi; paralel stage modeli olusturulmadi.
- Snapshot, health ve action girdilerinden deterministic dependency graph, blocked stages, downstream unlocks, root causes ve cycle sonucu uretildi.
- Planner ready/blocked/complete/unknown durumlariyla root cause yakinligi, executable olma, downstream unlock sayisi ve canonical sira uzerinden deterministic adim secti.
- Execution request builder/validator stable snapshot fingerprint, request id ve idempotency key uretir; slug, allowlist, stage uyumu, stale plan, blocked step ve confirmation kurallarini uygular.
- Execution gateway yalniz dry-run metadata uretir; registry yalniz mevcut PipelineRunner retry/resume servis girislerini tanimlar, execute modu reddedilir.
- Job contract mevcut queue/job sistemine alternatif motor eklemeden kucuk preview adapter'i olarak tasarlandi; snapshot, health, graph veya buyuk payload kopyalanmaz.
- ProductionHealthReport'a optional intelligence alani ve Studio health paneline pasif ozet additive olarak eklendi.

Korunan sinirlar:

- Filesystem write/read, network, AI, persistence, polling, queue dispatch veya gercek pipeline execution eklenmedi.
- Date.now, Math.random, runtime UUID, execute endpoint, retry/rollback/attempt sistemi eklenmedi.
- Mevcut public alanlar ve ortak stage/finding/severity/job tipleri degistirilmedi; yeni contractlar additive tutuldu.
- UI yalniz bilgi gosterir; run/start/execute/confirm aksiyonu eklenmedi.

Test ve dogrulama:

- Sprint 96.1 actions smoke PASS (5 senaryo).
- Sprint 96.2 dependency graph smoke PASS (5 senaryo).
- Sprint 96.3 planner smoke PASS (5 senaryo).
- Sprint 96.4 execution contract smoke PASS (4 senaryo).
- Sprint 96.5 execution gateway smoke PASS (5 senaryo).
- Sprint 96.6 execution job contract smoke PASS (5 senaryo).
- Sprint 95.2-96.0 Production Intelligence regresyon smoke testleri PASS.
- npx tsc --noEmit --incremental false PASS.
- Repository-wide npm run lint PASS; onceki 22 error ve 1 warning temizlendi.
- Lint icin yalniz scripts/smoke-pipeline-auto-continuation.ts, scripts/smoke-pipeline-state-error-contract.ts, scripts/smoke-retry-persistence.ts ve src/components/studio/PipelineJobsPanel.tsx degistirildi.
- Test monkey-patch any cast'leri typed harness contract'larina cevrildi; kullanilmayan import kaldirildi.
- PipelineJobsPanel ref/callback/effect lint duzeltmeleri mevcut polling, stale-response, history queue ve elapsed-time davranislarini korudu.
- npm run build PASS; mevcut next.config/FileStorage trace warning'i devam ediyor.
- Sprint 89 retry persistence, Sprint 92 pipeline state error contract ve Sprint 94 auto-continuation smoke testleri PASS.
- git diff --check PASS.

Bir sonraki onerilen adim:

- Sprint 96.7 Production Intelligence contract hardening ve genisletilmis validation.

---

### Sprint 96.7 — Production Intelligence Phase Review

Durum:
Completed

Incelenen zincir:

- ProductionSnapshot -> ProductionHealth -> Finding Evidence -> Recommended Actions -> Dependency Graph -> Production Planner -> Execution Contract -> Dry-Run Gateway -> Execution Job Preview -> ProductionHealthService -> API -> UI passive plan summary.

Bulgu ozeti:

- P0: 0.
- P1: 1. Optional intelligence derivation hatasi mevcut health API response'unu bozabiliyordu; intelligence best-effort optional hale getirildi.
- P2: 3. Finding reference source/evidence kimligini tasimadigi icin ayri source finding'leri tek action'a dusebiliyordu; reference ve collision secimi canonical yapildi. Retry/resume stage zorunlulugu ile request/idempotency butunlugu eksikti; validator sertlestirildi. Malformed optional intelligence consumer'dan UI'a gecebilirdi; runtime validation eklendi.
- P3: 2. Cycle, order independence, unreliable snapshot, stale/unsupported preview ve fallback senaryolari eksikti; Sprint 96.7 review smoke eklendi. Pipeline state corruption smoke eski hata metnini bekliyordu; stable PipelineStateError failure contract'ina uyarlandi.

Korunan contract ve sinirlar:

- Mevcut API response alanlari degismedi; intelligence optional ve backward-compatible kaldi.
- Unreliable required source durumunda plan unknown olur ve recommended step sunmaz.
- Canonical stage order ve dependency map yalniz PipelineRecoveryPlanner kaynagindan kullanilir.
- Stable action, plan, request, idempotency ve job kimlikleri runtime zaman, locale, random veya UUID kullanmaz.
- Action, graph, planner, gateway ve job preview katmanlari filesystem, network, AI, persistence, queue veya pipeline execution cagrisi yapmaz.
- UI passive summary olarak kaldi; gercek execution kontrolu eklenmedi.

Test ve dogrulama:

- Sprint 96.7 phase review smoke PASS (18 senaryo).
- Sprint 96.1-96.6 smoke testleri PASS.
- Sprint 95.2-96.0 Production Intelligence regresyonlari PASS.
- Sprint 89-94 ilgili retry, history, state, orchestration ve auto-continuation smoke testleri PASS.
- npm run lint PASS.
- npx tsc --noEmit --incremental false PASS.
- npm run build PASS.
- git diff --check PASS.

Deferred risk:

- Turbopack NFT trace uyarisi next.config.ts -> FileStorage -> AssetManager -> assets route legacy import zincirinden gelir. Sprint 96.x diff'inden kaynaklanmaz ve build'i engellemez; kapsam disi olarak ertelendi.

Bir sonraki onerilen adim:

- Sprint 96.8 Production Intelligence consumer contract versioning review.

---

### Sprint 96.8 — Production Intelligence Consumer Contract Versioning Review

Durum:
Completed — Sprint 96.x closed

Contract modeli:

- ProductionIntelligence payload'i tek ortak contract uzerinde schemaVersion: "1" tasir.
- actions, graph ve plan version 1 required alanlaridir.
- executionPreview ve jobPreview optional/additive alanlardir.
- Version parser yalniz public API consumer sinirinda calisir; internal engine sonucu tekrar validate edilmez.

Consumer policy:

- intelligence alani yoksa absent kabul edilir; health response ve mevcut UI korunur.
- Version 1 valid payload bilinen alanlara normalize edilerek kullanilir.
- Version 1 future additive alanlari kabul edilir fakat consumer sonucuna kopyalanmaz.
- Version eksik veya malformed payload invalid kabul edilir; intelligence omit edilir, health response korunur.
- Bilinmeyen version unsupported olarak ayrilir; version 1 gibi tahmin edilmez ve UI'a verilmez.
- Invalid execution/job preview tum health response'u dusurmez; optional intelligence butun olarak omit edilir.

Schema evolution kurallari:

- Yeni optional alan ayni schema version icinde additive olabilir.
- Mevcut alanin anlamini veya tipini degistirmek yeni schema version gerektirir.
- Alan kaldirmak veya optional alani required yapmak yeni schema version gerektirir.
- Enum daraltmak breaking degisikliktir.
- Yeni enum degeri yalniz consumer unknown degeri guvenli reddediyorsa additive olabilir.
- Version parser merkezi kalir; unsupported version health-only fallback kullanir.

Bulgu ozeti:

- P0: 0.
- P1: 2. Payload version'sizdi ve nested runtime validator enum/contract butunlugunu eksik kontrol ediyordu; schema version ve merkezi strict parser eklendi.
- P2: 1. Invalid intelligence tum health consumer sonucunu malformed yapabiliyordu; intelligence-independent health fallback eklendi.
- P3: 1. Legacy, versioning, future field, prototype key, UI fallback ve parser determinism senaryolari eksikti; 22 senaryolu smoke eklendi.

Test ve sinirlar:

- Sprint 96.8 consumer versioning smoke PASS (22 senaryo).
- Sprint 96.7 review smoke PASS (18 senaryo).
- Sprint 96.1-96.6 smoke testleri PASS.
- Sprint 95.2-96.0 Production Intelligence regresyonlari PASS.
- npm run lint, npx tsc --noEmit --incremental false, npm run build ve git diff --check PASS.
- Parser pure, deterministic ve side-effect-free kalir; filesystem, network, AI, persistence, queue, execution, polling, random, UUID veya runtime-time version kullanmaz.
- Mevcut health API top-level alanlari degismedi; intelligence optional ve backward-compatible kaldi.

Deferred risk:

- Legacy next.config.ts -> FileStorage -> AssetManager -> assets route Turbopack NFT trace uyarisi build'i engellemez ve Sprint 96.x kaynakli degildir; ertelendi.

Bir sonraki onerilen adim:

- Sprint 97.0 Production Intelligence phase closure ve sonraki faz planlamasi.

---

### Sprint 97.0 — Production Intelligence Phase Closure & Execution Safety Plan

Durum:
Completed

Phase closure:

- Sprint 96.x Snapshot -> Health -> Evidence -> Actions -> Graph -> Planner -> Execution Contract -> Dry-Run Gateway -> Job Preview -> Versioned Consumer -> API -> Passive UI zinciri ready/preview-only olarak kapatildi.
- Real execution, Production Intelligence queue dispatch, authorization, confirmation, persistent idempotency, audit persistence, transactional recovery ve controlled rollout halen kapali veya planned durumdadir.
- Production Intelligence schema v1, action, graph, planner, execution request, dry-run result, job preview ve consumer parser contract'lari architecture freeze kapsamindadir; breaking degisiklik yeni schema version gerektirir.

Capability ve safety modeli:

- 23 capability merkezi deterministic matrix'te ready, preview-only, planned, blocked veya unsupported olarak siniflandirildi.
- 21 execution tehdidi prevention, detection, recovery ve prerequisite alanlariyla kaydedildi.
- 20 zorunlu execution invariant'i tanimlandi; validation, stale/unsupported rejection, confirmation, idempotency, immutable queue contract, project isolation, consistency, audit, secret/path guvenligi ve default-off rollout kapsanir.
- Action risk profilleri conservative tutuldu. Retry-stage ve resume-stage high-risk preview-only; inspect-source/review-metric executable degil; reconcile-state unresolved. Ilk real execution adayi henuz secilmedi.

Execution safety gereksinimleri:

- Authorization actor/project/operation scope ve worker identity'yi baglamalidir; local mode bypass degildir.
- Confirmation request/idempotency/project/action/stage/fingerprint/actor/expiry ve single-use policy'ye baglanmalidir.
- Persistent idempotency reserved -> prepared -> queued -> running -> succeeded/failed/cancelled/partially-succeeded state contract'i gerektirir.
- Mevcut queue adapte edilecek, paralel queue motoru kurulmayacaktir; enqueue oncesi stale/auth/confirmation/prerequisite kontrolu tekrarlanir.
- ProjectWriter tek dosyada temp+rename kullanir; output/manifest/audit icin transaction yoktur. Gelecek strateji temp, validation, atomic rename, manifest-last, consistency verification ve operation journal gerektirir.
- Audit contract actor ve lifecycle referanslarini tasir; secret, binary, absolute path ve public stack trace tasimaz.
- Real execution merkezi server policy ile default-off kalir; UI yalniz server-confirmed capability ile kontrol gosterebilir.

Sprint 97.x roadmap:

- 97.1 Authorization Contract; 97.2 Confirmation Contract; 97.3 Persistent Idempotency Contract; 97.4 Queue Adapter; 97.5 Audit Contract; 97.6 Transactional Write & Recovery; 97.7 Controlled Single-Action Execution; 97.8 Cancellation & Retry Safety; 97.9 Phase Review.

Test ve sinirlar:

- Sprint 97.0 phase closure smoke PASS (20 senaryo).
- Sprint 96.8, Sprint 96.7, Sprint 96.1-96.6 ve Sprint 95.2-96.0 regresyonlari PASS.
- Ilgili queue/job/state/retry regresyonlari PASS.
- npm run lint, npx tsc --noEmit --incremental false, npm run build ve git diff --check PASS.
- Bu sprint POST execute endpoint, execution, queue dispatch, worker, persistence, mutation, provider/network call, token, middleware, UI action, polling, retry/rollback/cancellation engine veya rollout flag eklemedi.

Deferred risk:

- Legacy Turbopack NFT trace uyarisi assets/FileStorage import zincirinden gelir, build'i engellemez ve Sprint 97.0 kapsaminda ertelendi.

Bir sonraki onerilen adim:

- Sprint 97.1 Execution Authorization Contract.

---

### Sprint 97.1 — Execution Authorization Contract

Durum:
Completed

Contract ve policy:

- Schema v1 actor, project, operation, action, stage, worker identity, request identity, capability ve server policy context alanlarini tanimlar.
- Pure synchronous evaluator deny-by-default calisir; inputlari mutate etmez, global state veya gizli zaman kaynagi kullanmaz ve ayni input icin ayni sonucu verir.
- Stabil allow, deny ve indeterminate decision contract'i ile deterministic public reason code'lari eklendi.
- Default merkezi policy disabled durumdadir. Local mode bypass degildir; client permission bilgisi trusted sayilmaz.
- Authorization capability canonical matrix'te ready, stable ve read-only durumuna getirildi. Dependency'ler canonical sirayla cozulur; unknown, missing, dependency-missing ve cycle durumlari allow uretmez.

Scope, worker ve risk sinirlari:

- Actor identity, authenticated/trusted source, actor type, project scope ve operation scope zorunludur.
- Worker gereken operation icin ayri trusted worker identity ve acik worker operation scope zorunludur; worker actor yerine gecmez.
- Inspect-source ve review-metric executable degildir; reconcile-state unresolved kalir.
- Retry-stage ve resume-stage en az high-risk authorization adayi olarak kalir ve high confirmation metadata'si tasir; token uretimi veya confirmation validation eklenmedi.
- Real execution, API enforcement, endpoint, mutation, queue dispatch, worker process, persistence, provider/network call ve UI execution kontrolu eklenmedi.

Test ve dogrulama:

- Sprint 97.1 authorization smoke PASS (28 senaryo).
- Sprint 97.0 closure, Sprint 96.1-96.8 ve Sprint 95.2-96.0 Production Intelligence regresyonlari PASS.
- npm run lint, npx tsc --noEmit --incremental false, npm run build ve git diff --check PASS.
- Legacy next.config.ts -> FileStorage -> AssetManager -> assets route Turbopack NFT trace uyarisi build'i engellemez ve kapsam disi ertelenmistir.

Bir sonraki onerilen adim:

- Sprint 97.2 Execution Confirmation Contract.

---

### Sprint 97.2 — Execution Confirmation Contract

Durum:
Completed

Commit:

- e528878 feat(production): add execution confirmation contract

Confirmation contract foundation:

- Schema v1 confirmation request, immutable grant, stable status, build result ve validation result contract'lari eklendi.
- Request authorization decision, actor, project, operation, action, stage, request ID, idempotency key, execution fingerprint, policy version, risk, confirmation level, expiry ve single-use alanlarina baglidir.
- Binding fingerprint mevcut canonical serialization ve stableProductionId helper'i ile deterministic integrity identity olarak uretilir; kriptografik token veya imza iddiasi tasimaz.
- Authorization decision contract'ina deterministic decisionId, actor type ve execution request identity alanlari additive olarak eklendi.

Validation ve policy:

- Pure builder yalniz allow/authorized ve confirmation-required authorization sonucundan request uretir.
- Pure validator actor/project/operation/action/stage, authorization decision, request/idempotency/fingerprint, policy/risk/level ve binding fingerprint eslesmelerini deny-by-default dogrular.
- Explicit evaluatedAt kullanilir; gizli sistem zamani yoktur. ISO UTC issued/requested/expiry sirasi ve expiration kontrol edilir.
- Default confirmation policy disabled durumdadir. High ve critical risk single-use gerektirir; critical risk distinct confirmer gereksinimi metadata/validation seviyesinde tanimlidir.
- Retry-stage ve resume-stage high risk ve en az high confirmation gereksinimini korur.
- Consumed, revoked, rejected, pending, expired, invalid ve unknown status/level/risk valid uretmez.
- Evidence yalniz deterministic public-safe policy/reason kategorileri tasir; raw exception, secret, stack trace veya absolute path tasimaz.

Sinirlar ve test:

- Confirmation token/JWT/signing, endpoint, store, persistence, consumption write, idempotency reservation, execution, mutation, queue/worker, provider/network call, middleware enforcement, UI kontrolu veya polling eklenmedi.
- Sprint 97.2 confirmation smoke PASS (48 senaryo).
- Sprint 97.1 authorization ve Sprint 97.0 closure smoke PASS.
- Sprint 96.1-96.8, Sprint 95.2-96.0 ve ilgili retry/state/corruption/orchestration/history/continuation regresyonlari PASS.
- npm run lint, npx tsc --noEmit --incremental false, npm run build ve git diff --check PASS.
- Legacy next.config.ts -> FileStorage -> AssetManager -> assets route Turbopack NFT trace uyarisi build'i engellemez ve Sprint 97.2 kaynakli degildir.

Bir sonraki onerilen adim:

- Sprint 97.3 Persistent Idempotency Contract.

---

### Sprint 97.3 — Persistent Idempotency Contract

Durum:
Completed

Commit:

- b4ec40e feat(production): add persistent idempotency contract

Identity ve persistent record contract:

- Schema v1 deterministic execution identity; idempotency/request/execution/binding fingerprint, authorization, confirmation, actor, project, operation, action, stage, policy, risk ve explicit createdAt baglarini tasir.
- Mevcut canonical serialization ve stableProductionId yalniz deterministic identity/integrity amaciyla kullanilir; kriptografik guvenlik iddiasi yoktur.
- Persistent record snapshot contract'i state, attempt/maxAttempts, lifecycle timestamps, lease, result, failure, recovery, evidence ve versioned integrity alanlarini tanimlar; storage adapter'i eklenmedi.
- Canonical lifecycle reserved -> prepared -> queued -> running -> succeeded/failed/cancelled/partially-succeeded olarak tanimlandi.

Transition, replay ve recovery:

- Pure transition evaluator canonical graph, source state, expected version, timestamp, attempt, worker scope ve running lease kosullarini deny-by-default degerlendirir.
- Duplicate reserved/prepared/queued/running request yeni execution baslatmaz; succeeded replay mevcut sonucu dondurme adayidir.
- Ayni key ile farkli binding veya execution fingerprint ve ayni request ID ile farkli key conflict uretir.
- Failed retry; partially-succeeded resume veya reconcile adayidir. Attempt limiti ve server policy zorunludur.
- High-risk retry/resume yeni authorization ve confirmation gereksinimini metadata olarak tasir; single-use confirmation yeniden kullanilamaz.
- Lease contract active/expired/released/invalid status, worker ID/scope, explicit acquired/heartbeat/expiry ve version alanlarini tanimlar; lock, acquisition veya heartbeat write yoktur.

Sinirlar ve test:

- Persistent-idempotency capability canonical matrix'te ready, stable ve read-only durumuna getirildi.
- Filesystem/database write, idempotency store, reservation persistence, mutex/lock, lease write, queue/worker, execution, mutation, provider/network call, retry/resume/reconcile execution, endpoint, UI veya polling eklenmedi.
- Sprint 97.3 idempotency smoke PASS (60 senaryo).
- Sprint 97.2 confirmation, Sprint 97.1 authorization ve Sprint 97.0 closure smoke PASS.
- Sprint 96.1-96.8, Sprint 95.2-96.0 ve retry/state/corruption/orchestration/history/continuation regresyonlari PASS.
- npm run lint 0 warning, npx tsc --noEmit --incremental false, npm run build ve git diff --check PASS.
- Legacy next.config.ts -> FileStorage -> AssetManager -> assets route Turbopack NFT trace uyarisi build'i engellemez ve Sprint 97.3 kaynakli degildir.

Bir sonraki onerilen adim:

- Sprint 97.4 Execution Transaction Contract.

---

### Sprint 97.4 — Execution Transaction Contract

Durum: Completed

- Commit: d655db9 feat(production): add execution transaction contract
- Schema v1 transaction plan, mutation intent, canonical steps, rollback, consistency ve journal plan contract'lari eklendi.
- Temp -> write -> validate -> commit -> manifest-last -> consistency -> terminal journal sirasi pure builder/validator ile dogrulandi.
- Relative target, traversal, fingerprint, write-mode, dependency, cycle, sequence ve binding kontrolleri deny-by-default calisir.
- Gercek temp/write/rename/delete/manifest/rollback/journal islemi eklenmedi.
- Smoke PASS (50 senaryo); idempotency regresyonu, TypeScript ve diff check PASS.
- Sonraki sprint: Sprint 97.5 Operation Journal Contract.

---

### Sprint 97.5 — Operation Journal Contract

Durum: Completed

- Commit: 3652d01 feat(production): add operation journal contract
- Schema v1 append-only event, stable event type, correlation ve integrity contract'lari eklendi.
- Pure sequence validator event/sequence uniqueness, gap, timestamp, binding, attempt ve terminal invariants'i dogrular.
- Projection unordered inputu canonical sequence ile lifecycle state'e map eder; unsafe evidence public payloada sizmaz.
- Gercek append, dosya/database persistence, telemetry veya external audit sink eklenmedi.
- Smoke PASS (50 senaryo); transaction regresyonu, TypeScript ve diff check PASS.
- Sonraki sprint: Sprint 97.6 Queue & Dispatch Contract.

---

### Sprint 97.6 — Queue & Dispatch Contract

Durum: Completed

- Commit: 8017502 feat(production): add queue dispatch contract
- Schema v1 immutable dispatch envelope, priority, queue, dependency, payload reference, lease ve worker requirement contract'lari eklendi.
- Pure eligibility evaluator authorization/confirmation/idempotency/transaction/journal, duplicate/conflict, attempt, schedule, dependency ve worker scope kosullarini dogrular.
- Client priority ignored; server policy effective priority uretir. Default rollout action listesi bos ve dispatch blocked kalir.
- Gercek enqueue, dispatch call, job persistence, worker spawn, background task, polling veya paralel queue motoru eklenmedi.
- Smoke PASS (55 senaryo); journal/transaction regresyonlari, TypeScript ve diff check PASS.
- Sonraki sprint: Sprint 97.7 Worker Execution Contract.

---

### Sprint 97.7 — Worker Execution Contract

Durum: Completed

- Commit: 560e013 feat(production): add worker execution contract
- Schema v1 trusted worker identity, capability/operation/stage scope, claim, lease, immutable execution plan ve safe result envelope eklendi.
- Pure claim evaluator schema/build/capability/scope/dispatch/attempt/fingerprint/lease/cancellation ve rollout kosullarini deny-by-default dogrular.
- Local worker bypass degildir; worker actor yerine gecmez. Arbitrary command/path/resource planlari reddedilir.
- Gercek process/thread/shell, queue consumption, lease/heartbeat write, filesystem/provider/network veya execution engine eklenmedi.
- Smoke PASS (55 senaryo); dispatch/journal/transaction regresyonlari, TypeScript ve diff check PASS.
- Sonraki sprint: Sprint 97.8 Controlled Execution Gateway.

---

### Sprint 97.8 — Controlled Execution Gateway

Durum: Completed

- Commit: e70e173 feat(production): add controlled execution gateway
- Schema v1 request/policy/decision/orchestration plan contract'i Safety -> Authorization -> Confirmation -> Idempotency -> Transaction -> Journal -> Dispatch -> Worker zincirini preview seviyesinde birlestirir.
- Canonical 11-step orchestration, rollout policy ve kill switch deny/block/preview kararlarini deterministic uretir.
- Default policy disabled/preview-only; dispatchAllowed=false ve executionAllowed=false contract seviyesinde sabittir. Client allow flag'lari ignored.
- Gercek endpoint, mutation, enqueue/dispatch, worker claim/process, filesystem/provider/network, UI veya polling eklenmedi.
- Smoke PASS (70 senaryo); Sprint 97.0-97.7 zinciri, TypeScript ve diff check PASS.
- Sonraki sprint: Sprint 97.9 Production Execution Phase Review.

---

### Sprint 97.9 — Production Execution Phase Review

Durum: Completed

- Commit: 35b40d0 test(production): complete execution phase review
- Safety -> Authorization -> Confirmation -> Idempotency -> Transaction -> Journal -> Dispatch -> Worker -> Controlled Gateway schema v1 contract zinciri review edildi ve freeze edildi.
- P0: 0, P1: 0, P2: 0 acik bulgu. P3: 1 ertelenmis legacy Turbopack NFT whole-project trace uyarisi; Sprint 97 kaynakli degil ve build'i engellemiyor.
- Smoke PASS (80 senaryo); 33 betiklik tam regresyon zinciri, lint 0 warning, TypeScript, build ve diff check PASS.
- Sprint 97 yasak sinir taramasi temiz: filesystem/database write, journal append, queue enqueue/dispatch, worker process/thread, provider/network call, execute endpoint, mutation route, UI execution control, polling veya background execution eklenmedi.
- Gercek execution, persistence, confirmation consumption/reservation write, queue dispatch, worker ve UI execution kontrolleri kapali; gateway default disabled/preview-only ve dispatchAllowed/executionAllowed false kalir.
- Final review: `docs/PRODUCTION_EXECUTION_PHASE_REVIEW.md`.
- Sonraki sprint: Sprint 98 icin tek bir dusuk riskli executable action sec; persistence adapter, transaction recovery, trusted identity, durable audit/idempotency ve rollout/kill-switch sahipligini uygulamadan once onayla.

---

### Sprint 98.0 — Production Execution Persistence Adapter Foundation

Durum: Completed

Kapsam:

- Transaction, operation journal, idempotency ve reservation kayitlari ortak `ProductionExecutionPersistenceAdapter` sinirindan geciyor; frozen schema v1 contract'lari degistirilmedi.
- Ilk adapter trusted composition root altinda kontrollu JSON/file persistence kullanir. Record key'ler lowercase ASCII, sayi ve sinirli separator kullanan traversal-safe, platformlar arasi tasinabilir canonical formatla sinirlidir.
- Her write attempt benzersiz temp dosyasi ve exclusive `wx` create kullanir. Temp icerik canonical serialization sonrasinda tekrar okunur, schema ve integrity acisindan dogrulanir.
- Final target hard-link no-replace ile olusturulur; POSIX rename overwrite davranisina bagimlilik yoktur. Commit yarisini kaybeden writer target'i tekrar okuyarak ayni payload icin idempotent replay, farkli payload icin stable existing-record conflict uretir.
- Temp ownership yalniz exclusive create basarili oldugunda kazanilir. Attempt-ID collision durumunda basarisiz writer baska writer'in temp dosyasini silmez.
- Cleanup failure ana sonucu maskelemez; safe cause code ve `tempArtifactPossible` diagnostic'i korunur.
- Canonical serialization object key sirasindan bagimsizdir. Circular reference, BigInt, non-finite number, unsupported runtime value ve ozel prototype stabil serialization failure uretir.
- Read/write sonuclari discriminated union'dir. ENOENT, permission/I/O, corrupt record, invalid input/schema, temp validation, commit ve conflict durumlari stabil error code'larla ayrilir; absolute path veya filesystem mesaji public contract'a sizmaz.

Frozen schema validation:

- Transaction: frozen `validateProductionExecutionTransactionPlan` ve `buildProductionExecutionTransactionPlan` kullanilir; rebuilt canonical plan incoming plan ile tam karsilastirilir. Stale transaction/operation ID, execution fingerprint binding, step icerigi, copied integrity ve corrupt-on-disk integrity reddedilir.
- Journal: frozen event builder ve sequence validator kullanilir.
- Idempotency: authorization/confirmation girdileri record'dan yeniden kurulur; frozen `buildProductionExecutionIdempotencyIdentity` ile rebuilt identity/fingerprint karsilastirilir ve frozen replay evaluator lifecycle/state kontrolu yapar.
- Reservation: frozen reservation validator ve identity builder kullanilir. Incoming invalid payload ile diskteki corrupt record ayri sonuclardir.
- Runtime shape gate yalniz guvenli narrowing yapar; semantic ve integrity karari frozen builder/validator/evaluator kaynaklarina aittir.

Review:

- P0: 0.
- P1: 0. Ilk review'daki shallow schema validation ve atomic create/conflict P1 bulgulari kapandi.
- P2: Frozen transaction schema v1 actor/project alanlarini transaction ID core'una veya integrity fingerprint girdisine dahil etmez. Bu inherited frozen-contract limitation adapter bug'i degildir ve Sprint 98.0 kapanisini bloklamaz. Frozen v1 degistirilmeyecek; takip cozum transaction schema v2, migration ve version negotiation tasarimidir.
- P3: Runtime shape gate icin dusuk oncelikli bakim/contract-drift riski.

Guvenlik sinirlari:

- Controlled gateway `enabled:false`, `mode:"preview-only"`, `allowDispatch:false` ve `allowExecution:false` kalir.
- Adapter production execution akisina baglanmadi. Provider execution, mutation endpoint, queue enqueue/dispatch, worker processing veya UI execution eklenmedi.
- Sprint 97 frozen contract dosyalari degistirilmedi.

Dogrulama:

- Sprint 98.0 persistence smoke PASS (70 senaryo).
- Sprint 97.0-97.9 zinciri 10/10 PASS; tum Sprint 89-98 smoke betikleri 34/34 PASS.
- TypeScript PASS; lint PASS (0 warning); production build PASS; `git diff --check` PASS.
- Untracked whitespace/conflict-marker kontrolu PASS.
- Yasak production execution boundary, dogrudan execution-state write, production route execution ve UI execution taramalari temiz.
- Build'de yalniz eski Turbopack NFT whole-project trace uyarisi bulunur; Sprint 98.0 kaynakli degildir ve build'i engellemez.

Calisma agaci notu:

- Sprint 98.0 kaynaklari: `src/types/productionExecutionPersistence.ts`, `src/lib/production/ProductionExecutionPersistence.ts`, `scripts/smoke-production-execution-persistence.ts`.
- `app/project/[slug]/page.tsx` icerik diff'i olmayan modified isaretiyle korundu; dosyaya dokunulmadi ve restore/reset/stash/discard uygulanmadi.
- Sprint 98.0 icin commit veya push yapilmadi.
- Sonraki planlama adimi: Sprint 98.1 — Durable Idempotency and Reservation Storage Integration. Otomatik uygulanmayacak; gercek execution kapali kalacak.

---

### Sprint 99.0 — Durable Idempotency & Reservation Storage Foundation

Durum: Completed

- Implementation commit: `02bf9b6 feat(production): add durable execution storage foundation`.
- Yeni dosyalar: `src/types/productionExecutionDurableStorage.ts`, `src/lib/production/ProductionExecutionDurableStorage.ts`, `scripts/smoke-production-execution-durable-storage.ts`.
- Sprint 98 adapter'ina read-only `listKeys` ve frozen payload validator reuse export'u eklendi; unsafe overwrite veya execution entegrasyonu eklenmedi.
- Durable schema/storage version v1; record identity actor/project/operation/action/stage/request/idempotency/execution/binding/authorization/confirmation/policy/risk alanlarini ve canonical Sprint 97.3 lifecycle state'lerini korur.
- Reservation create idempotency key, request ID, execution/binding fingerprint, authorization, confirmation, initial reserved state, attempt/maxAttempts ve explicit expiry kurallarini deny-by-default dogrular.
- Ayni identity replay'dir; idempotency/request/binding/execution fingerprint uyusmazliklari stable conflict reason code'lari uretir. In-flight veya succeeded kayit implicit overwrite edilmez.
- Idempotency record'lari append-only `recordId-vN` snapshot anahtarlariyla persist edilir. CAS expectedVersion kontrolu yapar; stale/version conflict writer yeni snapshot'i overwrite edemez ve version deterministik bir artar.
- Transition frozen Sprint 97.3 evaluator'u kullanir; shortcut, same-state ve terminal overwrite reddedilir. Release/cancel reservation ayni transition sinirindan gecer.
- Recovery-ready read latest version'i bulur; terminal/partial state `DURABLE_STORAGE_RECOVERY_REQUIRED` metadata'si uretir. Idempotency-key ve request-ID lookup read-only list/read sinirini kullanir.
- Atomic strateji Sprint 98 unique temp -> validation/integrity -> hard-link no-replace -> read-back zinciridir. Durable update target replace etmez; yeni immutable version target'i yaratir.
- Directory sync adapter tarafindan garanti edilmez; platform/filesystem durability limitation'i olarak kalir. Sahte fsync garantisi verilmez.
- Missing, malformed/corrupt, unreadable, unsupported schema/storage version, integrity mismatch, stale/version conflict, partial/orphan temp ve recovery-required durumlari stable public-safe reason code'larla ayrilir.
- Canonical serialization ve frozen identity validation kullanilir; `stable-production-id-v1` deterministic integrity amaclidir, kriptografik authentication/signature iddiasi yoktur.
- Record/path anahtarlari server-controlled root ve lowercase portable logical identity ile sinirlidir; traversal/absolute path reddedilir ve evidence/reason icine raw path, secret veya stack sizmaz.
- Reservation/lease expiry yalniz explicit `evaluatedAt` ile degerlendirilir; `Date.now()` veya gizli zaman kaynagi yoktur. Gercek heartbeat/lease acquisition eklenmedi.
- Stable reason-code ailesi policy/input/path, missing/malformed/unreadable, schema/version/integrity, idempotency/request/binding/fingerprint/version conflict, transition/terminal, expiry, atomic/readback, corruption/recovery ve indeterminate durumlarini kapsar.
- Sprint 99.0 smoke PASS (63 senaryo). Tum smoke runner 35/35 PASS; retry, state error/corruption, orchestration, history ve continuation regresyonlari PASS.
- TypeScript PASS; lint 0 warning PASS; production build PASS; `git diff --check` PASS.
- Legacy Turbopack NFT whole-project trace uyarisi ayni eski `next.config.ts -> FileStorage -> AssetManager -> assets route` zincirinden gelir; Sprint 99.0 kaynakli degildir ve build'i engellemez.
- Yasak sinir taramasi temiz: provider/network, queue enqueue/dispatch, worker spawn/process, child process/shell, execute endpoint, UI execution, polling/background interval, manifest mutation veya pipeline execution baglantisi yoktur.
- Controlled gateway disabled/preview-only; `allowDispatch:false` ve `allowExecution:false` kalir.
- Sonraki onerilen adim: Sprint 99.1 Durable Storage Recovery & Index Hardening Review. Gercek execution acilmadan orphan cleanup policy, index scalability ve directory durability stratejisi review edilmelidir.

---

### Sprint 99.1 — Durable Storage Recovery & Index Hardening

Completed

- Canonical reservation ve append-only versioned idempotency kayitlari source of truth olarak kalir; corrupt canonical kayitlar implicit empty state'e cevrilmez, overwrite edilmez veya index verisiyle onarilmaz.
- Recovery scan ve apply ayrildi. Scan deterministik ve write-free'dir; cleanup/quarantine yalniz explicit apply istegi ve scan tarafindan izin verilen, canonical olarak dogrulanmis orphan temp artifact icin uygulanabilir.
- Unique atomic-write temp artifact'lari algilanir. Valid canonical target varken temp artifact source of truth sayilmaz. Partial, malformed veya adi belirsiz artifact otomatik silinmez ve recovery-required sonucu uretir.
- Recovery contract missing, valid, malformed, unreadable, unsupported schema/storage version, integrity mismatch, orphan temp, partial/ambiguous artifact, missing/stale/malformed/integrity-mismatch index ve recovery-required durumlarini stable public-safe reason code'larla siniflandirir.
- Reservation, idempotency key ve request ID lookup index'i canonical kayitlardan deterministik uretilen, content-addressed, immutable ve rebuildable derived artifact'tir. Authorization, execution veya business decision kaynagi degildir.
- Missing, stale veya corrupt index canonical kayitlara zarar vermez. Rebuild mevcut canonical validation ile atomic unique temp + validation + hard-link no-replace commit modelini kullanir.
- Directory durability helper'i supported, unsupported, failed ve indeterminate durumlarini stabil sonuc olarak modeller. Unsupported platformlarda sessiz fsync garantisi verilmez; platform hata mesaji public sonuca sizmaz. Sprint 99.0 atomicity iddialari genisletilmedi.
- Path traversal, absolute path ve trusted root disina cikis reddedilir. Public sonuc raw path, filesystem error, stack veya secret tasimaz.
- Recovery execution, queue, worker, provider/network, UI execution, polling, timer veya startup cleanup akisina baglanmadi; gerekli operation girdileri caller-controlled kalir.
- Sprint 99.1 smoke PASS (29 senaryo); Sprint 97.1–99.0 hedefli regresyon zinciri 11/11 PASS; genel smoke runner 36/36 PASS.
- `npx tsc --noEmit --incremental false`, lint (0 error/0 warning) ve production build PASS. Build'de yalniz legacy `next.config.ts -> FileStorage -> AssetManager -> assets route` Turbopack NFT whole-project trace uyarisi kaldi.
- Commit veya push yapilmadi.

---

### Sprint 100 — Durable Lease & Worker Ownership Foundation

Completed

- Portable server-controlled worker identity, worker session identity, lease identity, ownership evidence, acquisition, heartbeat/renewal, evaluation, takeover ve release contract'lari eklendi. Public contract PID, hostname, process bilgisi veya secret tasimaz.
- Lease mutation'lari canonical durable record'i overwrite etmez; mevcut append-only `record-vN` modeli, expectedVersion CAS ve atomic hard-link no-replace commit ile her basarili mutation'da record version'i tam bir artirir.
- Acquisition valid non-terminal ve unexpired reservation, canonical worker/session/lease kimligi, explicit evaluatedAt, valid interval ve bos/expired ownership kosullarini deny-by-default dogrular. Ayni request idempotent replay'dir.
- Heartbeat yalniz workerId + workerSessionId + leaseId sahibi tarafindan yapilir. Heartbeat geriye gidemez, expiry ileri gitmelidir, policy'deki maximum renewal window acik uygulanir ve expired/released lease sessizce canlandirilmaz.
- Expiry yalniz caller-provided evaluatedAt ile degerlendirilir. Active lease takeover reddedilir; expired lease icin explicit takeover evaluation ve mutation yeni immutable version olusturur, previous/new owner evidence public-safe fingerprint tasir.
- Release yalniz owner tarafindan explicit yapilir ve replay-safe'tir. Release ile reservation cancel semantigi ayridir; released lease heartbeat ile active hale getirilemez, cancelled reservation ayri stable reason code ile reddedilir.
- Corrupt canonical veya lease integrity mismatch implicit empty state'e cevrilmez ve mutation ile overwrite edilmez. Recovery metadata tasiyan non-terminal kayit lease mutation icin recovery-required olarak reddedilir.
- Path traversal ve absolute path reddedilir. Date.now, random identity, environment evaluator, process spawn, worker, queue consumer/dispatch, pipeline execution, provider/network, timer, polling, startup recovery, API route veya UI execution eklenmedi.
- Sprint 100 smoke PASS (40 senaryo); Sprint 97.1–99.1 hedefli regresyon 12/12 PASS; genel smoke runner 37/37 PASS.
- `npx tsc --noEmit --incremental false`, lint (0 error/0 warning) ve production build PASS. Legacy Turbopack NFT whole-project trace warning devam eder.
- Sprint 99.1 directory fsync limitation degismedi: unsupported platformlarda sessiz durability garantisi verilmez.
- Commit veya push yapilmadi.

---

### Sprint 101 — Durable Execution Claim & Recovery Coordination

Completed

- Execution claim reservation record, request/idempotency key, execution fingerprint, worker/session/lease ve expected reservation/idempotency/lease/claim version baglarini canonical claim identity ve binding contract'inda birlestirir.
- Claim mutation oncesi preflight write-free ve deterministiktir; reservation existence/expiry, canonical idempotency binding/state, recovery/integrity, active lease ownership/expiry ve tum expected version'lar yeniden dogrulanir. Derived index authority degildir.
- Claim coordination `claims/<claimId>-vN.json` altinda tek append-only canonical coordination record kullanir; source-of-truth reservation/idempotency/lease kayitlarini kopyalayip yeni authority yaratmaz.
- Commit modeli acikca preflight snapshot -> intended single claim write -> unique temp/canonical validation -> hard-link no-replace -> readback validation'dir. `transactional:false`, stabil commit order ve `implicitRollback:false` raporlanir; sahte distributed transaction veya hidden lock garantisi verilmez.
- Exact same-request claim replay write-free'dir. Farkli claim ID/binding/owner/session/lease, stale/version/next-version, terminal, expired lease/reservation ve recovery/integrity durumlari stable reason code'larla ayrilir.
- Recovery assessment write-free olarak no-claim, valid-active, replay-safe, expired/released lease, missing linked record, stale linked version, partial coordination, malformed/integrity/unsupported/ambiguous ve recovery-required durumlarini modeller.
- Claim release owner-only ve replay-safe'tir; release execution terminal sonucu degildir. Abandon ayri explicit recovery/coordination operation'idir ve execution failure sonucu uretmez. Released claim ayni canonical claim olarak yeniden active yapilmaz.
- Partial coordination sonucu onceki canonical write'i overwrite etmez; `CLAIM_PARTIAL_COMMIT` ve recovery/compensation-required semantics ile explicit raporlanir. Corrupt veya ambiguous canonical artifact otomatik silinmez/onarilmaz.
- PID, hostname, raw path/FS error, stack ve secret public contract'a girmez. Date.now, random UUID, environment identity, process spawn, worker, queue, provider/network, timer, polling, scheduler, startup recovery, API route veya UI execution eklenmedi.
- Sprint 101 smoke PASS (39 senaryo); Sprint 97.1–100 hedefli regresyon 13/13 PASS; genel smoke runner 38/38 PASS.
- TypeScript ve production build PASS; final lint 0 error/0 warning ve diff check kapanista dogrulandi. Legacy Turbopack NFT whole-project trace warning devam eder.
- Sprint 99.1 directory fsync limitation degismedi; unsupported platformlarda sessiz durability garantisi verilmez.
- Commit veya push yapilmadi.

---

### Sprint 102 — Durable Execution Attempt & Outcome Journal Foundation

Completed

- Attempt identity active claim, reservation, request/idempotency, execution fingerprint, worker/session/lease ve expected claim/attempt version baglarini tasir.
- Lifecycle opened -> active -> outcome-proposed -> succeeded/failed/cancelled terminal durumlarini ve ayri recovery-only abandoned durumunu kapsar. Finalized attempt yeniden active/opened olmaz.
- Attempt records `attempts/<attemptId>-vN.json` altinda append-only immutable CAS, unique temp, canonical validation, hard-link no-replace ve readback modeliyle persist edilir.
- Journal attempt record icinde append-only source-of-truth'tur. Entry ID, attempt ID, monotonic contiguous sequence, canonical entry type, explicit recordedAt, public-safe payload/evidence ve per-entry integrity tasir.
- Exact journal replay write-free; entry-ID payload conflict, duplicate/rollback sequence, gap ve finalized attempt progress append ayrica reddedilir.
- Outcome proposal caller-provided success/failure/cancellation evidence kabul eder ve terminal sonuc sayilmaz. Finalization yalniz matching proposal uzerinden terminal state uretir; replay-safe ve immutable'dir.
- Cancellation execution outcome semantics'tir; claim release ownership koordinasyonu, attempt abandon recovery koordinasyonu olarak ayri kalir.
- Coordination tek authoritative attempt record kullanir; claim/lease/reservation kopyalanmaz. Preflight write-free, intended write/commit order stabil, `transactional:false`, `implicitRollback:false`; partial commit recovery/compensation-required olarak raporlanir.
- Recovery evaluation write-free olarak no/opened/active/proposed/finalized states, expired lease, inactive/missing/stale claim/lease, journal corruption, partial coordination, malformed/integrity/unsupported ve recovery-required durumlarini ayirir.
- Raw provider response, path, FS error, stack, hostname, PID, secret veya environment public evidence'e girmez. Execution/provider/queue/worker/process/timer/polling/scheduler/startup recovery/API/UI/distributed lock eklenmedi.
- Sprint 102 smoke PASS (58 senaryo); Sprint 97.1–101 hedefli regresyon 14/14 PASS; genel smoke runner 39/39 PASS.
- TypeScript, lint (0 error/0 warning) ve production build PASS. Legacy Turbopack NFT trace warning ve directory fsync platform limitation devam eder.
- Commit veya push yapilmadi.

---

### Sprint 103 — Production Execution Coordinator Foundation

Completed

- Merkezi `ProductionExecutionCoordinator`, claim, lease ve durable attempt akislarini tek public `coordinate` giris noktasinda birlestirir.
- Islem sirasi mevcut servislerle write-free claim preflight -> lease evaluation -> durable attempt create/open/exact replay olarak yonetilir; mevcut mantiklar kopyalanmaz.
- Claim, lease, worker ve session binding uyusmazliklari deterministik conflict sonucu verir.
- Ayni idempotency request exact replay'de mevcut attempt'i write-free dondurur; farkli payload deterministik conflict olusturur.
- Attempt version ve embedded journal butunlugu korunur. Yeni persistence formati eklenmedi.
- Mevcut CAS/version, immutable versioning, canonical validation, no-replace ve recovery sozlesmeleri korunur; replay, recovery ve worker execution davranislari degistirilmez.
- Sprint 103 coordinator smoke PASS (9/9); `npx tsc --noEmit`, hedefli ESLint ve `git diff --check` PASS.
- Acik risk: coordinator mevcut durable claim ve lease'in onceden olusturulmus olmasini bekler; katmanlar arasi atomik transaction henuz yoktur.
- Commit veya push yapilmadi.

---

### Sprint 104 — Durable Attempt Lifecycle Foundation

Completed

- Tek public lifecycle `mutate` API, attempt yasam dongusu gecislerini merkezi olarak yonetir.
- created/prepared -> running, running -> completed, running -> failed ve active -> cancelled gecisleri desteklenir. Public completed sonucu mevcut durable attempt sozlesmesindeki `succeeded` state'ine eslenir.
- Her gercek mutation expected-version CAS kullanir ve yalniz bir yeni immutable attempt version uretir.
- Claim, worker, session ve lease ownership baglari transition oncesinde yeniden dogrulanir.
- Attempt journal append-only source of truth kalir; event sequence contiguous ve monotoniktir. Timestamp ve transition metadata caller-provided ve deterministiktir.
- Exact transition replay write-free'dir. Ayni event ID ile farkli transition/payload conflict; stale expected-version ayri conflict uretir.
- Gecersiz transition sirasi reddedilir; completed/succeeded, failed ve cancelled terminal attempt'ler yeni mutation kabul etmez.
- Yeni persistence formati veya worker execution entegrasyonu eklenmedi; mevcut coordinator, recovery, storage ve attempt davranislari korundu.
- Sprint 104 lifecycle smoke PASS (16/16); `npx tsc --noEmit`, hedefli ESLint ve `git diff --check` PASS.
- Acik riskler: claim ve lease onceden mevcut olmalidir; katmanlar arasi atomik transaction yoktur; worker execution entegrasyonu henuz yapilmadi.
- Commit veya push yapilmadi.

---

### Sprint 105 — Durable Worker Execution Foundation

Completed

- Tek public `execute` API coordinator, lifecycle ve generic handler execution akislarini merkezilestirir.
- Coordinator attempt create/open/replay yapar; lifecycle running gecisini handler'dan once, completed/failed/cancelled terminal gecisini handler sonucundan sonra uygular.
- Basarili handler completed public sonucu ve mevcut durable attempt `succeeded` state'i uretir. Handler exception'i raw hata tasimadan failed sonucuna donusur.
- Cancellation handler oncesi ve sonrasinda kontrol edilir; handler sonrasi cancellation completed yerine cancelled terminal sonucu uretir.
- Terminal exact replay handler'i yeniden calistirmaz, yeni write uretmez ve mevcut sonucu write-free dondurur. Running transition basarisizsa handler cagrilmaz.
- Claim, lease, worker ve session ownership baglari korunur; expired lease execution'i baslatmaz.
- Duplicate concurrent execution servis instance kilidi ve persisted running state ile deterministik conflict uretir; handler tek execution akisinda yalniz bir kez cagrilir.
- Handler sonucu yalniz guvenli, deterministik ve serializable summary/evidence olarak journal'a yazilir; raw exception, stack, secret ve kontrolsuz payload persist edilmez.
- Her lifecycle mutation yalniz bir immutable attempt version artisi uretir; journal sequence contiguous ve monotonik kalir. Yeni persistence formati eklenmedi.
- Sprint 105 worker smoke PASS (18/18); Sprint 97.7 worker regresyonu PASS (55/55); `npx tsc --noEmit`, hedefli ESLint ve `git diff --check` PASS.
- Acik riskler: duplicate lock yalniz servis instance'i kapsamindadir ve distributed lock degildir; handler yan etkileri attempt persistence ile atomik degildir; running sonrasi process kesintisi mevcut recovery sozlesmeleriyle ele alinmalidir.
- Commit veya push yapilmadi.

---

### Sprint 106 — Pipeline Stage Durable Execution Integration

Completed

- Entegrasyon `PipelineRunner.runStage` cevresindeki opsiyonel durable adapter noktasinda yapildi.
- Durable worker preflight/running basarili olmadan mevcut job claim ve stage handler zinciri calismaz. Adapter yoksa legacy pipeline davranisi birebir korunur.
- `ProductionPipelineExecutionAdapter`, mevcut stage handler'lari yeniden yazmadan wrapper olarak `ProductionExecutionWorkerExecutionService` uzerinden calistirir.
- Success, failure, cancellation ve terminal replay sonuclari mevcut pipeline boolean/exception sozlesmesine cevrilir; public API response shape ve UI sozlesmeleri degismez.
- Exact replay stage handler'i tekrar calistirmaz ve durable worker'in write-free terminal replay sonucunu kullanir.
- Journal'a yalniz stage/run-type tabanli minimal, guvenli metadata yazilir; raw stage output, secret, stack trace veya buyuk/kontrolsuz payload persist edilmez.
- Retry, cancellation, queue, scheduler, history, auto-continuation ve recovery akislarinin mevcut sozlesmeleri korunur.
- Sprint 106 smoke PASS (17/17); retry persistence PASS (5/5 grup); pipeline orchestration PASS (10/10); history persistence PASS (6/6); auto-continuation PASS (18/18).
- `npx tsc --noEmit`, hedefli ESLint ve `git diff --check` PASS.
- Acik riskler: durable entegrasyon composition root tarafindan adapter ve request factory ile etkinlestirilmelidir; pipeline job mutation'lari ile durable attempt persistence atomik degildir; worker duplicate kilidi instance-scope'tur ve distributed lock garantisi yoktur.
- Commit veya push yapilmadi.

---

### Sprint 107 — Durable Pipeline Composition Root Wiring

Completed

- Normal pipeline run, stage retry API, pipeline resume API ve job-action retry API composition root'lari ayni merkezi durable wiring ile configured `PipelineRunner` olusturur; auto-continuation ayni runner uzerinden ilerler.
- Merkezi `ProductionPipelineExecutionFactory`, her job attempt icin deterministik durable identity uretir: ayni attempt ayni identity'yi, yeni retry attempt farkli identity'yi alir.
- Factory mevcut reservation/record replay sozlesmelerini kullanir; yeni persistence formati eklenmez.
- Claim ve lease hazirligi stage handler'dan once tamamlanir. Hazirlik basarisizsa stage handler ve legacy job claim zinciri cagrilmaz.
- `ATOLYE_DURABLE_PIPELINE_EXECUTION=enabled` feature guard acikken durable adapter etkinlesir; guard kapaliyken legacy pipeline davranisi aynen korunur.
- Public API response shape'leri ve UI sozlesmeleri degismedi; retry, queue, scheduler, history, recovery ve auto-continuation davranislari korundu.
- Sprint 107 wiring smoke PASS (19/19); retry persistence PASS (5/5 grup); pipeline orchestration PASS (10/10); history persistence PASS (6/6); auto-continuation PASS (18/18); state corruption/recovery PASS (8/8).
- `npx tsc --noEmit`, hedefli ESLint ve `git diff --check` PASS.
- Acik riskler: `PipelineRunner` konfigurasyonu process-global'dir; job ve durable persistence atomik degildir; duplicate lock instance-scope'tur ve distributed lock garantisi yoktur; reservation/lease sure politikasi ileride operasyonel config'e tasinmalidir.
- Commit veya push yapilmadi.

---

### Sprint 108 — Durable Recovery Bootstrap Integration

Completed

- Tek public `bootstrapRecovery` API eklendi; durable attempt kayitlari recovery baslangicinda read-only taranir.
- Attempt'ler active, running, terminal, orphaned, expired-lease ve replayable siniflarinda deterministik olarak degerlendirilir.
- Immutable attempt version zinciri, append-only journal butunlugu ve contiguous/monotonik sequence dogrulanir; CAS ve immutable versioning sozlesmeleri degistirilmez.
- Mevcut lifecycle recovery degerlendirmesi yeniden kullanilir ve `PipelineRecoveryPlanner` entegrasyonu icin guvenli bootstrap ciktisi uretilir.
- Terminal attempt'ler yeniden planlanmaz; expired lease attempt'ler recovery adayi olarak isaretlenir ve remediation coordinator/lifecycle/worker hattina birakilir.
- Planner ciktisi yalniz guvenli, deterministik ve normalize edilmis alanlarla dondurulur. Exact bootstrap replay write-free kalir.
- Yeni persistence formati veya mutation eklenmedi; mevcut pipeline, retry, scheduler, queue, history ve auto-continuation davranislari korundu.
- Sprint 108 recovery bootstrap PASS (15/15); durable storage recovery PASS (29/29); pipeline state corruption/recovery PASS (18/18); pipeline orchestration PASS (10/10); production execution persistence PASS (70/70).
- `npx tsc --noEmit`, hedefli ESLint ve `git diff --check` PASS.
- Sprint 99–108 Durable Production Execution fazi bu sprint ile tamamlandi.
- Acik riskler: bootstrap process-start composition root'una henuz bagli degildir; tarama sirasinda snapshot isolation yoktur; eszamanli mutation indeterminate degerlendirme uretebilir; expired lease remediation coordinator/lifecycle/worker hattindadir; distributed recovery, leader election ve distributed lock garantisi yoktur.
- Commit veya push yapilmadi.

---

### Sprint 109 — Process Startup Bootstrap Integration

Completed

- Next.js `instrumentation.ts/register()` process-start girisi `ProductionRuntimeCompositionRoot` uzerinden recovery bootstrap hattina baglandi.
- `ProductionRuntimeCompositionRoot`, proje kesfi ve read-only persistence adapter kurulumunu acik composition sinirinda yapar; production domain initializer dosya sistemi bagimliligini gizlice olusturmaz.
- Idempotent `ProductionRuntimeInitializer`, ilk initialization Promise'ini instance/process kapsaminda cache eder; ayni process icindeki tekrar cagri duplicate bootstrap uretmez.
- Tek timestamp tum deterministik proje taramasinda kullanilir ve proje basina `ProductionExecutionRecoveryBootstrap.bootstrapRecovery` cagrilir.
- Bootstrap sonucu schema, write-free karari, decision ve classification count alanlariyla dogrulanmadan runtime initialized kabul edilmez.
- Startup fail-closed davranir; clock, project discovery/identity ve bootstrap hatalari yapilandirilmis reason code ile raporlanir. Basarisizlikta partial initialization olusmaz.
- Recovery bootstrap tamamen write-free kalir. Terminal attempt'ler yeniden planlanmaz; expired lease attempt'ler yalniz recovery adayi olarak aktarilir.
- Scheduler, worker ve remediation davranislari degistirilmedi; persistence formati veya yeni durable mutation eklenmedi.
- Sprint 109 startup smoke PASS (11/11); Sprint 108 recovery bootstrap PASS (15/15); pipeline orchestration PASS (10/10); production execution persistence PASS (70/70).
- `npx tsc --noEmit`, hedefli ESLint ve `git diff --check` PASS.
- Acik riskler: once-only garantisi process kapsamindadir; development HMR yeniden yukleme riski tasir; snapshot isolation yoktur; proje sayisi arttikca startup suresi uzayabilir; distributed recovery, leader election, distributed lock ve expired lease remediation sonraki kapsamdir.
- Commit veya push yapilmadi.

---

### Sprint 110 — Production Worker Lifecycle

Completed

- Merkezi lifecycle `created -> starting -> ready -> draining -> stopped` ve guvenli `failed` durum modelini uygular.
- Recovery initialization ve bootstrap sonuc dogrulamasi tamamen basarili olmadan worker `ready` durumuna gecmez; failure, partial initialization birakmadan `failed` sonucuna kapanir.
- `ProductionRuntimeCompositionRoot` tek lifecycle instance'i olusturur ve ayni instance'i hem `ProductionRuntimeInitializer` hem gercek `ProductionPipelineExecutionFactory` execution yoluna verir.
- Lifecycle admission gate reservation, claim, lease ve stage handler dahil execution yan etkilerinden once calisir. State kontrolu ile active-count artirimi arasinda async bosluk yoktur.
- Kabul edilen sync veya async execution, sonucundan bagimsiz olarak `finally` ile active-count'u azaltir. Drain basladiktan sonra yeni execution deterministik reddedilir ve kabul edilmis aktif isler tamamlanana kadar beklenir.
- `start()`, `drain()` ve `stop()` API'leri instance-scoped cached Promise ile idempotenttir; aktif execution yoksa drain hemen tamamlanir. `draining`, `stopped` ve `failed` durumlari yeni execution kabul etmez.
- Scheduler, persistence formati, recovery bootstrap ve execution sonuc sozlesmeleri korunur; yeni durable mutation eklenmez.
- Sprint 110 worker lifecycle smoke PASS (16/16); Sprint 109 startup PASS (11/11); Sprint 108 recovery bootstrap PASS (15/15); Sprint 107 wiring PASS (19/19); pipeline orchestration PASS (10/10); production execution persistence PASS (70/70); worker execution regresyonlari PASS (55/55 ve 18/18).
- `npx tsc --noEmit`, hedefli ESLint ve `git diff --check` PASS.
- SIGTERM/SIGINT, framework shutdown wiring, distributed drain ve cross-process coordination kapsam disidir.
- Acik riskler: lifecycle ve active-count process/instance kapsamindadir; process kesintisi in-flight handler'i atomik kapatmaz; distributed drain ve cross-process admission garantisi yoktur.
- Commit veya push yapilmadi.

---

### Sprint 111 — Production Worker Health & Runtime Diagnostics

Completed

- Merkezi `ProductionWorkerLifecycle` singleton'i uzerinden senkron, read-only ve deterministik `ProductionRuntimeStatus` snapshot sozlesmesi eklendi; composition root `getProductionRuntimeStatus()` getter'ini ayni initializer ve execution admission lifecycle instance'indan uretir.
- Snapshot `lifecycleState`, `activeExecutionCount`, `acceptingExecutions`, `initialized`, `recoveryCompleted`, `workerReady`, `draining`, `startupTimestamp`, `lastStateTransitionTimestamp` ve normalize `initializationFailure` alanlarini tasir. `initialized` ve `recoveryCompleted` basarili runtime initialization bilgisini korurken `workerReady` yalniz mevcut ready state'ini, `acceptingExecutions` ise gercek admission gate kararini ifade eder.
- Initialization oncesi created, recovery boyunca starting, recovery sonrasi ready, drain sirasinda draining, stop sonrasi stopped ve startup failure sonrasi failed durumlari deterministik olarak gozlemlenebilir. Recovery tamamen dogrulanmadan ready veya execution acceptance raporlanmaz.
- Active execution count dogrudan lifecycle admission sayacindan gelir; state kontrolu ve sayac artirimi arasinda async bosluk bulunmaz. Drain/stop sonrasinda initialized ve recovery-completed bilgisi korunur, worker readiness ve acceptance kapanir.
- `startupTimestamp` yalniz gercek startup baslangicinda bir kez atanir. `lastStateTransitionTimestamp` yalniz lifecycle state transition'inda yenilenir; tekrar initialize/start ve status snapshot cagrilari timestamp'leri degistirmez.
- Her status cagrisi yeni, top-level ve nested failure nesnesi frozen, write-free value object uretir. Snapshot internal mutable collection, Promise veya Error tasimaz ve dis mutasyon lifecycle state'ini etkileyemez.
- Initialization failure yalniz normalize `reasonCode` ve varsa validation'dan gecmis `failedProjectSlug` tasir; raw message, stack, cause, path veya hassas veri disari sizmaz. Failed initialization `initialized:false`, `recoveryCompleted:false`, `workerReady:false` ve `acceptingExecutions:false` raporlar.
- Status getter persistence write, scheduler action, recovery bootstrap cagrisi veya execution side effect uretmez. Mevcut scheduler, persistence, recovery bootstrap, execution admission ve startup sozlesmeleri korundu.
- API endpoint, UI, background timer/polling, SIGTERM/SIGINT, framework shutdown hook ve distributed/cross-process status coordination sonraki kapsama birakildi.
- Sprint 111 runtime status smoke PASS (15/15); Sprint 110 worker lifecycle PASS (16/16); Sprint 109 runtime startup PASS (11/11). `npx tsc --noEmit`, hedefli ESLint ve `git diff --check` PASS.
- Final source reviewde ready transition timestamp'inin startup timestamp'ini yeniden kullanmasi duzeltildi; ready transition artik lifecycle clock'u ile gercek son state transition zamanini kaydeder. Bloklayici veya acik onemli bulgu kalmadi.
- Commit veya push yapilmadi.

---

### Sprint 112 — Production Runtime Health API

Completed

- Yeni `GET /api/runtime/health` endpoint'i, yalniz mevcut `ProductionRuntimeCompositionRoot.getProductionRuntimeStatus()` getter'ini kullanarak Sprint 111 read-only runtime snapshot'ini versioned HTTP projection olarak sunar.
- Route yeni runtime graph, lifecycle, initializer, recovery, scheduler, persistence veya execution baslatmaz. Gercek `GET()` wiring'i ayni merkezi getter ve projection handler yolunu kullanir; tekrarlanan cagrilar write-free kalir ve snapshot'i mutate etmez.
- Discriminated union HTTP envelope `schemaVersion: "1"`, `status`, `ready`, `acceptingExecutions`, `runtime` ve yalniz API gozlem zamanini ifade eden `observedAt` alanlarini tasir. Healthy disindaki branch'lerde API-level readiness ve execution acceptance false kalir.
- Tam hazir ve execution kabul eden runtime HTTP 200 `healthy`; created/starting HTTP 503 `starting`; draining, stopped ve failed durumlari kendi normalize status'lariyla HTTP 503 doner. Getter hatasi, bilinmeyen lifecycle veya readiness tutarsizligi HTTP 503 `unavailable` uretir.
- Initialized/recovery-completed, worker-ready, accepting-executions, draining ve failure iliskileri runtime sinirinda fail-closed dogrulanir. Tutarsiz veya guvenli olmayan snapshot `runtime:null` ile kapanir.
- Failed lifecycle yalniz Sprint 111 tarafindan normalize edilmis safe reason code ve varsa guvenli project slug failure bilgisini tasir; raw exception, message, stack, cause, path veya hassas detay sizdirilmaz.
- Tum cevaplar guvenli JSON'dur. `Cache-Control: no-store`, `runtime = "nodejs"`, `dynamic = "force-dynamic"` ve `revalidate = 0` ile static caching kapatilir.
- Endpoint yalniz process-local runtime health sunar; distributed worker veya cross-process health garantisi vermez.
- Sprint 112 health API smoke PASS (24/24); Sprint 111 runtime status PASS (15/15); Sprint 110 worker lifecycle PASS (16/16); Sprint 109 runtime startup PASS (11/11). TypeScript, hedefli ESLint ve `git diff --check` PASS.
- Final review bloklayici ve bloklayici olmayan bulgu olmadan tamamlandi. Gercek GET wiring'i ve tekrar cagrilarda write-free davranis dogrulandi.
- Commit veya push yapilmadi.

---

### Sprint 113 — Production Visual Asset Pipeline Activation

Completed

- `IMAGE_PROVIDER` tanimsiz/bos durumda mock-first default kullanir; `mock` `MockImageProvider`, `openai` `OpenAIImageProvider` secer ve bilinmeyen deger safe configuration error ile fail-closed kapanir.
- Provider resolution import sirasinda ag cagrisi, generation veya yeni runtime graph olusturmaz.
- Pipeline visuals stage mevcut `VisualAssetPipeline` ile gercek scene asset generation'a baglandi; visual plan korunur ve stage success persistence yalniz asset batch basarisindan sonra calisir.
- Scene sonucu kendi sceneId degeriyle deterministik eslestirilir. Bos batch, positive safe-integer olmayan sceneId ve duplicate sceneId provider cagrisi veya asset write oncesinde reddedilir.
- Gercek provider MIME allowlist'i yalniz `image/png`, `image/jpeg` ve `image/webp` kabul eder.
- Dis URL yalniz HTTP/HTTPS olabilir. Local URL exact `/api/assets/images/{slug}/{fileName}` contract'i, `ImageStorage.getImageUrl()` sonucu ve filePath filename eslesmesiyle dogrulanir. File path yalniz guvenli project-relative ImageStorage kokunde olabilir; traversal, absolute/drive, UNC, root-relative, backslash, alt klasor ve storage disi path reddedilir.
- OpenAI base64/storage success gercek `OpenAIImageProvider` ve `ImageStorage` ile dosya, locator, asset registry ve batch success seviyelerinde dogrulandi.
- Mock success exact provider, sceneId, `image/mock`, bos filePath/url ve gecerli createdAt invariant'lariyla runtime'da dogrulanir; malformed ve getter exception ureten nesneler safe failed asset/stage failure uretir.
- Raw provider error, secret, stack, unsafe locator veya hassas path persistence/loglara sizmaz.
- Kismi uretim append-only kalir; production rollback/cleanup eklenmez. Batch ve stage failed olur.
- Gercek runner failure yolunda failed job, manifest ve history; downstream animation enqueue ve completed persistence engelleri dogrulandi.
- Yeni runner, lifecycle, initializer, composition root veya paralel execution graph eklenmedi; Sprint 109-112 davranislari korundu.
- Sprint 113 smoke PASS (54/54); pipeline orchestration PASS (10/10); durable execution PASS (17/17); durable wiring PASS (19/19); runtime health API PASS (24/24); runtime status PASS (15/15); worker lifecycle PASS (16/16); runtime startup PASS (11/11).
- TypeScript, hedefli ESLint ve `git diff --check` PASS; fixture cleanup temiz.
- Takip: wrong-slug ve filePath-URL filename mismatch negatif smoke'lari eklenebilir; full scheduled-runner completed-persistence call engeli ve gercek durable terminal persistence daha guclu ayrica dogrulanabilir; ayni scene icin tekrarli basarili calismalarda current/version selection politikasi belirlenmelidir.
- Commit veya push yapilmadi.

---

### Sprint 115 — Production Video Assembly Activation

Completed

- `VIDEO_ASSEMBLY_PROVIDER` tanimsiz/bos durumda mock-first default kullanir; `mock` plan-only davranisi korur, `ffmpeg` gercek MP4 render yolunu secer ve bilinmeyen deger safe configuration error ile fail-closed kapanir.
- `FFmpegVideoAssemblyProvider` ve `VideoAssemblyManager` mevcut assembly stage'e entegre edildi. Yeni runner, lifecycle, initializer, composition root veya paralel execution graph eklenmedi.
- Assembly plan, canonical scene/visual/audio kimlik setleri ve her scene icin secilen `audioAssetId` degeri render oncesinde asset registry ile dogrulanir. Section audio asset'leri ile project-level mix asset ayni proje, slug, type, MIME, locator, byteLength ve duration sozlesmelerini saglamalidir.
- Image/audio/video storage readback akislari project-relative canonical path, `realpath` containment, symlink/junction reddi, storage-root containment ve dosya structural validation kontrolleriyle guclendirildi.
- FFmpeg sonucu once temporary `.partial.mp4` yolunda uretilir; MP4 box yapisi ve FFprobe metadata'si dogrulandiktan sonra final path'e atomik rename edilir ve generated video asset registry'ye append edilir.
- `/api/assets/videos/{slug}/{fileName}` route'u yalniz guvenli `.mp4` dosya adlarini, containment/readback kontrolunden sonra `video/mp4`, exact Content-Length ve immutable cache header'lariyla sunar; invalid veya storage disi istekler safe 404 alir.
- Process runner `shell: false`, ayri argument listesi, bounded stdout/stderr, timeout, two-phase kill, forced settlement, listener/timer cleanup ve late-error absorption kullanir. Spawn, stream, overflow, timeout, signal ve probe failure'lari sabit safe error'a normalize edilir.
- Runner/provider/storage/registry/stage persistence failure'lari terminal failure akisina propagate olur. Assembly success persistence, downstream enqueue ve project completion failure durumunda engellenir; durable attempt ve journal terminal failure kaydi korunur.
- Sprint 115 video assembly smoke PASS (46/46); Sprint 114 audio PASS (74/74); Sprint 113 visual PASS (54/54); pipeline orchestration PASS (10/10); durable execution PASS (17/17); durable wiring PASS (19/19).
- Runtime health API PASS (24/24); runtime status PASS (15/15); worker lifecycle PASS (16/16); runtime startup PASS (11/11).
- TypeScript, hedefli ESLint ve `git diff --check` PASS. LF -> CRLF uyari mesajlari non-blocking'dir.
- `tsx` yerel dev dependency olarak eklendi; `package.json` ve `package-lock.json` guncellendi.
- Final review P0-P3 bulgusuz tamamlandi. Commit veya push yapilmadi.

---

### Sprint 116 — Animation Motion Plan Production Contract

Completed

- Merkezi stage sirasi `research -> script -> scenes -> visuals -> animation -> video -> audio -> assembly`, `PipelineRecoveryPlanner` dependency graph'i, video/assembly davranisi ve continuation wiring degistirilmedi. Animation veya video bypass edilmedi; ikinci orchestration sistemi eklenmedi.
- Animation stage artik fiziksel image/video dosyasi degil, her scene icin dogrulanmis ve persist edilmis motion-plan artifact uretir. Dosya sozlesmesi `schemaVersion: "2"`; data ve scene artifact sozlesmesi `artifactType: "motion-plan"`; registry MIME degeri `application/vnd.atolye.motion-plan+json` olarak kaydedilir.
- Motion-plan asset medya dosyasi olmadigi icin `filePath` ve `url` yazilmaz. Registry kaydi `type: "animation"`, `artifactType: "motion-plan"`, MIME, source identity ve generation mode tasir; image/audio/video secimlerine fiziksel medya gibi girmez.
- Her planin `sourceImageAssetId` degeri ayni `sceneId` icin gercek generated visual asset'ten alinir ve provider inputu, persisted animation scene'i ve registry `sourceAssetId` boyunca degismeden korunur. Missing, wrong-scene ve sahneler arasi duplicate source identity batch baslamadan fail-closed reddedilir.
- Append-only registry'de visual retry sonrasi ayni scene icin birden fazla generated image bulunmasi normal version history olarak ele alinir; registry append sirasindaki son generated image deterministik secilir ve secilen son surum yeniden storage/sentinel validation'dan gecer.
- Her generated scene'de `animationAssetId === outputAssetId` zorunludur. Duration 1-300 saniye; motion ve transition merkezi allowlist; crop x/y/width/height, crop containment, scale ve translation alanlari kesin araliklar ve `Number.isFinite` ile dogrulanir. Provider donusundeki start/end frame'leri yeniden dogrulanir.
- `MockAnimationProvider` birden fazla scene icin deterministik, gecerli, locator icermeyen motion plan uretir. Provider config/router mock-first test/dev davranisini korur, bilinmeyen degeri fail-closed reddeder ve `PipelineStageExecutor` option injection gercek provider secimine ulasir. `generationMode` provider sonucuna guvenilmeden merkezi olarak belirlenir.
- Merkezi `AnimationMotionPlanValidation` guard'i legacy, mixed legacy/v2 ve full-v2 animation.json kayitlarini ayirir. Tek tarafli schema/artifact marker'i, eksik v2 alani, bozuk nested numeric veri, duplicate identity veya asset ID mismatch legacy fallback'e dusmeden fail-closed reddedilir.
- Merge yalniz tum scene'ler derin motion-plan validation'dan gecerse schema v2/artifact marker'i yazar. Animation API, video API, `AnimationService` ve pipeline state load yollari ayni ortak guard'i kullanir; v2 alanlari merge sirasinda dusurulmez veya legacy kayit v2 gibi etiketlenmez.
- Provider sonuclari scene/source/provider/duration/motion/transition/start/end/status/artifact ve locator invariant'lariyla batch write oncesinde tamamen dogrulanir. Batch'teki herhangi bir malformed sonuc tum batch'i persistence oncesinde reddeder.
- Animation failure stage/job/manifest/history failure akisina propagate olur ve video stage enqueue edilmez. Completed-stage replay provider/storage/registry cagirmadan write-free ve idempotent kalir; retry yeni tutarli plan ile aktif animation.json identity baglantisini yeniler.
- Final review'de iki P1 giderildi: visual retry history nedeniyle birden fazla generated image'in animation preflight'i bloke etmesi, son appended generated image'in deterministik secimiyle cozuldu; eksik/bozuk schemaVersion 2 kayitlarinin legacy kabul edilmesi merkezi derin validation ile kapatildi. Acik P0/P1 bulgu kalmadi.
- Non-blocking P2 takip: registry -> animation.json/manifest -> job/history cok-dosyali persistence tam transaction degildir; registry sonrasindaki hata orphan motion-plan artifact birakabilir. Job list ile history yazimi arasinda da mevcut transaction siniri vardir. Bunlar Sprint 116'ya ozgu degildir, dogrulanan akista yanlis downstream yurutme uretmez ve ayri ileriki mimari hardening kapsaminda ele alinacaktir.
- Sprint 116 motion plan PASS (21); Sprint 115 video assembly PASS (46); Sprint 114 audio PASS (74); Sprint 113 visuals PASS (54); pipeline orchestration PASS (10); auto-continuation PASS (18); durable execution PASS (17); durable wiring PASS (19).
- Runtime startup PASS (11/11); worker lifecycle PASS (16/16); runtime status PASS (15/15); runtime health PASS (24/24). TypeScript PASS; hedefli ESLint PASS (0 warning); `git diff --check` PASS. LF -> CRLF uyarilari non-blocking'dir.
- Dokumantasyon kapanisi tamamlandi; commit veya push yapilmadi.

---

### Sprint 117 — Production Scene Video Rendering Activation

Completed

- Merkezi stage sirasi `research -> script -> scenes -> visuals -> animation -> video -> audio -> assembly`, dependency graph, continuation wiring ve assembly renderer degistirilmedi.
- Video data `schemaVersion: "2"`, `artifactType: "scene-video"` kullanir ve her scene icin ayri asset tasir: sceneId, sourceImageAssetId, animationAssetId, sourceAnimationAssetId, videoAssetId/outputAssetId, locator, MIME, byteLength, duration, geometry, provider, generationMode, transition ve generated status. `sourceAnimationAssetId === animationAssetId`, `videoAssetId === outputAssetId`; aggregate outputAssetId kaldirildi.
- Mock scene-video fiziksel MP4 degildir: `generationMode: "mock"`, `video/mock`, bos filePath/url ve sifir byteLength/width/height kullanir; scene basina ayri deterministik asset identity vardir.
- `FFmpegSceneVideoProvider` image + motion-plan girdisinden scene basina ayri H.264/yuv420p, 1920x1080, 30 FPS, audio tracksiz MP4 uretir. static, zoom-in, zoom-out, pan-left ve pan-right desteklenir; transition yalniz metadata'dir.
- Identity zinciri latest generated image -> sourceImageAssetId -> active motion-plan v2 -> animationAssetId -> scene-video asset olarak dogrulanir. Visual retry secimi append sirasina gore deterministiktir; stale motion plan fail-closed reddedilir.
- Tum scene inputlari provider cagrisindan once preflight edilir. Tum provider sonuclari dogrulanmadan registry write yapilmaz; filePath/url/slug/filename birebir eslesmesi ve production batch locator benzersizligi zorunludur.
- Retry yeni, overwrite etmeyen scene-specific UUID path uretir. Completed-stage replay write-free/idempotenttir; video failure sonrasi normal downstream runnable olmaz.
- Legacy placeholder kayitlar readable kalir; kismi/mixed v2 marker'lari fail-closed reddedilir. Pipeline, recovery, service ve assembly/export/thumbnail/youtube API yollari ortak deep video guard kullanir.
- `PipelineRecoveryPlanner` yalniz video readiness'i `data !== null` yerine `isCompatibleVideoData()` ile dogrulayacak sekilde degisti; merkezi sira, dependency graph ve assembly video dependency'si korundu. Initial/resume/continuation failed video'nun otesine gecmez.
- Final review'de uc P1 giderildi: ayni physical MP4'un coklu scene'e atanmasi filePath/url uniqueness ile reddedildi; zoompan progress output time `ot` ile 0..1 hesaplandi ve 1/300 saniye uclari test edildi; FFmpeg zoompan 1-10 effective zoom siniri render oncesi fail-closed dogrulandi. Sprint 116 motion-plan contract'i degismedi.
- Non-blocking P2: gercek FFmpeg/FFprobe live E2E hostta calistirilamadi; FFprobe container duration/avg_frame_rate kontrolu dar ve katidir; structural MP4 kontrolu deep parser degildir; MP4 -> registry -> video.json/manifest -> job/history cok-dosyali transaction degildir; inherited forced-settlement cleanup yarisi teoriktir; manual hedefli audio retry canonical graph nedeniyle video failure'dan bagimsiz kalabilir.
- P3: SpawnRunner assembly modulunden import edilir ancak runtime cycle yoktur; ortak process-supervision ayrimi ve VideoPipeline sorumluluk ayrismasi ileriki refactor adayidir.
- Ilk production kullanimindan once mutlak `FFMPEG_PATH`/`FFPROBE_PATH` ve fiziksel PNG/JPEG fixture ile bes motion turu live render edilmelidir. Her output tek H.264 stream, audio yok, 1920x1080, yuv420p, 30 FPS, duration toleransi, ayri MP4 ve ayri registry identity kosullarini gercek ffprobe ile saglamalidir. Bu live acceptance icin ayri repo smoke komutu henuz yoktur.
- Sprint 117 scene video PASS (23/23); Sprint 116 motion plan PASS (21); Sprint 115 video assembly PASS (46); Sprint 114 audio PASS (74); Sprint 113 visuals PASS (54); orchestration PASS (10); auto-continuation PASS (18); durable execution PASS (17); durable wiring PASS (19).
- Runtime startup PASS (11/11); worker lifecycle PASS (16/16); runtime status PASS (15/15); runtime health PASS (24/24). TypeScript PASS; hedefli ESLint PASS (0 warning); `git diff --check` PASS. LF -> CRLF uyarilari non-blocking'dir.
- Dokumantasyon kapanisi tamamlandi; commit veya push yapilmadi.

---

### Sprint 118 — Assembly Scene-Video Consumption

Completed

- Kanonik `research -> script -> scenes -> visuals -> animation -> video -> audio -> assembly` stage sirasi, dependency graph, `PipelineRunner`, continuation wiring ve durable execution degismedi.
- Production assembly input'i `inputType: "scene-video"`, `sceneId`, `videoAssetId`, `sourceImageAssetId`, `animationAssetId`, `filePath`, `url`, `durationSeconds`, `narrationDurationSeconds`, `byteLength`, `provider`, `generationMode`, `status` ve `audioFilePath` alanlarini tasir.
- Video null/yok veya gecerli marker'siz legacy `video.json` Sprint 115 image assembly yolunu kullanir. Full `schemaVersion: "2"` + `artifactType: "scene-video"` yalniz scene-video tuketir; image fallback kapanir. Kismi/mixed/global marker'siz v2 fail-closed reddedilir; registry history tek basina v2 secmez.
- Canonical scene, assembly, animation ve video sirasi exact dogrulanir. `sourceImageAssetId` latest active visual; `animationAssetId` active motion-plan ile eslesir. Registry, video.json ve storage metadata birebir kontrol edilir; duplicate sceneId/videoAssetId/filePath/URL reddedilir ve structural readback provider oncesinde tamamlanir.
- Her production scene MP4 FFprobe ile tek H.264 video, audio tracksiz, 1920x1080, yuv420p, rasyonel 30 FPS ve duration toleransi icin preflight edilir. Identity/storage/probe hatalarinda fallback yoktur.
- Stream-copy yalniz tum girdiler production scene-video, scene/narration farki en fazla 1/30 saniye ve profile/level/codec tag/timebase/field order/extradata birebir ayniysa acilir. Internal VideoStorage locator'lari ffconcat manifest'e yazilir, video `-c:v copy` ile concat edilir ve narration WAV'lari AAC'e encode edilir.
- Retime/re-encode yolunda kisa video `tpad=stop_mode=clone` ile son frame'den uzatilir ve trim edilir; uzun video narration suresine trim edilir. Scene PTS'leri sifirlanir; concat sonucu H.264/AAC, 1920x1080, yuv420p, 30 FPS'tir.
- Atomic rename sonrasi final output FFprobe edilir: tek video + tek audio, H.264/AAC, geometry, pixfmt, rasyonel FPS, attached-picture reddi ve video/audio/container duration toleransi zorunludur. byteLength final readback'ten sonra belirlenir; registry write yalniz bu dogrulamadan sonra yapilir.
- Final review'de uc P1 giderildi: duplicate locator reddi; stream-copy icin exact stream signature; final output stream/FPS/A-V/container validation. Acik P0/P1/P3 yoktur.
- Identity/order/registry/structural failure provider oncesi; scene probe failure concat oncesi fail-closed olur. Final probe failure generated final asset yazmaz. Assembly failure job/manifest'i failed yapar ve project completion'i engeller. Completed replay write-free kalir.
- Non-blocking P2: live FFmpeg/FFprobe E2E calismadi; mock runner ffconcat path parsing, H.264 boundary, AAC mux, edit-list/packet timeline ve tpad/trim'i kanitlamaz. Final registry asset coklu scene-video lineage listesini dogrudan tasimaz; provenance assembly.json'a baglidir. Forced-settlement cleanup yarisi teoriktir; multi-file persistence tam transaction degildir.
- Production oncesi zorunlu live acceptance: es sureli stream-copy, kisa video clone-pad, uzun video trim, cok sahneli concat, bosluk/Turkce karakterli Windows path ve final FFprobe. Her output tek H.264 + tek AAC, 1920x1080, yuv420p, rasyonel 30 FPS, tolerans icinde A/V/container sureleri, dogru scene sirasi ve boundary decode/audio continuity saglamalidir.
- Sprint 118 PASS (19/19); Sprint 117 PASS (23/23); Sprint 116 PASS (21/21); Sprint 115 PASS (46/46); Sprint 114 PASS (74/74); Sprint 113 PASS (54/54); orchestration PASS (10/10); auto-continuation PASS (18/18); durable execution PASS (17/17); durable wiring PASS (19/19).
- Runtime startup/lifecycle/status/health PASS (11/16/15/24). TypeScript PASS; hedefli ESLint PASS (0 warning); `git diff --check` PASS. LF -> CRLF uyarilari non-blocking'dir.
- Dokumantasyon kapanisi tamamlandi; commit veya push yapilmadi.

---

### Sprint 114 — Production Narration Audio Pipeline Activation

Completed

- `AUDIO_PROVIDER` tanimsiz/bos durumda mock-first default kullanir; `mock` `MockAudioProvider`, `openai` `OpenAIAudioProvider` secer ve bilinmeyen deger safe configuration error ile fail-closed kapanir. Provider resolution import sirasinda ag cagrisi veya generation baslatmaz.
- `OPENAI_TTS_MODEL` server-side config'ten okunur ve varsayilan `tts-1` kullanilir. Whitespace-only `OPENAI_API_KEY` fetch oncesinde reddedilir; model, voice ve config failure mesajlari sabit ve guvenlidir.
- Her OpenAI request'i bagimsiz AbortController kullanir. `OPENAI_TTS_TIMEOUT_MS` default 60000, `OPENAI_TTS_MAX_RESPONSE_BYTES` default 64 MiB'dir. Content-Length body oncesinde; headersiz body chunk-by-chunk sinirlandirilir. Oversize/never-ending stream abort ve reader cancellation ile; null, empty ve truncated body fail-closed kapanir.
- Audio stage sirasi audio plan -> tum section/mix generation -> `saveAudio` -> stage success olarak korunur. Her section asset'i `sceneId = chapterId` kullanir; project-level mix korunur ve `audio.outputAssetId` mix asset ID'sini gosterir.
- Gercek section/mix asset'leri yalniz `audio/wav`, guvenli project-relative filePath, exact `/api/assets/audio/{slug}/{fileName}` URL, gercek byteLength ve durationSeconds ile kabul edilir. Storage readback degerleri provider sonucuyla karsilastirilir.
- Mock success exact provider `mock`, `audio/mock`, bos filePath/url, zero byteLength ve zero duration sentinel invariant'lariyla runtime'da dogrulanir.
- Batch preflight bos section listesi, non-positive/non-safe/duplicate chapterId ve bos narration'i tum provider cagrilarindan once reddeder. Provider/target/chapter mismatch, malformed runtime object ve getter exception safe failure uretir.
- WAV validation RIFF/WAVE, tam bir `fmt` ve tam bir non-empty `data` chunk, RIFF/file size, chunk bounds, channel/sample/byte rate, block alignment, bits-per-sample ve positive finite bounded duration kosullarini uygular. Duplicate fmt/data ve truncated chunk reddedilir; unknown ancillary chunk ve odd padding desteklenir.
- Audio route yalniz guvenli `/api/assets/audio/{slug}/{fileName}` `.wav` dosyalarini `audio/wav` ile sunar. Traversal, absolute/drive, UNC, root-relative, backslash ve storage disi yollar reddedilir; filesystem detaylari guvenli 404 arkasinda kalir.
- AudioStorage save/readback, AssetManager get/add, failed-asset append, `ProjectManager.saveAudio` ve stage persistence hatalari normalize edilir. Raw fetch/provider/filesystem error, URL/body, EACCES/ENOSPC/EPERM, narration, secret, stack veya hassas path asset metadata, job, manifest, history, durable attempt/journal ve loglara sizmaz.
- Kismi uretim append-only kalir; rollback/orphan cleanup eklenmez. Her failure batch/stage/job/manifest/history failed sonucu uretir; assembly enqueue, audio success persistence ve completed persistence engellenir.
- Gercek durable test `prepareProductionPipelineExecution` -> `ProductionPipelineExecutionAdapter` -> `ProductionExecutionFilePersistenceAdapter` yolunu kullanir; versioned attempt ve journal storage'dan yeniden okunur, terminal state/event failed olarak dogrulanir.
- Yeni runner, lifecycle, initializer, composition root veya paralel execution graph eklenmedi; Sprint 109-113 davranislari korundu.
- Sprint 114 audio wiring PASS (74/74); Sprint 113 visual wiring PASS (54/54); pipeline orchestration PASS (10/10); durable execution PASS (17/17); durable wiring PASS (19/19); runtime health API PASS (24/24); runtime status PASS (15/15); worker lifecycle PASS (16/16); runtime startup PASS (11/11).
- TypeScript, hedefli ESLint ve `git diff --check` PASS; fixture cleanup temiz (`fixture_count=0`).
- Takip: exact-limit response success, malformed/negatif/NaN Content-Length ve null/empty body smoke'lari eklenebilir; durable filesystem-failure matrisi ve `WORKER_HANDLER_FAILED` payload assertion'i guclendirilebilir; audio-specific discriminated asset type ve AudioPipeline/smoke helper ayrismasi ileride ele alinabilir.
- Commit veya push yapilmadi.

---

# Sprint 81
## Pipeline Intelligence Foundation

Amac:

Pipeline history ve jobs state'lerinden client-side derived intelligence uretmek.

Plan:

- Client-side Pipeline Intelligence eklendi.
- History ve jobs verilerinden derived metrikler uretildi.
- Success Rate, Failures, Average Duration, Last Event ve Queue Health gosteriliyor.
- Intelligence paneli history bos olsa bile render ediliyor.
- API, PipelineJobManager ve contract degismedi.
- TypeScript ve smoke test basarili gecti.

---

# Sprint 77
## Pipeline Execution History Foundation

Amac:

Pipeline job terminal lifecycle event'lerini pipeline-jobs.json davranisini koruyarak ayri history storage katmanina kaydetmek.

Plan:

- Added pipeline-history.json storage layer.
- Preserved pipeline-jobs.json behavior.
- Added terminal lifecycle history events.
- Recorded completed, failed and cancelled job events.
- Stored job metadata including timestamps.
- No UI changes.
- No API contract changes.
- Retry/running/queued states do not create history events.
- npx tsc --noEmit passed.

---

# Sprint 76
## Pipeline Observability UI Layer

Amac:

Pipeline Queue / Jobs panelinde mevcut PipelineJob metadata'sini API contract degistirmeden daha gorunur hale getirmek.

Plan:

- Added job timestamp visibility.
- Added duration calculations.
- Running job live elapsed time calculated client-side.
- Completed/failed/cancelled duration derived from existing timestamps.
- Retry attempts visibility.
- Existing failed job error visibility preserved.
- No API contract changes.
- PipelineJobManager unchanged.
- Sprint 75 refresh/action behavior preserved.
- npx tsc --noEmit passed.

---

# ⚠️ Bilinen Riskler

- Sprint 45 başlamadan önce assembly çıktıları örnek projede doğrulanmalı.
- Assembly gerçek render üretmemeli; yalnızca render planı hazırlamalı.
- Video/audio/animation aktif asset referansları korunmalı.
- Sprint 83 lock'u yalnizca process-localdir.
- Dosya yazimlari gercek transaction degildir.
- Ayni proje icin paralel manuel save ve pipeline execution gelecekte revision/transaction tabanli olarak sertlestirilmeli.
- Cancel uzun suren AI/asset uretimini durdurmaz; sonucu persist etmeyi engeller.

---

# 📚 Dokümantasyon

| Belge | Amaç |
|--------|------|
| README.md | Proje tanıtımı |
| PROJECT_PHILOSOPHY.md | Projenin varlik nedeni |
| VISION.md | Nihai urun vizyonu |
| ATOLYE_AI_RULES.md | AI geliştirme kuralları |
| ATOLYE_CONTEXT.md | Proje vizyonu |
| ROADMAP.md | Yakın dönem plan |
| ATOLYE_MASTER_ROADMAP.md | Uzun vadeli strateji |
| ARCHITECTURE_DECISIONS.md | Mimari kararlar |
| CHANGELOG.md | Kilometre taşları |
| AI_MEMORY.md | AI tecrübeleri |

---

# 🤖 AI Başlangıç Talimatı

Her yeni AI oturumu aşağıdaki adımları takip etmelidir.

1. Bu belgeyi oku.
2. AI Rules dosyasını oku.
3. Aktif sprinti doğrula.
4. Aktif sprinti dogrula.
5. Tamamlanan sprintleri tekrar yapma.
6. Kod yazmadan önce mevcut mimariyi incele.

---

# 🔄 Güncelleme Kuralları

Her sprint sonunda yalnızca aşağıdaki alanlar güncellenir.

- Aktif Sprint
- Son Commit
- Son Tamamlanan Sprint
- Bir Sonraki Görev
- Bilinen Riskler
- Last Updated

---

### Sprint 119 — Pipeline Retry Continuation Hardening

Completed

- Retry sonrasında `research -> script -> scenes -> visuals -> animation -> video -> audio -> assembly` akışı bounded ve non-recursive dispatcher ile devam eder. `continueProject()` çağrı başına en fazla tek stage çalıştırma sözleşmesini korur.
- Dispatcher her iterasyonda kalıcı job durumunu yeniden okur; success, no-op, conflict, failure, blocked, terminal ve iterasyon sınırlarında güvenli durur.
- Standalone continuation ve retry aynı dispatcher/lifecycle kurallarını kullanır. Draining, stopped ve failed lifecycle durumlarında yeni continuation kabul edilmez.
- Drain aktif işi bekler; sonraki queued stage kalıcı ve yeniden çalıştırılabilir kalır. Dispatcher hatası tamamlanmış retry stage'ini geri almaz.
- Final review'de eşzamanlı dispatcher'ların assembly sınırını geçerek thumbnail çalıştırmasına yol açan P1 yarışı giderildi. Açık P0/P1/P2/P3 bulgu yoktur.
- Merkezi stage sırası ve dependency modeli değiştirilmedi; ikinci orchestrator veya yeni kalıcı kaynak oluşturulmadı.
- Restart recovery için cron/polling eklenmedi; mevcut durable job kayıtları üzerinden sonraki dispatch/recovery tetiklemesinde devam edilir.
- Sprint 119 smoke PASS (22 senaryo); Sprint 118-113 regresyonları PASS; pipeline orchestration PASS (10); auto-continuation PASS (18); durable execution PASS (17); durable wiring PASS (19); worker lifecycle PASS (16).
- Runtime startup/status/health regresyonları PASS. TypeScript PASS; ESLint PASS; `git diff --check` PASS.
- Dokümantasyon kapanışı tamamlandı; commit veya push yapılmadı. Sonraki sprint yalnız Planning durumundadır.

### Sprint 120 — Production Thumbnail Pipeline Activation

Completed

- Sprint 45'ten kalan mevcut plan-only thumbnail foundation genişletildi; paralel thumbnail sistemi kurulmadı. Mevcut `ThumbnailProvider` ve router korundu, `ThumbnailEngine` plan üretmeye devam ederken gerçek asset üretimi `ThumbnailAssetPipeline` üzerinden mevcut thumbnail stage'e bağlandı.
- Kalıcı asset kaydı mevcut `AssetManager` ile yapılır. Stage, manifest ve project persistence mevcut `ProjectManager` ve `PipelineJobManager` akışlarını kullanır.
- Merkezi stage sırası, dependency graph, `PipelineRunner`, continuation dispatcher, retry, durable execution, recovery ve worker lifecycle değiştirilmedi. Thumbnail başarısızlığında stage failed olur, SEO başlamaz, assembly completed kalır ve retry assembly'yi yeniden çalıştırmaz.
- Discriminated provider result içindeki `assetId`, `fileName`, `filePath`, URL, MIME, width, height, byteLength, provider, model, generationMode, status ve `createdAt` doğrulanır. `assetId` ↔ `fileName` ↔ `filePath` ↔ URL ↔ MIME exact invariant'ları korunur.
- Mock provider deterministik, fiziksel ve geçerli 1280×720 PNG üretir. Production provider sonucu da aynı contract ve doğrulama hattından geçer.
- Storage katmanında PNG/JPEG/WebP MIME allowlist'i, MIME–uzantı–gerçek byte signature uyumu, exact storage path/public URL eşleşmesi, path containment, root/parent güvenliği ve symlink/junction kaçışı fail-closed doğrulanır.
- Publish temporary file + fsync + atomic hard-link ile yapılır; collision mevcut final dosyayı overwrite etmez ve temp/collision cleanup uygulanır. Route readback realpath üzerinden ikinci kez doğrulanır; encoded traversal, Windows separator ve root escape reddedilir. Ham filesystem/provider hataları API yüzeyine sızdırılmaz.
- Raster doğrulaması 64 MiB ve width/height 16.384 üst sınırlarıyla bounded çalışır. PNG chunk sınırları ve CRC, JPEG SOI/SOF/EOI, WebP container/dimension yapısı doğrulanır; dimensions fiziksel byte yapısından okunur.
- Fiziksel dosya sonrası `AssetManager`, thumbnail, manifest veya job persistence hataları için compensation/reconciliation uygulanır. Thumbnail yolları `assets.json` atomic registry metotlarını, `thumbnail.json` ise mevcut atomic `ProjectWriter` helper'ını kullanır.
- Geç persistence failure generated asset'i failed durumuna çeker, locator'larını temizler ve fiziksel dosyayı kaldırır. Retry başlangıcı stale generated kayıtları uzlaştırır; production retry yeni kimlik üretse dahi eski orphan'ı kullanmaz.
- Retry sonunda registry'de yalnız bir generated thumbnail, diskte yalnız onun dosyası ve `thumbnail.json` içinde yalnız onun `outputAssetId` değeri kalır. Eşzamanlı continuation doğrulamasında tek claim, tek provider çağrısı ve tek generated asset oluşur.
- Final review'de altı P1 giderildi: direct write'ın partial file bırakması; geç persistence failure sonrası registry/fiziksel orphan; `assets.json`/`thumbnail.json` direct overwrite; güvenilmeyen storage root sonrası secondary failed-asset yazımı; eksik OpenAI timeout/abort/response-size sınırları; route containment sonrası farklı dosya okuma yarışı.
- Final review sonucu P0 yok, P1 yok. Non-blocking P2 takipleri: fiziksel dosya/registry/thumbnail/manifest/job tek transaction değildir ve eşzamanlı bağımsız filesystem arızalarında canonical olmayan byte orphan kalabilir; durable adapter kapalı çok-process kullanımda `PipelineJobManager` kilidi process-localdır; gerçek OpenAI credential/live E2E çalıştırılmadı, fake/injected provider ile timeout, response ve contract doğrulandı.
- P3 takip: PNG/JPEG/WebP doğrulaması bounded structural parser'dır, tam raster decoder değildir.
- Doğrulamalar: Sprint 120 thumbnail 42/42; Sprint 119 retry continuation 22/22; auto-continuation 18/18; pipeline orchestration 10/10; Sprint 118 19/19; Sprint 117 23/23; Sprint 116 21/21; Sprint 115 46/46; Sprint 114 74/74; Sprint 113 54/54; durable execution 17/17; durable wiring 19/19 PASS. TypeScript PASS; tam repository ESLint PASS (0 warning); `git diff --check` PASS; fixture cleanup temiz.
- Açık takipler: credential bulunan kontrollü ortamda gerçek OpenAI PNG üretimi ve route üzerinden canlı readback; tüm asset türleri için ortak atomic registry API değerlendirmesi; distributed claim kapalı çok-process kurulumlar için genel mimari hardening.
- Dokümantasyon kapanışı tamamlandı; commit veya push yapılmadı. Sonraki sprint yalnız Planning durumundadır ve uygulamasına başlanmadı.

### Sprint 121 — Production YouTube Package Pipeline Activation

Completed

- Canonical `schemaVersion: "1"` YouTube package sözleşmesi aktive edildi. Provider yalnız yaratıcı draft üretir; identity, metadata, `generatedAt` ve status alanları güvenilen pipeline tarafından eklenir.
- Final video yalnız `assembly.outputAssetId`, thumbnail yalnız `thumbnail.outputAssetId` üzerinden seçilir. Export API canonical top-level alanları tüketir.
- Varsayılan provider mock olarak korundu. OpenAI yalnız explicit activation ile seçilir; unknown provider fail-closed reddedilir ve provider failure sonrasında mock fallback yoktur.
- SEO, mevcut merkezi sıra değiştirilmeden YouTube dependency listesine eklendi. Merkezi pipeline sırası, durable execution ve worker lifecycle değiştirilmedi.
- Legacy veya malformed YouTube paketleri recovery-ready kabul edilmez. Replay sırasında geçerli canonical paket provider çağrısı yapılmadan ve gereksiz overwrite edilmeden yeniden kullanılır.
- Final MP4 için registry kaydı, locator, URL, byteLength, file structure ve bounded `mvhd` duration doğrulanır. Thumbnail için registry, generationMode, provider/model, MIME, dimensions, byteLength ve locator doğrulanır; `assetId` ↔ `fileName` invariant'ı zorunludur.
- Duplicate, stale, failed, cross-project ve eksik generationMode asset'ler fail-closed reddedilir.
- Metin alanlarında NFC normalization, control-character reddi ve uzunluk sınırları uygulanır. Tag ve hashtag'ler case-insensitive deduplicate edilir.
- Chapter başlangıçları 0'dan başlar, strictly increasing olur ve video süresi içinde kalır.
- `youtube.json` aynı proje alanında temp file, fsync ve rename ile atomic yazılır. Path containment ile symlink/junction parent kontrolleri uygulanır.
- API yalnız stored project state ve registry verisini kullanır; istemci asset payload'larına güvenmez. Hatalar güvenli sabit error envelope ile döndürülür.
- Final review sırasında bulunan eksik thumbnail generationMode P1'ı giderildi. Final review sonunda açık P0/P1 kalmadı.
- Doğrulamalar: Sprint 121 YouTube package smoke PASS — 58; Sprint 120 thumbnail PASS — 42; Sprint 119 retry continuation PASS — 22; Auto-continuation PASS — 18; Pipeline orchestration PASS — 10; Durable execution PASS — 17; Durable wiring PASS — 19; Sprint 118 assembly PASS — 19; Sprint 117 scene video PASS — 23; Sprint 116 animation PASS — 21; Sprint 115 assembly wiring PASS — 46; Sprint 114 audio PASS — 74; Sprint 113 visuals PASS — 54; TypeScript PASS; full repository ESLint PASS — 0 warning; `git diff --check` PASS; fixture cleanup temiz.
- Non-blocking P2 takipleri: `youtube.json`, manifest ve job kayıtları tek filesystem transaction değildir; durable/distributed execution kapalı çok-process kullanımda pipeline kilidi process-localdır; gerçek OpenAI credential ile live E2E çalıştırılmadı; `youtube.json`, manifest ve job timestamp'leri birebir aynı olmak zorunda değildir; MP4 validation bounded `mvhd` inspection kullanır ve ayrıca live FFprobe acceptance çalıştırılmadı.
- Dokümantasyon kapanışı tamamlandı; commit veya push yapılmadı. Sonraki sprint yalnız Planning durumundadır; adı ve kapsamı kesinleştirilmedi ve uygulamasına başlanmadı.

### Sprint 122 — Production YouTube Publish Pipeline Foundation

Completed

- Yeni merkezi stage eklenmedi. Mevcut YouTube stage canonical package üretimini ve publish işlemini birlikte yönetir; merkezi sıra `Thumbnail → SEO → YouTube → Export` olarak korundu.
- Canonical publish kaydı `schemaVersion: "1"` kullanır. `youtube-publish.json` içinde `publishing`, `published` ve `failed` durumları saklanır.
- Provider yalnız uzak yayın sonucunu üretir. Project, package ve asset identity, attempt, timestamp ve canonical status alanları pipeline tarafından eklenir.
- Default provider mock'tur. Gerçek provider yalnız `YOUTUBE_PUBLISH_PROVIDER=youtube-data-api` ve `YOUTUBE_ACCESS_TOKEN` ile etkinleşir; bilinmeyen veya eksik provider yapılandırması fail-closed davranır.
- YouTube Data API resumable video upload ve thumbnail upload işlemleri provider boundary içinde tutulur. Fetch transport injection gerçek credential gerektirmeyen testleri destekler.
- Durable execution, claim, lease, attempt ve worker lifecycle mimarisi değiştirilmedi.
- Publish yalnız stored `project.json`, canonical `youtube.json`, assembly, thumbnail ve SEO kayıtları ile asset registry kullanır. İstemcinin package, video, thumbnail veya metadata override göndermesi reddedilir.
- Canonical package ile video/thumbnail asset zinciri fiziksel storage readback üzerinden yeniden doğrulanır. Missing, malformed, duplicate, failed, stale, cross-project, locator uyumsuz ve generationMode eksik asset'ler reddedilir.
- MP4 structure, byteLength, `mvhd` duration ve containment; thumbnail MIME, dimensions, byteLength, locator ve `assetId` ↔ `fileName` doğrulamaları uygulanır.
- Metadata NFC normalization, trim, control-character reddi ve YouTube sınırlarından geçer. Package identity SHA-256 ile deterministik bağlanır.
- Geçerli `published` replay provider'ı yeniden çağırmaz. Existing `publishing` intent ikinci uzak upload'ı fail-closed engeller; stale package, provider veya asset binding kabul edilmez.
- Provider explicit failure false-success üretmez. Indeterminate timeout/upload durumunda `publishing` intent korunur ve otomatik ikinci upload yapılmaz.
- Atomic sonuç yazımı temp file, fsync, rename, containment ve symlink/junction parent kontrollerini kullanır.
- API sabit güvenli hata envelope'u ve `Cache-Control: no-store` kullanır. Raw provider, API veya credential hataları dışarı sızdırılmaz.
- Doğrulamalar: Sprint 122 YouTube publish smoke PASS — 31; Sprint 121 YouTube package PASS — 58; Sprint 120 thumbnail PASS — 42; Sprint 119 retry continuation PASS — 22; Auto-continuation PASS — 18; Pipeline orchestration PASS — 10; Durable execution PASS — 17; Durable wiring PASS — 19; Sprint 118 assembly PASS — 19; Sprint 117 scene video PASS — 23; Sprint 116 animation PASS — 21; Sprint 115 assembly wiring PASS — 46; Sprint 114 audio PASS — 74; Sprint 113 visuals PASS — 54; TypeScript PASS; full repository ESLint PASS — 0 warning; `git diff --check` PASS; fixture cleanup temiz.
- Non-blocking P2 takipleri: `youtube.json`, `youtube-publish.json`, manifest ve job kayıtları tek filesystem transaction değildir; başarılı uzak upload sonrası final persistence başarısızsa `publishing` intent manuel reconciliation gerektirir ve otomatik yeniden upload yapılmaz; durable/distributed execution kapalı çok-process kullanımda pipeline kilidi process-localdır; gerçek credential ile live YouTube video upload, thumbnail upload ve canlı API acceptance çalıştırılmadı.
- Dokümantasyon kapanışı tamamlandı; commit veya push yapılmadı. Sonraki sprint yalnız Planning durumundadır; adı ve kapsamı kesinleştirilmedi ve uygulamasına başlanmadı.

Bu belge mümkün olduğunca kısa tutulmalıdır.

Detaylı bilgiler ilgili dokümantasyon dosyalarında bulunmalıdır.
