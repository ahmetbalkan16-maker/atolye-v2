# Ayrı temizlik onayı paketi — çalıştırılmadı

Öneri yalnız `CLEANUP_SAMPLE.json` içindeki **10 exact klasör** içindir. Manifest `selectedDigest` kapsamı sabitler; başka klasör bu izinle silinemez. Mevcut 13.552 klasörün tamamı için silme izni istenmiyor.

Önkontrol 9 Ekim 07.07 Türkiye: aktif test süreci 0; doğrudan gerçek TEMP kökü altında, reparse/subdirectory/beklenmeyen dosya 0, iki saatten eski. Sonra testler çalıştığından bu gözlem yürütme izni veya güncel boşta olma kanıtı değildir.

Owner bu manifest için ayrıca onay verirse, silmeden hemen önce şu sınırlar yeniden denetlenir: aynı TEMP kökü ve exact parent; kök/klasör/çocuklarda junction/symlink yok; aktif smoke/eval/tsx veya klasörü adlandıran süreç yok; yalnız beklenen tek katmanlı normal dosyalar; iki saat yaşı; manifestteki dosya listesi ve SHA-256 aynı. Bir koşul eksikse örneğin tamamı durur. Dosyalar yalnız LiteralPath ile tek tek, klasörler özyinelemesiz kaldırılır; en fazla 10, wildcard/recursive toplu silme yok. Yeniden doğrulama ve sonuç makbuzu tutulur.

Etki: disposable test state dosyaları ve boş klasörler kalıcı olarak kaldırılır. Recycle Bin/undo veya yedek garanti edilmez; dosya byte'ları geri alınamaz. Bu öneri sırasında hiçbir dosya silinmedi. Mevcut `GUARD_TEMP_CLEANUP.ps1.txt -Execute` bütün envanteri hedeflediği için bu sınırlı paketle çalıştırılamaz.

Bu iş cihaz/ses testlerini ve 12 Ekim Fatih hazırlığını bekletmez. Pinned guard helper'ın kök düzeltmesi ayrı manifest/pin incelemesindedir; bu paket onu değiştirmez.
