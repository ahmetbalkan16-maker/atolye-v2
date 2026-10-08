# Karar 5 — Fiverr: resmî dışa aktarım ve salt okunur kanıt planı

**Durum: PLAN HAZIR / OWNER DOSYASI BEKLENİYOR / HİÇBİR TİCARİ İŞLEM YAPILMADI.** Sahte sipariş, kazanç, müşteri etkileşimi veya otomatik işlem yok. Fiverr hesabına bağlanılmadı; kimlik bilgisi istenmiyor.

## Mevcut owner-handoff mekanizması (kaynakta doğrulandı)

| Modül | Ne yapar | Ne yapmaz |
|---|---|---|
| `AyasFiverrManualAdapter.ts` | `MANUAL_HANDOFF`, `credentialHandling: NONE`; yalnız yerel ilan, mesaj ve teslimat taslağı | API bağlantısı yok (tasarım gereği) |
| `AyasFiverrOwnerHandoff.ts` | Taslağı owner'ın elle yapacağı işe çevirir. Owner "yaptım" derse `OWNER_REPORTED_UNVERIFIED` olarak işaretler | Yetki üretmez, tamamlanmayı doğrulamaz |
| `AyasFiverrOwnerFacts.ts` → `importAyasFiverrOwnerSnapshot` | Owner raporunu katı biçimde içe alır: `ACCOUNT` / `ANALYTICS` / `ORDERS`. En fazla 24 saatlik gözlem; siparişler yalnız özet (`orderDigest`) ve durum olarak | Ham sipariş numarası, müşteri adı veya tutar saklamaz; dosya yazmaz |
| `AyasFiverrOwnerFacts.ts` → `mapAyasFiverrOwnerEconomics` | Tek siparişin brüt/komisyon/net/ödeme durumunu ledger **girdisine** çevirir | Ledger'a yazmaz (`appendsLedger: false`) |
| `AyasRevenueLedgerStore.ts` | Stage 16.2 açık-kök ledger deposu (`data/brain/revenue/ledger.json`) | Bugün dosya yok. Combined audit'te `STORE_ABSENT:revenue` |

Bu modülleri kullanan bir CLI veya ekran **yok**; yalnız smoke testleri çağırıyor. Yani mekanizma saf fonksiyonlar olarak hazır, ama owner'ın dosyasını işleyen bir giriş noktası yok. İlk kanıt için yeni kod gerekmez: aşağıdaki adım 3 tek seferlik bir yerel komutla yapılabilir.

Ek bulgu: `data/brain/revenue/` `.gitignore`'da değil. Ledger ilk kez yazıldığında repo kirli görünür ve AYAS cleanliness kapılarını durdurur. Ledger yazımından önce bu satırın eklenmesi gerekir (küçük, ayrı değişiklik).

## Owner'dan gereken — tam liste

**Önce tek soru: Fiverr'de şu ana kadar en az bir sipariş (tamamlanmış, iptal edilmiş veya süren) var mı?**

### A) Sipariş yoksa

- Gerekli: yazılı bir cümle: "Fiverr'de sipariş yok; N05 kanıtı ertelensin." Ekran görüntüsü isteğe bağlı (Siparişler sayfası boş).
- Sonuç: register'ın izin verdiği **owner-reviewed deferral**. Kapsam, gerekçe ve yeniden değerlendirme koşulu (ilk sipariş geldiğinde) yazılır. N05/N_LIVE açık kalır.
- Bu bir gelir kanıtı değildir; yalnız ertelemedir.

### B) Sipariş varsa

1. **Resmî dışa aktarım:** Fiverr satıcı panelinde kazanç/gelir sayfasının indirilebilir raporu (CSV/PDF) veya sipariş başına resmî belgeler. Menü adları arayüze göre değişebilir; elinizde hangisi varsa. Rapor şunları içermeli:
   - sipariş tarihi ve durumu (tamamlandı / iptal / sürüyor);
   - brüt tutar, Fiverr komisyonu, net;
   - kullanılabilir hale gelme tarihi ve varsa çekim;
   - para birimi.
2. **Dosyayı repo dışına koyun.** Örnek: `C:\Users\Metod\AyasPrivate\fiverr\` (repo veya `runtime\` içine değil). Yolu bana yazmanız yeterli; dosyayı sohbete yapıştırmayın.
3. **Ajanın yapacağı, salt okunur:**
   - dosyanın SHA-256'sını alır;
   - sipariş numaralarını tuzlu özetlere çevirir;
   - `importAyasFiverrOwnerSnapshot` ve `mapAyasFiverrOwnerEconomics` ile doğrular;
   - Git'e yalnız maskelenmiş özet yazar: sipariş sayısı, durum dağılımı, para birimi bazında toplamlar, dosya digest'i.
   - Müşteri adı, mesaj, ham sipariş numarası ve dosyanın kendisi Git'e girmez.
4. **Siz özetin digest'ini incelersiniz.**
5. **Ayrı onayınızla** ledger'a ekleme yapılır (Stage 16.2 store; önce `.gitignore` satırı). Bu onay verilmeden ledger'a hiçbir şey yazılmaz.

### Hesap tarafında yapmanız gereken başka bir şey yok

- Parola, API anahtarı veya oturum çerezi gerekmez.
- Müşteriye mesaj atılmaz; Gig değiştirilmez.

## Sınırlar

- Owner'ın verdiği dosya `OWNER_REPORTED` kanıttır. Fiverr ile çapraz doğrulama yapılamaz (API yok).
- Ticari erteleme veya kanıt; auth, authority, no-replay, korunan kapsam veya writer attribution açıklarını kapatmaz.
- MP4 üretim hattı Fiverr'e bağlı değildir. Atölye işi beklemez.
