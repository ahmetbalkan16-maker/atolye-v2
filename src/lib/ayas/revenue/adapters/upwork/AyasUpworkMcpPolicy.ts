/** Stage16.5: discovered tools are untrusted metadata. Only source-reviewed pins can describe a capability. */
import type { AyasRevenueOperation } from "../../AyasRevenuePlatformTypes";
import { ayasRevenueEffect } from "../../AyasRevenueActionPolicy";
import { digestAyasRevenueData } from "../../AyasRevenueDigest";
import { isAyasRevenueDigest, isAyasRevenueDataArray } from "../../AyasRevenueOpportunity";
import { deepFreezeAyasRevenueValue, hasExactAyasRevenueKeys, isAyasRevenueBoundedJson, isAyasRevenueOperation, isAyasRevenuePlainRecord,
  isAyasRevenueSensitiveText, snapshotAyasRevenueValue } from "../../AyasRevenueRedaction";

export const AYAS_UPWORK_MCP_ENDPOINT = "https://mcp.upwork.com/mcp" as const;
export const UPWORK_WORKFLOW_POLICY = "OWNER_SUPPORT_CONFIRMATION_REQUIRED" as const;
export const AYAS_UPWORK_MAX_BYTES = 131_072;
export const AYAS_UPWORK_PAGE_LIMIT = 25;
export const AYAS_UPWORK_KINDS = Object.freeze(["ACCOUNT", "JOBS", "INVITATIONS", "PROPOSALS", "CONTRACTS", "EARNINGS"] as const);
export type AyasUpworkKind = typeof AYAS_UPWORK_KINDS[number];
export interface AyasUpworkReviewedTool {
  readonly name: string; readonly operation: AyasRevenueOperation; readonly kind: AyasUpworkKind;
  readonly inputSchemaDigest: string; readonly outputSchemaDigest: string; readonly annotationsDigest: string;
  readonly scopes: readonly string[]; readonly zeroCostVerified: boolean;
}
/** Anonymous initialize returned 401: no official identities/schemas/scopes have been qualified. Never invent them. */
export const AYAS_UPWORK_REVIEWED_TOOLS: readonly AyasUpworkReviewedTool[] = Object.freeze([]);
export type AyasUpworkWorkflow = "OWNER_INTERACTIVE" | "SCHEDULED" | "AI_RANKING" | "RAW_STORAGE" | "HOSTED_MULTI_USER" | "CHAINED_WRITE";
export function allowAyasUpworkWorkflow(workflow: unknown): boolean { return workflow === "OWNER_INTERACTIVE"; }

/** Preflight descriptors before cloning; no getters, oversized trees or mutable aliases cross the boundary. */
export function snapshotAyasUpworkData(raw: unknown): unknown | null {
  try {
    if (!isAyasRevenueBoundedJson(raw, AYAS_UPWORK_MAX_BYTES)) return null;
    const s = snapshotAyasRevenueValue(raw);
    return s.ok && isAyasRevenueBoundedJson(s.value, AYAS_UPWORK_MAX_BYTES) ? deepFreezeAyasRevenueValue(s.value) : null;
  } catch { return null; }
}
export function snapshotAyasUpworkReviewedTools(raw: unknown): readonly AyasUpworkReviewedTool[] | null {
  const list = snapshotAyasUpworkData(raw);
  if (!isAyasRevenueDataArray(list, 32)) return null;
  const names = new Set<string>(), reads = new Set<string>();
  for (const tool of list) {
    if (!isAyasRevenuePlainRecord(tool) || !hasExactAyasRevenueKeys(tool, ["name", "operation", "kind", "inputSchemaDigest", "outputSchemaDigest", "annotationsDigest", "scopes", "zeroCostVerified"])
      || typeof tool.name !== "string" || !/^[A-Za-z][A-Za-z0-9_.-]{0,95}$/.test(tool.name) || isAyasRevenueSensitiveText(tool.name) || names.has(tool.name)
      || !isAyasRevenueOperation(tool.operation) || !(AYAS_UPWORK_KINDS as readonly unknown[]).includes(tool.kind)
      || ![tool.inputSchemaDigest, tool.outputSchemaDigest, tool.annotationsDigest].every(isAyasRevenueDigest)
      || !isAyasRevenueDataArray(tool.scopes, 16) || tool.scopes.length === 0 || !tool.scopes.every(s => typeof s === "string" && /^[A-Za-z][A-Za-z0-9_.:/-]{0,127}$/.test(s) && !isAyasRevenueSensitiveText(s))
      || new Set(tool.scopes).size !== tool.scopes.length || typeof tool.zeroCostVerified !== "boolean") return null;
    const effect = ayasRevenueEffect(tool.operation);
    if (effect === "LOCAL_DRAFT" || (effect === "READ_ONLY" && reads.has(tool.operation))) return null;
    names.add(tool.name); if (effect === "READ_ONLY") reads.add(tool.operation);
  }
  return list as unknown as readonly AyasUpworkReviewedTool[];
}
export type AyasUpworkToolDecision = "READ_PIN_MATCH" | "OWNER_REQUIRED" | "FINANCIAL_NOT_AUTONOMOUS" | "UNSUPPORTED";
/** Digests include every schema field. Neither a name nor readOnlyHint alone grants a read. No calls are made here. */
export function inspectAyasUpworkTool(raw: unknown, reviewed: readonly AyasUpworkReviewedTool[] = AYAS_UPWORK_REVIEWED_TOOLS): AyasUpworkToolDecision {
  const pins = snapshotAyasUpworkReviewedTools(reviewed), tool = snapshotAyasUpworkData(raw);
  if (pins === null || !isAyasRevenuePlainRecord(tool) || !hasExactAyasRevenueKeys(tool, ["name", "inputSchema", "outputSchema", "annotations"], ["description", "title"])) return "UNSUPPORTED";
  const pin = pins.find(p => p.name === tool.name);
  if (!pin || !isAyasRevenuePlainRecord(tool.inputSchema) || !isAyasRevenuePlainRecord(tool.outputSchema) || !isAyasRevenuePlainRecord(tool.annotations)
    || digestAyasRevenueData(tool.inputSchema) !== pin.inputSchemaDigest || digestAyasRevenueData(tool.outputSchema) !== pin.outputSchemaDigest
    || digestAyasRevenueData(tool.annotations) !== pin.annotationsDigest) return "UNSUPPORTED";
  const effect = ayasRevenueEffect(pin.operation);
  if (effect === "EXTERNAL_WRITE") return "OWNER_REQUIRED";
  if (effect === "FINANCIAL_COMMITMENT") return "FINANCIAL_NOT_AUTONOMOUS";
  return effect === "READ_ONLY" && tool.annotations.readOnlyHint === true && tool.annotations.destructiveHint === false
    && tool.annotations.openWorldHint === false && pin.zeroCostVerified === true ? "READ_PIN_MATCH" : "UNSUPPORTED";
}
