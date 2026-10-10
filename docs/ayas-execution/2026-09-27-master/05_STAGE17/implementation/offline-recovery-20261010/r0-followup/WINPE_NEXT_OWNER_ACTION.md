# R0 devam — WinRE teşhisi ve tek WinPE medya hazırlama adımı

10 Ekim 2026. MASTER v1.1; **STOP / OFFLINE_ENVIRONMENT BLOCKED / MAINTENANCE NOT_READY**. Bu kayıt önceki paketin Inspect-WinRE next-action kısmını supersede eder. R0 ve owner'ın `No mounted images found` sonucu kabul edilmiştir; tekrar sorgulanmadı. Inspect-WinRE tekrar çalıştırılmadı.

İki mevcut TEMP logunda WIM bilgi okuma, read-only mount ve `/Discard` unmount başarılıdır. `Get-Packages` öncesi CBS servicing oturumu `CreateCbsSession(hr:0x8007007a)` ile açılamamış, ardından provider yüklenemediği için `get-packages / HRESULT80070057` hatası verilmiştir. `0x8007007a`, Win32 **122 / ERROR_INSUFFICIENT_BUFFER** anlamına gelir. [Microsoft error codes](https://learn.microsoft.com/en-us/windows/win32/debug/system-error-codes--0-499-).

Servicing `wcp.dll` Win32 yolu **260 karakter**, native log yolu264 karakterdir; kısa yol kullanma gerekçesi budur. Uzun yol/buffer ihtilafı **çıkarımdır**, hangi buffer'ın taştığı logdan kesinleşmez. Host DISM8972/Core9278 ile image9444/servicingstack9441 revision farkı görülür; bu fark tek başına uyumsuzluk kanıtı değildir. WinRE package listesi elde edilemediği için eksik OC veya WIM corruption iddiası yapılmaz. Mevcut inceleme toolchain'i nitelendirilemediğinden owner'ın devam kararı doğrultusunda **WinPE seçildi**; yeni WinRE denemesi yok.

## Seçilen en küçük desteklenen yol

Microsoft **amd64 ADK10.1.26100.9457 Deployment Tools + aynı sürüm WinPE add-on**; application için framework/provider kurulumu yok. Yalnız **WMI → NetFX → Scripting → PowerShell → StorageWMI**, aynı build amd64 en-us CAB'leri; exact staged signed RST/VMD driver; mevcut Python/crypto/F115 ve sealed followup tool files. [Official downloads](https://learn.microsoft.com/en-us/windows-hardware/get-started/adk-install), [OC dependencies](https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/winpe-add-packages--optional-components-reference?view=windows-11).

Medya hazırlığı artık önceki uzun `%TEMP%\AYAS_WinPE_R0` mount örneğini kullanmaz. Yeni UUID **`C:\Windows\Temp\AYASPE-xxxxxxxx\pe\mount`** kısa servicing yoludur. Önceden var olan workspace/ADK üzerine overwrite veya yeniden kurulum yok; varsa STOP. Copy/hash/CREATE_NEW staging mevcut kaynak manifestlerine bağlanır. İlk962dosya/55MB, cryptoSHA8ac7e8…3d27, F115SHA399cc433…ccafe ve23/23 sentetik kanıt korunur; test tekrarı yok.

## EXACT_NEXT_OWNER_ACTION

Owner kendi gerçek yönetici PowerShell konsolunda **yalnız şu komutu** çalıştırır:

```powershell
& 'C:\Users\Metod\AppData\Local\Temp\ayas-offline-recovery-prep-20261010-8c21d4e9\r0-followup\Prepare-WinPE-R0.ps1'
```

Bu komutun somut etkisi: Microsoft'un resmi sayfasındaki iki download linkinden installer'ları alır; Microsoft Authenticode Valid şartı ve SHA/version receipt; yalnız DeploymentTools ve WinPE silent `/norestart` kurulum; matching private new WinPE WIM+beş OC+RST+hash-bound toolkit;512MB scratch; **yalnız C:\Windows\Temp içinde ISO dosyası oluşturma**. İnternet indirme boyutu55MB değildir:55MB yeniden kullanılan araç paketidir; Microsoft kit download boyutu ayrıca belirlenir. Kurulum sistem dizinleri/ADK WIM mount sürücüsüne yazabilir; yalnız bu owner medya hazırlama işleminin parçasıdır. [Microsoft installation example](https://learn.microsoft.com/en-us/windows-hardware/get-started/adk-offline-install), [Microsoft installer script feature IDs](https://github.com/microsoft/MSLab/blob/master/Tools/2_ADK_Install.ps1), [Microsoft ISO creation](https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/winpe-create-usb-bootable-drive?view=windows-11).

Installer exit0 dışında (3010 reboot-required dahil) **STOP**, reboot yok. Her DISM/batch native exit kontrol edilir; failure'da yalnız kendi private mount'u discard edilir, log/kopya/partial ISO korunur, otomatik retry/delete yok. Yeni WIM'in package query'si eski WinRE incelemesini tekrarlamaz. Mevcut installed WinRE/BCD/SecureBoot/task/AYAS/Access/Observer/source/P0/D/old backups değişmez. `/UFD`, USB format veya USB yazım komutu yok; fiziksel medya varsayılmaz.

Çıktı: `OWNER_MEDIA_PREP_REPORT=C:\Windows\Temp\AYASPE-xxxxxxxx\OWNER_MEDIA_PREP.json`; başarıda ISO/WIM SHA, installer identity ve `ISO_CREATED_OFFLINE_NOT_QUALIFIED`. ISO adı `AYAS_R0_amd64_2023CA.iso`, `/bootex` imzalıdır. **Dosyanın oluşması firmware UEFI2023CA/SVN trust veya boot PASS değildir**; doğru fiziksel medya ve bu cihazın firmware kabulü sonraki owner kapısıdır. Güvenlik ayarını gevşetme, ISO'yu USB'ye yazma veya boot otomatik yapılmaz.

Prepared script SHA256: **8a3a2c9bd6537c9866c95415f2edee3db9a10fd051f5ac321fd080b46222928f**. Parser0errors. Gerçek download/signature/install/copyPE/OC/ISO çalışması **NOT_RUN**; bu script çalışan ortam sertifikası değildir. İlk/followup manifestlerini veya23/23 test receipt'ini değiştirmez; yeni script ilk followup manifestinin dışındadır ve bu kendi SHA kaydıyla bağlıdır.

| Teslim | Durum |
|---|---|
| OFFLINE_ENVIRONMENT | **BLOCKED** |
| REQUIRED_MEDIA | **WINPE** — henüz oluşturulmadı |
| COLD_BACKUP_TOOL | **QUALIFIED_SYNTHETIC**, önceki23/23 korunur; gerçek cold entry HELD |
| SAFE_WINDOWS_RETURN | **PLAN_READY**, gerçek dönüş NOT_RUN |
| F115_ISOLATED | **PRESERVED** |
| F115 / CONSISTENT_BACKUP_PASS / MAINTENANCE | **OPEN_IN_LIVE / FALSE / NOT_READY** |
| HOMEPAGE_OWNER_STOP | **PRESERVED** |

Boot, offline driver visibility, gizli owner recovery, byte/application restore ve Windows return/live rollback **NOT_RUN**. A–D bakım paketi HELD; önceki Windows dönüş/F115 acceptance kapıları aynıdır. ISO receipt sonrası aynı işi tekrarlamadan fiziksel medya/firmware/boot owner sınırında değerlendirilir. Yeni commit/push yok. **Tek owner medya hazırlama işlemini bildir ve STOP.**
