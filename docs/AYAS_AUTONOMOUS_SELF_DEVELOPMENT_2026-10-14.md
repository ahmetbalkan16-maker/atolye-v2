# AYAS ve Atölye için sürekli, yerel öz-gelişim — 14 Ekim 2026

Durum: **hedef açık, uygulama tamamlanmadı.** Bu kayıt, sahibin 14 Ekim talimatıyla kapsamı hafıza/yanıt kalitesinin ötesine genişletir: AYAS kendi yeteneklerini ve Atölye’nin bütün üretim alanlarını geliştirecek. Kapsamı sonraki oturumlarda yalnız bilişsel kaliteye daraltmayın.

## Güvenli durma noktası — 14 Ekim 2026

Owner bu oturumda güvenli kaydetme, gerekli kayıtları güncelleme ve durma talimatı verdi; yeni production kodu veya canlı uygulama başlatılmadı. Kapsam, AYAS’ın tüm yeteneklerini ve Atölye’nin tüm üretim alanlarını içerir.

- Kaynak incelemesi, araştırma daemon’unun kanıtı patch-promotion akışına taşıdığını gösterdi. Promotion kapalı registry’deki strategy.generate fonksiyonunu çağırıyor. AyasLocalCodingModelAdapter.ts içindeki yerel model request/diagnostic API’si production araştırma/promotion yoluna bağlı değil; modelle patch üretiminin güvenli bağlantısı tamamlanmadı.
- Qwen2.5-Coder-14B ve qwen3:8b ön eleme kanıtı production admission için yeterli değil. Her iki model de reddedilmiş durumda; LOCAL_INDEPENDENCE_DEGRADED korunuyor.
- Devam sırası: güvenli yeterlilik eşiğini ve kapsamlı model kabul matrisini tamamla; kabul edilen yerel generator’ı mevcut izole sandbox → immutable patch artifact → Gelişim Merkezi owner inbox yoluna bağla; sonra her AYAS yeteneği ve Atölye üretim alanı için evaluator/benchmark ve gözden geçirilmiş exact-file strategy oluştur. Owner onayı, bağımsız doğrulama, sınırlı onarım ve rollback kapıları aynen korunmalı.

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
- 14 Ekim ön elemesinde Qwen2.5-Coder-14B'nin ek security adayı frozen evaluator'ı ve memory-temporal adayı kendi evaluator'ını geçemedi. qwen3:8b aynı security görevinde yinelenen edit yüzünden katı adapter tarafından reddedildi. Tam matris, tekrar tutarlılığı, power-k ve held-out ölçülmedi; kanonik yeterlilik eşiği yok. İki model de admission almadı, readiness LOCAL_INDEPENDENCE_DEGRADED kaldı. Ayrıntı için QWEN3_LOCAL_MODEL_SCREEN_EVIDENCE.json ve LOCAL_MODEL_RUN_EVIDENCE.json.
- Makinede qwen3:8b, gemma3:12b, gemma3:4b, qwen2.5:7b, qwen2.5:3b Ollama etiketleri listelendi; hiçbiri bu kayıtta kod üretimi için yeterlilik kazanmış sayılmaz.
- 14 Ekim HEAD a166434ac4d55411de06bfd2241fec74cf60432c için cognitive evaluator 55/55 geçmiş ölçümü vardır; bu ölçüm o HEAD’e aittir ve bütün Atölye/AYAS alanlarının sağlıklı olduğunu kanıtlamaz.

## 14 Ekim 2026 — Yerel kod modeli karşılaştırma ön elemesi

Ortak test girdisi: historical-atomic-bounded-write, security domain, baseline 2397edf0b55233d101668657f1451e37c5334fdf, evaluator blob 70df46f3c7a474a449c78e2c8f2f0da3383beebc, evaluator image sha256:75fc384f0a232f041a2584b619fb039cd5f61132703b83647a07a3a3236765b5. İki inference image'ı llama.cpp b11146 CPU ailesindedir.

