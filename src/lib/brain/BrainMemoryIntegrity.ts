/** Stage 15C — pure, bounded integrity policy. Digests detect drift; they are
 * not signatures and never establish owner authority or execution permission. */
import { createHash } from "node:crypto";
import { containsBrainSecret } from "./BrainRedaction";
import {
  brainMemoryIntegrityVersion,
  type BrainMemoryIntegrity,
  type BrainMemoryRecord,
  type BrainMemorySource,
  type BrainMemoryTrustClass,
} from "@/types/brainMemory";

const SOURCES: Readonly<Record<BrainMemorySource, BrainMemoryTrustClass>> = Object.freeze({
  "direct-user-statement": "owner-direct", "explicit-correction": "owner-direct",
  "system-observation": "system-observed", "conversation-derived": "ayas-derived",
  "imported-history": "imported", "external-web": "external-data",
  "external-platform": "external-data", "repository-text": "external-data", "tool-output": "external-data",
});
const PRODUCERS: Readonly<Record<string, readonly BrainMemorySource[]>> = Object.freeze({
  "chat-user": ["direct-user-statement", "explicit-correction"],
  "chat-derived": ["conversation-derived"], "system-observer": ["system-observation"],
  "history-import": ["imported-history"],
  "external-ingest": ["external-web", "external-platform", "repository-text", "tool-output"],
  "legacy-adapter": ["direct-user-statement", "explicit-correction", "conversation-derived", "system-observation", "imported-history"],
});
const KEYS = new Set(["version", "source", "trust", "producer", "evidenceRef", "contentDigest", "writeDecision", "writeReasons", "screenVersion", "screenVerdict", "screenFindings", "admittedAt", "fingerprint"]);
const SCREEN_CODES = new Set(["INSTRUCTION_OVERRIDE", "AUTHORITY_CLAIM", "ROLE_DELIMITER", "CONTROL_CHARACTER"]);
const WRITE_CODES = new Set(["SUSPICIOUS_CONTENT", "PROTECTED_KEY", "UNTRUSTED_EXCLUSIVE_FACT", "RAPID_CHANGE"]);
const SHA256 = /^[a-f0-9]{64}$/;
const EVIDENCE_REF = /^(?:turn|source|event):[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/;
const LEGACY_USER_TITLES = new Set(["Kullanıcı kimliği / hitap tercihi", "Kullanıcı tercihi", "Alınan karar", "Çalışma ortamı bilgisi", "Bilinen sorun"]);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export function brainMemoryIntegrityDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
export function brainMemoryContentDigest(record: BrainMemoryRecord): string {
  const { integrity: _integrity, ...content } = record;
  void _integrity;
  return brainMemoryIntegrityDigest(content);
}
function fold(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase("tr").replace(/ı/g, "i").normalize("NFD").replace(/\p{M}/gu, "");
}
/** Screen every text surface, not just the body. Conservative defence in depth. */
export function screenBrainMemory(record: BrainMemoryRecord): string[] {
  const raw = [record.title, record.body, ...record.tags, ...record.links, record.temporal?.factKey ?? "", record.temporal?.factValue ?? ""].join("\n");
  const value = fold(raw);
  const findings: string[] = [];
  if (/\b(?:ignore|disregard|override|forget)\s+(?:(?:all|the|any|previous|prior|system|developer|safety)\s+){0,4}(?:instructions?|rules?|prompts?|messages?)\b/.test(value) || /\b(?:onceki|tum|sistem|gelistirici|developer)\s+(?:talimatlari|kurallari|mesaji|promptu)\s+(?:yok say|unut|gormezden gel|ez)\b/.test(value)) findings.push("INSTRUCTION_OVERRIDE");
  if (/\b(?:owner approved|owner approval|approval granted|root authority|financial autonomy|sahip onayi|onay gerekmiyor|butceyi artir|guvenlik kapisini kapat)\b/.test(value) || /\b(?:system prompt|developer message)\b/.test(value)) findings.push("AUTHORITY_CLAIM");
  if (/<\/?(?:system|developer|assistant|tool)\b|\[\/?(?:system|developer|inst)\]|<\|(?:im_start|im_end|system|endoftext)\|>/i.test(raw)) findings.push("ROLE_DELIMITER");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(raw)) findings.push("CONTROL_CHARACTER");
  return findings.sort();
}
function protectedRecord(record: BrainMemoryRecord): boolean {
  return record.kind === "security-policy" || [record.temporal?.factKey ?? "", ...record.tags, ...record.links].some((key) => /^(?:owner\.(?:constitution|authority)|root[.-]of[.-]trust|(?:security|capability|approval|budget|financial)[.:/-])/i.test(key));
}
function baseReasons(record: BrainMemoryRecord, trust: BrainMemoryTrustClass): string[] {
  const reasons: string[] = [];
  if (screenBrainMemory(record).length) reasons.push("SUSPICIOUS_CONTENT");
  if (protectedRecord(record)) reasons.push("PROTECTED_KEY");
  if ((record.temporal?.factKey !== undefined || record.tags.includes("kimlik")) && trust !== "owner-direct" && trust !== "system-observed") reasons.push("UNTRUSTED_EXCLUSIVE_FACT");
  return reasons.sort();
}
function iso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function closedCodes(value: unknown, allowed: ReadonlySet<string>): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string" && allowed.has(v)) && JSON.stringify(value) === JSON.stringify([...new Set(value)].sort());
}
export interface BrainMemoryIntegrityWriter {
  readonly source: BrainMemorySource;
  readonly producer: string;
  readonly evidenceRef?: string;
}
export function legacyBrainMemoryWriter(record: BrainMemoryRecord): BrainMemoryIntegrityWriter {
  return { source: record.temporal?.provenance ?? (record.confidence === "reported" ? LEGACY_USER_TITLES.has(record.title) ? "direct-user-statement" : "imported-history" : record.confidence === "observed" ? "system-observation" : "conversation-derived"), producer: "legacy-adapter" };
}
/** Called again under the store lock: caller-provided decisions are never trusted. */
export function sealBrainMemoryIntegrity(record: BrainMemoryRecord, writer: BrainMemoryIntegrityWriter, nowIso: string, history: readonly BrainMemoryRecord[] = []): BrainMemoryRecord {
  if (!iso(nowIso) || !Object.hasOwn(SOURCES, writer.source) || !Object.hasOwn(PRODUCERS, writer.producer) || !PRODUCERS[writer.producer].includes(writer.source) || (writer.evidenceRef !== undefined && (!EVIDENCE_REF.test(writer.evidenceRef) || containsBrainSecret(writer.evidenceRef)))) throw new Error("BRAIN_MEMORY_WRITER_INVALID");
  if (!sourceAgrees(record, writer.source)) throw new Error("BRAIN_MEMORY_SOURCE_CONFLICT");
  const trust = SOURCES[writer.source];
  const screenFindings = screenBrainMemory(record);
  const writeReasons = baseReasons(record, trust);
  // Preserve a prior quarantine; append cannot silently release it.
  if (record.integrity?.writeReasons.includes("RAPID_CHANGE")) writeReasons.push("RAPID_CHANGE");
  const key = record.temporal?.factKey;
  if (key && !writeReasons.includes("RAPID_CHANGE")) {
    const recent = history.filter((r) => r.integrity?.writeDecision === "admitted" && r.temporal?.factKey === key && Date.parse(r.integrity.admittedAt) <= Date.parse(nowIso) && Date.parse(r.integrity.admittedAt) >= Date.parse(nowIso) - 300_000);
    const values = new Set(recent.map((r) => r.temporal!.factValue));
    if (values.size >= 4 && !values.has(record.temporal?.factValue)) writeReasons.push("RAPID_CHANGE");
  }
  writeReasons.sort();
  const block: Omit<BrainMemoryIntegrity, "fingerprint"> = {
    version: brainMemoryIntegrityVersion, source: writer.source, producer: writer.producer,
    ...(writer.evidenceRef !== undefined ? { evidenceRef: writer.evidenceRef } : {}), trust,
    contentDigest: brainMemoryContentDigest(record), writeDecision: writeReasons.length ? "quarantined" : "admitted",
    writeReasons, screenVersion: 1, screenVerdict: screenFindings.length ? "suspicious" : "clean", screenFindings, admittedAt: nowIso,
  };
  return { ...record, integrity: { ...block, fingerprint: brainMemoryIntegrityDigest(block) } };
}
/** Strict optional-block validation. Legacy records remain valid, but are screened at read time. */
export function isValidBrainMemoryIntegrity(record: BrainMemoryRecord): boolean {
  if (record.integrity === undefined) return true;
  try {
    const b = record.integrity;
    if (!b || typeof b !== "object" || Array.isArray(b) || !Object.keys(b).every((key) => KEYS.has(key))) return false;
    if (b.version !== 1 || b.screenVersion !== 1 || !iso(b.admittedAt)) return false;
    if (!Object.hasOwn(SOURCES, b.source) || b.trust !== SOURCES[b.source] || !Object.hasOwn(PRODUCERS, b.producer) || !PRODUCERS[b.producer].includes(b.source)) return false;
    if (!sourceAgrees(record, b.source)) return false;
    if (b.evidenceRef !== undefined && (typeof b.evidenceRef !== "string" || !EVIDENCE_REF.test(b.evidenceRef) || containsBrainSecret(b.evidenceRef))) return false;
    if (!closedCodes(b.screenFindings, SCREEN_CODES) || !closedCodes(b.writeReasons, WRITE_CODES)) return false;
    if (JSON.stringify(b.screenFindings) !== JSON.stringify(screenBrainMemory(record))) return false;
    const expected = baseReasons(record, b.trust);
    if (b.writeReasons.includes("RAPID_CHANGE")) expected.push("RAPID_CHANGE");
    if (JSON.stringify([...expected].sort()) !== JSON.stringify(b.writeReasons)) return false;
    if (b.screenVerdict !== (b.screenFindings.length ? "suspicious" : "clean") || b.writeDecision !== (b.writeReasons.length ? "quarantined" : "admitted")) return false;
    if (!SHA256.test(b.contentDigest) || b.contentDigest !== brainMemoryContentDigest(record)) return false;
    const { fingerprint, ...payload } = b;
    return typeof fingerprint === "string" && SHA256.test(fingerprint) && fingerprint === brainMemoryIntegrityDigest(payload);
  } catch { return false; }
}
/** No record, including owner-direct text, can supply privileged instructions. */
export function brainMemoryReadAllowed(record: BrainMemoryRecord): boolean {
  if (!isValidBrainMemoryIntegrity(record) || record.integrity?.writeDecision === "quarantined") return false;
  // Legacy epistemics stay with the temporal resolver. Retroactively assigning
  // writer identity would erase its existing conflict/dispute evidence.
  return baseReasons(record, record.integrity?.trust ?? "owner-direct").length === 0;
}

