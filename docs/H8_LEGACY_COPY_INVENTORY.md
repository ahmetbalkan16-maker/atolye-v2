# H8 legacy project copy inventory — 2026-09-23

Read-only inventory. No project, authority, backup, or ledger file was moved, removed, or rewritten. Every row names an exact legacy folder at `<repository>/data/projects/<slug>` and its live counterpart at `<repository>/../runtime/AtolyeRuntime/projects/<UUID>`. The 16 legacy names are different from their UUID physical folder names. The runtime has a seventeenth UUID folder for the `unknown` usage ledger; it has no corresponding slug-copy row.

The comparison hashes every regular file by relative path and SHA-256. `same` means the same path and bytes are present in the canonical folder. No row has a byte-different common file or a canonical-only file. The digest column is SHA-256 over the sorted `relative-path:SHA-256` pairs for the legacy folder; its first 12 characters are shown. Counts include transient files.

| Legacy slug | Canonical UUID folder | Legacy files | Same | Legacy-only | Digest prefix | Classification |
| --- | --- | ---: | ---: | ---: | --- | --- |
| `mimar-sinan-in-hayati-ve-basyapitlari-433c675d-5ecb-4da8-b3fd-17a332d713aa` | `0453f0b4-bb1c-4c7f-9d21-7a07b48a2f4c` | 61 | 61 | 0 | `ea0c0fbca4cb` | BYTE_EQUIVALENT_LEGACY_COPY |
| `fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5` | `1ba3bebf-abe9-4b3c-9b4a-b9d238b98534` | 463 | 463 | 0 | `04708e2ef21b` | BYTE_EQUIVALENT_LEGACY_COPY |
| `atilla-nin-y-kselisi` | `1f0f436c-9cc6-413d-82fb-593fe7ddbc6b` | 4 | 4 | 0 | `3786db66ab44` | BYTE_EQUIVALENT_LEGACY_COPY |
| `fatih-sultan-mehmet-ve-i-stanbul-un-fethi-5ec34edd-7303-45aa-8a40-9873de62e7d4` | `26cb9e8b-2acd-44c4-8142-737f87b36152` | 169 | 169 | 0 | `11523483907e` | BYTE_EQUIVALENT_LEGACY_COPY |
| `sultan-mehmed-ii-and-the-conquest-of-constantinople-b7400945-4927-4231-aa31-82f75144e923` | `2de0daf4-a69b-4d3a-bbca-9e8ec32eb156` | 31 | 31 | 0 | `75087b174772` | BYTE_EQUIVALENT_LEGACY_COPY |
| `osmanlinin-kurulusu` | `3ab5a04d-43fe-4aa8-83ba-9140ae7f1b9b` | 17 | 17 | 0 | `ccb68a06ca11` | BYTE_EQUIVALENT_LEGACY_COPY |
| `suleymaniye-camii-ve-mimar-sinan-in-mirasi-2c5b8cdc-1234-48ce-a440-e0b5a361976c` | `64ef1ed9-b5ae-4004-b6d9-24887c02cd59` | 42 | 41 | 1 | `cccb3113c0ec` | UNIQUE_HISTORICAL_DATA |
| `i-stanbul-un-fethi-1453` | `6813e662-5523-483f-b94d-5e09f64c3ffd` | 593 | 566 | 27 | `fee4e413252e` | UNIQUE_HISTORICAL_DATA |
| `osmanli-nin-yukselisi-kurulustan-i-stanbul-un-fethine-c8888f58-10d4-4647-8cdb-0f89d8fb5ae4` | `81b90ea0-1712-4313-9300-145fca58f6d2` | 207 | 207 | 0 | `4c34ec3465c6` | BYTE_EQUIVALENT_LEGACY_COPY |
| `fatih-sultan-mehmet-ve-i-stanbul-un-fethi-5be83a84-3d83-49f3-8ef2-854543359ca1` | `88ac97a9-b4b7-4477-8123-ff3463a7df0e` | 275 | 275 | 0 | `27d5400a5859` | BYTE_EQUIVALENT_LEGACY_COPY |
| `hunlarin-dogusu` | `8e2a1371-06d1-4647-abcf-b09eb5730e93` | 3 | 3 | 0 | `2ce651867639` | BYTE_EQUIVALENT_LEGACY_COPY |
| `fatih-sultan-mehmet-ve-i-stanbul-un-fethi-302ce03f-e67b-4de0-b767-bfc40dd0f486` | `93775b83-07d1-468d-b161-62f88a558715` | 209 | 209 | 0 | `8f12e7bcf029` | BYTE_EQUIVALENT_LEGACY_COPY |
| `fatih-sultan-mehmet-ve-i-stanbul-un-fethi-c0261ddc-d2d1-460b-bf6c-5be4bdc1b02b` | `adee6856-f0af-4a90-8202-82cdec740fd4` | 280 | 280 | 0 | `9a0947c27271` | BYTE_EQUIVALENT_LEGACY_COPY |
| `sultan-mehmed-ii-and-the-conquest-of-constantinople-90fad1b3-85ff-4977-894d-b8c92490a8ea` | `c13cd493-b018-4958-bbff-279fa2334665` | 31 | 31 | 0 | `976021e6f03a` | BYTE_EQUIVALENT_LEGACY_COPY |
| `atilla-nin-yukselisi` | `c85c5d14-648f-4ecf-9c04-6b4ed131a489` | 3 | 3 | 0 | `d7d074587cfd` | BYTE_EQUIVALENT_LEGACY_COPY |
| `hunlarin-dogusu-attila-ya-giden-yol` | `e47a38d0-bab8-427b-afe4-d4a89db1ea41` | 3 | 3 | 0 | `c3f7d2581ab8` | BYTE_EQUIVALENT_LEGACY_COPY |

