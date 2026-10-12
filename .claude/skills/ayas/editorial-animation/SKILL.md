---
name: editorial-animation
description: Atölye'nin yerel çöp adam video karakterlerini, ortamlarını ve animasyon görsel dilini tasarla veya geliştir; character görsel sağlayıcısını değiştiren işlerde kullan.
---

# Kalıcı Atölye görsel tasarım yeteneği

Owner tercihi: sade çizgili fakat özenli, eğlenceli ve eğitici YouTube animasyonları. Tek tip ince çöp adam ve boş renkli zemin teslim kalitesi değildir.

- Üretim bağlantısı: `CharacterImageProvider.ts` yeni PNG'ye `editorial-v2` ve art version4 yazar. `IllustratedCharacter.ts` tam giysi, manşet, eldiven, ifade, başlık ve tahtı mevcut eklemlerde çizer; `CharacterSceneAsset.ts` galeriyi ve bütün video karelerini aynı payload ile üretir. Eski version1/2/3 görüntülerini değiştirme. Skill metni otomatik yürütme/kurulum yetkisi vermez; varsayılan kullanım kodla sağlanır.
- Sarı atkı modern ana anlatıcının kimliğidir; tarihî kaftan/zırh/yaka yerine zorla atkı giydirme. Yardımcı oyuncular renk, saç, gözlük/sakal, başlık ve kıyafetle ayrışır. Kimlik aktör id'sine bağlıdır; kare zamanına göre değişmez. Gerçek tarihî kişinin görünüşünü doğrulanmış gibi sunma.
- Konuya uygun katmanlı ortamlar kullan: saray, kütüphane, teknoloji odası, ekonomi, forum; dış sahnelerde surlar, dağ, kır ve deniz. Yazı/konuşmacı silueti rahat okunmalı; ortam anlatımı desteklemeli. Grafikler şematiktir; gerçek veri yerine sayı uydurma.
- Şapka, yüz, kıyafet, el aksesuarı animasyon eklemlerine bağlı kalır. Karakter sayısı ve sahne bloklama sınırlarını koru; birbirinin üstüne taşan kalabalık ekleme. Modern aksesuarı tarihî teknoloji sahnesine koyma.
- Vektör karakterlerini her karede yerelde rasterize et; ücretli resim çağrısı, haricî font/URL veya SVG filtre ekleme. Gözle incelenmiş yerel SDXL arka planları isteğe bağlı cache'dir: yalnız gündüz saray bağlamı, sabit revision/SHA, küçük PNG ve aynı asset'te binary chunk. Model her karede veya üretim sırasında indirilmez/başlatılmaz; eksik cache yerel vektöre döner, bozuk cache fail-closed olur. Yeni adaylar `scripts/local-visual-runtime` üzerinden ayrı offline ortamda, soğuma ve owned sağlık durdurmasıyla denenir. Serbest üretim portre/yanlış kıyafet verdiği için kılavuzlu aday da gözle incelenmeden otomatik kabul edilemez; sprite/rig bağlantısı tamamlanmadan statik model adayını animasyon çıktısı diye sunma.
- Owner'ın açık 12 Ekim onayıyla A2000 hard stop73°C: ortak kaynak `GpuThermalPolicy.ts`, Brain/STT/Atölye/Ollama aynı değeri kullanır. Driver/power/fan/güvenlik/otorite/bütçe değişmez. Başlık, kıyafet deseni, el ve ağız her pozda bağlı kalmalı; eğilmede desen dışarı taşmamalı, oturma/diz çökmeye uzun etek zeminden taşmamalı. Non-court tarihî zırhı eski güvenilir renderer'dan koru.
- Eski PNG payload'ında renderStyle yoksa eski motor kullanılmalı. Yeni bir stili mevcut stile sessizce yeniden tanımlayarak eski kayıtları değiştirme; yeni versiyon ekle.
- Kontrol: gerçek motorla PNG önizlemesi ve birkaç hareket karesi; eski payload eşitliği; profil testi, character animasyon/pipeline, tarihî/golden testler, TypeScript ve lint. Gözle kaliteyi incele; test başarısı tek başına estetik kalite kanıtı değildir.

AYAS geliştirme önerileri bu yeteneğe atıf verebilir. Tasarım araştırması ve yeni yetenek önerileri Gelişim Merkezi'nin mevcut sahibi onay/yürütme akışını kullanır; homepage'e kart eklenmez.
