# AYAS güncelleme radarı ve owner onayı

Gelişim Merkezi'nde `/brain` → araştırma paneli → **Güncelleme Radarı** bölümü, AYAS'ın izlediği araçlarda
kurulu sürümden daha yeni kararlı sürümleri gösterir. Ana sayfada yer almaz (`docs/AYAS_HOMEPAGE_POLICY.md`).

## Radar neyi gösterir

- İzlenen araçlar: Next.js, React, TypeScript, ESLint, Tailwind CSS, Transformers.js, Wrangler (`package-lock.json`)
  ve Node.js (çalışan süreç; yalnız LTS hattı). Liste `src/lib/brain/autonomy/AyasResearchReleaseRelevance.ts`'tedir.
- Kaynak: araştırmanın gördüğü sürüm başlıkları. Model ve ağ kullanılmaz (`AyasUpdateRadar`).
- Her kartta kurulu ve yeni sürüm, kaynaktan birebir alıntılar ve **Geliştirme özeti** bulunur: etkilenen dosyalar,
  doğrulama planı, risk (ana / ara / yama sürümü).

## Onay düğmesi

Kartta **Bu güncellemeyi onayla** → **Onaylarsam ne olacak?** → **Evet, onayla**.

- Onay yalnız bir karar kaydıdır. Hiçbir şey kurulmaz, değişmez, commit'lenmez ya da yayınlanmaz.
- Onay tam olarak o güncellemeye bağlıdır: araç, kurulu sürüm, hedef sürüm ve uygulama kanalı (`itemHash`).
  Radar değişmişse (ör. daha yeni sürüm çıkmış) eski kartla verilen onay reddedilir ve güncel kart yeniden onaylanır.
- Onay, öteki owner kararlarıyla aynı owner doğrulamasını kullanır (`admitAyasOwnerApproval`, eylem
  `decideAyasUpdateRadar`). Bu doğrulama yalnız bu kararı kapsar: hiçbir öneriyi, mikro grubu ya da yürütmeyi
  yetkilendirmez. Tersi de geçerlidir.
- AYAS güvenli salt okunur kipteyse (`SAFE_READ_ONLY`) karar kaydedilmez.
- **Onayı geri al** yeni bir karar olarak eklenir; geçmiş kayıtlar silinmez.
- Kurulu sürüm hedef sürüme ulaşınca onay "uygulandı" olarak görünür.
- Node.js telefon erişimine SHA-256 ile sabitlidir. Onayı kaydedilir; yeni sürümü kurup sabitlemek owner adımıdır
  (`scripts/new-pc-setup.ps1` pinleri, `docs/AYAS_NEW_PC_SETUP.md`).

Kayıtlar `data/brain/self-improvement/update-approvals/state.json` dosyasındadır (git dışı, kanonik veri kökü;
canlı kopya da aynı kökten okur). Bir kayıt ancak owner mührü `AYAS_ACCESS_KEY` ile doğrulanırsa sayılır. Elle
değiştirilmiş bir sürüm ya da araç adı mühürle tutmaz ve yok sayılır.

## Sıradaki güncelleme turu

```powershell
npm run ayas:update-approvals            # bekleyen onaylar önce
npm run ayas:update-approvals -- --json
```

Komut salt okunurdur ve `.env.local`'i yükler; anahtar yoksa hiçbir kaydı saymaz ve bunu söyler.

Bugün onaylı bir güncelleme bir geliştirme turunda uygulanır:

1. Ayrı bir kopyada güncelle.
2. Kartın doğrulama planını çalıştır: tsc, CI-eşdeğeri lint, next/react için `npm run build` ve etkilenen smoke'lar.
3. Geçerse commit'le, push'la ve `docs/AYAS_LIVE_PUBLISH.md` ile canlıya al.

Owner bu turların ileride Claude/Codex olmadan, AYAS'ın kendi yerel güncelleme uygulayıcısıyla yapılmasını istedi.
Bu tasarım owner onayını bekliyor (`ATOLYE_CHECKPOINT.md`, 15 Ekim kaydı).