function sourceAgrees(record: BrainMemoryRecord, source: BrainMemorySource): boolean {
  if (!record.temporal) return true;
  return SOURCES[source] === "external-data" ? record.temporal.provenance === "imported-history" : record.temporal.provenance === source;
}

export interface BrainMemoryIntegritySnapshot {
  readonly version: 1;
  readonly revision: number;
  readonly records: readonly BrainMemoryRecord[];
  /** Sorted manifest binds every record, including legacy and quarantine metadata. */
  readonly manifest: readonly { readonly recordId: string; readonly digest: string }[];
  readonly digest: string;
}
export function buildBrainMemoryIntegritySnapshot(revision: number, records: readonly BrainMemoryRecord[]): BrainMemoryIntegritySnapshot {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("BRAIN_MEMORY_SNAPSHOT_INVALID");
  const copy = structuredClone(records);
  const payload = { version: 1 as const, revision, records: copy, manifest: copy.map((r) => ({ recordId: r.recordId, digest: brainMemoryIntegrityDigest(r) })).sort((a, b) => a.recordId.localeCompare(b.recordId)) };
  return { ...payload, digest: brainMemoryIntegrityDigest(payload) };
}
/** expectedDigest must come from the caller's independently held known-good
 * evidence. The snapshot itself cannot supply its own trust anchor. */
export function isValidBrainMemoryIntegritySnapshot(value: unknown, expectedDigest: string): value is BrainMemoryIntegritySnapshot {
  try {
    if (!SHA256.test(expectedDigest) || !value || typeof value !== "object" || Array.isArray(value)) return false;
    const s = value as BrainMemoryIntegritySnapshot;
    if (Object.keys(s).sort().join(",") !== "digest,manifest,records,revision,version" || s.version !== 1 || !Array.isArray(s.records) || s.records.length > 500 || !Array.isArray(s.manifest)) return false;
    if (new Set(s.records.map((r) => r.recordId)).size !== s.records.length || new Set(s.records.map((r) => r.contentFingerprint)).size !== s.records.length) return false;
    const rebuilt = buildBrainMemoryIntegritySnapshot(s.revision, s.records);
    return s.digest === expectedDigest && s.digest === rebuilt.digest && JSON.stringify(s.manifest) === JSON.stringify(rebuilt.manifest);
  } catch { return false; }
}
