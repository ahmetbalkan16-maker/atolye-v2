# AYAS — Fiziksel iPhone Ses Zinciri Test Protokolü

> Bu protokol **yalnızca operatör** tarafından, gerçek bir iPhone'da, kurulu PWA üzerinden
> çalıştırılır. Otomatik testlerin (tsc / eslint / build / 17 smoke suite) hepsi yeşil; geriye
> kalan tek belirsizlik **cihaz davranışı**. Amaç: "3 tur sonra sayfa kendini yeniliyor, sonra
> AYAS sağır" belirtisinin gerçekten kapandığını ölçmek — tahmin etmek değil.
>
> Runtime bu sırada: `npm start` → `:3000`, Caddy `https://192.168.2.74`, Quick Tunnel
> `https://<geçici>.trycloudflare.com`. Execution Gate **CLOSED** kalır. Hiçbir adım yazma /
> pipeline / gate değişikliği gerektirmez.

---

## 0. Ön koşullar (operatör, bir kez)

| # | Adım | Doğrulama |
|---|------|-----------|
| 0.1 | Server taze build ile ayakta | PC'de `http://127.0.0.1:3000/login` → 200 |
| 0.2 | Quick Tunnel URL'i telefona iletilmiş | PC'de `https://<url>/login` → 200 |
| 0.3 | iPhone Wi-Fi **kapalı**, mobil veri **açık** (LAN dışı gerçek test) | Safari'de tunnel URL açılıyor |
| 0.4 | `NEXT_PUBLIC_ATOLYE_PWA_SW=on` ile build alınmış | `https://<url>/sw.js` → 200, `Cache-Control: no-cache, no-store, must-revalidate` |
| 0.5 | Eski kurulum varsa: PWA'yı sil, Safari → Ayarlar → Gelişmiş → Web Sitesi Verileri → site verisini temizle | Temiz kurulum |
| 0.6 | Safari'de tunnel URL → giriş yap (`AYAS_ACCESS_KEY`) → `/brain` açılıyor → Paylaş → **Ana Ekrana Ekle** | Ana ekranda AYAS ikonu |

---

## 1. Service worker geçişi — kontrollü (KRİTİK, bu sprintin ana konusu)

Bu, "kendiliğinden yenilenme"nin geldiği yer. Yeni `PwaRegister` davranışı: **görünür ve
etkileşimde olan bir sayfa artık anında yenilenMEZ** — yenileme `pagehide` / sekme gizlenmesine
ertelenir, ve sayfa örneği başına **en fazla bir kez** olur.

| # | Adım | Beklenen | Başarısızlık |
|---|------|----------|--------------|
| 1.1 | Kurulu PWA'yı **ilk kez** aç (v3 worker devralırken) | Sayfa açık kalır; **anında reload YOK**. Alt bilgi/konsol "reload deferred" gibi bir iz bırakabilir | Sayfa gözünün önünde yeniden yükleniyorsa → FAIL |
| 1.2 | 3–4 saniye bekle, AYAS arayüzü etkileşilebilir | Presence kartı normal | — |
| 1.3 | PWA'yı arka plana al (ana ekrana dön) ve geri aç | Şimdi (gizliyken) reload olabilir — bu **kabul edilir ve tek seferliktir** | Her ön plana alışta tekrar tekrar reload → FAIL (loop) |
| 1.4 | `/brain/voice-lab/wake` aç → `d2w-lifecycle` bloğu | "Reload cause" = `sw-update` (kırmızı "SESLİ OTURUM KESİLDİ" **değil**, çünkü henüz ses oturumu başlamadı), "Boot count" ≥ 2 | `eviction-suspected` yazıyorsa → §5'e not düş |

---

## 2. İlk uyandırma (birinci tur)

| # | Adım | Beklenen |
|---|------|----------|
| 2.1 | `/brain` → "Sesli oturuma başla" / mikrofon CTA'sına dokun | İzin istemi (ilk sefer) → **İzin ver** |
| 2.2 | "AYAS" de | Presence "dinliyor / '\"AYAS\" bekleniyor (eller serbest)'" → wake yakalanır |
| 2.3 | "Atölye'de kaç proje var" | STT → AYAS cevabı: **"16 proje"** civarı (byStatus: 6 completed, 2 assembly, 2 draft, 2 research, 2 script, 1 scenes, 1 visuals) |
| 2.4 | AYAS sesli cevap verir (TTS) | Konuşma duyulur |
| 2.5 | TTS biter | ~1 sn içinde tekrar "AYAS" bekler duruma döner ("re-arm") |

---

## 3. Uzun oturum — reload ve sessiz ölüm avı (10 tur / ~10 dk)

Turları arka arkaya yap. **Her 3. turdan sonra** özellikle dikkat et (belirti oradaydı).

| Tur | Komut örneği | Her turda kontrol |
|-----|--------------|-------------------|
| 1 | "kaç proje var" | cevap geldi, TTS çaldı, re-arm oldu |
| 2 | "en son hangi proje başarısız oldu" | "mimar-sinan … visuals … VISUAL_ASSET_GENERATION_FAILED" |
| 3 | "runtime authority neresi" | "D:\\AtolyeRuntime" |
| 4 | "kaç proje tamamlandı" | "6" |
| 5 | "Süleymaniye projesi hangi aşamada" | "scenes" |
| 6 | "kaç proje research aşamasında" | "2" |
| 7 | "blocked proje var mı" | "0 / yok" |
| 8 | "kaç proje assembly aşamasında" | "2" |
| 9 | "Fatih projelerinden kaç tane var" | 5 |
| 10 | "kaç proje taslak halinde" | "2" |

