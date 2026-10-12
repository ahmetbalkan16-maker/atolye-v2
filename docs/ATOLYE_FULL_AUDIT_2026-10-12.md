# 12 Ekim 2026 — Atölye genel kontrolü

Durum: **devam ediyor; kaynak düzeltmesi canlıda doğrulandı, geniş taramanın kalan eski testleri henüz kapanmadı.** Genel hatasızlık / yeni Full166 sertifikası verilmez.

Başlangıç kaynak HEAD: `b0ac2591e9fc71e5c6130ceabe64a2f2ca900f4b`, origin ile eşit. Başlangıç canlı uygulama `0f0ef5d`, build `_d7VZ_06v2f0NPdit7Kor`; instrumentation mevcut. Authenticated runtime healthy/ready, worker hazır, aktif execution 0; Studio 200 / 16 okunabilir proje. Gerçek runtime durumuyla readiness 27/27 geçti; özel probe klasörü temizlendi. Eski proje kayıtları yeniden oynatılmadı.

## Uygulanan düzeltmeler

- Strict araştırma / senaryo üretimine mevcut parser sınırlarından türetilen JSON grammar bağlandı. Kaynak alanı HTTP(S) URL ister; SEO anahtar kelimeleri ve bölüm/anlatım bütçesi sınırlıdır. Native modelin fazla uzun anlatımı sahne süresini aşıyordu: üretim grammar'ı mevcut kısa-video bütçesine bağlandı. Parser'ın eski uyumluluk aralığı ve semantic kontrolleri korunur; lenient research/script yolu değişmez.
- A2000 profilinde Ollama isteği boyunca mevcut salt-okunur sıcaklık sensörü izlenir. 60°C sınırına ulaşılırsa yalnız o HTTP isteği iptal edilir; aynı sıcak istek otomatik tekrar edilmez. Global servis, driver, güvenlik ayarı değiştirilmez. Okunamayan sıcaklığın mevcut politikası korunur; boş sensör çıktısı artık sahte 0°C sayılmaz.
- İsteğe bağlı `OLLAMA_NUM_GPU` / `OLLAMA_NUM_THREADS` eklendi. Ayarlanmadığında eski config, payload ve acceptance fingerprint korunur; açık değerler fingerprint'e dahil edilir. CPU aday denemesinde `0` / `4` kullanıldı; bu belge yazılırken canlı modele/ortama uygulanmadı. Ollama resmi seçenek tanımları: https://github.com/ollama/ollama/blob/main/api/types.go.
- Testlerde atomic-write dosyasının geçici kaybolmasına bağlı yarış, writer'ın kendi async context'inden yapılan yanlış reader testi ve eksik özel storage context'ler düzeltildi. Missing-artifact UI testleri yalnız run-owned boş proje klasörü kullanır. Yerel-provider testi eski `unknown` klasörüyle çakışmayan benzersiz test kimliği kullanır. Teşhis CLI canonical smoke izolasyonuna alındı. Üretim yetki / lock / maliyet korumaları gevşetilmedi.
- CI'ya yeni schema (22) ve thermal/options/fingerprint (18) kontrolleri eklendi.

## Doğrulama ve gerçek sınırlar

TypeScript 0 hata; tam lint 0 hata / 13 önceki uyarı. Özel kopyada character PipelineRunner E2E 6 kontrol, 12 aşama, gerçek FFmpeg H264/AAC çıktı geçti; metin/ses fixture'dır. Ücretli seslendirme uç noktası çağrılmadı.

İlk geniş tarama, `b0ac259` özel tam-history kopyasında 145 suite: **109 PASS / 36 FAIL**. Ham başarısız sonuçlar saklanır; bu bir Full166 yeni sertifikası değildir. Düzeltme sonrası 13 hedefli yeniden koşunun 12'si geçti; kalan local-provider test bağlamı ardından düzeltildi, doğrudan 72 kontrol geçti. Gerçek FFmpeg thumbnail içeren özel yeniden koşu ve kalan eski suite sınıflandırması devam ediyor. İlk koşucunun relatif `--import tsx` seçeneği geçici cwd'deki child process'te modül bulunamamasına neden oldu; mutlak file URL ile implicit-root safety **30/30 PASS**. Bu ön koşul farkı ürün hatası olarak gizlenmez.

