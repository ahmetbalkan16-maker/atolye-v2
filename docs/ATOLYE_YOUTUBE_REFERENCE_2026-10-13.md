# YouTube görsel anlatım incelemesi — 13 Ekim 2026

Kaynak: [Devrin Yolcusu — Eğer 1950’lerde Kore’ye Asker Olarak Gitseydin?](https://www.youtube.com/watch?v=vz8xkADucl0). Owner istedi; önce ekipman/hareket/ses görevi ve canlı kontrol bitirildi, sonra bu inceleme yapıldı.

## Gerçek gözlem ve erişim sınırı

Tarayıcıda9:19süre doğrulandı. Açıklamada8Ekim2026 ve yapay zekâyla oluşturulmuş ses/görsel bildirimi görünür. Yaklaşık0:06,1:00,2:00,3:00,4:00,6:00,8:00kareleri ve4.dakika çevresindeki kısa oynatma örneklendi. Video tamamı izlenmedi; ses kapalı inceleme nedeniyle müzik/miks/konuşma kalitesi dinlenmiş sayılmaz. İlk AX ileri-sarma değerleri gecikti; son oynatıcı ekran zamanları esas alındı. Tarihî anlatı ve kıyafet doğruluğu ayrıca doğrulanmış değildir.

- 0:06: taş/ahşap kantin, sıcak lambalar, radyo; beyaz sade yüzlü askerlerde belirgin cepler ve başlıklar.
- 1:00: bıyık ve üniformayla ayrışan yakın karakter, arkasında küçük harita.
- 2:00: parşömen dünya haritası, kesikli rota ve yürüyen yolcu figürüyle yolculuk anlatımı.
- 3:00: karakterin çevresindeki küçük nesne simgeleri anlatımı destekliyor.
- 4:00 çevresi: sonbahar/araçlı genel plan; sonraki örnekte iki farklı hayatı karşılaştıran bölünmüş ekran.
- 6:00: desenli ev içi ve farklı yatak/giysi ayrıntıları. Kar/kış yakın çekimi de ileri-sarma sırasında görüldü.
- 8:00: kahvehane kalabalığında başlık/yelek/saç ayrımları, ortada anlatan asker.

## Bizim sisteme uygulanabilecek tasarım

Bu bölüm gözlemden çıkarılan **öneridir**; izlenme artışı kanıtı veya yeni kod özelliği değildir.

| Öncelik | Özgün iyileştirme | Mevcut bağlantı ve doğrulama |
|---|---|---|
|1|Karakterde düz koyu giysi yerine sınırlı gölge, dikiş/kemer/manşet ve rol silueti; eldeki nesnenin önü açık|Volume/PeriodDesign +CharacterDesignLibrary. Yıl/kültür/rol kaynak kapsamını genişletmeden doğru ilan etme. Aynı tasarımı yürüyüş/eğilme/diz/konuşmada kontrol et.|
|1|Boş araziyi tekrar etmek yerine sahnenin yeri, mevsimi ve olayına bağlı özgün meydan/kışla/ev/orman/liman|Mevcut backdrop cache yalnız sınırlı saray kapsamındadır; diğer mekânlarda ayrıntılı kütüphane işi henüz yapılmadı. Önce bir kez yerel varlık üret/kabul et, tekrar kullan.|
|2|Her anlatım bölümünde genel plan→ana kişinin orta/yakın planı→bilgi görseli; nedene bağlı cut veya kısa geçiş|Mevcut editorial camera ve multi-shot montaj kullanılabilir. Kaynak varlıkları yeniden yazmadan ve ek GPU/API çağrısı olmadan storyboard öner. Gerçek sahne/cümle hizalaması ayrı açık hedeftir.|
|2|Haritada sade sınırlar, sabit grup renkleri, okunaklıyer/ad/yıl, hareketli rota/ok ve olay vurgusu|Doğru ve lisanslı özgün harita geometrisi/verisi gerekir. Referans haritasını alma; mevcut şematik simgeyi coğrafi doğruluk diye sunma. Yerel katmanlı rota renderer'ı yeni geliştirme işidir.|
|3|Sıcak gündelik ortam–soğuk kış–ölçülü vurgu renkleri, bir sahnede az sayıda baskın renk|Bağlamlı ortam/tasarım planına uygulanabilir; bütün arka planlara tek sepya filtre veya saray koyma. Telefon boyutunda yüz/el/silah okunurluğunu ölç.|

Mevcut motorun gerçek3Dekipman/rig/CPU kareleri, yerelPiper ve özgünmüzik/ducking bağlantısı çalışır. Referansın ayrıntılı çizgi-illüstrasyon estetiği mevcut3D malzemesinden farklıdır;3Dboyut tek başına profesyonel görünümü sağlamaz. Sonraki kazanım daha ağır model değil, kaliteli tekrar kullanılabilir mekân/giysi varlığı ve iyi kadraj planıdır. Her geliştirmede eski2D/3Dpayload, kitaplık onayı, PCM ownership, mevcut geçiş/montaj/fiyat/73°C ve homepage sınırı korunur.

Kalıcı editorial-animation skill bu ölçütlere atıf verir; öneriler Gelişim Merkezi mevcut onay/yürütme akışına konabilir. Bu inceleme kendi başına harcama, kurulum, hesap bağlama, yayın veya otomatik kod değişikliği yetkisi vermez.
