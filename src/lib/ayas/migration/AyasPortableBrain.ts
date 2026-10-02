/** Stage 15S. Portable DATA, never an approval, capability, signer or live restore. */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { containsBrainSecret } from "../../brain/BrainRedaction";
import { canonicalAyasJson } from "../provenance/AyasReleaseProvenance";

export const AYAS_PORTABLE_SECTIONS = Object.freeze([
  "CONSTITUTION", "CONFIG_METADATA", "MEMORY_RETRIEVAL", "RESEARCH_EVOLUTION", "MODEL_STRATEGY_REGISTRY",
  "PROPOSAL_HISTORY", "REVENUE_LEDGER_POLICY", "AUDIT_EVAL", "GRAPHIFY_REVALIDATION", "CHECKPOINT_ROADMAP",
] as const);
export type AyasPortableSection = typeof AYAS_PORTABLE_SECTIONS[number];
export type AyasPortableJson = null | boolean | number | string | readonly AyasPortableJson[] | { readonly [key: string]: AyasPortableJson };
export interface AyasPortableEntry {
  readonly id: string; readonly section: AyasPortableSection; readonly schemaVersion: "1";
  /** A domain-specific portable projection. No executable authorization or secret-bearing store dump. */
  readonly data: AyasPortableJson;
}
export interface AyasPortableArtifact {
  readonly id: string; readonly kind: "CODING_MODEL" | "RUNTIME" | "TOOL" | "VOICE_MODEL" | "PODMAN_IMAGE";
  readonly immutableIdentity: string; readonly sha256: string; readonly sizeBytes: number;
  readonly relativeLocator: string; readonly qualification: "QUALIFIED" | "DEGRADED" | "UNMEASURED";
  readonly transfer: "VERIFIED_LOCAL_FILE" | "EXPORT_EXACT_IMAGE" | "REBUILD_PINNED_IMAGE";
  readonly rebuildInputs: readonly string[];
}
export interface AyasPortableBrain {
  readonly schemaVersion: "1"; readonly sourceHead: string; readonly createdAt: string;
  readonly disposition: "INERT_OWNER_REVIEW_REQUIRED";
  readonly sections: readonly { readonly section: AyasPortableSection; readonly state: "PRESENT" | "NOT_CONFIGURED" | "NOT_IMPLEMENTED" }[];
  readonly entries: readonly AyasPortableEntry[];
  readonly runtime: {
    readonly artifacts: readonly AyasPortableArtifact[];
    readonly policy: { readonly mode: "ON_DEMAND"; readonly maxHeavyWorkloads: 1; readonly maxRamAdmissionPercent: number; readonly idleStopMs: number; readonly automaticWslShutdown: false };
    readonly graphifyRebuild: "graphify update --scope all --no-description --no-label .";
  };
}
export interface AyasPortableManifest {
  readonly schemaVersion: "1"; readonly compatibility: "AYAS_PORTABLE_BRAIN_V1";
  readonly sourceHead: string; readonly disposition: "INERT_OWNER_REVIEW_REQUIRED";
  readonly entries: readonly { readonly id: string; readonly section: AyasPortableSection; readonly schemaVersion: "1"; readonly bytes: number; readonly sha256: string }[];
  readonly payloadSha256: string;
}
export interface AyasPortableEnvelope {
  readonly schemaVersion: "1"; readonly cipher: "AES-256-GCM"; readonly kdf: "SCRYPT_N32768_R8_P1";
  readonly manifestDigest: string; readonly salt: string; readonly iv: string; readonly tag: string; readonly ciphertext: string;
}
export const AYAS_PORTABLE_MAX_BYTES = 16 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/, HEAD = /^[a-f0-9]{40}$/, ID = /^[a-z][a-z0-9-]{1,79}$/;
const RESERVED_ID = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const FORBIDDEN_KEY = /^(?:__proto__|constructor|prototype|.*(?:api.?key|secret|password|credential|private.?key|access.?token|refresh.?token)|token|ownerSession|authorizationId|reservationId|sessionId|signature|bankAccount|cardNumber|taxId)$/i;
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export const portableBrainDigest = (v: unknown) => createHash("sha256").update(canonicalAyasJson(v)).digest("hex");
const byteHash = (v: Uint8Array | string) => createHash("sha256").update(v).digest("hex");
function fail(code: string): never { throw new Error(`AYAS_PORTABLE_${code}`); }
const iso = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;

