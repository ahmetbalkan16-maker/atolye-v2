/** Central, deterministic monetary authority for AYAS autonomous work. */
export const AYAS_AUTONOMOUS_MONETARY_BUDGET_USD = 0 as const;

export type AyasCostClass =
  | "local-zero-cost"
  | "free-public"
  | "paid"
  | "subscription"
  | "metered-free-tier"
  | "unknown-cost";

export interface AyasCostDecision {
  readonly allowed: boolean;
  readonly costClass: AyasCostClass;
  readonly budgetUsd: typeof AYAS_AUTONOMOUS_MONETARY_BUDGET_USD;
  readonly reasonCode:
    | "AYAS_ZERO_COST_ALLOWED_LOCAL"
    | "AYAS_ZERO_COST_ALLOWED_FREE_PUBLIC"
    | "AYAS_ZERO_COST_DENIED_MONETARY"
    | "AYAS_ZERO_COST_DENIED_UNKNOWN";
}

const ALLOWED = new Set<AyasCostClass>(["local-zero-cost", "free-public"]);

export function evaluateAyasZeroCost(costClass: AyasCostClass): AyasCostDecision {
  const allowed = ALLOWED.has(costClass);
  return Object.freeze({
    allowed,
    costClass,
    budgetUsd: AYAS_AUTONOMOUS_MONETARY_BUDGET_USD,
    reasonCode: allowed
      ? costClass === "local-zero-cost"
        ? "AYAS_ZERO_COST_ALLOWED_LOCAL"
        : "AYAS_ZERO_COST_ALLOWED_FREE_PUBLIC"
      : costClass === "unknown-cost"
        ? "AYAS_ZERO_COST_DENIED_UNKNOWN"
        : "AYAS_ZERO_COST_DENIED_MONETARY",
  });
}

/** Unknown or absent declarations fail closed. */
export function parseAyasCostClass(value: unknown): AyasCostClass {
  return typeof value === "string" && [
    "local-zero-cost", "free-public", "paid", "subscription", "metered-free-tier", "unknown-cost",
  ].includes(value) ? value as AyasCostClass : "unknown-cost";
}

export function assertAyasZeroCost(costClass: AyasCostClass): void {
  const decision = evaluateAyasZeroCost(costClass);
  if (!decision.allowed) throw new AyasZeroCostPolicyError(decision.reasonCode);
}

export class AyasZeroCostPolicyError extends Error {
  readonly code: AyasCostDecision["reasonCode"];
  constructor(code: AyasCostDecision["reasonCode"]) {
    super("AYAS autonomous work is restricted to zero-cost resources.");
    this.name = "AyasZeroCostPolicyError";
    this.code = code;
    this.stack = undefined;
  }
}
