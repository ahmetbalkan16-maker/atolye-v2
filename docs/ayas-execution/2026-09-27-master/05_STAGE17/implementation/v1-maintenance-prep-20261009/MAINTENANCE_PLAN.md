# AYAS güvenli bakım paketi — 2d6cef3 / Next 16.3.8

**MAINTENANCE = NOT_READY · FOUNDATION = BLOCKED · AYAS V1 = BLOCKED.** Bu belge hazırlıktır, bakım izni değildir. Bu oturumda deploy, Next restart, reboot, bağımlılık kurulumu, canlı yazma, APPROVE/YÜRÜT yapılmadı; canlı sunucuya istek atılmadı. Ölçümler: `LIVE_IDENTITY_READONLY.json`, `SOURCE_DEPENDENCY_DELTA.json`, `STATE_INVENTORY.json`, `ISOLATED_DRILLS.json`, karar özeti `MAINTENANCE_READINESS.json`.

## 0. Bakımdan önce verilmesi gereken karar — F115

İki AYAS görevi yalnız **interaktif logon**'da başlar. Access daemon o anda :3000'i kapalı bulur ve repo'da **o an checkout edilmiş HEAD**'i, **kurulu node_modules** ile `npm run build` yapıp başlatır. `recovery-audit.jsonl` son 15 günün 9'unda sabah 06.4x'te bu yeniden build'i gösteriyor; canlı 8 Ekim'de e974614 iken bu sabah böylece ab11e77 oldu.

Sonuç: bir sonraki oturum kapatma/açma, kapatıp açma, restart veya :3000 kesintisi, **2d6cef3 kaynağını (569d6f5 uygulama değişikliği dahil) Next 16.2.10 üzerinde, bakım penceresi olmadan** canlıya alır. İzole Drill C bu birleşimin 23 sn'de build olduğunu, açıldığını, kapı ve oturum kontrollerini geçtiğini gösterdi; gerçek cihaz, `.env.local`, ses ve telefon yolu kanıtlanmadı. 7 Ekim'de aynı mekanizma üç kez build hatası verdi, origin ~2,6 saat kapalı kaldı.

Owner seçenekleri (agent hiçbirini uygulamaz):
- **A.** Bakımı bir sonraki logon'dan önce yapmak.
- **B.** Bakıma kadar oturum kapatma, kapatma ve restart yapmamak; elektrik kesintisi riski kabul edilir.
- **C.** Sonraki logon'un 2d6cef3/16.2.10 build'ini kabul etmek; bu durumda bu bir "plansız deploy" olarak kaydedilir ve aşağıdaki sağlık kontrolleri yine yapılır.

## 1. Çalışan servis ve build kimliği (salt okunur)

