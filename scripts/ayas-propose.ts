import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { createAyasAutonomyDaemon, type AyasDaemonCandidate } from "../src/lib/brain/autonomy/AyasAutonomyDaemon";
import { createAyasApprovalInboxStore } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { isAyasMutationKindRegistered } from "../src/lib/brain/autonomy/AyasMutationRegistry";
import { resolveAyasBoundedPath } from "../src/lib/brain/autonomy/AyasBoundedFileWrite";

/**
 * AYAS proposal producer entrypoint (M15) — explicit, human-triggered only.
 *
 * This script does NOT discover improvements on its own: `CANDIDATE` below
 * is a declarative literal a human edits by hand before running
 * `npm run ayas:propose`. It gathers real, read-only evidence (git
 * branch/HEAD/clean state, Graphify freshness), validates the candidate's
 * `exactFiles` against a path-safety allowlist BEFORE any durable proposal
 * is written, and then calls the existing, already-tested
 * `AyasAutonomyDaemon.discover()` — the one canonical proposal producer —
 * to turn it into a durable `AyasInboxProposal`. It never approves,
 * reserves, executes, mutates code, or transitions the execution gate.
 */

const root = process.cwd();
const ALLOWED_CANDIDATE_ROOTS = ["src/", "scripts/", "app/", "docs/"];

function git(args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd: root, encoding: "utf8", windowsHide: true }).trim();
}

function graphifyFresh(): boolean {
  return fs.existsSync(path.join(root, ".graphify", "graph.json"));
}

/**
 * Edit this literal by hand before running the script — it is the entire
 * "what should AYAS propose" decision, made by a human, not inferred.
 */
const CANDIDATE: AyasDaemonCandidate = {
  objective: "AYAS proposal deduplication'ın terminal durum sınırını test kapsamına al",
  currentProblem: "AyasApprovalInboxStore.createProposal, aynı proposalHash'e sahip bir aday PENDING/APPROVED/REJECTED/DEFERRED/RESERVED durumundayken tekilleştiriyor, ancak bir öneri COMPLETED/FAILED/STALE/ABANDONED/RECOVERY_REQUIRED gibi kalıcı bir sonuca ulaştıktan sonra aynı içerik yeniden önerildiğinde ne olduğu hiçbir testte doğrulanmıyor.",
  selectionReason: "Kaynak kodu doğrudan okunarak (AyasApprovalInboxStore.ts) tekilleştirme filtresinin yalnızca 5 durumu adlandırdığı, diğer 5 kalıcı durumun kapsam dışı kaldığı görüldü; repo genelinde grep ile bu sınırın hiçbir testte kapsanmadığı doğrulandı.",
  expectedUserBenefit: "Gelecekte biri tekilleştirme filtresini yanlışlıkla genişletirse (ör. kalıcı durumları da dahil ederse), gerçekten tekrar eden bir iyileştirme önerisinin bir daha asla önerilememesi riski artık bir regresyon testiyle yakalanır.",
  expectedBehaviorChange: "Yeni bir smoke test dosyası eklenir; mevcut hiçbir üretim/çalışma zamanı davranışı değişmez.",
  unchangedBehavior: "AyasApprovalInboxStore'un tekilleştirme mantığı, onay/red/erteleme/yürütme akışları ve tüm diğer AYAS davranışları birebir aynı kalır.",
  riskIfNotDone: "Tekilleştirme sınırındaki bu görünmeyen davranış test edilmeden kalır; ileride sessiz bir regresyon fark edilmeden production'a girebilir.",
  technicalRisk: "Düşük; yalnızca yeni, izole bir test dosyası eklenir, mevcut hiçbir dosya değişmez.",
  productionImpact: "none",
  rationale: "AyasApprovalInboxStore.ts:234 satırındaki tekilleştirme filtresi yalnızca PENDING/APPROVED/REJECTED/DEFERRED/RESERVED durumlarını kapsıyor; bu sınırın doğru çalıştığı (terminal durumlardan sonra yeni öneri oluşturulduğu ve geçmişin korunduğu) elle doğrulandı ancak hiçbir otomatik testte yoktu.",
  evidence: ["src/lib/brain/autonomy/AyasApprovalInboxStore.ts:234 dedup filter", "manual verification: ABANDONED proposal re-proposed with identical content creates a new PENDING proposal, old ABANDONED record preserved"],
  graphifyEvidence: ["AyasApprovalInboxStore.createProposal has zero test coverage for its dedup boundary against COMPLETED/FAILED/STALE/ABANDONED/RECOVERY_REQUIRED statuses, confirmed via graphify update + grep across scripts/smoke-ayas-*.ts"],
  exactFiles: ["scripts/smoke-ayas-proposal-terminal-state-dedup.ts"],
  expectedDiffScope: "Bir yeni dosya: scripts/smoke-ayas-proposal-terminal-state-dedup.ts (~125 satır, 12 test senaryosu)",
  testsPlanned: ["smoke-ayas-proposal-terminal-state-dedup"],
  risk: "low and reversible — test-only addition, zero product code touched",
  rank: 1,
  mutationKind: "first-safe-smoke-coverage-v1",
};

function validateCandidate(candidate: AyasDaemonCandidate): void {
  if (candidate.exactFiles.length === 0) throw new Error("AYAS_PROPOSE_NO_EXACT_FILES");
  for (const filePath of candidate.exactFiles) {
    // Throws AyasBoundedFileWriteError for traversal/absolute/denied paths —
    // reused here purely as a path-safety check, no write happens.
    resolveAyasBoundedPath(root, filePath, ALLOWED_CANDIDATE_ROOTS);
  }
  if (!candidate.mutationKind.trim()) throw new Error("AYAS_PROPOSE_MUTATION_KIND_REQUIRED");
  if (!isAyasMutationKindRegistered(candidate.mutationKind)) {
    throw new Error(`AYAS_PROPOSE_MUTATION_KIND_UNREGISTERED: "${candidate.mutationKind}" has no reviewed implementation in AyasMutationRegistry.ts yet — write and review it before proposing`);
  }
}

function main(): void {
  validateCandidate(CANDIDATE);

  const branch = git(["branch", "--show-current"]);
  const head = git(["rev-parse", "HEAD"]);
  const repoClean = git(["status", "--porcelain"]).length === 0;
  const fresh = graphifyFresh();
  const now = new Date().toISOString();

  if (!repoClean) throw new Error("AYAS_PROPOSE_REPO_DIRTY");
  if (!fresh) throw new Error("AYAS_PROPOSE_GRAPHIFY_STALE");

  const inbox = createAyasApprovalInboxStore();
  const daemon = createAyasAutonomyDaemon({ inbox, now: () => now });
  const observation = { now, branch, head, repoClean, graphifyFresh: fresh, machineAction: "ALLOW" as const, gaps: [] as string[] };
  daemon.observe(observation);
  const proposals = daemon.discover(observation, [CANDIDATE]);

  if (proposals.length === 0) {
    console.log(JSON.stringify({ status: "NO_NEW_PROPOSAL", reason: "identical proposal already exists (deduped by proposalHash)" }));
    return;
  }
  const proposal = proposals[0]!;
  console.log(JSON.stringify({ status: "PROPOSAL_CREATED", proposalId: proposal.proposalId, safetyClassification: proposal.safetyClassification, mutationKind: proposal.mutationKind, exactFiles: proposal.exactFiles, baseHead: proposal.baseHead }, null, 2));
}

main();