**Her tur için işaretle (10 satır):**

```
Tur __ : wake[ ]  STT[ ]  AYAS-cevap[ ]  TTS[ ]  re-arm[ ]   | reload gördün mü? E/H   | presence "kesildi" uyarısı? E/H
```

**BAŞARI KRİTERLERİ (hepsi sıfır olmalı):**

- **0** beklenmeyen reload (sen yenilemeden sayfa yenilendi)
- **0** sessiz wake ölümü ("AYAS" diyorsun, hiçbir şey olmuyor, hata da yok)
- **0** izin yeniden sorma (2.1'den sonra bir daha mikrofon izni istenmemeli)
- **0** çift mikrofon (iOS'ta üstte "mikrofon kullanılıyor" turuncu nokta tek olmalı, kayıt göstergesi çoğalmamalı)
- **0** kalıcı suspended AudioContext (TTS'ten sonra wake geri gelmiyor kalıcı olarak)
- **0** takılı faz (Voice Lab `phase` sürekli `processing` / `speaking`'de kalıyor)
- **0** recovery loop (`d2w-lifecycle` "recovery count" durmadan artıyor; presence "toparlıyor"da kilitli)

---

## 4. Yaşam döngüsü kenar durumları

| # | Senaryo | Adım | Beklenen |
|---|---------|------|----------|
| 4.1 | Ekran kilidi | Bir tur ortasında telefonu kilitle, 20 sn sonra aç | Kilit açılınca AYAS ya toparlanır ("bağlantıyı toparlıyor" → wake) ya da "devam et" CTA'sı gösterir. Sağır kalmamalı |
| 4.2 | Safari arka plan | PWA'dan çık, 30 sn başka uygulama, geri dön | Ses oturumu kesilmişse presence **"Sesli oturum kesildi (sayfa yeniden yüklendi). Devam etmek için dokun."** + CTA "Sesli oturuma devam et"; dokun → temiz re-arm |
| 4.3 | Uçak modu (offline) | Bir tur sırasında mobil veriyi kapat | AYAS dürüst "çevrimdışı" davranışı; sahte "online" yok. Veri geri gelince tekrar çalışır |
| 4.4 | Hızlı başlat/durdur | CTA'ya 5 kez arka arkaya dokun | Çift mikrofon / çift AudioContext yok; tek oturum |
| 4.5 | Gerçek eviction (varsa) | Oturum aktifken 5+ dk telefonu beklet
 (ağır bellek) sonra dön | Reload olursa presence "kesildi" uyarısı + CTA çıkmalı; `d2w-lifecycle` "reload cause" = `eviction-suspected` |

---

## 5. Sonuç raporu (operatör doldurur)

```
TARİH / SAAT       :
iOS SÜRÜMÜ         :
TUNNEL URL         :  (geçici — kayda değer değil)

§1 SW GEÇİŞİ       : anında reload GÖRÜLDÜ mü? E/H   | loop? E/H
§2 İLK TUR         : PASS / FAIL   (not: ______)
§3 10 TUR          : reload sayısı ___ | sessiz ölüm ___ | izin tekrar ___ | çift mic ___
                     | kalıcı suspend ___ | takılı faz ___ | recovery loop ___
§4.1 EKRAN KİLİDİ  : PASS / FAIL
§4.2 ARKA PLAN     : PASS / FAIL   ("kesildi" uyarısı çıktı mı? E/H)
§4.3 OFFLINE       : PASS / FAIL
§4.4 HIZLI TAP     : PASS / FAIL
§4.5 EVICTION      : reload? E/H   | d2w-lifecycle "reload cause" = __________

VOICE LAB JSON     : (Export → yapıştır — özellikle "lifecycle" bloğu)

GENEL             : READY / NOT READY
EĞER NOT READY    : hangi kriter, hangi turda, d2w-lifecycle ne diyordu:
```

---

## 6. NOT READY ise — sonraki adım kararı

- **reload hâlâ oluyor, cause = `sw-update`** → `controllerchange` yolu hâlâ tetikleniyor;
  `PwaRegister` erteleme mantığında bir kaçak var VEYA `sw.js` `skipWaiting` zamanlamasını
  değiştirmek gerekiyor (bir sonraki sprint: `v3` worker'ı `skipWaiting`'i **mesajla** yapacak
  şekilde — otomatik değil).
- **reload oluyor, cause = `eviction-suspected`** → bu SW değil, WebKit süreç tahliyesi. Kod
  tarafında önlenemez; çözüm zaten yerinde (kesildi uyarısı + tek-dokunuş resume). Kabul
  edilebilir davranış olarak işaretle.
- **reload yok ama wake 3. turdan sonra ölüyor** → `wakeWordVoiceAdapter` watchdog / `resumeOrRebuild`
  bölgesine dön (`cd20d9a` sprintinin konusu); `d2w-lifecycle` "last phase" + "recovery count"
  kanıtıyla.
- **çift mikrofon** → `useBrainLifecycle` `markVoiceActive` veya `startConversation` iki kez
  `toggleListening` çağırıyor; presence CTA idempotency'sine bak.
