# AYAS model karşılaştırması

AYAS'ın sohbet modeli (`.env.local` içindeki `AYAS_OLLAMA_MODEL`) tahminle değil, ölçümle seçilir.
Gelişim Merkezi'nde `/brain` → araştırma paneli → **Yapay Zekâ Modeli** bölümü sonucu ve tek bir öneriyi
gösterir. Hiçbir model kendiliğinden indirilmez veya değiştirilmez.

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
kipine sahiptir. `OllamaAyasProvider` bugün düşünmeyi yalnız `qwen3` için kapatır; ölçüm bu
modellerdeki farkı gösterir.

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

## Onaydan sonra

- **İndirme (owner onayı):** `ollama pull <aday>`. Ardından
  `npm run ayas:model-benchmark -- --models <şu anki>,<aday>` aynı testle ölçer. İndirilen modelin özeti,
  `--registry` ile kaydedilen özetle karşılaştırılabilir.
- **Değiştirme (owner onayı, geliştirme oturumunda):**
  1. `AYAS_OLLAMA_MODEL` hem kanonik repodaki hem canlı kopyadaki (`ayas-live-<sha8>`) `.env.local`'de
     değiştirilir.
  2. Uygulama yeniden başlatılır.
  3. Aynı değişken araştırma özetleyicisini (`AyasDeepResearchEngine`) de etkiler, bu yüzden araştırma
     testleri de çalıştırılır.
  4. Geri dönüş: eski değer.
- Kullanılmayan bir model `ollama rm <model>` ile silinir. Bu da owner kararıdır.
