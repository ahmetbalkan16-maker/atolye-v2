import { createHash } from "node:crypto";
import { canonicalAyasJson } from "../provenance/AyasReleaseProvenance";

export const AYAS_CONSTITUTION_PROTECTED_PATHS = Object.freeze([".git", ".env", ".agents", ".codex", ".aws", "data/brain/owner-constitution", "src/lib/ayas/governance", "app/brain/constitution"]);
export interface AyasOwnerConstitution {
  readonly schemaVersion: "1"; readonly version: number; readonly previousDigest: string | null;
  readonly rules: {
    readonly approval: "EXACT_OWNER_SCOPE"; readonly autonomousSpendUsd: 0;
    readonly publishing: "OWNER_ONLY"; readonly production: "OWNER_ONLY";
    readonly protectedPaths: readonly string[]; readonly privacy: "NO_SECRETS_IN_MEMORY_LEDGER_LOG";
    readonly zeroCostDefault: true; readonly graphifyFirst: true; readonly silentCloudFallback: false;
    readonly selfApproval: false; readonly selfPromotion: false;
    readonly localRuntime: "ON_DEMAND"; readonly maxRamAdmissionPercent: number;
  };
}
export const constitutionDigest = (value: unknown) => createHash("sha256").update(canonicalAyasJson(value)).digest("hex");
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const constitutionExactKeys = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).sort().join("|") === [...keys].sort().join("|");
export function isAyasOwnerConstitution(value: unknown): value is AyasOwnerConstitution {
  if (!plain(value) || !constitutionExactKeys(value, ["schemaVersion", "version", "previousDigest", "rules"]) || value.schemaVersion !== "1"
    || !Number.isSafeInteger(value.version) || (value.version as number) < 1 || (value.version as number) > 1000
    || ((value.version === 1) ? value.previousDigest !== null : typeof value.previousDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.previousDigest))) return false;
  const r = value.rules;
  if (!plain(r) || !constitutionExactKeys(r, ["approval", "autonomousSpendUsd", "publishing", "production", "protectedPaths", "privacy", "zeroCostDefault", "graphifyFirst", "silentCloudFallback", "selfApproval", "selfPromotion", "localRuntime", "maxRamAdmissionPercent"])) return false;
  const paths = r.protectedPaths;
  return r.approval === "EXACT_OWNER_SCOPE" && r.autonomousSpendUsd === 0 && r.publishing === "OWNER_ONLY" && r.production === "OWNER_ONLY"
    && r.privacy === "NO_SECRETS_IN_MEMORY_LEDGER_LOG" && r.zeroCostDefault === true && r.graphifyFirst === true
    && r.silentCloudFallback === false && r.selfApproval === false && r.selfPromotion === false && r.localRuntime === "ON_DEMAND"
    && Number.isSafeInteger(r.maxRamAdmissionPercent) && (r.maxRamAdmissionPercent as number) >= 1 && (r.maxRamAdmissionPercent as number) <= 99
    && Array.isArray(paths) && paths.length >= AYAS_CONSTITUTION_PROTECTED_PATHS.length && paths.length <= 64 && new Set(paths).size === paths.length
    && paths.every((p) => typeof p === "string" && p.length <= 200 && /^[A-Za-z0-9._/-]+$/.test(p) && !p.startsWith("/") && !p.endsWith("/") && p.split("/").every((s) => s !== ".." && s !== "." && s !== ""))
    && AYAS_CONSTITUTION_PROTECTED_PATHS.every((p) => paths.includes(p));
}
/** A proposal only. Its digest or presence in the repository activates nothing. */
export function proposeAyasOwnerConstitution(version = 1, previousDigest: string | null = null): AyasOwnerConstitution {
  const proposal: AyasOwnerConstitution = { schemaVersion: "1", version, previousDigest, rules: {
    approval: "EXACT_OWNER_SCOPE", autonomousSpendUsd: 0, publishing: "OWNER_ONLY", production: "OWNER_ONLY",
    protectedPaths: [...AYAS_CONSTITUTION_PROTECTED_PATHS], privacy: "NO_SECRETS_IN_MEMORY_LEDGER_LOG", zeroCostDefault: true,
    graphifyFirst: true, silentCloudFallback: false, selfApproval: false, selfPromotion: false, localRuntime: "ON_DEMAND", maxRamAdmissionPercent: 90,
  } };
  if (!isAyasOwnerConstitution(proposal)) throw new Error("AYAS_CONSTITUTION_PROPOSAL_INVALID");
  return freezeConstitution(proposal);
}
export function freezeConstitution<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freezeConstitution); Object.freeze(value); }
  return value;
}