- Qwen2.5-Coder-14B: strict adapter tek edit'i kabul etti, fakat frozen evaluator Missing expected rejection assertion'ında FAIL verdi. Ayrıca memory-temporal görevinde yanlış bir UI başlığını değiştirdi; beklenen computer-purchase-plan fact key'i üretilmedi ve evaluator FAIL verdi. Bu iki deneme birer tekil run'dır, tekrar tutarlılığı yoktur.
- qwen3:8b: tek security denemesinde JSON tamamlandı ancak izin verilen tek kaynak dosya için aynı editi iki kez döndürdü. Strict adapter PATCH_SCHEMA_INVALID verdi; patch materialize edilmedi, evaluator çalıştırılmadı.
- Bu ortak security vakasında Qwen2.5 format/scope kapısını geçip evaluator'a ulaştı, Qwen3 ulaşamadı. Qwen2.5'in test başarısızlığı ve Qwen3'ün şema reddi nedeniyle hiçbiri admission alamaz. Buradan genel yetenek sıralaması veya production yeterliliği çıkarılamaz.
- Qwen2.5 memory üretimi 944.1s, 12.5 GiB cgroup tepe; OOM yok, host tepe kullanımı %85.4. Qwen3 CPU-only 10 GiB container profili kullandı; Podman stats tepe 7.305 GiB / 10.74 GiB, OOM yok, host tepe %75.9. Her iki modelin workspace hash'i değişmeden kaldı.
- D-temp linux path resolver'ı C/D Windows temp altında olmayı ve gerçek os.tmpdir() containment'ini koruyarak D sürücüsüne eşlendi; hard-sandbox 23/23 tanı probu geçti. Production registry değiştirilmedi, cloud fallback yok, owner onayı/guarded execution kapıları kapalıdır.

Yeterlilik tam değildir: kalan vakalar, tekrarlar, held-out, power-k, tüm alan benchmark'ları ve sayısal eşik hâlâ açık. Ayrıntılı Qwen3 kaydı: docs/ayas-execution/2026-09-27-master/03_STAGE15_BASE/hardening/15A/QWEN3_LOCAL_MODEL_SCREEN_EVIDENCE.json; Qwen2.5 çalıştırmaları: docs/ayas-execution/2026-09-27-master/03_STAGE15_BASE/hardening/15A/LOCAL_MODEL_RUN_EVIDENCE.json. Bu kayıt AYAS'ın bütün yeteneklerini ve Atölye'nin tüm alanlarını geliştirme hedefini daraltmaz.

## Devam planı

1. Owner'ın seçtiği iki yerel kod modelinin ön elemesi başladı; Qwen2.5-Coder-14B ve qwen3:8b şu an kabul edilmedi. Kanonik yeterlilik eşiği owner ile belirlenmeli; gerçek patch doğruluğu, tekrarlanabilirlik, kaynak kapsamı, kaynak tüketimi ve held-out sonuçları ölçülmeden model seçilmemeli.
2. Her AYAS/Atölye capability kümesi için değişmez yerel evaluator/benchmark ve kayıtlı exact-file stratejileri oluştur. Mevcut testler kullanılabiliyorsa yeniden kullan; test/yargıç dosyaları aday patch kapsamına giremez.
3. Yeterlilik almış yerel modeli yalnız strategy’de belirtilmiş kaynak dosyalarıyla besle. Çıktı tam JSON schema’dan, dosya hash’lerinden, scope/line limitlerinden, secret taramasından, AST/static güvenlik kapılarından geçsin.
4. Bazeline karşı aynı sandbox kopyasında benchmark, regression suite, held-out ve golden vault çalıştır. Başarısız patch’ler canlı kaynağa gitmesin; sınırlı onarım denemeleri de aynı kontrolleri tekrar geçsin.
5. Model kimliği, prompt/schema hash’i, tam patch, ölçüm, validator ve diff’i değişmez artifact/evidence içinde tut. Owner’a tam diff’i Gelişim Merkezi’nde göster; patch hash’i değişirse onay geçersiz olsun.
6. Yalnız owner’ın onayından ve mevcut yürütme kapısından sonra guarded local apply yap. Sonuç başarısızsa güvenli rollback, kayıt ve raporlama uygula.
7. Her tur sonunda bu checkpoint’i, Git’i ve exact-HEAD Graphify/health makbuzunu güncelle.

Owner UI/homepage, execution/security kernel, secret, ağ/harcama, yayın ve üretim authority kapıları bu hedef nedeniyle kendiliğinden açılmaz. Bu kısıtlar geniş kapsamla çelişmez; ilgili değişiklikler kendi owner-review/approval yollarını korur.
