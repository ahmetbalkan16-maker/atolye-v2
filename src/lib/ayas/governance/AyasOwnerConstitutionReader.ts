import fs from "node:fs";
import path from "node:path";
import { createPublicKey, verify } from "node:crypto";
import { requireContainedRealDirectory, assertPathContained } from "../../runtime/RuntimeStoragePaths";
import { canonicalAyasJson } from "../provenance/AyasReleaseProvenance";
import { constitutionDigest, constitutionExactKeys, freezeConstitution, isAyasOwnerConstitution, type AyasOwnerConstitution } from "./AyasOwnerConstitution";

export interface AyasConstitutionTrustRoot {
  readonly schemaVersion: "1"; readonly repositoryRootDigest: string; readonly publicKeyDer: string; readonly initialPolicyDigest: string;
}
export interface AyasSignedConstitution {
  readonly schemaVersion: "1"; readonly repositoryRootDigest: string; readonly policy: AyasOwnerConstitution;
  readonly policyDigest: string; readonly approvedAt: string; readonly signature: string;
}
export type AyasConstitutionState = { readonly state: "MISSING" | "UNAVAILABLE"; readonly reason: string }
  | { readonly state: "ACTIVE"; readonly policy: AyasOwnerConstitution; readonly digest: string; readonly approvedAt: string; readonly publicKeyFingerprint: string };
export const constitutionRootPath = (repoRoot: string) => path.join(repoRoot, "data", "brain", "owner-constitution");
/** One identity per directory. Windows hands a process its caller's spelling (drive letter, casing); the bound root must not depend on it. */
export const constitutionPhysicalRoot = (repoRoot: string) => fs.realpathSync.native(repoRoot);
export const constitutionSignatureBytes = (body: unknown) => Buffer.from("AYAS_OWNER_CONSTITUTION_V1\n" + canonicalAyasJson(body));
function containedJSON(root: string, name: string): unknown {
  const file = path.join(root, name); const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 32 * 1024) throw new Error("Invalid constitution file.");
  assertPathContained(root, fs.realpathSync(file));
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
/** Public verification only. No session, signer, write, network or approval authority import. */
export function readAyasOwnerConstitution(repoRoot: string): AyasConstitutionState {
  try {
    const physicalRepo = constitutionPhysicalRoot(repoRoot); const repositoryRootDigest = constitutionDigest(physicalRepo);
    const folder = constitutionRootPath(physicalRepo);
    // Missing is distinct from an unreadable/unsafe ancestor; never turn IO failure into bootstrap.
    for (const relative of ["data", "data/brain", "data/brain/owner-constitution"]) {
      const candidate = path.join(physicalRepo, relative);
      try { fs.lstatSync(candidate); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: "MISSING", reason: "OWNER_CONSTITUTION_NOT_ADOPTED" }; throw error; }
      requireContainedRealDirectory(physicalRepo, candidate);
    }
    const trust = containedJSON(folder, "root.json") as AyasConstitutionTrustRoot;
    if (!trust || !constitutionExactKeys(trust as unknown as Record<string, unknown>, ["schemaVersion", "repositoryRootDigest", "publicKeyDer", "initialPolicyDigest"])
      || trust.schemaVersion !== "1" || trust.repositoryRootDigest !== repositoryRootDigest || !/^[a-f0-9]{88}$/.test(trust.publicKeyDer) || !/^[a-f0-9]{64}$/.test(trust.initialPolicyDigest)) throw new Error("Invalid constitution trust root.");
    const key = createPublicKey({ key: Buffer.from(trust.publicKeyDer, "hex"), format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ed25519") throw new Error("Invalid constitution verifier.");
    const files = fs.readdirSync(folder).filter((name) => name !== "root.json" && !/^\.pending-[a-f0-9-]+$/.test(name));
    if (!files.length || files.length > 1000 || files.some((name) => !/^[1-9][0-9]{0,3}\.json$/.test(name))) throw new Error("Invalid constitution version inventory.");
    files.sort((a, b) => Number.parseInt(a) - Number.parseInt(b));
    let prior: string | null = null; let final: AyasSignedConstitution | undefined;
    for (let index = 0; index < files.length; index++) {
      const record = containedJSON(folder, files[index]) as AyasSignedConstitution;
      if (!record || !constitutionExactKeys(record as unknown as Record<string, unknown>, ["schemaVersion", "repositoryRootDigest", "policy", "policyDigest", "approvedAt", "signature"])
        || record.schemaVersion !== "1" || record.repositoryRootDigest !== repositoryRootDigest || !isAyasOwnerConstitution(record.policy)
        || record.policy.version !== index + 1 || files[index] !== `${index + 1}.json` || record.policy.previousDigest !== prior
        || record.policyDigest !== constitutionDigest(record.policy) || (index === 0 && record.policyDigest !== trust.initialPolicyDigest)
        || typeof record.approvedAt !== "string" || !Number.isFinite(Date.parse(record.approvedAt)) || !/^[a-f0-9]{128}$/.test(record.signature)) throw new Error("Invalid constitution version.");
      const { signature, ...body } = record;
      if (!verify(null, constitutionSignatureBytes(body), key, Buffer.from(signature, "hex"))) throw new Error("Constitution signature refused.");
      prior = record.policyDigest; final = record;
    }
    return freezeConstitution({ state: "ACTIVE", policy: final!.policy, digest: final!.policyDigest, approvedAt: final!.approvedAt, publicKeyFingerprint: constitutionDigest(trust.publicKeyDer) });
  } catch { return { state: "UNAVAILABLE", reason: "OWNER_CONSTITUTION_UNVERIFIABLE" }; }
}

/** Digest binding is a revocation check, never an execution/approval capability. */
export function bindAyasConstitutionRun(repoRoot: string, domain: "AGENT" | "TOOL" | "REVENUE" | "SELF_EVOLUTION", runId: string) {
  if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(runId)) throw new Error("AYAS_CONSTITUTION_RUN_ID_INVALID");
  const root = constitutionPhysicalRoot(repoRoot); const state = readAyasOwnerConstitution(root);
  const evidence = Object.freeze({ domain, runId, constitutionDigest: state.state === "ACTIVE" ? state.digest : null, state: state.state, authority: "NONE" as const });
  return Object.freeze({ evidence, protectsPath(relativePath: string): boolean {
    if (typeof relativePath !== "string" || relativePath.includes("\\") || relativePath.startsWith("/") || relativePath.split("/").some((part) => !part || part === "." || part === "..")) return true;
    const normalized = process.platform === "win32" ? relativePath.toLowerCase() : relativePath;
    return state.state === "ACTIVE" && state.policy.rules.protectedPaths.some((protectedPath) => {
      const target = process.platform === "win32" ? protectedPath.toLowerCase() : protectedPath;
      return normalized === target || normalized.startsWith(target + "/") || (target === ".env" && normalized.startsWith(".env."));
    });
  }, refusal(): string | undefined {
    const current = readAyasOwnerConstitution(root);
    if (state.state === "MISSING" && current.state === "MISSING") return undefined; // existing behavior before the owner's first adoption, explicitly unbound
    if (state.state !== "ACTIVE" || current.state !== "ACTIVE") return "AYAS_CONSTITUTION_UNAVAILABLE";
    return state.digest === current.digest ? undefined : "AYAS_CONSTITUTION_CHANGED";
  } });
}