The one extra file for Süleymaniye is `.pipeline-jobs.lock/owner.json` (extra-set digest `4d199bf8f840`). The 27 extra files for İstanbul are 13 audio-compensation-cleanup and 14 audio-compensation-recovery `.audio-journal-staging/*.partial` files (extra-set digest `16106dcd3357`). They look transient by path, but their bytes are unique; this inventory does not authorize their removal.

Read-side runtime code selects the configured UUID tree; without a runtime root it may inspect the legacy tree. Write-side code now requires an explicitly configured runtime root. Legacy slug aliases still fail write authority with `RUNTIME_STORAGE_DUAL_ROOT_DIVERGENCE` while these folders remain. The authority transition files `s206-genesis-01.json` and `recovery-2026-09-15-01.json` mention all 16 identities, and canonical UUID payloads appear in external backup manifests `b-0d971133190c` and `b-fee58282da89`. These references do not select the repository copies as runtime sources.

**Disposition: OWNER DECISION REQUIRED for all 16 folders.** The 14 byte-equivalent folders are candidates for controlled archival or decommission after a separate owner decision. The two folders with unique transient-looking files require preservation and explicit review before any relocation or deletion. No data action is proposed in this code sprint. A later data action must recheck every digest, record the full before/after tree fingerprint, and name a verified rollback source. The session baseline tree fingerprints (path, size, mtime, file SHA-256) are:

- Live runtime: 2,374 files, `3fbcc05c0eecbedd38f061ebd50259276338cdfe8977e927c1af70d623580973`
- Authority: 4 files, `602c16261510769e1559d6c00401df0bd6da385faeeff8fd4bc8164bafe12f7c`
- Legacy `data/projects`: 2,399 files, `457d9185ab20880784695dfea22cf163eb42c7db76fa145e92110fb16ce57d72`
- Restored `unknown/ai-usage.json`: SHA-256 `5f896a8ca44a59f673a14174e6658b0c24fb50bd267d41068536f4d69456a122`, 4 records
