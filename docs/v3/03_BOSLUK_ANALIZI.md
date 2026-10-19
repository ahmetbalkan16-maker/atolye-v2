# FAZ 3 — Referansla boşluk analizi (19 Ekim 2026)

## Referans: "OSMANLI İMPARATORLUĞU YIKILIYOR!" — Yusuf Kayaalp (24.04.2019)

Kaynak: `yt-dlp --skip-download` ile yalnız meta veri ve otomatik Türkçe altyazı (video indirilmedi, hiçbir kare/ses
kullanılmadı). Açıklamada kanal, video ve tasarımlarının kullanımına **izin verilmediği** açıkça yazıyor; yalnız stil
(tempo, anlatım dili, sahne kurgusu) örnek alındı.

| Ölçüt | Değer |
| --- | --- |
| Süre | 614 sn (10:14), 30 fps |
| İzlenme / beğeni / yorum | 3,36 M / 202 B / 4,4 B |
| Konuşma hızı | **144 kelime/dk** (1475 kelime); her 30 sn'de 58–93 kelime, çok dengeli |
| Vuruş (beat) | 0,7 sn'den uzun duraklamaya göre 112 vuruş → ortalama **5,5 sn / 13 kelime** |
| Hook | 0–2 sn: izleyiciye doğrudan soru — "Şu devasa şeyi görüyor musunuz?" |
| Vaat | 20–30 sn: "Dilerseniz … tarihine ufaktan bir bakalım" + "size yıkılma sürecini basit bir şekilde anlatabilirim" |
| Diyalog | Anlatıcı karakterlerle konuşuyor ("bunu … padişahına soracağım"), karakterler birbirine laf atıyor ("Sultanım sıkıntılar büyük." / "Ne oldu yine?") |
| Mizah | Modern göndermeler ("Çağ kapama ve açma challenge videoları"), ters köşe, kendi kendine cevap |
| Üretim | Adobe (After Effects tarzı kukla animasyonu), Freepik/Shutterstock vektör arka planları, stok müzik/SFX, ilham: Webz with Az |
| Kaçınılacak | Referanstaki "lan/ulan" gibi argo — Atölye kuralı: argo/küfür yok |

**Sahne kesme sıklığı ölçülmedi** (videoyu indirmek gerekir; onayın olursa yalnız yerel ffmpeg analizi için indirilip
silinebilir). Bu tür kanallarda (OverSimplified / Webz with Az) gözlenen genel teknik: 2–4 sn'de bir görsel olay
(kesme, zoom, poz/ifade değişimi, yazı, nesne girişi); bu değer **tahmindir**.

## Atölye'nin son Fatih videosu (Temmuz 2026)

117 sn, 6 bölüm, fotogerçekçi AI resimlerden Ken Burns slayt; ffmpeg sahne skoru >0,3 olan yalnız **4 kesme**
(ortalama ~20 sn/görsel), tek anlatıcı (OpenAI TTS), **−24,5 LUFS** (LRA 4,6), bölüm başına tek paragraf altyazı
(~20 sn), karakter/diyalog yok. Kare incelemesinde 15. yy sahnelerinde **fes** (19. yy) ve **modern ay-yıldızlı bayrak**
gibi dönem hataları görüldü. Senaryoda: "Urban'ı İstanbul'a getirtti" (doğrusu Edirne'ye), girişte "21 yaşında tahta"
ile 1. bölümde "19 yaşında" çelişkisi.

## Puan kartı (1–5)

| # | Kriter | Referans ~ | Atölye (Fatih) | Fark | Kapatmak için gereken iş |
| --- | --- | --- | --- | --- | --- |
| 1 | Hook | 5 | 1 | 4 | Hook şablonu: ilk 10 sn soru/çatışma, ilk 30 sn vaat; QC denetimi |
| 2 | Görsel değişim sıklığı | 5 (tahmin) | 1 | 4 | Remotion sahne planı: satır başı kadraj/poz/zoom; tempo denetleyici (≤6 sn ölü kadraj yok) |
| 3 | Karakter animasyonu | 4 | 1 | 3 | Rig'li SVG karakter: idle, göz kırpma, jest, yürüme, şaşırma, eğilme |
| 4 | Ağız senkronu | 3 | 1 | 2 | Rhubarb A–H/X vizemleri, yedek RMS |
| 5 | Diyalog | 5 | 1 | 4 | Oyuncu kadrosu + diyalog odaklı senaryo şablonu (≥%30 sahne diyalog) |
| 6 | Dönem kimliği | 4 | 2 | 2 | Kaynaklı kostüm paketleri (kavuk, sarık, Bizans tacı, zırh); fes/modern bayrak yasak listesi |
| 7 | Arka plan uygunluğu | 4 | 3 | 1 | Stil tutarlı yerel SDXL + Commons arşiv eki, stil birleştirme filtresi |
| 8 | Müzik / duygu uyumu | 4 | 2 | 2 | Sahne duygusu → ruh hali → parça, crossfade, tekrar sınırı |
| 9 | Ses seviyesi / ducking | 4 | 2 | 2 | sidechain ducking + iki geçişli loudnorm −14 LUFS, TP ≤ −1 dBTP |
| 10 | Altyazı | 3 | 2 | 1 | Kelime zamanlı, ≤2 satır, vurgulu yanık altyazı + SRT |
| 11 | Tarihsel doğruluk | 3 | 3 | 0 | Satır başına kaynak notu, "rivayete göre" işareti, ayrı doğrulama geçişi |
| 12 | Lisans / atıf | 4 | 3 | 1 | credits.json → CREDITS.md + YouTube açıklama atfı; NC/ND filtresi |
| | **Toplam** | **48 / 60** | **22 / 60** | **26** | |

## En büyük 5 boşluk (öncelik sırası)

1. **Diyalog ve karakter kadrosu yok** (1, 5): video "anlatılan belgesel", referans "oynanan skeç". → senaryo motoru + cast bible.
2. **Görsel tempo** (2): 20 sn/görsel vs 2–4 sn. → satır güdümlü sahne planı, kamera vuruşları, tempo denetleyici.
3. **Karakter animasyonu + ağız senkronu** (3, 4). → V3 rig + Rhubarb.
4. **Ses**: tek düz ses, düşük loudness, NC lisanslı yerel ses (9). → Chatterbox (owner sesi klonu) + karakter varyasyonları + mix zinciri.
5. **Dönem kimliği ve görsel bütünlük** (6, 7). → kostüm paketleri + stil birleştirilmiş arka planlar.
