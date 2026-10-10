# AYAS — Planlı Offline Recovery karar paketi

10 Ekim 2026. **FAIL_CLOSED / STOP · MAINTENANCE NOT_READY · F115 OPEN_IN_LIVE · CONSISTENT_BACKUP_PASS FALSE.** Bu paket hazırlık ve gerçek blocker teslimidir; A–D canlı onayı istenebilecek uygulanabilir paket henüz değildir. Owner'ın bu görevi TEMP hazırlığı ve salt okunur incelemeyi yetkilendirir; shutdown, boot, task değişikliği, gerçek P0/secret okuma, D: yazımı, servis başlangıcı ve reboot yetkisi vermez.

## Doğrulanan başlangıç ve güvenli fark

Giriş HEAD/origin: `6c287aa82068c9a356b24df4b815429bd1b47cff`, temiz, pull güncel. Önceki checkpoint'in ab11e77 canlı bilgisi tarihsel kalır: kabul edilmiş daha yeni TEMP kanıtı ve bu oturumun ölçümü canlı disk build'ini **6c287aa / Next 16.2.10 / BUILD_ID Nn5jrdXSpO-UT9_4gc1-I** olarak bağlar. Stamp SHA256 `e5e06a36084aaeb021d6e0caffd5daa3f8972dfb9accbb8ffdbdcfdaa88993de`. Bu, authenticated runtime/işlev kabulü değildir. Lock 16.3.8 olması installed dependency kimliği yerine geçmez; tam artifact/dependency ağaçlarının yeni bayt taraması yapılmadı.

Taze metadata: Access PS14672, oluşturma `2026-10-09T11:23:01.098651+03:00`, parent VBS10016; Next PID26068; tunnel PID27628; Observer wrapper14680 ve node18916. Tek :3000 listener. Access görevi **Enabled=false / Running**; Observer **Enabled=true / Running**. Disable mevcut Access'i emekliye ayırmış değildir. Süreçlerin command line SHA'ları `PUBLIC_EVIDENCE.json` içinde; uygulama sırasında PID+creation+exe+parent+command line yeniden karşılaştırılır. Tarihsel PID'ler stop hedefi değildir. Observer'ın işlevsel davranışı bu oturumda test edilmedi.

Final F115 `ayas-access-observe-only.ps1`, SHA256 **399cc433276d28b23d37bdcdafbdb9494e8ec35cc338c90a0c998437e33ccafe**, 18.226 byte. Baseline Access SHA256 `22dda6c62801310daaa6a690b302afbf501af1b6668d859d5603ed7ae69ad1c1`. Kabul edilmiş PS5/PS7 30/30 ve bağımsız PASS_WITH_LIVE_LIMITATIONS kanıtları korunur; yeniden koşulmadı ve canlıya taşınmış sayılmaz. Güvensiz eski adaylar kullanılmadı.

B0 PASS; B1 SOURCE_CHANGED / ABORT; VSS NOT_QUALIFIED / CLOSED; CHILD_PRESERVATION ve GLOBAL_WRITER_QUIESCENCE NOT_QUALIFIED başlangıçları korunur. VSS, canlı B1 ve Scheduler child-preservation döngüleri açılmadı. Homepage ve uygulama kaynağı değişmedi.

## En küçük yöntem ve yeterlilik sınırı

Öncelik mevcut **Windows RE** ortamının yeterliliğini doğrulamaktır. Windows 11 Pro 26100; ReAgent.xml kurtarma konumunu `\Recovery\WindowsRE`, offset `509442260992` ve BCD id `{43af6ccb-ccbf-11ef-817f-4cd7179e591d}` olarak kaydeder. İki recovery partition vardır. XML ve partition varlığı boot edilebilirlik, doğru WIM veya Windows'a dönüş kanıtı değildir. `reagentc /info` exit5 ve `bcdedit /enum` exit1 gerçek yönetici token'ı olmadığı için reddedildi. Sandbox dışı çalıştırma UAC/elevated token sağlamadı; ACL/token bypass yapılmadı. BitLocker sorgusu access denied; disk unlock ve owner'ın BitLocker kurtarma yöntemi **NOT_QUALIFIED**. AYAS backup parolası BitLocker disk-unlock anahtarı yerine geçmez.

