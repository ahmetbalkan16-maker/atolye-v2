# Protected-scope integration review — source fde898f

This is an implementation review and remaining-work specification. It does not qualify the external runtime, bind a TEST/LIVE aggregate, or grant execution authority. The current canonical audit remains BLOCKED.

## Observed implementation

`AyasSystemAuditRegistry.ts` fixes six repository-relative protected roots: `data/brain`, `data/projects`, `runtime`, `authority`, `projects`, and `.atolye`. `inventoryAyasAuditProtectedRoots` hashes those roots. Its streaming option keeps bounded memory, a 16 MiB per-file limit, 1 GiB total limit, 20,000 files, depth 20, and a 120-second deadline. It rejects links, hardlinks, descriptor replacement and changed files, and never opens credential-named files. Exclusions prevent completeness.

The streaming return deliberately contains `complete=false`, `externalRuntimeQualified=false`, and `FIXED_REPOSITORY_ROOTS_EXTERNAL_RUNTIME_UNQUALIFIED`. The collector carries that incomplete state into its mutation proof. This is a missing external-scope binding, not a digest failure to conceal by changing a boolean.

The current configured runtime and authority are outside those six roots. `RuntimeStoragePaths.ts` resolves `ATOLYE_RUNTIME_ROOT` and `ATOLYE_RUNTIME_AUTHORITY_ROOT` and validates ancestor chains. Resolution is distinct from functions that create directories, acquire authority, write claims, or bootstrap state. A future read-only audit must use resolution and validation only. `RuntimeBackupInventory.ts` supplies a read-only runtime inventory; backup creation, restoration, authority bootstrap and production acceptance must remain outside the audit.

The independently captured local and external inventories prove only their own intervals. Their separate digests cannot qualify a combined before/after audit interval. A private server trace and other background runtime records grew during this session; no across-session unchanged-state claim is valid. Trace bodies remain private and outside Git.

## Required bounded implementation

1. Add a separate opt-in combined inventory path, preserving the default local collector and all frozen tests. Resolve explicit runtime and authority roots through existing path validators; require registered coverage of private memory, production projects, approvals and revenue stores. Do not discover arbitrary filesystem roots or open env/credential bodies.
2. Represent the coverage manifest, root identities, exclusions and measurements explicitly. Missing roots, overlaps, links, unstable identities, unreadable entries, exceeded budgets, and any credential exclusion must remain incomplete. A larger total scope needs a separately reviewed bounded budget; summing existing independently complete scans cannot supply qualification.
3. Surround the same audit execution with both combined inventories. Include the same coverage-manifest digest in both. An unexplained change must retain `PROTECTED_CHANGE_UNATTRIBUTED`. Background attribution requires an actual bounded writer receipt digest; a guessed process or a private trace alone is insufficient.
4. Keep report coverage separate from independent full166. The collector currently declares166 and executes0. Importing a same-source suite receipt must validate its source, manifest, selected/declaration counts, completeness and capture digest, while preserving raw FAILs. It must never turn suite witnesses into all152 criteria or all30 aggregate results.
5. Bind each domain TEST/LIVE result only after all its canonical criteria have been reviewed against current evidence. The registry has `allowNotApplicable=false`; an informal deferment cannot become `NOT_APPLICABLE_REVIEWED`. Real platform, authenticated runtime, device, production and final owner-review prerequisites remain mandatory under their existing gates.

## Verification required before qualification

New tests must independently attack root escape, hardlink/junction boundaries, symlink replacement, credential exclusions, a changed scope manifest, wrong source, truncated full166, mismatched capture hashes, simultaneous background writes, forged writer attribution, duplicate criteria, partial-domain PASS and an owner statement attempting to replace missing technical proof. No production writes or real restore are required for these tests.

Frozen grader, fixture and pin changes remain prohibited except for the already approved occupancy barrier and its two versioned pin references. This review authorizes no further exception. No production collector implementation was changed by this document.

## Current findings

The [canonical audit](STAGE17_CURRENT_AUDIT_fde898f.json) has complete local measurements but unqualified combined scope, executed0 and30 TEST/LIVE slots not bound. Authenticated runtime identity, physical-device voice/continuity, real Lemon TEST binding, Fiverr order/revenue/ledger evidence and final digest-bound owner review remain separately unqualified. Foundation BLOCKED; Homepage/BrainUIV2 NOT_STARTED; boundary NOT_REACHED.
