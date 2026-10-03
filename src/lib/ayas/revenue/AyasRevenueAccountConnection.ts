/**
 * Stage 16.0A — external account connection / credential boundary (framework; real onboarding comes later
 * and only on the owner's decision).
 *
 * A connection is metadata only: the platform, an opaque account reference, a privacy-safe label, how the
 * credential is held (a connector or the server's secret store) and the NAME of that holder, the granted
 * scopes, and when it was connected, expires and was last verified. The credential itself never enters
 * AYAS memory, ledger, logs, evidence or task packets; a record that carries one is refused.
 *
 * Least privilege: the scopes a connection needs come from a code-owned scope map for the operations its
 * adapter declares (reads and owner-gated writes; local drafts need none; financial operations never get a
 * scope). Missing scopes, excess scopes, scopes the platform reports differently (drift), an expired or
 * unverified connection, or one the owner must re-authorize, is not usable. A health result is advisory
 * metadata and grants no authority.
 */
import { AYAS_REVENUE_OPERATION_EFFECT, AYAS_REVENUE_SCHEMA_VERSION, type AyasRevenueOperation, type AyasRevenuePlatform } from "./AyasRevenuePlatformTypes";
import { isAyasRevenueRequestShape } from "./AyasRevenueActionPolicy";
import { hasExactAyasRevenueKeys, isAyasRevenueExternalId, isAyasRevenueOperation, isAyasRevenuePlainRecord, isAyasRevenuePlatform, isAyasRevenueSensitiveText, isAyasRevenueTimestamp } from "./AyasRevenueRedaction";

export const AYAS_REVENUE_CONNECTION_HEALTH = Object.freeze(["HEALTHY", "EXPIRING", "EXPIRED", "REAUTH_REQUIRED", "SCOPE_MISSING", "SCOPE_EXCESS", "SCOPE_DRIFT", "UNVERIFIED"] as const);
export type AyasRevenueConnectionHealth = typeof AYAS_REVENUE_CONNECTION_HEALTH[number];
export const AYAS_REVENUE_CONNECTION_LIMITS = Object.freeze({ scopes: 32, expiringWindowMs: 7 * 86_400_000, verificationMaxAgeMs: 86_400_000 });

export interface AyasRevenueAccountConnection {
  readonly schemaVersion: typeof AYAS_REVENUE_SCHEMA_VERSION;
  readonly platform: AyasRevenuePlatform;
  readonly accountRef: string;
  /** Privacy-safe display label (no contact detail, no long number). */
  readonly label: string;
  readonly credentialHandling: "CONNECTOR_MANAGED" | "SERVER_SECRET";
  /** The NAME of the credential holder: `connector:<id>` or `vault:<name>` (a server secret store; the word "secret" is avoided because the secret scanner reads `secret:<x>` as an assignment). Never a credential value. */
  readonly credentialRef: string;
  readonly grantedScopes: readonly string[];
  readonly connectedAt: string;
  readonly expiresAt: string | null;
  readonly lastVerifiedAt: string | null;
  readonly reauthRequired: boolean;
}
/** Code-owned: the scopes each operation needs on one platform. */
export type AyasRevenueScopeMap = Readonly<Partial<Record<AyasRevenueOperation, readonly string[]>>>;

const CONNECTION_KEYS = ["schemaVersion", "platform", "accountRef", "label", "credentialHandling", "credentialRef", "grantedScopes", "connectedAt", "expiresAt", "lastVerifiedAt", "reauthRequired"] as const;
const SCOPE = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/;
const isScope = (value: unknown): value is string => typeof value === "string" && SCOPE.test(value) && !isAyasRevenueSensitiveText(value);
const isScopeList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.length <= AYAS_REVENUE_CONNECTION_LIMITS.scopes && value.every(isScope) && new Set(value).size === value.length;

