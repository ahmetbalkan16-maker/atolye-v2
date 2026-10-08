# AYAS erkek ses V2 — yerel dinleme örnekleri; owner değerlendirmesinde DUR

Üç farklı sentetik erkek profilinden **üç dinleme örneği hazır**. Üç bağımsız motor/model değildir; aynı Pocket TTS Turkish modelinin `male_1`, `male_3`, `male_2` profilleridir. Canlıya alınmadı ve hiçbir profil seçilmedi. Modelin yayımlanmış ticari kullanım lisansı doğrulandı; **tam eğitim/öğretmen hak zinciri, owner dinlemesi ve kalite kabulü kapanmadığı için ticari üretim kabulü verilmedi**. Lisansı belirsiz bir model kabul edilmiş gibi sunulmuyor.

Son owner talimatı yalnız yerel/açık model kullanımını belirler. Önceki tek API denemesi HTTP401 döndürmüş, ses üretmemişti; bu erişim hatası AYAS kod hatası değildir. API yolu kapatıldı, yeni API çağrısı yapılmadı ve anahtar talebi kaldırıldı. Tarihsel hata kanıtı korunur.

Başlangıç HEAD `60e161192f5912cfbad0a4af1376a7c1531e7b8e`, aynı `wip/ayas-graphify-final-execution` dalı ve asıl worktree; pull güncel, origin ahead/behind 0/0. Graphify-first bu HEAD üzerinde Piper, browser adapter ve mevcut ses profilini inceleyerek tamamlandı. Son kayıt HEAD'i Git'ten, commit sonrası Graphify/integrity kaydı `.graphify/2026-10-08/AYAS_MALE_V2_LOCAL_HEAD.json` üzerinden çözülür.

## Yerel örnekler ve karşılaştırma

Özel dosyalar `.graphify/male-voice-persona-v2/audio-local/` altında; WAV/ağırlık/insan kaydı GitHub'a gönderilmez. Dosyalar 24 kHz mono, 16-bit PCM. Üç örnekte de owner'ın aşağıdaki **aynı üç cümlesi** birebir giriş olarak kullanıldı; yerel frontend'in normalizasyonu ham kanıtta ayrıca kayıtlıdır. Bu cümleler dinleme senaryosudur, gerçek proje durumu beyanı değildir.

> Merhaba. Ben AYAS. Size nasıl yardımcı olabilirim?
>
> İstediğiniz araştırmayı tamamladım. Sonuçları sizin için hazırladım.
>
> Atölye projesinin son durumunu kontrol ediyorum. Tamamlanan görevleri birazdan açıklayacağım.

| Örnek / dosya | Yayımlanmış profil | Süre | Sıcak ilk PCM p50 / p95, n=16 | İlk profil çağrısı | F0 medyan vekili |
| --- | --- | --- | --- | --- | --- |
| CALM / `AYAS_CALM_V2.wav` | male_1; sakin/tok anlatıcı | 14.02 s | 76.13 / 117.81 ms | 618.24 ms | 98.36 Hz |
| PROFESSIONAL / `AYAS_PROFESSIONAL_V2.wav` | male_3; net/artikülasyon odaklı | 13.78 s | 75.74 / 94.08 ms | 531.92 ms | 131.87 Hz |
| INTELLIGENT / `AYAS_INTELLIGENT_V2.wav` | male_2; daha parlak/enerjik | 15.38 s | 73.86 / 108.75 ms | 450.10 ms | 121.83 Hz |

