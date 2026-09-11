/**
 * Atölye Brain — AYAS Reasoning Core, shared contracts (Phase 2 · Phase D).
 *
 * Pure types only. Reuses {@link AyasChatComplexity} from the model layer
 * (P0-A) instead of a second complexity enum, and {@link AyasExecutionActionId}
 * from the existing execution control plane instead of a second action-id type
 * — this file only adds what neither already has: the structured reasoning
 * result shape, the tool descriptor, and the phone/pc node capability model.
 */

import type { AyasChatComplexity } from "../model/AyasModelTypes";
import type { AyasExecutionActionId } from "../execution/AyasExecutionPolicy";

export type { AyasChatComplexity };

/**
 * A structured, operational SUMMARY of one reasoning pass — never the model's
 * raw chain-of-thought (spec §3.2: no hidden/private/internal reasoning is
 * ever captured or shown). Every field is a short, safe, user-answerable
 * statement; none of them is free-form scratch space.
 */
export interface AyasReasoningResult {
  readonly intent: string;
  readonly goal: string;
  readonly constraints: readonly string[];
  readonly assumptions: readonly string[];
  readonly complexity: AyasChatComplexity;
  readonly plan: readonly string[];
  /** Tool ids from {@link AyasToolDescriptor}`.id` — never a free-form string. */
  readonly requiredTools: readonly string[];
  readonly risk: string;
  readonly verification: readonly string[];
  /** The actual reply text shown to the user — still runs through the same
   *  `isUsableAyasReply` / `ayasReplyClaimsExecution` guards as every other path. */
  readonly answer: string;
}

/** A safe, client-facing observability projection — no secret, no raw model text beyond the structured fields. */
export type AyasReasoningTrace = Pick<
  AyasReasoningResult,
  "intent" | "goal" | "plan" | "requiredTools" | "risk" | "verification"
>;

export type AyasToolRisk = "none" | "low" | "medium" | "high";

/** Where a tool can even conceivably run — capability metadata only, grants no permission by itself (spec §7). */
export type AyasNodeId = "phone" | "pc";

export type AyasToolRequiredPermission =
  /** No gate at all — pure computation / classification, e.g. a Turkish regex check. */
  | "none"
  /** Reads state only. Real ones today are `AYAS_EXECUTION_ALLOWLIST` entries with `write:false`. */
  | "read-only"
  /** Anything that writes, executes, or touches git/deploy — needs the (currently CLOSED) Execution Gate. */
  | "execution-gate";

/**
 * Describes a tool the reasoning core may *mention* in `requiredTools` — it
 * never invokes one. `id` overlaps `AyasExecutionActionId` for the two tools
 * that map onto a real allowlisted, read-only execution action; other ids are
 * descriptive-only placeholders for future (still unbuilt) capabilities.
 */
export interface AyasToolDescriptor {
  readonly id: AyasExecutionActionId | string;
  readonly name: string;
  readonly description: string;
  readonly kind: "inspection" | "diagnostic" | "research" | "pipeline-write" | "system";
  readonly risk: AyasToolRisk;
  /** `false` for anything not already a `write:false` entry on `AYAS_EXECUTION_ALLOWLIST`. */
  readonly readOnly: boolean;
  readonly availableOn: readonly AyasNodeId[];
  readonly requiredPermission: AyasToolRequiredPermission;
}

/** Capability metadata only (spec §7) — carries no execution authority. */
export interface AyasNodeCapabilities {
  readonly node: AyasNodeId;
  readonly capabilities: readonly string[];
}

export const AYAS_NODE_CAPABILITIES: readonly AyasNodeCapabilities[] = Object.freeze([
  { node: "phone", capabilities: Object.freeze(["chat", "voice", "memory.read", "reasoning", "cloud"]) },
  {
    node: "pc",
    capabilities: Object.freeze([
      "chat",
      "voice",
      "memory",
      "filesystem",
      "terminal",
      "git",
      "gpu",
      "ollama",
      "selfheal",
    ]),
  },
]);

export function resolveAyasNodeCapabilities(node: AyasNodeId): readonly string[] {
  return AYAS_NODE_CAPABILITIES.find((n) => n.node === node)?.capabilities ?? [];
}
