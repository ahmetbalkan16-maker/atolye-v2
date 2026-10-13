# iPhone uyandırma teşhisi — 13 Ekim 2026

## Devam — owner yöntemi seçti

Owner **“Kendi PC’mde ücretsiz Whisper ile uyandırmayı hazırla”** seçimini verdi. Yeni `/brain/voice-lab/local-wake` adayı, uyandırmadan önce kısa konuşma parçalarını mevcut session/same-origin korumalı STT endpoint'ine gönderir. Sayfada ayrıca gerçek veri akışı açıklaması ve START öncesi seçim vardır. Sessizlik upload yok; clip en fazla8s/256044WAVbayt, tek istek, en az4s istek aralığı,20s istemci timeout. STOP/unmount/background epoch iptali ve AbortSignal geç yanıtı etkisiz kılar; server wake-probe native çalışması bitmeden ikinci pre-wake job kabul etmez. Mevcut server thermal/max-audio/duration/rate kapıları korunur, wake probe8s ile ayrıca sınırlanır. Sadece owner-v3 leading alias + minTokenP>=0.3/meanTokenP>=0.65 ve[0,1]geçerli güven wake sayar. Bu yeni ASR güven kapısı akustik eşiği değiştirmez ve gerçek telefon güvenilirlik kanıtı değildir.

Aday test sayfası hiçbir chat/TTS/komut/proje çalıştırmaz. Ana sesli oturum mevcut akustik motoru kullanır; gerçek iPhone pozitif/negatif/STOP kabulü geçmeden main adapter değiştirilmez. Yukarıdaki kısa synthetic AYAS hâlâ reddedilir; Qiyas/Ayyes yeni alias yapılmadı. Tanı patch'i artık source'a uygulandı; eski patch yalnız bu oturumun incelenebilir tarihsel adayıdır, tekrar uygulanmaz. TypeScript/lint, yerel gate25, STTsecurity7 ve mobile36 kontrolleri geçiş öncesi doğrulanır. Temiz candidatebuild/HTTP ve kontrollü canlı test sayfası kabulü sıradadır; telefon veya wake görevinin tamamlandığı iddia edilmez. Alttaki yöntem-yanıt-bekleniyor ve source'a-uygulanmadı paragrafları önceki teşhis snapshot'ıdır.

Durum: **NOT READY — güvenilir telefon uyandırması henüz çözülmedi.** Bu kayıt tanıyı ve sonraki yöntemin seçimini saklar; telefon kabulü veya model yeterlilik sertifikası değildir. Owner önce uyandırma işinin yapılmasını, sonra D:\ÜRETİM altında toplama işinin ele alınmasını istedi.

## Owner'ın gerçek telefon gözlemi

Owner sayfanın açık ve mikrofonun etkin olduğunu bildirdi. Gönderilen gerçek wake lab kaydında seçili motor openWakeWord/ONNX; user-agent iPhone/CriOS olarak görünüyor. Bu kayıt Safari ve kurulu PWA için ayrıca başarı kanıtı değildir. START sonrası getUserMedia, AudioContext ve AudioWorklet başarılı; model hazır. Yaklaşık 17 saniyede 224 PCM kare, 215 embedding ve 200 wake değerlendirmesi işlendi. Kuyrukta düşen örnek yok, eşzamanlı inference 1, runner hatası yok. En yüksek ham skor **0,0005**, arayüzde yuvarlanmış max **0,001**; eşik 0,70 ve wake hits 0. Sonradan owner STOP'a bastığı için son Mic OFF / AudioContext closed / engine stopped değerleri beklenen duruştur; başlangıç başarısızlığı sayılmaz.

Bu denemede çalışan boru hattı uyandırma kararı üretmemiştir. Skoru 0,001 düzeyine indirerek kapıyı geçirmek yanlış uyanma riskini gizler. Son RMS 0,0033 yalnız son ses aralığıdır; seslenme anındaki ses yüksekliği, anlaşılabilirliği veya mikrofonun doğru konuşmayı aldığı kanıtlanmış değildir. Gerçek ses kaydı alınmadı. Modelin sesi genellemesi ile ses girişinin niteliğini kesin ayırmak için yeni ölçüm gerekir.

## Gerçek asset doğrulaması

