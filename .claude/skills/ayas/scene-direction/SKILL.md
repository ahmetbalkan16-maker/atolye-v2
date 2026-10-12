---
name: scene-direction
description: Atölye belgesel/çöp adam animasyonunda anlatılan kişi, kültür, dönem, mekân, aksesuar ve eylemleri birlikte tasarla; ses ve hareket hizalamasını geliştiren işlerde kullan.
---

# Bağlama bağlı çizgi film yönetmenliği

Owner hedefi: gerçek kişiler ve olaylar, basitleştirilmiş çöp adam çizgi film diliyle anlaşılır biçimde canlansın. Farklı millet/dönem hükümdarına aynı taç, taht ve kıyafeti otomatik atama. Bir ülkenin bütün dönemlerinin veya dinlerinin aynı olduğunu varsayma.

- Yerel varsayılan uygulama: `src/lib/animation/character/CharacterSceneDirection.ts`. Yeni CharacterImageProvider payload'ı `direction` içerir; render/PNG/video aynı bağlamı kullanır. Genel stil için [editorial-animation](../editorial-animation/SKILL.md) geçerlidir.
- Sahne görsel metnindeki açık bilgiyle kültürü seç; bilinmeyen bağlam UNKNOWN kalsın. Kişi adından din tahmin etme. Dinî sembol yalnız açık bağlamda ve ilgili sahnede kullanılabilir. Desteklenen tasarım aileleri Osmanlı, Bizans, Roma, Batı Avrupa, bozkır ve antik Mısırdır; bunlar tarihî portre doğruluğu garantisi değildir. Yeni kişi/dönem için önce güvenilir tarihî kaynak ve eser araştırması gerekir; pahalı görsel çağrı zorunlu değildir.
- Kral/padişah, danışman, muhafız ve anlatıcı rolleri görselde ayrışmalı. Taht, başlık ve ortam bağlamla uyumlu olmalı. İzleyiciye tarihî kesinliği olmayan bir tasarımı gerçek fotoğraf veya kanıt olarak sunma.
- Her sahneye açıklanan eylem ve nesne bağla. Konuşma, işaret etme, eğilme, oturma, kutlama gibi hareketleri cümle sırasına yerleştir; olumsuz cümleyi olmuş eylem gibi oynatma. Oyuncu kimliği, aksesuarı ve yüzü hareket boyunca sabit kalmalı. Üzerine rastgele savaş/ölüm ekleme.
- Mevcut `SCENE_TEXT_ESTIMATE` zamanlaması görsel sahne cümlelerinden tahmindir; gerçek ses cümle/kelime hizalaması değildir. Ses üretimi video sahnesinden sonra çalışıyor. Birebir senkronu tamamlanmış ilan etme: sahibi onaylı ayrı iyileştirme olarak mevcut yerel Whisper modelini, gerçek bölüm sesini, doğru scene/audio offsetlerini ve alignment güven skorunu kullanarak tasarla. Pipeline sırasını, audio compensation veya frozen kayıtları değiştirmeden mimariyi incele. Yeni ASR modeli indirme veya ücretli transcription kendiliğinden açılmaz.
- Önizleme gerçek renderer'dan olmalı; dekoratif resim üreticisini üretim çıktısı gibi sunma. Uyum testleri: eski assets, farklı kültürler, UNKNOWN/din çıkarımı yok, olumsuz eylem, geçersiz metadata, kesintisiz zaman geçişi, PNG round-trip ve gerçek FFmpeg.

Tasarım referansları (yalnız kaynak; uzaktan resim indirme/çoğaltma yetkisi değil): [British Museum nemes](https://www.britishmuseum.org/collection/object/Y_EA97), [LACMA Osmanlı hükümdar portresi](https://collections.lacma.org/object/52285), [Met Bizans tekstil araştırması](https://resources.metmuseum.org/resources/metpublications/pdf/The_Metropolitan_Museum_Journal_v_41_2006.pdf).
