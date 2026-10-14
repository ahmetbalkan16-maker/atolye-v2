# AYAS ve Atölye için sürekli, yerel öz-gelişim — 14 Ekim 2026

Durum: **hedef açık, uygulama tamamlanmadı.** Bu kayıt, sahibin 14 Ekim talimatıyla kapsamı hafıza/yanıt kalitesinin ötesine genişletir: AYAS kendi yeteneklerini ve Atölye’nin bütün üretim alanlarını geliştirecek. Kapsamı sonraki oturumlarda yalnız bilişsel kaliteye daraltmayın.

## İstenen işletim biçimi

- Hafif dış araştırma 2 saatte, derin araştırma 3 saatte bir çalışır.
- Araştırma bulguları Gelişim Merkezi’nde sahibin kararına gelir.
- Açık owner onayı olmadan canlı kaynağa yazım, yürütme, yayınlama veya harcama olmaz.
- Onaylı kapsam için AYAS yerel ve yeterliliği kanıtlanmış bir kod modeliyle patch üretir; izole kopyada test eder, bağımsız doğrular, başarısızsa sınırları belli onarım dener ve sonucu sahibine raporlar.
- Ürün çalışma anında Claude veya Codex’e bağımlı olmamalıdır. Yerel model, test, gözden geçirme ve güvenlik kapıları AYAS çalışma zamanına ait olmalıdır.
- Her yetenek alanının ölçütü, tam dosya kapsamı, validator ve geri alma yolu o alana göre kayıtlı olmalıdır. Araştırma metni dosya, komut, model, yetki veya sınır seçemez.

## 14 Ekim’de doğrulanmış mevcut durum

- LIGHT/DEEP scheduler sıklıkları 2/3 saattir.
- Araştırma → ölçülmüş hipotez → sandbox deneyi → immutable patch artifact → owner inbox akışının iskeleti vardır. Onay/guarded execution kapıları korunur.
- İyileştirme registry’sinde tek strateji exp-memory-render-tool-supersession@1’dir; eba490… eski before hash’e bağlıdır, güncel kaynakta hedef davranış zaten bulunduğu için yeniden çalıştırılabilir değildir.
- Kayıtlı iyileştirme evaluator’ı yalnız cognitive-quality (17 boyut) ölçer. Capability taxonomy AYAS ve Atölye alanlarını listelese de diğer alanların benchmark/strategy eşleşmesi yoktur; bunlar unmeasured kalır.
- Üretim araştırma döngüsünde AYAS’ın yerel modelden kod üretmesini sağlayan bağlı generator yoktur. BrainPatchGeneration.ts yalnız sözleşme/test düzeyindedir.
- Mevcut Qwen2.5-Coder-14B yerel coding-model kaydı DEGRADED / NONE durumundadır. 1 Ekim 15A yeterlilik kapanışında bir tarihsel görevde başarı 0/1; iki eski tool-call denemesi geçersiz çıktı verdi, JSON-schema ile dönen aday ise baseline’da da başarısız olan assertion’ı düzeltmedi. Tam matris ve held-out kod kalitesi ölçülmedi. Bu model otonom patch üreticisi olarak etkinleştirilemez.
- Makinede qwen3:8b, gemma3:12b, gemma3:4b, qwen2.5:7b, qwen2.5:3b Ollama etiketleri listelendi; hiçbiri bu kayıtta kod üretimi için yeterlilik kazanmış sayılmaz.
- 14 Ekim HEAD a166434ac4d55411de06bfd2241fec74cf60432c için cognitive evaluator 55/55 geçmiş ölçümü vardır; bu ölçüm o HEAD’e aittir ve bütün Atölye/AYAS alanlarının sağlıklı olduğunu kanıtlamaz.

## Devam planı

1. Sahibin seçtiği yerel kod modeli ve açık yeterlilik ölçütüyle kod üretim protokolünü doğrula. Sadece metin/JSON biçimi değil; gerçek patch doğruluğu, tekrarlanabilirlik, kaynak kapsamı, kaynak tüketimi ve held-out sonuçları ölçülmeli.
2. Her AYAS/Atölye capability kümesi için değişmez yerel evaluator/benchmark ve kayıtlı exact-file stratejileri oluştur. Mevcut testler kullanılabiliyorsa yeniden kullan; test/yargıç dosyaları aday patch kapsamına giremez.
3. Yeterlilik almış yerel modeli yalnız strategy’de belirtilmiş kaynak dosyalarıyla besle. Çıktı tam JSON schema’dan, dosya hash’lerinden, scope/line limitlerinden, secret taramasından, AST/static güvenlik kapılarından geçsin.
4. Bazeline karşı aynı sandbox kopyasında benchmark, regression suite, held-out ve golden vault çalıştır. Başarısız patch’ler canlı kaynağa gitmesin; sınırlı onarım denemeleri de aynı kontrolleri tekrar geçsin.
5. Model kimliği, prompt/schema hash’i, tam patch, ölçüm, validator ve diff’i değişmez artifact/evidence içinde tut. Owner’a tam diff’i Gelişim Merkezi’nde göster; patch hash’i değişirse onay geçersiz olsun.
6. Yalnız owner’ın onayından ve mevcut yürütme kapısından sonra guarded local apply yap. Sonuç başarısızsa güvenli rollback, kayıt ve raporlama uygula.
7. Her tur sonunda bu checkpoint’i, Git’i ve exact-HEAD Graphify/health makbuzunu güncelle.

Owner UI/homepage, execution/security kernel, secret, ağ/harcama, yayın ve üretim authority kapıları bu hedef nedeniyle kendiliğinden açılmaz. Bu kısıtlar geniş kapsamla çelişmez; ilgili değişiklikler kendi owner-review/approval yollarını korur.
