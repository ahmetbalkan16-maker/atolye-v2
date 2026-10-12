12 Ekim son devam: yerel3D/dönem-kıyafet/YouTube-kadraj adayları ve anlamlı kontroller hazır; canlı source03308c76/buildhtR7TBNeqdb0pk7eeDEic hâlâ2Dversion4 ve73°Ckorumalı. Yeni3D üretim/audio/scene-year bağlantısı henüz açık; app/src/env/homepage/ownerverisi değişmedi. Güncel durum ATOLYE_CHECKPOINT.md ve docs/ATOLYE_3D_PERIOD_DESIGN_2026-10-12.md. Bu kayıt aşağıdaki eski durumları supersede eder.

# Yerel illüstrasyon ve kalıcı çizgi film yeteneği — 12 Ekim 2026

Üretim karakteri `src/lib/character/illustration/IllustratedCharacter.ts` içindeki art version4'tür. Mevcut rig/action planı kıyafeti, eli, aksesuarı ve ağzı her karede çizer. Altı ifade/10poz gerçek PNG kontrolü vardır. Version1/2/3 eski kayıtta korunur. Henüz yeni kıyafeti incelenmemiş non-court tarihî zırh eski renderer'da kalır. Fonem/kelime senkronu tamamlanmış sayılmaz: `SCENE_TEXT_ESTIMATE` görsel cümle zamanlamasıdır.

`ATOLYE_CHARACTER_LOCAL_BACKDROP=cache` yalnız bilinen kültür, gündüz ve RULER/saray sahnesinde incelenmiş PNG'yi kullanır. Eksik cache vektör ortamı kullanır; kısmi/bozuk/SHA değişmiş kayıt reddedilir. `off` bu ek yolu kapatır. Cache video boyunca aynı PNG asset'inin bounded SHA/CRC'li binary chunk'ında taşınır; başka bilgisayarın aynı cache yoluna bağımlı eski video/asset oluşmaz. SVG image/href/URL/filter yasağı korunur. Tasarımlar belirli tarihî saray veya kişi için doğrulanmış portre değildir.

## Modelin görevi ve sınırı

SDXL yalnız ayrıca başlatılan offline aday üretir; production pipeline model indirmez, kurmaz veya her karede GPU inference yapmaz. Model adayı otomatik kalite kabulü alamaz. Bu PC'de serbest karakter üretimi yanlış portre/kıyafet verdi; kendi yerel version4 çizimimizle img2img kılavuzu daha yakın tam boy padişah verdi. Bu bitmap adayın production raster puppet/rig bağlantısı henüz tamamlanmamıştır. Onu hareketli production karakteri diye sunma.

Runtime `bin/ayas-local-visual/` Git dışında: ayrı Python3.12 venv, torch2.8.0+cu126 ve pinli requirements. Resmî `stabilityai/stable-diffusion-xl-base-1.0` revision `462165984030d82259a11f4367a4eed129e94a7b`;19data dosyası6,941,201,645bytes, SHA doğrulamalı safetensors/local_files_only. HF offline/implicit token kapalı; paidCalls0. Model lisansı model/LICENSE.md'de korunur; gelir/telif garantisi verilmez.

Owner açık onayıyla A2000 ortak hard stop73°C ve üzeri: `GpuThermalPolicy.ts` → Brain/STT/Ollama/Atölye. Yeni opsiyonel aday başlangıcında ölçülmüş≤48°C soğuma, denoise adımlarında dinlenme, character VAE decode CPU4thread, mevcut RAM/disk/VRAM ve owned5s sağlık kapıları kullanılır. Ret yalnız kendi child/isteğini durdurur; global Ollama, tünel, driver/fan/power veya Windows güvenliği değiştirilmez. Okunamayan başlangıç GPU sensörü aday çalıştırmaz.

## Deneme ve inceleme

Repo kökünden, mevcut .env sağlık profiliyle `node --env-file=.env.local --import tsx scripts/local-visual-runtime/run-guarded.ts OTTOMAN RULER guided` bir aday üretir. OTTOMAN/BYZANTINE/ROMAN/EGYPTIAN ve RULER/ADVISOR/GUARD kapalı sözlüğü vardır. Yeni dosya kendi candidates klasörüne gider; mevcut owner dosyası üzerine yazılmaz. Kılavuz kendi renderer'ımızdan gelir. Gözle tek karakter, yüz, giysi, oran, ortam ve hata incelenmeden cache kabulü veya animasyon iddiası yok.

Arka plan için role verilmez. Gözle incelenmiş aday `review-background.ts THEME theme-timestamp.png --engineering-reviewed` ile guard sonucu/SHA/model revision doğrulanarak library'ye kaydedilir; mevcut library dosyası üzerine yazmaz. Bu mühendislik kabulüdür, owner'ın estetik kabulü değildir. Production bu komutu otomatik çağırmaz. Yeni AYAS önerileri mevcut owner onay/yürütme kapısını izler.

`preview-cultures.ts` gerçek PNG payload/production renderer ile dört ortamı gösterir. `preview-talking-scene.ts` özel test projesinde AudioPipeline/Piper ve FFmpeg ile kısa Türkçe video üretir; ücretli API veya owner projesi kullanılmaz. Demo bed basit yerel sentezdir; normal production müzik/SFX/lisans/ducking hattının tamamı için kalite iddiası değildir.

## Diğer PC'ye taşıma

Version4 kaynakları Git'te kalır. `bin/ayas-local-visual/library/` içindeki dört PNG+JSON (~3.46MB) ve uygun lisans dosyası taşınmalıdır; cache üretimi GPU/Python olmadan mevcut Sharp/FFmpeg ile çalışır. Modelden yeni aday üretmek istenirse model/manifest/lisans verileri ayrıca taşınabilir veya resmî kaynaktan tekrar indirilebilir. Windows venv'ini başka makinede çalışır sanıp kopyalama; Python/torch/requirements o makinede ayrı kurulur ve donanım/sağlık profili yeniden doğrulanır. Bu kuruluma her videoda gerek yoktur. GTX4GB veya bilinmeyen GPU'da aynı SDXL performansı garantisi verilmez; yerel vektör+reviewed cache yolu kullanılabilir. Migration/authority kimliği ve lisans/fiyat sınırları atlanmaz.
