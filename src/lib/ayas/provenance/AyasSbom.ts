import crypto from "node:crypto";

/**
 * Stage 15G — a CycloneDX-compatible SBOM built from the npm lockfile.
 *
 * Every component comes from `package-lock.json`: exact version, the registry
 * tarball it resolves to, its integrity hash, its license field, whether it is
 * shipped, optional or development-only, and whether it declares an
 * install-time script. Nothing is installed, fetched, upgraded or executed;
 * the lockfile is read as data.
 *
 * Findings say where the lockfile cannot support a claim (no integrity, a
 * tarball that is not from the npm registry, an install script nobody
 * reviewed). A finding is reported, never repaired here: changing a dependency
 * is a reviewed source change, not something this module does.
 *
 * Pure: no filesystem, no network, no clock.
 */
export const AYAS_SBOM_SPEC_VERSION = "1.5" as const;
export const AYAS_SBOM_SUPPORTED_LOCKFILE_VERSIONS: readonly number[] = Object.freeze([2, 3]);
export const AYAS_NPM_REGISTRY_PREFIX = "https://registry.npmjs.org/";

export interface AyasNpmLockPackage {
  readonly name?: string;
  readonly version?: string;
  readonly resolved?: string;
  readonly integrity?: string;
  readonly dev?: boolean;
  readonly optional?: boolean;
  readonly devOptional?: boolean;
  readonly peer?: boolean;
  readonly link?: boolean;
  readonly inBundle?: boolean;
  /** `true` or the explicit list: these dependencies ship inside this package's own registry tarball. */
  readonly bundleDependencies?: boolean | readonly string[];
  readonly license?: unknown;
  readonly hasInstallScript?: boolean;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}
export interface AyasNpmLockfile {
  readonly name?: string;
  readonly version?: string;
  readonly lockfileVersion?: number;
  readonly packages?: Readonly<Record<string, AyasNpmLockPackage>>;
}

/**
 * Install-time scripts that were read and recorded in the Stage 9 supply-chain audit
 * (`docs/AYAS_SECURITY_SUPPLY_CHAIN.md`). A review is of one exact version: the same package at another version is
 * reported as changed, and a package that is not here is reported as unreviewed.
 */
export const AYAS_REVIEWED_INSTALL_SCRIPTS: readonly { readonly name: string; readonly version: string; readonly note: string }[] = Object.freeze([
  { name: "esbuild", version: "0.28.1", note: "development build tool; has a registry binary-download fallback" },
  { name: "fsevents", version: "2.3.3", note: "optional, macOS only, development tree" },
  { name: "onnxruntime-node", version: "1.30.0", note: "postinstall fetches native packages from NuGet; the 1.30.0 install script differs from the reviewed 1.24.3 one by a comment line only" },
  { name: "protobufjs", version: "7.6.6", note: "declares a lifecycle script" },
  { name: "unrs-resolver", version: "1.12.2", note: "development tree; declares a lifecycle script" },
  { name: "workerd", version: "1.20261001.1", note: "development tree; registry binary-download fallback; the 1.20261001.1 install.js differs from the reviewed 1.20260910.1 one in its own version constants only" },
]);

export type AyasInstallScriptClass = "NONE" | "REVIEWED" | "REVIEWED_AT_ANOTHER_VERSION" | "UNREVIEWED";
export type AyasSbomScope = "required" | "optional" | "excluded";

export type AyasSbomFindingCode =
  | "LOCKFILE_INVALID"
  | "LOCKFILE_VERSION_UNSUPPORTED"
  | "PACKAGE_NAME_INVALID"
  | "VERSION_MISSING"
  | "RESOLVED_MISSING"
  | "RESOLVED_NOT_NPM_REGISTRY"
  | "INTEGRITY_MISSING"
  | "INTEGRITY_UNSUPPORTED"
  | "INTEGRITY_CONFLICT"
  | "LINKED_OR_BUNDLED_PACKAGE"
  | "LICENSE_MISSING"
  | "INSTALL_SCRIPT_UNREVIEWED"
  | "INSTALL_SCRIPT_VERSION_CHANGED"
  | "DEPENDENCY_UNRESOLVED";
