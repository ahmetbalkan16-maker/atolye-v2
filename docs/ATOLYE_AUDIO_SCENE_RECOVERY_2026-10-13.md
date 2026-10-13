# Yerel ses, bölüm-sahne kapsamı ve süre onarımı — 13 Ekim 2026

## Güncel son teşhis: Türkçe kelime zamanlaması

İlk ayrı gerçek montaj denemesi UTC12:25:38'de `NARRATION_TIMING_OFFSETS` ile başarısız oldu. Driver kapandı; `OWNER_CORRECTED_RUN.json` FAILED olarak düzeltildi. Ses ve 7 kaynak klip korunur. Gerçek 7 ses bölümünün salt okunur CPU Whisper capture'ında ilk5 PASS, son2 FAIL: `İmparatorluğu'nun` /`Devri'nin` tek ölçülmüş acoustic word idi fakat tokenizer apostrophe yüzünden iki sözcük saydı. Yalnız alfanümerik sözcük içindeki düz/eğri kesme işareti source ve heard üzerinde aynı biçimde normalize edilir. Süre/offset/sıra/coverage korumaları gevşetilmedi; whitespace veya diğer ayırıcılar aynı. Straight/curly/year ve yanlış süre/sıra/space ret regresyonları, eski sentence-direction smoke, TS/lint PASS. Kaydedilmiş gerçek 7 Whisper capture düzeltilmiş parser ile PASS; bu son montaj PASS değildir. Sıradaki kontrollü kaynak canlıya alınır ve aynı projede yalnız assembly retry uygulanır; yeniden araştırma/video/audio oluşturulmaz. Aşağıdaki “son montaj devam ediyor” kaydı bu ilk denemenin tarihçesidir.

## Sorun ve sonuç

Owner'ın ilk yeniçeri projesi ses aşamasında `AUDIO_ASSET_GENERATION_FAILED` verdi. Gerçek kök hata OpenAI `tts-1` HTTP 401 idi. `AUDIO_PROVIDER=openai` hem `.env.local` hem Windows User ortamında bulunuyordu; User değeri dosya ayarını geçersiz kılabildiğinden yalnız dosyayı değiştirmek yeterli değildi. Kurulu Türkçe Piper doğrulandı ve yalnız bu iki sağlayıcı ayarı `piper` yapıldı. Diğer anahtar ve ayarlar korunur; anahtarlar loglanmaz.

Özel gerçek Piper canary 7 bölüm /108.005 saniye sesi 20.137 saniyede ücretsiz üretti. Eski owner projesinde standart Ses Retry HTTP 200 verdi: 7 bölüm /46.754 saniye gerçek ses. Retry'nin mevcut devamı montaja geçti; bu kez eski tek legacy sahne ile 7 ses bölümü uyuşmadığı için `VIDEO_ASSEMBLY_FAILED` kaydedildi. Montaj kapsamı/kimlik koruması doğru ret verdi ve gevşetilmedi. Eski projenin ilk altı aşamasının içerik hashleri aynıdır; eski dosyalar korunur. Bu proje tamamlandı sayılmaz.

## Uygulama

`ChapterSceneCoverage.ts`, açık ordinary-production chapter coverage seçeneğiyle her script bölümünü aynı kimlik ve kaynak metinle sahneye bağlar. Tam ve sıralı bölüm planı kabul edilir; eksik, bilinmeyen veya sırası bozuk plan kaynak bölümlerden yerel plana döner. Eski bağımsız lenient ve strict çağrılar değişmedi.

İlk ayrı denemede bölüm kapsamı doğruydu, fakat model 2088 karakterlik metne `estimatedDuration=2100` yazmıştı; bu 2012 saniyelik gereksiz klip planına dönüştü. Yeni ordinary-production süresi mevcut 14.12 karakter/s narration kestiriminden gelir; modelin serbest dakika iddiasını kullanmaz. Aynı bölüme bağlı birden fazla sahnede bölüm süresi göreli ağırlıkla dağıtılır. Bu yalnız çizim ön planıdır; gerçek Piper süresi montajın otoritesi olarak kalır.

