# AYAS Offline Recovery — R0 sonrası tek karar paketi

> Owner PACKAGES_FAILED devam kararı sonrası güncel next-action: [WINPE_NEXT_OWNER_ACTION.md](WINPE_NEXT_OWNER_ACTION.md). Aktifmount0 ownerPASS kabul edildi/tekrar edilmedi. Mevcut loglar CBS0x8007007a buffer initialization failure gösterir; eksik OC kanıtı yok. Inspect-WinRE tekrar çalıştırılmaz; **REQUIRED_MEDIA WINPE**, kısa yolda sealed owner ISO-preparation script hazır; realoffline BLOCKED/A–D HELD. Aşağıdaki eski WinRE-first/Inspect-next-action bölümleri tarihsel hazırlık kaydıdır.

10 Ekim 2026. Owner'ın MASTER SÖZLEŞMESİ v1.1 ve bu oturumdaki dar yetki sınırları geçerlidir. Bu kayıt önceki paketin R0 beklentisini supersede eder; eski ham kanıtları değiştirmez. **STOP; A–D HELD.** Uygulanabilir bakım onayı henüz istenmez.

| Teslim | Durum |
|---|---|
| OFFLINE_ENVIRONMENT | **BLOCKED** — mevcut WIM bileşenleri/loader ve gerçek boot henüz doğrulanmadı |
| REQUIRED_MEDIA | **BLOCKED** — ilk aday WINRE; aşağıdaki koşullu en küçük yöntem WINPE |
| COLD_BACKUP_TOOL | **QUALIFIED_SYNTHETIC** — yalnız TEMP/normal Windows delta kapsamı; gerçek giriş HELD |
| SAFE_WINDOWS_RETURN | **PLAN_READY** — dönüş planı hazır, cihaz kanıtı NOT_RUN |
| F115_ISOLATED | **PRESERVED** |
| F115 | **OPEN_IN_LIVE** |
| CONSISTENT_BACKUP_PASS | **FALSE** |
| MAINTENANCE | **NOT_READY** |
| HOMEPAGE_OWNER_STOP | **PRESERVED** |

## R0 — kabul edildi; tekrar sorgulanmadı

OWNER_REPORTED_PASS: WinRE ENABLED / 10.0.26100.9444 / harddisk0 partition4; BCD recoveryenabled Yes ve recoverysequence=ReAgentC identifier. C ve D Fully Decrypted / BitLocker Off; protector yok. Bu oturum reagentc, bcdedit, manage-bde sorgularını tekrarlamadı. R0 kapıları yeniden açılmaz. Bu metadata boot, loader veya Windows'a dönüş kanıtı değildir.

Giriş Git HEAD/origin `7b09ac9`, pull güncel, temiz. Yeni commit/push owner'ın bu oturumdaki açık yasağı nedeniyle YAPILMADI. Source/build/deploy/task/Access/Observer/homepage değişikliği yok. Dokümantasyon yerel ve commit'sizdir.

## WinRE uygunluğu ve durulan gerçek sınır

Araç için amd64 Windows loader, console, NTFS/native kernel32/ntdll/advapi32 API'leri, staged Python3.12.14 + cryptography50.0.2/CFFI/UCRT/VC runtime, yeterli RAM/scratch ve RST/VMD görünürlüğü gerekir. Disk eşleme script'i ayrıca WMI, NetFX, Scripting, PowerShell ve StorageWMI ister. Bunlar uygulamaya yeni framework eklemek değildir; yalnız boot ortamının bileşenleridir.

Microsoft'un varsayılan WinRE listesi PowerShell/NetFX içermez. Bu nedenle mevcut cihazın özelleştirilmiş WIM'inde bunları görmeden Get-Disk/Get-Partition çalışır sayılmadı. Kaynak: [WinRE technical reference](https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/windows-recovery-environment--windows-re--technical-reference?view=windows-11), [WinPE OC dependency reference](https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/winpe-add-packages--optional-components-reference?view=windows-11).

R0'ın bildirdiği `\\?\GLOBALROOT\device\harddisk0\partition4\Recovery\WindowsRE\winre.wim` salt okunur erişim denemesi OS Access Denied verdi. Sandbox dışı CIM izni normal token'ı UAC yöneticisine dönüştürmez. ACL/ownership bypass ve recovery partition'a harf atama yapılmadı. ADK/medya varlığı varsayılmadı; indirme/kurulum yapılmadı.

