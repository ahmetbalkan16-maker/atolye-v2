# AYAS Monday validation / remediation master checklist

Prepared against:
`wip/ayas-graphify-final-execution`
`035b4076faa1100224c64f4d1ffa3e8346ffc058`

Nothing in this bundle has been pushed or merged.

## 0. Re-read reality before touching source

1. Confirm branch/HEAD/dirty state.
2. If HEAD differs from `035b4076`, do NOT blindly apply patches; rebase/re-review first.
3. Run canonical Graphify status first.
4. Preserve all unrelated dirty/untracked/live runtime data.

## 1. Apply in this order

1. `ayas_conversation_safe_remediation.patch`
2. Graphify + focused validation
3. `ayas_temporal_plan_supersession.patch`
4. Retrieval evaluator; remove only KNOWN_LIMITATIONS that are proven solved
5. `ayas_system_static_remediation.patch`
6. Graphify + focused validation
7. `ayas_safe_ci.patch` only after the local suites are green

Do not merge or push before owner review.

## 2. Minimum deterministic gates

```powershell
npx.cmd tsc --noEmit --incremental false
npm.cmd run lint
npx.cmd tsx scripts/smoke-ayas-memory.ts
npx.cmd tsx scripts/smoke-ayas-context.ts
npx.cmd tsx scripts/smoke-ayas-memory-temporal.ts
npx.cmd tsx scripts/smoke-ayas-chat-quality.ts
npx.cmd tsx scripts/smoke-ayas-cognitive-quality.ts
npx.cmd tsx scripts/smoke-ayas-retrieval-evaluation.ts --failures
npx.cmd tsx scripts/smoke-ayas-conversation-quality-master.ts
npx.cmd tsx scripts/smoke-ayas-graphify-integration.ts --gate
npx.cmd tsx scripts/smoke-ayas-developer-intelligence.ts --gate
npx.cmd tsx scripts/smoke-ayas-open-ended-evolution.ts
npx.cmd tsx scripts/smoke-ayas-technology-watch.ts
git diff --check
```

Run the canonical Graphify `status`, structural refresh/review-analysis/scope commands used by the branch both before and after source changes.

## 3. Observer autostart test

The patch isolates every shortcut-only Scheduled Task name, but keep
`AYAS_KNOWN_UNSAFE_TESTS` unchanged until the owner PC proves the fix.

Before the test:
- confirm real `AYAS Autonomy Observer` task exists and record its XML/state
- ensure the test patch is applied
- review every `-ForceStartupShortcut` invocation and confirm it also passes a unique `-TaskName`

Then run the observer-autostart smoke explicitly under owner supervision.
After PASS:
- prove the real task still exists unchanged
- only then remove its `UNSAFE_KNOWN` registry entry and update the related Stage 10 tests/docs

## 4. Runtime-health finding — do not patch blindly

The route may observe a separate bundled module instance from the instance initialized by
`instrumentation.ts`. Resolve this on the real Next/Turbopack build first.

Required proof:
- capture status from the initialized runtime instance
- capture `/api/runtime/health`
- demonstrate same-instance or different-instance identity
- if different, design a process-global read-only status holder with no second initializer,
  no new execution authority, and regression coverage before changing production runtime code

## 5. Phone-model supply-chain pinning

Current code resolves Hugging Face artifacts through mutable `main`.
Do not guess revisions. On the owner PC:
- query each exact model repository and capture immutable commit SHA
- verify the exact required files exist at that SHA
- record weight SHA256 where the hosting backend exposes it
- add a `revision` field to each `AYAS_PHONE_LLM_MODELS` entry
- make every direct/gateway/cache URL use that pinned revision
- reject `main`/empty revision in production model-resource config
- update Cloudflare model proxy routes to the same revision
- run phone LLM capability/cache/precache/range/runner suites

Models currently referenced:
- HuggingFaceTB/SmolLM2-135M-Instruct
- onnx-community/Qwen2.5-0.5B-Instruct
- onnx-community/Qwen2.5-1.5B-Instruct

## 6. Owner-decision architecture work — intentionally not auto-coded

These are not safe "quick fixes" and must remain separately reviewed:

- Stage 14 persisted technology register + daemon/scheduler wiring
- keyed tamper evidence / key custody for that register
- owner unblock/re-attribution semantics for permanently blocked/ambiguous technology candidates
- first real Stage 8 production improvement strategy (`AYAS_IMPROVEMENT_STRATEGIES` is intentionally empty)
- live Claude/Codex developer dispatch adapter and skill registration
- Graphify PowerShell grammar / clean rebuild policy / phantom-edge decision
- Director-plan persistence and production integration
- pixel-level media evaluation and audio-level evaluation
- Wikimedia timeout/ranking follow-ups and any stock-video architecture

## 7. CI activation

Apply `ayas_safe_ci.patch` only after the listed local deterministic suites are green.
The workflow intentionally excludes Windows Scheduled Task, Graphify host-state, live production,
provider/network and paid-route tests.

## 8. Closure

After all approved changes:
- Graphify current at final HEAD
- TypeScript/lint/diff clean
- focused + master regressions pass
- no live data mutation outside separately approved operations
- review BLOCKER/MAJOR findings
- commit explicit paths only
- push
- verify remote HEAD/branch and CI
