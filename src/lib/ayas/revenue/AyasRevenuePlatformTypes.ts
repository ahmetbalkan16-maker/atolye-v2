/**
 * Stage 16.0 — the closed vocabulary of the revenue platform adapter standard.
 *
 * Every later platform integration (Etsy, Upwork, Fiverr, Udemy, Lemon Squeezy) implements this one
 * contract. Platform, operation, effect, transport and credential handling are code-owned closed sets:
 * a name that is not listed here is UNKNOWN and refused, never treated as compatible. Financial
 * operations exist only so they can be denied; nothing in Stage 16.0 executes one.
 */
import type { AyasCostClass } from "../policy/AyasZeroCostPolicy";

export const AYAS_REVENUE_SCHEMA_VERSION = "1" as const;
export const AYAS_REVENUE_PLATFORMS = Object.freeze(["etsy", "upwork", "fiverr", "udemy", "lemon-squeezy"] as const);
export type AyasRevenuePlatform = typeof AYAS_REVENUE_PLATFORMS[number];

export const AYAS_REVENUE_EFFECTS = Object.freeze(["READ_ONLY", "LOCAL_DRAFT", "EXTERNAL_WRITE", "FINANCIAL_COMMITMENT"] as const);
export type AyasRevenueEffect = typeof AYAS_REVENUE_EFFECTS[number];

/** Each operation maps to exactly one effect class. */
export const AYAS_REVENUE_OPERATION_EFFECT = Object.freeze({
  ACCOUNT_STATUS_READ: "READ_ONLY",
  OPPORTUNITY_LIST_READ: "READ_ONLY",
  LISTING_LIST_READ: "READ_ONLY",
  ORDER_LIST_READ: "READ_ONLY",
  MESSAGE_LIST_READ: "READ_ONLY",
  PAYOUT_LIST_READ: "READ_ONLY",
  ANALYTICS_READ: "READ_ONLY",
  LISTING_DRAFT: "LOCAL_DRAFT",
  PROPOSAL_DRAFT: "LOCAL_DRAFT",
  COURSE_DRAFT: "LOCAL_DRAFT",
  MESSAGE_DRAFT: "LOCAL_DRAFT",
  DELIVERABLE_DRAFT: "LOCAL_DRAFT",
  LISTING_CREATE: "EXTERNAL_WRITE",
  LISTING_UPDATE: "EXTERNAL_WRITE",
  PROPOSAL_SUBMIT: "EXTERNAL_WRITE",
  COURSE_PUBLISH: "EXTERNAL_WRITE",
  MESSAGE_SEND: "EXTERNAL_WRITE",
  ORDER_ACCEPT: "EXTERNAL_WRITE",
  DELIVERABLE_SUBMIT: "EXTERNAL_WRITE",
  PURCHASE: "FINANCIAL_COMMITMENT",
  AD_SPEND: "FINANCIAL_COMMITMENT",
  FEE_COMMIT: "FINANCIAL_COMMITMENT",
  REFUND: "FINANCIAL_COMMITMENT",
  FUNDS_WITHDRAW: "FINANCIAL_COMMITMENT",
} as const satisfies Readonly<Record<string, AyasRevenueEffect>>);
export type AyasRevenueOperation = keyof typeof AYAS_REVENUE_OPERATION_EFFECT;
export const AYAS_REVENUE_OPERATIONS = Object.freeze(Object.keys(AYAS_REVENUE_OPERATION_EFFECT) as AyasRevenueOperation[]);

export const AYAS_REVENUE_TRANSPORTS = Object.freeze(["PLUGIN", "OFFICIAL_API", "MANUAL_HANDOFF"] as const);
export const AYAS_REVENUE_CREDENTIAL_HANDLING = Object.freeze(["CONNECTOR_MANAGED", "SERVER_SECRET", "NONE"] as const);
export const AYAS_REVENUE_MODES = Object.freeze(["READ", "DRAFT", "EXECUTE"] as const);
export type AyasRevenueMode = typeof AYAS_REVENUE_MODES[number];
/** The only mode a request for an operation of this effect may carry. */
export const AYAS_REVENUE_EFFECT_MODE = Object.freeze({
  READ_ONLY: "READ", LOCAL_DRAFT: "DRAFT", EXTERNAL_WRITE: "EXECUTE", FINANCIAL_COMMITMENT: "EXECUTE",
} as const satisfies Readonly<Record<AyasRevenueEffect, AyasRevenueMode>>);
export const AYAS_REVENUE_RESULT_STATUSES = Object.freeze(["OK", "EMPTY", "BLOCKED", "UNAVAILABLE", "ERROR"] as const);
export type AyasRevenueResultStatus = typeof AYAS_REVENUE_RESULT_STATUSES[number];

export const AYAS_REVENUE_LIMITS = Object.freeze({
  payloadBytes: 65_536,
  resultDataBytes: 262_144,
  jsonDepth: 8,
  pageLimit: 100,
  cursorOpaqueChars: 512,
  adapterVersionMax: 10_000,
  adapterTimeoutMs: 10_000,
});

export interface AyasRevenueAdapterManifest {
  readonly schemaVersion: typeof AYAS_REVENUE_SCHEMA_VERSION;
  readonly platform: AyasRevenuePlatform;
  readonly adapterId: string;
  readonly adapterVersion: number;
  readonly transport: typeof AYAS_REVENUE_TRANSPORTS[number];
  readonly locality: "EXTERNAL";
  readonly credentialHandling: typeof AYAS_REVENUE_CREDENTIAL_HANDLING[number];
  readonly costClass: AyasCostClass;
  readonly supportedOperations: readonly AyasRevenueOperation[];
  readonly writeOperationsRequireOwnerApproval: true;
  readonly financialOperationsAutonomous: false;
}

export interface AyasRevenueAdapterRequest {
  readonly requestId: string;
  readonly platform: AyasRevenuePlatform;
  readonly operation: AyasRevenueOperation;
  readonly mode: AyasRevenueMode;
  /** Opaque, bounded, never a secret and never a path. */
  readonly accountRef: string | null;
  readonly cursor?: string | null;
  readonly limit?: number;
  readonly payload?: unknown;
  readonly requestedAt: string;
}

export interface AyasRevenueAdapterResult<T = unknown> {
  readonly schemaVersion: typeof AYAS_REVENUE_SCHEMA_VERSION;
  readonly requestId: string;
  readonly platform: AyasRevenuePlatform;
  readonly operation: AyasRevenueOperation;
  readonly status: AyasRevenueResultStatus;
  readonly observedAt: string;
  readonly data: T | null;
  readonly nextCursor: string | null;
  readonly evidence: {
    readonly transport: AyasRevenueAdapterManifest["transport"];
    readonly externalMutation: boolean;
    readonly monetaryMutation: boolean;
  };
  readonly errorCode?: string;
}
