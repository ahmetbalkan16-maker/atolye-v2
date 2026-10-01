# Stage 15G — SBOM / Provenance / Release Trust

Opened 2026-10-02 at `5c31024`. Canonical section: master order STAGE 15G and `01_CANONICAL_SPECS/AYAS_MASTER_SPRINT_V3_PRE_ATOLYE.md` STAGE 15G. Post-freeze addendum: no section is specific to this stage; section 5 (an artifact's identity is its immutable hash, never a tag or URL) and section 0 (an unknown or unmeasured state is never counted as a pass) were applied.

## What the stage asks for, and where each item is

| Canonical item | Where |
|---|---|
| CycloneDX-compatible SBOM | `src/lib/ayas/provenance/AyasSbom.ts`; evidence `release/SBOM.cdx.json` |
| Dependency exact versions | Each SBOM component: version from the lockfile, `pkg:npm/...@version` |
| Integrity / provenance where available | Each component: the lockfile's integrity as a SHA-512 hash and the registry tarball URL |
| License | Each component's license field as written; a summary and a list for the owner to look at |
| Lifecycle / postinstall classification | `ayas:npm:installScript` on each component: `NONE`, `REVIEWED`, `REVIEWED_AT_ANOTHER_VERSION`, `UNREVIEWED` |
| Advisory state | `advisories` in the manifest: `NOT_CHECKED`, or a report read from a file with its source and digest |
| Model / binary digests | `artifacts.lifecycle`: every pinned identity of the Stage 15E registry, and what this machine holds |
| Git HEAD | `git` |
| Lockfile digest | `lockfile` (also `package.json`) |
| Graphify HEAD | `graphify`: the commit the graph was built from, counts, the graph file's digest |
| Test matrix digest | `testMatrix`: the eval manifest's version and digest, and the baseline report bound to a commit |
| Build artifact digest | `build`: a digest of the build output, and the commit the build stamp names |
| Release provenance manifest | `src/lib/ayas/provenance/AyasReleaseProvenance.ts`; evidence `release/RELEASE_PROVENANCE.json` |
| No autonomous dependency auto-upgrade | Nothing here installs, upgrades or runs a package script; a source check in the suite pins that |
| Online signing optional, owner-reviewed | `signature.state` is `UNSIGNED`; nothing signs |
| Offline / local hash manifest mandatory | The manifest is sealed with a SHA-256 over its canonical JSON |

## Existing seams that were reused

- The lockfile (`package-lock.json`, lockfile version 3) is the only source of dependency facts. Nothing reads `node_modules` to build the SBOM.
- The Stage 9 audit (`docs/AYAS_SECURITY_SUPPLY_CHAIN.md`) named seven packages with install-time scripts. That list, with the versions it was made at, is the reviewed set.
- The Stage 15E lifecycle registry and its verifier supply the model and binary identities and the local comparison.
- The Graphify state collector supplies the graph facts.
- The Stage 15F eval manifest and baseline report supply the test matrix.

## Design

**SBOM** (`buildAyasSbom`, pure). One component per package and version: the same package at two lockfile paths is one component, and it is shipped if any of its paths is. Scope: `required` (shipped), `optional`, `excluded` (development only). Dependency edges are resolved the way npm resolves them (the package's own `node_modules`, then each parent's). The serial number is derived from the content, so the same lockfile gives the same bytes on any machine and in any entry order.

Findings say where the lockfile cannot support a claim. `BLOCK`: no integrity, a malformed integrity value, two integrity values for one version, no source, a source that is not the npm registry (Git, file, another host), a linked or bundled package, no version, an install-time script that no review covers or that was reviewed at another version, a required dependency the lockfile does not contain. `REVIEW`: no license recorded. A finding is reported; nothing is repaired or upgraded.

**Licenses.** The field is reported as written. Components whose license is not on a short list of identifiers commonly treated as permissive are listed for the owner. That list is a prompt to look. It is not a legal judgement.

**Manifest** (`sealAyasReleaseProvenance`, pure). Every part is an identifier, a count, a closed state or a digest. `gaps` names each thing that was not read, not bound to this commit or not clean: a dirty tree, a blocking SBOM finding, advisories not checked or not current or reported, artifacts not verified on this machine or mismatched, a graph not built from this commit or structurally incomplete, a baseline that is absent, bound to another commit or failed, a build that is absent or not bound to this commit and lockfile. `COMPLETE` means no gap. It never means safe. Being unsigned is recorded as a fact and is not a gap, because signing is optional.

`verifyAyasReleaseProvenance` checks the seal and also recomputes the gaps from the facts, so a manifest edited to say `COMPLETE` and re-hashed is still refused. `compareAyasReleaseProvenance` names what has changed between a stored manifest and the facts now.

**Collector** (`collectAyasReleaseProvenance`). Read-only: files in the repository, three Git questions with fixed arguments (`rev-parse`, `status`, `show`), hashing. No network. No absolute path, user name or environment value goes into the manifest. The lockfile and `package.json` digests are over LF-normalized text, so a CRLF checkout gives the same digest.

**Build stamp** (`scripts/ayas-build-stamp.ts`, run by `npm run build` as `postbuild`). Writes `.next/ayas-build-stamp.json`: the commit, the lockfile digest and whether the tree was clean. A build is bound to a commit only by a stamp written from a clean tree. The script never fails a build.

**Operator script** (`scripts/ayas-release-provenance.ts`). Prints a summary and writes nothing by default; `--out` writes new files only; `--verify` checks a stored manifest and exits 1 on a broken seal or any difference.

## Advisory state

A live `npm audit` sends this project's dependency list to the public npm registry. Stage 9 recorded that this needs the owner's explicit authorization, and that has not been given, so no live query was made. The manifest quotes a report only from a file the caller names, with its digest and its source. A report from the offline cache is quoted as not current.

## Limits

- The SBOM describes the lockfile, not what is installed. It does not check that `node_modules` matches the lockfile; `npm ci` does that at install time.
- The contents of install-time scripts are not hashed. The review is by package name and version.
- An integrity hash proves a tarball is the one the lockfile names. It says nothing about what the tarball does.
- Advisory state is `NOT_CHECKED` or not current until the owner authorizes a live query.
- A build made before the stamp existed cannot be bound to a commit. The owner's current build is one of those.
- Large local artifacts are compared by size unless `--deep` is given.
- The manifest is a hash manifest. It is not signed, and nobody other than whoever holds the repository can vouch for it.
- Hosted providers and unpinned speech voices have no digest to record; the lifecycle registry already says so.

## Evidence

`release/` holds the SBOM and the manifest generated at the stage's source commit from a clean tree, with the baseline report and the advisory report they quote. `15G_RESULT.json` summarizes the stage. Exact digests are in those files and are not repeated here.

## Verification

- `scripts/smoke-ayas-release-provenance.ts`: 18 scenarios on fixture lockfiles and TEMP repositories.
- `scripts/smoke-ayas-release-provenance-mutations.ts`: 27 of 27 negative controls caught, in a TEMP overlay.
- `npm run build` in a TEMP clone: the stamp hook runs and the build exits 0. The repository's own `.next` was not touched.
- Eval manifest `15F.4-v9`: 74 suites (two added); v8 kept.
