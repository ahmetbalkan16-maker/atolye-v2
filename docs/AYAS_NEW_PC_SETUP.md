# AYAS / Atölye — yeni PC kurulumu

Bu belge bütün AYAS/Atölye paketinin (`D:\ÜRETİM`) yeni bir bilgisayara taşınmasını anlatır.
İnternetten yeniden kurulabilen programlar pakete konmaz; paket yalnız kod, veri, modeller,
özel ayarlar ve kanıtları taşır. Komut betiği: `scripts/new-pc-setup.ps1`.

## 1. Eski PC'de (taşımadan önce)

- `D:\ÜRETİM` klasörünün tamamını USB'ye **normal kopyala-yapıştır** ile kopyala. İzinleri
  (ACL) koruyan `robocopy /COPYALL` kullanma; eski PC'nin kullanıcı kimlikleri yeni PC'de
  çözülemez.
- 15 Ekim ölçümü: paket ~163 GB; **çalışmak için gereken ~57 GB** (`Atolye` ~25,9 · `models`
  21,7 · `handover` 2,9 · `backups` 2,0 · `migration` 2,0 · `runtime` 1,3 · `private` temp
  hariç ~0,5). Yerel kod modeli denemesinin dosyaları (`qwen3-coder:30b` 18 GB, `qwen2.5-coder`
  GGUF 8,4 GB, C'deki 50,6 GB'lık Podman sanal diski) owner isteğiyle aynı gün silindi.
- Çalışmak için gerekmeyen, isteğe bağlı kopyalanacaklar:
  - `archives` (99,4 GB): eski C kaynakları, C Temp ve cold-copy yedekleri; yalnız geçmiş/kanıt.
    Silme; istersen ayrı bir diskte sakla.
  - `private\temp` (7 GB): geçici çalışma dosyaları. Klasörün kendisi boş da olsa var olmalı.
  - `Atolye\atolye-v2\node_modules` (1,1 GB): kurulum betiği `npm ci` ile yeniden kurar.
- **Kopyalanmaması gereken yok:** `Atolye\ayas-live-c10d1e33` (telefon erişiminin çalıştırdığı
  yayınlanmış uygulama) kendi `node_modules` klasörüyle birlikte hash'e bağlıdır; aynen taşınır.
- `private\` gizli anahtarları ve tünel kimliğini içerir; USB'yi güvenli tut. Git'e girmez.
- Kopyalamadan önce açık çalışmanın commit/push edildiğinden emin ol (`git status` temiz).

## 2. Yeni PC'de (bir kez)

1. USB'deki `ÜRETİM` klasörünü **aynı adla** `D:\ÜRETİM` olarak kopyala. Yol aynı olmalı:
   `.env.local`, başlatıcılar ve çalışma alanı kayıtları bu yolu kullanır.
2. Normal kullanıcı PowerShell'i aç ("Yönetici olarak çalıştır" değil) ve önce kuru çalıştır:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File "D:\ÜRETİM\Atolye\atolye-v2\scripts\new-pc-setup.ps1"
   ```

   Çıktı her adımı `[TAMAM]`, `[YAPILACAK]`, `[SORUN]` olarak listeler; hiçbir şey değişmez.
