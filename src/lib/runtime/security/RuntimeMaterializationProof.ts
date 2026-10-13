import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { assertPathContained, assertTrustedRuntimeStorageContext, validateSafeAncestorChain, type RuntimeStorageContext } from "../RuntimeStoragePaths";
import { describeRuntimeAuthorityIdentity } from "./RuntimeAuthorityGenerationMarker";
import { RuntimeAuthorityTransitionStore, runtimeAuthorityProjectsContentDigest } from "./RuntimeAuthorityTransition";
import { verifyMigrationCandidate, verifyMigrationCandidateBinding } from "../migration/RuntimeMigrationCandidateVerifier";
import { assertProductionRuntimeAuthorityGenerationCompatible } from "./ProductionRuntimeAuthorityGenerationEnforcement";
type Identity = {
    readonly device: number;
    readonly inode: number;
};
type FileIdentity = Identity & {
    readonly byteLength: number;
    readonly sha256: string;
};
interface Entry {
    readonly relativePath: string;
    readonly source: Identity;
    readonly target: Identity;
    readonly byteLength: number;
    readonly sha256: string;
}
interface DirectoryEntry {
    readonly relativePath: string;
    readonly source: Identity;
    readonly target: Identity;
}
interface Proof {
    readonly schemaVersion: "runtime-materialization-proof-v1";
    readonly transitionId: string;
    readonly candidateManifestSha256: string;
    readonly sourceBinding: string;
    readonly targetBinding: string;
    readonly contentDigest: string;
    readonly files: readonly Entry[];
    readonly directories: readonly DirectoryEntry[];
}
export class RuntimeMaterializationProofError extends Error {
    constructor() { super("Runtime materialization proof is absent or invalid."); this.name = "RuntimeMaterializationProofError"; }
}
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const identity = (stat: fs.Stats): Identity => ({ device: stat.dev, inode: stat.ino });
const same = (a: Identity, b: Identity) => a.device === b.device && a.inode === b.inode;
const safeRelative = (value: string, rootAllowed = false) => typeof value === "string" && (rootAllowed && value === "." || value !== "." && !path.isAbsolute(value) && !value.includes("\\") && value.split("/").every(p => p && p !== "." && p !== ".."));
function fail(): never { throw new RuntimeMaterializationProofError(); }
function readStable(file: string): {
    bytes: Buffer;
    stat: fs.Stats;
} {
    validateSafeAncestorChain(path.dirname(file));
    const link = fs.lstatSync(file);
    if (!link.isFile() || link.isSymbolicLink())
        fail();
    const fd = fs.openSync(file, "r");
    try {
        const first = fs.fstatSync(fd);
        const bytes = fs.readFileSync(fd);
        const after = fs.fstatSync(fd);
        const current = fs.lstatSync(file);
        if (!same(identity(first), identity(link)) || !same(identity(first), identity(after)) || !same(identity(first), identity(current)) || first.size !== bytes.length || first.size !== after.size || current.isSymbolicLink())
            fail();
        return { bytes, stat: first };
    }
    finally {
        fs.closeSync(fd);
    }
}
function proofPath(context: RuntimeStorageContext, transitionId: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/.test(transitionId))
        fail();
    return path.join(context.authorityRoot, "authority-transition-v1", "materializations", `${transitionId}.json`);
}
/** Operator-only: after official byte-exact validation, before publication. No payload rewrite. */
export function qualifyRuntimeMaterialization(input: {
    store: RuntimeAuthorityTransitionStore;
    transitionId: string;
    sourceContext: RuntimeStorageContext;
    targetContext: RuntimeStorageContext;
    candidateDirectory: string;
    backupDirectory: string;
}): string {
    const { store, sourceContext: source, targetContext: target } = input;
    assertTrustedRuntimeStorageContext(source);
    assertTrustedRuntimeStorageContext(target);
    const record = store.readTransition(input.transitionId);
    if (!record || record.state !== "target-validated" || record.targetValidation?.byteExact !== true || !record.sourceFreeze?.projectIdentities || !record.sourceFreeze.logicalContentDigest)
        fail();
    const sourceEndpoint = describeRuntimeAuthorityIdentity(source, record.source.authorityGeneration), targetEndpoint = describeRuntimeAuthorityIdentity(target, record.target.authorityGeneration);
    if (sourceEndpoint.resolverBindingIdentity !== record.source.resolverBindingIdentity || targetEndpoint.resolverBindingIdentity !== record.target.resolverBindingIdentity)
        fail();
    verifyMigrationCandidateBinding(input.candidateDirectory, input.backupDirectory);
    const verified = verifyMigrationCandidate(input.candidateDirectory);
    const candidateRaw = readStable(path.join(input.candidateDirectory, "candidate.json"));
    if (hash(candidateRaw.bytes) !== verified.manifestSha256)
        fail();
    const manifest = JSON.parse(candidateRaw.bytes.toString("utf8"));
    const frozen = record.sourceFreeze;
    const mapping = new Map(frozen.projectIdentities!.map(e => [e.projectId, e.projectSlug]));
    const logicalMapping = new Map(frozen.projectIdentities!.map(e => [e.projectSlug, e.projectId]));
    const sourceDigest = runtimeAuthorityProjectsContentDigest(source.projectsRoot, { remapProjectFolder: f => logicalMapping.get(f) ?? f });
    const targetDigest = runtimeAuthorityProjectsContentDigest(target.projectsRoot);
    if (sourceDigest.contentDigest !== frozen.logicalContentDigest || targetDigest.contentDigest !== frozen.logicalContentDigest || sourceDigest.fileCount !== targetDigest.fileCount || sourceDigest.fileCount !== frozen.logicalFileCount)
        fail();
    const seenFiles = new Set<string>();
    const files: Entry[] = [], directoryPaths = new Set<string>(["."]);
    for (const file of manifest.files as Array<{
        relativePath: string;
        sha256: string;
        sizeBytes: number;
    }>) {
        if (file.relativePath === ".runtime-authority-generation.json")
            continue;
        if (!safeRelative(file.relativePath) || seenFiles.has(file.relativePath))
            fail();
        seenFiles.add(file.relativePath);
        const segments = file.relativePath.split("/"), physical = mapping.get(segments[0]);
        const sourceRelative = physical ? [physical, ...segments.slice(1)].join("/") : file.relativePath;
        const sourceFile = path.join(source.projectsRoot, sourceRelative), targetFile = path.join(target.projectsRoot, file.relativePath);
        assertPathContained(source.projectsRoot, sourceFile);
        assertPathContained(target.projectsRoot, targetFile);
        const a = readStable(sourceFile), b = readStable(targetFile);
        if (a.bytes.length !== file.sizeBytes || b.bytes.length !== file.sizeBytes || hash(a.bytes) !== file.sha256 || hash(b.bytes) !== file.sha256)
            fail();
        files.push({ relativePath: file.relativePath, source: identity(a.stat), target: identity(b.stat), byteLength: file.sizeBytes, sha256: file.sha256 });
        for (let i = 1; i < segments.length; i++)
            directoryPaths.add(segments.slice(0, i).join("/"));
    }
    if (files.length !== targetDigest.fileCount)
        fail();
    const directories: DirectoryEntry[] = [...directoryPaths].sort().map(relativePath => {
        const segments = relativePath.split("/"), physical = mapping.get(segments[0]);
        const sourceRelative = physical ? [physical, ...segments.slice(1)].join("/") : relativePath;
        const a = path.join(source.projectsRoot, sourceRelative), b = path.join(target.projectsRoot, relativePath);
        validateSafeAncestorChain(a);
        validateSafeAncestorChain(b);
        const sa = fs.lstatSync(a), sb = fs.lstatSync(b);
        if (!sa.isDirectory() || !sb.isDirectory() || sa.isSymbolicLink() || sb.isSymbolicLink())
            fail();
        return { relativePath, source: identity(sa), target: identity(sb) };
    });
    const afterSource = runtimeAuthorityProjectsContentDigest(source.projectsRoot, { remapProjectFolder: f => logicalMapping.get(f) ?? f });
    const afterTarget = runtimeAuthorityProjectsContentDigest(target.projectsRoot);
    if (afterSource.contentDigest !== sourceDigest.contentDigest || afterTarget.contentDigest !== targetDigest.contentDigest || afterSource.fileCount !== sourceDigest.fileCount || afterTarget.fileCount !== targetDigest.fileCount)
        fail();
    const latest = store.readTransition(input.transitionId);
    if (!latest || latest.state !== "target-validated" || JSON.stringify(latest) !== JSON.stringify(record))
        fail();
    const proof: Proof = { schemaVersion: "runtime-materialization-proof-v1", transitionId: input.transitionId, candidateManifestSha256: verified.manifestSha256, sourceBinding: record.source.resolverBindingIdentity, targetBinding: record.target.resolverBindingIdentity, contentDigest: targetDigest.contentDigest, files, directories };
    const bytes = Buffer.from(JSON.stringify(proof)), digest = hash(bytes), file = proofPath(target, input.transitionId);
    validateSafeAncestorChain(path.dirname(file));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
        if (hash(readStable(file).bytes) !== digest)
            fail();
    }
    else {
        const fd = fs.openSync(file, "wx", 0o600);
        try {
            fs.writeSync(fd, bytes);
            fs.fsyncSync(fd);
        }
        finally {
            fs.closeSync(fd);
        }
    }
    if (hash(readStable(file).bytes) !== digest)
        fail();
    if (record.targetValidation?.materializationEvidenceSha256 && record.targetValidation.materializationEvidenceSha256 !== digest)
        fail();
    store.writeTransition({ ...record, targetValidation: { ...record.targetValidation, materializationEvidenceSha256: digest } });
    return digest;
}
function readQualified(context: RuntimeStorageContext): Proof | null {
    assertTrustedRuntimeStorageContext(context);
    const store = new RuntimeAuthorityTransitionStore({ authorityRoot: context.authorityRoot }), active = store.readActiveAuthority();
    if (!active)
        return null;
    const endpoint = describeRuntimeAuthorityIdentity(context, active.authorityGeneration);
    if (active.resolverBindingIdentity !== endpoint.resolverBindingIdentity || active.authorityIdentity !== endpoint.authorityIdentity)
        return null;
    const transition = store.readTransition(active.transitionId), anchor = transition?.targetValidation?.materializationEvidenceSha256;
    if (!anchor)
        return null;
    if (!transition || transition.target.resolverBindingIdentity !== endpoint.resolverBindingIdentity || transition.target.authorityGeneration !== active.authorityGeneration || !["published", "old-root-quarantined"].includes(transition.state) || transition.targetValidation?.byteExact !== true || store.readQuarantine(endpoint.resolverBindingIdentity) && !store.readQuarantineLift(endpoint.resolverBindingIdentity))
        fail();
    assertProductionRuntimeAuthorityGenerationCompatible(context, active.authorityGeneration);
    const raw = readStable(proofPath(context, active.transitionId));
    if (raw.bytes.length > 16 * 1024 * 1024 || hash(raw.bytes) !== anchor)
        fail();
    const proof = JSON.parse(raw.bytes.toString("utf8")) as Proof;
    if (proof.schemaVersion !== "runtime-materialization-proof-v1" || proof.transitionId !== active.transitionId || proof.sourceBinding !== transition.source.resolverBindingIdentity || proof.targetBinding !== endpoint.resolverBindingIdentity || proof.contentDigest !== transition.sourceFreeze?.logicalContentDigest || !Array.isArray(proof.files) || !Array.isArray(proof.directories) || proof.files.length !== transition.sourceFreeze.logicalFileCount)
        fail();
    const validIdentity = (v: Identity) => Boolean(v) && Number.isFinite(v.device) && Number.isFinite(v.inode) && v.device >= 0 && v.inode >= 0;
    if (!/^[a-f0-9]{64}$/.test(proof.candidateManifestSha256))
        fail();
    const directories = new Set<string>();
    for (const entry of proof.directories) {
        if (!safeRelative(entry.relativePath, true) || directories.has(entry.relativePath) || !validIdentity(entry.source) || !validIdentity(entry.target))
            fail();
        directories.add(entry.relativePath);
    }
    if (!directories.has("."))
        fail();
    const paths = new Set<string>();
    for (const file of proof.files) {
        if (!validIdentity(file.source) || !validIdentity(file.target) || !safeRelative(file.relativePath) || paths.has(file.relativePath) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.byteLength) || file.byteLength < 0)
            fail();
        paths.add(file.relativePath);
    }
    return proof;
}
function relative(context: RuntimeStorageContext, file: string): string { assertPathContained(context.projectsRoot, file); return path.relative(context.projectsRoot, file).split(path.sep).join("/") || "."; }
/** Translate only an exact previously-pinned source identity backed by official copied bytes. */
export function resolveMaterializedFileIdentity(context: RuntimeStorageContext, file: string, expected: FileIdentity): FileIdentity {
    const proof = readQualified(context);
    if (!proof)
        return expected;
    const entry = proof.files.find(e => e.relativePath === relative(context, file));
    if (!entry || !same(entry.source, expected) || entry.byteLength !== expected.byteLength || entry.sha256 !== expected.sha256)
        return expected;
    return { ...expected, ...entry.target };
}
export function isMaterializedDirectoryIdentity(context: RuntimeStorageContext, directory: string, expected: Identity): boolean {
    const proof = readQualified(context);
    if (!proof)
        return false;
    const entry = proof.directories.find(e => e.relativePath === relative(context, directory));
    if (!entry || !same(entry.source, expected))
        return false;
    validateSafeAncestorChain(directory);
    const current = fs.lstatSync(directory);
    return current.isDirectory() && !current.isSymbolicLink() && same(identity(current), entry.target);
}
/** An immutable source intent is admitted only through its exact anchored file digest. */
export function isMaterializedAuthorityBinding(context: RuntimeStorageContext, file: string, sourceBinding: string): boolean {
    const proof = readQualified(context);
    if (!proof || proof.sourceBinding !== sourceBinding)
        return false;
    const entry = proof.files.find(e => e.relativePath === relative(context, file));
    if (!entry)
        return false;
    const current = readStable(file);
    return current.bytes.length === entry.byteLength && hash(current.bytes) === entry.sha256 && same(identity(current.stat), entry.target);
}
