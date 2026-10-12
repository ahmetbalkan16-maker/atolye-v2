---
name: editorial-animation
description: Atölye'nin yerel çöp adam video karakterlerini, ortamlarını ve animasyon görsel dilini tasarla veya geliştir; character görsel sağlayıcısını değiştiren işlerde kullan.
---

# Kalıcı Atölye görsel tasarım yeteneği

Owner tercihi: sade çizgili fakat özenli, eğlenceli ve eğitici YouTube animasyonları. Tek tip ince çöp adam ve boş renkli zemin teslim kalitesi değildir.

- Üretim bağlantısı: `src/lib/assets/providers/CharacterImageProvider.ts` her yeni PNG'ye `renderStyle: editorial-v2` yazar. `CharacterSceneAsset.ts` hem galerideki karesini hem videodaki bütün karelerini aynı stilde çizer. `src/lib/character/SvgSceneRenderer.ts` yerel tasarım uygulamasıdır. Skill metni otomatik yürütme/kurulum yetkisi vermez; varsayılan kullanım kodla sağlanır.
- Ana karakterin sarı atkısı ve çizgi dili sabittir. Yardımcı oyuncuların renk, saç, gözlük/sakal, başlık ve kıyafetleri ayrışır. Kimlik aktör id'sine bağlıdır; poz veya kare zamanına göre değişmez. Gerçek tarihî kişinin görünüşünü doğrulanmış gibi sunma.
- Konuya uygun katmanlı ortamlar kullan: saray, kütüphane, teknoloji odası, ekonomi, forum; dış sahnelerde surlar, dağ, kır ve deniz. Yazı/konuşmacı silueti rahat okunmalı; ortam anlatımı desteklemeli. Grafikler şematiktir; gerçek veri yerine sayı uydurma.
- Şapka, yüz, kıyafet, el aksesuarı animasyon eklemlerine bağlı kalır. Karakter sayısı ve sahne bloklama sınırlarını koru; birbirinin üstüne taşan kalabalık ekleme. Modern aksesuarı tarihî teknoloji sahnesine koyma.
- SVG vektörlerini yerelde rasterize et; internet resmi, GPU görüntü modeli, haricî font, filtre veya ücretli resim çağrısı varsayılan değildir. Sağlık, bütçe, sahibi onayı ve provider yönlendirme kurallarını değiştirme.
- Eski PNG payload'ında renderStyle yoksa eski motor kullanılmalı. Yeni bir stili mevcut stile sessizce yeniden tanımlayarak eski kayıtları değiştirme; yeni versiyon ekle.
- Kontrol: gerçek motorla PNG önizlemesi ve birkaç hareket karesi; eski payload eşitliği; profil testi, character animasyon/pipeline, tarihî/golden testler, TypeScript ve lint. Gözle kaliteyi incele; test başarısı tek başına estetik kalite kanıtı değildir.

AYAS geliştirme önerileri bu yeteneğe atıf verebilir. Tasarım araştırması ve yeni yetenek önerileri Gelişim Merkezi'nin mevcut sahibi onay/yürütme akışını kullanır; homepage'e kart eklenmez.
