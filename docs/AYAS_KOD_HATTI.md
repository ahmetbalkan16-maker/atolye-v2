# AYAS kod hattı: geliştirici yazar, sen tek tıkla uygularsın

Owner kararı (9 Kasım 2026): "ayas tamamen otomatik çalışacak, benim onay uygula diye tıklama ile onay alıp
yapacak … bir yeri yaparken çalışan başka birşeyi bozma". Gelişim Merkezi'nde (`/brain?panel=development`)
**Atölye Beyinleri** bölümünde görünür. Ana sayfada yer almaz (`docs/AYAS_HOMEPAGE_POLICY.md`).

## İş nereden gelir

- **V3 beyin önerisi:** bir beyin öneri yazar, sen **ONAYLA**'ya basarsın, öneri geliştirme kuyruğuna girer.
- **Senin isteğin:** "AYAS'tan geliştirme iste" kutusuna yazdığın iş doğrudan onaylı bir ana AYAS işi olarak
  kuyruğa girer (`kapsam: "ayas"`). Aynı anda en fazla 5 açık istek olabilir.
- Ana AYAS işleri `ATOLYE_AYAS_GELISTIRME=0` ile durdurulur. V3 işleri bundan etkilenmez.

## Geliştirici ne yapar

Her akşam 16:30'dan sonra, V3 siparişi yokken `scripts/v3/gelistirici.ts aksam` sıradaki işi alır. İş ayrı bir
çalışma kopyasında yazılır: `D:\ÜRETİM\Atolye\gelistirme\<iş>`, dal `gelistirme/<iş>`. Ana kopyaya yazılmaz.

- Ana AYAS işini yalnız Claude Code (`claude -p`, abonelik, ek ücret yok) yazar. Kurallar
  `AYAS_DEVELOPER_RULES` ve `.claude/skills/ayas-gelistirici/SKILL.md` içindedir.
- V3 işini çırak ya da Claude yazar.
- Kontroller: `tsc --noEmit`, değişen ve ilgili smoke'lar, `smoke-ayas-action-firewall-closure` ve EVAL
  ölçütü koruması, V3 dosyası varsa V3 smoke'ları, `scripts/lint-yerel.mjs`. Tabanda da düşen bir suite yapının
  hatası sayılmaz. Yapının kendi değiştirdiği bir suite ise her zaman sayılır.
- Geçerse iş **Hazır — onayını bekliyor** olur. Commit iş etiketini taşır (`AYAS-Code-Job: <iş>`). Kayda
  **yapı kimliği** yazılır: iş, dal, commit, taban, her dosyanın sha256'sı, kontroller (`yapiHash`).

## ONAYLA VE UYGULA

Kartta değişen dosyalar, kontrol sayısı ve tabanda da düşen suite'ler görünür. **ONAYLA VE UYGULA**, o yapının
commit, push ve canlı yayını için tek açık onaydır (CLAUDE.md'deki dar istisna). **REDDET** işi kapatır,
hiçbir şey uygulanmaz.

- Onay tam olarak o yapıya bağlıdır (`jobId` + `buildHash`). Yapı değiştiyse onay reddedilir
  (`CODE_APPLY_BUILD_CHANGED`).
- Owner doğrulaması öteki kararlarla aynıdır (`requireOwnerApprovalAdmission`, eylem `applyAyasCodeChange`,
  konu `code-apply`). Bu doğrulama başka hiçbir kararı yetkilendirmez.
- Karar mühürlü olarak `data/brain/self-improvement/code-changes/` altına yazılır (Git dışında). Tıklamanın tek
  etkisi budur.

Observer'ın bir sonraki turunda `scripts/ayas-update-executor.ts` kararı uygular (`CODE_APPLY`,
`AyasCodeChangeApplyRunner`):

1. Yapı yalnız Git'ten kanıtlanır: dal hâlâ onaylanan commit'i gösterir, commit'in tek ebeveyni taban, tam
   olarak kayıttaki dosyaları kayıttaki baytlarla değiştirir ve iş etiketini taşır. Kanıtlanamazsa REFUSED.
