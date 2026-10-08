# Recovery9 — bağımsız yeniden doğrulama, canlı risk ve owner karar seçenekleri

**Uygulanmadı. Dokuz kayıt `RECOVERY_REQUIRED` olarak açık; karar aktörü UNKNOWN.** Bu belge Codex teşhisini (`../STAGE17_RECOVERY9_DIAGNOSIS_20261008.md`) yeniden üretmez; canlı depolarla salt okunur olarak yeniden doğrular. Hiçbir kayıt silinmedi, tekrar çalıştırılmadı, APPROVE/DONE yapılmadı. Ölçümler [V1_CLOSURE_CLAUDE_20261008.json](V1_CLOSURE_CLAUDE_20261008.json) içindedir.

## Yeniden doğrulama (2026-10-08 13:48Z, salt okunur)

- Inbox: 211 öneri. 172 STALE, 28 COMPLETED, **9 RECOVERY_REQUIRED**, 1 ABANDONED, 1 PENDING. Revision 540.
- `RECOVERY_REQUIRED` olan **tam olarak bu dokuz** kayıt; dokuzu da benzersiz kimlikli, her biri inbox'ta bir kez. Dokuzun dışında `RECOVERY_REQUIRED` yok.
- Dokuz execution journal'ının SHA-256'sı Codex teşhisindeki değerlerle **byte olarak aynı**; faz hâlâ `RECOVERY_REQUIRED`.
- Inbox'ın bütün hash'i teşhisten beri değişti (`60fb1745…` → `fa32ef35…`). Bu, daemon'un normal STALE/PENDING güncellemeleridir; dokuz kayıt ve journal'ları değişmedi.
- İki yayın commit'i (`88d662e`, `97cb6e9`) HEAD'in atasıdır; ikisi de yalnız `scripts/` altındaki test dosyalarında assert mesajı ekler.
- **Yeni bulgu:** beş "chat" kaydının (`40ff181b`, `e89f94d1`, `0dd94880`, `40bccc69`, `dc9045d9`) önerdiği bayt değişikliği bugün HEAD'de var. Ama bu dokuzdan biri yüzünden değil: aynı içerik ayrı, onuncu bir öneriyle (`ayas-proposal-18c15af4…`, inbox'ta COMPLETED) `580bbab` commit'iyle (25 Eylül) yayınlanmış. O önerinin karar kaydında da aktör alanı yok.
- Aynı proposalHash'i paylaşan iki kardeş kayıt (`e7ff295b`, `c6c026de`) 24 Eylül tarihli, hiç yürütülmemiş, STALE. 24 Eylül'den beri dokuzdan herhangi biriyle aynı hash'li yeni öneri yok.
- Tek PENDING öneri (`af050afa…`, bugün 13:27Z) yeni dedup smoke dosyasına assert mesajı ekleyen yeni bir SAFE önerisidir; recovery tekrarı değildir.
- `scripts/smoke-ayas-recovery-proposal-dedup.ts` yeniden çalıştırıldı: **PASS (6 senaryo)**. Çalıştırmadan sonra repo temiz ve inbox hash'i aynı.
- Discovery, daemon her tick'te yeni bir çocuk süreç (`ayas-discovery-daemon.ts`) olarak başlattığı için güncel kaynağı yükler. Ana daemon süreci 06:44'te, `2155813` dedup düzeltmesinden önce başlamış olsa da düzeltme discovery için etkindir.

## Canlı güvenlik riski — sonuç