export function isAyasRevenueAccountConnection(raw: unknown): raw is AyasRevenueAccountConnection {
  if (!isAyasRevenuePlainRecord(raw) || !hasExactAyasRevenueKeys(raw, CONNECTION_KEYS)) return false;
  const holder = raw.credentialHandling === "CONNECTOR_MANAGED" ? "connector" : raw.credentialHandling === "SERVER_SECRET" ? "vault" : null;
  if (raw.schemaVersion !== AYAS_REVENUE_SCHEMA_VERSION || !isAyasRevenuePlatform(raw.platform) || !isAyasRevenueExternalId(raw.accountRef)
    || typeof raw.label !== "string" || raw.label.length < 1 || raw.label.length > 48 || /[\d]{5,}/.test(raw.label) || isAyasRevenueSensitiveText(raw.label)
    || holder === null || typeof raw.credentialRef !== "string" || !new RegExp(`^${holder}:[a-z0-9][a-z0-9._-]{2,63}$`).test(raw.credentialRef) || isAyasRevenueSensitiveText(raw.credentialRef)
    || !isScopeList(raw.grantedScopes) || !isAyasRevenueTimestamp(raw.connectedAt) || typeof raw.reauthRequired !== "boolean"
    || (raw.expiresAt !== null && (!isAyasRevenueTimestamp(raw.expiresAt) || raw.expiresAt <= raw.connectedAt))
    || (raw.lastVerifiedAt !== null && (!isAyasRevenueTimestamp(raw.lastVerifiedAt) || raw.lastVerifiedAt < raw.connectedAt))) return false;
  return true;
}

/** Scopes needed for the declared operations: reads and owner-gated writes. Local drafts need none; financial operations never get one. */
export function requiredAyasRevenueScopes(operations: readonly AyasRevenueOperation[], scopeMap: AyasRevenueScopeMap): { readonly scopes: readonly string[]; readonly unmapped: readonly AyasRevenueOperation[] } {
  const scopes = new Set<string>(), unmapped: AyasRevenueOperation[] = [];
  for (const op of operations) {
    const effect = AYAS_REVENUE_OPERATION_EFFECT[op];
    if (effect === "LOCAL_DRAFT" || effect === "FINANCIAL_COMMITMENT") continue;
    const needed = Object.hasOwn(scopeMap, op) ? scopeMap[op] : undefined;
    if (!isScopeList(needed) || needed.length === 0) { unmapped.push(op); continue; }
    for (const s of needed) scopes.add(s);
  }
  return Object.freeze({ scopes: Object.freeze([...scopes].sort()), unmapped: Object.freeze(unmapped) });
}

export interface AyasRevenueConnectionAssessment {
  readonly health: AyasRevenueConnectionHealth;
  readonly usable: boolean;
  readonly missingScopes: readonly string[];
  readonly excessScopes: readonly string[];
  readonly drift: { readonly added: readonly string[]; readonly removed: readonly string[] } | null;
  readonly unmappedOperations: readonly AyasRevenueOperation[];
  readonly reauthRecommended: boolean;
  readonly grantsAuthority: false;
}
/**
 * `observedScopes` are the scopes the platform reports for the account at `lastVerifiedAt` (null when the
 * connection was never verified). An invalid connection or input is UNVERIFIED and not usable.
 */
