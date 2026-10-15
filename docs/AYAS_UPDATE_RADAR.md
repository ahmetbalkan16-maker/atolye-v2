# AYAS güncelleme radarı: dene, sonra uygula

Gelişim Merkezi'nde `/brain` → araştırma paneli → **Güncelleme Radarı** bölümü, AYAS'ın izlediği araçlarda
kurulu sürümden daha yeni kararlı sürümleri gösterir. Ana sayfada yer almaz (`docs/AYAS_HOMEPAGE_POLICY.md`).
Owner kararları (15 Ekim 2026): güncellemeler Claude/Codex olmadan, AYAS'ın kendi yerel uygulayıcısıyla
yapılır. Her güncelleme iki tıklama ister: önce **Onayla ve dene**, deneme geçerse **Uygula**.

## Radar neyi gösterir

- İzlenen araçlar: Next.js, React, TypeScript, ESLint, Tailwind CSS, Transformers.js, Wrangler
  (`package-lock.json`) ve Node.js (çalışan süreç; yalnız LTS hattı). Liste
  `src/lib/brain/autonomy/AyasResearchReleaseRelevance.ts` dosyasındadır.
- Kaynak: araştırmanın gördüğü sürüm başlıkları. Model ve ağ kullanılmaz (`AyasUpdateRadar`).
- Her kartta kurulu ve yeni sürüm, kaynaktan birebir alıntılar ve **Geliştirme özeti** bulunur. Özet etkilenen
  dosyaları, doğrulama planını ve riski (ana / ara / yama sürümü) gösterir.

## 1. Onayla ve dene

Kartta **Onayla ve dene** → **Onaylarsam ne olacak?** → **Evet, onayla ve dene**.

- Onay tam olarak o güncellemeye bağlıdır: araç, kurulu sürüm, hedef sürüm ve kanal (`itemHash`).
  Radar değişirse (örneğin daha yeni bir sürüm çıkarsa) eski kartla verilen onay reddedilir.
- Onay, öteki owner kararlarıyla aynı owner doğrulamasını kullanır (`admitAyasOwnerApproval`, eylem
  `decideAyasUpdateRadar`). Bu doğrulama hiçbir öneriyi, mikro grubu ya da yürütmeyi yetkilendirmez.
  Tersi de geçerlidir.
- **Onayı geri al** yeni bir karar olarak eklenir; geçmiş kayıtlar silinmez.
- Node.js telefon erişimine SHA-256 ile sabitlidir. Onayı yalnız kaydedilir; yeni sürümü kurup sabitlemek
  owner adımıdır (`docs/AYAS_NEW_PC_SETUP.md`).

**Deneme** Observer'ın bir sonraki turunda başlar. Koşullar: makine ALLOW, kod temiz, AYAS güvenli kipte değil
ve D'de en az 15 GB boş alan. Denemeyi `scripts/ayas-update-executor.ts` yapar (`AyasUpdateTrialRunner`):

1. Güncel HEAD'in ayrı bir worktree'si açılır: `D:\ÜRETİM\private\temp\ayas-update-trial-<kimlik>`.
   Ana repoya, onun `node_modules` klasörüne ve canlı kopyaya yazılmaz.