Yalnız kendi 33 dakikalık CLI denememizin PID ve oluşturulma zamanı doğrulanıp durduruldu; canlı AYAS ve tünel korunur. Native CAS abandon/release/cancel işlemleri önce özel canary'de, sonra aynı owned attempt'te uygulandı: attempt/claim abandoned, reservation/job cancelled, lease released. Başarılı tarihsel sürümler yeniden yazılmadı. Bu deneme tamamlanmış video değildir.

Standart Cancel API'si canonical runtime bağlamı olmadan yazdığı için 500 veriyordu. İşlem mevcut `executePipelineRunnerProductionRuntimeOperation` sınırına alındı; Retry ve giriş doğrulamaları aynı kaldı. Otorite/storage/bütçe koruması atlanmadı.

## Doğrulama ve canlı

- Yeni bölüm/kapsam/süre smoke: **14 PASS**.
- Yeni gerçek özel Cancel route/runtime smoke: **1 PASS**.
- Eski scene-duration, script-scenes usage persistence, strict structured scenes ve assembly identity regresyonları PASS.
- TypeScript, lint, temiz derleme ve özel gerçek HTTP PASS. Önceki 46/46 genel kontrol yeniden tümüyle çalıştırıldı sayılmaz.
- Kendi kaynak commitleri `47c1762577cdc303cbcf72de4c8a6bd1c0d6d43a` ve `fc8ad4562289fe3ba4a08235d340f396f426442b`.
- Eşzamanlı owner karakter kütüphanesi kendi import hatasını düzeltti: birleşik kaynak **87adc997c064156d3d1d70756c9cabd3ffce529f**, source CI **38392559964 SUCCESS**. Dünya kütüphanesi offline placeholder altyapısıdır; bu onarım ona görsel veya production adapter bağlamaz.
- Canlı CLEAN build **PJpXpkwUtvUrjylcb6oYU**, kontrollü geçiş UTC **2026-10-13T11:58:36.7376771Z**. App 16268, supervisor 7676; tünel 29440 aynı. Geçişin öncesi/sonrası proje metadata digestleri aynı. Derleme geçişi başka ortam ayarını değiştirmedi.
- Geri dönüş diğer çalışmanın kütüphanesini korur ve yalnız kendi son uygulama düzeltmesini önceki çalışan kaynak davranışına döndürür. Özel fallback kaynak `3f4e367e7119759202d949b9156df38d042a7d43`, CLEAN build `oSSO-EO96LP4yCUIAtnWg` /HTTP PASS; fallback canlı değildir.

## Gerçek owner konusu — son montaj devam ediyor

Yeni normal canonical üretim, aynı konuda ayrı **1480-yilinda-osmanli-yenicerilerinin-bir-gunu** projesidir. Eski projeyi veya iptal edilmiş aşırı süreli denemeyi tekrar başlatma. Gerçek 7 bölüm/7 sahne, 137 saniye çizim ön planı ve bütün 7 kaynak video klibi tamamlandı. Piper 128.701 saniye gerçek ses ve özgün CC0 fon müziği üretildi. Son assembly gerçek konuşma/cümle zamanı üzerinde V3 görüntüleri yeniden hazırlıyor; henüz final PASS veya hazır video iddiası yok.

Driver assembly'de durur; thumbnail/SEO/YouTube/export çalıştırılmaz. Ücretli anahtar yalnız kendi process'inden çıkarıldı; paid çağrı ve yayın yok. Bu teknik kontrol metnin tüm tarihî iddialarını doğrulamaz; yayından önce içerik ve ses/görünüm owner tarafından incelenmelidir.

GPU 73°C ortak durdurma, homepage, frozen aşama sırası, dual-root authority ve fiyat korumaları aynı. PC reboot, kurulum/model indirme, driver veya güvenlik ayarı değişikliği yapılmadı. Kesin final sonuç Git dışı `audio-local-recovery-20261013/DELIVERY_CLOSURE.json` içinde doğrulanır; henüz kapanış yazılmadı. Bu belge önceki WIP TS/47 canlı kayıtlarının güncel durumunu değiştirir; checkpoint tarihçesi korunur.
