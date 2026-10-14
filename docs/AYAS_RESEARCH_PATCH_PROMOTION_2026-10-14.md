# AYAS araştırma sonucundan onaylanabilir patch’e — 14 Ekim 2026

## Neden

Araştırma bridge’i doğrulanmış bulguları ve deney sonucunu Gelişim Merkezi adaylarına taşıyordu; ancak bu adayların mutation kind’i kayıtlı değildi. Bu nedenle adaylar görülebiliyor, fakat gerçek kod değişikliği olarak uygulanamıyordu.

## Yeni akış

1. LIGHT/DEEP araştırma sonucu yalnız araştırma kaydıdır; dış kaynak metni dosya, komut veya generator seçemez.
2. Yerel ölçüm, kapalı server-owned registry’deki stratejiyle eşleşirse deney disposable sandbox’ta çalışır. Baseline, held-out, regression ve golden kapıları aynı şekilde uygulanır.
3. IMPROVED kanıt güncel HEAD’e, tamamlanmış experiment kaydına, strateji kimliği/sürümüne ve kalıcı evidence SHA’sına bağlanır.
4. Promotion adapter yalnız kayıtlı stratejiyi aynı HEAD kaynağından deterministik olarak yeniden üretir. Kaynak dosyaları ve dosya listesi doğrulanır; yeniden oluşturulan tüm diff’in SHA-256’sı deney kanıtındakiyle aynı olmalıdır.
5. Ayrı bir patch worktree’de typecheck, kayıtlı benchmark ve regression smoke’ları tekrar çalıştırılır. Diff değişmişse, HEAD/worktree oynadıysa, strateji/hash/scope tutmadıysa ya da validator başarısızsa fail-closed davranılır.
6. Başarılı aday create-only, hash-bound `patch-artifact:v1` olarak normal owner approval inbox’a girer. REVIEW_REQUIRED kaynak için kayıtlı exact-patch proof da proposal hash’ine bağlanır.

Canlı çalışma ağacı promotion sırasında yazılmaz; staging, commit, push, approval veya execution yapılmaz. Owner’ın normal onay ekranı ve mevcut execution gate tek uygulama yoludur. Uygulama toggle’ı kapalıysa owner ayrıca mevcut “YÜRÜT” adımını kullanır.

## Kapsam sınırı

Yalnız önceden commit edilmiş ve `AYAS_DEFAULT_IMPROVEMENT_REGISTRY` içine gözden geçirilerek eklenmiş stratejiler patch üretebilir. Bu oturumda kayıtlı tek strategy `exp-memory-render-tool-supersession@1`; onun eski before hash’i `eba490…` iken mevcut `AyasMemoryTemporal.ts` hash’i `c5139a…` ve ilgili render-tool davranışı dosyada zaten bulunuyor. Dolayısıyla eski strateji yeni bir patch olarak promotable değildir; sistem bunu hash/scope kapısında durdurur. Yeni konu ve alanlar için ayrı evaluator/regression kanıtı ve yeni gözden geçirilmiş strategy commit’i gerekir. Dış araştırma bulguları tek başına kod değişikliği yetkisi vermez.

## Doğrulama

- `npx tsc --noEmit`: PASS
- `smoke-ayas-research-improvement-loop.ts`: 57/57 integration, 36/36 decision case PASS (gerçek cognitive evaluator dahil)
- `smoke-ayas-discovery-run-firewall.ts`: 13/13 PASS
- Değişen TypeScript/smoke dosyalarında ESLint: 0 hata, 0 uyarı
- Fail-closed no-evidence senaryosu ve pozitif disposable promotion senaryosu: 2/2 PASS; pozitifte typecheck/validator, exact diff hash, immutable artifact hash ve owner candidate doğrulandı

Bu kayıt teknik olarak doğrulanmış promotion hattını açıklar; bir research patch’in gerçek owner inbox’ta göründüğünü veya canlıya uygulandığını iddia etmez. Bunun için güncel HEAD’de ölçülmüş IMPROVED deney ve aktif, scope’u eşleşen kayıtlı strateji gerekir.