`Inspect-WinRE.ps1` bu sınır için hazırdır: gerçek admin token yoksa **herhangi bir yazımdan önce** reddeder; orijinal WIM'i READ/share-read ile açar, yalnız yeni UUID TEMP dizinine CREATE_NEW kopyalar, kopyayı DISM `/ReadOnly` ile mount eder, package/driver/native DLL/PowerShell/Storage dosya varlığını raporlar, yalnız kendi mount'unu `/Discard` ile unmount eder. Kaynak WIM/BCD/WinRE configuration değişmez. DISM mount kaydı host üzerinde geçici yönetici işlemi olduğundan owner konsoluna bırakıldı. Kopya ve loglar korunur; hata/kalıcı mount açık raporlanır; genel cleanup yok.

Script SHA256 **ab97abce340b8f9b02174df83ca63fb444867dee0cf830829de83a0ccb09b785**. Parser PASS, normal-token refusal PASS; gerçek admin WIM incelemesi NOT_RUN. Statik bileşen varlığı loader PASS değildir. API-set DLL adları fiziksel dosya varlığına eşit sayılmaz; gerçek import/scrypt/AES/native/console smoke gerekir.

## Yeniden kullanılan paket ve yeni sentetik kapsam

TEMP ana paket:
`C:\Users\Metod\AppData\Local\Temp\ayas-offline-recovery-prep-20261010-8c21d4e9`

Yeni küçük uzantı: aynı kökün `r0-followup` dizini. İlk manifestteki **962 dosya / 55.178.642 byte**, yeniden kimlik bağlama amacıyla hash kontrolünden geçti: mismatch **0**. Eski testler yeniden çalıştırılmadı. Ek uzantı manifest SHA256 **4b1108819398bcb04a8becf12be24aee5ff8faf79e7f158be0d4748c7ee7d36e**; fixtures manifest dışındadır.

- Crypto değişmedi: `sealed_crypto.py` SHA256 `8ac7e8e0737c3eaae98d056d1a80c873919248b542c202c4dd7a475be5c83d27`. AYASB1V1, AES-256-GCM, scrypt N262144/r8/p1, salt16/nonce12/tag16 ve header AAD aynıdır. Encrypted TAR/private manifest; parola/anahtar CLI/env/log'a yazılmaz.
- F115 final SHA256 `399cc433276d28b23d37bdcdafbdb9494e8ec35cc338c90a0c998437e33ccafe` aynıdır. PS5/PS7 kabul edilmiş 30/30 ve izole inceleme kaynaklarına bağlı devralındı; aday yeniden yazılmadı/uygulanmadı.
- Intel RST VMD20.2.13.1038 exact INF `716ed3b9070460740da6dde3028e17c09ebbc1b1147ab6c3b2ca15b12391da3e`; CAT/SYS/diğer dosyalar eski manifestte doğrulandı. Driver yüklenmedi; offline disk görünürlüğü NOT_RUN.
- Yeni `cold_native.py`, mevcut bound adapter'ın yalnız C/D harf sınırını A–Z yapar; no-reparse/native ancestor/hardlink/read-only source kapıları korunur. `cold_synthetic_capture.py`, mevcut capture'a final committed ciphertext fiziksel readback ve aynı kilitli handle'dan tam tag authentication ekler. **Gerçek scope ilk kapıda REAL_COLD_ENTRY_HELD olarak reddedilir**; eski approval/token guard taşınmaz veya sökülmez.
- **23/23 yeni sentetik delta PASS**: identity/geometry/ambiguity/remap, final fiziksel SHA, exclusive handle write/delete denial, aynı handle auth→parse→synthetic filesystem restore, yedi hash/Unicode/empty directories, CREATE_NEW, final readback hatasında ABORT receipt, gerçek scope reddi ve sentetik ACL metadata okuması.
- İlk yeni koşu hardlink fixture oluştururken WinError5 ile durdu; ham başarısız hazırlık kaydı korunur. Bitmemiş suite, bu fixture açık NOT_RUN yapılarak tamamlandı. **Native hardlink/reparse delta ve full ACL/ADS restore NOT_RUN/NOT_QUALIFIED**; PASS sayısına eklenmedi. Eski 10 runtime/27 B1/Full166/TS/F115 suite'leri sebepsiz tekrarlanmadı.
- 46 staged amd64 PE native dosyanın statik import envanteri ve kullanılan altı Python extension'ın normal Windows import'u hazır. Bu, WinRE DLL çözümleme veya boot kanıtı değildir. Python AST ve PowerShell parser PASS. TypeScript/application source değişmedi; tsc/build tekrarlanmadı.

Owner recovery yöntemi korunur: güçlü benzersiz en az20 karakter, PC dışındaki güvenli kayıt, aynı kayıttan ikinci gizli console girişi, off-PC format/runtime/araç kaydı. Gerçek parolayla yeni test yapılmadı. `probe_hidden_console.py` yalnız disposable sentetik metin kullanır; görünür getpass fallback/redirected terminal reddedilir. RAM/pagefile/crash dump kapsamı eski sınırlaması aynıdır.

