# AYAS / Atölye — D:\ÜRETİM altında toplama ön planı

13 Ekim 2026. Owner kaynakları/verileri tek yerde toplamak ve sonra flaşla yeni PC'ye aktarmak istiyor; kurulu uygulamalar yeni PC'de ayrı kurulacak. Bu PC'de çalışmayı sürdürmek **mümkün**, fakat çalışan köklerin doğrulanmış geçişi gerekir. Bu belge **salt okunur hazırlık**; D'ye kopya/taşıma, authority publish, env/Startup/tünel değişikliği veya C'den silme uygulanmadı. Öncelik owner talimatıyla telefon uyandırmasıdır.

## Güncel ölçüm ve sınırı

Yerel envanter 105128 normal dosya / **66084848829 bayt (66,08 GB; yaklaşık 61,55 GiB)** ölçtü. Atölye üst dizini, repo/kayıt/arşiv/runtime/secrets, `.ollama`, `.cloudflared` ve AtolyeAyasAccess kapsamındadır. `node_modules`, `.next`, `.venv-wake`, `local-env`, `python-deps`, `__pycache__` adındaki klasörler yeniden kurulum grubu olarak dışarıda; 8 link izlenmedi, okuma hatası 0. Bu ad sınıflandırması nihai USB manifest'i değildir; linklerin hedefi ve dışarıda kalan her klasörde özgün veri bulunup bulunmadığı paket öncesinde ayrıca incelenir. İçerik hash'i ölçülmedi, gizli dosya içeriği rapora okunmadı. Envanter Git dışı `.graphify/wake-phone-20261013/inventory.json` içindedir.

Repo yaklaşık 33,54 GB; Ollama modelleri yaklaşık 23,35 GB; kalan kapsam arşiv, history, backup ve runtime'dır. Önceki 10 Ekim ölçümü 41,67 GB'dı ve güncel boyut olarak kullanılamaz. Repo altındaki özel inceleme kopyaları da bu korumacı ölçüme girmiştir; hepsinin aktif bağımlılık olduğu iddia edilmez. D'nin gözlenen boş alanı yaklaşık 949,7 GB; USB kapasitesi/formatı bu oturumda incelenmedi. 128 GB flaş nominal veri için yeterli görünebilir; tam manifest, dosya sistemi ve geri okuma kontrolü olmadan yeterlilik sertifikası verilmez.

## Önerilen düzen

```text
D:\ÜRETİM\
  Atolye\atolye-v2\          # Git kaynakları, özgün repo verileri ve portable assets
  runtime\AtolyeRuntime\     # tek etkin production proje/iş durumu
  runtime\AtolyeAuthority\   # kayıtları korunmuş, protokolle bağlanan authority
  models\ollama\             # model ağırlıkları/manifestleri
  private\                   # env / tünel kimlikleri; Git ve herkese açık rapor dışında
  archives\                  # kullanıcı arşivleri ve geri dönüş kanıtları
  handover\                  # manifest, hash ve yeni PC kurulum kayıtları
```

Ollama'nın model dizini ve kurulu araçların veri yolları gerçek ayarlarıyla güncellenir; dizin adını değiştirmek ayarı değiştirmez. Node/Git/Ollama/Codex gibi kurulu programlar bu PC'de mevcut kurulumlarında kalabilir. Whisper/Piper/model assets gibi repo içi portable runtime dosyaları mevcut PC çalışması için korunur; yeni PC'de araçlar yeniden kurulur/qualified edilir. Yeniden kurulabilir klasörlerin içindeki özel model veya özgün kanıt körlemesine atılmaz. Kullanıcı ZIP'i önceki owner yanıtına göre Git dışında tutulur; ileride manifest'e özel arşiv olarak eklenir.

## Canlı geçiş sırası

1. Kaynak kökleri, gizli ayarların yalnız yol alanları, mevcut aktif authority/generation ve Startup/tünel/build bağımlılıkları tekrar ölçülür. Yeni D kökleri gerçek dizin, alan, ACL ve link açısından kontrol edilir. C kopyaları korunur.
2. Özgün kaynak/veri/model/ayar dosyaları önce yeni hedefe **kopyalanır**, kaynak/hedef SHA256 manifest'i ve hedef geri okuma doğrulanır. Aktif writer verisi için bu ilk kopya final snapshot sayılmaz. Credentials yalnız özel pakette; rapor/Git'e değerleri yazılmaz.
3. Son veri snapshot'ı öncesi normal worker stop/quiescence ve aktif iş/lease yokluğu kanıtlanır. Mevcut runtime backup → verified migration candidate → exclusive target materialization yolu kullanılır.
4. Authority relocation mevcut `run-authority-transition.ts` state machine üzerinden quiesce/prepare/validate/publish ve eski kök quarantine ile yapılır. **Workspace yolu da authority binding'e dahildir.** `.env.local` metnini değiştirmek veya eski marker'ı kopyalamak yetki vermez. Runtime ve authority birlikte taşınacaksa store'un yeni konumu ve recovery/rollback token'ının bağlanması protokol/test ile ayrıca kanıtlanır; destek eksikse bounded durulur, marker elle yazılmaz.
5. Yeni workspace/dependency/build yollarında temiz kaynak derlemesi, instrumentation/HTTP kabulü, source-lock hash qualification ve kontrollü app başlangıcı doğrulanır. Eski `.next`/prebuilt manifest'i yeni kökte doğru kabul edilmez. Bu PC'deki kurulu araçlar korunur; yeni bağımlılık ağacı gerekirse lock'tan oluşturulur.
6. Kanonik gizli Access launcher, kullanıcı Startup kısayolu ve tünel bağları yeni gerçek yollarla güncellenir; ikinci app/worker/tünel oluşturulmaz. App/worker gerçek health, projeler/assets/bellek, AYAS sohbet, mikrofon/STT/TTS ve telefon HTTP kabulü ölçülür. Başarısızlıkta kanıtlı eski kök/build'e protokolle dönüş yapılır.
7. Yeni kök kabulünden sonra USB paketi oluşturulur. Yeni PC'de program kurulumu, path rebinding, authority aktivasyonu, lock dependencies, temiz build, Graphify, donanım ve gerçek telefon/reboot kabulü ayrı yapılır. Eski PC'yi veya C verisini otomatik silme adımı yoktur.

Başvuru: [önceki yeni PC devri](AYAS_NEW_PC_HANDOVER_2026-10-10.md), [authority binding](RUNTIME_AUTHORITY_GENERATION_BINDING.md), [proje storage](PROJECT_STORAGE.md). Eski belgelerdeki D:\AtolyeRuntime kaydı tarihçedir; bu oturumda whitelist ile gözlenen etkin runtime/authority yolları C:\…\Atölye\runtime\AtolyeRuntime ve AtolyeAuthority'dir.
