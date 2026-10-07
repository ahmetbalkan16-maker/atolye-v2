# Unapplied resource occupancy barrier review — exact34ecb66

Status: OWNER_OVERRIDE_PENDING. The master order preserves frozen grader/fixture/pin bytes and prohibits changing tests to pass. No canonical grader or pin was edited. This is a concrete proposed synchronization correction, subject to an explicit exception for this one grader.

Source: `scripts/smoke-ayas-resource-occupancy.ts`; original SHA256 `28945551c8838240f286513ec89180ada19fca705cc8ed9579076154d4dfbad5`. Full166 raw resource-occupancy-mutations failure must remain preserved even if a later version is approved and passes.

The old 50 ms timing assumption lets the first callback finish and release its own record before the second callback checks two records. Five separate 20 ms staggered diagnostics reproduced the identical 1 !== 2 assertion with the unchanged source; ten separately coordinated diagnostic trials passed and removed both records. This diagnostic is not a passing canonical grader.

Replace only the original line below; keep the next Promise.all result/peak assertions, all other scenarios, mutation controls and production source unchanged. Both callbacks must enter before either checks, and both must check two records before either returns. Rendezvous timeout is assertion failure, not success.

Original:
```ts
    let open = 0, peak = 0; const stage = async () => { open++; peak = Math.max(peak, open); await new Promise((resolve) => setTimeout(resolve, 50)); assert.equal(names(root).length, 2); open--; return true; };
```

Proposed:
```ts
    let open = 0, peak = 0, entered = 0, checked = 0;
    let releaseEntered!: () => void, releaseChecked!: () => void;
    const bothEntered = new Promise<void>((resolve) => { releaseEntered = resolve; });
    const bothChecked = new Promise<void>((resolve) => { releaseChecked = resolve; });
    const rendezvous = async (barrier: Promise<void>) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([barrier, new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new assert.AssertionError({ message: "parallel production stage rendezvous timed out" })), 5_000);
        })]);
      } finally { if (timeout !== undefined) clearTimeout(timeout); }
    };
    const stage = async () => {
      open++; peak = Math.max(peak, open); entered++; if (entered === 2) releaseEntered();
      try {
        await rendezvous(bothEntered);
        assert.equal(names(root).length, 2);
        checked++; if (checked === 2) releaseChecked();
        await rendezvous(bothChecked);
        return true;
      } finally { open--; }
    };
```

Validation after explicit approval: same 12-scenario grader and all45 existing source mutation controls, repeated Windows overlap, TS/lint, frozen drift checks; archive v56 before recomputing only the affected suite grader pin reference(s); preserve fixtures/expectations and all unrelated pins; commit exact new source and run a new credential-free full166 receipt bound only to that new HEAD. No production behavior delay, no expected count relaxation, no raw FAIL rewrite, no aggregate closure grant.
