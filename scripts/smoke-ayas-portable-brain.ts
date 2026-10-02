/** Stage 15S security/restore probes. Synthetic private data/session; owned TEMP repositories and restore roots only. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { issueSession } from "../src/lib/auth/accessGate";
import { classifyPatchTarget } from "../src/lib/brain/selfheal/BrainPatchSafety";
import { AYAS_PORTABLE_SECTIONS, assertAyasPortableBrain, assertAyasPortableJson, decryptAyasPortableBrain, encryptAyasPortableBrain,
  manifestAyasPortableBrain, portableBrainDigest, type AyasPortableBrain } from "../src/lib/ayas/migration/AyasPortableBrain";
import { exportAyasPortableBrain, restoreAyasPortableBrainInTemp } from "../src/lib/ayas/migration/AyasPortableBrainStore";
import { AYAS_MIGRATION_CHECKS, evaluateAyasPortableMigration, portableMigrationScope, type AyasMigrationContext } from "../src/lib/ayas/migration/AyasPortableMigration";
import { verifyAyasPortableArtifacts } from "../src/lib/ayas/migration/AyasPortableArtifacts";

const parent = fs.realpathSync.native(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, "ayas-portable-smoke-"));
const KEY = "fixture-portable-owner-key-0001", PASS = "fixture-portable-archive-passphrase-0001", NOW = Date.parse("2026-10-03T00:00:00.000Z");
const env = { NODE_ENV: "test" as const, AYAS_ACCESS_KEY: KEY };
let scenarios = 0;
const selected = process.env.AYAS_PORTABLE_MUTATION_CASE;
if (selected !== undefined) {
  const cwd = fs.realpathSync.native(process.cwd());
  assert.equal(path.dirname(cwd).toLowerCase(), parent.toLowerCase()); assert.ok(path.basename(cwd).startsWith("ayas-portable-audit-"));
  assert.ok(!fs.existsSync(path.join(cwd, ".git"))); assert.match(selected, /^(?:[1-9]|1[0-9]|2[0-3])$/);
}
let index = 0;
async function scenario(name: string, action: () => void | Promise<void>) {
  index++; if (selected !== undefined && Number(selected) !== index) return;
  await action(); scenarios++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${index}: ${name}`);
}
const git = (args: string[]) => execFileSync("git", ["-c", `safe.directory=${root}`, ...args], { cwd: root, windowsHide: true, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
git(["init", "--quiet"]); fs.writeFileSync(path.join(root, ".gitignore"), "data/brain/execution/\n");
git(["add", ".gitignore"]); git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "fixture"]);
const payload = (): AyasPortableBrain => ({
  schemaVersion: "1", sourceHead: git(["rev-parse", "HEAD"]), createdAt: new Date(NOW).toISOString(), disposition: "INERT_OWNER_REVIEW_REQUIRED",
  sections: AYAS_PORTABLE_SECTIONS.map(section => ({ section, state: section === "MEMORY_RETRIEVAL" ? "PRESENT" : "NOT_CONFIGURED" })),
  entries: [{ id: "memory-records", section: "MEMORY_RETRIEVAL", schemaVersion: "1", data: { schemaVersion: "1", revision: 7, records: [{ title: "Özel stüdyo tercihi", body: "Sakin anlatım tercih ediliyor.", confidence: "reported" }] } }],
  runtime: { artifacts: [{ id: "coding-model", kind: "CODING_MODEL", immutableIdentity: `sha256:${"a".repeat(64)}`, sha256: "a".repeat(64), sizeBytes: 100,
    relativeLocator: "bin/ayas-local-coding/model.gguf", qualification: "DEGRADED", transfer: "VERIFIED_LOCAL_FILE", rebuildInputs: [] }],
    policy: { mode: "ON_DEMAND", maxHeavyWorkloads: 1, maxRamAdmissionPercent: 90, idleStopMs: 600000, automaticWslShutdown: false },
    graphifyRebuild: "graphify update --scope all --no-description --no-label ." },
});
const context = (p: AyasPortableBrain): AyasMigrationContext => ({ mode: "TEMP_DRILL", destinationHead: "b".repeat(40), hardwareFingerprint: "c".repeat(64),
  expectedManifestDigest: portableBrainDigest(manifestAyasPortableBrain(p)), evidence: AYAS_MIGRATION_CHECKS.map(check => ({ check, state: "PASS", evidenceClass: "DETERMINISTIC_TEST",
    manifestDigest: portableBrainDigest(manifestAyasPortableBrain(p)), destinationHead: "b".repeat(40), hardwareFingerprint: "c".repeat(64), evidenceDigest: portableBrainDigest({ check, fixture: true }) })) });
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const rejects = (p: unknown, pattern = /AYAS_PORTABLE_/) => assert.throws(() => assertAyasPortableBrain(p), pattern);
const roots: string[] = [];

async function main() {
  await scenario("policy modules and graders cannot rewrite themselves", () => {
    for (const file of ["src/lib/ayas/migration/AyasPortableBrain.ts", "src/lib/ayas/migration/AyasPortableBrainStore.ts", "src/lib/ayas/migration/AyasPortableMigration.ts",
      "src/lib/ayas/migration/AyasPortableArtifacts.ts", "scripts/ayas-portable-brain.ts", "scripts/smoke-ayas-portable-brain.ts", "scripts/smoke-ayas-portable-brain-mutations.ts"])
      for (const spelling of [file, file.toUpperCase(), `./${file.replace(/\//g, "\\")}`]) assert.equal(classifyPatchTarget(spelling).level, "FORBIDDEN_AUTONOMOUS");
  });
  await scenario("versioned domains, present/absent truth and unknown fields", () => {
    assertAyasPortableBrain(payload()); const p = copy(payload()) as unknown as Record<string, unknown>; p.schemaVersion = "2"; rejects(p); p.schemaVersion = "1"; p.approved = true; rejects(p);
    const missing = copy(payload()); (missing.sections as unknown[]).pop(); rejects(missing);
    const duplicate = copy(payload()); (duplicate.sections as unknown[])[1] = duplicate.sections[0]; rejects(duplicate);
    const empty = copy(payload()); (empty.entries as unknown[]).length = 0; rejects(empty);
  });
  await scenario("no secrets, executable approvals, prototypes or machine paths", () => {
    for (const data of [{ apiKey: "fixture-value" }, { authorizationId: "old-authorization" }, { ownerSession: "old-session" }, { signature: "old-signer" },
      { password: "fixture-value" }, { accessToken: "opaque-value" }, { token: "opaque-value" }, { body: "C:\\Users\\Owner\\model.gguf" }, { body: "C:/models/model.gguf" },
      { body: "/opt/model.gguf" }, { body: "\\\\server\\models\\model.gguf" }, { body: "sk-proj-" + "X".repeat(25) }, JSON.parse('{"__proto__":{"owner":true}}')])
      assert.throws(() => assertAyasPortableJson(data), /AYAS_PORTABLE_/);
    assert.throws(() => assertAyasPortableJson({ missing: undefined })); assert.throws(() => assertAyasPortableJson(new Date()));
    assert.throws(() => assertAyasPortableJson(Object.defineProperty({}, "hidden", { value: "opaque" })));
    let getterRead = false;
    assert.throws(() => assertAyasPortableJson({ get body() { getterRead = true; return "opaque"; } })); assert.equal(getterRead, false);
    assertAyasPortableJson({ reference: "docs/evidence.json", source: "https://example.invalid/evidence" });
  });
  await scenario("entry identity cannot select a path or duplicate another entry", () => {
    for (const id of ["../memory", "Memory", "a/b", "a\\b", "nul", "con", "com1", "lpt9", "a:"]) { const p = copy(payload()); (p.entries[0] as { id: string }).id = id; rejects(p); }
    const p = copy(payload()); (p.entries as unknown[]).push(p.entries[0]); rejects(p);
    const wrong = copy(payload()); (wrong.entries[0] as { section: string }).section = "UNKNOWN"; rejects(wrong);
  });
  await scenario("immutable runtime identity, relative locator and ON_DEMAND rules", () => {
    const p = copy(payload()); (p.runtime.artifacts[0] as { immutableIdentity: string }).immutableIdentity = "mutable-latest"; rejects(p);
    for (const relativeLocator of ["../model.gguf", "/models/model.gguf", "C:/model.gguf", "bin/NUL.gguf", "bin//model.gguf"]) {
      const bad = copy(payload()); (bad.runtime.artifacts[0] as { relativeLocator: string }).relativeLocator = relativeLocator; rejects(bad);
    }
    for (const patch of [{ mode: "ALWAYS_ON" }, { maxHeavyWorkloads: 2 }, { maxRamAdmissionPercent: NaN }, { automaticWslShutdown: true }]) {
      const bad = copy(payload()); Object.assign(bad.runtime.policy, patch); rejects(bad);
    }
  });
  await scenario("Podman image strategy must include an immutable image and pinned rebuild inputs", () => {
    const p = copy(payload()), a = p.runtime.artifacts[0] as unknown as Record<string, unknown>;
    a.kind = "PODMAN_IMAGE"; a.transfer = "REBUILD_PINNED_IMAGE"; rejects(p);
    a.rebuildInputs = ["d".repeat(64)]; assertAyasPortableBrain(p); a.transfer = "EXPORT_EXACT_IMAGE"; assertAyasPortableBrain(p);
    a.transfer = "BLIND_COPY"; rejects(p);
  });
  await scenario("authenticated encryption keeps private content out of the archive", () => {
    const p = payload(), archive = encryptAyasPortableBrain(p, PASS), expected = portableBrainDigest(manifestAyasPortableBrain(p));
    assert.ok(!JSON.stringify(archive).includes("Sakin anlatım")); assert.deepEqual(decryptAyasPortableBrain(archive, PASS, expected), p);
    assert.notEqual(encryptAyasPortableBrain(p, PASS).ciphertext, archive.ciphertext); assert.throws(() => encryptAyasPortableBrain(p, "short"));
  });
  await scenario("wrong passphrase, tag, ciphertext and expected digest cannot decrypt", () => {
    const p = payload(), a = encryptAyasPortableBrain(p, PASS), expected = portableBrainDigest(manifestAyasPortableBrain(p));
    assert.throws(() => decryptAyasPortableBrain(a, PASS + "wrong", expected), /ARCHIVE_UNVERIFIED/);
    assert.throws(() => decryptAyasPortableBrain({ ...a, tag: "0".repeat(32) }, PASS, expected), /ARCHIVE_UNVERIFIED/);
    assert.throws(() => decryptAyasPortableBrain({ ...a, ciphertext: Buffer.from("tampered").toString("base64") }, PASS, expected), /ARCHIVE_UNVERIFIED/);
    assert.throws(() => decryptAyasPortableBrain(a, PASS, "0".repeat(64)), /ENVELOPE_INVALID/);
  });
  await scenario("untrusted encryption options, extra fields, malformed and oversized envelopes", () => {
    const p = payload(), a = encryptAyasPortableBrain(p, PASS), expected = portableBrainDigest(manifestAyasPortableBrain(p));
    for (const patch of [{ kdf: "SCRYPT_UNBOUNDED" }, { cipher: "NONE" }, { secret: "x" }, { ciphertext: "!!!!" }, { ciphertext: "A".repeat(24 * 1024 * 1024) }])
      assert.throws(() => decryptAyasPortableBrain({ ...a, ...patch }, PASS, expected), /ENVELOPE_INVALID/);
  });
  await scenario("TEMP restore produces actual hashed durable JSON and no migration claim", () => {
    const p = payload(), expected = portableBrainDigest(manifestAyasPortableBrain(p));
    const result = restoreAyasPortableBrainInTemp(encryptAyasPortableBrain(p, PASS), PASS, expected, (dir) => {
      const record = JSON.parse(fs.readFileSync(path.join(dir, "MEMORY_RETRIEVAL", "memory-records.json"), "utf8"));
      assert.equal(record.revision, 7); assert.equal(record.records[0].body, "Sakin anlatım tercih ediliyor.");
      assert.equal(fs.existsSync(path.join(root, "data")), false);
    }); roots.push(result.restoredRoot); assert.equal(result.entries, 1); assert.equal(result.liveStoresChanged, false);
    assert.equal(result.grantsAuthority, false); assert.equal(result.outcome, "TEMP_RESTORE_VERIFIED_NOT_MIGRATION_CERTIFIED");
  });
  await scenario("restore audit detects changed bytes and unexpected files", () => {
    const p = payload(), a = encryptAyasPortableBrain(p, PASS), expected = portableBrainDigest(manifestAyasPortableBrain(p));
    assert.throws(() => restoreAyasPortableBrainInTemp(a, PASS, expected, dir => fs.writeFileSync(path.join(dir, "MEMORY_RETRIEVAL", "memory-records.json"), "{}")), /RESTORE_UNVERIFIED/);
    assert.throws(() => restoreAyasPortableBrainInTemp(a, PASS, expected, dir => fs.writeFileSync(path.join(dir, "unexpected.json"), "{}")), /RESTORE_UNVERIFIED/);
  });
  await scenario("owner session required before export; disabled-dev and wrong digest write nothing", async () => {
    const p = payload(), base = { repoRoot: root, payload: p, expectedManifestDigest: portableBrainDigest(manifestAyasPortableBrain(p)), passphrase: PASS, env, nowMs: () => NOW };
    await assert.rejects(exportAyasPortableBrain({ ...base, ownerSession: undefined }), /OWNER_SESSION_REQUIRED/);
    await assert.rejects(exportAyasPortableBrain({ ...base, ownerSession: await issueSession(KEY, NOW), env: { NODE_ENV: "development" } }), /OWNER_SESSION_REQUIRED/);
    await assert.rejects(exportAyasPortableBrain({ ...base, ownerSession: await issueSession(KEY, NOW), expectedManifestDigest: "0".repeat(64) }), /OWNER_REVIEW_MISMATCH/);
    assert.equal(fs.existsSync(path.join(root, "data")), false);
  });
  await scenario("source HEAD and clean tree binding required for export", async () => {
    const p = payload(), bad = { ...p, sourceHead: "f".repeat(40) };
    await assert.rejects(exportAyasPortableBrain({ repoRoot: root, payload: bad, expectedManifestDigest: portableBrainDigest(manifestAyasPortableBrain(bad)), passphrase: PASS,
      ownerSession: await issueSession(KEY, NOW), env, nowMs: () => NOW }), /SOURCE_BINDING_REFUSED/);
    const dirty = path.join(root, "untracked-fixture.txt"); fs.writeFileSync(dirty, "Uncommitted source fixture");
    try { await assert.rejects(exportAyasPortableBrain({ repoRoot: root, payload: p, expectedManifestDigest: portableBrainDigest(manifestAyasPortableBrain(p)), passphrase: PASS,
      ownerSession: await issueSession(KEY, NOW), env, nowMs: () => NOW }), /SOURCE_BINDING_REFUSED/); } finally { fs.rmSync(dirty); }
    assert.equal(fs.existsSync(path.join(root, "data")), false);
  });
  await scenario("owner export is encrypted, write-once and not a live activation", async () => {
    const p = payload(), base = { repoRoot: root, payload: p, expectedManifestDigest: portableBrainDigest(manifestAyasPortableBrain(p)), passphrase: PASS,
      ownerSession: await issueSession(KEY, NOW), env, nowMs: () => NOW };
    const exported = await exportAyasPortableBrain(base); const bytes = fs.readFileSync(exported.archive, "utf8");
    assert.ok(!bytes.includes("Sakin anlatım") && !bytes.includes(PASS) && !bytes.includes(KEY));
    assert.deepEqual(decryptAyasPortableBrain(JSON.parse(bytes), PASS, exported.manifestDigest), p);
    await assert.rejects(exportAyasPortableBrain(base)); assert.equal(fs.readFileSync(exported.archive, "utf8"), bytes);
    assert.equal(fs.existsSync(path.join(root, "data", "brain", "owner-constitution")), false); assert.equal(git(["status", "--porcelain=v1"]), "");
  });
  await scenario("complete TEMP evidence remains owner review, never real migration or cleanup authority", () => {
    const p = payload(), result = evaluateAyasPortableMigration(p, context(p));
    assert.equal(result.outcome, "TEMP_DRILL_READY_FOR_OWNER_REVIEW"); assert.ok(result.checks.every(x => x.state === "PASS"));
    assert.equal(result.ownerActivation, "BLOCKED_OWNER_ACTION"); assert.equal(result.grantsAuthority, false);
    assert.equal(result.liveActivationOccurred, false); assert.match(result.oldPcCleanup, /BLOCKED_OWNER_ACTION/);
    assert.equal(portableMigrationScope(p).importedApprovalUse, "HISTORICAL_ONLY_NEVER_EXECUTABLE");
  });
  await scenario("every missing or failed prerequisite blocks later PASS and activation", () => {
    const p = payload();
    for (const check of AYAS_MIGRATION_CHECKS) {
      const c = context(p), missing = { ...c, evidence: c.evidence.filter(x => x.check !== check) };
      assert.equal(evaluateAyasPortableMigration(p, missing).outcome, "MIGRATION_BLOCKED");
      for (const state of ["FAIL", "BLOCKED", "NOT_RUN", "DEGRADED"] as const) {
        const result = evaluateAyasPortableMigration(p, { ...c, evidence: c.evidence.map(x => x.check === check ? { ...x, state } : x) });
        assert.equal(result.outcome, "MIGRATION_BLOCKED");
        const next = result.checks[AYAS_MIGRATION_CHECKS.indexOf(check) + 1]; if (next) assert.equal(next.state, "BLOCKED");
      }
    }
  });
  await scenario("old hardware, graph HEAD and unrelated manifest evidence fail closed", () => {
    const p = payload();
    for (const field of ["manifestDigest", "destinationHead", "hardwareFingerprint"] as const) {
      const c = context(p), evidence = c.evidence.map(e => e.check === "GRAPHIFY" ? { ...e, [field]: "0".repeat(field === "destinationHead" ? 40 : 64) } : e);
      assert.equal(evaluateAyasPortableMigration(p, { ...c, evidence }).outcome, "MIGRATION_BLOCKED");
    }
  });
  await scenario("synthetic destination metrics cannot claim a real migration", () => {
    const p = payload(), c = context(p);
    assert.equal(evaluateAyasPortableMigration(p, { ...c, mode: "DESTINATION" }).outcome, "MIGRATION_BLOCKED");
    const live = { ...c, mode: "DESTINATION" as const, evidence: c.evidence.map(x => ({ ...x, evidenceClass: "LIVE_READ_ONLY" as const })) };
    const result = evaluateAyasPortableMigration(p, live); assert.equal(result.outcome, "DESTINATION_EVIDENCE_READY_FOR_OWNER_REVIEW"); assert.equal(result.liveActivationOccurred, false);
  });
  await scenario("duplicate and unknown migration evidence cannot substitute for a missing check", () => {
    const p = payload(), c = context(p), duplicate = [...c.evidence]; duplicate[1] = duplicate[0]!;
    assert.throws(() => evaluateAyasPortableMigration(p, { ...c, evidence: duplicate }), /EVIDENCE_INVALID/);
    const bad = copy(c); (bad.evidence[0] as unknown as Record<string, unknown>).approved = true;
    assert.throws(() => evaluateAyasPortableMigration(p, bad), /EVIDENCE_INVALID/);
  });
  await scenario("all canonical domains restore verified bytes as inert data", () => {
    const p = { ...payload(), sections: AYAS_PORTABLE_SECTIONS.map(section => ({ section, state: "PRESENT" as const })),
      entries: AYAS_PORTABLE_SECTIONS.map((section, n) => ({ id: `domain-${n}`, section, schemaVersion: "1" as const,
        data: { schemaVersion: "1", historyDisposition: "HISTORICAL_ONLY", records: [{ stableReference: `record-${n}`, content: `Private fixture domain ${n}` }] } })) };
    const expected = portableBrainDigest(manifestAyasPortableBrain(p));
    const restored = restoreAyasPortableBrainInTemp(encryptAyasPortableBrain(p, PASS), PASS, expected, dir => {
      for (const e of p.entries) assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, e.section, `${e.id}.json`), "utf8")), e.data);
    }); roots.push(restored.restoredRoot); assert.equal(restored.entries, AYAS_PORTABLE_SECTIONS.length); assert.equal(restored.grantsAuthority, false);
  });
  await scenario("destination verifies real artifact bytes without qualifying the model", () => {
    const p = copy(payload()), data = Buffer.from("Fixture model bytes, never an executable model.");
    const sha256 = createHash("sha256").update(data).digest("hex"), a = p.runtime.artifacts[0] as unknown as Record<string, unknown>;
    a.sha256 = sha256; a.immutableIdentity = `sha256:${sha256}`; a.sizeBytes = data.length;
    const artifactRoot = path.join(root, "data", "brain", "execution", "artifacts"), file = path.join(artifactRoot, p.runtime.artifacts[0]!.relativeLocator);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data);
    const verified = verifyAyasPortableArtifacts(p, artifactRoot);
    assert.equal(verified.results[0]!.state, "PASS"); assert.equal(verified.results[0]!.qualification, "DEGRADED");
    assert.equal(verified.hardwareBenchmark, "NOT_RUN"); assert.equal(verified.grantsAuthority, false);
    fs.writeFileSync(file, Buffer.alloc(data.length)); assert.equal(verifyAyasPortableArtifacts(p, artifactRoot).results[0]!.state, "BLOCKED");
    fs.rmSync(file); assert.equal(verifyAyasPortableArtifacts(p, artifactRoot).results[0]!.state, "BLOCKED");
    assert.throws(() => verifyAyasPortableArtifacts(p, artifactRoot, { maxReadMs: -1 }));
  });
  await scenario("artifact links and unexecuted Podman rebuild fail closed", () => {
    const p = copy(payload()), data = Buffer.from("Confined fixture bytes.");
    const sha256 = createHash("sha256").update(data).digest("hex"), a = p.runtime.artifacts[0] as unknown as Record<string, unknown>;
    a.sha256 = sha256; a.immutableIdentity = `sha256:${sha256}`; a.sizeBytes = data.length; a.relativeLocator = "linked/model.gguf";
    const artifactRoot = path.join(root, "data", "brain", "execution", "linked-artifacts"), other = path.join(root, "data", "brain", "execution", "other-fixture");
    fs.mkdirSync(artifactRoot, { recursive: true }); fs.mkdirSync(other, { recursive: true }); fs.writeFileSync(path.join(other, "model.gguf"), data);
    const link = path.join(artifactRoot, "linked"); fs.symlinkSync(other, link, process.platform === "win32" ? "junction" : "dir");
    try { assert.equal(verifyAyasPortableArtifacts(p, artifactRoot).results[0]!.state, "BLOCKED"); }
    finally { if (process.platform === "win32") fs.rmdirSync(link); else fs.unlinkSync(link); }
    a.kind = "PODMAN_IMAGE"; a.transfer = "REBUILD_PINNED_IMAGE"; a.rebuildInputs = [sha256];
    assert.equal(verifyAyasPortableArtifacts(p, artifactRoot).results[0]!.reason, "PINNED_IMAGE_REBUILD_NOT_EXECUTED");
  });
  await scenario("operator manifest, owner export, verify and drill execute with private environment inputs", async () => {
    const p = { ...payload(), createdAt: new Date(NOW + 1).toISOString() }, expected = portableBrainDigest(manifestAyasPortableBrain(p));
    const dir = path.join(root, "data", "brain", "execution"); fs.mkdirSync(dir, { recursive: true });
    const input = path.join(dir, "fixture-input.json"); fs.writeFileSync(input, JSON.stringify(p));
    const operator = path.resolve("scripts/ayas-portable-brain.ts"), loader = pathToFileURL(createRequire(pathToFileURL(path.resolve("package.json"))).resolve("tsx")).href;
    const session = await issueSession(KEY), privateEnv = { ...process.env, ...env, AYAS_PORTABLE_OWNER_SESSION: session, AYAS_PORTABLE_PASSPHRASE: PASS };
    const run = (args: string[], customEnv = privateEnv) => spawnSync(process.execPath, ["--import", loader, operator, ...args], { cwd: root, env: customEnv, windowsHide: true, encoding: "utf8", timeout: 30_000 });
    for (const args of [["manifest", input], ["export", input, expected]]) {
      const r = run(args); assert.equal(r.status, 0, r.stderr); const output = JSON.parse(r.stdout); assert.equal(output.manifestDigest, expected);
      assert.equal(output.grantsAuthority, false); assert.ok(!r.stdout.includes(PASS) && !r.stdout.includes(KEY) && !r.stdout.includes("Sakin anlatım"));
    }
    const archive = path.join(dir, "portable-brain", `${expected}.encrypted.json`);
    for (const mode of ["verify", "drill"]) { const r = run([mode, archive, expected]); assert.equal(r.status, 0, r.stderr); assert.equal(JSON.parse(r.stdout).grantsAuthority, false); }
    const refused = run(["verify", archive, expected], { ...privateEnv, AYAS_PORTABLE_PASSPHRASE: PASS + "wrong" });
    assert.notEqual(refused.status, 0); assert.match(refused.stderr, /ARCHIVE_UNVERIFIED/); assert.ok(!refused.stderr.includes(PASS));
  });
  assert.equal(index, 23); assert.equal(scenarios, selected === undefined ? 23 : 1);
  console.log(`Stage15S portable brain smoke: PASS (${scenarios} scenarios; TEMP only, no real migration certification)`);
}
void main().finally(() => {
  for (const dir of [...roots, root]) { const real = fs.realpathSync.native(dir); assert.equal(path.dirname(real).toLowerCase(), parent.toLowerCase()); assert.ok(/^ayas-portable-(?:smoke|restore)-/.test(path.basename(real))); fs.rmSync(real, { recursive: true, force: true }); }
});
