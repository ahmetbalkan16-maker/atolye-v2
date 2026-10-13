# D ÜRETİM güvenli geçişi — 2026-10-14

Owner çalışma kökünü D:\ÜRETİM\Atolye\atolye-v2 olarak belirledi. Yeni kod, rapor, yedek ve geçiş kanıtları D içinde oluşturulur. Telefonda ücretsiz yerel Whisper uyandırması owner tarafından çalışır olarak kabul edildi; wake görevi kapalıdır.

Önceki D denemesinde dosyalar byte-exact taşındı ancak ses descriptor device/inode, publication intent authority binding ve retired workspace identity eski diske bağlı kaldı. Resmi rollback ile C hizmeti geri açıldı. Bu tarihsel denemenin kanıtları korunur.

RuntimeMaterializationProof yalnız resmi target-validated, byteExact geçişin doğrulanmış candidate/backup manifestinden üretilir. Kaynak ve hedef dosyaların SHA-256/byte sayıları, fiziksel kimlikleri, dizin kimlikleri ve authority namespace kaydedilir. Ayrı kontrol düzlemi kanıtının SHA-256'sı transition.targetValidation içine bağlanır. History/payload dosyaları değiştirilmez. Okuyucu bu kanıtı yalnız aktif, yayımlanmış, generation-uyumlu hedef için kabul eder. Yanlış kaynak kimliği/namespace, farklı SHA, aynı byte ile dosya değiştirme, kanıt değişimi ve yayınlanmamış hedef reddedilir. Descriptor open/fstat/hash/post-lstat güvenlik kontrolleri sürer.

Kopyalamak tek başına runtime yetkisi vermez. Yeni bilgisayarda uygulamalar kurulacak ve fiziksel kimlikler resmi restore/geçiş ile yeniden yeterli kılınacaktır. Özel anahtarlar Git'e girmez. Windows ve kurulu programlar taşınmaz.

İlk kod doğrulamaları: TypeScript ve scoped lint başarılı; izole gerçek backup/candidate/consume/transition/materialization smoke başarılı. Canlı D cutover ve bütün mevcut medya doğrulamaları tamamlanana kadar C payload kaldırılmaz.