import crypto from "node:crypto";

import { createAyasActionFirewall } from "../../ayas/execution/AyasActionFirewall";
import { AYAS_DISCOVERY_RUN_ACTION, type AyasDiscoveryRunCapability, type AyasDiscoveryRunRequest } from "../../ayas/execution/AyasCapabilityScope";
import { resolveAyasExecutionAuditRoot } from "../../ayas/execution/AyasExecutionAuditContext";
import { AyasExecutionAuthorizationStore } from "../../ayas/execution/AyasExecutionAuthorization";

/**
 * Stage 15D — the run lease of the observer's discovery child.
 *
 * The child does the observer's autonomous discovery work: every tick it may
 * read a fixed list of public sources, run sandboxed experiments under the
 * system TEMP directory and write proposals to the approval inbox. Before
 * any of that it takes ONE lease from the common action firewall and the
 * existing authorization store: its exact capability set, the physical
 * repository, the base HEAD and the discovery ledger's run identity, valid
 * for at most five minutes. The admission is durable before this function
 * returns. If it cannot be recorded, the run is refused and does nothing.
 *
 * The lease grants nothing the child could not already do; it can only
 * withhold. It carries no approval, reservation, execution or publication
 * authority, and the capability names are not chat tools.
 */
export interface AyasDiscoveryRunGuard {
  readonly authorizationId: string;
  readonly capabilities: readonly AyasDiscoveryRunCapability[];
  /** Ask before each capability. False once the lease expires, is revoked by any process, or the run is settled. */
  permits(capability: AyasDiscoveryRunCapability): boolean;
  /** Records the run's outcome. Returns false when the record could not be written; the consumed admission stays as the evidence. */
  settle(outcome: { readonly ok: true; readonly summary: unknown } | { readonly ok: false }): boolean;
}

export class AyasDiscoveryRunNotAdmittedError extends Error {
  constructor(readonly reason: string) {
    super(`AYAS_DISCOVERY_RUN_NOT_ADMITTED: ${reason}`);
    this.name = "AyasDiscoveryRunNotAdmittedError";
  }
}

export interface AyasDiscoveryRunAdmissionInput {
  readonly repoRoot: string;
  readonly ledgerRunId: string;
  readonly baseHead: string;
  readonly capabilities: readonly AyasDiscoveryRunCapability[];
  /** The exact source list the research tick will be given. Required with that capability. */
  readonly publicReadSources?: readonly { readonly sourceId: string; readonly url: string }[];
  /** Trusted server/test store only. */
  readonly authorizations?: AyasExecutionAuthorizationStore;
  readonly now?: () => Date;
}

const sha256 = (value: string): string => crypto.createHash("sha256").update(value, "utf8").digest("hex");

/** One digest for one source list, whatever its order. */
export function ayasDiscoveryPublicReadSourceDigest(sources: readonly { readonly sourceId: string; readonly url: string }[]): string {
  return sha256(JSON.stringify(sources.map((source) => `${source.sourceId}\n${source.url}`).sort()));
}

export function admitAyasDiscoveryRun(input: AyasDiscoveryRunAdmissionInput): AyasDiscoveryRunGuard {
  const capabilities = [...new Set(input.capabilities)].sort();
  const reads = capabilities.includes("discovery.research-scheduler-tick");
  if (reads && !input.publicReadSources?.length) throw new AyasDiscoveryRunNotAdmittedError("AYAS_DISCOVERY_PUBLIC_READ_SOURCES_REQUIRED");
  const request: AyasDiscoveryRunRequest = Object.freeze({
    action: AYAS_DISCOVERY_RUN_ACTION, ledgerRunId: input.ledgerRunId, baseHead: input.baseHead, capabilities: Object.freeze(capabilities),
    publicReadSourceDigest: reads ? ayasDiscoveryPublicReadSourceDigest(input.publicReadSources!) : null,
  });
  let authorizations: AyasExecutionAuthorizationStore;
  let firewall: ReturnType<typeof createAyasActionFirewall>;
  try {
    authorizations = input.authorizations ?? new AyasExecutionAuthorizationStore({ rootDir: resolveAyasExecutionAuditRoot() });
    firewall = createAyasActionFirewall({ repoRoot: input.repoRoot, authorizations, ...(input.now ? { now: input.now } : {}) });
  } catch { throw new AyasDiscoveryRunNotAdmittedError("AYAS_FIREWALL_REPOSITORY_UNKNOWN"); }
  const issued = firewall.issueDiscoveryRun(request);
  if (!issued.allowed) throw new AyasDiscoveryRunNotAdmittedError(issued.reason);
  const admitted = firewall.admitDiscoveryRun(issued.lease, request);
  if (!admitted.allowed) throw new AyasDiscoveryRunNotAdmittedError(admitted.reason);
  return Object.freeze({
    authorizationId: admitted.authorizationId,
    capabilities: request.capabilities,
    permits: (capability: AyasDiscoveryRunCapability) => admitted.permits(capability),
    settle: (outcome: { readonly ok: true; readonly summary: unknown } | { readonly ok: false }) => {
      try {
        authorizations.settle(admitted.authorizationId, outcome.ok ? { ok: true, resultDigest: sha256(JSON.stringify(outcome.summary)) } : { ok: false, failureReason: "DISCOVERY_RUN_FAILED" });
        return true;
      } catch { return false; }
    },
  });
}
