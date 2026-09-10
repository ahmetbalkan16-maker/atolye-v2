# AYAS — GERÇEK CİHAZ FOLLOW-UP: Mobile Wake Reliability + AYAS Raporları Button

_Branch `wip/ayas-graphify-final-execution` · fix `f4fcc8e` (off `67095ee`) · 2026-09-13_
_NOT merged · NOT pushed · NOT deployed · Execution Gate CLOSED · `writeActionsEnabled = false`_

Protokol: **INSPECT → DIAGNOSE → PLAN → IMPLEMENT → TEST → VERIFY → REPORT.** İki bulgu, ikisi
de tahmin yürütmeden, önce kod + gerçek runtime akışı incelenerek.

---

## ROOT CAUSE

### Reports — "AYAS Raporları" butonu hiçbir şey açmıyordu (P0)

**PIPELINE / LAYOUT problem** — handler exception'ı yok, yanlış route yok, click event sorunu yok.

Uçtan uca izlendi:

```
StatCard  <button data-testid="bc-card-reports" onClick={onOpenReports}>   ← BrainConsoleView StatusCards
  ↓  onOpenReports = () => onSelectPanel("selfheal")   (eski wiring)
setActivePanel("selfheal")   ← BrainCoreConsole state
  ↓
<div className="bc-tabpanel" data-panel="selfheal">  → PanelBody → <BrainSelfHealingPanel reportCenter={rc} />
  ↓
rc boş (data/brain/selfheal/ boş) → "AYAS Raporları — beklemede" empty state RENDER EDİLİYOR
```

Yani buton **çalışıyordu** — `activePanel` "selfheal"e geçiyor, panel render ediliyor. Sorun
**konum**:

```css
.bc-main { grid-template-columns: 1fr; }               /* MOBİL — tek sütun, dikey stack */
@media (min-width: 960px) {
  .bc-main { grid-template-columns: minmax(0,1fr) minmax(348px,452px); }   /* masaüstü — 2 sütun */
}
```

- **Masaüstü:** `.bc-stage` (orb + presence kartı + status kartları) ve `.bc-panel` (command
  center + tab şeridi + panel gövdesi) **yan yana**. Tab değişimi kartın hemen yanında görünür.
- **Mobil:** `.bc-panel`, `.bc-stage`'in **çok altında** stack'lenir — orb, state satırı, karakter
  satırı, büyük presence kartı, 7 status kartı, "Durumu yenile" butonu... hepsinden sonra. Kullanıcı
  karta dokunuyor, `activePanel` değişiyor ama **hiçbir scroll olmuyor** — değişen içerik ekranın
  1500-2500px altında. Ne modal, ne sayfa — sadece görüş alanı dışında bir tab değişimi. Tam
  masaüstü-çalışır / mobil-çalışmaz-görünür ayrımı.