ADK, kontrol edilen standart kurulum yolunda yok. Bilinen güvenilir harici WinPE/USB/ISO kimliği henüz verilmedi. WinRE yetersizse alternatif, owner'ın seçtiği Microsoft kaynaklı amd64 WinPE medyasıdır; medya yazma, ADK indirme/kurma veya boot yapılandırması yapılmadı. Windows PE'de PowerShell desteği optional component/dependency gerektirir; mevcut WinRE'nin Python, cryptography veya bu native adapter'ı çalıştırdığı varsayılmaz. [Microsoft WinPE optional components](https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/winpe-add-packages--optional-components-reference?view=windows-11), [REAgentC seçenekleri](https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/reagentc-command-line-options?view=windows-11).

**STOP:** Offline boot ve Windows'a güvenli dönüş doğrulanamadı. Bu kapı geçmeden boot/shutdown veya veri backup onayı talep edilmez; yeni büyük geliştirme başlatılmaz.

## TEMP staging — tamamlanan dar hazırlık

Exact staging: `C:\Users\Metod\AppData\Local\Temp\ayas-offline-recovery-prep-20261010-8c21d4e9`.

- Mevcut Python **3.12.14**, stdlib/native DLL'ler, cryptography **50.0.2** ve gerekli bağımlılıkların kopyası; yeni install yok.
- Aynı AES-256-GCM+scrypt çekirdeği `sealed_crypto.py`, SHA256 `8ac7e8e0737c3eaae98d056d1a80c873919248b542c202c4dd7a475be5c83d27`. N=262144/r=8/p=1; salt16/nonce12/tag16; header authenticated. Format değiştirilmedi.
- Kurulu Intel RST VMD **20.2.13.1038** paketinin `oem246.inf` ile SHA eşleşen kopyası. `iaStorVD.inf` SHA256 `716ed3b9070460740da6dde3028e17c09ebbc1b1147ab6c3b2ca15b12391da3e`; katalog ve SYS hash'leri staging manifestinde. Driver yüklenmedi; offline disk görünürlüğü NOT_RUN.
- Final F115 aynı baytlarla saklandı; canonical dışı canlı hedefe yazılmadı.
- `synthetic_runtime_probe.py`: izole Python (`-I -B`) ile normal Windows'ta **10/10 PASS**. Yeni staging'de committed ciphertext fiziksel readback + tam authentication, yedi sentetik regular file için source/backup/RAM-restore count/type/size/SHA, yanlış key/tag/truncation reddi; sürücü harfi değişiminde sentetik volume matching ve yanlış/çoklu/eksik kimlik reddi. Gerçek filesystem restore, boş dizin/special type/ACL coverage, gerçek owner parolası veya offline ortam testi değildir. Rastgele sentetik key yalnız RAM'de; disk çıktısı yalnız sentetik ciphertext ve genel rapordur.

962 dosya / 55.178.642 byte staging manifesti SHA256 `0c8e5d35c48d790ad94f990f2491fd4dc1c8698f5adf69932b16589e174a9dc8`. Manifest bu snapshot'a bağlıdır; sonradan eklenen dosya ve klasörler kapsam dışındadır. Staging mutable TEMP alanıdır, kalıcı bağımsız backup veya hostile same-SID izolasyonu değildir. Başka PC'de bu yollar/kopyalar var sayılmaz; runtime/medya/token yeniden nitelendirilir.

**Production cold entry hazırlanmadı:** Eski B1 girişini çağırmak, eski approval dosyasını taşımak veya normal-token guard'ını kaldırmak offline yöntem değildir. WinPE/SYSTEM token'ı, drive-letter remap, source ACL ve owner-controlled gizli console girişinin gerçek ortamda yeterliliği önce doğrulanmalıdır. Sonra küçük identity-bound cold wrapper'ın exact digest'i incelenir; mevcut capture/change/no-reparse/ACL kapıları korunur. Crypto'nun iki-pass authenticate→parse yolunda aynı immutable/exclusive ciphertext handle'ı zorunludur; sentetik Python `open('rb')` üretim kilitleme kanıtı değildir.