**Dokuz kayıt canlı bir yürütme/istismar riski taşımıyor; kanıt:**
1. **Tekrar çalışamazlar:** `RECOVERY_REQUIRED` yeniden karar verilemez bir durumdur (store sözleşmesi). Yetkileri harcanmış, otomatik replay politikası 14 fazın hepsinde kapalı (Codex politika testi). Dedup PASS.
2. **Etkileri test dosyalarıyla sınırlı:** yayınlanan iki değişiklik ve beş chat değişikliğinin içeriği yalnız `scripts/smoke-*` dosyalarında assert mesajlarıdır. Next build'ine, runtime'a, authority'ye girmezler. İki deney (`a5508567`, `ec47b32a`) validator'da düştü; ledger rollback kaydı var ve güncel kaynak onların yerine koyma baytlarıyla eşleşmiyor.
3. **Kalıntı yok:** ana worktree temiz; canlı build `e974614` CLEAN. Discovery sandbox worktree'lerinde (`%TEMP%`) 5–8 Ekim tarihli kalıntılar var. Bunlar dokuzla ilgili değil; ikisi sızmış sandbox (temizlik hijyeni bulgusu). Dokunulmadı.

**Açık kalan gerçek risk bir denetim boşluğu, istismar değil:** karar kayıtlarında aktör/oturum alanı **hiç yok**. Bu yalnız tarihsel dokuz için değil, bugünkü bütün kararlar için de geçerli (en son karar 2 Ekim; alanlar: decidedAt, decision, decisionId, evidenceFingerprint, proposalHash, proposalId, reason). Canlı `.env.local` içinde `AYAS_AUTONOMOUS_EXECUTION_ENABLED=1` olduğu için, owner'ın Gelişim Merkezi'ndeki tek APPROVE tıklaması SAFE öneriyi hemen yürütür, test eder, commit'ler ve push'lar. Cookie oturum kapısı bu eylemi korur; ama hangi oturumun onayladığı kaydedilmez.

## Her kayıt için owner'ın verebileceği güvenli karar

Ortak kural: aktör UNKNOWN kalır. Ham `RECOVERY_REQUIRED` silinmez, replay/APPROVE/DONE yoktur, yeni yetki doğmaz. Önerilen yol **yalnız Git'te, digest'e bağlı owner inceleme kaydıdır** (runtime'a yazım yok, yeni kod yok). Runtime görünümünün değişmesi (UI'da "uzlaştırıldı" göstermek) ayrı bir append-only receipt paketi ister; o paket henüz yok.

| Kayıt | Gerçek etki | Önerilen güvenli karar |
|---|---|---|
| `a45f13ae` | `88d662e` ile yayınlandı (test assert mesajı) | KABUL: yayın etkisi bilindi, yetki kanıtsız, kayıt açık tarihsel borç |
| `412d8553` | `97cb6e9` ile yayınlandı (test assert mesajı) | KABUL: aynı |
| `40ff181b`, `e89f94d1`, `0dd94880`, `40bccc69`, `dc9045d9` | Kendi sonuç kayıtları yok. Aynı baytlar ayrı öneri `18c15af4` / `580bbab` ile yayında | KABUL: etki ayrı yayınla örtüşüyor, kendi yürütme sonucu bilinmiyor; replay yok |
| `a5508567`, `ec47b32a` | Validator düştü, ledger rollback; güncel kaynakta yok | KABUL: geri alındı, yetki kanıtsız |

Owner her satır için **KABUL / AÇIK BIRAK / EK KANIT İSTE** diyebilir. Hiçbir seçenek tarihsel kaydı kapatmaz veya çalıştırmaz.

## Owner'a ayrıca sorulan karar

Karar kayıtlarına authenticated oturum/aktör bağlamı eklemek (Codex önleme tasarımı madde 9) V1 için **zorunlu sertleştirme** mi, yoksa belgelenmiş **kabul edilmiş borç** mu? Öneri: V1 öncesi küçük, testli bir paket. Gizli değer yerine oturum yönetiminden türetilmiş gizli olmayan bir admission kimliği kaydedilir. Alternatif olarak, kapanış ve Full166 penceresi boyunca owner Gelişim Merkezi'nde APPROVE vermez. Bu korunan kod alanında bir değişikliktir ve ayrı açık onay ister; bu oturumda uygulanmadı.
