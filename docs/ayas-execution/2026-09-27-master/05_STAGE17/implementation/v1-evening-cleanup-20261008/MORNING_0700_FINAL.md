# 9 Ekim Cuma 07.00 — owner test sırası ve bakım öncesi şartlar

**07.00 otomatik deployment izni değildir.** Testler mevcut canlı sürümde yapılır: build stamp `e974614`, `treeState CLEAN`, 8 Ekim 09:54Z; kurulu Next **16.2.10**. Deploy, restart, Next yükseltmesi, reboot, Gelişim Merkezi'nde APPROVE veya YÜRÜT yapılmaz. Hiçbir satır gerçek cihaz gözlemi olmadan PASS yazılmaz; owner bildirmezse NOT_RUN kalır. Cookie, passcode, env veya ses kaydı paylaşılmaz.

## Test sırası (canlı `e974614` üzerinde)

| # | Owner ne yapar | Ayrı kaydedilecek sonuç |
|---|---|---|
| 1 | **PC erişimi:** PC tarayıcısında `https://ayas.atolyeayas.com/` açılır | Sayfa/login geldi mi, saat, varsa secretsiz hata metni |
| 2 | **Owner giriş ve auth:** kendi girişini yapar, korumalı `/brain` açılır; girişsiz ayrı pencerede korumalı sayfa reddedilmeli | Owner erişimi PASS/FAIL; anonim ret PASS/FAIL |
| 3 | **Yerel model sohbeti:** önce aktif sağlayıcının yerel model olduğu doğrulanır, sonra kısa Türkçe metin sohbeti | Yanıt geldi mi; model kanıtı yoksa "yerel model" NOT_RUN; ücretli fallback başlatılmaz |
| 4 | **Telefon PWA:** kurulu AYAS kapatılıp açılır; takılırsa aynı URL telefon tarayıcısında denenir; site verisi toplu silinmez | Telefon/OS/tarayıcı; PWA ve tarayıcı sonucu ayrı; görülen başlangıç URL'si |
| 5 | **Mikrofon:** mevcut mikrofon kontrolü açılır, izin verilir | İzin ve capture ayrı; izin yoksa 6–8 PASS sayılmaz |
| 6 | **Türkçe dinleme / STT:** "Fatih videosunu pazartesi düzelteceğiz" söylenir | Dinleme göstergesi ve doğru transcript ayrı |
| 7 | **Sesli yanıt / TTS:** "Bana Türkçe tek kısa cümleyle yanıt ver"; yanıt kesilip yeni cümle söylenir; PC ve telefon ayrı | Duyulabilir Türkçe ses, anlaşılırlık, interrupt; sessiz animasyon başarı değildir |
| 8 | **Bağlantı sürekliliği:** telefon 60 sn kilitlenip açılır; Wi-Fi kısa kapatılıp açılır | Reconnect, sohbet sürekliliği, auth/izin kaybı, yeniden dinleme |

Bir hata görülürse önce mevcut sürüm sorunu olarak kaydedilir; bundan bakım izni çıkarılmaz.

## Bakım öncesi — son kaynak SHA'sı

- **Uygulama kaynağı:** `dbf9542` içeriği. `src`, `app`, `package.json` ve lock dosyası `dbf9542`, `32e59c1` (origin'de) ve `f37d0e7` (yerel) arasında aynı; aralarındaki fark yalnız lint ayarı, dokümanlar ve iki V2 test dosyası.
- **Önerilen deploy hedefi:** origin'deki `32e59c1`. Yerel `f37d0e7` ve sonraki doküman commit'i push edilmedi; bunlar hedef olacaksa önce ayrı push onayı gerekir.
- **Test bağı:** Full166 166/166 yalnız `dbf9542` için; `32e59c1` ve sonrası için otomatik sertifika yok. Exact yeni HEAD baseline istenirse yeni koşu ve kendi receipt'i gerekir.
- **Bağımlılık:** yeni kaynak Next **16.3.8** lock'u ister; canlıdaki kurulu ağaç 16.2.10. Deploy bir Next yükseltmesidir ve ayrıca onaylanır.

## Rollback şartları

- Geri dönüş noktası eski `e974614` build'i **ve** eski 16.2.10 bağımlılık ağacıyla birlikte alınmalı; 16.3.8 lock'tan `npm ci` eski sürümü geri getirmez.
- Yedek materialize edilip dosya envanteri, boyut ve SHA ile doğrulanmadan yeni sürüm kurulmaz. Canlı writer varken alınan kopya qualified rollback sayılmaz.
- Auth/seal/oturum gerilemesi, yanlış SHA/bağımlılık, çift origin/tunnel, erişim/sohbet/ses kaybı veya kararsız writer durumunda adım ilerletilmez; deploy başlamadan eksik varsa **ABORT_BEFORE_DEPLOY**.
- Authority/journal körlemesine geri alınmaz; Recovery9 replay veya aktör ekleme yapılmaz.

## Owner'ın ayrı ayrı vermesi gereken onaylar

1. Exact hedef SHA ile deploy/restart onayı (öneri `32e59c1`).
2. Next 16.2.10 → 16.3.8 bağımlılık değişikliği onayı.
3. Writer quiescence için Observer/production writer'larının kontrollü durdurulması (F98 interval'i de bu pencerede alınabilir).
4. Reboot onayı (deploy onayı reboot yetkisi değildir).
5. Yerel commit'lerin push onayı (bu akşamki `f37d0e7` ve doküman commit'i dahil); ayrıca V2 bağımsız inceleme kararı.

Onaylı rollout sonrası 1–8 yeni sürümde baştan ve ayrı sütunda ölçülür; eski sürüm başarısı yeni sürüme aktarılmaz. Yeni sürümde eski cookie ile ayrıcalıklı eylem için çıkış/yeniden giriş gerekir.