2. HEAD hâlâ tabandaysa yapının kendi commit'i ileri sarılır (ff).
3. HEAD ilerlediyse yapının hiçbir dosyası tabandan beri değişmemiş olmalı. Kontroller ayrı bir worktree'de
   yeniden koşar (tsc, lint, yapının smoke'ları). Biri tutmazsa STALE olur: hiçbir şey commit'lenmez, iş yeni
   koda göre yeniden yapılır. Tutarsa commit cherry-pick edilir.
4. Korumalı yayının `code-change` kulvarı commit'i ve push'u yapar: temiz ağaç, birebir dosyalar, zorlamasız
   push. Commit'ten sonra hiçbir zaman reset yapılmaz.
5. Yeni HEAD için Graphify kapanışı yapılır. Canlı kopyayı otomatik canlı yayın günceller
   (`docs/AYAS_LIVE_PUBLISH.md`).

V3 kaynaklarına (`src/lib/v3/`, `scripts/v3/`, `remotion-v3/src/`, `content/v3/`) dokunan yapı, bir V3 siparişi
çalışırken ya da beklerken bekler (`CODE_APPLY_WAITING`).

Yarıda kesilen bir uygulama hiçbir şeye dokunmadıysa en fazla 2 kez yeniden denenir. Commit'i duran ama push'u
olmayan bir uygulamayı yürütücü kendisi gönderir: commit'i kanıtlar, tek ve zorlamasız bir push yapar. Bunların
dışındaki durumlar RECOVERY_REQUIRED olur ve elle incelenir. FAILED ya da ROLLED_BACK sonrasında aynı yapıya
yeniden tıklanabilir.

## Bu yolla hiç değişmeyenler

Kurallar `src/lib/brain/autonomy/AyasCodeChangeLane.ts` (`ayasCodeLaneRefusals`) içindedir. Kart bu dosyalardan
birini içeren bir yapıyı tek tıkla uygulatmaz; yürütücü de reddeder.

- `src/`, `app/`, `scripts/`, `docs/`, `content/v3/`, `remotion-v3/src/` dışındaki her şey: paket dosyaları,
  `.env*`, `.gitignore`, `.claude/`, `AGENTS.md`, `CLAUDE.md`, ayar dosyaları.
- Ana sayfa ve AYAS'ın öz-geliştirme/yayın düzeneği (`src/lib/brain/autonomy/`, kod hattının kendisi dahil).
- Gözlemci, yürütücü ve başlatıcı betikleri (`scripts/ayas-*`, her `.ps1/.vbs/.mjs/.cjs/.js` betiği),
  `scripts/lib/`, `scripts/helpers/`.
- Geliştirme kuyruğunun kendi modülleri ve sipariş izleyicisi.
- `docs/ayas-execution/` (kanıtlar ve EVAL kayıtları).
- `BrainPatchSafety`'nin FORBIDDEN_AUTONOMOUS saydığı her hedef: yönetişim, güvenlik, yürütme, politika, gelir,
  altın kasa ve EVAL pinli suite'ler, sırlar, dağıtım, CI, üretim ve pipeline katmanları, çalışma zamanı depolaması.
- Yeniden başlatma ya da ayar yazımı gerektiren her dosya. Yalnız TEST_ONLY ve SOURCE_ONLY yayınlanabilir.

Kod hattının, kuyruğun ve yürütücünün kendisindeki değişiklikler her zaman ayrı ve açık owner onayı ister.

## Kayıtlar

- Kararlar ve uygulamalar: `data/brain/self-improvement/code-changes/` (Git dışında).
- İş kaydı ve yapı kimliği: V3 çalışma kökünde (`ATOLYE_V3_WORK_ROOT`) geliştirme kuyruğunun öneri kaydı.
- Testler: `scripts/smoke-ayas-code-change-lane.ts`, `scripts/smoke-v3-self-improvement.ts` (K senaryosu).
