# Dünya Medeniyetleri Karakter Kütüphanesi V1

Bu dizin Git'te saklanan, owner tarafından seçilecek tasarım kaynaklarının sözleşmesidir.
Dört başlangıç pack'i görselsiz `placeholder` durumundadır; üretimde seçilemez.

Tam plan, klasör ağacı, metadata örnekleri, mixing policy ve entegrasyon adımları:
[CHARACTER_LIBRARY_WORLD_PLAN.md](../../docs/CHARACTER_LIBRARY_WORLD_PLAN.md).

```powershell
npx.cmd tsx scripts/validate-world-character-library.ts
npx.cmd tsx scripts/smoke-world-character-library.ts
```

Her pack: `<civilization>/<period>/<role>/<character-variant>/v<version>/`.
Alt klasörler: `design/`, `parts/`, `props/`, `mounts/`, `environments/`, `metadata/`.
Boş klasörler sıfır bayt `.gitkeep` ile izlenir.

`_core/` yalnız teknik stil, rig sözleşmesi ve şemaları paylaşır; kültürel görsel paylaşmaz.
Gerçek master sheet'ler inceleme ile eklenir. Animasyon/video çıktısı, cache, runtime
onay verisi ve projeler buraya yazılmaz. Mevcut runtime/authority depolaması kullanılır.