## Disk/volume ve yedi namespace

| Rol | Fiziksel disk UniqueId | GPT partition GUID | Offset / partition boyutu |
|---|---|---|---|
| Kaynak C: NVMe | eui.36483330583236140025384600000001 | 7603acda-c755-4dd7-956a-d791d067c522 | 344981504 / 509097279488 |
| Hedef D: SATA | 50014EE26B68EAAB | 74c4c694-22e7-4c39-be34-5f10954060d0 | 135266304 / 1000068874240 |

İkisi NTFS, **farklı fiziksel iç disklerdir**. D: harici/offsite felaket kurtarma yedeği değildir. Harici hedef kimliği yok; ikinci encrypted kopya yapılmadı. Gözlem anında C: ~135 GB, D: ~966 GB boş; offline işlem günü alan ve allocation/overhead/restore payı yeniden ölçülür. Maksimum archive boyutu ve kaynak büyümesi eski tahminden kopyalanıp yeterli sayılmaz.

Offline harfler ve disk numaraları değişebilir. Eşleme disk UniqueId + GPT GUID + offset/size + NTFS volume serial + native root FileId ve no-reparse ancestor zincirine bağlanır. Aynı harf/etiket veya path string yeterli değildir. Gerçek offline mount/ACL/native identity kontrolü NOT_RUN. Read-only kaynak handle'ları kullanılır; offline Windows volume'u tool tarafından mutasyona açılmaz. Offline root/path remap eski exact kaynakların göreli suffix'lerini korur; namespace/type değiştirilmez.

Yollar, accepted `OWNER_SOURCE_MAP.json` kaydından devralındı; yeniden tahmin edilmedi. Taze native metadata **7/7 kök identity aynı**, payload okuma sıfır:

| Namespace | Tür | Normal Windows exact kaynak |
|---|---|---|
| external-runtime | directory | C:\Users\Metod\Desktop\solid\SW2020.x64.SP4.0\Program\Atölye\runtime\AtolyeRuntime |
| legacy-projects | directory | C:\Users\Metod\Desktop\solid\SW2020.x64.SP4.0\Program\Atölye\atolye-v2\data\projects |
| brain | directory | C:\Users\Metod\Desktop\solid\SW2020.x64.SP4.0\Program\Atölye\atolye-v2\data\brain |
| runtime-authority | directory | C:\Users\Metod\Desktop\solid\SW2020.x64.SP4.0\Program\Atölye\runtime\AtolyeAuthority |
| default-authority | directory | C:\Users\Metod\AppData\Local\Temp\atolye-runtime-authority-v1 |
| env-secret | file | C:\Users\Metod\Desktop\solid\SW2020.x64.SP4.0\Program\Atölye\atolye-v2\.env.local |
| tunnel-secrets | directory | C:\Users\Metod\.cloudflared |

TEMP default-authority korunacak; TEMP temizliği yapılmaz. Gerçek backup private manifesti, secret/parola içerikleri sohbet/log/CLI'ye çıkarılmaz. Kaynak identity metadata eşitliği payload, application state veya bütün ACL yeterliliği kanıtı değildir.

Yeni cold hedef önerisi `D:\AtolyeBak\g\20261010-cold-6c287aa-8c21d4e9` gözlemde yok; oluşturulmadı. Parent ACL yalnız owner/SYSTEM/Administrators allow kayıtları içerir; offline worker'ın erişimi, hedefin ancestor kimliği ve CREATE_NEW kabulü ayrıca doğrulanır. Yeni generation, worker=1, retry=0, kaynak değişiminde ABORT, kontrollü I/O. Plaintext payload staging yok.

Korunan SOURCE_CHANGED çıktısı `D:\AtolyeBak\g\20261010-b1-6c287aa-827d14c9bf`: `sealed-backup.bin` **1.231.697.444 byte**, lastWrite `2026-10-10T00:25:01.0905938Z`; receipt **81 byte**, lastWrite `2026-10-10T00:25:01.0976248Z`. Metadata önceki kanıtla eşleşir; ciphertext açılmadı/hashlenmedi/decrypt edilmedi, overwrite/retry/silme yok. Geçerli yedek değildir. Diğer generation'lar korunur.

