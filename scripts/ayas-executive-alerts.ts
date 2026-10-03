/**
 * Read-only diagnostic status. No source collection, notification delivery, acknowledgement or privileged action.
 * `--verify-full` replays the whole hash chain instead of the bounded window the briefing reads.
 */
import path from "node:path";
import { readAyasExecutiveAlerts, verifyAyasExecutiveAlertHistory } from "../src/lib/ayas/briefing/AyasExecutiveAlertStore";
import { executiveAlertQueues } from "../src/lib/ayas/briefing/AyasExecutiveAlerts";
const args = process.argv.slice(2), full = args[0] === "--verify-full", rest = full ? args.slice(1) : args;
if (rest.length !== 0 && (rest.length !== 2 || rest[0] !== "--repo")) throw new Error("AYAS_BRIEFING_ARGUMENT_INVALID");
const repo = path.resolve(rest[1] ?? process.cwd()), state = full ? verifyAyasExecutiveAlertHistory(repo) : readAyasExecutiveAlerts(repo);
if (state.status === "UNAVAILABLE") { console.log(JSON.stringify({ ...state, verification: full ? "FULL_CHAIN" : "WINDOW" })); process.exitCode = 2; }
else {
  const queues = executiveAlertQueues(state.state,new Date().toISOString());
  console.log(JSON.stringify({status:state.status,verification:full ? "FULL_CHAIN" : "WINDOW",sequence:state.sequence,digest:state.digest,active:state.state.alerts.filter(a=>a.active).length,
    immediate:queues.immediate.length,approvalQueue:queues.approvalQueue.length,nextBriefing:queues.nextBriefing.length,grantsAuthority:false}));
}
