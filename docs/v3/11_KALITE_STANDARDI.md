# Kalıcı video üretim kalitesi standardı ve Kalite Kapısı (27 Kasım 2026)

Owner'ın "ATÖLYE – KALICI VİDEO ÜRETİM KALİTESİ STANDARDI" talimatı (Codex analizinden) bundan sonraki bütün yeni
videolar için geçerlidir. Yayınlanmış videolara dokunulmaz. Bu belge standardın her maddesinin Atölye V3'te nerede
uygulandığını gösterir. Var olan kontroller değiştirilmedi. Eksik olanlar eklendi, ölçülemeyenler de açıkça yazıldı.

## Kalite Kapısı (yeni)

- Modül: `src/lib/v3/council/QualityGate.ts`. Saf bir modüldür: model, ağ ve dosya erişimi yoktur.
  Üretimde `scripts/atolye-v3.ts` içindeki birleştirme adımında, kalite beyni ile yerleşim ve piksel ölçümlerinden
  sonra, teslim kararından önce çalışır.
- Kapı yeni bir ikinci denetim kurmaz. QC.md'nin her satırını başlığına göre **aşamaya** (senaryo, sahneler, görseller,
  animasyon, kurgu, ses, altyazı, export) ve **puan alanına** bağlar (`qcChecks`). Yalnız bu noktada bilinen ölçümleri
  de ekler: kalite beyninin kareleri, yerleşim ve piksel kusurları, yönetmen kurulu, araştırma beyninin eksikleri,
  kapanış sorusu, kapanış duruşu, orta bölüm boşluğu, altyazı okunurluğu, Shorts arayüzü ve yükleme dosyasının biçimi.
- **Puanlar ölçümden gelir.** Her alan 10 puandan başlar ve açık kalan her kontrol, ağırlığı kadar puan düşürür.
  Gerekçe listesi her kontrolü sahne ve zaman koduyla verir. Ölçülemeyen kontrol "ölçülmedi" diye yazılır ve puanı
  hiçbir yöne etkilemez.
- **Karar:**
  - Tarih ya da teknik engel varsa → `engelli`.
  - Toplam 8,5'in altındaysa ya da bir alan 8'in altındaysa → `iyilestirme_gerekli`.
  - Bunların hiçbiri yoksa → `yayina_hazir`.
- Engeller şunlardır. Toplam puan iyi olsa bile video yayına hazır sayılmaz.
  - **Tarih engelleri:** tarih doğrulaması `tamam` değilse; araştırma beyninin bir eksik bulgusu varsa (uydurma kişi,
    tavan yüzünden yerel modelle yapılmış tarih kapısı).
  - **Teknik engeller:** görsel lisansı sorunu, bozuk ses, CREDITS eksikliği, 5000 bayta sığmayan zorunlu atıf, yükleme
    dosyasının biçimi (Short için 1080×1920 ve en çok 180 sn; uzun video için 1920×1080; süre final ile aynı olmalı).
- Çıktılar:
  - `KALITE_KAPISI.md`: puan tablosu, engeller, aşama aşama açık kontroller ve gerekçeler.
  - `kalite-kapisi.json`
  - QC.md'de tek satır.
  - Kurulda engeller `eksik` (teslim UYARIYLA olur), hedef altı alanlar `uyari` olarak görünür.
- **Yayın:** İzleyici kapı kararını siparişe yazar (`order.kalite`). `PublishApproval.approvePublish`, `engelli` bir
  videoyu YouTube'a onaylamaz. Son söz yönetmenindir: AYAS'a "… videosunu yine de yükle" yazılırsa ya da
  `yapim.ts onayla <id> --zorla` çalıştırılırsa video yine yüklenir. Kapıdan önce yapılmış siparişlerde bu alan yoktur
  ve onlar eskisi gibi onaylanır.
- Rötuş turları her turda kapıyı yeniden hesaplar (`tur` alanı). Tur seçimini eskisi gibi rötuş beyni yapar
  (`cutFaults` = açık QC satırları + yerleşim + piksel), yani kapının ölçtüğü satırların aynısı.

## Standardın maddeleri → Atölye'deki yeri

