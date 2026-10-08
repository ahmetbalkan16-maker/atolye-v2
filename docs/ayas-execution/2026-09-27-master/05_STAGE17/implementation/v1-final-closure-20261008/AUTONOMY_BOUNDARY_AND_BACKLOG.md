# AYAS kendi kendini geliştirme — mevcut sınırlar ve bakım backlog'u

**Yeni daemon, ikinci geliştirme motoru veya yeni otonomi mimarisi kurulmadı.** Mevcut mimari istenen döngüyü zaten sağlıyor; aşağıdaki sınırlar kaynakta ve canlı yapılandırmada doğrulandı. Gelecekteki iyileştirmeler V1 şartı değildir, bakım backlog'una taşındı.

## İstenen döngü — mevcut karşılığı

| İstenen | Mevcut mekanizma |
|---|---|
| Eksiklerini gözlemlemek | Autonomy daemon her tick'te `ayas-discovery-daemon.ts`'i yeni bir çocuk süreç olarak çalıştırır (güncel kaynak yüklenir). Detector'lar (ör. `diagnostic-quality-gap-v1`) ve araştırma/deney kayıtları |
| Geliştirme fikri üretmek | `createProposal`: hedef, gerekçe, risk, beklenen fayda, dosya kapsamı, test planı, maliyet `zero-cost` |
| Graphify ile etki incelemek | Öneride `graphifyEvidence`; yürütmede `AyasBatchGraphifyCheck` / Graphify evidence store; repo kirli veya Graphify bayatsa daemon öneri üretmez |
| İzole ortamda test | Discovery sandbox worktree'leri (`%TEMP%`), research experiment sandbox (`AYAS_AUTONOMOUS_EXECUTION_ENABLED=0` ile) |
| Kanıtlı paket hazırlamak | Hash'li patch artifact + `proposalHash` + exact patch safety proof; golden vault regresyon kapısı |
| Owner onayına sunmak | Gelişim Merkezi inbox'ı (PENDING); iç inceleme yalnız REJECT/LATER verebilir |
| Geçmiş ve backlog takibi | `approval-inbox.json` (211 öneri, 53 karar, 28 sonuç), discovery-runs ledger, execution journal'ları |

## Sınırlar — doğrulama

| Sınır | Kanıt |
|---|---|
| Kendi APPROVE'unu veremez | `AyasAutonomousReview` yalnız `REJECT`/`LATER` çağırır. APPROVE yolları owner kaynaklıdır (`decideAyasOwnerApproval`, micro-batch onayı) ve cookie oturum kapısının arkasındaki server action'lardan gelir. Store SAFE olmayan APPROVE'u reddeder (`AYAS_INBOX_UNSAFE_APPROVAL`) |
| Owner yetkisi oluşturamaz | Onay = owner kararı; harcanmış yetki yeniden kullanılmaz; spent authorization/reservation zinciri |
| İzinsiz canlı yayın yapamaz | Yayın yalnız owner APPROVE'undan sonra mevcut guarded publication yolundan. Canlı deploy/restart ayrı owner onayı |
| Finansal işlem başlatamaz | Revenue adapter'larında `financialOperationsAutonomous: false`; Lemon GET-only ve `liveDefault: CLOSED`; Fiverr manual handoff; revenue credential yapılandırılmamış |
| Ücretli servis açamaz | Öneri maliyeti `zero-cost`; zero-cost policy suite'i; yerel Ollama |
| Güvenlik kapılarını değiştiremez | Golden vault modül dizini ve bir kez pinlenmiş her grader otonom değişikliğe kapalı (`AYAS_GOLDEN_VAULT_MODULE_DIR`, `AYAS_GOLDEN_VAULT_PINNED_FILES`); `BrainPatchSafety` sınıflandırması; action firewall closure |
| Belirsiz yürütmeyi tekrar çalıştıramaz | `RECOVERY_REQUIRED` yeniden karar verilemez; recovery policy otomatik replay'i 14 fazda da reddeder; aynı hash'li yeniden keşif bastırılır (dedup PASS) |

## Owner'ın bilmesi gereken iki gerçek

1. **`AYAS_AUTONOMOUS_EXECUTION_ENABLED=1` canlı `.env.local` içinde açık.** Owner'ın tek APPROVE tıklaması SAFE öneriyi hemen yürütür, test eder, commit'ler ve **push'lar**. Bu, CLAUDE.md'deki dar owner istisnasıdır, AYAS'ın kendi yetkisi değildir. Ama kapanış penceresinde bir APPROVE HEAD'i değiştirir ve final Full166'yı geçersiz kılar. Öneri: final teknik HEAD dondurulduktan bakım penceresi bitene kadar Gelişim Merkezi'nde APPROVE verilmez. Şu an 1 PENDING öneri var (`af050afa…`).
2. **Karar kayıtlarında aktör/oturum alanı yok** (bkz. [RECOVERY9_LIVE_RISK_REVIEW.md](RECOVERY9_LIVE_RISK_REVIEW.md)). Onayların hangi oturumdan geldiği denetlenemez. V1 sertleştirmesi mi kabul edilmiş borç mu, owner kararı.

Daemon'un kendi lease/execution gate'i `CLOSED` (29 Eylül'den beri); owner one-click yolu bu gate'i kullanmaz.

## Bakım backlog'u (V1 şartı değil)

Öncelik sırasıyla; her biri ayrı, owner onaylı, testli küçük paket:
1. Onay kayıtlarına authenticated oturum/admission bağı (owner V1 zorunlu sayarsa öne alınır).
2. Writer-quiesced combined audit veya writer journal'ı (F98 attribution).
3. Lemon TEST ingress route'u + durable dedupe/journal (owner Lemon'u ertelemezse).
4. Sızmış discovery sandbox worktree'lerinin ve 27 eski `%TEMP%\ayas-eval-baseline-*` fixture'ının güvenli temizliği. Fixture'larda gerçek `node_modules`'a junction var: önce junction `rmdir` ile kaldırılır, asla junction üzerinden özyinelemeli silme yapılmaz.
5. F97 genel Türkçe/morfoloji/öneri kalitesi; küçük model durum iddiaları.
6. Graphify semantic zenginleştirme ve PowerShell parser açığı.
7. Recovery9 için append-only reconciliation receipt store'u ve UI projeksiyonu (owner isterse).
8. Atölye pipeline: ses mastering (−14 LUFS), gerçek bölüm zaman damgaları, 16:9 küçük resim, cümle düzeyi altyazı (bkz. [ATOLYE_FATIH_REVIEW.md](ATOLYE_FATIH_REVIEW.md)). Bunlar AYAS değil Atölye işidir ve video üretimine doğrudan fayda sağlar.

Yeni geniş özellik sprinti açılmadı.
