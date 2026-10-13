# Atölye cümleye bağlı hareket ve ortam — 13 Ekim 2026

Owner gerçek cümle–hareket eşleşmesini, önceki referansın ortam/kadraj/harita iyileştirmelerini; ardından yalnız kullanılmayan indirmelerin temizliğini ve AYAS/Atölye genel kontrolünü istedi. Mevcut çalışan yolların korunması önceliklidir. Bu belge yeni işin kaydıdır; üstteki checkpoint canlı/kaynak ayrımını belirtir.

## Mimari ve uygulama

Yeni portable `NARRATION_DIRECTION_V3` ve kapalı `editorial` planı eklendi. Önceki V2, eski3D ve2Dmetadata/kare yolu korunur. Geliştirme yeni varsayılan CharacterImageProvider üretimine bağlanır; geçmiş projeler yeniden yazılmaz. Frozen video→audio→assembly sırası aynıdır.

Son montajda seçilmiş kanonik audio asset +audioStartSeconds/duration +o asset'in bölüm sourceText'i doğrulanır. Kurulu Whisper CLI `-ng`,4CPUthread, `-ml1 -sow -ojf` ile konuşma zamanlarını çıkarır. Telefon STT servisi/config değişmez; model/API indirilmez, ücret yok.5s PC sağlık kontrolü, süre/çıktı/disk sınırı ve yalnız kendi TEMP klasörünün doğrulanmış temizliği vardır. Sıfır genişlikli gerçek kelime çapaları kabul edilir; süre uydurulmaz.

Monoton sınırlı LCS, duyulan kelimeleri mevcut sourceText'e bağlar. En az%80coverage gerekir; kaynak dışı veya eksik duyulan eylem tahminle oynanmaz. Cümleler gerçek ölçülmüş başlangıç/bitiş aralıklarına bağlanır; negasyon sakin anlatımda kalır. Konuşma/jest/işaret/eğilme/oturma/diz/yürüme/koşma ve açık kılıç eylemi kapalı mevcut rig'i kullanır. Yürüyüşün varış noktası sonraki cümleye taşınır; başlangıca ışınlanmaz. Ses etkinliği boşlukta ağzı kapatır. Konuşmacı kadrajı gerçek cümle sınırlarında yumuşak değişir; grup eylemi ve harita geniş kalır.

Yeni ses, ilk tahmini klipten uzunsa assembly kendi V3klibini en az gerçek anlatım süresi boyunca çizer; eski kaynak klip/asset kaydı değişmez. Değişen özel klibin gerçek süresi ffprobe ile doğrulanır. Eski cut/xfade/ducking/price/authority yolları aynıdır. Montaj içi tekrar okumalar için en fazla16scene tutan, WAV+source+modelkimliği ile bağlı süreç cache'i vardır; kalıcı keyfi timing sidecar'ı okunmaz.

Bu akustik cümle/kelime zamanları Whisper tahminidir; fonem forced alignment veya her kelimede kusursuz dudak şekli iddiası değildir. Anlam seçimi kapalı, açık eylem sözlüğüdür; bütün doğal dil eylemlerini anlayan sınırsız bir model değildir. Belirsiz ASR sonucu başarılı hizalama sayılmaz.

## Ortam, kaynak ve tekrar kullanım

Özgün yerel vektör fallback: meydan/avlu, orman+sonbahar/kış, liman, kütüphane, çalışma odası ve pazar; önceki saray cache korunur. Gece/akşam rengi yalnız yeni sahnede birlikte uygulanır. SDXL bir kez yapılan offline mühendislik incelemesiyle aynı SHAkitaplığında yeniden kullanılan courtyard/forest/harbor adayları üretir; her kare veya video için model açılmaz. Avlu cache yalnız açık Osmanlı1450–1600, yelkenli liman yalnız1450–1700 ve tek sahne yılı; diğer dönemlere rastgele eski mimari/gemi uygulanmaz. Orman mevsimi açık sözcüklerden seçilir. Eksik uygun cache yerel fallback, bozuk cache fail-closed. Oluşturulan ortamların tarihî bir yapının birebir rekonstrüksiyonu olduğu iddia edilmez.

Harita ilk kaynaklı konum çifti Ankara–Busan'dır: [GeoNames Ankara](https://www.geonames.org/323786/ankara.html)39.91987/32.85427 ve [GeoNames Busan](https://www.geonames.org/1838524/busan.html)35.10168/129.03004. Yerel authored şematik kıta şekli, sabit renkli noktalar ve ilerleyen bağlantı kullanılır; gösterilen çizgi gerçek tarihî deniz rotası/sınır değildir. GeoNames atıfı ekranda; bilinmeyen koordinat/yer uydurulmaz. Yeni konum kapsamı ayrı kaynak eklenmesini gerektirir.

## Kanıt ve teslim kapıları

Gerçek kısa Türkçe ses CPU Whisper PASS: “Kılıcın ağzına ve sapına bakalım.”0–2.18s POINT; “Şimdi eğilip selam veriyorum.”2.68–4.36s BOW; coverage1, paid0. İlk teşhis sıfır genişlikli “Şimdi” çapası nedeniyle reddetti; ham JSONkorundu, parser bu meşru çapayı uydurma süre olmadan destekler. Pure cümle/negasyon/unknown/silence/camera/env/oldV2-V3metadata/walk-endpoint testi PASS. İlgili özel kanonik eski2D/3D/provider/FFmpeg/kitaplık/WAV/dönem/subtitle9suite PASS. TSC/lint ilk kaynak için PASS; sonraki cache/time bağlantısı finalde yeniden doğrulanır.

Git dışı kanıt: narration-final-20261013. Gerçek V3demo, yeni environment görüntüleri/cache kabulü, son cleanbuild/CI/privateHTTP/rollback/live/protected fingerprint; ardından indirme-cleanup ve genel sistem kontrolü henüz kapanış kanıtı bekler. Bunlar tamamlanmadan bütün görev hazır sayılmaz. Ortak GPU73°C, mevcut fiyat/sahip onayı/homepage/kayıtlı karakter kitaplığı korunur.

İlk gerçek4sahne V3montajı PASS: avlu/silah-eğilme/sonbahar yürüyüş/harita, bütün4ASRcoverage1; yaklaşık18.5s, Piper/özgünmüzik/ducking/API0. Bu adayın alt etiket ayağı örtüyordu; yalnızV3üst etiket ve kısa caption düzeltildi, finaldemo yeniden üretilir.5yeni SDXLcache adayının tamamı gözle/SHA mühendislik kabulü aldı, sıcaklık koruması vepaid0makbuzları tutuldu. Tam lint ilk iki hata yalnız kuruluPyTorch/cache tanıJS'siydi; exact üçüncü taraf klasörleri ignore edildi, proje kaynağı aynı aktif lint. Son tamlint0error/13devralınmışwarning; TSC0error. Yanlış çoklu-sahne test adı hamFAIL kaldı, doğru smoke-multi-shot-assembly-render2scenarioPASS. Gerçek cleanup/genelkontrol ve son canlı/Graphify teslimi sıradadır.