## Tek koordineli kararın ayrık yetki bölümleri — şu anda hepsi HELD

| Bölüm | Exact işlemler / hedef / SHA | Risk ve rollback | Ön koşul / STOP |
|---|---|---|---|
| A — shutdown/offline boot/task fence | Gelecek dar kapsamda Access disabled tutulur; Observer geçici logon fence gerekiyorsa `Disable-ScheduledTask -TaskName 'AYAS Autonomy Observer'`. Bu çalışan wrapper'ı durdurmaz. Owner işi bitirip pencerede `shutdown.exe /s /t 0` (force yok); kimliği doğrulanmış bağımsız medyaya tek seferlik firmware boot. Medya/WIM SHA ve exact boot adımı **UNBOUND**, şimdi yürütülemez. | Graceful Windows shutdown çoklu store tutarlılığını garanti etmez; RAM/in-flight iş kalıntısı olabilir. Dönüşte aynı mevcut Windows Boot Manager, boot config değişikliği yok. Observer önceki Enabled=true durumu yalnız onaylı resume sırasında geri alınır; Access enable edilmez. | Gerçek medya trust/SHA, disk unlock, sürücü/sentetik araç testi ve Windows'a dönüş kanıtı yok → STOP. Boot/driver/task değişikliği kendi açık A yetkisini gerektirir. Canlı Scheduler/child testi tekrarlanmaz. |
| B — yedi P0/secret kaynak cold backup + restore kabulü | Yukarıdaki exact namespace/type map ve yeni generation. AES-256-GCM+scrypt aynı core SHA; production cold wrapper/command SHA **UNBOUND**. Eski `owner_capture.py` veya B1 komutu çağrılmaz. | Yanlış volume/key/ACL; disk state crash kalıntıları; secret exposure. Hata → ABORT, kısmi yeni set korunur, retry=0. Rollback burada eski veriye yazmak değildir. | A qualification + bağımsız ortam kimliği; bütün üretim writer'ları yok; kaynak/target native identity ve ACL; gerçek hidden owner console/key recovery; yeterli alan; yeni exact wrapper/approval bundle. Her eksikte STOP, P0 içerik açılmaz. |
| C — F115 live uygulama ve owner manual servis başlangıcı | Final SHA399cc433…ccafe yalnız `C:\Users\Metod\AppData\Local\AtolyeAyasAccess\ayas-access-observe-only.ps1` hedefinde CREATE_NEW/no-overwrite ile, gelecekte açık C yetkisiyle. Node SHA9a4eb5…a52de + Next CLI SHAbb2459…333a ile aşağıdaki mevcut-build başlangıç komutları. | Uygulama startup/status yazımı ve canlı network oluşur. Unsafe Access/VBS geri etkinleştirilmez; build/install/auto retry yok. Sorunda yalnız owner'ın bu pencerede başlattığı, kimliği doğrulanmış foreground süreç için normal kapanış; ingress/admission HOLD. Veri restore otomatik değil. | BYTE_RESTORE_VERIFIED **ve** APPLICATION_STATE_VERIFIED + rollback kabulü; eski Access process/task/job artık yok; paired artifact tam doğrulaması; normal owner token; foreign/çoklu listener-tunnel yok. Güvenlik/yetki/kimlik farkında HOLD. |
| D — PC/telefon ve ayrı reboot kabulü | Owner physical PC/PWA, auth/Brain/memory/project/audit/Observer, desteklenen STT/mic/TTS, ağ kesilip dönüş; ayrı reboot için `shutdown.exe /r /t 0` yalnız ayrıca D-reboot yetkisiyle. | Gerçek cihaz/network kesintisi, yazan etkileşim/provider çağrıları; paid/execute/approval çağrıları kapsam dışı kalır. Hata → HOLD ve onaylı rollback değerlendirmesi, otomatik build yok. | C PASS ve açık D cihaz kapsamı. Reboot ayrıca onaylanmadan yapılmaz. Fiziksel cihaz testi NOT_RUN. Otomatik logon startup kurulmadı/test edilmedi → NOT_READY. |