/** BLOCK: the SBOM cannot vouch for this component. REVIEW: the owner should look, nothing is wrong by itself. */
export interface AyasSbomFinding { readonly code: AyasSbomFindingCode; readonly severity: "BLOCK" | "REVIEW"; readonly subject: string; readonly detail: string }

export interface AyasCycloneDxComponent {
  readonly type: "library" | "application";
  readonly "bom-ref": string;
  readonly group?: string;
  readonly name: string;
  readonly version: string;
  readonly scope?: AyasSbomScope;
  readonly purl: string;
  readonly hashes?: readonly { readonly alg: string; readonly content: string }[];
  readonly licenses?: readonly ({ readonly license: { readonly id?: string; readonly name?: string } } | { readonly expression: string })[];
  readonly externalReferences?: readonly { readonly type: "distribution"; readonly url: string }[];
  readonly properties?: readonly { readonly name: string; readonly value: string }[];
}
export interface AyasCycloneDxBom {
  readonly bomFormat: "CycloneDX";
  readonly specVersion: typeof AYAS_SBOM_SPEC_VERSION;
  readonly serialNumber: string;
  readonly version: 1;
  readonly metadata: {
    readonly timestamp?: string;
    readonly tools: { readonly components: readonly { readonly type: "application"; readonly name: string; readonly version: string }[] };
    readonly component: AyasCycloneDxComponent;
    readonly properties: readonly { readonly name: string; readonly value: string }[];
  };
  readonly components: readonly AyasCycloneDxComponent[];
  readonly dependencies: readonly { readonly ref: string; readonly dependsOn: readonly string[] }[];
}

export interface AyasSbomSummary {
  readonly components: number;
  /** Distinct lockfile entries, before the same package and version at several paths is counted once. */
  readonly lockEntries: number;
  readonly byScope: Readonly<Record<AyasSbomScope, number>>;
  /** License field as written, with its component count, most common first. */
  readonly licenses: readonly { readonly license: string; readonly components: number }[];
  /** Components whose license is not on the closed list below. A prompt to look, not a legal judgement. */
  readonly licensesForOwnerReview: readonly { readonly component: string; readonly license: string }[];
  readonly installScripts: readonly { readonly component: string; readonly scope: AyasSbomScope; readonly class: Exclude<AyasInstallScriptClass, "NONE">; readonly note: string | null }[];
  readonly blockingFindings: number;
  readonly reviewFindings: number;
}
export interface AyasSbomResult { readonly sbom: AyasCycloneDxBom; readonly findings: readonly AyasSbomFinding[]; readonly summary: AyasSbomSummary }

/** SPDX identifiers commonly treated as permissive. Anything else is listed for the owner to look at. */
const PERMISSIVE = new Set(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "CC0-1.0", "BlueOak-1.0.0", "Unlicense", "Python-2.0"]);
const INTEGRITY_ALGORITHMS: Readonly<Record<string, string>> = Object.freeze({ sha512: "SHA-512", sha384: "SHA-384", sha256: "SHA-256", sha1: "SHA-1" });
const NAME = /^(?:@[a-z0-9~][a-z0-9._~-]*\/)?[a-z0-9~][a-z0-9._~-]*$/i;
const sha256 = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");

function packageNameOf(lockPath: string, entry: AyasNpmLockPackage): string {
  if (typeof entry.name === "string" && entry.name) return entry.name;
  const index = lockPath.lastIndexOf("node_modules/");
  return index === -1 ? lockPath : lockPath.slice(index + "node_modules/".length);
}

export function ayasNpmPurl(name: string, version: string): string {
  const slash = name.startsWith("@") ? name.indexOf("/") : -1;
  const encoded = slash === -1 ? encodeURIComponent(name) : `${encodeURIComponent(name.slice(0, slash))}/${encodeURIComponent(name.slice(slash + 1))}`;
  return `pkg:npm/${encoded}@${encodeURIComponent(version)}`;
}

