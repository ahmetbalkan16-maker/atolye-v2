# Stage 15 — Monday Owner-PC Validation

1. Confirm exact branch, local HEAD, remote HEAD, ahead/behind, worktree.
2. Run Graphify status before source edits.
3. Re-read this design against the actual HEAD.
4. Apply framework changes only on a dedicated branch.
5. Do NOT register the first production strategy until the Stage 15 framework itself is green.

## Safety checks

- Existing Stage 8 research flow must produce byte/semantic-equivalent decisions for its old fixtures.
- No new import path from Stage 13/15 into approval/execution service that invokes mutation.
- Stage 15 code must not call owner decision or Package C.
- All sandbox child envs remain allowlist-only, providers mock, proxy closed.
- Every experiment sandbox is destroyed.
- Live worktree HEAD/cleanliness and shared node_modules stamp are unchanged.
- Evidence and artifact are immutable/hash-bound.
- Artifact SAFE is required; REVIEW_REQUIRED/FORBIDDEN never becomes executable proposal.
- Existing one-click owner approval still independently revalidates HEAD, Graphify, exact scope and artifact.

## Expected smoke commands

```powershell
npx.cmd tsc --noEmit --incremental false
npm.cmd run lint
npx.cmd tsx scripts/smoke-ayas-research-improvement-loop.ts
npx.cmd tsx scripts/smoke-ayas-open-ended-evolution.ts
npx.cmd tsx scripts/smoke-ayas-technology-watch.ts
npx.cmd tsx scripts/smoke-ayas-patch-artifact.ts
npx.cmd tsx scripts/smoke-ayas-autonomy-approval.ts
npx.cmd tsx scripts/smoke-ayas-execution-authority.ts
npx.cmd tsx scripts/smoke-ayas-graphify-integration.ts --gate
npx.cmd tsx scripts/smoke-ayas-controlled-self-evolution.ts
git diff --check
```

Use the repository's current canonical smoke names if any of the above were renamed.

## First real strategy gate

After framework closure:
- select ONE remaining deterministic non-held-out quality failure;
- strategy exactFiles <= 2;
- <= 80 changed lines;
- no protected path;
- no external dependency;
- baseline must reproduce;
- held-out cannot drop;
- owner separately approves the strategy registration commit.
