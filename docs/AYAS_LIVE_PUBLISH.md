# AYAS canlı uygulama yayını (telefon erişimi)

Telefondan açılan uygulama, kanonik repodan değil, ayrı ve hash'e bağlı bir kopyadan çalışır:
`D:\ÜRETİM\Atolye\ayas-live-<commit>` (ayrık git worktree'si, kendi `node_modules` ve `.next`
klasörüyle). Çalışma dizini ve veri kökü kanonik repo olarak kalır. Erişim denetçisi
(`scripts/ayas-access-daemon.ps1`) uygulamayı yalnız
`D:\ÜRETİM\private\AtolyeAyasAccess\prebuilt-runtime-v1.json` bu kopyayla birebir eşleşirse
başlatır. Bu yüzden kanonik repodaki commit'lenmemiş geliştirme canlıyı değiştirmez. 19 Ekim
2026'dan beri push'lanmış bir commit canlıya kendiliğinden geçer (aşağıda "Otomatik yayın").

## Otomatik yayın (owner kararı, 19 Ekim 2026)

Owner: "Bir görev bitince otomatik olarak canlıya aktarılsın." Görev bitti = commit `origin`'e
push'landı (temiz çalışma ağacı, HEAD = upstream). Observer her turda güncelleme yürütücüsünü
(`scripts/ayas-update-executor.ts`) çalıştırır. Owner'ın kendi tıklamalarından sonra, arka plan
güncelleme denemelerinden önce yürütücü şuna bakar (`src/lib/brain/autonomy/AyasAutoLivePublish.ts`):

- Canlı kopyanın commit'i (`prebuilt-runtime-v1.json` → `buildHead`) HEAD değilse,
- HEAD push'lanmışsa ve canlı commit'in torunuysa (daha eski ya da başka daldaki bir commit yayınlanmaz),
- uygulama dosyaları (yukarıdaki liste, betikteki `$appPaths` ile aynı) değiştiyse,
- bu commit daha önce geri dönülmediyse ve en fazla 2 kez denendiyse (yarıda kalan deneme de sayılır),
- owner son 5 dakikada AYAS'la sohbet etmediyse
  (`data/brain/phone-access/owner-chat-activity.json`, yalnız zaman damgası),

aynı `ayas-publish-live.ps1 -Commit <sha> -Apply` komutunu çalıştırır; yeni kopya, sağlık kontrolü
ve geri dönüş aynen geçerlidir. Denemeler
`data/brain/self-improvement/update-trials/auto-live-publish.json` dosyasında, sonuç observer
günlüğünde `AUTO_LIVE_PUBLISHED` / `AUTO_LIVE_ROLLED_BACK` / `AUTO_LIVE_FAILED` olarak görünür.
Boşta turda `IDLE` satırının `autoLive` alanı neden yayın olmadığını söyler (`CURRENT`,
`NOT_PUSHED`, `NO_APP_CHANGE`, `OWNER_ACTIVE`, ...). Yürütücü kirli ağaçta, güvenli kipte, makine
sağlığı izin vermediğinde ve diskte 15 GB'tan az yer kaldığında çalışmaz. Kapatmak için `.env.local`
içine `AYAS_AUTO_LIVE_PUBLISH=0`.

Yalnız betik değişirse (ör. erişim denetçisi): uygulama yeniden yayınlanmaz. Çalışan denetçi her
turdan sonra kendi dosyasına bakar. Commit'lenmiş, ayrıştırılabilen yeni bir sürüm varsa kilidi
bırakır, aynı gizli başlatıcıyla (`scripts/ayas-access-hidden.vbs`) yeni kopyasını açar ve çıkar.
Uygulama ve tünel kesilmez. Yeni kopya 60 sn içinde kilidi almazsa eski kopya eski kodla çalışmaya
devam eder ve o sürümü bir daha denemez (`recovery-audit.jsonl`: `reload`/`handover`).

## Komut

Normal PowerShell'de (yönetici olarak değil):

```powershell
# Durum: canlı hangi commit'te, yayın gerekiyor mu (hiçbir şeyi değiştirmez)
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\ÜRETİM\Atolye\atolye-v2\scripts\ayas-publish-live.ps1"
# Hazırla: yeni kopya, npm ci, build, hazır manifest (canlıya dokunmaz)
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\ÜRETİM\Atolye\atolye-v2\scripts\ayas-publish-live.ps1" -Prepare
# Yayınla: hazırla + geçiş + sağlık kontrolü
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\ÜRETİM\Atolye\atolye-v2\scripts\ayas-publish-live.ps1" -Apply
```

Varsayılan commit `HEAD`; başka biri için `-Commit <sha>`. Uygulama dosyaları (`app`, `src`,
`public`, paket dosyaları, Next yapılandırması) canlıdakiyle aynıysa betik "yayın gerekmez" der.

## -Apply ne yapar

1. Hazırlık: worktree, git dışı girdilerin canlı kopyadan aktarımı (`.env.local`, `public\ort`,
   `public\wake`), `npm ci`, `npm run build` (CLEAN damga), `ayas-prebuilt-runtime.mjs --qualify`
   ile `private\temp\live-publish-<sha8>` altında hazır manifest.
2. Canlı uygulamada çalışan bir alt iş (ör. ffmpeg) varsa durur, hiçbir şeyi değiştirmez.
3. Eski manifest ve yayın seçicisi `D:\ÜRETİM\handover\live-publish\<zaman>-<sha8>\` altına yedeklenir.
4. Erişim denetçisi ve uygulama durdurulur (tünel çalışmaya devam eder), manifest ve seçici birlikte
   değiştirilir, denetçi Başlangıç kısayoluyla Windows kabuğu (explorer) üzerinden, oturum açılışındaki
   gibi yeniden açılır. Bir konsolun ya da ajan oturumunun alt süreci olarak açılan denetçi onunla
   birlikte kapanabilir (`docs/AYAS_LOCAL_CONVERSATION_2026-10-10.md`). Kabuk üzerinden açılan
   denetçi bundan etkilenmez: 15 Ekim yayınında (`7bd27b93`, owner talimatıyla bir Claude
   oturumundan) denetçinin üst süreci DCOM'un açtığı `explorer.exe /factory,… -Embedding` oldu.
   Owner talimatı gereği her geliştirme görevinden sonra yayın yapılır; 19 Ekim 2026'dan beri bunu
   observer kendisi yapar (yukarıda).
5. Yeni uygulama 3000 portunda giriş kapısıyla yanıt verene ve denetçi `healthy` yazana kadar
   beklenir (varsayılan 240 sn). Olmazsa eski dosyalar geri konur ve önceki kopya yeniden başlatılır.

Telefon erişimi geçiş sırasında yaklaşık bir dakika kesilir. Eski `ayas-live-*` kopyaları geri dönüş
için silinmez; yer açmak gerekirse yayın seçicisinin göstermediği kopyalar
`git worktree remove <yol>` ile kaldırılabilir.
