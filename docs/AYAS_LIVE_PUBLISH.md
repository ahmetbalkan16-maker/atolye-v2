# AYAS canlı uygulama yayını (telefon erişimi)

Telefondan açılan uygulama, kanonik repodan değil, ayrı ve hash'e bağlı bir kopyadan çalışır:
`D:\ÜRETİM\Atolye\ayas-live-<commit>` (ayrık git worktree'si, kendi `node_modules` ve `.next`
klasörüyle). Çalışma dizini ve veri kökü kanonik repo olarak kalır. Erişim denetçisi
(`scripts/ayas-access-daemon.ps1`) uygulamayı yalnız
`D:\ÜRETİM\private\AtolyeAyasAccess\prebuilt-runtime-v1.json` bu kopyayla birebir eşleşirse
başlatır. Bu yüzden kanonik repodaki geliştirme canlıyı kendiliğinden değiştirmez; her yayın
bilinçli bir bakım adımıdır.

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
   birlikte kapanabilir (`docs/AYAS_LOCAL_CONVERSATION_2026-10-10.md`); bu yüzden geçiş bir ajan
   oturumundan değil, owner tarafından çalıştırılır.
5. Yeni uygulama 3000 portunda giriş kapısıyla yanıt verene ve denetçi `healthy` yazana kadar
   beklenir (varsayılan 240 sn). Olmazsa eski dosyalar geri konur ve önceki kopya yeniden başlatılır.

Telefon erişimi geçiş sırasında yaklaşık bir dakika kesilir. Eski `ayas-live-*` kopyaları geri dönüş
için silinmez; yer açmak gerekirse yayın seçicisinin göstermediği kopyalar
`git worktree remove <yol>` ile kaldırılabilir.