| Madde | Nerede | Durum |
|---|---|---|
| A. İlk 3 sn kanca, soru, dayanak | `ShortOpening.ts`, `ChannelGoals.openingChecks`, `QuestionTitle`, `HookFollow` (QC: Açılış sorusu, Kanca dayanağı, İlk 3 sn, İlk kare) | vardı → alan "Hook gücü" |
| B. Kronoloji, neden-sonuç, tekrar | senaryo onarım turları, `ScriptPrompts` sahne reçetesi, yönetmen kurulu (`DirectorCouncil`) | vardı → alan "Hikâye"; kronoloji ayrıca ölçülmüyor (yazar kuralı + kurul) |
| C. Görsel denge, alakalılık, tekrar | `MapRules` payları ve en az 3 gerçek görsel, dönem yargıcı, kalite beyninin "anlatılanı gösterme" puanı | vardı + kapıda "Anlatılanı gösterme ≥ 7" |
| D. Ölü an, ritim, orta bölüm, final | görsel olay aralığı, en uzun olaysız aralık, kısa çekim (vardı); **orta bölüm %30–70 boşluğu**, **kapanış duruşu** | yeni ölçüm |
| E. Ses: seviye, temizlik, bozukluk | LUFS/tepe, vızıltı, takılı sinyal, tıkırtı | vardı; **müzik/anlatıcı dengesi ayrıca ölçülmüyor** (miks kuralıyla kısılıyor; "ölçülmedi" diye yazılıyor) |
| E. Altyazı senkronu ve mobil okunurluk | `altyazi.srt` kelime zamanlı (YouTube CC; owner kararıyla videoya gömülü altyazı yok); **≤ 84 karakter, ≤ 22 karakter/sn, üst üste binme yok, videodan taşma yok** | yeni ölçüm |
| E. Shorts arayüzünün kapattığı alan | **`LayoutCheck.shortsUiFaults`**: alt %20, üst %7, sağ buton sütunu; **tarih damgası dikey karede 150 px'e indi** (`hudLayout.dateTop`, güç çubuğu 240 px) | yeni |
| F. Tarih, kişi, istatistik, kaynak | tarih kapısı (`research/` + `CastCheck.inventedPeople`), kaynak bankası, sabit Wikipedia sürümleri, CREDITS.md | vardı → **artık yayın engeli** |
| 3. Kanal standardı (ABD İngilizcesi, Shorts temel format, tutarlı görsel kimlik) | `dil: en` varsayılan, dikey 60 sn Short varsayılanı, OverSimplified benzeri çizim dili, kanal hedefleri | vardı |
| 4. 10 alan, hedef 8 / 8,5, gerekçeli puan | **`QualityGate.scoreGate`** | yeni |
| 5. Her aşamanın kendi kontrolü | senaryo (tarih kapısı, onarım), sahneler (pay, plan), görseller (yargıç, lisans), animasyon (hareket ölçer, açılış kamerası), kurgu, ses, export | vardı; kapı hepsini aşama aşama raporluyor |

## Gerçek videolarda geriye dönük deneme (27 Kasım 2026, model çağrısı yok)

Son 7 siparişin QC.md, plan.json, altyazi.srt ve yerlesim.json dosyalarından elde edilen kararlar:

| Video | Karar | Toplam |
|---|---|---|
| Constantinople (1) | iyileştirme gerekli | 8,8 |
| Constantinople (2) | hazır | 9,3 |
| Trasimene | iyileştirme gerekli | 9,0 |
| Stalingrad | **engelli** | 8,9 |
| Stalingrad dikey | iyileştirme gerekli | 9,2 |
| Cajamarca | hazır | 9,3 |
| İran | hazır | 8,9 |

Stalingrad elle yazılmış bir bölümdü ve doğrulama kaydı yoktu, bu yüzden engellendi. Yinelenen bulgular:

- Altı videoda sahne planında kamera eksikti.
- Üç Short'ta tarih damgası Shorts üst çubuğunun altında kalıyordu. Bu düzeltildi.
- Constantinople'da 4 altyazı videonun bitişinden sonra bitiyordu.
- Kanca ardı satırı 15 kelimeydi (hedef en çok 12).

## Kanıt

- `scripts/smoke-v3-quality-gate.ts` (9 senaryo)
- `smoke-v3-motion`, `smoke-v3-episode-director`, `smoke-v3-youtube`, `smoke-v3-youtube-yukleme`,
  `smoke-ayas-video-order`, `smoke-ayas-action-firewall-closure`
- `tsc` (kök ve remotion-v3), yerel lint