/** `sha512-<base64>` (one or several, space separated) as CycloneDX hashes. Null when nothing in it is usable. */
export function ayasIntegrityHashes(integrity: string): { readonly alg: string; readonly content: string }[] | null {
  const out: { alg: string; content: string }[] = [];
  for (const part of integrity.trim().split(/\s+/)) {
    const dash = part.indexOf("-");
    const alg = INTEGRITY_ALGORITHMS[part.slice(0, dash)];
    const encoded = part.slice(dash + 1);
    if (dash < 1 || !alg || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
    const bytes = Buffer.from(encoded, "base64");
    // A decoded length that does not belong to the algorithm is not a hash of it.
    if (bytes.length !== { "SHA-512": 64, "SHA-384": 48, "SHA-256": 32, "SHA-1": 20 }[alg]) return null;
    out.push({ alg, content: bytes.toString("hex") });
  }
  return out.length ? out : null;
}

function licenseText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) { const parts = value.map(licenseText).filter((part): part is string => part !== null); return parts.length ? parts.join(" OR ") : null; }
  if (value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string") return ((value as { type: string }).type.trim()) || null;
  return null;
}
const isExpression = (license: string) => /\s(?:AND|OR|WITH)\s|[()]/.test(license);
function licenseIsOnPermissiveList(license: string): boolean {
  // Every identifier named must be on the list: `MIT OR Apache-2.0` is, `Apache-2.0 AND LGPL-3.0-or-later` is not.
  const ids = license.replace(/[()]/g, " ").split(/\s+(?:AND|OR|WITH)\s+|\s+/).filter(Boolean);
  return ids.length > 0 && ids.every((id) => PERMISSIVE.has(id));
}

function scopeOf(entries: readonly AyasNpmLockPackage[]): AyasSbomScope {
  // Shipped anywhere wins over optional, which wins over development-only.
  if (entries.some((entry) => !entry.dev && !entry.optional && !entry.devOptional)) return "required";
  if (entries.some((entry) => !entry.dev)) return "optional";
  return "excluded";
}

/** Where npm resolves `name` for the package installed at `fromPath`: its own `node_modules`, then each parent's. */
function resolveDependency(packages: Readonly<Record<string, AyasNpmLockPackage>>, fromPath: string, name: string): string | null {
  let base = fromPath;
  for (;;) {
    const candidate = `${base ? `${base}/` : ""}node_modules/${name}`;
    if (Object.prototype.hasOwnProperty.call(packages, candidate)) return candidate;
    if (!base) return null;
    const index = base.lastIndexOf("/node_modules/");
    base = index === -1 ? "" : base.slice(0, index);
  }
}

/**
 * The tarball that shipped a bundled package, when the lockfile can vouch for that tarball: the bundling parent must
 * itself be a plain registry entry (no link, not bundled in turn), must name this child in its `bundleDependencies`,
 * and must carry a well-formed integrity hash from the npm registry. A bundled child has no tarball of its own — its
 * bytes are inside the parent's — so a vouched parent vouches them. Anything else stays a BLOCK finding.
 */
function vouchedBundlerOf(packages: Readonly<Record<string, AyasNpmLockPackage>>, lockPath: string, childName: string): { path: string; ref: string } | null {
  const index = lockPath.lastIndexOf("/node_modules/");
  if (index === -1) return null;
  const parentPath = lockPath.slice(0, index);
  const parent = packages[parentPath];
  if (!parent || parent.link || parent.inBundle) return null;
  if (typeof parent.version !== "string" || !parent.version) return null;
  const parentName = packageNameOf(parentPath, parent);
  if (!NAME.test(parentName)) return null;
  if (parent.bundleDependencies !== true && !(Array.isArray(parent.bundleDependencies) && parent.bundleDependencies.includes(childName))) return null;
  if (typeof parent.resolved !== "string" || !parent.resolved.startsWith(AYAS_NPM_REGISTRY_PREFIX)) return null;
  if (typeof parent.integrity !== "string" || ayasIntegrityHashes(parent.integrity) === null) return null;
  return { path: parentPath, ref: ayasNpmPurl(parentName, parent.version) };
}

