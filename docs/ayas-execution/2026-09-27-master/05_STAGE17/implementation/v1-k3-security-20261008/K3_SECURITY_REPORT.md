# K3 kaynak güvenlik düzeltmesi — 8 Ekim 2026

Owner'ın bu oturumdaki açık kapsam ve oturum politikası uygulanacak exact adaydır. Eski bc9f5fd on dosyalık patch körlemesine kaynak terfisi yapılmadı; önce remote'suz izole kopyada revize edildi.

Patch SHA256: c686697bd65c2832c47b00b414d1e2cac93b0a8992b8a18f494c9cd0ec7f4c4c
14 kaynak/test dosyası content-map SHA256: 67dba940dd1a431a04f4a9a12684bebd99bb476d96c98f1ae1e467d1d3018f28
Başlangıç: e4c5132; kaynak terfisi/yerel commit sonucu sonraki checkpoint kaydına bağlanır. Yeni kaynak commit push yetkisi YOK.

## Son davranış

- Yeni login'lerde Web Crypto ile 256-bit nonce; aynı saniyedeki login'ler ayrı sessionRef üretir. Önceki imzalı cookie genel erişimde geçerlidir. Benzersiz oturum kanıtı isteyen ayrıcalıklı kararda yeniden login gerekir.
- Owner kararında admission seal, exact subject/action, kullanılmamış actionRef, freshness ve karar anındaki session expiry doğrulanır. Decision/authorization bağlantısı aynı mevcut access key'in ayrı domain HMAC'iyle korunur; ikinci approval altyapısı kurulmaz.
- Tarihsel APPROVE rızası geçerli mühürle korunur. Yeni manuel EXECUTE ayrı doğrulanmış admission/actionRef/sessionRef ile reservation'a bağlanır. Aynı owner'ın farklı doğrulanmış oturumu kabul edilir; eski APPROVE tekrar yürütme admission'ı olamaz.
- Combined açık owner action da APPROVE ve EXECUTE cookie doğrulamalarını ayrı üretir; yürütme servisleri tarihsel APPROVE fallback kullanmaz. Proposal ve micro-batch aynı mevcut reservation/daemon/firewall yolunu kullanır.
- Default production APPROVE/reservation fail-closed; mevcut iç REJECT/LATER atıfsız korunur. Explicit owner-action depolarında bütün kararlar admission ister. Eski Recovery9 kayıtlarına kimlik eklenmez.
- Daemon journal/reservation öncesi ve asenkron gate sonrası mutation callback öncesi mühür, güncel oturum, exact subject ve decision/authorization/reservation/provenance bağlarını tekrar doğrular. Journal hem APPROVE hem EXECUTE sessionRef kayıtlarını taşır.
- Resume güncel EXECUTE ve açık server-side manuel owner action olmadan state okumadan döner. Unattended CLI otomatik commit/push başlatamaz. Exact proof yayın dışı kalır; yeni Homepage öğesi yok.

## Kanıt

İzole güvenlik smoke 35/35 PASS; ayrı fresh-lock Next16.3.8 ortamında da 35/35 PASS. TypeScript exit0, dar kapsam ESLint exit0. 214 frozen pin değişmedi; manifest bu K3 aşamasında v58.

İlgili 15 frozen suite PASS. Ek iki manifest dışı eski smoke FAIL: autonomous-execution-gate-current ve owner-approval-resume-current otomatik resume ile bir attempt bekliyor; yeni owner politikası sıfır attempt gerektiriyor. Raw FAIL saklanır; testler veya beklentileri değiştirilmedi. Bunlar PASS olarak raporlanmaz.

Negatif mutation kayıtları: 11 uygulamadan 10 anlamlı güvenlik kontrolü KILLED; M4 yalnız redundant decision guard kaldırdığı için SURVIVED (diğer action/subject guard hâlâ tarihsel APPROVE'u reddeder). Tarihsel APPROVE replay'in tam sınırını bozan M11 KILLED. Tüm kaynak byte'ları restore hash/byte kontrolüyle doğrulandı. SURVIVED gizlenmez; bütün 11 kontrol PASS iddiası yoktur.

Bağımsız incelemenin ilk iki P2 bulgusu internal REJECT/LATER uyumu ve combined APPROVE resume replay idi; ikisi giderildi ve yeniden kontrol edildi. Exact son digest'e bağlı bağımsız rapor ayrı dosyadadır.

Sıfır kalıcı etki negatif kanıtı yalnız test edilen store/daemon sınırları içindir. Üst katmanın mevcut trace/staleness kayıtları farklıdır. Yerel kabuk ve access key'i birlikte ele geçiren saldırgana karşı koruma iddiası yoktur.

## Kapanış sınırları

Canlı runtime kaynak/build kimliği önceki e974614; bu kaynak düzeltmesi deploy edilmiş sayılmaz. Canlı restart, Next yükseltmesi, APPROVE, authority/runtime yazısı, payment/customer action, render veya YouTube upload yapılmadı. Foundation ve AYAS V1 BLOCKED; F98/Recovery9/Lemon/Fiverr kanıtları korunur.
