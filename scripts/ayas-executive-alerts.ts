/** Read-only diagnostic status. No source collection, notification delivery, acknowledgement or privileged action. */
import path from "node:path";
import { readAyasExecutiveAlerts } from "../src/lib/ayas/briefing/AyasExecutiveAlertStore";
import { executiveAlertQueues } from "../src/lib/ayas/briefing/AyasExecutiveAlerts";
const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== "--repo")) throw new Error("AYAS_BRIEFING_ARGUMENT_INVALID");
const state = readAyasExecutiveAlerts(path.resolve(args[1] ?? process.cwd()));
if (state.status === "UNAVAILABLE") { console.log(JSON.stringify(state)); process.exitCode = 2; }
else {
  const queues = executiveAlertQueues(state.state,new Date().toISOString());
  console.log(JSON.stringify({status:state.status,sequence:state.sequence,digest:state.digest,active:state.state.alerts.filter(a=>a.active).length,
    immediate:queues.immediate.length,approvalQueue:queues.approvalQueue.length,nextBriefing:queues.nextBriefing.length,auditOnly:queues.auditOnly.length,grantsAuthority:false}));
}