3. Uygula:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File "D:\ÜRETİM\Atolye\atolye-v2\scripts\new-pc-setup.ps1" -Apply
   ```

   Betik şunları yapar (her adım idempotenttir, tekrar çalıştırmak güvenlidir):
   - winget ile **tam sürüm** kurulum: Node.js 24.18.0, cloudflared 2026.8.3, Ollama 0.40.3,
     Git 2.55.0, FFmpeg 9.0. Node ve cloudflared, telefon erişimi yayınının hash'ine bağlı
     olduğu için kurulumdan sonra hash doğrulanır ve winget'te sabitlenir (otomatik güncelleme
     telefon erişimini bozmasın diye).
   - `D:\URETIM` ASCII bağlantısı (Whisper ve Observer yolları için).
   - Kullanıcı ortam değişkenleri: `OLLAMA_MODELS`, `OLLAMA_TMPDIR`, `NPM_CONFIG_CACHE`,
     `AYAS_TEMP_ROOT`, `ATOLYE_DURABLE_PIPELINE_EXECUTION`. Windows'un genel TEMP/TMP'si
     değişmez.
   - Profil bağlantıları: `%USERPROFILE%\.ollama` → `D:\ÜRETİM\models\ollama`,
     `%USERPROFILE%\.cloudflared` → `D:\ÜRETİM\private\cloudflared`. Ollama ilk açılışta kendi
     klasörünü oluşturmuşsa silinmez, `.pre-ayas-<zaman>` adıyla saklanır.
   - `.env.local` içindeki yalnız FFmpeg yolları yeni kurulum yerine çevrilir (önce
     `private\host-settings-backup` altına yedek alınır).
   - Repo bağımlılıkları (`npm ci`, önbellek paket içinde) ve Graphify 0.17.1.
   - Podman yalnız yerel kod modeli yeterlilik sandbox'ı için gerekir. Hiçbir yerel model
     yeterliliği geçmediği için (15 Ekim) betik varsayılan olarak Podman'ı **atlar**. Ancak
     `-LocalCodingSandbox` verilirse Podman 6.0.2'yi denetler (winget'te bu sürüm yoktur; eksikse
     GitHub sürüm sayfasını gösterir) ve `podman machine`'i (8 CPU, 8 GiB, 40 GB, rootless)
     oluşturur. Telefon erişimi ve Gelişim Merkezi onsuz çalışır.
   - Üç Başlangıç kısayolu: AYAS Access Online, AYAS Autonomy Observer, Ollama. Üçü de
     yollarını kendi konumundan türeten gizli `.vbs` başlatıcılarıdır (pencere açılmaz).
4. Bilgisayarı yeniden başlat. Oturum açılınca Ollama, telefon erişimi (tünel + uygulama) ve
   Observer kendiliğinden başlar; Gelişim Merkezi'ne telefondan bağlanabilirsin.
5. Kişisel girişler makineye özeldir ve pakette taşınmaz: `gh auth login` (GitHub'a push için),
   kullandığın AI araçlarının kendi girişleri.

## 3. Atölye proje medyası için resmi kurtarma geçişi

Kopyalanan çalışma alanının fiziksel dosya kimlikleri (cihaz/inode) yeni PC'de değişir. Güvenlik
gereği Atölye, eski projelerin ses/video yayınlarını bu kimliklere bağlı tutar; kurulum betiği
bunu `[SONRAKI] ... resmi kurtarma gecisi gerekli` satırıyla bildirir. **AYAS, Gelişim Merkezi
ve telefon erişimi bunu beklemeden çalışır**; yalnız eski proje medyasının sunulması ve yeni
üretim bu geçişi bekler. Kayıtlar elle düzenlenmez; geçiş mevcut resmi araçlarla yapılır:

1. `npm run runtime:backup:create` → `runtime:backup:verify` (doğrulanmış yedek).
2. `npm run runtime:migration:candidate:create` → `runtime:migration:candidate:consume` ile yeni,
   boş bir hedef köke materyalizasyon.
3. `npm run authority:begin-recovery -- --authority-root <p> --target <yeni kök>
   --transition-id <id> --reason "new PC"` → `authority:quiesce` → `authority:prepare
   --candidate-directory <c>` → `authority:validate` → `authority:publish`.
4. `.env.local` içindeki `ATOLYE_RUNTIME_ROOT` yeni köke çevrilir, sonra
   `node --env-file=.env.local scripts/check-production-layout.mjs`
   `QUALIFIED_CURRENT_HOST_LAYOUT` vermelidir.

Bu araçlar 13-14 Ekim C→D geçişinde (`relocation` türüyle) yürütüldü
(`docs/AYAS_D_URETIM_RELOCATION_2026-10-13.md`, `docs/AYAS_D_PRODUCTION_MIGRATION_2026-10-14.md`).
Yeni PC için `recovery` türü seçildi, çünkü kayıtlı eski fiziksel kök orada artık yoktur
(koordinatör `recovery`'yi tam olarak terk edilen kaynak için tanımlar ve kaynağı temiz
olmaya zorlamaz). **Durum: yeni PC'de henüz denenmedi.** Taşımadan önce bu PC'de çalışma
alanının bir kopyası üzerinde benzetimle doğrulanması açık iştir (ATOLYE_CHECKPOINT.md).
Yeni PC'de bir AI oturumuna "AYAS_NEW_PC_SETUP adım 3'ü yürüt" demek yeterlidir; adımlar
operatör kararı ve worker durdurma gerektirdiği için betikle otomatik çalıştırılmaz.

## 4. Bu PC'de kalan ve neden önemsiz olduğu

| C'de kalan | Durum |
|---|---|
| Kurulu programlar (Node, Ollama, cloudflared, FFmpeg, Git) | Yeni PC'de betik yeniden kurar |
| Başlangıç kısayolları | Yeni PC'de betik oluşturur |
| `.ollama` / `.cloudflared` profil bağlantıları | Yalnız D'yi gösteren bağlantı; betik yeniden kurar |
| `AYAS Access Online` / `AYAS Autonomy Observer` zamanlanmış görevleri | Silinmiş C dosyalarını gösteren eski kayıtlar; zararsız. Silmek için yönetici PowerShell: `Unregister-ScheduledTask -TaskName '<ad>' -Confirm:$false` |
| Codex'in açık çalışma klasörü kısayolları | Codex'e ait; AYAS/Atölye verisi değil |

AYAS/Atölye'ye ait veri, model, ayar veya kayıt C'de yoktur (son tam C taraması:
`docs/AYAS_C_TEMP_CLEANUP_2026-10-14.md`).
