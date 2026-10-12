# 12 Ekim 2026 — Atölye genel kontrolü

Durum: **devam ediyor; genel hatasızlık / canlı yeni sürüm kabulü henüz verilmedi.**

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