| Alan | Değer |
|---|---|
| Build stamp | ab11e77 / CLEAN, 2026-10-09T03:48:16Z |
| BUILD_ID | S97dvGhTGFFsHILCPmoWV |
| `.next` ağaç özeti | fd0f9396… (1096 dosya, 1 junction → repo `node_modules\typescript`) |
| Kurulu Next | **16.2.10**; package.json ve lock 16.3.8 (lock 6 Ekim'den beri) |
| `node_modules` ağaç özeti | 2c171137… (25.977 dosya, 1,04 GiB) |
| Süreçler | next start :3000 PID 28928 (06:48:17); npm wrapper zinciri 15076; cloudflared 20716; Access daemon 2700; Observer wrapper 14788; Ollama 11148 |
| Görevler | "AYAS Access Online", "AYAS Autonomy Observer": LogonTrigger, InteractiveToken, IgnoreNew, süre sınırı yok |
| Access durumu | healthy; origin 26 / tunnel 17 deneme; ardışık hata 0 |

Not: build stamp'teki `lockfileSha256` 16.3.8 lock'unu gösterir, oysa build 16.2.10 ağacıyla yapıldı. Stamp çalışan bağımlılığın kimliği değildir (F116); bağımlılık kimliği ağaç özetiyle doğrulanır.

## 2. Kaynak ve bağımlılık farkı

- ab11e77 → 2d6cef3: docs dışında 17 dosya, +939/−52. Uygulama: exact-preview zorunluluğu (569d6f5), Gelişim Merkezi ve owner önizleme görünümü. package.json/lock değişmedi. d03c5a0 ve sonraki kanıt commit'i 2d6cef3'e göre yalnız dokümantasyondur.
- Kalıcı durum formatı: yeni kayıt türü yok; önizleme okuma anında hesaplanıp isteğe bağlanıyor. ab11e77 kodu aynı store'ları okur.
- Bağımlılık: canlı ağaç ile lock arasında 38 paket sürümü farklı, 8 paket yalnız canlıda var. Riskli olanlar: next 16.2.10→16.3.8, sharp 0.34.5→0.35.5, onnxruntime-node 1.24.3→1.30.0, @huggingface/transformers 4.2.0→4.3.0 (yerel ses/model yolları), wrangler/workerd/miniflare (yalnız Worker araçları).
- Fresh-lock çalışma ağacı (`.graphify/k3-fresh-lock-20261008/node_modules`, 5742657c…): win32-x64 için lock ile **birebir** (sürüm/integrity farkı 0). Full166 2d6cef3 bu ağaçla 166/166 geçti.
- **16.2.10 lock'tan yeniden kurulamaz**: geri dönüş yalnız bayt kopyayla mümkündür.

## 3. Canlı runtime/state kapsamı ve yedek envanteri

| Store | Yazan | Bakım değiştirir mi | Durum |
|---|---|---|---|
| `runtime\AtolyeRuntime` (2374 dosya, 583 MiB) | Yalnız üretim pipeline'ı (15 Eylül'den beri yazım yok) | Hayır | Özet b63b9509…; en uzun yol 260 karakter, yedek kökü canlıdan kısa olmalı |
| `runtime\AtolyeAuthority` (4 dosya) | Authority geçişleri | Hayır | Özet 7851b764…; kanonik yedek aracının marker'ı **yok** |
| Repo `data/brain` (4733 dosya, 16 MiB) | Next, Observer (5 dk), Access daemon (60 sn) | Yalnız yeniden başlayan süreçler | 6,3 dk'da 4 değişen + 2 yeni dosya; tutarlı yedek quiescence ister |
| Repo `.next` | Build | **Evet** | fd0f9396… |
| Repo `node_modules` | Kurulum | **Evet** | 2c171137… |
| `%LOCALAPPDATA%\AtolyeAyasAccess` | Access daemon | Log/state | recovery-state hash kaydedildi |
| `.env.local`, cloudflared config/kimlik, görev XML, vbs | — | Hayır, değiştirilmeyecek | Yalnız hash; içerik okunmadı |

Mevcut yedek kökü `Program\Atölye\backups` içinde güncel runtime için kanonik araçla alınmış yedek **yok** (b-0d971133190c Sprint 207 dönemi). `npm run runtime:backup:inventory` ilk çalışmada canlı authority köküne `runtime-backup-authority-v1.json` yazar; bu yüzden çalıştırılmadı (F117).

## 4. Restore doğrulama ve izole geri dönüş (TEMP'te kanıtlandı)

