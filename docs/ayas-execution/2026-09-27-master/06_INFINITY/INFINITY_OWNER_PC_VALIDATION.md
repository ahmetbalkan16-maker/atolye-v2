# ∞ Continuous Evolution — Owner-PC Validation

1. Verify current HEAD/worktree/remote state.
2. Graphify-first; ensure stale=false, needs_update absent, structural anomalies 0.
3. Apply framework on dedicated branch.
4. Keep persistent activation OFF.
5. Run deterministic primary + held-out + adversarial.
6. Test with TEMP state roots:
   - duplicate tick
   - concurrent coordinator
   - crash/restart
   - backward clock
   - PC-off catch-up
   - owner rejection
   - stale Graphify
   - audit blocker
   - post-execution regression
7. Prove source/runtime/approval/revenue/production protected roots unchanged.
8. Prove no direct calls to approval decision, execution, publish, payment, install or git push.
9. Integrate one safe dry/read-only daemon tick.
10. Independent review.
11. Owner explicitly approves persistent activation.
12. Register/autostart only after all above passes.
13. Reboot validation: single coordinator, healthy idle/active state, no duplicate work.