Koşullu C owner-terminal komutları (şimdi çalıştırılmadı; guard yerine geçmez):

```powershell
$repoPath = 'C:\Users\Metod\Desktop\solid\SW2020.x64.SP4.0\Program\Atölye\atolye-v2'
Set-Location -LiteralPath $repoPath
& 'C:\Program Files\nodejs\node.exe' (Join-Path $repoPath 'node_modules\next\dist\bin\next') start -p 3000
# İkinci owner terminali, origin/auth kabulü ve mevcut tunnel yokluğu sonrası; tek yeni tunnel koşulu:
& 'C:\Program Files (x86)\cloudflared\cloudflared.exe' tunnel --config 'C:\Users\Metod\.cloudflared\config.yml' run ayas
# Üçüncü owner terminali, exact SHA + normal token + legacy absence sonrası:
& 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -NoProfile -File 'C:\Users\Metod\AppData\Local\AtolyeAyasAccess\ayas-access-observe-only.ps1' -RepoRoot $repoPath -Continuous
```

Cloudflared executable SHA256 `83e726ed18ea78c5ad5213c4c3a3a27051393950d2bc8ed4de69bec12d14eaae`. Gizli config/credential geçerliliği veya bütün source/env/registry/loader kimliği bu basit komutlarla sertifikalanmaz. Mevcut manual startup/runbook sınırları korunur. Yeni otomatik logon task'ı önerilmedi. Docs-only oturum commit'i canlı build stamp'ini değiştirmez; mevcut build'i yeniden build etmeye gerekçe değildir. Restart öncesi artifact baseline/tam inventory ve source eşdeğerliği fresh doğrulanır.

## Gerçek restore ve rollback kabul kapıları

1. Aynı kilitli/kimliği doğrulanmış ciphertext handle'ından tam GCM authentication; son tag dahil fiziksel SHA readback; complete operation+generation receipts. Eksik receipt/partial authenticatable çıktı başarı değildir.
2. Source→archive→restored dosya/dizin count, type, size, SHA ve tam namespace coverage; ekstra/missing/reparse/hardlink/ACL ihtilafları açık. Approved encrypted destination/korumalı bağımsız ortam dışına plaintext extract yok. Secret/private manifest yalnız RAM/şifreli alan; output'e dökülmez.
3. **BYTE_RESTORE_VERIFIED** ayrı; schema/Project manifest→asset, Brain/memory parse ve refs, runtime/default authority revisions/marker/binding, JSONL/journal continuity, pending/running jobs, leases/reservations, approval→audit/execution bağlantıları ayrıca salt okunur doğrulanır. Unknown/truncated/missing ref veya unresolved transaction → **APPLICATION_STATE_VERIFIED NOT_QUALIFIED**, fail listesi korunur; otomatik cancel/replay/repair yok.
4. Yer/path/principal/dev/inode değişimiyle imzalı authority/asset binding bozulabilir. Bayt eşitliği ACTIVE authority kabulü değildir; güvenlik katmanı gevşetilmez. Gerçek orijinal root/binding/startup kimliklerini restore edebilme ayrıca gerekir.
5. İzole restore'da canlı executor, Observer, named Cloudflare tunnel, production session/provider/approval replay başlatılmaz. Read-only verifier'ın marker/yazma yan etkileri kod düzeyinde incelenmeden mevcut runtime:backup inventory çağrılmaz (F117).
6. Mevcut D B13 artifact kopyası ve önceki sentetik config rollback kanıtı korunur; yedi gerçek P0/secret current rollback yerine geçmez. Veri restore orijinal store üzerine otomatik yazılmaz. Başarı sonrası manuel current-build startup güvenli servis geri dönüş yolu olabilir; gerçek live rollback bugün NOT_READY.

## Açık blocker'lar ve tek sonraki owner girdisi