Public HTTPS üzerinden üç model yeniden alındı; içerik uzunluğu ve SHA256 yerel asset ile aynı:

| Asset | Bayt | SHA256 |
| --- | ---: | --- |
| ayas.onnx | 870176 | 37aaab151f88fbd2fe795593176718aa10067a5526b8e41c94784aa08a80539c |
| melspectrogram.onnx | 1087958 | ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176f |
| embedding_model.onnx | 1326578 | 70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1f |

Yanlış/eski sunucu asset'i gözlenmedi. 8 Ekim'deki [kapalı model araştırmasının sonucu](ayas-wake-policy-v3/2026-10-07/FINAL_BLOCKED.md) hâlâ geçerlidir: mevcut model gerçek insan/telefon güvenilirlik kabulünü geçmiş sayılmaz. Reddedilmiş model, eşik değişikliği, yeni eğitim veya frozen kanıt değişikliği uygulanmadı.

## Yerel Whisper yapılabilirlik ölçümü

Mevcut Piper ve Whisper ile, gerçek insan sesi kullanmadan altı özel sentetik örnek işlendi. Aynı STT service/config ve mevcut thermal guard kullanıldı; ücretli sağlayıcı/kurulum/model indirme yok. Sonuçlar:

| Sentetik giriş | Gerçek STT çıktısı | Süre |
| --- | --- | ---: |
| Ayas | Qiyas. | 1839 ms |
| Ayas bugün nasılsın | AYAS bugün nasılsın? | 1619 ms |
| Beyaz kapıyı aç | Beyaz kapıyı aç. | 1550 ms |
| Hayat güzel | Hayat güzel. | 1538 ms |
| Bugün hava nasıl | Bugün hava nasıl? | 1555 ms |
| İki saniye sentetik sessizlik | Altyazı M.K. | 1522 ms |

**Whisper'a doğrudan geçiş de henüz yeterli değildir.** Tek kısa AYAS kaçırıldı; sessizlikte hallucination üretildi. Bunları yeni wake alias olarak kabul etmek veya her transcript'i komut saymak güvenli çözüm değildir. Bu küçük örneklem bağımsız qualification corpus veya gerçek telefon kabulü değildir. Ham sayısal sonuç Git dışı `.graphify/wake-phone-20261013/stt-probe.json` içinde; sentetik ses OS temp'te özel kalır.

## İncelenebilir aday ve devam noktası

[WAKE_LAB_DIAGNOSTICS.patch](ayas-wake-phone-20261013/WAKE_LAB_DIAGNOSTICS.patch) yalnız tanı alt sayfasının eski sabit HEURISTIC-STUB/Faz1b açıklamasını seçili motora bağlar, mevcut STT veri akışını doğru açıklar ve oturum maksimum RMS'sini rapora ekler. Gerçek motor hâlihazırda komut sesini STT'ye gönderdiği için eski “hiç ses çıkmaz” açıklaması bu modda yanlıştır. Aday uygulandığında TypeScript ve dosya lint PASS; ardından kaynak dosyasındaki kendi değişikliklerimiz ters patch ile geri alındı, adayın base'e uygulanabilirliği `git apply --check` ile doğrulandı. **Aday canlıya alınmadı; çalışan uygulama kaynağına değişiklik bırakılmadı.**

Sonraki yöntem için owner'a seçim soruldu ve bu kayıt yazılırken yanıt bekleniyor: uyandırmadan önce kısa konuşma parçalarının kendi PC'sindeki ücretsiz Whisper'a gitmesine izin veren yol veya yalnız cihaz içinde çalışan yeni model araştırması. Önceki veri akışında ses ancak akustik wake sonrası çıkıyordu; bu tercih sessizce değiştirilemez. Yöntem seçildikten sonra yeni bounded aday, pozitif/negatif/sessizlik/iptal/backpressure/TTS testleri ve gerçek iPhone kabulü hazırlanır. Whisper seçeneğinde yukarıdaki kısa-kelime hatası ayrıca çözülmeden aktive edilmez. Hiçbir yol tool/owner onayı/yürütme yetkisi vermez; homepage ve frozen kapılar korunur.

D toplama ön analizi [ayrı plandadır](AYAS_D_URETIM_CONSOLIDATION_PLAN_2026-10-13.md). Uyandırma çözülmeden canlı taşıma yapılmadı.
