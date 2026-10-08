# Karar 3 — onay oturumu / owner provenance: en dar düzeltme

**Durum: TEMP'TE UYGULANDI VE TEST EDİLDİ / GERÇEK KAYNAĞA UYGULANMADI / OWNER İNCELEMESİ BEKLİYOR.** Owner talimatı gereği gerçek kaynakta değişiklikten önce kapsam ve etki burada bildiriliyor.

- İncelenecek nesne: [K3_OWNER_ADMISSION_CANDIDATE_bc9f5fd.patch](K3_OWNER_ADMISSION_CANDIDATE_bc9f5fd.patch), SHA-256 `5deff0b53bed7e31292efff85493633bf330b30c24b12680ebfa2131cc341231`.
- Temel: `5e1b0c5`. TEMP commit `bc9f5fd`, ağaç `bf8ecef1…`.
- Makine kanıtı: [TEMP_VALIDATION.json](TEMP_VALIDATION.json).

## Sorun (kaynakta doğrulandı)

1. `requireBrainSession()` çerezi doğrular ama hiçbir şey döndürmez. Karar kaydında kim/hangi oturum alanı yoktur. Bugünkü 53 kararın hiçbirinde yok.
2. Eski `decideAyasApproval` eylemi istemcinin yazdığı `reason` metnini kaydeder. Resume işçisi `owner-approved:` önekini makineyle eşleştirir. İstemci bu öneki yazarsa eski yoldan verilen bir APPROVE, owner-approval modelinden gelmiş gibi görünür.
   - Etkisi: `AYAS_AUTONOMOUS_EXECUTION_ENABLED=1` iken elle çalıştırılan resume script'i böyle bir APPROVE'u commit/push edebilirdi.
   - Yine geçerli bir owner oturumu gerekir. Asıl sorun bir provenance karışıklığıdır.
3. Yerel geliştirme modunda (`AYAS_ACCESS_KEY` yok, `NODE_ENV≠production`) oturum kapısı tamamen açıktır. Onay eylemleri de buna dahildir.

## Tasarım — ikinci bir onay sistemi yok

Mevcut zincir aynen kalır: oturum çerezi (`accessGate`) → server action → store → hash/firewall kapıları. Eklenen tek şey **admission kaydıdır**. Bu kayıt, sunucunun doğruladığı oturumun karara iliştirilmiş kaydıdır.

| Alan | Kaynağı | Not |
|---|---|---|
| `principal: "OWNER"` | Erişim kapısının kabul ettiği tek kimlik | Tek-sahipli stüdyo. Kişi adı değildir; istemci bunu gönderemez |
| `authMethod` | Sabit `AYAS_OWNER_SESSION_HMAC_V1` | |
| `sessionRef` | Doğrulanmış çerezin anahtarlı HMAC özeti | Oturumu tanımlar. Kimlik bilgisi değildir, çereze geri çevrilemez. Çerez imzasıyla çakışamaz (alan ayrımı) |
| `sessionIssuedAt` / `sessionExpiresAt` | Doğrulanmış çerez içeriği | |
| `verifiedAt` | Sunucu saati | |
| `subject` | Sunucudaki öneri/batch durumu | Tam `proposalId`/`batchId` + hash + karar (APPROVE/REJECT/LATER/EXECUTE) |
| `actionRef` | Her eylem çağrısında sunucunun ürettiği UUID | Store bunu yalnız bir kez kabul eder |
| `seal` | Yukarıdaki her alanın erişim anahtarıyla HMAC'i | Sonradan anahtarla doğrulanabilir. Anahtarsız bir JSON düzenlemesi seal'i bozar |

### Fail-closed kurallar

- Onay yapabilen 5 eylemin hepsi önce mevcut `requireBrainSession()`'ı çağırır (değişmedi). Ardından kendi admission'ını türetir:
  - `decideAyasApproval`
  - `executeAyasApprovedProposal` (YÜRÜT)
  - `batchOnaylaVeUygula`
  - `proposalOnaylaVeUygula`
  - `ayasOwnerApprovalDecision`
- Enforced olmayan kapı (yerel dev dahil) veya doğrulanmayan çerez → admission yok → karar yok. Yalnız onay eylemleri için; okuma eylemleri değişmedi.
- Bu eylemler store'u `requireOwnerAdmission: true` ile açar. Admission olmadan APPROVE/REJECT/LATER reddedilir ve hiçbir şey yazılmaz.
- Store yazmadan önce şunları kontrol eder ve uymayanı reddeder:
  - admission tam bu öneri/hash/kararı adlandırıyor mu;
  - 5 dakikadan eski veya gelecek tarihli mi;
  - aynı `actionRef` daha önce kullanılmış mı.
- YÜRÜT, ancak yürüteceği APPROVE'un kendisi bu öneriye bağlı geçerli bir admission taşıyorsa çalışır.
- Resume işçisi `owner-approved:` önekinin yanında admission da ister. Atfedilmemiş bir APPROVE oradan asla yayınlanmaz.
- İstemcinin yazdığı gerekçe `owner-approved:` / `owner-rejected:` / `ayas-internal:` ile başlayamaz. Kontrol büyük/küçük harf ve Unicode benzerleri dahil yapılır (NFKC).
- Geçmiş kayıtlara hiçbir şey eklenmez. Admission'sız eski kararlar admission'sız kalır. Dokuz tarihsel kayda sahte kimlik yazılmaz.

## Kapsam — 10 dosya

