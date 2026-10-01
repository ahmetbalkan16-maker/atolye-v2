/** Operator-invoked only; dry-run by default. Agents never --apply to the live root. */
import { resolveAyasExecutionAuditRoot } from "../src/lib/ayas/execution/AyasExecutionAuditContext";
import { AyasExecutionAuthorizationStore } from "../src/lib/ayas/execution/AyasExecutionAuthorization";
import { applyAyasAuthorizationCompaction, auditAyasAuthorizationCompaction } from "../src/lib/ayas/observability/AyasAuthorizationCompaction";
import { createAyasOperationEvidenceStore } from "../src/lib/ayas/observability/AyasOperationEvidenceStore";

function main() {
  const args = process.argv.slice(2);
  let rootDir = resolveAyasExecutionAuditRoot();
  let apply = false;
  let minAgeMs: number | undefined;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--apply") apply = true;
    else if (flag === "--root" && args[i + 1] && !args[i + 1]!.startsWith("--")) rootDir = args[++i]!;
    else if (flag === "--min-age-days" && args[i + 1] && Number.isSafeInteger(Number(args[i + 1])) && Number(args[i + 1]) >= 1) minAgeMs = Number(args[++i]) * 86_400_000;
    else throw new Error("ARGUMENT_INVALID");
  }
  const options = { authorizations: new AyasExecutionAuthorizationStore({ rootDir }), evidence: createAyasOperationEvidenceStore({ rootDir }), nowMs: Date.now(), minAgeMs };
  if (apply) {
    const result = applyAyasAuthorizationCompaction(options);
    console.log(JSON.stringify({ mode: "APPLY", ...result }, null, 2));
    if (result.failed.length) process.exitCode = 1;
  } else console.log(JSON.stringify({ mode: "DRY_RUN", ...auditAyasAuthorizationCompaction(options) }, null, 2));
}
try { main(); } catch { console.error("AYAS_AUTHORIZATION_COMPACTION_FAILED"); process.exitCode = 1; }
