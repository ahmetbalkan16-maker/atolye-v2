# Exact12 / Golden V3 — Codex handoff doğrulaması, 8 Ekim 2026

**TEMP ADAYI DOĞRULANDI; GERÇEK KAYNAĞA UYGULANMADI.** Kanıt: [TEMP_VALIDATION.json](TEMP_VALIDATION.json), [FULL166_TEMP_c17132b.raw.json](FULL166_TEMP_c17132b.raw.json), [K1_COMBINED_NEGATIVES.json](K1_COMBINED_NEGATIVES.json).

Claude `5e1b0c5` üstünde önce K3 `bc9f5fd`, sonra Exact12 `c17132b` oluşturmuş; Full166 çalışırken oturum bitmiş. Codex aynı testi yeniden başlatmadı. Süreç tamamlandı: **166/166 PASS**, manifest `15F.4-v59`, digest `2661b3c55e60de299b8290b05e5c2bd74f0bb1b1a0967d59c6da88bba4ee3fcd`. Bu yalnız `c17132bcf18b3018cdfb76334d4b8c47772af165` TEMP adayının kanıtıdır. Junction bağımlılığı Next **16.2.10**; lock **16.3.8**. Fresh-lock/final-main/deployment kabulü değildir.

Birleşik adayın altı dosyalık Exact12 diff gövdesi, önceki bağımsız incelenmiş `a4db592` patch gövdesiyle tamamen aynı. Mail envelope/commit kimliği farklıdır; onay nesnesi hâlâ arşivdeki patch SHA-256 `337ec9954de687bbe6d1bd2b4533d05c33164036b959602cecbdf508aa7c6323`. K3 patch'i ayrı nesnedir. Original grader, fixture, evaluation library ve byte-identical V58 arşivi doğrulandı; tarihsel raw FAIL kanıtları korunur.

Claude'un hazırladığı fakat çıktısını bırakmadığı negatif kontrol betiği ayrı, remote'suz `c17132b` kopyasında tamamlandı. Yedi gözlem beklenen sonuçları verdi:

- Temiz V3 PASS; temiz original exit 1 / exact12.
- CF49 slotu kapalı: V3 **12 REGRESSION / FAIL**, exact12 kümesine eşit; original **PASS** (eski körlük tekrar doğrulandı).
- Bir reviewed satır geri eklendi: V3 FAIL / IMPROVED.
- Kalan bir limitation çıkarıldı: V3 FAIL / `syn-pc-colloquial` REGRESSION.
- Floor ölçümün üstüne çıkarıldı: V3 FAIL.

İlk sandbox denemesi fixture yazımında engellendi; [K1_ENVIRONMENT_BLOCKED_ATTEMPT.raw.json](K1_ENVIRONMENT_BLOCKED_ATTEMPT.raw.json) **NOT_QUALIFIED** olarak korunur. Oradaki FAIL'ler negatif kontrol başarısı sayılmaz. Son koşu gerçek assertion sonuçlarını verdi; değiştirilen tüm kaynak byte'ları hash ile geri doğrulandı. Claude'un orijinal TEMP kopyasına yazılmadı.

## Golden promotion / publication delta

Önceki inceleme Golden V3'ün exact reviewed `REVIEW_REQUIRED` deneyi tek owner tıklamasıyla commit/push yoluna açabileceğini söylemişti. Mevcut kaynakta bu iddia **bu özel yol için fazla geniştir**:

1. Golden held kanıtı `AyasExactProposalSafety` kontrolünü yeniden mümkün kılabilir.
2. `AyasAutonomyDaemon.discover` bu durumda SAFE oluştururken `exactPatchSafetyProof` alanını da korur.
3. `AyasAutonomousExecutionGate` bu öneriyi yalnız `APPROVED_PENDING_EXECUTION` olarak kaydeder; otomatik yayın servisine vermez.
4. `AyasProposalApprovalService.loadAyasProposalForPublish` proof taşıyan öneriyi `EXACT_PATCH_LOCAL_EXECUTION_ONLY` ile, karar üretmeden reddeder.
5. `AyasOwnerApprovalResume` proof taşıyan öneriyi atlar. Yerel YÜRÜT ayrı, mevcut governed mutation yoludur; bu wrapper kendi başına commit/push yapmaz.

Bound Full166'da `exact-proposal-safety`, `exact-patch-safety`, `proposal-approval-service` ve firewall suite'leri PASS. `smoke-ayas-exact-proposal-safety.ts` proof'un discovery sırasında korunmasını ve publication refusal sonrası karar sayısının sıfır kalmasını gerçekten doğrular. Bu; bütün gelecekteki deneyler, doğrudan yerel script'ler veya sıradan SAFE öneriler için genel bir yayın güvenliği iddiası değildir. Normal SAFE one-click yolunda commit/push davranışı ve canlı autonomy flag'i korunmaktadır.

## Uygulama şartları

K3 mevcut byte'ları [K3_SOURCE_REVIEW_CODEX.md](K3_SOURCE_REVIEW_CODEX.md) bulguları nedeniyle kaynak terfisine hazır değildir. Önce owner dar düzeltme kapsamını inceler; düzeltilmiş aday digest'i değişirse bağımsız inceleme tekrar gerekir. Exact12'nin koşullu onayı veya bu TEMP PASS, K3 uygulama/deploy yetkisi üretmez.

Gerçek kaynak uygulaması açık owner kapsam kararı, temiz source commit, güncel Graphify, lock ile eşleşen credential-free TEMP bağımlılığı ve son teknik HEAD'de tek final Full166 ister. K3 ek güvenlik testleri manifest dışında kaldığından ayrıca raporlanır. Original raw gate + CF49 review zinciri ayrı korunur; Full166 onları V59'da çalıştırmıyor. Push ve bakım/deploy ayrı kararlardır. Bu oturum hiçbir APPROVE başlatmadı.