Yerel Gemma3:4b CPU adayında native araştırma (234066 ms), son senaryo (154561 ms, 5 bölüm / 1448 anlatım karakteri), sahneler (175437 ms, 10 sahne) gerçek Ollama ile geçti. Son iki aşama aynı önceki gerçek araştırma çıktısını tekrar kullanır; yeni araştırma çağrısı iddiası yok. Aday henüz canlıya atanmadı. Bu teknik çıktı doğrulamasıdır; modelin tarihsel iddiaları yayın öncesi kaynak/editor kontrolü gerektirir.

12B GPU aday denemesinde sıcaklık 78°C oldu; yalnız kendi özel test süreci durduruldu. Başarılı olarak raporlanmadı; partial/ABORTED_THERMAL makbuzları korunur. Yeni aktif izleme bu boşluğu kapatır. CPU denemesinde Ollama VRAM kullanımı 0 görüldü; GPU daha sonra 43–48°C aralığındaydı. Canlı AYAS modeli değiştirilmedi.

## Kalan işler

1. Eski başarısız suite sonuçlarını yeni runtime authority/policy ön koşulları, Windows path sınırları ve gerçek hata ayrımıyla tamamlamak; fail kayıtlarını PASS diye çevirmemek.
2. Temiz kaynak commit'inden, `instrumentation.ts` dahil tüm tracked dosyalarla izole build; runtime health bundle testi. Geri dönüş artifact'i korunarak kontrollü canlı geçiş ve startup qualification.
3. Canlı yerel/public erişim, authenticated health / Studio, readiness, korunan veri fingerprint'leri; model profilinin nihai kararını açık kaydetmek.
4. Exact final HEAD Graphify AST + gerçek yerel MCP sorgusu, dokümantasyon/checkpoint/Git push/CI kapanışı. Graphify semantic PENDING / PARTIAL kapsamını gizlememek.

PC reboot/telefonun owner kabulü yapılmadı. Yeni owner videosu, ücretli çağrı, YouTube upload, Windows/driver kurulumu yapılmadı. Eski projelerdeki orphan/failed/legacy yetki kayıtları otomatik düzeltilmedi.

## Kanıt klasörü

`C:\Users\Metod\.codex\visualizations\2026\10\10\01a12594-c923-77b2-a250-4991764b40b0\atolye-full-audit-20261012`

Başlıca kayıtlar: `BROAD_RESULTS.jsonl`, `broad-logs/`, `PREPARED_RECHECK.jsonl`, `FAILURES_RECHECK.jsonl`, `IMPLICIT_RUNNER_RECHECK.jsonl`, `MODEL_CHAIN.json`, `MODEL_CHAIN_ARTIFACTS.json`, `GEMMA12_CANDIDATE_ABORTED.json`, `LIVE_AUTH_ENTRY.json`, `READINESS_ENTRY.json`, `PROTECTED_BEFORE.json`, `LINT_CLOSURE.log`. Ham kayıtlar credential içermez. Korunan data fingerprint yöntemi path/size/mtime metadatasıdır; content backup olarak adlandırılmaz.

## Kaynak düzeltmesinin canlı kabulü — 12 Ekim 08:51 Türkiye saati

Kaynak `8eebc10446e73fa741754131c4947cac8385041a` commit edilip mevcut uzak dala push edildi. Tam-history temiz kopyada bütün tracked kaynaklar (`instrumentation.ts` dahil) derlendi. Build `1osyiX6oqrIuLIy2JohQ-`, CLEAN stamp aynı source HEAD; kurulu Next16.2.10/lock16.3.8 aynen korundu. Webpack mevcut Graphify `createRequire` uyarılarını verdi; build ve gerçek instrumentation/route bundle sağlık kontrolü geçti. Özel HTTP sunucusu: gate307/enforced, login200, runtime healthy/ready/workerReady/acceptingExecutions, Studio200, owner verisi kullanılmadı; test sunucusu kapatıldı.

