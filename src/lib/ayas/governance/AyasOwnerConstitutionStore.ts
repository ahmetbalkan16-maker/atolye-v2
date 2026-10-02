import fs from "node:fs";
import path from "node:path";
import { createHash, createPrivateKey, createPublicKey, randomUUID, sign } from "node:crypto";
import { resolveAccessGate, verifySession } from "../../auth/accessGate";
import { ensureSafeContainedDirectory, requireContainedRealDirectory } from "../../runtime/RuntimeStoragePaths";
import { withAyasExecutionAuthorityLock } from "../../brain/autonomy/AyasExecutionAuthorityLock";
import { constitutionDigest, isAyasOwnerConstitution } from "./AyasOwnerConstitution";
import { constitutionPhysicalRoot, constitutionRootPath, constitutionSignatureBytes, readAyasOwnerConstitution, type AyasConstitutionTrustRoot } from "./AyasOwnerConstitutionReader";

function durableFile(file: string, value: unknown): void {
  const fd = fs.openSync(file, "wx", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
/** Owner server action only. Session comes from trusted cookies, never a model/tool payload. */
export async function activateAyasOwnerConstitution(input: {
  readonly repoRoot: string; readonly policy: unknown; readonly expectedPreviousDigest: string | null;
  readonly ownerSession: string | undefined; readonly env?: Readonly<Record<string, string | undefined>>; readonly nowMs?: () => number;
}): Promise<{ readonly digest: string; readonly version: number }> {
  const env = input.env ?? process.env; const now = input.nowMs ?? Date.now;
  const requireOwner = async () => {
    const gate = resolveAccessGate(env);
    if (gate.mode !== "enforced" || !gate.key || !await verifySession(input.ownerSession, gate.key, now())) throw new Error("AYAS_CONSTITUTION_OWNER_SESSION_REQUIRED");
    return gate.key;
  };
  await requireOwner(); // before input interpretation or any filesystem effect; disabled-dev is not owner authority
  if (!isAyasOwnerConstitution(input.policy) || (input.expectedPreviousDigest !== null && !/^[a-f0-9]{64}$/.test(input.expectedPreviousDigest))) throw new Error("AYAS_CONSTITUTION_PROPOSAL_INVALID");
  const policy = JSON.parse(JSON.stringify(input.policy)) as typeof input.policy;
  const root = constitutionPhysicalRoot(input.repoRoot); const parent = ensureSafeContainedDirectory(root, path.join(root, "data", "brain"));
  const lockRoot = ensureSafeContainedDirectory(root, path.join(parent, ".owner-constitution-authority"));
  return withAyasExecutionAuthorityLock(lockRoot, async () => {
    const keyText = await requireOwner();
    const current = readAyasOwnerConstitution(root);
    if (current.state === "UNAVAILABLE" || (current.state === "ACTIVE" ? current.digest : null) !== input.expectedPreviousDigest
      || policy.previousDigest !== input.expectedPreviousDigest || policy.version !== (current.state === "ACTIVE" ? current.policy.version + 1 : 1)) throw new Error("AYAS_CONSTITUTION_CURRENT_BINDING_REFUSED");
    const seed = createHash("sha256").update("AYAS_OWNER_CONSTITUTION_SIGNER_V1\n").update(keyText).digest();
    const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" }); seed.fill(0);
    const publicKeyDer = createPublicKey(privateKey).export({ format: "der", type: "spki" }).toString("hex");
    if (current.state === "ACTIVE" && current.publicKeyFingerprint !== constitutionDigest(publicKeyDer)) throw new Error("AYAS_CONSTITUTION_OWNER_REBIND_REQUIRED");
    const digest = constitutionDigest(policy); const repositoryRootDigest = constitutionDigest(root);
    const body = { schemaVersion: "1", repositoryRootDigest, policy, policyDigest: digest, approvedAt: new Date(now()).toISOString() };
    const record = { ...body, signature: sign(null, constitutionSignatureBytes(body), privateKey).toString("hex") };
    const canonical = constitutionRootPath(root);
    if (current.state === "MISSING") {
      const staging = path.join(parent, `.owner-constitution-staging-${randomUUID()}`); fs.mkdirSync(staging, { mode: 0o700 });
      try {
        const trust: AyasConstitutionTrustRoot = { schemaVersion: "1", repositoryRootDigest, publicKeyDer, initialPolicyDigest: digest };
        durableFile(path.join(staging, "root.json"), trust); durableFile(path.join(staging, "1.json"), record);
        if (fs.existsSync(canonical)) throw new Error("AYAS_CONSTITUTION_BOOTSTRAP_COLLISION");
        fs.renameSync(staging, canonical); // anchor and initial signed version become visible together
      } finally { if (fs.existsSync(staging)) { requireContainedRealDirectory(parent, staging); fs.rmSync(staging, { recursive: true, force: true }); } }
    } else {
      requireContainedRealDirectory(root, canonical);
      const temp = path.join(canonical, `.pending-${randomUUID()}`);
      try { durableFile(temp, record); fs.linkSync(temp, path.join(canonical, `${policy.version}.json`)); }
      finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    }
    const verified = readAyasOwnerConstitution(root);
    if (verified.state !== "ACTIVE" || verified.digest !== digest) throw new Error("AYAS_CONSTITUTION_POST_WRITE_UNVERIFIED");
    return { digest, version: policy.version };
  });
}
