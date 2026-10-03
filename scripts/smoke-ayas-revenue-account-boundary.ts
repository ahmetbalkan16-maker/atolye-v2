/**
 * Stage 16.0A evaluator — external account connection / credential boundary.
 * 24 primary + 6 frozen held-out scenarios. Pure: fixture metadata only, no credential, network or file write.
 * `AYAS_REVENUE_ACCOUNT_MUTATION_CASE=<id>` runs one scenario uncaught (negative controls).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classifyPatchTarget } from "../src/lib/brain/selfheal/BrainPatchSafety";
import type { AyasRevenueOperation } from "../src/lib/ayas/revenue/AyasRevenuePlatformTypes";
import { assessAyasRevenueConnection, gateAyasRevenueRequestConnection, isAyasRevenueAccountConnection, requiredAyasRevenueScopes, type AyasRevenueScopeMap } from "../src/lib/ayas/revenue/AyasRevenueAccountConnection";

const NOW = "2026-10-03T12:00:00.000Z", later = (ms: number) => new Date(Date.parse(NOW) + ms).toISOString(), DAY = 86_400_000;
const SELECTED = process.env.AYAS_REVENUE_ACCOUNT_MUTATION_CASE;
if (SELECTED !== undefined) {
  const cwd = fs.realpathSync.native(process.cwd());
  assert.equal(path.dirname(cwd).toLowerCase(), fs.realpathSync.native(os.tmpdir()).toLowerCase());
  assert.ok(path.basename(cwd).startsWith("ayas-revenue-account-audit-")); assert.ok(!fs.existsSync(path.join(cwd, ".git"))); assert.match(SELECTED, /^[PH]\d{2}$/);
}
const results: { id: string; set: string; ok: boolean; detail?: string }[] = [];
async function scenario(set: "primary" | "held-out", id: string, name: string, body: () => void | Promise<void>): Promise<void> {
  if (SELECTED !== undefined) { if (SELECTED === id) { await body(); results.push({ id, set, ok: true }); } return; }
  try { await body(); results.push({ id, set, ok: true }); } catch (e) { results.push({ id, set, ok: false, detail: `${name}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}` }); }
  if (process.env.SMOKE_TRACE === "1") console.log(`${results.at(-1)!.ok ? "PASS" : "FAIL"} ${id}: ${name}`);
}
const ETSY_MAP: AyasRevenueScopeMap = { LISTING_LIST_READ: ["listings_r"], ORDER_LIST_READ: ["transactions_r"], LISTING_CREATE: ["listings_w"], LISTING_UPDATE: ["listings_w"], PURCHASE: ["billing_w"] };
const ETSY_OPS: AyasRevenueOperation[] = ["LISTING_LIST_READ", "ORDER_LIST_READ", "LISTING_DRAFT", "LISTING_CREATE", "LISTING_UPDATE", "PURCHASE"];
const conn = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  schemaVersion: "1", platform: "etsy", accountRef: "acct-etsy-1", label: "Etsy shop …21", credentialHandling: "CONNECTOR_MANAGED", credentialRef: "connector:etsy-main",
  grantedScopes: ["listings_r", "listings_w", "transactions_r"], connectedAt: later(-30 * DAY), expiresAt: later(60 * DAY), lastVerifiedAt: later(-60_000), reauthRequired: false, ...patch });
const assess = (c: unknown, patch: Record<string, unknown> = {}) => assessAyasRevenueConnection(c, { now: NOW, operations: ETSY_OPS, scopeMap: ETSY_MAP, observedScopes: ["listings_r", "listings_w", "transactions_r"], ...patch } as Parameters<typeof assessAyasRevenueConnection>[1]);
const request = (patch: Record<string, unknown> = {}) => ({ requestId: "req-00000001", platform: "etsy", operation: "LISTING_LIST_READ", mode: "READ", accountRef: "acct-etsy-1", requestedAt: NOW, ...patch });
const gate = (r: unknown, c: unknown, patch: Record<string, unknown> = {}) => gateAyasRevenueRequestConnection(r, c, { now: NOW, operations: ETSY_OPS, scopeMap: ETSY_MAP, observedScopes: ["listings_r", "listings_w", "transactions_r"], ...patch } as Parameters<typeof assessAyasRevenueConnection>[1]);

async function main() {
  await scenario("primary", "P01", "a connector-managed connection with exact scopes is valid and healthy", () => {
    assert.ok(isAyasRevenueAccountConnection(conn())); const a = assess(conn());
    assert.equal(a.health, "HEALTHY"); assert.equal(a.usable, true); assert.equal(a.reauthRecommended, false); assert.equal(a.grantsAuthority, false);
  });
  await scenario("primary", "P02", "the credential reference is a holder name, never a credential value", () => {
    for (const credentialRef of ["connector:sk-proj-" + "a".repeat(24), "Bearer abcdefghijklmnop", "connector:", "connector:../etc", "vault:etsy-main"])
      assert.equal(isAyasRevenueAccountConnection(conn({ credentialRef })), false, credentialRef);
    assert.ok(isAyasRevenueAccountConnection(conn({ credentialHandling: "SERVER_SECRET", credentialRef: "vault:etsy-main" })));
  });
  await scenario("primary", "P03", "a connection always has an external credential holder from the closed set", () => {
    for (const credentialHandling of ["NONE", "INLINE", "MEMORY", ""]) assert.equal(isAyasRevenueAccountConnection(conn({ credentialHandling })), false, credentialHandling);
    assert.equal(isAyasRevenueAccountConnection(conn({ credentialHandling: "NONE", credentialRef: "null:etsy-main" })), false);
  });
  await scenario("primary", "P04", "the account reference is opaque and bounded", () => {
    for (const accountRef of ["../acct", "acct/1", "x".repeat(65), "sk-proj-" + "b".repeat(24), "", null]) assert.equal(isAyasRevenueAccountConnection(conn({ accountRef })), false, String(accountRef));
  });
  await scenario("primary", "P05", "the label is privacy-safe", () => {
    for (const label of ["owner@example.com", "Shop 4111 1111 1111 1111", "Account 1234567", "", "x".repeat(49)]) assert.equal(isAyasRevenueAccountConnection(conn({ label })), false, label);
    assert.ok(isAyasRevenueAccountConnection(conn({ label: "Upwork profile …4821" })));
  });
  await scenario("primary", "P06", "scopes are bounded, unique and never secret-shaped", () => {
    for (const grantedScopes of [["listings_r", "listings_r"], Array.from({ length: 33 }, (_, i) => `s${i}`), ["token=" + "c".repeat(20)], ["sk-proj-" + "c".repeat(24)], [""], "listings_r", [1]])
      assert.equal(isAyasRevenueAccountConnection(conn({ grantedScopes })), false, JSON.stringify(grantedScopes).slice(0, 60));
  });
  await scenario("primary", "P07", "no credential field can ride along; accessors are refused", () => {
    for (const extra of [{ accessToken: "x" }, { refreshToken: "x" }, { password: "x" }, { apiKey: "x" }]) assert.equal(isAyasRevenueAccountConnection(conn(extra)), false, Object.keys(extra)[0]);
    let read = false; const c = conn(); Object.defineProperty(c, "label", { enumerable: true, get: () => { read = true; return "Etsy"; } });
    assert.equal(isAyasRevenueAccountConnection(c), false); assert.equal(read, false);
  });
  await scenario("primary", "P08", "times are strict and ordered", () => {
    for (const patch of [{ connectedAt: "yesterday" }, { expiresAt: later(-31 * DAY) }, { expiresAt: later(-30 * DAY) }, { lastVerifiedAt: later(-31 * DAY) }, { reauthRequired: "no" }])
      assert.equal(isAyasRevenueAccountConnection(conn(patch)), false, JSON.stringify(patch));
    assert.ok(isAyasRevenueAccountConnection(conn({ expiresAt: null, lastVerifiedAt: null })));
  });
  await scenario("primary", "P09", "a connection the owner must re-authorize is not usable", () => {
    const a = assess(conn({ reauthRequired: true })); assert.equal(a.health, "REAUTH_REQUIRED"); assert.equal(a.usable, false);
  });
  await scenario("primary", "P10", "an expired connection is not usable", () => {
    for (const expiresAt of [NOW, later(-1)]) { const a = assess(conn({ expiresAt })); assert.equal(a.health, "EXPIRED"); assert.equal(a.usable, false); }
  });
  await scenario("primary", "P11", "an expiring connection stays usable and asks for re-authorization", () => {
    const a = assess(conn({ expiresAt: later(3 * DAY) })); assert.equal(a.health, "EXPIRING"); assert.equal(a.usable, true); assert.equal(a.reauthRecommended, true);
    assert.equal(assess(conn({ expiresAt: later(8 * DAY) })).health, "HEALTHY");
  });
  await scenario("primary", "P12", "a missing scope makes the connection unusable", () => {
    const a = assess(conn({ grantedScopes: ["listings_r", "listings_w"] }), { observedScopes: ["listings_r", "listings_w"] });
    assert.equal(a.health, "SCOPE_MISSING"); assert.deepEqual(a.missingScopes, ["transactions_r"]); assert.equal(a.usable, false);
  });
  await scenario("primary", "P13", "an excess scope violates least privilege", () => {
    const a = assess(conn({ grantedScopes: ["listings_r", "listings_w", "transactions_r", "shops_w"] }), { observedScopes: ["listings_r", "listings_w", "transactions_r", "shops_w"] });
    assert.equal(a.health, "SCOPE_EXCESS"); assert.deepEqual(a.excessScopes, ["shops_w"]); assert.equal(a.usable, false);
  });
  await scenario("primary", "P14", "financial operations never require or justify a scope", () => {
    assert.deepEqual(requiredAyasRevenueScopes(ETSY_OPS, ETSY_MAP).scopes, ["listings_r", "listings_w", "transactions_r"]);
    const a = assess(conn({ grantedScopes: ["billing_w", "listings_r", "listings_w", "transactions_r"] }), { observedScopes: ["billing_w", "listings_r", "listings_w", "transactions_r"] });
    assert.equal(a.health, "SCOPE_EXCESS"); assert.deepEqual(a.excessScopes, ["billing_w"]);
  });
  await scenario("primary", "P15", "scopes the platform reports differently are drift", () => {
    const added = assess(conn(), { observedScopes: ["listings_r", "listings_w", "transactions_r", "shops_w"] });
    assert.equal(added.health, "SCOPE_DRIFT"); assert.deepEqual(added.drift, { added: ["shops_w"], removed: [] }); assert.equal(added.usable, false);
    const removed = assess(conn(), { observedScopes: ["listings_r", "listings_w"] }); assert.deepEqual(removed.drift, { added: [], removed: ["transactions_r"] });
  });
  await scenario("primary", "P16", "a connection never verified against the platform is UNVERIFIED", () => {
    assert.equal(assess(conn(), { observedScopes: null }).health, "UNVERIFIED"); assert.equal(assess(conn({ lastVerifiedAt: null })).health, "UNVERIFIED");
  });
  await scenario("primary", "P17", "a stale verification is UNVERIFIED", () => {
    assert.equal(assess(conn({ lastVerifiedAt: later(-25 * 3_600_000) })).health, "UNVERIFIED"); assert.equal(assess(conn({ lastVerifiedAt: later(-23 * 3_600_000) })).health, "HEALTHY");
  });
  await scenario("primary", "P18", "a scope map that does not cover a declared read or write is UNVERIFIED", () => {
    const a = assessAyasRevenueConnection(conn(), { now: NOW, operations: [...ETSY_OPS, "ANALYTICS_READ"], scopeMap: ETSY_MAP, observedScopes: ["listings_r", "listings_w", "transactions_r"] });
    assert.equal(a.health, "UNVERIFIED"); assert.deepEqual(a.unmappedOperations, ["ANALYTICS_READ"]); assert.equal(a.usable, false);
    assert.equal(assessAyasRevenueConnection(conn(), { now: NOW, operations: ETSY_OPS, scopeMap: { ...ETSY_MAP, ORDER_LIST_READ: [] }, observedScopes: ["listings_r", "listings_w", "transactions_r"] }).health, "UNVERIFIED");
  });
  await scenario("primary", "P19", "invalid inputs are UNVERIFIED, never healthy", () => {
    for (const patch of [{ now: "now" }, { operations: ["SCRAPE"] }, { observedScopes: ["a", "a"] }]) assert.equal(assess(conn(), patch).health, "UNVERIFIED", JSON.stringify(patch));
    assert.equal(assess({ ...conn(), accessToken: "x" }).health, "UNVERIFIED");
  });
  await scenario("primary", "P20", "the request gate checks platform, account, health and the operation's scope", () => {
    assert.deepEqual(gate(request(), conn()), { gate: "CONNECTION_OK", reason: "OK", health: "HEALTHY", grantsAuthority: false });
    assert.equal(gate(request({ platform: "upwork" }), conn()).reason, "PLATFORM_MISMATCH");
    assert.equal(gate(request({ accountRef: "acct-etsy-2" }), conn()).reason, "ACCOUNT_MISMATCH");
    assert.equal(gate(request(), conn({ reauthRequired: true })).reason, "CONNECTION_NOT_USABLE");
    assert.equal(gate(request({ operation: "LISTING_CREATE", mode: "EXECUTE" }), conn({ grantedScopes: ["listings_r", "transactions_r"] }), { observedScopes: ["listings_r", "transactions_r"], operations: ["LISTING_LIST_READ", "ORDER_LIST_READ"] }).reason, "SCOPE_NOT_GRANTED");
  });
  await scenario("primary", "P21", "a local draft needs no connection", () => {
    assert.equal(gate(request({ operation: "LISTING_DRAFT", mode: "DRAFT" }), conn({ reauthRequired: true })).gate, "CONNECTION_NOT_REQUIRED");
  });
  await scenario("primary", "P22", "a financial request is refused by the gate whatever the connection", () => {
    for (const operation of ["PURCHASE", "REFUND", "FUNDS_WITHDRAW"]) assert.equal(gate(request({ operation, mode: "EXECUTE" }), conn({ grantedScopes: ["billing_w", "listings_r", "listings_w", "transactions_r"] })).reason, "FINANCIAL_NOT_AUTONOMOUS");
  });
  await scenario("primary", "P23", "the gate never trusts a caller-made assessment and refuses invalid requests", () => {
    assert.equal(gate({ ...request(), cursor: "sk-proj-" + "d".repeat(24) }, conn()).reason, "INVALID");
    assert.equal(gate(request(), { ...conn(), usable: true }).reason, "INVALID");
    assert.equal(gate(request(), conn({ expiresAt: later(-1) })).reason, "CONNECTION_NOT_USABLE");
  });
  await scenario("primary", "P24", "the account boundary module imports no authority, network, process or file access and cannot rewrite itself", () => {
    const file = "src/lib/ayas/revenue/AyasRevenueAccountConnection.ts", source = fs.readFileSync(file, "utf8");
    for (const m of source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) assert.match(m[1]!, /^\.\/AyasRevenue[A-Za-z]+$/, m[1]);
    assert.doesNotMatch(source, /(?<![.\w])fetch\s*\(|https?:\/\/|child_process|process\.env|node:fs|require\(|localStorage|WebSocket/);
    for (const p of [file, "scripts/smoke-ayas-revenue-account-boundary.ts", "scripts/smoke-ayas-revenue-account-boundary-mutations.ts"]) assert.equal(classifyPatchTarget(p).level, "FORBIDDEN_AUTONOMOUS", p);
  });

  /* ------------------------------------------------- frozen held-out --- */
  await scenario("held-out", "H01", "Upwork connector with exact scopes is usable for its reads", () => {
    const map: AyasRevenueScopeMap = { OPPORTUNITY_LIST_READ: ["jobs:read"], PROPOSAL_SUBMIT: ["proposals:write"] };
    const c = conn({ platform: "upwork", accountRef: "acct-up-1", label: "Upwork …77", credentialRef: "connector:upwork-mcp", grantedScopes: ["jobs:read", "proposals:write"] });
    const g = gateAyasRevenueRequestConnection(request({ platform: "upwork", operation: "OPPORTUNITY_LIST_READ", accountRef: "acct-up-1" }), c, { now: NOW, operations: ["OPPORTUNITY_LIST_READ", "PROPOSAL_DRAFT", "PROPOSAL_SUBMIT"], scopeMap: map, observedScopes: ["jobs:read", "proposals:write"] });
    assert.equal(g.gate, "CONNECTION_OK");
  });
  await scenario("held-out", "H02", "Etsy server-secret connection expiring tomorrow still reads", () => {
    const c = conn({ credentialHandling: "SERVER_SECRET", credentialRef: "vault:etsy-shop", expiresAt: later(DAY) });
    assert.equal(assess(c).health, "EXPIRING"); assert.equal(gate(request(), c).gate, "CONNECTION_OK");
  });
  await scenario("held-out", "H03", "Lemon Squeezy refunds scope is excess", () => {
    const map: AyasRevenueScopeMap = { ORDER_LIST_READ: ["orders:read"], REFUND: ["refunds:write"] };
    const a = assessAyasRevenueConnection(conn({ platform: "lemon-squeezy", accountRef: "acct-ls-1", label: "Store …02", credentialRef: "connector:lemon", grantedScopes: ["orders:read", "refunds:write"] }),
      { now: NOW, operations: ["ORDER_LIST_READ", "REFUND"], scopeMap: map, observedScopes: ["orders:read", "refunds:write"] });
    assert.equal(a.health, "SCOPE_EXCESS"); assert.deepEqual(a.excessScopes, ["refunds:write"]);
  });
  await scenario("held-out", "H04", "Udemy scopes reduced by the platform are drift", () => {
    const map: AyasRevenueScopeMap = { ANALYTICS_READ: ["courses:read", "reports:read"] };
    const a = assessAyasRevenueConnection(conn({ platform: "udemy", accountRef: "acct-ud-1", label: "Instructor …9", credentialRef: "vault:udemy", credentialHandling: "SERVER_SECRET", grantedScopes: ["courses:read", "reports:read"] }),
      { now: NOW, operations: ["ANALYTICS_READ", "COURSE_DRAFT"], scopeMap: map, observedScopes: ["courses:read"] });
    assert.equal(a.health, "SCOPE_DRIFT"); assert.deepEqual(a.drift?.removed, ["reports:read"]);
  });
  await scenario("held-out", "H05", "a server-secret connection cannot name a connector holder", () => {
    assert.equal(isAyasRevenueAccountConnection(conn({ platform: "fiverr", credentialHandling: "SERVER_SECRET", credentialRef: "connector:fiverr" })), false);
  });
  await scenario("held-out", "H06", "a label carrying a contact address is refused", () => {
    assert.equal(isAyasRevenueAccountConnection(conn({ label: "Shop of buyer@example.com" })), false);
  });

  if (SELECTED !== undefined) { assert.equal(results.length, 1, `unknown case ${SELECTED}`); console.log(`case ${SELECTED}: PASS`); return; }
  for (const r of results) if (!r.ok) console.log(`FAIL ${r.id} ${r.detail ?? ""}`);
  const tally = (set: string) => ({ pass: results.filter((r) => r.set === set && r.ok).length, total: results.filter((r) => r.set === set).length });
  const primary = tally("primary"), heldOut = tally("held-out"), pass = results.every((r) => r.ok) && primary.total === 24 && heldOut.total === 6;
  console.log(`Stage 16.0A revenue account boundary: ${pass ? "PASS" : "FAIL"} (${primary.pass}/${primary.total} primary, ${heldOut.pass}/${heldOut.total} held-out; metadata only)`);
  console.log(JSON.stringify({ status: pass ? "PASS" : "FAIL", suite: "ayas-revenue-account-boundary", primary, heldOut, credentials: "NONE", network: "NONE" }));
  process.exitCode = pass ? 0 : 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
