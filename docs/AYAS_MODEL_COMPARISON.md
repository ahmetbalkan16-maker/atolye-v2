# AYAS model karşılaştırması

AYAS'ın sohbet modeli (`.env.local` içindeki `AYAS_OLLAMA_MODEL`) tahminle değil, ölçümle seçilir.
Gelişim Merkezi'nde `/brain` → araştırma paneli → **Yapay Zekâ Modeli** bölümü sonucu ve tek bir öneriyi
gösterir. Hiçbir model kendiliğinden indirilmez veya değiştirilmez. İndirme ve değiştirme, aynı bölümdeki
**İndir ve ölç** ve **Bu modele geç** düğmeleriyle telefondan onaylanır; AYAS'ın kendi uygulayıcısı yürütür
(aşağıda "Onaydan sonra").

## Ne ölçülür

- Donmuş Türkçe test `ayas-chat-tr-v3`: 21 soru. Gruplar: bilgi (6), hesap (4), talimata uyma (4),
  konuşma geçmişini kullanma (3), dürüstlük (4). Dürüstlük soruları bilinmeyen kişisel bilgiyi, geleceği
  ve yapılmamış bir eylemi kapsar.
- Her soru AYAS'ın gerçek sohbet yolundan sorulur: aynı konuşma kuralları, `keep_alive=0`, 420 token
  yanıt bütçesi ve aynı sıcaklık. Yanıt süresine AYAS'ın her cevapta ödediği model yükleme süresi dahildir.
- Model örnekleme yaptığı için her soru 3 kez sorulur; soru, denemelerin çoğunda geçerse geçmiş sayılır.
  Tek denemeli ölçümde aynı model iki koşu arasında 2 soru oynamıştı.
- Puanlama belirlenimcidir, bir modeli başka bir model puanlamaz. Her cevap ayrıca sesli Türkçe
  denetiminden geçer: markdown, emoji, başka alfabe, İngilizceye kayma ve düşünme metni sızıntısı kalır.
  Sayının yazıyla söylenmesi ("yüz derece") doğru sayılır.
- Ekran kartı payı (`/api/ps`): modelin ne kadarının GPU'da çalıştığı.

## Öneri kuralları

1. Şu anki model ölçülmemişse önce o ölçülür.
2. Bir model şu ankinden **en az 2 soru** daha fazla geçerse ve şu üç koşul sağlanırsa **değiştirme**
   önerilir:
   - dürüstlükte daha kötü olmamalı;
   - en az %90'ı ekran kartında çalışmalı;
   - ortanca yanıt süresi en fazla 1,5 katına çıkmalı.
3. Kurulu ama ölçülmemiş bir aday varsa önce o ölçülür.
4. Bu bilgisayara sığan ve henüz indirilmemiş en öncelikli aday için **indirme onayı** istenir.
5. Hiçbiri yoksa mevcut model kalır.

Sonuç ancak aynı test kimliğiyle ve modelin kurulu baytlarıyla (Ollama özeti) eşleşirse geçerlidir.
Model yeniden indirilirse yeniden ölçülür.

## Adaylar

İzleme listesi `src/lib/brain/autonomy/AyasModelWatch.ts` içindedir. Liste resmî Ollama kütüphanesindeki
modellerden oluşur ve 15 Ekim 2026'da `registry.ollama.ai` üzerinden boyut ve lisans açısından denetlendi.
Adayların hepsi Apache-2.0 lisanslı:

- `gemma4:12b`
- `qwen3.5:9b`
- `gemma4:e4b`
- `ministral-3:8b`
- `ministral-3:14b`
- `granite4.2:8b`

Yeni bir aday eklemek bir kod değişikliğidir; web sayfası kazınmaz. `gemma4` ve `qwen3.5` düşünme
kipine sahiptir. `OllamaAyasProvider` düşünmeyi `qwen3`, `qwen3.5` ve `gemma4` için kapatır
(`think: false`, `AYAS_THINKING_MODEL_FAMILY`). Böylece yanıt bütçesi düşünmeye gitmez, ölçüm de
sohbetle aynı ayarla yapılır.

## Komutlar

```powershell
npm run ayas:model-benchmark                    # şu anki model + kurulu, ölçülmemiş adaylar
npm run ayas:model-benchmark -- --registry      # adayların boyut ve özetini model deposundan da oku
npm run ayas:model-benchmark -- --models a,b    # yalnız bu kurulu modeller
npm run ayas:model-benchmark -- --installed     # kurulu bütün sohbet modelleri
```

Komut, Ollama'da yüklü bir model varken çalışmaz; AYAS ya da üretim o modeli kullanıyor olabilir.
`--force` bu denetimi atlar. Komut yalnız `data/brain/self-improvement/model-watch/state.json`
dosyasına yazar.

## Onaydan sonra (telefondan, Claude/Codex olmadan)

