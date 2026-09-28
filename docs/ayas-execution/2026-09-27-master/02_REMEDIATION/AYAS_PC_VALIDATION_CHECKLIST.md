# AYAS Conversation Gap Remediation — PC validation

Base HEAD used to prepare patches:
`035b4076faa1100224c64f4d1ffa3e8346ffc058`

## Safety contract

- Do not apply to `wip/ayas-graphify-final-execution` directly.
- Create a separate branch from the exact base HEAD (or rebase/re-review if HEAD changed).
- Graphify-first before accepting source changes.
- No owner approval, autonomous execution, production mutation, merge, or promotion is implied by these patches.
- Patch 2 is intentionally fail-closed against the retrieval evaluator's KNOWN_LIMITATIONS list.

## Apply order

1. Create branch, e.g. `wip/ayas-conversation-gap-remediation-20260927`.
2. Verify current source still matches base or independently re-review diffs.
3. Apply `ayas_conversation_safe_remediation.patch`.
4. Run Graphify + TypeScript + focused smokes.
5. Only if clean, apply `ayas_temporal_plan_supersession.patch`.
6. Run retrieval evaluator. It SHOULD report `IMPROVED ...` for any previously-known PC-plan limitations that are now solved. Do not suppress the gate.
7. Remove only the limitation entries proven solved by the evaluator, in a separate reviewed closure change.

## Minimum validation commands

```powershell
npx.cmd tsc --noEmit --incremental false
npx.cmd tsx scripts/smoke-ayas-memory.ts
npx.cmd tsx scripts/smoke-ayas-context.ts
npx.cmd tsx scripts/smoke-ayas-memory-temporal.ts
npx.cmd tsx scripts/smoke-ayas-chat-quality.ts
npx.cmd tsx scripts/smoke-ayas-cognitive-quality.ts
npx.cmd tsx scripts/smoke-ayas-retrieval-evaluation.ts --failures
npx.cmd tsx scripts/smoke-ayas-conversation-quality-master.ts
git diff --check
```

Also run the repository's canonical Graphify status/update/validation commands used by the current AYAS branch before accepting the diff.

## Live checks after deterministic gates

- "Adım Ahmet" persists as identity.
- "Laptop almaya karar verdim." is captured as a decision.
- "Masaüstünden vazgeçtim, artık laptop alacağım." does not resurrect the old desktop plan.
- AYAS asks a question; user says "Bir dakika" -> pending question remains.
- "Memory tarafına bugün dokunmayalım." then "Artık memory tarafına girebiliriz." -> temporary constraint is released.
- "Geçen ay hangi laptopu düşünüyorduk?" routes to history.
- RAM/bellek and kurgu/montaj recall reaches the prompt when retrieval selected the relevant memory.
- Real Ollama answer remains natural and does not leak unrelated memory.

## GitHub limitation observed from this ChatGPT session

The connected GitHub integration could read the repo but returned:
`403 Resource not accessible by integration`
for both branch creation and ref update. Therefore nothing was pushed, merged, or changed in the remote repository during preparation.
