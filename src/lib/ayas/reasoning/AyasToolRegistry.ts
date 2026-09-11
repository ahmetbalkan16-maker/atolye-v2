/**
 * Atölye Brain — AYAS tool registry (Phase 2 · Phase D · §6).
 *
 * NOT a tool system — no adapters, no invocation. The interface the reasoning
 * core needs so it can *name* a tool in `requiredTools` and know, deterministically,
 * whether even describing that tool as "used" is permitted. Real read-only
 * tools are derived from the EXISTING `AYAS_EXECUTION_ALLOWLIST`
 * (`src/lib/ayas/execution/AyasExecutionPolicy.ts`) rather than re-declared —
 * this file adds descriptive metadata (kind/risk/availableOn), it does not
 * invent a second source of truth for what is actually allowed to run.
 *
 * The reserved (not-yet-enabled) write actions are listed too, but marked
 * `readOnly: false, requiredPermission: "execution-gate"` — the reasoning core
 * may reference them (e.g. to explain "bunun için yürütme kapısı kapalı"), it
 * can never treat them as available.
 */

import {
  AYAS_EXECUTION_ALLOWLIST,
  AYAS_EXECUTION_RESERVED_ACTIONS,
  type AyasExecutionActionId,
} from "../execution/AyasExecutionPolicy";
import type { AyasToolDescriptor, AyasToolRequiredPermission } from "./AyasReasoningTypes";

const READ_ONLY_TOOLS: readonly AyasToolDescriptor[] = Object.freeze(
  (Object.keys(AYAS_EXECUTION_ALLOWLIST) as AyasExecutionActionId[]).map((id) => {
    const spec = AYAS_EXECUTION_ALLOWLIST[id];
    return Object.freeze({
      id,
      name: id,
      description: spec.summary,
      kind: id === "pipeline-recovery-plan" ? "diagnostic" : "inspection",
      risk: "none",
      readOnly: !spec.write,
      availableOn: Object.freeze(["phone", "pc"] as const),
      requiredPermission: "read-only" as AyasToolRequiredPermission,
    });
  }),
);

/** Reserved write-shaped actions — described so AYAS can explain why they're unavailable, never treated as usable. */
const RESERVED_TOOLS: readonly AyasToolDescriptor[] = Object.freeze(
  AYAS_EXECUTION_RESERVED_ACTIONS.map((id) =>
    Object.freeze({
      id,
      name: id,
      description: "Yürütme kapısı CLOSED olduğu için şu an kullanılamaz (operatör onayı gerektirir).",
      kind: "pipeline-write" as const,
      risk: "high" as const,
      readOnly: false,
      availableOn: Object.freeze(["pc"] as const),
      requiredPermission: "execution-gate" as AyasToolRequiredPermission,
    }),
  ),
);

/** A read-only, phone-safe research placeholder (§3.3 RESEARCH) — descriptive only, nothing implements it yet. */
const RESEARCH_TOOL: AyasToolDescriptor = Object.freeze({
  id: "web-research-lookup",
  name: "web-research-lookup",
  description: "Genel bir konu hakkında salt-okunur araştırma özeti (HENÜZ UYGULANMADI — yalnızca arayüz tanımı).",
  kind: "research",
  risk: "low",
  readOnly: true,
  availableOn: Object.freeze(["phone", "pc"] as const),
  requiredPermission: "read-only",
});

export const AYAS_TOOL_REGISTRY: readonly AyasToolDescriptor[] = Object.freeze([
  ...READ_ONLY_TOOLS,
  RESEARCH_TOOL,
  ...RESERVED_TOOLS,
]);

export function findAyasTool(id: string): AyasToolDescriptor | null {
  return AYAS_TOOL_REGISTRY.find((t) => t.id === id) ?? null;
}

export interface AyasToolPermissionResult {
  readonly toolId: string;
  readonly known: boolean;
  readonly allowed: boolean;
  readonly reason: string;
}

/**
 * Pure classification against the static registry. `allowed: true` means "a
 * real, currently-enabled read-only action" — it is NOT an instruction to run
 * anything; the reasoning core never calls an executor. Anything unknown or
 * gated by the Execution Gate is `allowed: false` with a safe, specific reason.
 */
export function checkAyasToolPermission(toolId: string): AyasToolPermissionResult {
  const tool = findAyasTool(toolId);
  if (!tool) {
    return { toolId, known: false, allowed: false, reason: "bilinmeyen araç" };
  }
  if (tool.requiredPermission === "execution-gate") {
    return { toolId, known: true, allowed: false, reason: "yürütme kapısı kapalı (CLOSED) — operatör onayı gerekir" };
  }
  if (!tool.readOnly) {
    return { toolId, known: true, allowed: false, reason: "salt-okunur değil — bu sprintte etkin değil" };
  }
  return { toolId, known: true, allowed: true, reason: "salt-okunur, izinli" };
}