**FIX (minimum):** `BrainConsoleView` yeni `onOpenReports` prop'u; `BrainCoreConsole` bunu
`setActivePanel("selfheal")` + **senkron** `document.getElementById("bc-command-center")
.scrollIntoView({ behavior: "smooth", block: "start" })` ile bağlar. `<section
id="bc-command-center">` her zaman mount'ludur (yalnız iç tab paneli değişir) → timer / rAF
gerekmez (rAF Brain UI'da yasak). `onOpenReports` yoksa kart düz panel-değişimi fallback'ine
düşer (asla ölü değil). Boş Report Center artık "Sistem Sağlığı %N · <liveState>" de gösterir —
boş ekran "hiçbir şey olmadı" değil "çalışan ama boş pano" gibi okunur.

### Wake — gerçek cihazda "AYAS" ~3 kez söylenince algılanıyor

**ENGINE / THRESHOLD problem, PIPELINE değil.**

`public/wake/ayas.report.json` — modelin kendi eğitim raporu:
```json
"positives_synth": 1560, "note": "synthetic positives only (1 TTS voice);
 real-speaker recall + threshold = OPERATOR device test",
"threshold_table": { "0.5": {"recall": 1.0, "fp_per_hour": 0.39}, "0.7": {"recall": 1.0, "fp_per_hour": 0.2} }
```
Bu recall/FP sayıları **tek sentetik Piper sesi** için. Gerçek insan "AYAS"ı bir dağılım kayması
— recall düşer (operatörün bulduğu gibi: 3× gerekiyor).

Pipeline **sağlam** — ölçüldü:
```
microphone → AudioContext → AudioWorklet(1280-örnek 16kHz frame) → OpenWakeWordRunner.accept()
  → melspectrogram.onnx → embedding_model.onnx → ayas.onnx → score [0,1]
  → WakeScoreDetector (hard 0.70 / soft 0.60, softVotes 3, softWindow 5)
```
- `accept()`: **buffer-not-discard** + `runChunk` catch-up (MAX_CATCHUP 4) → CONTİGUOUS audio,
  frame düşmez (`nDropped` yalnız PENDING_MAX aşılınca — 480ms geride).
- single-flight (`inFlight`) — çakışan inference yok, `maxConcurrent` 1.
- `PREROLL_FRAMES` pre-roll — wake tespit gecikmesini telafi eder.
- cooldown (`rearmCooldownMs` 350) YALNIZ bir turdan sonra — ilk soğuk wake'i etkilemez.

Operatör "AYAS konuşmayı algılıyor" ve wake **sonunda tetikleniyor** diyor → pipeline frame
üretiyor ve skorluyor; skorlar sentetik-eğitilmiş modelde gerçek ses için marjinal.

**SAFE ara değişiklik — hard (0.70) ve soft (0.60) eşikleri DEĞİŞMEDİ:**
- `softWindow` 5 → **7** (400ms → 560ms): dikkatli söylenen bir "AYAS" ~500-650ms sürer; 400ms
  pencere 3 soft frame yerleşmeden onu kesiyordu — operatörün "3× söyle" belirtisi.
- **near-hard fast-path:** pencerede `score ≥ 0.67` bir frame **VE** `≥ 2` frame `≥ 0.63` → hit.
  Kısa süre ~0.67-0.69'a sıçrayıp 3 soft frame tutturamayan gerçek bir "AYAS"ı yakalar.
  Desteksiz tek sıçrama hâlâ tetiklemez; 0.30-0.50 gürültü asla tetiklemez (smoke ile test edildi).

**Gerçek düzeltme operatörün:** `/brain/voice-lab/wake` sayfasında gerçek bir "AYAS" için
`scoreDistribution` (max / p90 / window) oku → retrain (`scripts/wake/train_ayas_wake.py`, ~30
gerçek klip) ya da veriye dayalı `wakeDetect` config. Threshold KÖRLEMESİNE DÜŞÜRÜLMEDİ.

**Sınıflandırma:** `Reports = PIPELINE/LAYOUT PROBLEM` (kodda düzeltildi) ·
`Wake = ENGINE / THRESHOLD PROBLEM` (model recall — kodda yalnız güvenli recall yardımı,
gerçek çözüm operatörün retrain'i).

---

## CHANGES

| file | change |
|---|---|
| `src/components/brain/BrainConsoleView.tsx` | `onOpenReports` prop; `StatusCards` kartı buna bağlanır (fallback: `onSelectPanel`); `.bc-panel` `<section>` → `id="bc-command-center"` |
| `src/components/brain/BrainCoreConsole.tsx` | `openReports()` — `setActivePanel("selfheal")` + senkron `#bc-command-center.scrollIntoView(...)`; `<BrainConsoleView onOpenReports={openReports} />` |
| `src/components/brain/BrainSelfHealingPanel.tsx` | boş Report Center'da "Sistem Sağlığı %N · <liveState>" satırı; başlık "AYAS Raporları" |
| `src/components/brain/voice/wakeWordVoiceAdapter.ts` | `WakeDetectConfig` += `nearHardPeak?`/`nearHardSoft?`/`nearHardVotes?`; `DEFAULT_WAKE_DETECT` `softWindow` 5→7 + `nearHardPeak 0.67`/`nearHardSoft 0.63`/`nearHardVotes 2`; `observe()` near-hard fast-path (hard/soft eşikleri değişmedi) |
| `scripts/smoke-ayas-wake-adapter.ts` | 41→42 — near-hard fast-path senaryosu |
| `scripts/smoke-brain-core-ui.ts` | 12b4 — Reports kartı gerçek `<button>`, `#bc-command-center` anchor, fallback tıklanabilir |

`f4fcc8e` — 6 dosya, +119 / −12. Yeni dependency yok, route yok, `.env` değişikliği yok.

---

## TESTS

```
unit:        WakeScoreDetector — near-hard spike+support → hit; lone spike → no;
             0.30-0.50 chatter (30 frame) → asla; soft path hâlâ 3 gerçek soft frame ister
integration: smoke-ayas-wake-adapter 41 → 42  ·  smoke-brain-core-ui 38 (Reports kartı = <button>,
             id="bc-command-center" var, handler'sız fallback tıklanabilir)  ·
             smoke-ayas-voice 54  ·  smoke-ayas-wake-runner 17  ·  smoke-ayas-access-gate 17  ·
             smoke-brain-selfheal-observe-ui 13  ·  smoke-brain-report-* (center 14 / e2e 5 /
             store 7 / voice-command 9 / approval 9 / security 9)  ·  v1/v2 selfheal suite'leri
             (40/10/3/14/26/3)  ·  watchdog 7 / optimization-live 7 / latency-e2e 6  ·
             brain-lifecycle 16 / conversation 8 / security 11 / worker-cycle 15  ·
             ayas-stt 17 / stt-security 7 / chat-stream 11 / pwa-sw 8 / pwa-manifest 8 /
             studio-context 16  — hepsi PASS, yeni fail YOK
tsc:         0 errors
lint:        0 errors (22 pre-existing warnings, dokunulan dosyalarda yok)
build:       next build exit 0 ; BUILD_ID xf4frXSInAqN693rLVMye
graphify:    CONSISTENT-WITH-NOTES · 17 folder / 16 valid / 16 manifest / 0 unresolvable /
             Brain ↔ Graphify 16 == 16 · salt-okunur, yazma yok

Live re-verify (tunnel, cookiesiz):  /login 200 · /brain 307→/login · /sw.js 200 ·
/wake/ayas.onnx 200 · tunnel URL DEĞİŞMEDİ · cloudflared PID 26852 dokunulmadı
Fixes in the running build: bc-command-center ×7 · onOpenReports ×15 · nearHardPeak ×13 · softWindow:7 ×1
```

Baseline fail'leri (`smoke-production-snapshot-builder`, `129-25c-2a`, `129-25c-2b-4`) — `main`'de
de fail, yeni olarak raporlanmadı.

---

## SECURITY

```
execution gate:    CLOSED — değişmedi, yeniden doğrulandı
auto apply:        writeActionsEnabled false · NEVER_AUTO_APPLY — değişmedi
browser authority: Reports butonu SALT read-only panel değişimi + scroll —
                   git YOK · patch YOK · sandbox YOK · apply YOK · execution yetkisi YOK
```

- Reports butonunun çalışması kesinlikle execution yetkisi anlamına gelmez — `activePanel`
  state'i + `scrollIntoView`. Karar butonları (ONAYLA/REDDET/DAHA SONRA) hâlâ yalnız karar
  kaydeder (önceki sprint); `npm run selfheal -- apply` hâlâ tek uygulama yolu.
- Deterministik "AYAS rapor ver" ses akışı DEĞİŞMEDİ — aynı `BrainReportCenter` veri kaynağı;
  `detectAyasReportIntent` / `buildAyasReportSpokenAnswer` dokunulmadı.
- Access gate DEĞİŞMEDİ. Wake değişikliği client-only detector timing/pencere.
- `D:\AtolyeRuntime` / `D:\AtolyeAuthority` / Caddy / firewall / Tailscale / `.env` / Cloudflare
  tunnel — DOKUNULMADI.
- Prompt-injection / secret-detection suite'leri yeşil.

**SECURITY: PASS.**

---

## GRAPHIFY

`CONSISTENT-WITH-NOTES` · 16 == 16 · salt-okunur. Baseline ile aynı. Authority modeli değişmedi.

---

## REAL DEVICE

**Bu ortamdan fiziksel iPhone'a erişim YOK.** Aşağıdakiler operatörün cihaz testi:

Server + tunnel canlı: **`https://documents-lift-aquarium-unwrap.trycloudflare.com/brain`**
(cloudflared PID 26852 restart olursa URL değişir → `curl -s http://127.0.0.1:20241/quicktunnel`).
Yeni client build: `xf4frXSInAqN693rLVMye` — eski PWA'yı sil + Safari ▸ Gelişmiş ▸ Web Sitesi
Verileri temizle, yeniden kur.

```
reports:  PWA'da ana ekran → "🧠 AYAS Raporları" kartına dokun → ekran command center'a
          KAYAR ve "AYAS Raporları" paneli görünür ("Sistem Sağlığı %N" + boşsa açıklama,
          incident varsa liste). Beklenen: dokununca gözle görülür bir şey olur.
wake:     "AYAS" + "Atölye'de kaç proje var" tek/iki söyleyişte → Dinliyor → Düşünüyor →
          AYAS "…16 proje…" der. 3× gerekiyorsa: /brain/voice-lab/wake → "AYAS" ×10 →
          scoreDistribution.max + p90'ı kopyala (max < 0.60 = retrain gerekli; 0.60-0.68 =
          near-hard yardımı işe yarıyor olmalı).
voice:    wake tetikleniyorsa STT → chat → TTS zinciri (önceki sprintlerde PC-doğrulandı).
```

Kod tarafı PASS sonrası cevap formatı:
```
REAL DEVICE TEST:
REPORT BUTTON  = <operatör doldurur>
WAKE ONE-SHOT  = <operatör doldurur>
WAKE TWO-SHOT  = <operatör doldurur>
VOICE RESPONSE = <operatör doldurur>
```
Bunları PASS olarak yazmıyorum — cihaz testi yapılmadı.

---

## GIT

```
status:  clean (git status boş, git diff --check temiz)
commit:  f4fcc8e  fix(ayas): "AYAS Raporları" button did nothing on mobile + wake needs "AYAS" ×3
         (öncesi: 67095ee docs, 27a530f iPhone voice fix)
push:    NO — (empty = never pushed)
merge:   NO
deploy:  NO
branch:  wip/ayas-graphify-final-execution  (korundu)
```

Doküman güncellemeleri (bu rapor + checkpoint) `docs(checkpoint):` takip commit'i olarak eklendi.
Runtime data / secret / generated artifact commit'e girmedi (`data/brain/selfheal/` gitignored).

---

## FINAL STATUS

```
Reports button (code)   = FIXED   (mobil scroll-into-view + gerçek <button> + anchor; markup-doğrulandı)
Reports button (device) = UNKNOWN (operatör iPhone kontrolü)
Wake (pipeline)         = PASS    (buffer/catch-up/pre-roll/single-flight sağlam — problem değil)
Wake (engine/threshold) = ENGINE / THRESHOLD PROBLEM — model 1 sentetik sesle eğitilmiş;
                          softWindow 5→7 + near-hard fast-path recall yardımı (eşikler değişmedi);
                          gerçek çözüm operatörün retrain'i / veriye dayalı config
SECURITY               = PASS
BUILD                  = PASS
GRAPHIFY               = CONSISTENT
GIT                    = CLEAN
PUSH / MERGE / DEPLOY  = NO

VOICE_PIPELINE_READY = NOT READY (READY_WITH_OPERATOR_TEST)
```

İki bulgu incelendi, sınıflandırıldı, minimum güvenli değişiklikle ele alındı. Reports butonu bir
layout gerçeğiydi (kod düzeltildi, markup'ta doğrulanabilir). Wake bir model-recall limiti —
pipeline sağlam, threshold körlemesine düşürülmedi, güvenli bir recall yardımı eklendi ve gerçek
çözüm (retrain) operatöre bırakıldı. Hiçbir şey "gerçek iPhone'da çalıştı" diye raporlanmadı.