Canlı origin 7848→10880 ve supervisor11928→14852; mevcut penceresiz Startup kısayolundan başlatıldı. Tünel/Ollama/Observer/ortam ayarları değiştirilmedi. Qualification **501 build / 25976 dependency PASS**, startup verification PASS. Önceki `.next` ve qualification `rollback-runtime-20261012` altında tutulur. Geri dönüş artifact yanında bu tek kaynak commitinin revert edilmesini de gerektirir; tek başına build değişimi yeterli değildir.

Gerçek giriş oturumuyla health healthy/ready, aktif execution0, Studio200/16 proje. Local/public giriş kapıları307/enforced, login200, korunan health401; ObserverOBSERVING/null error. Gerçek runtime snapshot'ı ile readiness **27/27 READY**, probeRemoved=true. Bu ses sağlayıcısının key/config ve storage/media ön koşullarını kanıtlar; ücretli TTS çağrısı veya bakiye kanıtı değildir.

Readiness adaptörleri kendi iki sentinel projesi için persistent authority claim oluşturmuştu. Ham AFTER kaydı4→6 farkını gösterir. İki claim'in projectIdentity değeri tam olarak bu oturumun probeRoot UUID'leriyle eşleşti; iki probe yoktu, aktif lock yoktu. İçerik/hash/absolute kök kontrolleri ve küçük metadata capture sonrası yalnız bu iki kendi claim'i temizlendi. `PROTECTED_CLEAN.json`: runtime2374, authority4, repoProjects2399; üç metadata digest başlangıçla birebir aynı. Eski claim/proje kayıtlarına dokunulmadı.

Yeni yerel sağlayıcı kontrolü **73 PASS** (gerçek FFmpeg thumbnail dahil; Piper kurulu değil, açık SKIP). Yeni schema22/thermal18 PASS. Native adayda değişen bütün kaynak dosyalarının SHA256 değerleri source8eeb ile aynı: `NATIVE_SOURCE_BINDING.json`; native makbuzun eski scope etiketi değiştirilmedi. Canlı model **Qwen2.5:3b**, AYAS ayrıGemma3:12b korunur. Aday CPU knobs ortak AYAS profilini de etkileyebileceği için canlıya atanmadı. GPU sınırında istek iptali güvenlik korumasıdır; tüm bilgisayarın her iş yükü için mutlak sıcaklık tavanı garanti edilmez.

Source commit CI [38209677863](https://github.com/ahmetbalkan16-maker/atolye-v2/actions/runs/38209677863): **SUCCESS**. TypeScript/lint, yeni iki gate, frozen raw/review ve exact clean HEAD CF49 closure/regression gates geçti. Frozen manifest ve pinler değiştirilmedi.

36 FAIL yeniden koşusunda12 PASS /24 FAIL; ayrıca implicit-root30 PASS (koşucu file URL düzeltmesi) ve build-health-bundle PASS (gerçek build ön koşulu) ile ilk145 kümesinden **123 doğrulanmış PASS /22 kapanmamış suite** vardır. Bu 123/145 tek temiz HEAD üzerinde komple yeniden koşu iddiası değildir; başlangıç109 + gerekçeli yeniden koşulardır. Kalan22 suite mutlak loader ile yeniden koşulmaktadır; sonuç/ham hatalar kanıt klasöründe. Eski suite'lerde readonly getter mutasyonu, eski marker/policy fixture, eksik explicit root, Windows exact path fixture ve negatif registry beklentisi görüldü. Bunların tümünü ürün dışı olarak otomatik aklamıyoruz; tam tarama bunlar netleştirilmeden tamamlanmış sayılmaz.

Sıradaki somut iş: `REMAINING_ABSOLUTE_RUNNER.jsonl` tamamını oku; kalan22 suite'yi güncel authority/policy/cost ön koşullarıyla tek tek yeniden üret/düzelt, özellikle129.28 public-provider-snapshot ve129.27 audio compensation timeout. Üretim güvenlik sınırlarını veya frozen beklentileri gevşetme. Yeniden kaynak değişirse tekrar temiz build + controlled rollout gerekir. Son doküman HEAD'i için Graphify/yerel MCP/CI makbuzu oturum kaydıyla birlikte tutulur.
