# AYAS — yerel Türkçe sohbet geliştirmesi, 10 Ekim 2026

## Güncel durum

Kaynak ve izole derleme hazır; canlı kabul henüz tamamlanmadı. Owner bu geliştirmeyi ve gerekli güvenli düzeltmeleri istedi. PC reboot/logon kabulü owner kararıyla **12 Ekim Pazartesi** yapılacak. Tam yedek/WinPE/USB işi bugün açılmadı.

## Mimari ve değişiklik

Homepage/UI, mikrofon ve üretim akışları değiştirilmez. Hem SSE hem server-action sohbet yolu mevcut `streamAyasChat` ve model router'ını kullanır. Varsayılan/flag kapalı davranış eski transport'u korur. `AYAS_CONVERSATION_V2=1` yalnız Ollama doğrudan sohbetinde, kısa sabit politika + gerçek user/assistant geçmişi + son user mesajı gönderir. Dinamik bellek ve context, system yetkisi kazanmaz. Yeni helper `src/lib/ayas/context/AyasNaturalConversation.ts` bu düzeni mevcut context bütçesine bağlar; bağımsız router/storage/tool oluşturmaz.

`AyasModelTypes.ts` isteğe bağlı typed mesajlar taşır; `OllamaAyasProvider.ts` bütçelendirilmiş JSON ile gerçek mesajların birebir eşitliğini ve tek ilk system rolünü çağrıdan önce doğrular. Tahmini ve modelin ölçtüğü token kapıları korunur. Qwen3 kullanılırsa gizli thinking kapatılır; eski Qwen2.5 transport'u aynı kalır. `AyasChatStream.ts` son konuşma rolü ve geçmişi korur. Bilinmeyen ad uydurması ve düzeltme çağrısında doğrulanmış adın kaybolması engellenir. Ad beyanı soru sayılmaz; mevcut atomik bellek kaydı terminal yanıttan önce tamamlanır. SSE'ye yine yalnız doğrulanmış son cevap çıkar. Execution gate, onay, lease, ücretli/bulut redleri, tüm eylem ve veri yetkileri korunur.

## Gerçek model denemesi

Bu PC: RTX A2000 12 GB, 32 GB RAM. Aynı sentetik konuşmalar, yalnız localhost Ollama ve her deney için ayrı bellek klasöründe gerçek provider/stream/finalizer ile yürütüldü. Ham taslak, düzeltme, son cevap ve wire rolleri saklandı; gerçek owner belleğine deneme adı yazılmadı.

Önceki Qwen2.5 3B/7B, Qwen3 8B ve Gemma3 4B adaylarında yanlış başkent/kişisel bilgi, bozuk Türkçe veya yanlış toplama görüldü. Bu adaylar yeterli Türkçe kalite kanıtı sayılmadı. Yalnız prompt değişikliğine dayanarak ChatGPT kalitesi ilan edilmedi. Resmi [Ollama Gemma3 12B](https://ollama.com/library/gemma3:12b) adayı indirilip gerçek konuşmayla değerlendirilecek. Hiçbir model silinmedi; deney modelleri zorunlu yeni-PC verisi değildir.

Model ve konuşma flag'i uygulamada opt-in'dir. Canlı model seçimi henüz yapılmadı. Üretim `OLLAMA_MODEL`, genel temperature/context, dependency ve güvenlik ayarları değiştirilmedi. Hedef kullanımda context bu PC'nin doğrulanan 8192 sınırında kalır; modelin ilan edilen 128K kapasitesi doğrudan açılmaz.

## Doğrulama

- Son kaynakta **29 ilgili suite komutu PASS**, buna yeni **27 doğal sohbet senaryosu** dahildir. Bellek/temporal/integrity, chat/SSE/client/quality, router, bütçe, reasoning/schema, eylem firewall/closure, trace, voice/mobile, Brain/UI/homepage ve zero-cost sözleşmeleri kapsandı.
- Kontrollü context mutasyonları 19/19, voice-turn mutasyonları 12/12 yakalandı. Native Windows lock/bellek denemeleri kendi sentetik klasörlerinde yapıldı.
- TypeScript `--noEmit --incremental false` exit0. ESLint 0 hata / devralınmış 13 uyarı. Diff whitespace kontrolü PASS.
- Kurulu Next16.2.10 ile izole webpack production build PASS; lock16.3.8 farkı korunur, giderilmiş sayılmaz. Ana `.next`, çalışan servisler ve owner veri klasörleri hazırlıkta değiştirilmedi. Kaynak kopyasının derleme öncesi/sonrası hash'i aynı.
- İlk hazırlıkta eksik clone Git/CHANGELOG ve build docs/cloudflare importları vardı; fixture tamamlanıp yeniden koşu PASS. Ürün test beklentileri veya frozen manifest/pinler değiştirilmedi. Ham ilk FAIL kayıtları saklandı.

Kanıtlar bu PC'nin Codex görselleştirme klasöründeki `CONVERSATION_*.json`, `conversation-regression-*.log`, `CONVERSATION_BUILD*.log` ve `.graphify/conversation-local-probe-20261010.ts` içindedir. Bunlar sentetik deney kayıtlarıdır; kaynak/frozen sertifika veya gerçek telefon ses kalitesi kanıtı değildir. Yeni Full166 sertifikası verilmedi.

## Canlı kabul ve geri dönüş planı

1. Aday modeli gerçek 12 konuşma ve ayrıca yeni sorularla sınamak; ayrı derlemede 127.0.0.1:3321 / owner oturumu / gerçek sohbet kabulü.
2. Kaynakları commit ederek izole derlemenin kaynak baytlarını o temiz commit'e bağlamak. Yalnız mevcut `.env.local` AYAS model alanı ve yeni sohbet flag'i değişebilir; gizli değerler rapor/Git'e çıkmaz.
3. Önceki derleme ve qualification manifestini dar geri dönüş için korumak; yalnız exact process identity ile origin/supervisor için kısa kontrollü bakım. Tünel/Ollama/Observer, startup kaydı, güvenlik, bellek/project/asset dosyaları korunur. Yeni artifact + aynı dependency ağacı için qualification ve yeniden açılış checker'ını doğrulamak.
4. Yeni canlı sohbet, protected route/public kapıları, proje görünümü ve servis sağlığını doğrulamak. Son docs commit/push ve Graphify güncellemesi sonrası Observer doğal döngüye dönmeli.

Bu sıranın kalan işi checkpoint'e yansıtılır; fiziksel telefon mikrofonu/ses ve gerçek Windows logon bugün yapılmaz.

## Kalite ve taşınma sınırları

Yerel modelin her soruda ChatGPT düzeyinde veya sıfır hatayla cevap vereceği garanti edilemez. Bilmediği kişisel bilgiyi söylemeli; owner adını/tercihini açıkça verdiğinde mevcut güvenilir bellekten yararlanır. Testte başarılı olması genel mantık/doğruluk sertifikası değildir.

Bu sprint konuşma metnini geliştirir; ses hâlen mevcut cihaz/browser SpeechSynthesis yolundan gelir. Yerel Wake/Whisper ve browser fallback'i korunur; fiziksel telefonda tüm sesin çevrimdışı kaldığı veya doğal telaffuzun yeterli olduğu ayrıca doğrulanmalıdır. Yeni PC'de Ollama/model kurulumu veya model ağırlıklarının aktarımı, AYAS flag/model ayarı, bellek, ses yolları ve yeni cihaz qualification gerekir. Eski `.next`, dependency ağacı ve manifest hedefte aktive edilmez.