Owner kararları 15 Ekim (madde 4), tasarım onayı 16 Ekim. Her tıklama owner oturumuyla mühürlenmiş tek bir
kayıttır (`AyasModelOperationStore`, `data/brain/self-improvement/model-operations/`). İşi Observer'ın
güncelleme uygulayıcısı (`scripts/ayas-update-executor.ts`) her turda en fazla bir iş olarak yapar. Bu yalnız
makine uygunken ve kod temizken olur.

### İndir ve ölç

Bir aday kartında görünür, kart model deposu özetini gösteriyorsa. Onay, o özete bağlıdır
(`decideAyasModelTrial`, eylem `decideAyasModelTrial`). `AyasModelTrialRunner` sırasıyla:

1. İlk bayttan önce model deposundaki manifest hâlâ aynı özete sahip olmalı. Model deposunda da modelin
   boyutu artı 10 GB boş yer olmalı. Değilse hiçbir şey indirilmez. Özet değiştiyse kart yeni sürümü
   gösterir ve yeniden onaylanabilir.
2. Yerel Ollama (`POST /api/pull`, yalnız loopback) her turda en fazla 20 dakika indirir. Ollama yarım
   indirmeyi tutar; sonraki tur kaldığı yerden sürer. Üst üste 5 hata denemeyi bitirir.
   - PC yeniden başlasa da yarım indirme korunur. Bunu `scripts/ollama-production-hidden.vbs` sağlar:
     Ollama'yı `OLLAMA_NOPRUNE=1` ile başlatır.
   - Varsayılan davranışta Ollama açılışta yarım dosyaları siler. 16 Ekim'de gemma4:12b indirmesi bu
     yüzden kaybolmuştu.
   - Bedeli: bir etiket daha yeni baytlarla yeniden indirildiğinde eski, kullanılmayan katmanlar
     kendiliğinden silinmez. D'de yer azalırsa elle temizlik gerekir.
3. İnen modelin Ollama'daki özeti onaylanan özetle aynı değilse model ölçülmez.
4. Ollama başka bir model çalıştırmıyorsa ölçüm başlar. Şu anki model, kurulu baytlarıyla ölçülmemişse
   önce o ölçülür; ardından aday aynı testle ölçülür. Sonuçlar kartın okuduğu dosyaya yazılır.

Ayarlara ve canlı uygulamaya dokunulmaz. Onay geri alınırsa uygulayıcı durur; inmiş kısım Ollama'da kalır.

### Bu modele geç

Yalnız şu anki modelden daha iyi ölçülen bir modelin kartında görünür. Onay, iki ölçüme birlikte bağlıdır
(`ayasModelSwitchHash`, eylem `switchAyasModel`); ölçümlerden biri değişirse yeniden onay gerekir.
`AyasModelSwitchRunner` sırasıyla:

1. Karar hâlâ geçerli olmalı: şu anki model, değiştirilen modelle aynı; ölçümler aynı; aday hâlâ daha iyi.
2. İki `.env.local` dosyası değiştirilecek modeli göstermeli: canlı kopyanınki (canlı uygulama açılışta
   okur, sonraki yayın da kopyalar) ve kanonik repodaki (Observer ve ölçüm okur). Her ikisinde yalnız
   `AYAS_OLLAMA_MODEL` satırı değişir; diğer satırlar bayt bayt korunur.
3. Canlı uygulama `scripts/ayas-publish-live.ps1 -Restart` ile yeniden başlar. Bu, yayının durdur →
   denetçiyi başlat → sağlık bekle adımlarıdır; hiçbir şey derlenmez ya da değiştirilmez. Canlı uygulamada
   çalışan bir iş varsa dosyalar eski hâline döner ve geçiş ertelenir (en fazla 12 tur).
4. Adayın ölçümde geçtiği bilgi, hesap ve dürüstlük sorularından birer tanesi yeni modelle AYAS'ın sohbet
   yolundan sorulur.

Yeniden başlatma ya da bu test geçmezse iki dosya önceki baytlarına döner ve uygulama yeniden başlar
(ROLLED_BACK). Önceki baytlar yalnız bellekte tutulur, çünkü dosyalar gizli bilgi içerir. Geri dönüş de
sağlıklı olmazsa durum RECOVERY_REQUIRED olur ve elle incelenir. Yarıda kalan bir geçiş, dosyalar
değişmemişse yeniden denenir; değişmişse elle incelenir. Geçiş git'e commit'lenmez, çalışma ayarıdır. Eski
model diskte kalır; ona dönmek için aynı kart kullanılır, ancak o model yeniden "daha iyi" ölçülürse.

`AYAS_OLLAMA_MODEL` araştırma özetleyicisini (`AyasDeepResearchEngine`) de etkiler: sonraki araştırma
turundan itibaren o da yeni modeli kullanır. Sorun çıkarsa Gelişim Merkezi'ndeki Araştırma Sağlığı bunu
gösterir.

- Kullanılmayan bir model `ollama rm <model>` ile silinir. Bu da owner kararıdır ve bugün telefondan
  yapılamaz.
- Elle ölçüm için yukarıdaki komutlar aynen çalışır.