export function buildAyasSbom(input: {
  readonly lockfile: unknown;
  /** SHA-256 of the lockfile text with line endings normalized to LF. */
  readonly lockfileDigest: string;
  /** Included as written when given. Leave it out for a byte-reproducible SBOM. */
  readonly generatedAt?: string;
}): AyasSbomResult {
  const findings: AyasSbomFinding[] = [];
  const add = (code: AyasSbomFindingCode, severity: "BLOCK" | "REVIEW", subject: string, detail: string) => { findings.push({ code, severity, subject, detail }); };
  const lock = (input.lockfile && typeof input.lockfile === "object" ? input.lockfile : {}) as AyasNpmLockfile;
  const packages = lock.packages && typeof lock.packages === "object" ? lock.packages : {};
  if (!lock.packages || typeof lock.packages !== "object") add("LOCKFILE_INVALID", "BLOCK", "package-lock.json", "no packages map");
  if (typeof lock.lockfileVersion !== "number" || !AYAS_SBOM_SUPPORTED_LOCKFILE_VERSIONS.includes(lock.lockfileVersion)) {
    add("LOCKFILE_VERSION_UNSUPPORTED", "BLOCK", "package-lock.json", `lockfileVersion ${String(lock.lockfileVersion)}; supported: ${AYAS_SBOM_SUPPORTED_LOCKFILE_VERSIONS.join(", ")}`);
  }

  const rootEntry = packages[""] ?? {};
  const rootName = typeof lock.name === "string" && lock.name ? lock.name : typeof rootEntry.name === "string" && rootEntry.name ? rootEntry.name : "unknown";
  const rootVersion = typeof rootEntry.version === "string" && rootEntry.version ? rootEntry.version : typeof lock.version === "string" && lock.version ? lock.version : "0.0.0";
  const rootRef = ayasNpmPurl(rootName, rootVersion);

  interface Group { name: string; version: string; ref: string; entries: AyasNpmLockPackage[]; paths: string[] }
  const groups = new Map<string, Group>();
  const refOfPath = new Map<string, string>();
  const bundledInside = new Map<string, { name: string; version: string }[]>();
  const coveredByParent = new Set<string>();
  const lockPaths = Object.keys(packages).filter((lockPath) => lockPath !== "").sort();
  for (const lockPath of lockPaths) {
    const entry = packages[lockPath]!;
    const name = packageNameOf(lockPath, entry);
    if (!NAME.test(name)) { add("PACKAGE_NAME_INVALID", "BLOCK", lockPath, "not an npm package name"); continue; }
    // A bundled package covered by its bundling parent's vouched registry tarball: reported for review, disclosed on
    // the parent's component, and never treated as a component in its own right. It still has no standalone identity.
    const version = typeof entry.version === "string" && entry.version ? entry.version : null;
    const bundler = entry.inBundle && !entry.link && entry.hasInstallScript !== true ? vouchedBundlerOf(packages, lockPath, name) : null;
    if (bundler && version) {
      add("LINKED_OR_BUNDLED_PACKAGE", "REVIEW", lockPath, `bundled inside ${bundler.ref}; covered by that tarball's registry integrity`);
      refOfPath.set(lockPath, bundler.ref);
      const list = bundledInside.get(bundler.path) ?? [];
      list.push({ name, version });
      bundledInside.set(bundler.path, list);
      coveredByParent.add(lockPath);
      continue;
    }
    if (entry.link || entry.inBundle) add("LINKED_OR_BUNDLED_PACKAGE", "BLOCK", lockPath, entry.link ? "a link to a local directory has no registry identity" : "bundled inside another tarball; it has no integrity of its own");
    if (typeof entry.version !== "string" || !entry.version) { add("VERSION_MISSING", "BLOCK", lockPath, "no exact version"); continue; }
    const ref = ayasNpmPurl(name, entry.version);
    const group = groups.get(ref) ?? { name, version: entry.version, ref, entries: [], paths: [] };
    group.entries.push(entry); group.paths.push(lockPath);
    groups.set(ref, group); refOfPath.set(lockPath, ref);
  }

  const reviewed = new Map(AYAS_REVIEWED_INSTALL_SCRIPTS.map((item) => [item.name, item]));
  const components: AyasCycloneDxComponent[] = [];
  const licenseCounts = new Map<string, number>();
  const licensesForOwnerReview: { component: string; license: string }[] = [];
  const installScripts: AyasSbomSummary["installScripts"][number][] = [];
  const byScope: Record<AyasSbomScope, number> = { required: 0, optional: 0, excluded: 0 };

  for (const group of [...groups.values()].sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))) {
    const label = `${group.name}@${group.version}`;
    const first = group.entries[0]!;
    const scope = scopeOf(group.entries);
    byScope[scope] += 1;

    const integrities = [...new Set(group.entries.map((entry) => entry.integrity).filter((value): value is string => typeof value === "string" && value !== ""))];
    let hashes: { alg: string; content: string }[] | null = null;
    if (integrities.length === 0) add("INTEGRITY_MISSING", "BLOCK", label, "the lockfile records no integrity hash for this tarball");
    else if (integrities.length > 1) add("INTEGRITY_CONFLICT", "BLOCK", label, "the same package and version is recorded with different integrity hashes");
    else if (!(hashes = ayasIntegrityHashes(integrities[0]!))) add("INTEGRITY_UNSUPPORTED", "BLOCK", label, "the integrity value is not a well-formed sha512, sha384, sha256 or sha1 hash");

    const resolved = group.entries.map((entry) => entry.resolved).find((value): value is string => typeof value === "string" && value !== "");
    if (!resolved) add("RESOLVED_MISSING", "BLOCK", label, "the lockfile does not say where this tarball comes from");
    else if (!group.entries.every((entry) => typeof entry.resolved === "string" && entry.resolved.startsWith(AYAS_NPM_REGISTRY_PREFIX))) {
      add("RESOLVED_NOT_NPM_REGISTRY", "BLOCK", label, "resolved from somewhere other than the npm registry (a Git, file or other URL)");
    }

    const license = licenseText(first.license);
    if (!license) add("LICENSE_MISSING", "REVIEW", label, "the lockfile records no license for this package");
    else {
      licenseCounts.set(license, (licenseCounts.get(license) ?? 0) + 1);
      if (!licenseIsOnPermissiveList(license)) licensesForOwnerReview.push({ component: label, license });
    }

    let scriptClass: AyasInstallScriptClass = "NONE";
    if (group.entries.some((entry) => entry.hasInstallScript === true)) {
      const review = reviewed.get(group.name);
      scriptClass = !review ? "UNREVIEWED" : review.version === group.version ? "REVIEWED" : "REVIEWED_AT_ANOTHER_VERSION";
      if (scriptClass === "UNREVIEWED") add("INSTALL_SCRIPT_UNREVIEWED", "BLOCK", label, "declares an install-time script that no recorded review covers");
      if (scriptClass === "REVIEWED_AT_ANOTHER_VERSION") add("INSTALL_SCRIPT_VERSION_CHANGED", "BLOCK", label, `its install-time script was reviewed at ${review!.version}, not at this version`);
      installScripts.push({ component: label, scope, class: scriptClass, note: review?.note ?? null });
    }

    const slash = group.name.startsWith("@") ? group.name.indexOf("/") : -1;
    const bundles = [...new Set(group.paths.flatMap((lockPath) => bundledInside.get(lockPath) ?? []).map((item) => `${item.name}@${item.version}`))].sort();
    components.push({
      type: "library",
      "bom-ref": group.ref,
      ...(slash === -1 ? {} : { group: group.name.slice(0, slash) }),
      name: slash === -1 ? group.name : group.name.slice(slash + 1),
      version: group.version,
      scope,
      purl: group.ref,
      ...(hashes ? { hashes } : {}),
      ...(license ? { licenses: [isExpression(license) ? { expression: license } : { license: PERMISSIVE.has(license) || /^[A-Za-z0-9.+-]+$/.test(license) ? { id: license } : { name: license } }] } : {}),
      ...(resolved ? { externalReferences: [{ type: "distribution" as const, url: resolved }] } : {}),
      properties: [
        { name: "ayas:npm:development", value: String(scope === "excluded") },
        { name: "ayas:npm:installScript", value: scriptClass },
        { name: "ayas:npm:lockPaths", value: String(group.paths.length) },
        ...(bundles.length ? [{ name: "ayas:npm:bundles", value: bundles.join(", ") }] : []),
      ],
    });
  }

  const dependsOn = new Map<string, Set<string>>();
  const link = (fromRef: string, fromPath: string, entry: AyasNpmLockPackage, label: string) => {
    const set = dependsOn.get(fromRef) ?? new Set<string>();
    dependsOn.set(fromRef, set);
    const required = { ...(entry.dependencies ?? {}), ...(fromPath === "" ? entry.devDependencies ?? {} : {}) };
    for (const name of Object.keys(required).sort()) {
      const target = resolveDependency(packages, fromPath, name);
      const ref = target === null ? undefined : refOfPath.get(target);
      if (ref) set.add(ref); else add("DEPENDENCY_UNRESOLVED", "BLOCK", label, `depends on ${name}, which the lockfile does not contain`);
    }
    // Optional and peer dependencies are edges only when the lockfile really holds them: a platform package for
    // another operating system, or a peer nobody installed, is absent by design.
    for (const name of Object.keys({ ...(entry.optionalDependencies ?? {}), ...(entry.peerDependencies ?? {}) }).sort()) {
      const target = resolveDependency(packages, fromPath, name);
      const ref = target === null ? undefined : refOfPath.get(target);
      if (ref) set.add(ref);
    }
  };
  link(rootRef, "", rootEntry, `${rootName}@${rootVersion}`);
  for (const lockPath of lockPaths) { const ref = refOfPath.get(lockPath); if (ref && !coveredByParent.has(lockPath)) link(ref, lockPath, packages[lockPath]!, lockPath); }
  const dependencies = [...dependsOn.entries()].map(([ref, set]) => ({ ref, dependsOn: [...set].filter((item) => item !== ref).sort() })).sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));

  const rootComponent: AyasCycloneDxComponent = { type: "application", "bom-ref": rootRef, name: rootName, version: rootVersion, purl: rootRef };
  const properties = [
    { name: "ayas:lockfile:sha256", value: input.lockfileDigest },
    { name: "ayas:lockfile:version", value: String(lock.lockfileVersion ?? "unknown") },
  ];
  // The serial number is derived from the content, so the same lockfile always gives the same SBOM.
  const identity = sha256(JSON.stringify({ rootComponent, components, dependencies, properties }));
  const serialNumber = `urn:uuid:${identity.slice(0, 8)}-${identity.slice(8, 12)}-5${identity.slice(13, 16)}-${"89ab"[parseInt(identity[16]!, 16) % 4]}${identity.slice(17, 20)}-${identity.slice(20, 32)}`;
  const sbom: AyasCycloneDxBom = {
    bomFormat: "CycloneDX",
    specVersion: AYAS_SBOM_SPEC_VERSION,
    serialNumber,
    version: 1,
    metadata: {
      ...(input.generatedAt ? { timestamp: input.generatedAt } : {}),
      tools: { components: [{ type: "application", name: "ayas-release-provenance", version: "1" }] },
      component: rootComponent,
      properties,
    },
    components,
    dependencies,
  };
  const summary: AyasSbomSummary = {
    components: components.length,
    lockEntries: lockPaths.length,
    byScope,
    licenses: [...licenseCounts.entries()].map(([license, count]) => ({ license, components: count })).sort((a, b) => b.components - a.components || (a.license < b.license ? -1 : 1)),
    licensesForOwnerReview: licensesForOwnerReview.sort((a, b) => (a.component < b.component ? -1 : 1)),
    installScripts,
    blockingFindings: findings.filter((finding) => finding.severity === "BLOCK").length,
    reviewFindings: findings.filter((finding) => finding.severity === "REVIEW").length,
  };
  return { sbom, findings, summary };
}