## Offline disk ve yedi P0 eşlemesi

| Rol | Disk UniqueId | GPT partition GUID | Offset / boyut | NTFS serial |
|---|---|---|---|---|
| Kaynak | eui.36483330583236140025384600000001 | 7603acda-c755-4dd7-956a-d791d067c522 | 344981504 /509097279488 | 1ab40931b40910c5 |
| Hedef | 50014EE26B68EAAB | 74c4c694-22e7-4c39-be34-5f10954060d0 | 135266304 /1000068874240 | b69c0e769c0e3183 |

Harf/disk numarası/etiket eşleme anahtarı değildir. `Collect-OfflineDiskMap.ps1` yalnız Get-Disk/Get-Partition/Get-Volume metadata'sı çıkarır; `check_disk_map.py` exact UniqueId+partition GUID+offset+size+NTFS eşleşmesini **tek sonuç** şartıyla seçer. Eksik/çoklu/yanlış/harfsiz/X: → STOP; otomatik assign/mount yok. Normal Windows metadata doğrulaması C ve D'yi buldu; bu gerçek offline PASS değildir.

Yedi kaynak namespace/type ve accepted suffix birebir korunur: external-runtime, legacy-projects, brain, runtime-authority, default-authority, env-secret(file), tunnel-secrets. Kökler kaynak rolünün o gün bulunan harfine remap edilir. Accepted root FileId128+volume serial baseline `SOURCE_ROOT_BASELINE.json`'da; hedef parent `AtolyeBak\g`, native identity `b69c0e769c0e3183:a8030000000006000000000000000000` ve owner/SYSTEM/Administrators exact ACL baseline'dadır. Hiçbir P0 payload açılmadı. Eski identity/ACL kayıtları gerçek yeni offline gözlem yerine geçmez.

Hazır `check_native_roots.py` yalnız MiniNT+X: boot OS kapısından sonra source roots/native ancestor metadata ve security descriptor okur; payload chunks/digest çağırmaz. Yedi FileId/NTFS serial, target parent kimliği ve exact ACL değişiminde STOP. Kaynak ACL metadata okunabilirliği payload erişimi/full ACL restore kanıtı değildir. Bu script gerçek offline ortamda NOT_RUN.

D ayrı fiziksel **iç** disktir; harici felaket-kurtarma kopyası değildir. B1 SOURCE_CHANGED generation/receipt ve tüm eski yedekler korunur; yeni target yaratılmadı. Yeni cold generation, boş alan/overhead/restore payı ve CREATE_NEW exact onayı gerçek ortamda ayrıca bağlanır; worker1/retry0/1MiBps ve kaynak değişiminde ABORT korunur.

## WinRE yetmezse: Microsoft kaynaklı en küçük WinPE yolu

