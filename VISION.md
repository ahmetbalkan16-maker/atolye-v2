# Atolye Vizyonu

## Belge Rolu

Bu belge su soruya cevap verir:

Nihai urun nasil olacak?

PROJECT_PHILOSOPHY.md projenin neden var oldugunu, ATOLYE_MASTER_ROADMAP.md uzun vadeli fazlari, ROADMAP.md aktif sprintleri, ATOLYE_CHECKPOINT.md guncel durumu takip eder.

## 1. Atolye Nedir?

Atolye, kisisel bir AI calisma arkadasi ve AI produksiyon studyosudur.

Amaci ticari SaaS urunu olmak degil, tek bir kisinin kendi icerik uretim surecini ucundan sonuna kadar yonetebilecegi guclu, esnek ve guvenilir bir produksiyon ortami olmaktir.

Atolye'de kullanici yonetmendir. Konuyu, tonu, hedefi ve yaratici kararlari belirler. Atolye ise arastirma, senaryo, sahne planlama, gorsel tasarim, animasyon, ses, kurgu, thumbnail, SEO ve yayin paketi gibi produksiyon ekibi rollerini ustlenir.

## 2. Nihai Hedef

Atolye'nin nihai hedefi, tek bir konu girildiginde YouTube'a hazir bir icerik uretim surecini tamamlayabilmektir.

Hedeflenen ana akis:

Tek konu -> Research -> Script -> Scene Planning -> Visual Production -> Animation -> Audio -> Video Editing -> Thumbnail -> SEO -> Publishing

Bu akis yalnizca dosya ureten bir pipeline degil, kullanicinin her asamada kontrol edebildigi, gerektiginde geri donebildigi ve uretimi yonetebildigi bir kisisel studyodur.

## 3. Temel Mimari Ilkeler

Atolye AI saglayici bagimsiz bir yapi uzerine kurulmalidir. OpenAI, yerel modeller veya baska servisler degisebilir; Atolye'nin ana mimarisi bu degisimlerden en az etkilenmelidir.

Moduler mimari korunmalidir. Research, Script, Scene Planning, Visual Production, Animation, Audio, Video Editing, Thumbnail, SEO ve Publishing gibi her ana sistem kendi sorumluluk sinirlari icinde gelismelidir.

Katmanli servis yapisi temel ilkedir. UI, API, manager, pipeline, provider ve storage katmanlari birbirine karismadan calismalidir.

Geriye donuk uyumluluk onemlidir. Eski proje dosyalari, manifest yapilari ve uretim paketleri yeni sprintlerle gereksiz yere bozulmamalidir.

Atolye'nin pratik hedefi en az hata ile en hizli tamamlanan kisisel produksiyon ortami olmaktir. Her yeni ozellik, uretim surecini daha guvenilir, daha anlasilir veya daha tamamlanabilir hale getirmelidir.

## 4. Uzun Vadeli Ana Sistemler

### AI Director

AI Director, Atolye'nin yaratici karar katmanidir. Konuyu analiz eder, icerik stratejisini belirler, hedef kitleye uygun ton ve anlatim onerebilir, pipeline boyunca tutarliligi korur.

### Historical Documentary Engine

Historical Documentary Engine, baslangic odagi olan tarih belgeselleri icin uzmanlasmis uretim katmanidir. Kronoloji, karakterler, olay orgusu, tarihsel baglam ve belgesel anlatim dilini daha derin ve tutarli hale getirmeyi hedefler.

### Knowledge Engine

Knowledge Engine, Atolye'nin bilgi toplama, dogrulama, kaynaklandirma ve konu hafizasi sistemidir. Amaci, uretimde kullanilan bilginin izlenebilir, tekrar kullanilabilir ve zamanla gelisebilir olmasidir.

### Production Memory

Production Memory, onceki projelerden stil, tercih, hata, basarili karar ve kullanici aliskanliklarini ogrenebilen produksiyon hafizasidir. Atolye'nin her projede sifirdan baslamak yerine kullanicinin calisma bicimini hatirlamasini saglar.

### Remote Personal Studio

Remote Personal Studio, Atolye'nin kullanicinin kendi sunucusunda calisip telefon, tablet veya baska bilgisayardan erisilebilir hale gelmesini hedefler. Bu sistem Atolye'yi yalnizca lokal bir arac olmaktan cikarip kisisel ve uzaktan erisilebilir bir studyoya donusturur.

### Secure Access Layer

Secure Access Layer, login, HTTPS, API key korumasi, dosya gizliligi ve guvenli erisim ilkelerini kapsar. Atolye kisisel uretim dosyalari, API anahtarlari ve yayin paketleri tuttugu icin guvenlik temel mimari parcalardan biri olmalidir.

## 5. Kisisel Kullanim Hedefi

Atolye uzun vadede kullanicinin kendi sunucusunda calisacak sekilde konumlanmalidir.

Kullanici Atolye'ye telefonundan, tabletinden veya baska bir bilgisayardan erisebilmelidir. Ornek hedef erisim adresi:

https://www.atolye.com.tr

Bu hedef icin guvenli login, HTTPS, API key korumasi ve dosya gizliligi temel gereksinimlerdir. Atolye kisisel bir produksiyon studyosu oldugu icin uretilen icerikler, proje dosyalari, assetler ve anahtarlar kullanicinin kontrolunde kalmalidir.

## 6. Icerik Kapsami

Atolye'nin baslangic icerik odagi tarih belgeselleridir.

Tarih belgeselleri; arastirma, kronoloji, karakter analizi, sahneleme, atmosfer, anlatim ve gorsel tutarlilik gibi bircok yetenegi ayni anda gerektirdigi icin Atolye'nin cekirdek kapasitesini gelistirmek icin iyi bir baslangic alanidir.

Uzun vadede Atolye bilim, uzay, teknoloji, gizem, egitim, kultur, sanat ve genel YouTube icerikleri icin de kullanilabilir hale gelmelidir.

## 7. Sprint Karar Ilkesi

Her sprint su soruyla degerlendirilecektir:

"Bu gelistirme Atolye'yi daha iyi bir kisisel AI produksiyon studyosu yapiyor mu?"

Cevap hayirsa, sprint ya yeniden tanimlanmali ya da ertelenmelidir. Atolye'nin yol haritasi ozellik biriktirmek icin degil, kisisel produksiyon surecini daha guvenilir ve daha guclu hale getirmek icin ilerlemelidir.

## 8. Gelistirme Akisi

Atolye gelistirme akisi su sirayla ilerlemelidir:

1. Analiz
2. Mimari
3. Codex
4. Test
5. Checkpoint
6. Git Commit
7. Git Push

Bu akis, her sprintin yalnizca kod degisikligi olarak degil, mimari karar, test, dokumantasyon ve surum hafizasi ile tamamlanmasini saglar.
