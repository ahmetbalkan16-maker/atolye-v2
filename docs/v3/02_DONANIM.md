# FAZ 2 — Donanım ve seviye (19 Ekim 2026)

## Donanım

| Bileşen | Değer |
| --- | --- |
| İşletim sistemi | Windows 11 Pro 10.0.26300, 64 bit |
| İşlemci | Intel Core i9-13900 — 24 çekirdek / 32 iş parçacığı |
| RAM | 32 GB |
| GPU | **NVIDIA RTX A2000 12 GB** (sürücü 596.71) + Intel UHD 770 |
| GPU durumu | boşta 578 MiB kullanım, 62 °C; owner kuralı: **ortak durma 85 °C** (21 Ekim 2026; önce 73) — iş 78 altında başlar, adım adım işler 82'de dinlenir; kartın kendi sınırları hedef 88, en çok 95 °C |
| Disk | C: 261 GB boş; **D: 718 GB boş** (tüm v3 araç/çıktı D'de) |

## Yazılım

| Araç | Durum |
| --- | --- |
| Node / npm | v24.18.0 / 11.16.0 |
| Git | 2.55.0 |
| FFmpeg | 9.0 full (gyan.dev) — `rubberband`, `sidechaincompress`, `loudnorm`, `ebur128` filtreleri var |
| Python | sistemde 3.14.7 (`py`); `uv` mevcut; v3 için uv ile yönetilen **3.11.16** kuruldu |
| PyTorch | eski SDXL venv'i bozuk (temel yorumlayıcı yok); v3 TTS venv'ine torch 2.6.0+cu124 kuruluyor |
| yt-dlp | 2026.08.19 |
| whisper.cpp | `bin/whisper` (cuBLAS), modeller large-v3-turbo + small |
| Piper | `bin/piper`, yalnız `tr_TR-dfki-medium` |
| Docker, ImageMagick, Blender, ComfyUI | yok (gerekmiyor) |
| Rhubarb Lip Sync | **kuruldu**: 1.14.0, `D:\URETIM\Atolye\v3-tools\rhubarb` (MIT, zip SHA-256 `62fa416a…1fe3`) |
| Remotion | **kuruldu**: 4.0.536, ayrı alt paket `remotion-v3/` (kök bağımlılıkları değişmedi) |
| Chatterbox Multilingual | **kuruldu** (19 Ekim 2026): chatterbox-tts 0.1.7 (MIT) + torch 2.6.0+cu124, `D:\URETIM\Atolye\v3-tools\tts-venv`; ağırlıklar `v3-tools\hf-cache` (`t3_mtl23ls_v2.safetensors`, `s3gen.pt`, SHA-256 doğrulandı) |

Chatterbox kurulum notları (diğer bilgisayar için):
- uv venv'i `setuptools` içermez; filigran paketi (resemble-perth 1.0.1) `pkg_resources` ister, yoksa
  `PerthImplicitWatermarker` sessizce `None` olur ve model "NoneType object is not callable" ile açılmaz:
  `uv pip install --python <tts-venv>\Scripts\python.exe "setuptools<81"`.
- Rhubarb kaynak klasörünü (`res\sphinx`) programın **gerçek** yolundan bulur; `D:\URETIM` bağlantısı `D:\ÜRETİM`'e
  çözüldüğü için PocketSphinx açamaz ("does not contain acoustic model definition 'mdef'") ve her satır RMS yedeğine
  düşer. Rhubarb bağlantı olmayan gerçek ASCII klasörde durmalı: `D:\atolye-ascii\rhubarb\rhubarb.exe`
  (`ATOLYE_V3_RHUBARB_EXE`). whisper.cpp bundan etkilenmez.
- Hugging Face indirmesi `hf_xet` ile takılabilir (bayt gelmeden asılı kalır). Takılırsa iki büyük dosyayı `curl -C -`
  ile snapshot klasörüne indirip LFS SHA-256'yı doğrulayın (`b1237586…`, `9b9ff07e…`).

## Seviye: **ORTA** (12 GB VRAM)

Kural: 8–12 GB VRAM → yerel TTS (Chatterbox), yerel görsel üretim (SDXL mevcut / FLUX schnell önerisi),
yerel müzik (ACE-Step), Whisper hizalama.

## "Şunu kurarsak şunu yerelde üretebiliriz"

| Araç | Boyut | Lisans | Ne sağlar | Beklenen hız (bu PC) | Durum |
| --- | --- | --- | --- | --- | --- |
| Chatterbox Multilingual | ~3 GB model + ~4 GB torch | MIT (çıktıya Perth filigranı) | Türkçe, duygu ayarlı, **owner sesinden klon** | ~1–2× gerçek zaman (GPU) | Kuruldu |
| Rhubarb Lip Sync | 87 MB | MIT | A–H/X vizemleri | satır başına ~1–3 sn (CPU) | Kuruldu |
| Remotion | ~300 MB + Chrome Headless Shell | Remotion License: birey / ≤3 kişilik şirket ücretsiz | React ile kare-kesin animasyon, altyazı, kamera | 1080p30: ~10–25 kare/sn (paralel) | Kuruldu |
| SDXL base 1.0 (mevcut veri) | 6,9 GB (zaten indirilmiş) | CreativeML Open RAIL++-M (ticari kullanım serbest, kullanım kısıtları var) | stil tutarlı arka plan | ~15–20 sn/görsel | Yeni venv ile onarılıyor |
| FLUX.1 [schnell] Q4/FP8 | ~12 GB toplam indirme | Apache 2.0 | daha iyi istem uyumu | ~20–40 sn/görsel | **Onay gerekli (>10 GB)** |
| ACE-Step 1.5 | ~8 GB | MIT (model kartı; kurulumda doğrulanacak) | özgün müzik | ~1 dk müzik / ~30 sn | Sonraki faz |
| WhisperX / faster-whisper | ~2 GB | BSD/MIT | kelime zamanı | — | Gerek yok: whisper.cpp kelime zamanı veriyor |

## Disk ihtiyacı

v3 araçları (`D:\URETIM\Atolye\v3-tools`): ~10 GB (TTS venv + model + Rhubarb + görsel venv). Bölüm başına çalışma
klasörü ~0,5–2 GB (önizleme kareleri tutulmaz; final MP4 ~100–300 MB). D'de 718 GB boş — sorun yok.

## Notlar

- Kurulumlar kullanıcı düzeyinde; yönetici yetkisi, sürücü/CUDA güncellemesi yapılmadı. torch cu124 tekerleği
  kendi CUDA çalışma zamanını taşıyor; 596.71 sürücü yeterli.
- Tüm v3 araç yolları ASCII bağlantı `D:\URETIM` üzerinden: whisper.cpp ve bazı yerel araçlar Unicode yolda sorun çıkarıyor.
