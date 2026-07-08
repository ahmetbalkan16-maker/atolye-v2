# ATOLYE AI RULES

## Amaç

Bu belge Atölye V2 projesinin kalıcı geliştirme kurallarını içerir.

Her yeni AI oturumunda önce:

1. ATOLYE_CHECKPOINT.md
2. ATOLYE_AI_RULES.md

okunmalıdır.

Bu iki belge proje için temel referanstır.

---

# 1. Proje Amacı

Atölye V2;

Türkçe öncelikli, AI destekli kişisel içerik ve belgesel üretim stüdyosudur.

Temel hedef:

**En az hata ile en hızlı tamamlanan Atölye.**

Kod kalitesi, sürdürülebilirlik ve mimari bütünlük hız kadar önemlidir.

---

# 2. Geliştirme Prensipleri

* Önce analiz, sonra kodlama.
* Mevcut çalışan sistemi bozma.
* Gereksiz refactor yapma.
* Küçük ama güvenli adımlarla ilerle.
* Mevcut mimariyi koru.
* Kod tekrarından kaçın.
* Yeni özellik eklerken geriye dönük uyumluluğu koru.

---

# 3. Mimari Kuralları

* İş mantığı mümkün olduğunca lib/ ve service katmanlarında bulunmalıdır.
* UI sadece kullanıcı etkileşimini yönetmeli ve sonuç göstermelidir.
* API katmanı iş akışını yönetmeli, iş mantığını taşımamalıdır.
* Provider mimarisi korunmalıdır.
* AI Router yapısı değiştirilmemelidir.
* Tek bir AI sağlayıcısına bağımlı mimari oluşturulmamalıdır.

---

# 4. Pipeline Kuralları

Atölye üretim hattı:

Research
→ Script
→ Scenes
→ Visuals
→ Animation
→ Audio
→ Thumbnail
→ SEO
→ Assembly
→ YouTube

Yeni özellikler mümkün olduğunca bu pipeline içine entegre edilmelidir.

---

# 5. Manifest Kuralları

Manifest sistemi projenin resmi durum kaynağıdır.

Yeni üretim aşamaları:

* Manifest ile uyumlu olmalıdır.
* Gerekli ise yeni package olarak eklenmelidir.
* Eski manifestlerle uyumluluk korunmalıdır.

---

# 6. Kod Kuralları

* TypeScript strict uyumluluğu korunmalıdır.
* Yeni tipler mevcut yapıyı bozmayacak şekilde eklenmelidir.
* Gereksiz bağımlılık eklenmemelidir.
* Dosya yapısı sebepsiz yere değiştirilmemelidir.
* Public fonksiyonlar okunabilir isimlendirilmelidir.

---

# 7. Test Kuralları

Her sprint sonunda en az:

npx.cmd tsc --noEmit

çalıştırılmalıdır.

Kod derlenmeden sprint tamamlanmış sayılmaz.

---

# 8. Rapor Kuralları

Her görev sonunda şu bilgiler verilmelidir:

* Yapılan değişiklikler
* Değişen dosyalar
* Çalışma mantığı
* Test sonucu
* Riskler / Notlar
* Sonraki önerilen görev

---

# 9. Git Kuralları

Kullanıcı onayı olmadan:

* commit yapılmaz.
* push yapılmaz.

Commit öncesinde:

* git status

kontrol edilir.

Commit sonrasında:

* Commit hash
* Push sonucu
* Working tree durumu

raporlanır.

---

# 10. Sprint Kuralları

Her sprint şu sırayla yürütülür:

1. Mimari analiz
2. Onay
3. Uygulama
4. TypeScript testi
5. Rapor
6. Checkpoint güncellemesi
7. Git işlemleri (kullanıcı onayıyla)

---

# 11. AI Çalışma Kuralları

* Tamamlanan sprintleri tekrar yapma.
* Önce mevcut kodu incele.
* Önce ATOLYE_CHECKPOINT.md dosyasını oku.
* Bu dosyadaki kurallara uy.
* Gereksiz dosya değiştirme.
* Gereksiz büyük refactor önerme.
* Projenin uzun vadeli mimarisini koru.

---

# 12. Temel İlke

Her karar şu hedefe hizmet etmelidir:

**Atölye V2'yi en az hata ile, sürdürülebilir ve profesyonel bir AI içerik üretim stüdyosu haline getirmek.**
