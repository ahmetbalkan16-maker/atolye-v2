# V3 faz raporları

Her fazın doğrulaması (komut + sonuç). En yeni en altta.

## FAZ 0 — Yedek ve dal (19 Ekim 2026)

- `git tag atolye-v2-pre-v3-backup` → `69bda564` (ana dal temiz, `origin` ile eşit).
- `feature/cop-adam-v3` **ayrı worktree'de**: `D:\ÜRETİM\Atolye\atolye-v2-v3`. Ana repo canlı AYAS'ın çalışma
  ağacı ve otomatik yayın kaynağı olduğu için orada branch değiştirilmedi (gerekçe: `01_ATOLYE_DURUM.md`).
- Doğrulama: `git -C atolye-v2 status` temiz; worktree `On branch feature/cop-adam-v3`.

## FAZ 1–4 — İnceleme, donanım, boşluk analizi, yol haritası

- `01_ATOLYE_DURUM.md`, `02_DONANIM.md`, `03_BOSLUK_ANALIZI.md`, `04_YOL_HARITASI.md` yazıldı.
- Mevcut test: `npx tsx scripts/smoke-character-animation-pipeline.ts` → PASS (14 senaryo, 1 FFmpeg senaryosu atlandı).
- Referans: yalnız `yt-dlp --skip-download` meta veri + altyazı; 144 kelime/dk, 5,5 sn/vuruş.
- Seviye ORTA (RTX A2000 12 GB). Kurulanlar: Remotion 4.0.536 (alt paket), Rhubarb 1.14.0, Chatterbox 0.1.7 venv (kurulum sürüyor).
- Bulgular: SDXL venv bozuk (eski PC yolu), mevcut Piper sesi CC BY-NC-SA.

## FAZ 5.1 (kısmi) / 5.2 — Şema ve karakter sistemi

- `src/lib/v3/episode/` (tipler + doğrulayıcı), `docs/v3/episode.schema.json`, `content/v3/kadrolar/fatih-1453.json`.
- Karakter rig'i `remotion-v3/src/character/`: ileri kinematik, 12 jest, yürüme/koşma, nefes, göz kırpma,
  8 duygu, 9 vizem (Rhubarb A–H/X), 6 efekt; 7 giysi tipi; iki stil (`kukla`, `cop`).
- Kostüm paketleri `remotion-v3/public/costumes/` (Osmanlı 1453: 17, Bizans 1453: 7 SVG) — yükleyici SVG'de
  script/href/url/foreignObject'i reddeder.
- Doğrulama:
  - `npx tsx scripts/v3/karakter-vitrini.ts --stil kukla --video` → 15 sn, 1080p30, **13 sn'de render** (~35 kare/sn).
  - Kare incelemesi (40, 250, 330, 420): duygular, jestler, yürüme, efektler, yazı kartları, altyazı doğru.
  - Owner geri bildirimi "karakterler havada uçuyor gibi" → temas gölgesi (iki katman), alçak zemin çizgisi,
    zemin tonlaması; yürürken ayaklar yerde kalıyor. Paralaks arka planın kenar boşluğu giderildi.
  - `npx tsx scripts/smoke-v3-episode-director.ts` → PASS (9 senaryo).
  - `npx tsc --noEmit` (kök) 0 hata; `remotion-v3` `tsc --noEmit` 0 hata; `eslint src/lib/v3 scripts/v3` 0 uyarı.