**OFFLINE_ENVIRONMENT_UNQUALIFIED** ana blocker: WinRE/BCD/read-only admin identity ve BitLocker bilgisi; güvenilir boot medya kimliği; gerçek bağımsız ortamda staged Python/crypto/driver/hidden-console/same-key deneyimi; güvenli Windows'a dönüş. Ayrıca cold entry exact wrapper/normal token yetki uyumu, real key recovery, application verifier qualification, restore ve live rollback henüz yok.

Owner'ın mevcut Windows'ta kendi **yönetici PowerShell** konsolunda yalnız şu metadata sorgularını çalıştırması bu engelin en küçük bilgi adımıdır; reboot, unlock, protector export, enable/setreimage/boottore veya görev değişikliği değildir:

```powershell
reagentc.exe /info
bcdedit.exe /enum '{current}'
manage-bde.exe -status C:
manage-bde.exe -status D:
```

Çıktıda recovery password/private key veya protector export istenmez. Owner mevcut güvenilir USB/ISO konumunu bildirir; yoksa bu bilgi kaydedilir ve medya hazırlama için ayrı exact hedef kararı gerekir. R0 metadata gelmesi boot/B/C/D izni sayılmaz. R0 sonuçları ve medya kimliği hazır olduğunda yalnız mevcut-environment qualification kapısı devam eder; VSS/B1/Scheduler döngüsüne dönülmez. Uygulanabilir A–D paketi ancak kapılar gerçek kanıtla kapanınca tek seferde sunulur.

## Teslim durumu

| Alan | Sonuç |
|---|---|
| DELIVERED | Taze host/root kimlikleri, 55 MB TEMP runtime/crypto/driver/F115 staging, 10 sentetik kontrol ve tek HELD karar paketi. |
| PRESERVED | Yedi kök kimliği, önceki yedekler/kısmi B1 metadata, mevcut build/servis/task ayarları, homepage; gerçek payload bütünlüğü yeniden sertifikalanmadı. |
| TESTED | Yeni staged-runtime 10/10; taze 7/7 native root identity; TypeScript noEmit exit0; önceki kabul edilmiş testler kaynaklarına bağlı devralındı. |
| NOT_TESTED | WinRE/boot/return/driver load/BitLocker unlock/owner key; gerçek decrypt/restore/application consistency/live restart/rollback/logon ve physical PC/phone. |
| OPEN_BLOCKERS | OFFLINE_ENVIRONMENT_UNQUALIFIED ve yukarıdaki gerçek key/cold-entry/application/rollback kapıları. |
| BACKUP_AND_RESTORE | Real BYTE_RESTORE_VERIFIED NOT_RUN; APPLICATION_STATE_VERIFIED NOT_RUN; CONSISTENT_BACKUP_PASS FALSE. |
| F115_STATUS | ISOLATED PASS_WITH_LIVE_LIMITATIONS; OPEN_IN_LIVE; eski supervisor mevcut. |
| PC_PHONE_ACCEPTANCE | Yeni görev kabulü PC NOT_RUN / PHONE NOT_RUN; Cloudflare bağlantısı bu oturumda probe edilmedi. |
| ROLLBACK | Önceki artifact/config kanıtı korunur; DATA_AND_LIVE_ROLLBACK NOT_READY; unsafe Access enable/run yolu yok. |
| OWNER_ACTION | Tek R0 admin metadata + güvenilir kurtarma medya kimliği; canlı bakım onayı henüz istenmez. |
| NEXT | R0/media bilgisiyle yalnız offline environment qualification; STOP sınırı korunur. |

Graphify giriş HEAD güncel: 19.238 node / 53.302 edge, graph SHA256 `35c3009a00ddc131a3390748bd686d64521f87c9e12e10c55a037abe2b4d550c`; PowerShell/VBS/boot/task/native driver alanları graph dışında. PARTIAL10/semantic PENDING borcu kapanmaz. Uygulama kaynağı değişmediği için Full166/build/F115 matrix tekrarlanmadı. Bağımsız inceleme ve yayın makbuzu `REVIEW_AND_VALIDATION.json` içindedir; Git yayınlanması canlı deployment/yetki değildir.