/** Closed, bounded JSON; reject unsafe content rather than silently modifying a hashed durable record. */
export function assertAyasPortableJson(value: unknown): asserts value is AyasPortableJson {
  let count = 0;
  const visit = (v: unknown, depth: number): void => {
    if (++count > 100_000 || depth > 24) fail("CONTENT_BOUND");
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "number") { if (!Number.isFinite(v) || Math.abs(v) > Number.MAX_SAFE_INTEGER) fail("NUMBER_INVALID"); return; }
    if (typeof v === "string") {
      if (v.length > 100_000 || containsBrainSecret(v) || /(?:^|[\s"'=(])[a-z]:[\\/]|\\\\[^\\\s]+\\|(?:^|[\s"'=(])\/(?!\/)[a-z0-9._-]+(?:\/|\b)/i.test(v)) fail("SECRET_OR_MACHINE_PATH");
      return;
    }
    if (Array.isArray(v)) { if (v.length > 10_000 || Object.keys(v).length !== v.length) fail("ARRAY_INVALID"); v.forEach(x => visit(x, depth + 1)); return; }
    if (!plain(v) || Object.keys(v).length > 1000) fail("OBJECT_INVALID");
    if (Reflect.ownKeys(v).length !== Object.keys(v).length || Object.values(Object.getOwnPropertyDescriptors(v)).some(d => !Object.hasOwn(d, "value"))) fail("OBJECT_INVALID");
    for (const [key, child] of Object.entries(v)) {
      if (!key || key.length > 100 || FORBIDDEN_KEY.test(key)) fail("SECRET_OR_AUTHORITY_FIELD");
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
  if (Buffer.byteLength(canonicalAyasJson(value)) > AYAS_PORTABLE_MAX_BYTES) fail("CONTENT_BOUND");
}
function locator(v: unknown): v is string {
  return typeof v === "string" && v.length <= 200 && /^[a-zA-Z0-9._/-]+$/.test(v) && !v.startsWith("/")
    && v.split("/").every(p => p !== "." && p !== ".." && p !== "") && !/(?:^|\/)(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|\/|$)/i.test(v);
}
export function assertAyasPortableBrain(raw: unknown): asserts raw is AyasPortableBrain {
  assertAyasPortableJson(raw);
  if (!plain(raw) || !exact(raw, ["schemaVersion", "sourceHead", "createdAt", "disposition", "sections", "entries", "runtime"])
    || raw.schemaVersion !== "1" || typeof raw.sourceHead !== "string" || !HEAD.test(raw.sourceHead) || !iso(raw.createdAt)
    || raw.disposition !== "INERT_OWNER_REVIEW_REQUIRED" || !Array.isArray(raw.sections) || raw.sections.length !== AYAS_PORTABLE_SECTIONS.length
    || !Array.isArray(raw.entries) || raw.entries.length > 1000 || !plain(raw.runtime)) fail("SCHEMA_INVALID");
  const sections = new Map<string, string>();
  for (const s of raw.sections) {
    if (!plain(s) || !exact(s, ["section", "state"]) || !AYAS_PORTABLE_SECTIONS.includes(s.section as AyasPortableSection)
      || !["PRESENT", "NOT_CONFIGURED", "NOT_IMPLEMENTED"].includes(String(s.state)) || sections.has(String(s.section))) fail("SECTION_INVALID");
    sections.set(String(s.section), String(s.state));
  }
  const ids = new Set<string>();
  for (const e of raw.entries) {
    if (!plain(e) || !exact(e, ["id", "section", "schemaVersion", "data"]) || typeof e.id !== "string" || !ID.test(e.id) || RESERVED_ID.test(e.id)
      || ids.has(e.id) || sections.get(String(e.section)) !== "PRESENT" || e.schemaVersion !== "1") fail("ENTRY_INVALID");
    ids.add(e.id);
  }
  for (const [s, state] of sections) if ((state === "PRESENT") !== raw.entries.some(e => e.section === s)) fail("SECTION_CONTENT_MISMATCH");
  const r = raw.runtime;
  if (!exact(r, ["artifacts", "policy", "graphifyRebuild"]) || !Array.isArray(r.artifacts) || r.artifacts.length > 200 || !plain(r.policy)
    || r.graphifyRebuild !== "graphify update --scope all --no-description --no-label .") fail("RUNTIME_INVALID");
  const p = r.policy;
  if (!exact(p, ["mode", "maxHeavyWorkloads", "maxRamAdmissionPercent", "idleStopMs", "automaticWslShutdown"]) || p.mode !== "ON_DEMAND" || p.maxHeavyWorkloads !== 1
    || !Number.isSafeInteger(p.maxRamAdmissionPercent) || Number(p.maxRamAdmissionPercent) < 1 || Number(p.maxRamAdmissionPercent) > 99
    || !Number.isSafeInteger(p.idleStopMs) || Number(p.idleStopMs) < 60_000 || Number(p.idleStopMs) > 3_600_000 || p.automaticWslShutdown !== false) fail("RUNTIME_POLICY_INVALID");
  const artifacts = new Set<string>(), locators = new Set<string>();
  for (const a of r.artifacts) {
    if (!plain(a) || !exact(a, ["id", "kind", "immutableIdentity", "sha256", "sizeBytes", "relativeLocator", "qualification", "transfer", "rebuildInputs"])
      || typeof a.id !== "string" || !ID.test(a.id) || RESERVED_ID.test(a.id) || artifacts.has(a.id) || !["CODING_MODEL", "RUNTIME", "TOOL", "VOICE_MODEL", "PODMAN_IMAGE"].includes(String(a.kind))
      || typeof a.sha256 !== "string" || !HASH.test(a.sha256) || typeof a.immutableIdentity !== "string" || a.immutableIdentity.length > 300 || !a.immutableIdentity.includes(a.sha256)
      || !Number.isSafeInteger(a.sizeBytes) || Number(a.sizeBytes) < 1 || !locator(a.relativeLocator) || locators.has(a.relativeLocator.toLowerCase())
      || !["QUALIFIED", "DEGRADED", "UNMEASURED"].includes(String(a.qualification)) || !Array.isArray(a.rebuildInputs) || a.rebuildInputs.length > 50
      || !a.rebuildInputs.every(x => typeof x === "string" && HASH.test(x))) fail("ARTIFACT_INVALID");
    if (a.kind === "PODMAN_IMAGE" ? !["EXPORT_EXACT_IMAGE", "REBUILD_PINNED_IMAGE"].includes(String(a.transfer)) || (a.transfer === "REBUILD_PINNED_IMAGE" && a.rebuildInputs.length === 0)
      : a.transfer !== "VERIFIED_LOCAL_FILE" || a.rebuildInputs.length !== 0) fail("ARTIFACT_TRANSFER_INVALID");
    artifacts.add(a.id); locators.add(a.relativeLocator.toLowerCase());
  }
}
export function manifestAyasPortableBrain(raw: unknown): AyasPortableManifest {
  assertAyasPortableBrain(raw);
  return {
    schemaVersion: "1", compatibility: "AYAS_PORTABLE_BRAIN_V1", sourceHead: raw.sourceHead, disposition: "INERT_OWNER_REVIEW_REQUIRED",
    entries: [...raw.entries].sort((a, b) => a.id.localeCompare(b.id, "en")).map(e => ({ id: e.id, section: e.section, schemaVersion: e.schemaVersion,
      bytes: Buffer.byteLength(canonicalAyasJson(e.data)), sha256: byteHash(canonicalAyasJson(e.data)) })),
    payloadSha256: byteHash(canonicalAyasJson(raw)),
  };
}
function keyFor(passphrase: string, salt: Uint8Array): Buffer {
  if (typeof passphrase !== "string" || Buffer.byteLength(passphrase) < 24 || Buffer.byteLength(passphrase) > 256) fail("PASSPHRASE_REQUIRED");
  return scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}
/** All archives are encrypted, so a caller cannot misclassify private state as public. */
export function encryptAyasPortableBrain(raw: unknown, passphrase: string): AyasPortableEnvelope {
  const manifest = manifestAyasPortableBrain(raw), manifestDigest = portableBrainDigest(manifest);
  const salt = randomBytes(32), iv = randomBytes(12), key = keyFor(passphrase, salt);
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(`AYAS_PORTABLE_BRAIN_V1\n${manifestDigest}`));
    const ciphertext = Buffer.concat([cipher.update(canonicalAyasJson(raw), "utf8"), cipher.final()]);
    return { schemaVersion: "1", cipher: "AES-256-GCM", kdf: "SCRYPT_N32768_R8_P1", manifestDigest,
      salt: salt.toString("hex"), iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), ciphertext: ciphertext.toString("base64") };
  } finally { key.fill(0); }
}
/** The expected digest comes from the owner's separately reviewed manifest, never the archive itself. */
export function decryptAyasPortableBrain(raw: unknown, passphrase: string, expectedManifestDigest: string): AyasPortableBrain {
  if (!HASH.test(expectedManifestDigest) || !plain(raw) || !exact(raw, ["schemaVersion", "cipher", "kdf", "manifestDigest", "salt", "iv", "tag", "ciphertext"])
    || raw.schemaVersion !== "1" || raw.cipher !== "AES-256-GCM" || raw.kdf !== "SCRYPT_N32768_R8_P1" || raw.manifestDigest !== expectedManifestDigest
    || typeof raw.salt !== "string" || !HASH.test(raw.salt) || typeof raw.iv !== "string" || !/^[a-f0-9]{24}$/.test(raw.iv)
    || typeof raw.tag !== "string" || !/^[a-f0-9]{32}$/.test(raw.tag) || typeof raw.ciphertext !== "string"
    || raw.ciphertext.length === 0 || raw.ciphertext.length > Math.ceil(AYAS_PORTABLE_MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw.ciphertext)) fail("ENVELOPE_INVALID");
  const ciphertext = Buffer.from(raw.ciphertext, "base64");
  if (ciphertext.toString("base64") !== raw.ciphertext || ciphertext.length > AYAS_PORTABLE_MAX_BYTES) fail("ENVELOPE_INVALID");
  const key = keyFor(passphrase, Buffer.from(raw.salt, "hex"));
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(raw.iv, "hex"));
    decipher.setAAD(Buffer.from(`AYAS_PORTABLE_BRAIN_V1\n${expectedManifestDigest}`)); decipher.setAuthTag(Buffer.from(raw.tag, "hex"));
    const text = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"), value: unknown = JSON.parse(text);
    assertAyasPortableBrain(value);
    if (canonicalAyasJson(value) !== text || portableBrainDigest(manifestAyasPortableBrain(value)) !== expectedManifestDigest) fail("MANIFEST_MISMATCH");
    return value;
  } catch { return fail("ARCHIVE_UNVERIFIED"); } finally { key.fill(0); }
}
