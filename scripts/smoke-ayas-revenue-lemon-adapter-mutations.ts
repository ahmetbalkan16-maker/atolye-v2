/** Exact source mutations; every counterfactual must load and fail its named assertion in the whole grader. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const repo = process.cwd(), parent = fs.realpathSync.native(os.tmpdir()), temp = fs.mkdtempSync(path.join(parent, "ayas-lemon-audit-")), link = path.join(temp, "node_modules"), copied = new Set<string>();
function copy(file: string) {
  if (copied.has(file)) return; copied.add(file); const target = path.join(temp, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(repo, file), target);
  if (!/\.tsx?$/.test(file)) return;
  for (const m of fs.readFileSync(target, "utf8").matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]/g)) {
    const base = path.resolve(path.dirname(path.join(repo, file)), m[1]!); const found = [base, base + ".ts", base + ".tsx", base + ".json", path.join(base, "index.ts")].find(f => fs.existsSync(f) && fs.statSync(f).isFile());
    if (found) { const rel = path.relative(repo, found).replace(/\\/g, "/"); assert.ok(!rel.startsWith("..") && !path.isAbsolute(rel)); copy(rel); }
  }
}
const A = "scripts/smoke-ayas-revenue-lemon-adapter.ts";
const mutants: readonly (readonly [string, string, string, string, string, string])[] = [
  [
    "owner policy default opens",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSqueezyAdapter.ts",
    "options.ownerReadPolicyApproved ?? (() => false)",
    "options.ownerReadPolicyApproved ?? (() => true)",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P05"
  ],
  [
    "cost default opens",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSqueezyAdapter.ts",
    "options.zeroCostQualified ?? (() => false)",
    "options.zeroCostQualified ?? (() => true)",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P06"
  ],
  [
    "LIVE owner policy removed",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSqueezyAdapter.ts",
    " || (mode === \"LIVE\" && live() !== true)",
    "",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P07"
  ],
  [
    "invented platform scopes accepted",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSqueezyAdapter.ts",
    " || c.grantedScopes.length !== 0",
    "",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P10"
  ],
  [
    "request account ignored",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSqueezyAdapter.ts",
    "r.accountRef !== accountRef || ",
    "",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P11"
  ],
  [
    "expiration ignored",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSqueezyAdapter.ts",
    " || c.expiresAt <= at",
    "",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P12"
  ],
  [
    "expiration required removed",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSqueezyAdapter.ts",
    "c.expiresAt === null || ",
    "",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P13"
  ],
  [
    "stale metadata accepted",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSqueezyAdapter.ts",
    "Date.parse(at) - Date.parse(c.lastVerifiedAt) > AYAS_REVENUE_CONNECTION_LIMITS.verificationMaxAgeMs",
    "false",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P14"
  ],
  [
    "reauth ignored",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSqueezyAdapter.ts",
    "c.reauthRequired || ",
    "",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P15"
  ],
  [
    "connector mode evidence ignored",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSqueezyAdapter.ts",
    "mode === \"TEST\" ? state !== \"TEST_CONNECTED\" : ![\"LIVE_READ_ONLY\", \"LIVE_WRITE_SCOPED\"].includes(state)",
    "false",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P17"
  ],
  [
    "post-await connection changed accepted",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSqueezyAdapter.ts",
    "if (gate(now()) !== captured) throw Error(\"CONNECTION_CHANGED\");",
    "",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P18"
  ],
  [
    "cross store accepted",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSchemas.ts",
    "directStore && lemonId(a.store_id) !== input.storeRef",
    "false",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P19"
  ],
  [
    "test mode confusion accepted",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSchemas.ts",
    "a.test_mode !== (input.mode === \"TEST\")",
    "false",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P20"
  ],
  [
    "old quote qualified",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSchemas.ts",
    "quoteQualification: \"CURRENCY_AND_CURRENTNESS_UNQUALIFIED\"",
    "quoteQualification: \"QUALIFIED\"",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P24"
  ],
  [
    "page size bound widened",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSqueezyAdapter.ts",
    "lemonInteger(limit, 1, 25)",
    "lemonInteger(limit, 1, 100)",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P29"
  ],
  [
    "cursor format incompatible",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSqueezyAdapter.ts",
    "`${scopeDigest}-p${page + 1}`",
    "`${scopeDigest}:p${page + 1}`",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P30"
  ],
  [
    "next foreign host accepted",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSqueezyAdapter.ts",
    "u.origin !== AYAS_LEMON_HOST",
    "false",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P31"
  ],
  [
    "next wrong store accepted",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSqueezyAdapter.ts",
    "u.searchParams.get(\"filter[store_id]\") !== storeRef",
    "false",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P32"
  ],
  [
    "JSON API version ignored",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSqueezyAdapter.ts",
    " || body.jsonapi.version !== \"1.0\"",
    "",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P33"
  ],
  [
    "duplicate identity accepted",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSqueezyAdapter.ts",
    " || new Set(items.map(x => x?.resourceRef)).size !== items.length",
    "",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P34"
  ],
  [
    "backoff ignored",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSqueezyAdapter.ts",
    "clock < nextAllowed",
    "false",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P35"
  ],
  [
    "Retry After ignored",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSqueezyAdapter.ts",
    "Math.max(backoff, Math.min(86_400_000, seconds || date || 0))",
    "backoff",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P36"
  ],
  [
    "parent budget ignored",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSqueezyAdapter.ts",
    "if (remainingBudget <= 0) throw Error(\"RATE_LIMITED\");",
    "",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P37"
  ],
  [
    "product publication opens",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonCheckoutPolicy.ts",
    "publication: \"CLOSED\"",
    "publication: \"OPEN\"",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P40"
  ],
  [
    "owner product review removed",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonCheckoutPolicy.ts",
    "ownerReviewRequired: true",
    "ownerReviewRequired: false",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P40"
  ],
  [
    "rights gaps hidden",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonCheckoutPolicy.ts",
    "if (p.rightsEvidenceDigest === null) issues.push(\"RIGHTS_EVIDENCE_MISSING\");",
    "",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P41"
  ],
  [
    "fulfillment offer incomplete accepted",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonCheckoutPolicy.ts",
    "offer.status !== \"OWNER_REVIEW_READY\" || ",
    "",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P42"
  ],
  [
    "checkout creation opens",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonCheckoutPolicy.ts",
    "checkoutCreation: \"CLOSED\"",
    "checkoutCreation: \"OPEN\"",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P43"
  ],
  [
    "missing source reads accepted",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonCheckoutPolicy.ts",
    " || p.sourceReadDigests.length !== 3 || !p.sourceReadDigests.every(isAyasRevenueDigest) || new Set(p.sourceReadDigests).size !== 3",
    " || !p.sourceReadDigests.every(isAyasRevenueDigest)",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P44"
  ],
  [
    "subscription renewal unbounded",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonCheckoutPolicy.ts",
    "lemonInteger(p.renewalCount, 1, 12)",
    "lemonInteger(p.renewalCount, 0, 100)",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P45"
  ],
  [
    "delivery QA ignored",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonCheckoutPolicy.ts",
    "if (f.status !== \"HANDOFF_READY\" || f.deliveryManifest === null) return null;",
    "",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P46"
  ],
  [
    "signature check ignored",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonWebhook.ts",
    "if (!timingSafeEqual(expected, Buffer.from(signature, \"hex\"))) return null;",
    "",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P50"
  ],
  [
    "signed body header mismatch ignored",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonWebhook.ts",
    " || body.meta.event_name !== event",
    "",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P52"
  ],
  [
    "delivery replay ignored",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonWebhook.ts",
    "seen.includes(eventDigest)",
    "false",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P53"
  ],
  [
    "unknown event expanded",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonWebhook.ts",
    "order_created: \"orders\", order_refunded: \"orders\",",
    "order_created: \"orders\", order_refunded: \"orders\", discount_created: \"orders\",",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P54"
  ],
  [
    "webhook store ignored",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonWebhook.ts",
    "lemonId(a.store_id) !== binding.storeRef",
    "false",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P55"
  ],
  [
    "webhook mode ignored",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonWebhook.ts",
    "body.data.type !== \"license-keys\" && a.test_mode !== (binding.mode === \"TEST\")",
    "false",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P56"
  ],
  [
    "canonical API reread optional",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonWebhook.ts",
    "canonicalApiReadRequired: true",
    "canonicalApiReadRequired: false",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P49"
  ],
  [
    "webhook writes ledger",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonWebhook.ts",
    "writesLedger: false",
    "writesLedger: true",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P49"
  ],
  [
    "webhook authority opens",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonWebhook.ts",
    "authority: \"NONE\"",
    "authority: \"EXECUTE\"",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P49"
  ],
  [
    "TEST sales realized",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonMapper.ts",
    "if (d.mode === \"TEST\")",
    "if (false)",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P59"
  ],
  [
    "MoR tax treated as merchant gross",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonMapper.ts",
    "(p.totalMinor as number) - (p.taxMinor as number)",
    "(p.totalMinor as number)",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P60"
  ],
  [
    "unknown platform fee hidden",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonMapper.ts",
    "\"PLATFORM_FEE_UNKNOWN\"",
    "\"PLATFORM_FEE_ZERO\"",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P60"
  ],
  [
    "pending order revenue",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonMapper.ts",
    "[\"paid\", \"refunded\", \"partial_refund\"].includes(p.status as string)",
    "[\"pending\", \"failed\", \"paid\", \"refunded\", \"partial_refund\", \"fraudulent\"].includes(p.status as string)",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P61"
  ],
  [
    "partial refund asserted known",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonMapper.ts",
    "p.status === \"refunded\" && p.refundedMinor === p.totalMinor && p.refundedAt !== null",
    "p.refundedMinor !== null",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P63"
  ],
  [
    "initial invoice double counted",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonMapper.ts",
    "p.type === \"subscription-invoices\" && p.billingReason === \"initial\"",
    "false",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P65"
  ],
  [
    "product unproved artifacts",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonCheckoutPolicy.ts",
    "!p.deliverableDigests.every(d => proofs.some(x => x.artifactDigest === d) && portfolio.some(x => x.artifactDigest === d))",
    "false",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P69"
  ],
  [
    "product price drifts",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonCheckoutPolicy.ts",
    "digestAyasRevenueData(p.price) !== digestAyasRevenueData(offer.offer.priceScenario.amount)",
    "false",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P70"
  ],
  [
    "pagination missing rows hidden",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSqueezyAdapter.ts",
    "meta.lastPage !== Math.max(1, Math.ceil(meta.total / limit))",
    "false",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P73"
  ],
  [
    "observed lower rate ceiling ignored",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSqueezyAdapter.ts",
    "if (ceiling !== undefined) nextAllowed = Math.max(nextAllowed, clock + Math.ceil(180_000 / Number(ceiling)));",
    "",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P74"
  ],
  [
    "key lifetime unchecked",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSqueezyAdapter.ts",
    " || Date.parse(c.expiresAt) - Date.parse(c.connectedAt) > 366 * 86_400_000",
    "",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P75"
  ],
  [
    "next resource path unchecked",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSqueezyAdapter.ts",
    "u.pathname !== `/v1/${type}`",
    "false",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P78"
  ],
  [
    "inflight concurrent calls admitted",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSqueezyAdapter.ts",
    "inFlight || ",
    "",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P80"
  ],
  [
    "duplicate response header ambiguity",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSqueezyAdapter.ts",
    "if (new Set(entries.map(x => x[0])).size !== entries.length) throw Error(\"HEADERS_INVALID\");",
    "",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P81"
  ],
  [
    "future fact accepted",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSchemas.ts",
    " || updatedAt > input.observedAt",
    "",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "H10"
  ],
  [
    "fractional money accepted",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSchemas.ts",
    "!lemonInteger(a.total)",
    "typeof a.total !== \"number\"",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "H06"
  ],
  [
    "page cardinality mismatch accepted",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonSqueezyAdapter.ts",
    "items.length !== Math.min(limit, Math.max(0, meta.total - (page - 1) * limit))",
    "false",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P83"
  ],
  [
    "zero decimal cents treated as native minor",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonMapper.ts",
    "if ([\"JPY\", \"KRW\"].includes(p.currency))",
    "if (false)",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P85"
  ],
  [
    "canonical pointer store mismatch ignored",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonWebhook.ts",
    "!== pointer.storeRefDigest",
    "!== d.storeRefDigest",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P88"
  ],
  [
    "canonical refresh claims ledger commit",
    "src/lib/ayas/revenue/adapters/lemon/AyasLemonWebhook.ts",
    "ledgerCommit: \"PENDING_EXPLICIT_STAGE16_2_CALLER\"",
    "ledgerCommit: \"COMMITTED\"",
    "scripts/smoke-ayas-revenue-lemon-adapter.ts",
    "P86"
  ]
];

const env: NodeJS.ProcessEnv = { NODE_ENV: "test" }; for (const k of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[k]) env[k] = process.env[k];
const run = (script: string) => spawnSync(process.execPath, ["--import", "tsx", script], { cwd: temp, env, encoding: "utf8", windowsHide: true, timeout: 60_000, maxBuffer: 6_000_000 });
try {
  copy(A); copy("tsconfig.json"); copy("package.json"); fs.symlinkSync(fs.realpathSync(path.join(repo, "node_modules")), link, process.platform === "win32" ? "junction" : "dir");
  const baselines = [A].map(script => { const r = run(script); assert.equal(r.status, 0, r.stdout + r.stderr); return JSON.parse(r.stdout); });
  const caught: { name: string; grader: string; assertion: string; failedAssertions: string[] }[] = [];
  for (const [name, file, before, after, grader, id] of mutants) {
    const target = path.join(temp, file), original = fs.readFileSync(target, "utf8"); assert.ok(original.includes(before), `${name}: missing exact anchor`);
    let r: ReturnType<typeof run>; try { fs.writeFileSync(target, original.replaceAll(before, () => after)); r = run(grader); } finally { fs.writeFileSync(target, original); }
    assert.equal(r.signal, null, `${name}: timeout`); assert.equal(r.status, 1, `${name}: survived or loader failed: ${r.stderr}`);
    assert.equal(r.stderr, "", `${name}: runtime/loader output`);
    const report = JSON.parse(r.stdout), failed = report.results.filter((x: { ok: boolean }) => !x.ok);
    assert.ok(failed.some((x: { id: string; failureKind: string }) => x.id === id && x.failureKind === "ASSERTION"), `${name}: named assertion did not catch: ${JSON.stringify(failed.map((x: { id: string; failureKind: string }) => ({ id: x.id, kind: x.failureKind })))}`);
    assert.ok(failed.every((x: { failureKind: string }) => x.failureKind === "ASSERTION"), `${name}: runtime failure is not assertion evidence`);
    caught.push({ name, grader, assertion: id, failedAssertions: failed.map((x: { id: string }) => x.id) });
  }
  console.log(JSON.stringify({ status: "PASS", baselines, negativeControls: { total: mutants.length, caught, equivalents: [] }, noLiveIO: true }));
} finally {
  if (fs.existsSync(link)) { if (process.platform === "win32") fs.rmdirSync(link); else fs.unlinkSync(link); }
  assert.ok(!fs.existsSync(link)); assert.equal(path.dirname(fs.realpathSync.native(temp)).toLowerCase(), parent.toLowerCase()); assert.ok(path.basename(temp).startsWith("ayas-lemon-audit-"));
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