Karar: bu WIM gerekli PS/Storage/loader bileşenlerinden eksikse **kurulu WinRE'yi değiştirmeden**, amd64 Microsoft ADK Deployment Tools + eşleşen WinPE add-on kullan. [Microsoft ADK](https://learn.microsoft.com/en-us/windows-hardware/get-started/adk-install) güncel 10.1.26100.9457 (Eylül2026) sürümünü bu OS için destekler. Installer'lar yalnız bu sayfanın resmi bağlantılarından alınır; Valid Microsoft Authenticode, sürüm, SHA256 ve applicable servicing patch makbuzu kaydedilir. [ADK servicing](https://learn.microsoft.com/en-us/windows-hardware/get-started/adk-servicing). Eski 2454'e ait MSP'yi yeni sürüme körlemesine uygulama; eşleşme yoksa STOP.

Gerekli OC sırası: **WMI → NetFX → Scripting → PowerShell → StorageWMI**, her biri aynı amd64 build ve ilgili en-us language CAB. DismCmdlets/HTA/SecureBootCmdlets/Setup/network stack ilavesi gerekmez. RST exact signed driver ve mevcut 55MB toolkit eklenir; yeni Python/npm/provider kurulumu yok. Disk/P0 capture startnet'te otomatik başlamaz.

Gelecekte owner'ın ayrı **medya hazırlama** onayı sonrası exact işlem, admin Deployment and Imaging Tools CMD'de aşağıdadır. İşlem şimdi YÜRÜTÜLMEDİ. Çalışma klasörü zaten varsa STOP; kaynak/target C,D disklere format/partition komutu yok:

```bat
copype amd64 "%TEMP%\AYAS_WinPE_R0"
Dism /Mount-Image /ImageFile:"%TEMP%\AYAS_WinPE_R0\media\sources\boot.wim" /Index:1 /MountDir:"%TEMP%\AYAS_WinPE_R0\mount"
set "AYAS_OC=C:\Program Files (x86)\Windows Kits\10\Assessment and Deployment Kit\Windows Preinstallation Environment\amd64\WinPE_OCs"
```

Her aşamada exit0 zorunlu; failure'da sonraki komut çalıştırılmaz. Beş CAB için aynı komut çiftini **belirtilen sırayla** uygula (`NAME` yerine sırasıyla WinPE-WMI, WinPE-NetFX, WinPE-Scripting, WinPE-PowerShell, WinPE-StorageWMI):

```bat
Dism /Image:"%TEMP%\AYAS_WinPE_R0\mount" /Add-Package /PackagePath:"%AYAS_OC%\NAME.cab"
Dism /Image:"%TEMP%\AYAS_WinPE_R0\mount" /Add-Package /PackagePath:"%AYAS_OC%\en-us\NAME_en-us.cab"
Dism /Image:"%TEMP%\AYAS_WinPE_R0\mount" /Add-Driver /Driver:"C:\Users\Metod\AppData\Local\Temp\ayas-offline-recovery-prep-20261010-8c21d4e9\driver-rst-vmd\iaStorVD.inf"
Dism /Image:"%TEMP%\AYAS_WinPE_R0\mount" /Set-ScratchSpace:512
```

Driver/scratch komutları yalnız bütün paketler başarıyla eklendikten sonra **bir kez** çalışır; `/ForceUnsigned` kullanılmaz. Aynı private mounted image içine `Windows\Temp\ayas-offline-recovery-prep-20261010-8c21d4e9\python`, `r0-followup`'ın sealed toolkit dosyaları ve driver dizini kopyalanır; synthetic fixtures/old output/approval dosyaları **hariç**. İlk/ek manifest hash'leriyle kopya doğrulanır. WIM'de toolkit böyle X: RAM'den çalışır; offline source Windows volume'una sentetik dosya yazılmaz. RST offline boot image'a yüklenir; installed Windows driver değiştirilmez. `startnet.cmd` yalnız mevcut WPEInit; capture/restore/network executor autorun eklenmez.

```bat
Dism /Unmount-Image /MountDir:"%TEMP%\AYAS_WinPE_R0\mount" /Commit
MakeWinPEMedia /ISO "%TEMP%\AYAS_WinPE_R0" "%TEMP%\AYAS_WinPE_R0\AYAS_R0.iso" /bootex
```

Bu ISO örneği **UEFI2023 CA/SVN firmware uyumluluğu owner cihazında doğrulanınca** kullanılabilir; şu an boot CA/medya UNBOUND. Secure Boot kapatma/DB değişikliği yok. `/bootex` uyumluluğu yoksa STOP; daha zayıf imza varsayımı yok. [Microsoft media creation](https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/winpe-create-usb-bootable-drive?view=windows-11). ISO oluşturmak USB'yi boot edilebilir yapmaz. ISO/WIM SHA kaydı ve gerçek owner'ın seçtiği ISO boot mekanizması veya harici USB'nin serial+UniqueId+size+erase onayı gerekir. USB mevcut varsayılmadı; **`/UFD`/format/medya yazımı için hazırmış gibi bir harf komutu verilmedi**. Gerçek medya hedefi bağlanmadan yazım planı HELD.

## Tek A–D bakım kararı — tamamı HELD

| Bölüm | Somut kapsam / kabul | Risk, durma ve dönüş |
|---|---|---|
| A — ortam/boot/fence | Önce WIM inspect; sonra exact environment/media SHA, owner boot yöntemi ve açık A yetkisi. Access disabled kalır. Observer logon fence yalnız ayrı A yetkisiyle; mevcut child-preservation araştırması tekrar edilmez. Yeni ortamda X: RAM'de staged import+scrypt/AES/native/hidden-console **sentetik** smoke ve offline disk/native metadata. | Boot/kullanılabilir console/RST/disk identity/ACL farkında STOP; P0 açılmaz. Task fence boot öncesi onaylı yapılmadıysa Windows logon'da writer yeniden başlayabilir; bakım READY sayılmaz. İlk boot testi B yetkisi vermez. |
| B — gerçek güvenli backup/restore | A environment kabulü, bütün production writer'ları offline, exact real cold entry/plan/source bundle SHA+fresh owner yetkisi, gizli off-PC key re-entry/recovery proof, encrypted new CREATE_NEW generation, alan payı, yedi P0 scope. Mevcut gerçek capture entry bugün **HELD/UNBOUND**. | Kaynak değişimi/error→ABORT/retry0/kısmi generation korunur. Tam committed SHA+GCM+operation receipts; BYTE_RESTORE_VERIFIED ve APPLICATION_STATE_VERIFIED **ayrı** gerekir. Full ACL/ADS/special type coverage ve verifier yan etkileri çözülmeden tüm P0 qualification iddiası yok. Plaintext P0 TEMP/D extract yok, otomatik replay/repair/restore yok. |
| C — F115 ve mevcut build dönüşü | B gerçek backup+restore/application kabulü ve owner rollback kabulü. Legacy Access wrapper/VBS/job yokluğu fresh PID+creation+parent/exe doğrulaması; final399cc433…ccafe yalnız `C:\Users\Metod\AppData\Local\AtolyeAyasAccess\ayas-access-observe-only.ps1` CREATE_NEW/no-overwrite. Normal owner token; mevcut exact artifact+dependency+node/Next/tunnel SHA paired. Manuel current-build `next start -p 3000`, tek tunnel, observe-only; eski paketin komutları korunur. | Build/install/deploy/auto retry ve unsafe Access enable yok. Foreign/çoklu listener/tunnel/changed paired artifact→HOLD. Sadece bu pencerede owner'ın başlattığı foreground süreçler normal kapatılır. Gerçek live rollback NOT_READY; veri üzerine otomatik restore yok. |
| D — PC/telefon/ayrı reboot | C kabulü sonrası owner fiziksel auth/Brain/memory/project/audit, Observer kontrollü resume, STT/mic/TTS/interrupt/lock/WiFi/reconnect. Reboot D içinde ayrıca açık exact yetki ister. | Gerçek cihaz/network/app yazımı/provider etkisi ayrı scope; paid/APPROVE/EXECUTE yok. Failure→HOLD. Yeni otomatik logon kurulumu veya yeni build yok; phone/reboot PASS uydurulmaz. |

Windows'a dönüş **PLAN_READY**: WinRE'de `Continue / Exit and continue Windows11`; WinPE'de owner'ın ayrı A yetkisi kapsamında WPEUtil Shutdown, medyayı çıkar ve mevcut **Windows Boot Manager** ile normal açılış. BIOS boot-order/BCD/SecureBoot ayarı değiştirilmez; repair/reset/reinstall seçilmez. Medya boot başarısızsa source disk üzerinde repair denenmez. Access ve Observer logon fence'leri bakım boyunca kapalı kalır; Windows açılması AYAS hizmet kabulü değildir. Önce owner normal session ve disk kimliği, sonra B sonuçları, sonra C; Observer restore enabled=true yalnız explicit resume'da. Güvensiz eski Access yeniden enable/run edilmez. Gerçek Windows return ve live rollback NOT_RUN.

Gerçek uygulama kabulünde schema/reference/journal/lease/reservation/approval-audit bağları ve dev/inode/principal imzaları ayrı salt okunur verifier ile sınanır; bayt restore ACTIVE authority demek değildir. F117 yan etkili inventory API'si körlemesine çağrılmaz. Eski SOURCE_CHANGED B1 ve sentetik PASS, CONSISTENT_BACKUP_PASS yerine geçmez.

## EXACT_NEXT_OWNER_ACTION — tek somut işlem

Owner mevcut Windows'ta **kendi gerçek yönetici PowerShell** konsolunda yalnız şu komutu çalıştırır:

```powershell
& 'C:\Users\Metod\AppData\Local\Temp\ayas-offline-recovery-prep-20261010-8c21d4e9\r0-followup\Inspect-WinRE.ps1'
```

Bu işlem R0 sorgusu/boot/medya yazımı/P0 okuması değildir. Çıktı `WINRE_COMPONENT_REPORT=...\WINRE_COMPONENTS.json` ve aynı dizinde packages/drivers/wim-info raporudur. WIM inspection raporu gelene kadar REQUIRED_MEDIA ve OFFLINE_ENVIRONMENT BLOCKED. Bileşenler yeterliyse sonraki karar yalnız environment/boot qualification A olur; eksikse yukarıdaki owner WinPE media hazırlığı bağlanır. **Şimdi STOP; yeni bakım/boot/commit/push yetkisi istenmedi.**

Diğer PC: TEMP paketinin varlığını varsayma. Bu kayıt/evidence hash'leri hazırlık kanıtıdır; real boot, owner key recovery, real restore/application consistency veya live F115 kapanışı değildir. Öncelik aynıdır: gerçek güvenli yedek → F115 → PC/telefon.
