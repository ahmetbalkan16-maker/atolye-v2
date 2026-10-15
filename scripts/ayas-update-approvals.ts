/**
 * The owner's approvals on the update radar, for the next update round (owner request 2026-10-15).
 *
 *   npm run ayas:update-approvals            # WAITING approvals first, then APPLIED
 *   npm run ayas:update-approvals -- --json  # machine-readable
 *
 * Read-only: it reads the radar and data/brain/self-improvement/update-approvals/state.json and writes nothing.
 * The npm script loads .env.local, because a record counts only when its owner seal verifies under AYAS_ACCESS_KEY;
 * without the key every record is unverifiable and the list is empty (said so below, never guessed).
 */
import { resolveAccessGate } from "../src/lib/auth/accessGate";
import { loadAyasResearchEngineStatusView } from "../src/lib/brain/autonomy/AyasResearchEngineStatusView";
import { createAyasUpdateApprovalStore } from "../src/lib/brain/autonomy/AyasUpdateApprovalStore";

const view = loadAyasResearchEngineStatusView();
const approvals = view.updateApprovals;
const recorded = (() => { try { return createAyasUpdateApprovalStore().load().decisions.length; } catch { return undefined; } })();
const keyAvailable = resolveAccessGate().mode === "enforced";

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ keyAvailable, recordedDecisions: recorded, approvals: approvals ?? null }, null, 2));
} else if (!approvals) {
  console.log("Onay deposu ya da radar okunamadı.");
  process.exitCode = 1;
} else {
  if (!keyAvailable) console.log("AYAS_ACCESS_KEY yok: owner mühürleri doğrulanamıyor, hiçbir kayıt sayılmadı (.env.local ile çalıştırın).");
  console.log(`${recorded ?? 0} karar kaydı · ${approvals.filter((a) => a.status === "WAITING").length} onay uygulanmayı bekliyor`);
  for (const a of approvals) {
    console.log(`- ${a.status === "WAITING" ? "BEKLİYOR " : "UYGULANDI"} ${a.toolName} ${a.installedVersion} → ${a.targetVersion} (${a.target}, ${a.bump}, ${a.applyChannel}) · onay ${a.approvedAt}`
      + (a.newerVersionOnRadar ? ` · radarda daha yeni: ${a.newerVersionOnRadar}` : "") + (a.currentInstalledVersion ? ` · kurulu ${a.currentInstalledVersion}` : ""));
  }
}
