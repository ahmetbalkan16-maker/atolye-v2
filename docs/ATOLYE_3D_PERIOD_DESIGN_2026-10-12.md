# 12 Ekim — yerel 3D ve yıl/dönem kıyafeti tasarım adayı

Owner yeni isteği: referanstaki beyaz yüzlü maskotları daha kaliteli çiz; 3D yapılabiliyorsa dene; kıyafet/başlık/takı anlatılan kültür, sahnenin yılı ve role uysun. Çok izlenen YouTube eğitici animasyonlarından araştırma yapıp kendi özgün video tasarımını iyileştir. İlk tam konu videosu daha sonra değerlendirilecek.

## Gerçek mevcut durum

Canlı üretim hâlâ source03308c76 / CLEAN buildhtR7TBNeqdb0pk7eeDEic / artversion4 **2D**. Bu iş app/src/package/env/sağlayıcı/owner verilerini değiştirmedi; yeni build/restart gerekmez. Ortak GPU73°C durdurma aynıdır. Yeni **3D aday üretime bağlı değildir**: `.ts` bakım/önizleme scriptleri, mevcut CharacterRig/POSE_ANGLES/scene planner ve incelenmiş 2D saray cache'i üzerinde çalışır. Homepage/otorite/bütçe ve eski PNG'ler korunur. 2D v5 cilası planlanmıştı; owner'ın sonraki 3D/dönem isteğiyle kalite çalışması önce bu adaylara yöneltildi, v5 canlıymış gibi sunulamaz.

`scripts/local-visual-runtime/character-volume.ts` gerçek XYZ üçgen hacimleri, yüz/giysi/el/ayakkabı, rol-kültür başlığı, kamera dönüşü, iki ağız durumu ve mevcut10pozdan geçiş üretir. Son PNG'ler CPU z-buffer ile örtüşür; kürelerde interpolated lighting vardır. SVG çıktısı yalnız diagnostiktir; onun painter sıralaması son video yolu olarak kabul edilmez. OBJ çıktısı düz geometry'dir; skin/rig/textured GLB teslimi değildir. Blender/Three/driver/ek model kurulmadı. Bu bir tam3D saray veya profesyonel film kalitesi iddiası değildir.

## Yıl/dönem kuralı

`period-wardrobe.ts`: sahneye ait açık year/years, kültür ve rol → küçük kaynak penceresi → kaynak esinli tasarım adayı. MÖ negatif, MS pozitif, yıl0 yasak. Yıl yoksa, birden fazla yıl varsa, dönem/rol için kaynak yoksa `RESEARCH_REQUIRED` ve recipe null; renderer dönemli çıktı isteğini reddeder. İstek metadata'sı yeniden hesaplanan briefing ile aynı değilse reddedilir. Bu kurallar **önizleme yolunda bağlıdır**, üretim sahnesine henüz eklenmemiştir. Genel kültür önizlemesinin yıl doğruluğu olduğu iddia edilmez.

İlk5pencere: Osmanlı15.yy hükümdar portresi / Osmanlı16.yy saray kumaşı / ManuelII dönemi Bizans tören kıyafeti / erken1.yy Roma askerî hitap kıyafeti / MÖ1473–1458 18.hanedan hükümdar tören kıyafeti. Bunlar bütün yıl, kişi, cinsiyet, rütbe ve ortamları kapsamaz; status daima `REFERENCE_INSPIRED_NEEDS_REVIEW`. 1480 portresi1453kişisel kıyafetini kanıtlamaz; 16.yy kumaşı bütün başlığı veya kombini doğrulamaz. Bir hükümdar portresi danışman/muhafız kıyafetini doğrulamaz. Tek generic SDXL sarayı dönemin gerçek sarayı kabul etme.

