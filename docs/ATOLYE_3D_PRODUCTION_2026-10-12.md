# 3D üretim tasarımı — 12 Ekim 2026

Owner önceki3Dadayı tamamlayıp işleme almayı istedi. Kaynak artık görsel sağlayıcısı ve gerçek sahne-video motoruna bağlıdır; canlıya geçişin gerçek durumu checkpoint ve ignored delivery-volume-production makbuzlarından doğrulanır. Önceki aday/devam belgesi tarihsel tasarım ve YouTube inceleme kanıtıdır: [ATOLYE_3D_PERIOD_DESIGN_2026-10-12.md](ATOLYE_3D_PERIOD_DESIGN_2026-10-12.md).

## Tek üretim bağlantısı

- `CharacterImageProvider`: IMAGE_PROVIDER=character aynı ücretsiz kimlik/bütçe yolunda. Yeni varsayılan3D, constructor'da yakalanmış ATOLYE_CHARACTER_RENDER_MODE;3d/2d dışında ret. Provider identity/model anahtarı tarihsel dispatch uyumu için korunur; gerçekstil portablemetadata'da açıkça volume.version1.
- `VolumeScenePlan`: yalnız sahneye ait açık tarihler, role/kültür ve kaynak esinli kıyafet briefing'leri. JSONmesh/shader/path yok; canonicalmetadata yeniden hesaplanıp eşleşmezse ret.
- `CharacterSceneAsset`: mevcutPNG/tEXt+atBG saklama, SHA/CRC,256KBmetadata ve2MBbackdrop sınırı korunur. Yeni optionalvolume alanı; stylesız/eski1–4asset değişmez. EskiSVG API3Dasset'i sessiz2D'ye çevirmez, rasterAPI gerekir.
- `CharacterSceneRasterFrame`: eski volume'sizframe aynıSVG/sharp yolu;3Dframe actualrig/poseAngles/mouth/expression/prop/facing/depth/kimlik, CPUz-buffer/smoothlight/footshadow ve yerelbackdrop. Modernanlatıcı sarıatkılı, diğerleri saç/gözlük/renkle ayrışır; tarihîgear preserved3Darmour/helmet/kapalıprop sözlüğü.7kültür/5rol, ençok8aktör;1024backdrop→1920output; ağ/model/GPUinference yok.
- `FFmpegSceneVideoProvider`: aynıpayload'dan1080p30fps,15fpsanimasyon.5s wall-clock health veTEMPdisk basıncı; yalnızownedTEMP/child temizliği. Pipeline/audio/frozen sıra yeniden düzenlenmez. Editorialkamera ölçülü konuşmacı yakınlaşması; yıl badge veCANLANDIRMA kadrajdan bağımsız kalır.

## Ücretsiz özgün müzik

Beş yeni `public/music/<mood>/atolye-original-02.wav` ve license sidecar'ı, `OriginalMusicComposer.ts` ile lokal deterministikPCM kompozisyon: akor/arpej/yumuşakbas/hafifritim/envelope. External samples0, API0, CC0-1.0 source katkısı; toplam yaklaşık4.86MB. Tekdüzesinüs eski bedler silinmez; optional boundedpriority10 yeni seçimde tercih edilir. Eski sidecar/type/API uyumludur; unknown/restrictedrights kapısı korunur. PipelineStageExecutor mevcut musicstaging/assemblyducking yolunu kullanır. Kayıtlıbgm / completed-stage regeneration yeniden yazılmaz. Tekrar generator çalıştırmak mevcutdosyaları reddeder.

## Kalite ve doğruluk sınırları

Sade3Dmaskot +incelenmiş2Dsaray/yerelSVGortam hibritidir; her saray baştan3Dmodellendi iddiası yok. Giysi/material/başlık artık canlandırma hacmidir; bütüngiyim/yıl/kişi fotoğrafdoğruluğu iddiası yok. Bilinen5referans penceresi role/dönem tasarım adayını seçer; eksikcoverage metadata'da researchRequired olarak kalır. Prompts yalnızSceneData'daki destekli dönemi taşımayı ister; tarih icat edemez. ReferenceInspiredNeedsReview gerçeği korunur. Tarihî kaynak kapsamı güvenli owner öneri/araştırma yolunda genişletilebilir.

YouTube örneklerinden kadraj çeşitliliği, anlaşılır siluet, cümleye bağlı eylem ve görsel odağı aldık; başka karakter/müzik/video kopyalanmadı. Dahaçokizlenme tasarım hedefidir; kontrol edilen çıktı izlenme başarısı kanıtı değildir. Storycue hâlâ SCENE_TEXT_ESTIMATE; actualdurationluPiperdemo dahi kelime/fonem forcedalignment değildir. Yeni ASR/ücretli çağrı veya frozenaudio sırası değişimi yok.

## Doğrulama / işletme

Özel kimliksiz test kökü: provider→portablePNG/tamper/year/count/BCE→actual3Dframe/camera/moderncast/immutableselection→legacy2D→gerçek1080pFFmpeg PASS.6ifade/10poz, eskikarakter15/tarihî14/backdrop/direction/profile ve müzik5/11SFX/6montaj/özgünWAV kontrolleriPASS; TS/lint.2Türkçesahnelitasarımdemosu actualprovider veFFmpeg/Piper/CC0music/ducking, paid0; ownerproject kullanılmadı/publishfalse. İlkdemosecs21.70136; son temiz kaynaktaki demo ve build/CI/health/Graphify receipts ignored delivery-volume-production içinde tutulur.

Kaynak-onlyrollback uygulama commitinin reverti +eski.next/qualification artifactidir. Eskiassets metadata'sı kendi2Dstilini taşır, herhangi bir dosya dönüştürülmez. DiğerPC: sonGitkaynakları, public/musicWAV+license ve istenenreviewedlibraryPNG+JSON taşınır; node/Sharp/FFmpeg yerelkurulum gerektirir, yeni3D işi Blender/Three/Python/GPUmodel istemez. Mevcut migration/authority aktarımı atlanamaz. GPU73°C ortak koruması/Windowsayarları/ownerhomepage ve mevcutenv/tünel/startup korunur.