- **Drill A:** canlı `.next` + `node_modules`'un bayt kopyası canlıyla aynı; canlı kopya sırasında değişmedi. ab11e77 klonunda build'siz başlatıldı (88 ms); kapı 307/enforced, `/login` 200, oturumlu `/`, `/brain`, `/brain/briefing`, `/studio` 200.
- **Drill B (hedef):** d03c5a0 + fresh-lock kopyası → build exit 0 (23 sn), stamp CLEAN, 55 rota canlıyla aynı, aynı kontroller PASS. 129 Turbopack uyarısı (16.2.10'da 12) kaydedildi.
- **Drill C (F115 tahmini):** d03c5a0 + canlı 16.2.10 kopyası → build exit 0, aynı kontroller PASS.
- **Rollback provası:** hedef dizinde kaynak ab11e77'ye, `node_modules` ve `.next` aynı birimde yeniden adlandırmayla doğrulanmış kopyalara döndü (0,27 sn); ikisi canlı özetine eşit; build'siz açıldı, kontroller PASS.
- **Yedek/restore provası:** runtime ve authority kökleri TEMP'e yedeklendi ve ikinci hedefe geri yüklendi; tüm kopyalar canlıyla bayt bayt aynı.
- Kanıtlanmayan: canlı restart, canlı rollback, `.env.local` ile repo içi build, gerçek model/ses/telefon, public tünel, eşzamanlı yazarlar.

## 5. Yazarların ve daemon'ların güvenli durdurulma koşulları

- **Autonomy Observer:** wrapper, sıfır olmayan her çıkışta 30 sn sonra yeniden başlatır (10 kez). Sadece node sürecini öldürmek yetmez; görev **`schtasks /End /TN "AYAS Autonomy Observer"`** ile sonlandırılır. Güvenli an: `data/brain/autonomy/daemon-state.json` `updatedAt` son 60 sn içinde ve wrapper'ın altında tick çocuk süreci (`scripts/ayas-*`) yok. Sonrasında: komut satırında `ayas-autonomy-daemon` geçen süreç kalmamalı; `daemon.lock` serbest olmalı.
- **Next (:3000):** owner aktif sohbet, onay veya ses oturumunda olmamalı; bekleyen APPROVE/YÜRÜT yok. Yalnız `recovery-state.json` içindeki `wrapperPid` ağacı (`npm.cmd run start -- -p 3000`), komut satırı yeniden doğrulanarak, `taskkill /T` ile durdurulur.
- **Access daemon görevi durdurulmaz.** Next ve cloudflared onun çocukları; görevin sonlandırılması büyük olasılıkla telefon erişimini (tünel) de keser. Bu doğrulanmadı ve doğrulanması da gerekmiyor.
- **cloudflared'a, tünel ayarına ve görev ayarlarına dokunulmaz.**
- **`node_modules` tutanlar:** VS Code (ESLint/TS sunucusu), Claude Code, Codex ve repo'dan tsx çalıştıran terminaller kapalı olmalı. Takas öncesi `Get-Process` modül listesinde `<repo>\node_modules\` altından yüklü `.node` modülü kalmamalı.
- Üretim pipeline'ı, baseline, smoke, build veya başka agent çalışmıyor olmalı.

## 6. PC ve telefon erişimini koruyan bakım sırası (ancak ayrı onaydan sonra)

**Faz 1 — salt okunur giriş kapısı.** Branch temiz ve onaylı HEAD; `git ls-remote` eşleşmesi; `git diff 2d6cef3 HEAD` docs dışı boş. Canlı kimlik §1 ile aynı olmalı; logon build'i olduysa yeniden ölçülür ve onay yenilenir. Ayrıca: tek :3000 listener, tek cloudflared, iki görev Running, Access healthy ve 0 hata; RAM < %90; C: ≥ 10 GiB boş; Gelişim Merkezi dondurulmuş.

**Faz 2 — yedekler (canlı hizmet sürerken).** Onaylı yedek kökü (C: üzerinde, repo dışında) kullanılır.
1. `.next` ve `node_modules` kopyası alınır; özetler fd0f9396… / 2c171137… olmalı.
2. Runtime ve authority yedeklenir (b63b9509… / 7851b764…). Recovery-state ile görev XML hash'i kaydedilir.
3. Hedef ağaç fresh-lock'tan aynı birimdeki staging'e kopyalanır; özet 5742657c… olmalı.

**Faz 3 — quiescence.** §5 koşulunda Observer görevi sonlandırılır. Ardından `data/brain` yedeği alınıp doğrulanır (Access daemon'un `phone-access/status.json` yazımı hariç tutulur). Inbox/karar sayıları kaydedilir.

**Faz 4 — takas ve yeniden başlatma (daemon yoluyla).**
1. `recovery-state.json` `observedAt` yenilendikten sonraki 10 sn içinde Next wrapper ağacı durdurulur.
2. :3000 kapandığı ve `node_modules` modülü tutan süreç kalmadığı doğrulanır.
3. `node_modules` → `staging\rollback-16.2.10` ve `staging\target-16.3.8` → `node_modules` taşınır (yeniden adlandırma, <1 sn).
4. Daemon ≤60 sn içinde repo'da `npm run build` ve `start` yapar. `recovery-audit.jsonl`'de `origin start success`, yeni stamp (onaylı HEAD, CLEAN) ve kurulu Next 16.3.8 beklenir.
5. Takas başarısız olursa ilk taşıma hiçbir şeyi değiştirmemiş olur. Daemon bu durumda HEAD'i 16.2.10 ile build eder (Drill C durumu); bu, onaylanmış bir ara/geri dönüş durumu olarak kabul edilmelidir.
6. Daemon takastan önce build başlatırsa takas yapılmaz. Build bitince adımlar bir sonraki döngüde tekrarlanır.

**Faz 5 — sağlık kontrolleri (§8).**

**Faz 6 — Observer'ı yeniden başlatma.** `schtasks /Run /TN "AYAS Autonomy Observer"`. `daemon-state` heartbeat'i artmalı, faz `OBSERVING` olmalı.

**Faz 7 — owner cihaz testleri.** Telefonda PWA, giriş, mikrofon, wake, Türkçe TTS, barge-in, ekran kilidi ve Wi-Fi kopup geri gelme; PC'de giriş ve K3 ayrıcalıklı yeniden giriş. Liste: `../v1-final-closure-20261008/LIVE_MAINTENANCE_AND_PHONE_CHECKLIST.md`.

**Faz 8 — reboot (ayrı onay).** Görevler yalnız interaktif logon'da başlar; owner oturum açmadan AYAS ve telefon erişimi gelmez. Logon'da daemon aynı HEAD'i 16.3.8 ile yeniden build eder.

**Faz 9 — kapanış receipt'i.** Kaynak/lock/ağaç/build kimlikleri, yedek konumları ve özetleri, kontrol sonuçları, owner cihaz sonuçları ve (varsa) rollback kaydı.

Beklenen kesinti: her origin yeniden başlatması için 30–130 sn (algılama ≤60 sn + repo build ~25–60 sn + sağlık bekleme). 8 Ekim F95 geçişi ~70 sn sürdü; garanti değildir. Kesinti sırasında telefon tünelden hata görür.

## 7. Hedef build için izole build/test hazırlığı

Hazır: Full166 166/166 @2d6cef3 (fresh-lock 16.3.8), izole hedef build ve boot (Drill B), 55 rota eşitliği, fresh-lock = lock. Pencere HEAD'i 2d6cef3'e göre docs dışında **herhangi** bir değişiklik içerirse eski sertifika taşınmaz: yeni Full166 ve yeni izole build gerekir. Yalnız docs değişikliğinde yeniden koşu gerekmez; HEAD kuralı Faz 1'de kontrol edilir.

## 8. Sağlık kontrolleri ve açık rollback tetikleyicileri

Kontroller (Faz 5, her biri kaydedilir):
1. `http://127.0.0.1:3000/` ve `/brain` → 307, `x-ayas-access-gate: enforced`, `Location /login?next=…`; `/login` → 200. Aynısı `https://ayas.atolyeayas.com` için.
2. `recovery-state.json`: `healthy`, `publicHealth healthy`, ardışık hata 0; tek listener, tek tünel.
3. Stamp: onaylı HEAD, CLEAN. Kurulu `next` 16.3.8; isteğe bağlı ağaç özeti 5742657c….
4. Runtime ve authority özetleri değişmemiş.
5. Owner oturumu: giriş, `/brain`, Gelişim Merkezi exact önizlemeyi gösterir, önizlemesiz YÜRÜT sunmaz; APPROVE verilmez.
6. Observer heartbeat'i yeniden artıyor.
7. 30 dk gözlem: yeni origin denemesi yok, RAM < %90.

**Rollback tetikleyicileri** (herhangi biri):
- Daemon build'i bir kez başarısız (üç hatayı beklemeden).
- 180 sn içinde origin healthy değil.
- Kapı yanlış (korumalı yolda 200, enforced değil) veya `/login` ≠ 200.
- Public kontrol 5 dk'dan uzun başarısız.
- Owner girişi veya K3 oturumu bozuk.
- Stamp yanlış HEAD/DIRTY veya Next sürümü yanlış.
- Ana sayfalarda 5xx.
- Telefonda ses/sohbet regresyonu.
- Runtime/authority özeti değişmiş.
- İkinci listener veya tünel (ambiguous).
- RAM ≥ %90 veya sıcaklık hard-stop.

**R1 — yalnız bağımlılık geri dönüşü:** Faz 4 mekanizması tersine işletilir (`node_modules` ↔ `staging\rollback-16.2.10`) ve daemon yeniden build eder. Sonuç Drill C durumudur: 2d6cef3 kaynağı + 16.2.10.

**R2 — ab11e77'ye tam geri dönüş:** R1'e ek olarak, kill'den önce `git switch --detach ab11e77` yapılır. Branch ve commit'ler değişmez, history yeniden yazılmaz. Daemon ab11e77 + 16.2.10 build eder (bu sabahki canlının eşdeğeri). Bu build başarısız olursa bayt yedekli `.next` geri konur ve daemon'un bir sonraki döngüsünden önce repo'da `npm run start -- -p 3000` elle başlatılır.

R2 sırasında worktree detached kalır; branch'e dönüş ayrı owner adımıdır ve F115'i yeniden tetikler. Her iki rollback'te APPROVE/YÜRÜT donuk kalır (ab11e77'de exact-preview zorunluluğu yoktur). Authority, runtime ve history elle düzeltilmez.

## 9. STOP noktaları

- Faz 1 kapılarından biri başarısız → **ABORT_BEFORE_BACKUP**.
- Yedek özetleri eşleşmiyor veya disk yetersiz → **ABORT_BEFORE_QUIESCE**. Canlı değişmemiştir.
- Observer güvenli anda durmuyor, `node_modules` tutan süreç var veya owner aktif → **ABORT_BEFORE_SWAP**. Observer yeniden başlatılır.
- Faz 4'te daemon yarışı → takas yapılmaz, döngü beklenir. Belirsiz durumda STOP ve owner'a sorulur.
- Faz 5 tetikleyicisi → **R1/R2** (M7 onayına göre), ardından STOP.
- Telefon testi başarısız → reboot yapılmaz, STOP.
- Her durumda: `npm install`/`npm ci`/`audit fix` yok; tünel, görev veya `.env.local` değişikliği yok; APPROVE/YÜRÜT yok; homepage/Brain UI V2 çalışması yok.

## 10. Owner'ın açıkça onaylaması gereken işlemler

M1–M11 `MAINTENANCE_READINESS.json` içinde listelidir: hedef kimlik; pencere saati ve kabul edilen kesinti; yedek konumu ve ~1,9 GB yazım; Observer görevini durdurup başlatma; yalnız Next wrapper ağacını durdurma; `node_modules` takası; R1/R2'nin önceden onayı ya da "önce sor"; owner cihaz testleri; ayrı reboot onayı; pencere boyunca Gelişim Merkezi dondurma; F115 kararı.

## Eksik kanıt (MAINTENANCE = NOT_READY nedenleri)

- Kalıcı, doğrulanmış yedek yok; tüm prova kopyaları TEMP'teydi ve silindi.
- `data/brain` için quiescence altında yedek ve restore alınmadı.
- Canlı restart ve canlı rollback NOT_RUN.
- `.env.local` ile repo içi build, gerçek ses/model ve telefon yolu NOT_RUN.
- Owner'ın gizli değerler için kendi güvenli kopyası doğrulanmadı.
- F98 combined writer kanıtı, Recovery9 aktörleri, Lemon/Fiverr ve fiziksel cihaz testleri ayrı açık kapılardır. Hiçbiri PASS sayılmadı.