2. `npm ci --ignore-scripts`: mevcut bağımlılıklar kilit dosyasından kurulur, kurulum betikleri çalışmaz.
3. Testler bir kez güncellemeden önce çalışır. Burada zaten kırık olan testler raporlanır ama sayılmaz.
   Test listesi: CI iş akışının testleri (`.github/workflows/ayas-safe-ci.yml`'den okunur), paketi içe aktaran
   testler ve radar/onay/deneme testleri.
4. `npm install <paket>@<sürüm> --ignore-scripts`. Birlikte güncellenmesi gereken paketler de aynı sürüme
   çekilir (next ile eslint-config-next, react ile react-dom). Tam sabitlenmiş sürüm tam sabitli kalır.
5. Paket dosyası denetimi: `package.json`'da onaylanan bağımlılık satırları dışında hiçbir şey değişmemeli,
   hedef paket hedef sürümde olmalı.
6. `npm audit signatures`: bütün paketlerin kayıt imzası doğrulanmalı.
7. `tsc --noEmit`, `npm run lint`, `npm run build` ve aynı testler. Güncellemeden sonra yeni bozulan tek bir
   test bile denemeyi düşürür.
8. Worktree her durumda silinir. Geçen denemenin `package.json` ve `package-lock.json` baytları ve bunların
   özeti (`trialHash`) saklanır.

Yol notu: lint, Unicode yoldan dosyaya özel kuralları eşleştiremez. Bu yüzden lint aynı klasörün ASCII
bağlantısından (`D:\URETIM\...`) çalışır. Geri kalan her şey gerçek yoldan çalışır, çünkü tsx bağlantı
yolunda JSX ayarını uygulamaz ve Turbopack derleme klasörünü proje dışında sayar.

Sonuç kartta görünür: adımlar, değişen paket sayısı ve sonuç (sırada / deneniyor / geçti / başarısız).
TypeScript, lint, derleme ya da testler başarısız olursa güncelleme kod değişikliği gerektiriyor demektir.
AYAS bunu bugün yerel olarak yapamaz; hiçbir şey uygulanmaz. Başarısız bir deneme kendiliğinden tekrarlanmaz;
onayı geri alıp yeniden vererek yeniden denenir. Geçen bir deneme, kod değişirse yeni HEAD'de bir kez daha
denenir.

## 2. Uygula

Yalnız güncel HEAD'de geçmiş bir denemede görünür: **Uygula** → **Uygularsam ne olacak?** → **Evet, uygula**.
Bu tıklama, o güncellemenin commit, push ve canlı yayını için tek açık onaydır (CLAUDE.md'deki dar istisna).
Doğrulama eylemi `applyAyasUpdate`'tir; tam olarak `trialId` + `trialHash`'e bağlıdır.

Observer'ın uygulayıcısı (`AyasUpdateApplyRunner`) şunları yapar:

1. HEAD denemenin yapıldığı commit değilse STALE olur: hiçbir şey commit'lenmez, güncelleme yeni koda göre
   yeniden denenir ve Uygula yeniden çıkar.
2. Korumalı yayının `dependency-update` kulvarı çalışır. Bu kulvar tam olarak `package.json` +
   `package-lock.json` kabul eder; öteki kulvarlar bu dosyaları reddetmeye devam eder. Kurallar:
   temiz ağaç, denenen baytlar, iki dosyalık birebir hazırlama, tek commit (`chore(deps): …`,
   `AYAS-Update-Trial: <kimlik>`), zorlamasız push, ardından yerel HEAD'in uzak dalla eşitliği.
   Commit'ten önceki bir hatada dosyalar geri konur. Commit'ten sonraki bir hatada (örneğin push) hiçbir şey
   geri alınmaz; durum RECOVERY_REQUIRED olur ve elle incelenir.
3. Yeni HEAD için Graphify kapanışı yapılır (`closeAyasPostPublication`).
4. `scripts/ayas-publish-live.ps1 -Commit <sha> -Apply` çalışır. Sağlık denetimi geçmezse betik önceki sürüme
   kendiliğinden döner. Canlıya alma tamamlanmamışsa en fazla 3 kez yeniden denenir. Telefon erişimi geçişte
   yaklaşık bir dakika kesilir.

Yarıda kesilen bir Uygula hiçbir şeye dokunmadıysa (aynı HEAD, temiz ağaç) en fazla 2 kez yeniden denenir.
Commit ve push tamamlanmış bulunursa canlıya alma sürdürülür. Bunların dışındaki her durum RECOVERY_REQUIRED
olur ve kendiliğinden tekrarlanmaz.

Bilinen sınır: ana repodaki `node_modules` güncellemeden sonra eski kalır, çünkü sürekli çalışan Observer bu
klasörü kullanır ve Windows kullanılan dosyaları kilitler. Denemeler ve canlı kopya kendi `node_modules`
klasörlerini kullandığı için bundan etkilenmez. Ana kopya bir bakım anında `npm ci` ile eşitlenir.

## Kayıtlar ve komutlar

- Kararlar: `data/brain/self-improvement/update-approvals/state.json` (git dışı). Bir kayıt ancak owner mührü
  `AYAS_ACCESS_KEY` ile doğrulanırsa sayılır; elle değiştirilmiş kayıt yok sayılır.
- Denemeler ve uygulamalar: `data/brain/self-improvement/update-trials/` (`state.json`, deneme başına paket
  dosyaları, `executor.lock`).

```powershell
npm run ayas:update-approvals                                               # bekleyen onaylar
npx tsx --env-file-if-exists=.env.local scripts/ayas-update-executor.ts --dry-run   # sıradaki iş (çalıştırmaz)
```

Uygulayıcı, Observer'ın sürekli çalışan sürecinin başlattığı üçüncü alt süreçtir. Bu yüzden Observer
yeniden başlayınca (ya da PC açılışında) devreye girer.
