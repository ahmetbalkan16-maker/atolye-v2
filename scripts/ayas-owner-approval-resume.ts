// AYAS owner-approval resume worker (Step 6 of the durable one-click
// correction). A separate, narrowly-scoped entrypoint from
// `ayas-discovery-daemon.ts` on purpose — see `AyasOwnerApprovalResume.ts`'s
// own header for why. Relative imports only: this file (and everything it
// imports) must run correctly via plain `tsx` from an arbitrary cwd, the
// same constraint every other `scripts/*.ts` entrypoint in this repo has.
import { defaultAyasProposalApprovalDeps } from "../src/lib/brain/autonomy/AyasProposalApprovalService";
import { resumeAyasOwnerApprovedProposals } from "../src/lib/brain/autonomy/AyasOwnerApprovalResume";

async function main(): Promise<void> {
  const attempts = await resumeAyasOwnerApprovedProposals(defaultAyasProposalApprovalDeps());
  console.log(JSON.stringify({
    status: "DONE",
    resumed: attempts.length,
    attempts: attempts.map((a) => ({ proposalId: a.proposalId, ok: a.outcome.ok, code: a.outcome.ok ? undefined : a.outcome.code })),
  }));
}

main().catch((error) => {
  console.error("AYAS owner-approval resume worker FAILED:", error);
  process.exitCode = 1;
});