| Dosya | Değişiklik |
|---|---|
| `src/lib/auth/accessGate.ts` | +2 yeni fonksiyon: `readVerifiedSessionClaims`, `keyedAuditDigest`. `verifySession`/`issueSession`/`resolveAccessGate` değişmedi |
| `src/lib/brain/autonomy/AyasOwnerApprovalAdmission.ts` (yeni) | Tipler, sunucu tarafı türetme, seal doğrulama, anahtarsız bağ kontrolü, ayrılmış önek kontrolü |
| `AyasApprovalInboxStore.ts`, `AyasMicroBatch.ts` | `decide()` için isteğe bağlı `ownerAdmission` parametresi + kayıt alanı + `requireOwnerAdmission` seçeneği. Yeni hata kodu yok |
| `AyasProposalApprovalService.ts`, `AyasMicroBatchApprovalService.ts`, `AyasAutonomousExecutionGate.ts` | `deps.ownerAdmission` karar çağrısına iletilir (5 çağrı) |
| `AyasOwnerApprovalResume.ts` | Uygunluk için admission şartı |
| `app/brain/actions.ts` | `requireOwnerApprovalAdmission` + 5 eylemde kullanım + ayrılmış önek reddi |
| `scripts/smoke-ayas-owner-approval-admission.ts` (yeni) | 25 senaryo |

Eval manifest'i, golden vault, korunan grader ve pinli smoke'lar değişmedi. Yeni smoke manifest'te değil (manifestin "Other AYAS suites" kapsamı). İstenirse ayrı bir pakette manifest'e eklenebilir; exact12 patch'ine karışmaması için şimdi eklenmedi.

## Etki

| Nerede | Etki |
|---|---|
| Canlı Next (`e974614`) | **Deploy edilene kadar hiçbir etki yok**; sunucu kendi build'ini sunar |
| Autonomy daemon / discovery | Davranış aynı. Kendi iç REJECT/LATER kararlarını admission'sız store ile yazar; resume'u çalıştırmaz |
| Deploy sonrası Gelişim Merkezi | Her onay tıklaması admission ile kaydedilir. Oturum doğrulanamazsa tıklama `OWNER_ADMISSION_REQUIRED` / `OWNER_ADMISSION_GATE_UNAVAILABLE` koduyla reddedilir. Bu kodların Türkçe etiketi yok; ham kod görünür (kozmetik, ayrı iş) |
| Bugün APPROVED bekleyen öneri | 0. Resume/YÜRÜT değişikliği bekleyen bir işi kilitlemez |
| Yerel dev | Erişim anahtarı tanımlanmadan onay verilemez (bilinçli fail-closed) |

## Gerçek testler (hepsi TEMP)

- **TypeScript:** exit 0.
- **Yeni smoke:** `PASS (25 scenarios)`. Kapsadığı vakalar:
  - geçerli oturum → tam, mühürlü admission;
  - çerez/anahtar sızmaz;
  - dev / misconfigured kapı → red;
  - eksik, bozuk, yabancı, süresi dolmuş, gelecekteki ve kurcalanmış çerez → red;
  - herhangi bir alan değişirse seal düşer;
  - istemci biçimli sahte admission → MALFORMED;
  - sıkı store admission'sız yazmaz;
  - başka öneri, karar veya hash → SUBJECT_MISMATCH;
  - **replay** → ACTION_REF_REUSED;
  - bayat veya gelecek admission → red;
  - varsayılan store eski davranışı korur;
  - geçmiş kayıtlar bayt olarak aynı kalır;
  - micro-batch aynı kurallarla;
  - gate, tek-tık yayın ve resume yolları;
  - ayrılmış önek (NFKC dahil);
  - gerçek `requireOwnerApprovalAdmission` fonksiyonu VM'de;
  - 5 eylemin statik yapısı.
- **Mutasyon denetimi: 22/22 öldürüldü.** Her koruma tek tek bozuldu ve smoke her seferinde düştü. Bozulan korumalar: sıkı kontrol, bağ, konu, replay, tazelik, gelecek, kapı modu, oturum doğrulama, seal, şekil, resume filtresi, NFKC, eylem katmanının 6 noktası, servis ve gate iletimi. Baytlar her mutasyondan sonra geri yüklendi ve hash'le doğrulandı.
- **Full166:** birleşik aday (K3 + exact12) üzerinde, sonuçlar [TEMP_VALIDATION.json](TEMP_VALIDATION.json) ve [K1_EXACT12_CONDITIONS.md](K1_EXACT12_CONDITIONS.md) içinde.

## Ne kanıtlanmadı / sınırlar

- Tek-sahipli bir sistemde "owner kimliği" = owner parolasıyla açılmış doğrulanmış oturumdur. Parolayı bilen biri owner olarak görünür. Kişi bazlı hesap yoktur; bu tasarım onu eklemez.
- Store'u sıkı moda geçirmek çağırana bağlıdır. Owner eylemleri sıkı açar; statik test bunu kilitler. Yerel bir script dosyayı doğrudan düzenleyebilir; bu, yerel kabuk erişimi olan herkes için zaten geçerlidir. Seal, böyle bir düzenlemeyi anahtarla tespit edilebilir kılar.
- Hosted CI'da ve gerçek tarayıcıda koşmadı. Canlıda hiçbir şey değişmedi.

## Owner kararı

**ONAY** verilirse aynı baytlar gerçek branch'e tek yerel commit olarak uygulanır. Sıra şöyledir (gerekçe: [K1_EXACT12_CONDITIONS.md](K1_EXACT12_CONDITIONS.md)):

1. K3 uygulanır.
2. Exact12 aynı patch digest'iyle uygulanır.
3. TypeScript/ESLint, Graphify güncellemesi, final HEAD'de Full166.

Push ve deploy ayrı onaydır. **RET** veya **DEĞİŞİKLİK** isteği gelirse exact12 de bekler (Karar 1, koşul 4).
