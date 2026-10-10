# AYAS / Atölye — 10 Ekim kontrolü ve yeni PC teslimi

Owner'ın son talimatı: bugün tam yedekleme / offline recovery açılmayacak; pazartesi dosyalar flaşa alınacak, yeni PC'de programlar yeniden kurulacak. Önceki yedekleme onayı bu son talimatla geri çekildi. Bu oturumun kapsamı güvenli hata düzeltmesi, doğrulama ve taşınabilir kurulum kaydıdır. Eski kurtarma kanıtları tarihsel kayıt olarak korunur.

## Giderilen hatalar

- `smoke-ayas-autonomy-observer.ts`: eski `/brain/page.tsx` import beklentisi kaldırıldı; gerçek page → `AyasConsolePage` → `observerActions` bağlantısı, refresh callback'i ve karar modülünden ayrımı denetleniyor. Önce FAIL, sonra **22/22 PASS**; yanlış import/callback/karar import'u içeren üç bozuk örnek hâlâ reddediliyor.
- `smoke-ayas-publication-activity.ts`: batch görünümünün günü sabit `NOW` ile test verisinin tarihine bağlandı. Gün değişince günlük geçmiş filtresi nedeniyle oluşan yanlış FAIL giderildi. Önce FAIL, sonra **13/13 PASS**; gerçek successor kaybı içeren bozuk örnek reddediliyor. Günlük filtreleme ve uygulama davranışı değiştirilmedi.
- Claude yerel Graphify hook'ları: bulunmayan Python `graphify.EXE hook-guard` komutları yerine yerel Node hatırlatıcı kullanılıyor. Hook izin vermez/vermez kararı üretmez; ek bağlam verir. Diğer ayar/izin alanları korunur. `.claude/graphify-reminder.mjs` ve **Git dışında kalan** `.claude/settings.local.json` birlikte taşınmalıdır. Komut `CLAUDE_PROJECT_DIR` / çalışma dizinini kullanır; eski kullanıcı yolu içermez. Normal/bozuk girdi, iki gerçek komut ve başka proje konumuna taşıma dahil **9/9 PASS**. Gerçek Claude oturumunda çalıştırma ayrıca hedefte kontrol edilir.
- Graphify 0.17.1 yerel MCP: upstream `validateGraphPath` Windows `\` ayıracını `/` ile karşılaştırıp kendi graph dosyasını reddediyor. `scripts/graphify-local-mcp.mjs` yalnız bu kontrolü `path.relative` ile uyumlu hâle getiren, sürüm ve kaynak biçimi kontrollü yerel runtime kullanır. Kurulu global paket değiştirilmez. Önbellek `.graphify/mcp-compat` altında paket konumu ve değiştirilmiş kaynak hash'ine bağlıdır; yeni PC'de yeniden oluşur. Parent/sibling/başka disk/eksik dosya kontrolleri korunur: **18/18 PASS**. Gerçek MCP initialize, tools/list (**11 araç**) ve read-only summary **PASS**. İleride farklı Graphify sürümü için yeniden doğrulama gerekir.

Yerel MCP başlangıç komutu (repo çalışma dizini):

```powershell
node scripts/graphify-local-mcp.mjs
```

Bu komut stdio MCP sunucusudur; normal web sunucusu değildir. İstemci ayarında `command: node`, `args: [<yeni repo>/scripts/graphify-local-mcp.mjs]`, `cwd: <yeni repo>` kullanılır. Normal Windows npm global konumu dışında kurulumda `GRAPHIFY_MODULE_ROOT`, `@sentropic/graphify` paket klasörünü göstermelidir. VS Code'daki mevcut uzak Graphify hesabı/bağlantısı bu yerel protokol testiyle doğrulanmış sayılmaz.

## Doğrulama ve sınırları

Teknik/tool commit `584a44f` origin'e gönderildi ve [AYAS Safe CI](https://github.com/ahmetbalkan16-maker/atolye-v2/actions/runs/38053258198) **SUCCESS** tamamlandı. Lock'tan temiz kurulum, TypeScript, ESLint ve workflow'daki zorunlu deterministic kapılar geçti. Gözlemci 12:50:59Z'de doğal döngüde `OBSERVING`, `lastError: null` durumuna döndü. Bu kapanış notunu taşıyan sonraki commit yalnız dokümandır; teknik kaynak aynı kalır.

| Kontrol | Sonuç |
|---|---|
| Gözlemci / yayın durumu | 22 / 13 PASS |
| Brain Core UI / homepage sözleşmesi | 43 / 11 PASS |
| Micro-batch geliştirme merkezi / portable brain | 27 / 24 PASS |
| Graphify yol koruması | 18 PASS |
| Toplam bu oturum senaryosu | **158 PASS** |
| Dört kontrollü bozuk örnek | 4/4 reddedildi |
| TypeScript | exit 0; `--noEmit --incremental false` |
| Repository ESLint | 0 hata / devralınmış 13 uyarı |
| Frozen EVAL manifest | 15F.4-v59, 215 tekil pin, drift 0 |
| Graphify kapsam dışı 7 PowerShell dosyası | parser hata sayısı 0; çalıştırılmadı |
| Yerel ve public giriş kapıları | beklenen 307/200/401; tek origin/tünel |

Testler ayrı klasörler ve sentetik verilerle yürütüldü. `app`, `src`, `package.json`, `package-lock.json` uygulama baytları 2d6cef3 ile aynı; homepage görseli/işlevleri değiştirilmedi. Yeni bir Full166 sertifikası verilmedi; 2d6cef3'ün önceki Full166 sonucu kendi kaynağına bağlıdır. Mikrofon, telefon, gerçek ses/STT/TTS, üretim ve owner onay/yürütme akışlarının tamamı bu oturumda test edilmiş sayılmaz.

Graphify graph'i son Git commit'inden sonra yeniden yenilenir; yerel `.graphify/current-audit-20261010.json` final makbuzudur. **PARTIAL10 / semantic PENDING** devam eder: 7 PowerShell, 1 workflow ve 2 dinamik asset route dosyası. Bu eksik AST kapsamı için sahte node eklenmedi. CLI query ve yerel MCP protokolü çalışır; uzak MCP hâlâ CONFIGURED_UNVERIFIED.

## Pazartesi taşınacaklar

Önceki ölçüm: korumacı dosya/model/ayar kapsamı **41,67 GB**, pazartesi yeniden ölçülür. **128 GB flaş** önerisi geçerlidir. Kaynak listesi bu PC'de `C:\Users\Metod\.codex\visualizations\2026\10\10\01a12594-c923-77b2-a250-4991764b40b0\YENI_PC_TASIMA_PLANI.json` ve aynı dizindeki CSV'dir. Bu rapor dosyaları gerçek aktarımda ayrıca pakete alınır; listedeki eski ölçüm güncel dosya hash'i yerine geçmez. Yeni inceleme fixture'ları, onların dependency junction'ları ve MCP compatibility cache'i gerekli kurulum verisi değildir; özgün model/kanıt içeren `.graphify` bölümleri korunur.

Kaynak proje, runtime/authority kökleri, Brain/memory/project/asset verileri, `.env.local`, özel model/ağırlık/eğitim çıktıları, `.ollama`, gerekli kullanıcı ayar/kayıtları ve tünel kimlik dosyaları birlikte kapsanır. Gizli dosyaların değerleri rapora/Git'e yazılmaz. Eski PC kopyaları silinmez. USB gününde dosya listesi/hash/geri okuma kontrolü yapılır; bugün USB'ye yazılmadı.

## Yeni PC kurulumu — bu PC'de çalıştırılmayacak

1. Hedef Windows/kullanıcı/disk/GPU incelenir. Örnek kök `D:\Atolye`, repo `D:\Atolye\atolye-v2`; gerçek hedefte alan ve izinler doğrulanır. Kaynak Git ve yerel dosyalar birlikte açılır.
2. Node 24 ailesi (bu PC'de doğrulanan 24.18.0), Git, Ollama, gereken FFmpeg/FFprobe, Whisper/Piper, Cloudflared ve kullanıcı araçları kurulup gerçek sürümleri doğrulanır. Proje bağımlılıkları **lock'tan `npm ci`** ile kurulur; lock Next **16.3.8** ister. Mevcut PC'nin Next **16.2.10** ağacı kopyalanmaz. Graphify uyumluluk launcher'ı için `npm install -g @sentropic/graphify@0.17.1` kullanılır; komut hedefte uygulanıp doğrulanır.
3. Uyandırma için Python **3.11**, ses ortamı için **3.12.14** gözlenen tabandır. `docs/new-pc-20261010/PYTHON_INSTALL_PROFILES.json` ve üç `*-requirements-observed.txt` dosyası, çıkarılmış 91/54/14 paket sürümünü taşır. Yeni virtualenv'ler oluşturulur; Windows wheel/GPU uyumu gerçek hedefte kontrol edilir. Listeler yeni PC'de başarılı kurulum/import sertifikası değildir. Özel model dosyaları yeniden üretileceği varsayılarak atılmaz.
4. `ATOLYE_RUNTIME_ROOT`, `ATOLYE_RUNTIME_AUTHORITY_ROOT`, FFmpeg/FFprobe, Whisper model/executable, Piper model/executable, Ollama, uyandırma/Python ve tünel yolları yeni köklere bağlanır. Eski process PID/lease/logon/görev ayarı doğrudan aktive edilmez. Windows'a bağlı hesap oturumlarında gerekiyorsa owner yeniden giriş yapar.
5. Authority relocation / yeni cihaz aktivasyonu mevcut protokolle yapılır. Eski makinenin imzalı authority, onay ve audit kayıtları korunur; yalnız path metni değiştirilerek yeni çalıştırma yetkisi verilmez. `docs/PROJECT_STORAGE.md`, `docs/RUNTIME_AUTHORITY_GENERATION_BINDING.md` ve mevcut migration/transition servisleri esas alınır.
6. Graphify yeniden üretilir: `graphify update --scope all --no-description --no-label .`. Claude komutları ve yerel MCP gerçek hedefte kontrol edilir. Eski otomatik Access build/recovery görevleri kurulmaz; **F115** mevcut PC'de açık, yeni PC başlangıcına aynen taşınmamalı. Önce manuel/kontrollü başlangıç ve kabul, sonra ihtiyaç varsa ayrıca başlangıç düzeni hazırlanır.
7. Hedefte kontrollü build/start sonrası giriş/AYAS sohbet, Atölye proje ve asset erişimi, kayıt devamlılığı, modeller, mikrofon/STT/TTS, telefon/tünel ve yeniden açılış doğrulanır. Fiziksel cihazdaki owner testleri gereklidir. `AyasPortableMigration` içindeki 8 kontrol DEPENDENCIES → PATH_REBIND → ARTIFACT_HASHES → GRAPHIFY → HARDWARE_BENCHMARK → DURABLE_RESTORE → ON_DEMAND_STARTUP → AUDIT, gerçek hedef kanıtıyla tamamlanır.

**Bugünkü sonuç:** bulunan güvenli test/tool hataları giderildi ve doğrulandı. Mevcut PC'de bağımlılık takası, AYAS restart/build, görev müdahalesi, reboot, tam yedek veya data restore yapılmadı. Yeni PC henüz olmadığı için hedefte eksiksiz çalışır teslim bugün sertifikalanamaz; bu belge aynı hataları ve eski PC yollarını körlemesine taşımayı önlemek için kurulum kaydıdır.
