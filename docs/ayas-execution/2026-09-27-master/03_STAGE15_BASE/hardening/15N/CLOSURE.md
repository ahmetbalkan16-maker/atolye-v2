# Stage 15N source closure — GREEN, not adopted on this host

Source commit `9cdf5dbdede418dd35c6a9a1c5057299c20af693`. Local commit only, no push.

## What exists

One versioned, owner-only constitution. Its schema is closed: the rule values for approval, spend, publishing, production, privacy, zero cost, Graphify-first, cloud fallback, self-approval, self-promotion and the on-demand local runtime are fixed, and the only owner-set values are the protected-path list (which must contain the eight required paths) and the RAM admission threshold. A version is a signed record chained to the one before it and bound to the physical repository; a public reader verifies the whole chain and has no approval authority. Only the owner's authenticated action on the exact reviewed digest can activate a version. AYAS can produce a proposal and nothing else.

Every long-running run binds the digest when it starts and rechecks it before new work: the common action firewall, the observer tick, the durable task operator, the research tick and the light and deep scans. A changed or unverifiable policy refuses new work; recovery and cleanup stay available. Machine health reads the owner's RAM admission threshold.

## What the handoff review changed

The previous session ended with the packet uncommitted and one full run failed on a test inventory. Before validating the draft it was read and measured at this workstation's real values. Two defects were found; both failed closed and both are fixed with a scenario and a negative control:

- the bound repository followed the caller's spelling of its path on Windows, so the server, the observer and an operator shell could disagree after adoption;
- the adoption directory, the writer lock and the bootstrap staging directory were not ignored by Git, so adopting would have made the repository look dirty to every cleanliness gate.

## Evidence

- Full declared baseline on manifest `15F.4-v22` at the source commit, clean tree: 95 of 95 suites, `PASS_WITH_KNOWN_LIMITATIONS`, no failure, cognitive 54/55 and held-out 4/5 unchanged, host RAM peak 50.59 %. Report: `FULL_BASELINE_V22.json`.
- The earlier full run on v20 (94 of 95) and its failure output are kept: `FULL_BASELINE_V20.json`, `V20_RECOVERY_INVENTORY_FAILURE.txt`.
- Owner constitution 18 scenarios, 19/19 negative controls and one declared equivalent. Run binding 18 scenarios, 13/13 negative controls.
- 108 unique grader pins match the committed blobs. TypeScript, changed-file lint and diff check pass; full lint 0 errors and 13 existing warnings.
- Production build passes in a TEMP clone; `/brain/constitution` is a dynamic route. The repository's `.next` and the running server were not touched.
- Graphify at the source commit: 17,202 nodes, 49,285 links, no duplicate, dangling or self-loop; PARTIAL 9 and semantic pending as before.

## What is not claimed

Nothing was adopted. The host state is `MISSING`, which means behaviour is as before this stage and the digest in every run's evidence is null. The page has not been seen in a browser. The limits are listed in `15N_RESULT.json`.

## Owner action, not blocking

Activation is the owner's alone: rebuild and restart the Next server, open `/brain/constitution`, compare the digest with `OWNER_REVIEW_PACKET.json`, activate, then restart the observer Scheduled Task. Until then work continues as before.

Next canonical stage: 15O, Golden Benchmark and Regression Vault.