İsimler owner hedeflerini karşılaştırmak için kullanılır; PROFESSIONAL'ın daha derin veya INTELLIGENT'ın daha zeki duyulduğu **ölçülmüş değildir**. Hepsinde `emotion=sakin`, seed1008; oyuncu/karakter referansı, insan sesi klonlama, yapay pitch değiştirme ve deneme sonrası ayar araması yok. Yayımlanmış profil tanımları [model kartında](https://huggingface.co/wite-tech/pocket-tts-turkish) bulunur. F0 otokorelasyon vekilidir; oktav hatası olabilir, algılanan tokluk/doğallık/kimlik kabulü değildir.

Bütçe üretim öncesinde sabitlendi: tek yeni model, üç profil, 51 tam çıktı +3 kesme denemesi, CPU, PyTorch intra/inter-op1, en çok1200s; gerçekleşen üretim63.44s. Motorun üretim/decode iş parçacıkları eşzamanlı çalışabilir; işlem CPU süresi tek çekirdek kullanım yüzdesi değildir. Model+tokenizer+üç profil dahil toplam indirme439,016,524bytes, 450MB sınırında. Resmî PyPI wheel'leri SHA256 kilitli, ayrı venv'de; proje bağımlılıkları/global Python/Piper değişmedi. `torch2.8.0`, `pocket-tts3.3.0`, `pocket-tts-turkish0.1.0`; model revizyonu `fcbd37c74dc127be846face0ff36062e9a939f7b`. Çalıştırma `HF_HUB_OFFLINE=1`, yerel veri yolları ve GPU kapalı yapılmıştır; konuşma metni/audiosu harici servise gönderilmedi.

| İşlem kaynağı / sıcak16 örnek | CALM | PROFESSIONAL | INTELLIGENT |
| --- | --- | --- | --- |
| İşlem CPU zamanı p50 / p95 | 1281.25 / 3101.56 ms | 1273.44 / 2824.22 ms | 1296.88 / 3484.38 ms |
| Tam üretim p95 | 1987.34 ms | 1828.03 ms | 2265.65 ms |
| İlk parçadan sonra generator kapatma | 14.34 ms | 14.55 ms | 16.18 ms |
| Geçerli/sessiz olmayan WAV | 17/17 | 17/17 | 17/17 |
| Ham float tam ölçek aşımı, tüm17 çıktı | 0 | 13 örnek / uzun cümle | 1 örnek / uzun cümle |

Tek paylaşılan test işleminin peak working set'i1,211,936,768bytes (~1155.79MiB), veri staging/yükleme geçicilerini de kapsar; ses başına ayrı RAM maliyeti değildir. Demo sonlarındaki working set932,552,704 /981,237,760 /956,268,544bytes. Üç owner-demo WAV'ının clipping sayısı0; uzun stres cümlesinde PROFESSIONAL ham peak1.049877, INTELLIGENT1.007042. Bunlar kabul kapısındaki açık kalite bulgularıdır; sessizce normalize edilmedi, dosya yazıcısının standart PCM clipping'i ayrıca açıklanır.

İlk PCM, `stream()`'in ilk boş olmayan gerçek audio parçasının gelişidir; playback/ilk duyulan hece değildir. Soğuk model yüklemesi ayrıca2055.41ms, ASCII staging+hash ayrı kayıtlı. İlk profil ölçümleri model yüklemesini içermez. Önceki yerel Piper referansının firstPCM p95~478.85ms'i ayrı süreçte/farklı10 cümleyle ölçülmüştür; sıcak resident-model sayılarıyla eş koşul hız kazanımı iddiası yapılmaz. Referans dosyası SHA256 `fa5348c6da55df8b58fd01e7e4efcf44581c9d3048d4e177cb9f809b52cb1556`,4.5822s/22,050Hz,3 tam ölçek PCM örneği; değiştirilmedi.

## Telaffuz ve kalite kapıları

16 ortak test metni Türkçe karakterler, sayı/tarih/para, özel isimler, soru, sohbet ve uzun cümleyi içerir. 51/51 WAV biçim/finite/sessiz-olmama kontrolü geçerli; bu sonuç genel kalite PASS değildir. Var olan yerel Whisper-small ile sabit19 kliplik CPU2 probe yapılmıştır: üç demo +her profilin AYAS/karakter/sayı/şehir/soru/uzun cümle örnekleri ve eski Piper referansı. Yeni STT bağımlılığı veya canlı STT/wake entegrasyonu yok, prompt ile cevap yönlendirilmedi.

Her profilin AYAS kısa cümlesi ASR'de `Ayas` olarak ve WER0 okunur; /s/-/z/ akustik doğruluğu veya owner algısı bundan çıkarılmaz. CALM demo'da Atölye→Haftarya, PROFESSIONAL'da Atölye→Satülya transkripsiyon farkı var; INTELLIGENT demo WER0. Şehir/soru örneklerinde %44.44–55.56 WER; Çağrı adında kayıp/fark, INTELLIGENT sayı örneğinde1250,50→250,50 görülür. Ham farklar korunur; ASR hatası ile gerçek ses hatası ancak dinleyerek ayrılır. Genel Türkçe telaffuz **PASS ilan edilmez**.

Doğallık, huzurlu dinleme, prosodi, vurgu, robotik his, özgün persona ve gerçek AYAS telaffuzu **OWNER_LISTENING_NOT_RUN / NOT_MEASURED**. Yayıncı WER/RTF/MOS sayıları bizim ölçümümüz gibi kullanılmadı. Gerçek cihaz/browser playback, echo, barge-in ve canlı ilk ses gecikmesi **NOT_RUN**. Generator kapatma testi bunların yerine geçmez. Otomatik aday seçimi yapılmadı.

## Lisans / hak değerlendirmesi

| Katman | Birincil kaynak ve sonuç |
| --- | --- |
| Türkçe wrapper kodu | [Sabit kaynak](https://github.com/witetech/pocket-tts-turkish/tree/88df358df6b57fb6bddaa82ac7d2d856521b7a20): Apache-2.0. Dağıtılan kodda lisans/NOTICE koşulları korunmalı. |
| Upstream Pocket motoru | [Kyutai LICENSE](https://github.com/kyutai-labs/pocket-tts/blob/main/LICENSE): MIT; test edilen3.3.0 wheel lisansı da okunmuştur. |
| Türkçe ağırlıklar / yayımlanan paket | [Türkçe model kartı](https://huggingface.co/wite-tech/pocket-tts-turkish): CC-BY-4.0; [upstream model](https://huggingface.co/kyutai/pocket-tts) de CC-BY-4.0. NC koşulu yok, ticari kullanım yayımlanmış lisans kapsamında mümkün; atıf/lisans bağlantısı/değişiklik bilgisi korunmalı. |
| Konuşmacı | Yayıncı üç erkek profilin gerçek insan kaydı değil, metinsel tasarımdan üretilen sentetik sesler olduğunu beyan eder. Yalnız bu yayımlanmış profiller kullanıldı; aktör taklidi veya insan sesi klonlama yok. Yayıncı beyanı bağımsız kimlik/izin sözleşmesi denetimi değildir. |
| Eğitim verisi | Kart306 saat kendi yerel TTS'leriyle üretilmiş sentetik ses ve Tatoeba CC-BY2.0FR /FineWeb2 ODC-By1.0 /Türkçe Wikipedia CC-BY-SA4.0 metinlerini açıklar. Bunların ticari yeniden kullanım koşulları vardır. Öğretmen model kimliği, onun veri/konuşmacı hakları ve sentetik üretim izin zinciri tam yayımlanmamış: **OPEN, tam ticari hak zinciri PASS yok**. |
| Gelir getiren içerik | [CC-BY4.0 hükümleri](https://creativecommons.org/licenses/by/4.0/legalcode.en) yayımlanmış malzeme için ticari paylaşımın önünü açar; kişilik/mahremiyet haklarını kendiliğinden lisanslamaz. Model lisansından üretilmiş tüm sesler için koşulsuz hak garantisi çıkarılmadı. Bu görev ticari üretim onayı vermez. |
| Atıf / dağıtım | Modeli paylaşırken yayıncı/kurucu eser/CC-BY bağlantısı ve değişiklik bilgisi; kod paylaşırken MIT/Apache metinleri ve geçerli NOTICE korunmalı. Model eğitimi değişmedi; sadece3 yerleşik sentetik profil seçilip yerel örnek üretildi. Ses yayınında muhafazakâr atıf+AI açıklaması için `V2_ATTRIBUTION.md`; kayıtlar insan konuşması gibi sunulmamalı. |

Hakları tamamen kapanmış, owner kalite onaylı üç ticari aday **bulunmuş sayılmıyor**. Üç yerel örnek karşılaştırma için mevcuttur; açık öğretmen hak zinciri ve kalite bulguları giderilmeden ticari üretime kabul edilemez. Bu sınır owner'ın “lisansı belirsiz modelleri kabul etme” talimatını korur.

Diğer incelenen yerel çözümler:

| Teknoloji | Lisans / aday yapılmama nedeni |
| --- | --- |
| Mevcut Piper/DFKI | [Ses kartı](https://huggingface.co/rhasspy/piper-voices/blob/main/tr/tr_TR/dfki/medium/MODEL_CARD) CC-BY-NC-SA4.0; ticari hedef için elendi, önceki sistem korundu. Eski runtime MIT, [bakımlı successor](https://github.com/OHF-Voice/piper1-gpl) GPL3; yükseltme yok. |
| MMS Turkish / Anka | [MMS](https://huggingface.co/facebook/mms-tts-tur) ve [Anka](https://huggingface.co/krmkayabasi/Anka-TTS) ağırlıkları NC; ticari hedef için elendi. Kodun serbest lisansı ağırlık koşulunu kaldırmaz. |
| Coqui Turkish GlowTTS | [Resmî katalog](https://github.com/coqui-ai/TTS/blob/dev/TTS/.models.json) MIT model/vocoder, “unknown speaker” der; erkek kimliği ve konuşmacı hakları kapanmadı, indirilmedi. |
| FreyaTTS-small | [Kod/kart](https://github.com/freyavoiceai/FreyaTTS) Apache2.0, kanonikLeyla tek ses. [Teknik rapor](https://arxiv.org/abs/2607.09530) rızalı konuşmacı SFT'sini açıklar; bu beyan yok sayılmadı. Üç belgeli sabit erkek persona yok; rastgele seed aramasıyla erkek aday uydurulmadı. |
| Antalia1 | [Hak raporu](https://labs.patientdesk.ai/antalia-1-report/) codeApache2/OpenRAIL-M, rızalı tek kadın konuşmacı ve yayımlanan corpus; erkek hedefe uymuyor, geliştirme discontinued. İndirilmedi. |
| EMA / Trendyol | [EMA](https://huggingface.co/canberkkkkkk/ema-tts) Apache2, [Trendyol](https://huggingface.co/Trendyol/Trendyol-TTS) MIT beyanlı. Özel eğitim verisi/erkek persona hak zinciri bu incelemede kapanmadı, aday kabul edilmedi. |
| Chatterbox multilingual | [Resmî proje](https://github.com/resemble-ai/chatterbox) MIT/Türkçe desteği; üç uygun kişinin lisanslı/rızalı referansı yok. İnsan klonlama veya büyük ek model indirmesi yapılmadı. |
| Tarihsel Piper Fahrettin | [Sabit eski kart](https://huggingface.co/rhasspy/piper-voices/blob/c943ef2ef718de2600086f77cb0b3b5353110efd/tr/tr_TR/fahrettin/medium/MODEL_CARD) CC0; güncel upstream'de kaldırılmış. Kaldırılma nedeni varsayılmadı, üçüncü taraf mirror kullanılmadı. |

## Skill, güvenli çalıştırma ve doğrulama

Yerel skill envanteri ve resmî `openai/skills` curated listesi incelendi; özel Piper/yerel neural-TTS/lisans/MOS skill'i bulunmadı. `skill-installer` ile katalog sorgulandı. Resmî `speech` skill'i özel ignored klasörde okundu; OpenAI API gerektirdiğinden güncel yerel üretimde **kullanılmadı**, global skill kurulumu yok. `transcribe` API skill'i de yeni STT için kullanılmadı. Önceki API araştırmasında okunan OpenAI Docs güncel yerel yolun motoru değildir. Ek plugin/ücretli servis/hesap kurulmadı. Kaynak incelemesi sonrası resmî Python API ile yalnız yerel offline recipe kullanıldı.

Upstream kod değiştirilmeden wheel hashleri ve model LFS SHA256 değerleri doğrulandı, safetensors/yaml.safe_load yoluna bağlı kaldı. İlk yükleme SentencePiece'in Windows Unicode yol hatasıyla, ikinci ortam denemesi sandbox TEMP izniyle **ses üretmeden** durdu; iki FAIL korundu. Yedi doğrulanmış veri dosyasının ASCII TEMP kopyasıyla native izole çalıştırma tamamlandı; dosya hashleri yeniden doğrulandı ve geçici kopyalar yalnız bilinen dosyalar üzerinden kaldırıldı. Provider401/Windows path/sandbox erişim hataları wake modeli hatası olarak yorumlanmadı.

Asıl runtime kaynakları, homepage, PWA, tüm WakeV3/Frozen kanıtları, paket kilidi, ses ayarları ve önceki model değişmedi. Frozen15F.4-v57:323 pin /214 dosya, fark0. Test sonrası originPID24324/wrapper28768/tunnel18572 aynı, yerel+public sağlıktrue; iki görevRunning, XML/tunnel config/buildID birebir aynı. Mevcut assistant browser synthesis profili ve ayrı Piper narration provider korunmuştur. Pocket PyTorch modeli mevcut Piper ONNX arayüzünün yerine takılabilir kabul edilmez; yeni server/adapter/browser endpoint yok. Windows/iPhone gerçek kullanım uyumluluğu NOT_RUN.

Bu kayıt dokümantasyon/kanıt kapsamındadır; TypeScript kaynak değişmedi, önceki statik/voice/build PASS kayıtları yeni runtime doğrulaması gibi yeniden adlandırılmadı. Yeni51 gerçek yerel WAV,19 gerçek ASR probe,3 kesme probe, korunmuş referans/FAIL hashleri ve metadata/archive kontrolleri yapılmıştır. Graphify yapısal **PARTIAL9**, semantik **PENDING** kalır; son HEAD ile güncellenecek, eksik açıklamalar PASS olmaz.

Master Plan **Stage17 / Foundation BLOCKED**, WakeV3 **BLOCKED** ve son mel denemesi kapalıdır; tekrar eğitim yok. Owner ses dinlemesi/hak zinciri/telaffuz/doğallık/device/echo/interrupt kapıları ve bağımsız WakePASS eksiktir. BrainUIV2/homepage tasarım sınırı **STOP**; ana sayfaya değişiklik yapılmadı. Burada owner örnek değerlendirmesi için durulur; seçme/entegrasyon/canlı ses değişikliği için ayrı açık yetki ve gerekli kapılar gerekir.

Kanıtlar `v2-local/INDEX.json` ile SHA256 bağlı küçük gzip metadata ve kendi recipe'lerimizdir; üçüncü taraf kaynak/SDK/model/audio commit edilmez. Diğer bilgisayarda sesler Git'ten gelmez; gerekirse aynı pinned recipe ayrı yetkili yerel değerlendirmede yeniden üretilir. Mevcut WAV'lar ve önceki FAIL'ler bu hostta korunur.
