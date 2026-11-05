# Ücretsiz / açık kaynak AI video ve belgesel üretimi — araştırma, 5 Kasım 2026

Yöntem: web araması (Claude WebSearch) + AYAS'ın yeni anahtarsız aramasıyla GitHub/Hugging Face/arXiv/HN
(`scripts/ayas-web-research.ts ara`) ve link incelemesi (`ogren`). Bulguların kaynaklı makine okunur hali:
`2026-11-05-ucretsiz-ai-video-bulgulari.json` (içe aktarıldı: `ekle --dosya`). Kaynaklar çeliştiğinde not düşüldü;
resmi sayfa her zaman üstündür. Atölye'nin kartı: RTX A2000 **12 GB** (Ampere).

## 1. Gerçekten ücretsiz, hesapsız çevrimiçi hizmetler

Upsampler, Pixelbin, FlatAI, Hugging Face Spaces vb. Bağımsız incelemelere göre hepsinde günlük kota, seçili modeller
(çoğu Wan/LTX), 4–10 sn klip, 480p–1080p ve bir kısmında filigran var; "sınırsız/filigransız" iddiaları çoğu kez yalnız
şirketin kendi sayfasında. Ticari kullanım şartları incelenmedi. **Otomasyona uygun değil** (API yok, kota, şart).
Kaynaklar: [RenderFlow](https://renderflowai.com/blog/free-ai-video-generator-no-sign-up/), [Pexo](https://pexo.ai/blog/best-ai-video-generator-free-no-sign-up-4790), [AI Tool Discovery](https://www.aitooldiscovery.com/guides/ai-video-generator-no-sign-up).

## 2. Hesap isteyen ücretsiz katmanlar / 4. deneme kredileri

Kling AI günlük ~66 kredi, Runway kayıtta 25 kredi (tek kaynak, resmi fiyat sayfasından doğrulanmadı; sık değişir).
Uzun (15–60 sn) üretim genelde hesap ister. Kaynak: [AI Tool Discovery](https://www.aitooldiscovery.com/guides/ai-video-generator-no-sign-up).

## 3. Açık kaynak / yerel çalışan modeller

| Model | Lisans | Donanım | Atölye için |
|---|---|---|---|
| **Wan 2.2 TI2V-5B** | Apache-2.0 | resmi 24 GB; ComfyUI offload / Q8 GGUF ile 12 GB kartlarda rehberler var; FP8 ağırlığı yok | **En güçlü aday**: dönem görseline/“an” resmine görselden-video hareket |
| Wan 2.1 T2V-1.3B | Apache-2.0 | 8 GB | hızlı deneme, düşük kalite |
| LTX-2 / 2.5 (Lightricks) | **LTX-2 Community License** (Apache değil; < 10 M $ ARR ticari serbest) | resmi 32 GB+ (FP8) | 12 GB'ta tam kalite yok; yeni PC'de yeniden bak |
| HunyuanVideo 1.5 | Tencent Community License (metin okunmadı) | 14 GB FP8 + offload | lisans okunmadan kullanılmaz |
| CogVideoX-2B / 5B | Apache-2.0 / CogVideoX lisansı (kısıtlı ticari) | 12–16 GB | ikincil aday |
| **Depth Anything V2 Small** | Apache-2.0 (Base/Large/Giant NC) | ~95 MB | **kamera eksiği için**: derinlik katmanlı 2.5D parallax zoom/pan |
| Chatterbox | MIT (çıktı PerTh filigranlı) | 0.5B | zaten kullanılıyor; `exaggeration` ile karakter duygusu |
| Kokoro 82M | Apache-2.0 | CPU/2–3 GB | zaten kullanılıyor |
| F5-TTS | kod MIT, **ağırlık CC-BY-NC** | — | **kullanılamaz** (gelir amaçlı kanal) |
| MMAudio | kod MIT, **ağırlık CC-BY-NC** | 157M+ | **kullanılamaz**; "harekete senkron efekt" fikri mevcut MOSS + Kenney hattında kuralla uygulanabilir |

Kaynaklar: [Wan 2.2 TI2V-5B model kartı](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B), [Thunder Compute](https://www.thundercompute.com/blog/best-open-source-ai-video-generation-models), [smeltcore 12 GB rehberi](https://smeltcore.com/recipes/wan-2-2-ti2v-5b-on-rtx-3080-ti-720p-text-image-to-video-in-comfyui/), [WillItRunAI](https://willitrunai.com/blog/wan-2-2-vram-requirements), [Morphic](https://morphic.com/resources/list/best-open-source-ai-video-models), [LTX-2 LICENSE](https://huggingface.co/Lightricks/LTX-2/blob/main/LICENSE), [The Rundown: LTX-2](https://www.therundown.ai/tools/ltx-2), [LTX rehberi (Lightricks'in kendi yayını)](https://ltx.io/blog/open-source-video-generation-models-guide), [Cartesia TTS lisans karşılaştırması](https://www.cartesia.ai/learn/open-source-tts), [Local AI Master](https://localaimaster.com/blog/kokoro-vs-xtts-vs-chatterbox), [MMAudio model kartı](https://huggingface.co/hkchengrex/MMAudio), [Depth Anything V2 issue #162](https://github.com/DepthAnything/Depth-Anything-V2/issues/162), [issue #320](https://github.com/DepthAnything/Depth-Anything-V2/issues/320).

## Atölye eksikleriyle karşılaştırma (`ayas-web-research.ts eksikler`)

| Eksik (owner/ölçüm) | En iyi aday | Önerilen deney (owner onayı gerekir) |
|---|---|---|
| yüz/karakter canlandırması, görselden video yok | Wan 2.2 TI2V-5B | V3 deneme çalışmasında 3 sahne, ayrı çıktı, GPU 85 °C koruması; ölçüt: "anlatılanı gösterme" ≥ 7/10, süre |
| yakın plan, zoom, pan az | Depth Anything V2 Small | Remotion'da derinlik katmanlı parallax; ölçüt: Short'ta her sahnede kamera hareketi + kalite puanı |
| duygu / karakter sesi çeşitliliği | Chatterbox `exaggeration` | karakter repliklerinde 0.5 → 0.7; dinleyici testi |
| önemli harekette efekt | (NC modeller elendi) | mevcut efekt hattında "hareket = efekt" kuralı |

## Deneme sonucu — Depth Anything V2 Small (5 Kasım 2026 gece)

`scripts/v3/derinlik_parallax.py`: 3 sahne, aynı hareketin düz ve derinlikli hali, tamamen işlemcide (GPU kullanılmadı),
klip başına ≈ 16 sn. Derinlik haritaları resimde, gravürde ve düz minyatürde doğru katmanlı. İnce çizgiler (gravür
halatları) ilk ayarda gökte hayalet çizgi bıraktı; derinliği daha geniş yumuşatmak (7 / 41) bunu giderdi. Karşılaştırma
videoları `v3-runtime/denemeler/2026-11-05-derinlik-parallax/KARSILASTIR-*.mp4`; karar owner'da. Wan 2.2 TI2V-5B
denemesi 34,2 GB indirme gerektirdiği için owner onayı bekliyor.

## Araştırılmayanlar (bu oturum)

Müzik (ACE-Step 1.5 zaten kullanılıyor), otomatik kurgu, kapak tasarımı, video kalite metrikleri (VMAF vb.), Türkçe
anlatıcı sesi karşılaştırması, VoxCPM2 lisansı (aramada bulunamadı — kendi sayfasından okunmalı).