Doğrudan araştırılan kataloglar: [National Gallery, MehmetII1480](https://www.nationalgallery.org.uk/paintings/gentile-bellini-the-sultan-mehmet-ii), [Met, 16.yy kumaşı](https://www.metmuseum.org/art/collection/search/445264), [Met, ManuelII loros ve pendilia](https://www.metmuseum.org/press-releases/dazzling-byzantine-treasures-displayed-in-major-international-exhibition-at-metropolitan-museum-opening-march-23-2004-exhibitions), [Vatican, PrimaPorta Augustus](https://www.museivaticani.va/content/museivaticani/en/collezioni/musei/braccio-nuovo/Augusto-di-Prima-Porta.html), [Met, Hatshepsut](https://www.metmuseum.org/art/collection/search/544450). Eser bilgisi kıyafet ayrımına referanstır; tasarım renkleri ve bütün aksesuarlar aynı ölçüde tarihî kanıtlanmış değildir. Dini ülke/kişiden çıkarma; haç gibi sembol yalnız açık faith bağlamında.

## YouTube araştırması — gözlem ile çıkarımı ayır

12Ekim browser/read-only inceleme, videoların tamamı izlenmedi. UI'daki izlenmeler o gözlemin sayılarıdır; büyüme veya gelir tahmini değildir. Video veya thumbnail/müzik dosyası indirilmedi/kopyalanmadı; yayın/yorum/abonelik yapılmadı.

| Örnek | Erişilen kanıt | Tasarım değerlendirmesi |
|---|---|---|
| [OverSimplified, WW2 Part1](https://www.youtube.com/watch?v=_uk_6vfqwTA) | Gerçek oynatma/kareler, açıklama; UI105.301.551görüntüleme. Başlangıçtan ve ileri sarılmış farklı bölümlerden örnekler. | Kişi/harita/nesne ve mizahi görsel arasında değişim görüldü. Ayrışan siluet ve basit yüzlerle anlatım okunuyor; her kare ayrıntılı dekor gerektirmiyor. |
| [History Matters, Constantinople sorusu](https://www.youtube.com/watch?v=C_uaLrbcpXE) | İlk saray karesi görüldü; ileri sarma sonrası oynatıcı hata verdi. Güncel view sayısı doğrudan doğrulanmadı. | İlk karede rütbe kıyafetleri, kısa yazılı kart ve ayrı oyuncular var. Orta bölüm, hareket temposu ve miks incelendi iddiası yok. |
| [Alan Becker, Animator vs Animation Season1](https://www.youtube.com/watch?v=NTJd6G4Vd2g) | Gerçek oynatma/kareler; UI16Mn. Siyah figürün ortam/nesneyle etkileşimi görüldü. | Bu örnek tarih doğruluğu için değil poz/siluet/eylem okunurluğu için. Ayrıntılı gövde çizimi tek başına hareket anlatımının yerini almıyor. |
| [Yusuf Kayaalp, Hızlandırılmış Tarih](https://www.youtube.com/watch?v=7CV8FkEAWO0) | Türkçe altyazılı gerçek kareler; UI3,4Mn. | Kişiler ve fotoğraf/çizim/nesne bir arada kullanılıyor; bizim ailemizde daha tutarlı yüz/giysi stili ve yıl-role bağlı tasarım hedefliyoruz. |

Müzik incelemesi **açıklama/kredi düzeyinde**: OverSimplified açıklaması KevinMacLeod/Incompetech, Audionautix ve CC attribution müzik/SFX kaynaklarını belirtir. AlanBecker açıklaması SarahEide müzik ve remastered sound design kredisi verir. Browser sessizdeydi; müziği dinleyip tür/seviye/ducking ölçülmüş gibi sunma. Referans parçaları Atölye'ye eklenmedi. Mevcut montaj kodunda narration sidechain ducking zaten vardır; bu çalışma onu değiştirmez. İleride mood/tempo/yerel lisanslı müzik ve SFX seçimi gerçek konuşma üzerinde dinlenerek değerlendirilir; tek sinüs demo sesi nihai müzik kalitesi değildir.

**Bizim tasarım kararımız/çıkarımımız:** anlatımı destekleyen geniş→konuşmacı→ifade→nesne/kıyafet planları; konuşanın görsel odağı belirgin; arka plan kontrastı/detayı oyuncuyu bastırmaz; cümleye uygun hareket ve mizahi tepki; konuya göre müzik, konuşma anlaşılabilirliği öncelikli. Bu örneklerden retention/izlenme nedeni çıkarılamaz. “Onlardan iyi” kalite hedefidir; kanıtlanmış sonuç veya gelir garantisi değildir.

## Gerçek yerel önizlemeler ve kontroller

Repo `bin/ayas-local-visual/demos/` Git dışıdır:

- `volume-1791824397753/`: dört saray sahnesi, üçkamera/poz görüntüsü,24kare/6fps sessiz hareket WebP. XYZgeometry/CPU z-buffer, paid0/GPU kullanılmadı.8.798s, peakRSS576.094.208B, Sharp2thread. Bu toplam küçük önizleme ölçümüdür; uzun1080p/30fps video performansı değildir. Ağız synthetic preview timing; gerçek ses hizalaması yok.
- `period-volume-1791824650964/`: beş dönem kıyafeti adayı;2.918s/346.697.728B/paid0. Osmanlı1453ve1550 farklı tarif; Roma uzunkaftan yerine kısatunik/zırh, Mısır kısa kilt/başlık. Hepsi kaynak esinli inceleme adayı.
- `volume-storyboard-1791831692773/`: dört gerçek3Dkadraj, ruler15.yy adayı, farklı yardımcı ölçekleri, odağı destekleyen arka plan;3.530s/398.336.000B/paid0. Saray ve yardımcı kıyafetlerinin dönem doğrulaması eksik olarak açıkça işaretli.

`smoke-volume-character.ts`: dört farklı kültür,10gerçekPNGpoz, per-pixel occlusion/order bağımsızlığı, ağız/kamera, açık faith, boundedXYZ/OBJ, farklı dönem, eksik/çoklu yıl, MÖ/MS ve rol/reference/metadata tahrifi reddi PASS. TypeScript/lint PASS. Yeni test frozen suite'i değiştirmez. Tek yeni Full166 koşusu iddiası yok. Mevcut canlı source/app/dependency diff0 olduğu için build veya reboot yapılmaz. Gerçek canlı qualification/ready makbuzu ve finalGraphify bu oturumun ignored `delivery-volume-design` klasöründe kapanışta tutulur.

## Sıradaki bağlama işleri — tamamlandı sayılmayacak

1. Sahneye ait NarrativeUnit/kanıtlı claim yılını briefing'e bağla; metindeki asker sayısını veya videonun başka bölümünün yılını kıyafet yılı sanma. Ayrı kişi/rol/olay/dönem, cinsiyet ve saray kanıtlarıyla eksik kapsamı genişlet; mevcut araştırma/owner proposal kapısı korunur.
2. 3D materyal/giysi kıvrımı/başlık/eller/aksesuarlar ve ifade çeşitliliğini iyileştir; sert üst-gövde veya hepaynıPOINT pozunu son kalite sayma. Kalite-gözlem, occlusion, yüzlerin okunurluğu ve poz bağlılığı kabulü.
3. Yeni versioned üretim stili: CPU raster yolunu portable PNG/scene payload ve CharacterImageProvider→video→assembly boyunca bağla. Eski1–4 çıktıları sabit tut. Frozen audio sırası/test/otorite ve fiyat sınırı korunur. İlk3Duzunvideo sağlık/süre/disk/per-frame bounds kabulü yapılmadan varsayılan değiştirilmez.
4. Gerçek Türkçe sesle cümle/kelime hizalaması, mevcut lisanslı yerel müzik ve SFX/ducking, anlamlı kadraj geçişleri. Owner'ın sonraki konu-video incelemesi gerçek kalite kabulüdür; sessiz WebP tamvideo değildir.

Bu belge oturum/devam kaydıdır. Canlı2D teknik üretim yolu çalışır; owner'ın yeni profesyonel3D+dönem+ses hedefinin tamamı henüz bitmedi.
