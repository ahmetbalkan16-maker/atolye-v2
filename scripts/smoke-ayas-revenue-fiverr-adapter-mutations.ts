/** Stage16.6 assertion-caught mutations in an isolated synthetic-only TEMP copy. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const repo = process.cwd(), parent = fs.realpathSync.native(os.tmpdir());
const temp = fs.mkdtempSync(path.join(parent, "ayas-revenue-fiverr-audit-")), link = path.join(temp, "node_modules");
const test = "scripts/smoke-ayas-revenue-fiverr-adapter.ts", copied = new Set<string>();
function copy(file: string) {
  if (copied.has(file)) return; copied.add(file); const to = path.join(temp, file); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(repo, file), to);
  if (!/\.tsx?$/.test(file)) return;
  for (const m of fs.readFileSync(to, "utf8").matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]/g)) {
    const base = path.resolve(path.dirname(path.join(repo, file)), m[1]!);
    const found = [base, base + ".ts", base + ".tsx", base + ".json", path.join(base, "index.ts")].find(f => fs.existsSync(f) && fs.statSync(f).isFile());
    if (found) { const rel = path.relative(repo, found).replace(/\\/g, "/"); assert.ok(!rel.startsWith("..") && !path.isAbsolute(rel)); copy(rel); }
  }
}
const D = "src/lib/ayas/revenue/adapters/fiverr/";
const mutants: readonly (readonly [string, string, string, string, string])[] = [
  [
    "paid draft cost",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrManualAdapter.ts",
    "costClass: \"local-zero-cost\"",
    "costClass: \"paid\"",
    "P01"
  ],
  [
    "publication opened",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrDrafts.ts",
    "publication: \"CLOSED\"",
    "publication: \"OPEN\"",
    "P03"
  ],
  [
    "skipped tiers",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrDrafts.ts",
    " || pack.tier !== tiers[seen.size]",
    "",
    "P06"
  ],
  [
    "currency unchecked",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrDrafts.ts",
    " || pack.price.currency !== \"USD\"",
    "",
    "P05"
  ],
  [
    "minimum price unchecked",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrDrafts.ts",
    " || pack.price.valueMinor < 500",
    "",
    "P05"
  ],
  [
    "delivery window extended",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrDrafts.ts",
    "integer(pack.deliveryDays, 1, 30)",
    "integer(pack.deliveryDays, 1, 365)",
    "P07"
  ],
  [
    "zero revision option",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrDrafts.ts",
    "integer(pack.revisions, 1, 10)",
    "integer(pack.revisions, 0, 10)",
    "P07"
  ],
  [
    "description unbounded",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrDrafts.ts",
    "text(p.description, 1200)",
    "text(p.description, 5000)",
    "P08"
  ],
  [
    "title bound widened",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrDrafts.ts",
    "text(p.title, 80)",
    "text(p.title, 200)",
    "P08"
  ],
  [
    "media gap hidden",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrDrafts.ts",
    "...(p.mediaDigests.length === 0 ? [\"MEDIA_MISSING\"] : []), ",
    "",
    "P09"
  ],
  [
    "rights gap hidden",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrDrafts.ts",
    "...(p.rightsEvidenceDigest === null ? [\"RIGHTS_EVIDENCE_MISSING\"] : []),",
    "",
    "P09"
  ],
  [
    "offer proof gap hidden",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrDrafts.ts",
    "...(p.offerRevision === null ? [\"FULFILLMENT_OFFER_PROOF_MISSING\"] : [])",
    "...[]",
    "P09"
  ],
  [
    "FAQ bound widened",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrDrafts.ts",
    "isAyasRevenueDataArray(p.faq, 10)",
    "isAyasRevenueDataArray(p.faq, 20)",
    "P10"
  ],
  [
    "tags bound widened",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrDrafts.ts",
    "texts(p.tags, 5, 20)",
    "texts(p.tags, 10, 20)",
    "P11"
  ],
  [
    "duplicate media accepted",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrDrafts.ts",
    " || new Set(p.mediaDigests).size !== p.mediaDigests.length",
    "",
    "P11"
  ],
  [
    "message cold outreach",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrDrafts.ts",
    "\"ORDER_REPLY\", \"REQUIREMENTS_QUESTION\", \"REVISION_REPLY\", \"DELIVERY_NOTE\"",
    "\"ORDER_REPLY\", \"REQUIREMENTS_QUESTION\", \"REVISION_REPLY\", \"DELIVERY_NOTE\", \"COLD_OUTREACH\"",
    "P14"
  ],
  [
    "message order binding omitted",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrDrafts.ts",
    " || (p.purpose !== \"REQUIREMENTS_QUESTION\" && p.orderDigest === null)",
    "",
    "P16"
  ],
  [
    "wrong platform delivery allowed",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrDrafts.ts",
    " || p.fulfillment.order.platform !== \"fiverr\"",
    "",
    "P21"
  ],
  [
    "draft commercial hash incomplete",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrDrafts.ts",
    "const draftDigest = digestAyasRevenueData(built.draft);",
    "const draftDigest = digestAyasRevenueData(operation);",
    "H10"
  ],
  [
    "handoff owner action removed",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrOwnerHandoff.ts",
    "ownerMustPerform: true, completedEvidence: null",
    "ownerMustPerform: false as never, completedEvidence: null",
    "P24"
  ],
  [
    "handoff digest unchecked",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrOwnerHandoff.ts",
    " || digestAyasRevenueData(draft.draft) !== draft.draftDigest",
    "",
    "P29"
  ],
  [
    "owner completion draft identity ignored",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrOwnerHandoff.ts",
    " || o.exactDraftDigest !== h.exactDraftDigest",
    "",
    "P31"
  ],
  [
    "owner completion handoff identity ignored",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrOwnerHandoff.ts",
    " || o.handoffId !== h.handoffId",
    "",
    "P32"
  ],
  [
    "owner completion future accepted",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrOwnerHandoff.ts",
    " || Date.parse(o.observedAt) > Date.parse(now)",
    "",
    "P33"
  ],
  [
    "owner completion prehandoff accepted",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrOwnerHandoff.ts",
    "Date.parse(o.observedAt) < Date.parse(h.createdAt)",
    "false",
    "P33"
  ],
  [
    "owner completion overwritten",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrOwnerHandoff.ts",
    " || h.completedEvidence !== null || h.completionVerification !== \"NOT_OBSERVED\"",
    "",
    "P34"
  ],
  [
    "monetary impact forgery accepted",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrOwnerHandoff.ts",
    " || h.monetaryImpact !== (h.operation === \"LISTING_CREATE\" ? \"UNKNOWN\" : \"NONE\")",
    "",
    "P35"
  ],
  [
    "owner source certification falsely upgraded",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrOwnerFacts.ts",
    "verification: \"UNVERIFIED_OWNER_REPORT\"",
    "verification: \"VERIFIED_PLATFORM\"",
    "P36"
  ],
  [
    "snapshot extra fields",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrOwnerFacts.ts",
    "!hasExactAyasRevenueKeys(p, [\"schemaVersion\", \"platform\", \"accountRef\", \"kind\", \"observedAt\", \"evidenceDigest\", \"data\"])",
    "false",
    "P39"
  ],
  [
    "owner snapshot age unchecked",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrOwnerFacts.ts",
    "Date.parse(now) - Date.parse(p.observedAt) > 86_400_000",
    "false",
    "P40"
  ],
  [
    "owner snapshot account ignored",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrOwnerFacts.ts",
    " || p.accountRef !== expectedAccountRef",
    "",
    "P40"
  ],
  [
    "owner snapshot future accepted",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrOwnerFacts.ts",
    "!past(p.observedAt, now)",
    "!isAyasRevenueTimestamp(p.observedAt)",
    "P40"
  ],
  [
    "analytics negative counts",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrOwnerFacts.ts",
    "(v as number) >= 0",
    "(v as number) >= -10",
    "P41"
  ],
  [
    "analytics window unbounded",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrOwnerFacts.ts",
    "Date.parse(data.periodEnd) - Date.parse(data.periodStart) > 31 * 86_400_000",
    "false",
    "P41"
  ],
  [
    "analytics observed timeline unbound",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrOwnerFacts.ts",
    "!past(data.periodEnd, p.observedAt)",
    "!past(data.periodEnd, now)",
    "P41"
  ],
  [
    "duplicate owner orders accepted",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrOwnerFacts.ts",
    " || new Set(data.map(o => (o as Record<string, unknown>).orderDigest)).size !== data.length",
    "",
    "P42"
  ],
  [
    "unknown fee treated as zero",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrOwnerFacts.ts",
    "add(\"PLATFORM_FEE\", p.fee, p.completedAt as string)",
    "add(\"PLATFORM_FEE\", p.fee ?? { valueMinor: 0, currency: \"USD\" }, p.completedAt as string)",
    "P44"
  ],
  [
    "pending order realizes gross",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrOwnerFacts.ts",
    "if (p.orderState === \"COMPLETED_OBSERVED\") { add",
    "if (true) { add",
    "P45"
  ],
  [
    "available balance treated as withdrawn",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrOwnerFacts.ts",
    "if (p.payoutState === \"WITHDRAWN_OBSERVED\") add",
    "if (p.payoutState !== \"NOT_OBSERVED\") add",
    "P46"
  ],
  [
    "cross currency money accepted",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrOwnerFacts.ts",
    "new Set(amounts.map(m => m.currency)).size > 1",
    "false",
    "P47"
  ],
  [
    "owner economics schema open",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrOwnerFacts.ts",
    "!hasExactAyasRevenueKeys(p, [\"schemaVersion\", \"platform\", \"source\", \"accountRef\", \"eventRefDigest\", \"orderDigest\", \"orderState\", \"completedAt\", \"gross\", \"fee\", \"payout\", \"payoutState\", \"cashMovementAt\", \"observedAt\", \"evidenceDigest\"])",
    "false",
    "P50"
  ],
  [
    "owner economics source forged",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrOwnerFacts.ts",
    " || p.source !== \"OWNER_INPUT\"",
    "",
    "P50"
  ],
  [
    "nested accessor preflight skipped",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrDrafts.ts",
    "if (!isAyasRevenueBoundedJson(raw, 65_536) || containsAyasRevenueSensitiveData(raw)) return null;",
    "if (containsAyasRevenueSensitiveData(raw)) return null;",
    "H11"
  ],
  [
    "observed withdrawal lacks evidence amount",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrOwnerFacts.ts",
    "(p.payout === null || p.cashMovementAt === null)",
    "(p.cashMovementAt === null)",
    "H07"
  ],
  [
    "quality status ignored",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrDrafts.ts",
    "result.status !== \"HANDOFF_READY\"",
    "false",
    "P20"
  ],
  [
    "cash observation precedes completed order",
    "src/lib/ayas/revenue/adapters/fiverr/AyasFiverrOwnerFacts.ts",
    " || p.cashMovementAt !== null && p.completedAt !== null && Date.parse(p.cashMovementAt as string) < Date.parse(p.completedAt as string)",
    "",
    "P50"
  ]
];
const env: NodeJS.ProcessEnv = { NODE_ENV: "test" }; for (const k of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[k]) env[k] = process.env[k];
const run = (id?: string) => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env: id ? { ...env, AYAS_REVENUE_FIVERR_MUTATION_CASE: id } : env, encoding: "utf8", windowsHide: true, timeout: 60_000, maxBuffer: 4_000_000 });
try {
  copy(test); for (const f of ["tsconfig.json", "package.json", ".gitignore", "src/lib/brain/selfheal/BrainPatchSafety.ts"]) copy(f);
  // The source guard scans the adapter directory, src and app; copy the adapter directory whole.
  for (const f of fs.readdirSync(path.join(repo, D))) copy(`${D}${f}`);
  fs.symlinkSync(fs.realpathSync(path.join(repo, "node_modules")), link, process.platform === "win32" ? "junction" : "dir");
  const baseline = run(); assert.equal(baseline.signal, null); assert.equal(baseline.status, 0, `${baseline.stdout}${baseline.stderr}`.slice(0, 8000));
  const caught: string[] = [];
  for (const [name, file, before, after, id] of mutants) {
    const target = path.join(temp, file), original = fs.readFileSync(target, "utf8"); assert.ok(original.includes(before), `${name}: exact mutation must exist`);
    let r: ReturnType<typeof run>; try { fs.writeFileSync(target, original.replaceAll(before, () => after)); r = run(id); } finally { fs.writeFileSync(target, original); }
    assert.equal(r.signal, null, `${name}: timeout`); assert.notEqual(r.status, 0, `${name}: survived`);
    assert.doesNotMatch(r.stderr, /SyntaxError|TransformError|ERR_MODULE_NOT_FOUND|Cannot find module|is not defined|is not a function/, `${name}: loader/runtime failure`);
    assert.match(r.stderr, /AssertionError|ERR_ASSERTION/, `${name}: not a captured assertion: ${r.stderr.slice(0, 600)}`); caught.push(name);
  }
  const equivalents: { name: string; reason: string; verifiedWholePrimaryHeldOutPass: boolean }[] = [];
  for (const [name, file, before, after, reason] of [["duplicate package tiers","src/lib/ayas/revenue/adapters/fiverr/AyasFiverrDrafts.ts"," || seen.has(pack.tier as string)","","consecutive tier validation independently refuses every duplicate"],["delivery requirements bypassed","src/lib/ayas/revenue/adapters/fiverr/AyasFiverrDrafts.ts","result.status !== \"HANDOFF_READY\"","[\"HANDOFF_READY\", \"REQUIREMENTS_INCOMPLETE\"].includes(result.status) === false","incomplete requirements never expose a manifest; the manifest-null refusal stays closed"]] as const) {
    const target = path.join(temp, file), original = fs.readFileSync(target, "utf8"); assert.ok(original.includes(before));
    let r: ReturnType<typeof run>; try { fs.writeFileSync(target, original.replaceAll(before, () => after)); r = run(); } finally { fs.writeFileSync(target, original); }
    assert.equal(r.signal, null); assert.equal(r.status, 0, `${name}: classified equivalent but full grader failed: ${r.stdout}${r.stderr}`);
    equivalents.push({ name, reason, verifiedWholePrimaryHeldOutPass: true });
  }
  console.log(JSON.stringify({ status: "PASS", baseline: JSON.parse(baseline.stdout), negativeControls: { total: mutants.length + 2, caught, equivalents }, noLiveIO: true }, null, 2));
} finally {
  if (fs.existsSync(link)) { if (process.platform === "win32") fs.rmdirSync(link); else fs.unlinkSync(link); }
  assert.ok(!fs.existsSync(link)); assert.equal(path.dirname(fs.realpathSync.native(temp)).toLowerCase(), parent.toLowerCase()); assert.ok(path.basename(temp).startsWith("ayas-revenue-fiverr-audit-"));
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
