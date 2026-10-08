# Recovery9 — son owner karar tablosu, 8 Ekim 2026

**Dokuz raw RECOVERY_REQUIRED korunur; otomatik toplu kapatma/replay yok.** [Ek kanıt](RECOVERY9_EK_KANIT.json), [Codex exact hash doğrulaması](RECOVERY9_CODEX_VERIFY.json) ve önceki [risk incelemesi](../v1-final-closure-20261008/RECOVERY9_LIVE_RISK_REVIEW.md) birlikte okunur.

53 kararın hiçbirinde actor/session alanı yok; login audit yokluğu nedeniyle aktör geri kazanılamadı. Timing/reason/commit/path kişi kanıtı değildir. Owner sonradan açıklama verirse ancak OWNER_STATEMENT_UNVERIFIED olarak ayrıca kayıt edilir; UNKNOWN alanı geçmiş yetki varmış gibi değiştirilmez.

| Proposal | Etki kanıtı / sınırı | Aktör | Owner disposition |
|---|---|---|---|
| ayas-proposal-a45f13ae-c9c9-438d-87ee-1a30b4222e8e | Tarihsel yayın commit’i korunur | UNKNOWN | EK KANIT HAZIR / OWNER İNCELEMESİ BEKLİYOR |
| ayas-proposal-40ff181b-c5da-4bb4-a22a-c46870318cc7 | Bu kayıt yayın yapmadı; Graphify FAIL / kaynak revert yolu; sonraki ayrı yayın korunur | UNKNOWN | EK KANIT HAZIR / OWNER İNCELEMESİ BEKLİYOR |
| ayas-proposal-e89f94d1-dfdf-4b88-976a-9adcf9821f96 | Bu kayıt yayın yapmadı; Graphify FAIL / kaynak revert yolu; sonraki ayrı yayın korunur | UNKNOWN | EK KANIT HAZIR / OWNER İNCELEMESİ BEKLİYOR |
| ayas-proposal-0dd94880-a665-4f6f-ad17-9247977f3632 | Bu kayıt yayın yapmadı; Graphify FAIL / kaynak revert yolu; sonraki ayrı yayın korunur | UNKNOWN | EK KANIT HAZIR / OWNER İNCELEMESİ BEKLİYOR |
| ayas-proposal-40bccc69-6093-4c69-9824-7ce24b47cec4 | Bu kayıt yayın yapmadı; Graphify FAIL / kaynak revert yolu; sonraki ayrı yayın korunur | UNKNOWN | EK KANIT HAZIR / OWNER İNCELEMESİ BEKLİYOR |
| ayas-proposal-dc9045d9-0227-4563-8e47-06ff38777f53 | Bu kayıt yayın yapmadı; Graphify FAIL / kaynak revert yolu; sonraki ayrı yayın korunur | UNKNOWN | EK KANIT HAZIR / OWNER İNCELEMESİ BEKLİYOR |
| ayas-proposal-412d8553-58fb-4a38-becd-4a852e18a918 | Tarihsel yayın commit’i korunur | UNKNOWN | EK KANIT HAZIR / OWNER İNCELEMESİ BEKLİYOR |
| ayas-proposal-a5508567-a34b-4de6-8978-3050408f52dc | Tarihsel validator FAIL / rollback; yeni yürütme yok | UNKNOWN | EK KANIT HAZIR / OWNER İNCELEMESİ BEKLİYOR |
| ayas-proposal-ec47b32a-316c-43e2-8650-0c164ee41ab2 | Tarihsel validator FAIL / rollback; yeni yürütme yok | UNKNOWN | EK KANIT HAZIR / OWNER İNCELEMESİ BEKLİYOR |

Dokuz journal hash'i eski exact bindings ile eşleşir. Inbox revision 542, onaylanmış bekleyen öneri 0; read-only interval'inde inbox hash'i değişmedi. Geçmiş no-live-execution-risk bulgusu bu terminal/reservation ve current-approval sınırlarıyla korunur; gelecekteki bütün AYAS kodu için güvenlik garantisi değildir. Beş Graphify FAIL kaydında kaynak revert yolunun varlığı actual rollback receipt yerine sayılmaz; hiçbiri başarılı terminal execution/DONE'a dönüştürülmez.

Owner her satır için ayrı incele / ek kanıt / açık tut kararını verir. Yayın etkisinin kabulü eski owner yetkisini kanıtlamaz; actor UNKNOWN kalır. Tarihsel veri/journal/authority deposuna bu oturum yazılmadı.
