# Bakım öncesi backup / rollback / risk planı

Durum **PREPARED; backup materialization NOT_RUN; rollback NOT_RUN; maintenance NOT_AUTHORIZED**. Bu belge source push iznini canlı operasyon iznine dönüştürmez. 8 Ekim salt okunur gözlemi: canlı e974614/Next16.2.10; tek port3000 listener, tek cloudflared ve iki Running AYAS görevi. Observer çocukları ile sınıflandırılmamış Node süreçleri var; writer quiescence kanıtlanmadı. C: boş alan gözlemi tek başına kapasite onayı değildir; seçilecek yedeğin boyutu ve disk rezervi ayrıca ölçülür.

## Başlamadan kontrol edilecek kimlikler

- Deploy hedefi owner'ın ayrıca onaylayacağı exact SHA; source push edilmiş 32e59c1 otomatik deploy hedefi değildir. Son yerel belge descendant'ı varsa source eşitliği ve Git farkı kaydedilir.
- Mevcut çalışan build stamp/BUILD_ID, old source commit, installed package manifestleri ve gerçek node_modules bağımlılık ağacı hash'i; yeni lock16.3.8 ile old installed16.2.10 aynı şey değildir.
- Mevcut Access/Autonomy task/config ve tunnel kimliklerinin secretsiz hash'leri; secret/env değerleri agent raporuna veya Git'e kopyalanmaz.
- Mevcut authority/inbox/reservation/journal nesillerinin güvenli yerel hash tanığı. Bakım aralığında aktif/yeni belirsiz execution varsa beklenir/durulur; onay tüketimi yapılmaz. Tarihsel Recovery9 kayıtları owner'ın no-replay kararına göre yerinde korunur; bakım için otomatik çözülmeleri veya aktör eklenmesi istenmez.
- Frozen pins, patch/manifest/source ve önceki receipt hash'leri; yeni HEAD için Full166 otomatik sertifikası yok. Tam exact-HEAD baseline istenirse yeni koşu ve kendi receipt'i gerekir; bu hazırlıkta gereksiz Full166 tekrarı yapılmadı.

## Yedek hazır sayılmasının şartları

1. Owner hedef SHA, bakım kapsamı, geri dönüş sınırı ve durdurma/yeniden başlatma yetkisini açıkça onaylar. Henüz verilmedi.
2. Mevcut backup/restore gate kullanılır; ikinci altyapı kurulmaz. Yedek yolu owner'ın mevcut güvenli yerel storage politikasıyla seçilir, Git/media/proje üretim alanından ayrı kalır. Yedek bu oturumda oluşturulmadı.
3. Observer ve çocukları, Next writer'ları, Access auto-recovery ve ilgili production writer'ları kontrollü olarak quiesce edilir. PID+start-time, inbox/journal ve source/build değişmezliği tanığı alınır. Bu adım mevcut onayla uygulanmaz.
4. Gerçek çalışan eski `.next` ve bağımlılık ağacıyla eşleşen eski source/lock/package kimliği, gerekli mevcut görev/tunnel ayarı ve özel authority metadata güvenli yerel geri dönüş noktasına bağlanır. Secret'lar Git/rapor dışında kalır. Eski16.2.10 için yeni16.3.8 lock'tan `npm ci` yapmak eski sürümü geri getirmez.
5. Dosya envanteri, boyut, before/after SHA ve restore edilebilirlik doğrulanır. Canlı writer varken alınmış veya yalnız varlığı görülen kopya QUALIFIED_ROLLBACK değildir. Mevcut izole dbf9542 build receipt'i canlı rollback kanıtı değildir.

## Durdurma ve geri dönüş

Auth/seal/session regresyonu, yanlış exact SHA/dependency, duplicate origin/tunnel, yeni erişim/sohbet/ses kaybı veya kararsız writer durumunda adım ilerletilmez. Başlamadan yedek/identity/quiescence eksikse **ABORT_BEFORE_DEPLOY**. Deployment başlamışsa yalnız onaylı mevcut recovery mekanizmasıyla eşleşen old build + old dependency/source/task/tunnel noktasına dönülür; geri dönüş kimliği ve 1-7 cihaz kontrolleri yeniden ölçülür. Source HEAD'i veya authority geçmişini körlemesine geri sarma, otomatik finalize/replay ya da actor backfill yok.

Riskler açık: canlı hâlâ eski K3 öncesi kodu çalıştırır; Gelişim Merkezi APPROVE/YÜRÜT başlatılmaz. F98 gerçek writer attribution/combined-domain kanıtı eksik; Recovery9 UNKNOWN actor'ları korunur; Lemon/Fiverr ve gerçek cihaz kanıtları bekler. Rollback readiness ve reboot sonucu şu an NOT_RUN. Hiçbir açık kapı PASS yapılmadı.
