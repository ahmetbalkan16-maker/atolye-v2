import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";

// Log destination only, not authority. Trusted server/test code controls it;
// no model/tool request field can select the durable execution audit root.
const auditRootContext = new AsyncLocalStorage<string>();
export function withAyasExecutionAuditRoot<T>(root: string, operation: () => T): T {
  return auditRootContext.run(path.resolve(root), operation);
}
export function resolveAyasExecutionAuditRoot(): string {
  return auditRootContext.getStore() ?? path.join(process.cwd(), "data", "brain");
}