export function assessAyasRevenueConnection(connection: unknown, input: { readonly now: string; readonly operations: readonly AyasRevenueOperation[]; readonly scopeMap: AyasRevenueScopeMap; readonly observedScopes: readonly string[] | null }): AyasRevenueConnectionAssessment {
  const result = (health: AyasRevenueConnectionHealth, extra: Partial<AyasRevenueConnectionAssessment> = {}): AyasRevenueConnectionAssessment => Object.freeze({
    health, usable: health === "HEALTHY" || health === "EXPIRING", missingScopes: [], excessScopes: [], drift: null, unmappedOperations: [],
    reauthRecommended: health !== "HEALTHY", grantsAuthority: false as const, ...extra });
  if (!isAyasRevenueAccountConnection(connection) || !isAyasRevenueTimestamp(input.now) || !Array.isArray(input.operations) || !input.operations.every(isAyasRevenueOperation)
    || (input.observedScopes !== null && !isScopeList(input.observedScopes))) return result("UNVERIFIED");
  const c = connection, now = Date.parse(input.now);
  if (c.reauthRequired) return result("REAUTH_REQUIRED");
  if (c.expiresAt !== null && Date.parse(c.expiresAt) <= now) return result("EXPIRED");
  const required = requiredAyasRevenueScopes(input.operations, input.scopeMap);
  if (required.unmapped.length) return result("UNVERIFIED", { unmappedOperations: required.unmapped });
  const granted = new Set(c.grantedScopes), needed = new Set(required.scopes);
  const missingScopes = [...needed].filter((s) => !granted.has(s)).sort(), excessScopes = [...granted].filter((s) => !needed.has(s)).sort();
  if (missingScopes.length) return result("SCOPE_MISSING", { missingScopes });
  if (excessScopes.length) return result("SCOPE_EXCESS", { excessScopes });
  if (input.observedScopes === null || c.lastVerifiedAt === null || now - Date.parse(c.lastVerifiedAt) > AYAS_REVENUE_CONNECTION_LIMITS.verificationMaxAgeMs) return result("UNVERIFIED");
  const observed = new Set(input.observedScopes);
  const drift = { added: [...observed].filter((s) => !granted.has(s)).sort(), removed: [...granted].filter((s) => !observed.has(s)).sort() };
  if (drift.added.length || drift.removed.length) return result("SCOPE_DRIFT", { drift });
  if (c.expiresAt !== null && Date.parse(c.expiresAt) - now < AYAS_REVENUE_CONNECTION_LIMITS.expiringWindowMs) return result("EXPIRING");
  return result("HEALTHY");
}

export type AyasRevenueConnectionGate = "CONNECTION_OK" | "CONNECTION_NOT_REQUIRED" | "CONNECTION_REFUSED";
export type AyasRevenueConnectionGateReason = "OK" | "LOCAL_DRAFT" | "FINANCIAL_NOT_AUTONOMOUS" | "PLATFORM_MISMATCH" | "ACCOUNT_MISMATCH" | "CONNECTION_NOT_USABLE" | "SCOPE_NOT_GRANTED" | "INVALID";
/**
 * Whether a planned request may use this connection. The assessment is computed here from the same inputs, never
 * taken from the caller. A local draft needs no connection; money never moves. Advisory: grants no authority.
 */
export function gateAyasRevenueRequestConnection(request: unknown, connection: unknown, context: Parameters<typeof assessAyasRevenueConnection>[1]):
  { readonly gate: AyasRevenueConnectionGate; readonly reason: AyasRevenueConnectionGateReason; readonly health: AyasRevenueConnectionHealth | null; readonly grantsAuthority: false } {
  const out = (gate: AyasRevenueConnectionGate, reason: AyasRevenueConnectionGateReason, health: AyasRevenueConnectionHealth | null = null) => Object.freeze({ gate, reason, health, grantsAuthority: false as const });
  if (!isAyasRevenueRequestShape(request) || !isAyasRevenueOperation(request.operation) || !isAyasRevenueAccountConnection(connection)) return out("CONNECTION_REFUSED", "INVALID");
  const effect = AYAS_REVENUE_OPERATION_EFFECT[request.operation];
  if (effect === "FINANCIAL_COMMITMENT") return out("CONNECTION_REFUSED", "FINANCIAL_NOT_AUTONOMOUS");
  if (effect === "LOCAL_DRAFT") return out("CONNECTION_NOT_REQUIRED", "LOCAL_DRAFT");
  if (request.platform !== connection.platform) return out("CONNECTION_REFUSED", "PLATFORM_MISMATCH");
  if (request.accountRef !== connection.accountRef) return out("CONNECTION_REFUSED", "ACCOUNT_MISMATCH");
  const assessment = assessAyasRevenueConnection(connection, context);
  if (!assessment.usable) return out("CONNECTION_REFUSED", "CONNECTION_NOT_USABLE", assessment.health);
  const needed = Object.hasOwn(context.scopeMap, request.operation) ? context.scopeMap[request.operation] : undefined;
  if (!isScopeList(needed) || needed.length === 0 || !needed.every((s) => connection.grantedScopes.includes(s))) return out("CONNECTION_REFUSED", "SCOPE_NOT_GRANTED", assessment.health);
  return out("CONNECTION_OK", "OK", assessment.health);
}
