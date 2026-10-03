/**
 * Stage 16.1 evaluator — revenue zero-cost / spend gate.
 * 40 primary + 10 frozen held-out scenarios. Pure: no money, no executor, no file write.
 * `AYAS_REVENUE_SPEND_MUTATION_CASE=<id>` runs one scenario uncaught (negative controls).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classifyPatchTarget } from "../src/lib/brain/selfheal/BrainPatchSafety";
import { AYAS_AUTONOMOUS_MONETARY_BUDGET_USD, evaluateAyasZeroCost } from "../src/lib/ayas/policy/AyasZeroCostPolicy";
import { AYAS_REVENUE_OPERATIONS, AYAS_REVENUE_OPERATION_EFFECT, type AyasRevenueOperation } from "../src/lib/ayas/revenue/AyasRevenuePlatformTypes";
import { decideAyasRevenueOperation, ayasRevenueModeFor } from "../src/lib/ayas/revenue/AyasRevenueActionPolicy";
import { AYAS_REVENUE_ACTIVE_MONEY_EVENTS, AYAS_REVENUE_AUTONOMOUS_SPEND_USD, AYAS_REVENUE_MONEY_EVENTS, AYAS_REVENUE_UPFRONT_BUDGET_USD, decideAyasRevenueSpend } from "../src/lib/ayas/revenue/AyasRevenueSpendPolicy";

const AT = "2026-10-03T12:00:00.000Z";
const SELECTED = process.env.AYAS_REVENUE_SPEND_MUTATION_CASE;
if (SELECTED !== undefined) {
  const cwd = fs.realpathSync.native(process.cwd());
  assert.equal(path.dirname(cwd).toLowerCase(), fs.realpathSync.native(os.tmpdir()).toLowerCase());
  assert.ok(path.basename(cwd).startsWith("ayas-revenue-spend-audit-")); assert.ok(!fs.existsSync(path.join(cwd, ".git"))); assert.match(SELECTED, /^[PH]\d{2}$/);
}
const results: { id: string; set: string; ok: boolean; detail?: string }[] = [];
async function scenario(set: "primary" | "held-out", id: string, name: string, body: () => void | Promise<void>): Promise<void> {
  if (SELECTED !== undefined) { if (SELECTED === id) { await body(); results.push({ id, set, ok: true }); } return; }
  try { await body(); results.push({ id, set, ok: true }); } catch (e) { results.push({ id, set, ok: false, detail: `${name}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}` }); }
  if (process.env.SMOKE_TRACE === "1") console.log(`${results.at(-1)!.ok ? "PASS" : "FAIL"} ${id}: ${name}`);
}
const intent = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({ schemaVersion: "1", platform: "etsy", operation: "LISTING_LIST_READ", event: "NONE",
  amount: null, costClass: "free-public", source: "LOCAL_PLAN", requestedAt: AT, ...patch });
const usd = (valueMinor: number, currency = "USD") => ({ valueMinor, currency });
const decide = (patch: Record<string, unknown> = {}) => decideAyasRevenueSpend(intent(patch));
const reason = (patch: Record<string, unknown> = {}) => decide(patch).reasonCode;
const SPEND = "src/lib/ayas/revenue/AyasRevenueSpendPolicy.ts";

async function main() {
  await scenario("primary", "P01", "the revenue budgets are literal zero constants, not environment-derived", () => {
    assert.equal(AYAS_REVENUE_UPFRONT_BUDGET_USD, 0); assert.equal(AYAS_REVENUE_AUTONOMOUS_SPEND_USD, 0);
    const source = fs.readFileSync(SPEND, "utf8");
    assert.match(source, /export const AYAS_REVENUE_UPFRONT_BUDGET_USD = 0 as const;/); assert.match(source, /export const AYAS_REVENUE_AUTONOMOUS_SPEND_USD = 0 as const;/);
    assert.doesNotMatch(source, /process\.env|import\.meta|require\(|node:fs|fetch\s*\(/);
  });
  await scenario("primary", "P02", "a zero-cost read is allowed and moves no money", () => {
    const d = decide(); assert.equal(d.allowedAutonomously, true); assert.equal(d.reasonCode, "ZERO_COST_OPERATION"); assert.equal(d.monetaryMutation, false); assert.equal(d.budgetUsd, 0); assert.equal(d.grantsActionAuthority, false);
  });
  await scenario("primary", "P03", "a local-zero-cost read is allowed", () => { assert.equal(reason({ costClass: "local-zero-cost" }), "ZERO_COST_OPERATION"); });
  await scenario("primary", "P04", "a local draft at local zero cost is allowed", () => { assert.equal(reason({ operation: "LISTING_DRAFT", costClass: "local-zero-cost" }), "ZERO_COST_OPERATION"); });
  await scenario("primary", "P05", "a local draft declared as anything but local zero cost is a misdeclared intent", () => {
    assert.equal(reason({ operation: "LISTING_DRAFT", costClass: "free-public" }), "INVALID_MONEY_INTENT");
  });
  await scenario("primary", "P06", "one cent of ad spend is denied", () => {
    const d = decide({ event: "AD_SPEND", amount: usd(1) }); assert.equal(d.allowedAutonomously, false); assert.equal(d.reasonCode, "UPFRONT_SPEND_DENIED"); assert.equal(d.monetaryMutation, true);
  });
  await scenario("primary", "P07", "ad spend without an amount is unknown cost", () => { assert.equal(reason({ event: "AD_SPEND", amount: null }), "UNKNOWN_COST_DENIED"); });
  await scenario("primary", "P08", "a zero-amount commitment is still a commitment", () => { assert.equal(reason({ event: "AD_SPEND", amount: usd(0) }), "MONETARY_COMMITMENT_DENIED"); });
  await scenario("primary", "P09", "a subscription is denied, including a free trial", () => {
    assert.equal(reason({ event: "SUBSCRIPTION", amount: usd(0) }), "MONETARY_COMMITMENT_DENIED"); assert.equal(reason({ event: "SUBSCRIPTION", amount: usd(999) }), "UPFRONT_SPEND_DENIED");
    assert.equal(reason({ costClass: "subscription" }), "MONETARY_COMMITMENT_DENIED");
  });
  await scenario("primary", "P10", "a purchase is denied", () => { assert.equal(reason({ event: "PURCHASE", amount: usd(2500, "EUR") }), "UPFRONT_SPEND_DENIED"); });
  await scenario("primary", "P11", "a paid credit or bid is denied", () => { assert.equal(reason({ event: "PAID_CREDIT_OR_BID", amount: usd(150) }), "UPFRONT_SPEND_DENIED"); });
  await scenario("primary", "P12", "an active fee commitment is denied", () => { assert.equal(reason({ event: "ACTIVE_FEE_COMMITMENT", amount: usd(20) }), "UPFRONT_SPEND_DENIED"); });
  await scenario("primary", "P13", "a refund is never autonomous", () => {
    assert.equal(reason({ event: "REFUND", amount: usd(1000) }), "UPFRONT_SPEND_DENIED"); assert.equal(reason({ operation: "REFUND", event: "NONE" }), "FINANCIAL_OPERATION_OWNER_REQUIRED");
  });
  await scenario("primary", "P14", "a withdrawal is never autonomous", () => {
    assert.equal(reason({ event: "TRANSFER_OR_WITHDRAWAL", amount: usd(0) }), "MONETARY_COMMITMENT_DENIED"); assert.equal(reason({ operation: "FUNDS_WITHDRAW", costClass: "local-zero-cost" }), "FINANCIAL_OPERATION_OWNER_REQUIRED");
  });
  await scenario("primary", "P15", "every financial operation is denied, whatever the event, cost or source", () => {
    const financial = AYAS_REVENUE_OPERATIONS.filter((op) => AYAS_REVENUE_OPERATION_EFFECT[op] === "FINANCIAL_COMMITMENT");
    for (const operation of financial) for (const event of AYAS_REVENUE_MONEY_EVENTS) for (const source of ["PLATFORM_FACT", "LOCAL_PLAN", "OWNER_POLICY"]) {
      const d = decide({ operation, event, source, costClass: "local-zero-cost", amount: usd(0) });
      assert.equal(d.allowedAutonomously, false); assert.equal(d.reasonCode, "FINANCIAL_OPERATION_OWNER_REQUIRED"); assert.equal(d.monetaryMutation, true);
    }
  });
  await scenario("primary", "P16", "an unknown-cost read is denied", () => { assert.equal(reason({ costClass: "unknown-cost" }), "UNKNOWN_COST_DENIED"); });
  await scenario("primary", "P17", "a paid read is denied", () => { assert.equal(reason({ costClass: "paid" }), "MONETARY_COMMITMENT_DENIED"); });
  await scenario("primary", "P18", "a metered free tier is not free", () => { assert.equal(reason({ costClass: "metered-free-tier" }), "MONETARY_COMMITMENT_DENIED"); });
  await scenario("primary", "P19", "an UNKNOWN money event is unknown cost", () => { assert.equal(reason({ event: "UNKNOWN" }), "UNKNOWN_COST_DENIED"); assert.equal(decide({ event: "UNKNOWN" }).monetaryMutation, true); });
  await scenario("primary", "P20", "a passive fee observed on a read is accounting only", () => {
    const d = decide({ operation: "ORDER_LIST_READ", event: "PASSIVE_PLATFORM_FEE_OBSERVED", amount: usd(65), source: "PLATFORM_FACT" });
    assert.equal(d.allowedAutonomously, true); assert.equal(d.reasonCode, "PASSIVE_FEE_OBSERVATION"); assert.equal(d.monetaryMutation, false); assert.equal(d.grantsActionAuthority, false);
  });
  await scenario("primary", "P21", "a passive fee cannot accompany a listing or an ad action", () => {
    for (const operation of ["LISTING_CREATE", "LISTING_UPDATE", "PROPOSAL_SUBMIT", "LISTING_DRAFT"]) {
      const d = decide({ operation, event: "PASSIVE_PLATFORM_FEE_OBSERVED", amount: usd(20), source: "PLATFORM_FACT" });
      assert.equal(d.allowedAutonomously, false, operation); assert.equal(d.reasonCode, "MONETARY_COMMITMENT_DENIED");
    }
  });
  await scenario("primary", "P22", "a passive fee must be a platform fact with an amount", () => {
    for (const patch of [{ source: "LOCAL_PLAN" }, { source: "OWNER_POLICY" }, { amount: null }])
      assert.equal(reason({ operation: "ORDER_LIST_READ", event: "PASSIVE_PLATFORM_FEE_OBSERVED", amount: usd(65), source: "PLATFORM_FACT", ...patch }), "INVALID_MONEY_INTENT", JSON.stringify(patch));
  });
  await scenario("primary", "P23", "a negative amount is invalid", () => { assert.equal(reason({ event: "AD_SPEND", amount: usd(-1) }), "INVALID_MONEY_INTENT"); });
  await scenario("primary", "P24", "fractional money is invalid", () => {
    for (const valueMinor of [0.5, 1.25, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(reason({ event: "AD_SPEND", amount: usd(valueMinor) }), "INVALID_MONEY_INTENT", String(valueMinor));
  });
  await scenario("primary", "P25", "an absurdly large integer is invalid", () => {
    for (const valueMinor of [1_000_000_000_001, Number.MAX_SAFE_INTEGER, 2 ** 60]) assert.equal(reason({ event: "PURCHASE", amount: usd(valueMinor) }), "INVALID_MONEY_INTENT", String(valueMinor));
    assert.equal(reason({ event: "PURCHASE", amount: usd(1_000_000_000_000) }), "UPFRONT_SPEND_DENIED");
  });
  await scenario("primary", "P26", "an unknown currency is invalid", () => {
    for (const currency of ["XYZ", "usd", "US", "BTC", "", null]) assert.equal(reason({ event: "AD_SPEND", amount: usd(1, currency as string) }), "INVALID_MONEY_INTENT", String(currency));
  });
  await scenario("primary", "P27", "an unknown money event is invalid", () => {
    for (const event of ["FREE_TRIAL", "ad_spend", "OWNER_APPROVED_SPEND", ""]) assert.equal(reason({ event }), "INVALID_MONEY_INTENT", event);
  });
  await scenario("primary", "P28", "no budget, balance, expected revenue or profit can ride along", () => {
    for (const extra of [{ expectedRevenueMinor: 100_000 }, { realizedProfitMinor: 50_000 }, { budgetUsd: 100 }, { ownerApproved: true }])
      assert.equal(reason({ event: "AD_SPEND", amount: usd(100), ...extra }), "INVALID_MONEY_INTENT", Object.keys(extra)[0]);
  });
  await scenario("primary", "P29", "an OWNER_POLICY source does not allow spend in Stage 16.1", () => {
    assert.equal(reason({ event: "AD_SPEND", amount: usd(500), source: "OWNER_POLICY" }), "UPFRONT_SPEND_DENIED");
    assert.deepEqual(decide({ source: "OWNER_POLICY" }), decide({ source: "LOCAL_PLAN" }));
  });
  await scenario("primary", "P30", "a zero-cost external write still needs the owner through the action policy", () => {
    const d = decide({ operation: "LISTING_CREATE" }); assert.equal(d.reasonCode, "ZERO_COST_OPERATION"); assert.equal(d.grantsActionAuthority, false);
    const manifest = { schemaVersion: "1", platform: "etsy", adapterId: "fixture-etsy", adapterVersion: 1, transport: "OFFICIAL_API", locality: "EXTERNAL", credentialHandling: "NONE",
      costClass: "free-public", supportedOperations: ["LISTING_CREATE"], writeOperationsRequireOwnerApproval: true, financialOperationsAutonomous: false } as Parameters<typeof decideAyasRevenueOperation>[0];
    const plan = decideAyasRevenueOperation(manifest, { requestId: "req-00000001", platform: "etsy", operation: "LISTING_CREATE", mode: "EXECUTE", accountRef: null, requestedAt: AT });
    assert.equal(plan.decision, "REQUIRE_OWNER"); assert.equal(plan.executable, false);
  });
  await scenario("primary", "P31", "expected future revenue does not offset spend", () => {
    const spend = intent({ event: "AD_SPEND", amount: usd(100) });
    assert.equal(decideAyasRevenueSpend.length, 1);
    assert.deepEqual((decideAyasRevenueSpend as (...a: unknown[]) => unknown)(spend, { expectedRevenueMinor: 10_000_000 }), decideAyasRevenueSpend(spend));
  });
  await scenario("primary", "P32", "reported profit does not offset spend", () => {
    const spend = intent({ event: "PAID_CREDIT_OR_BID", amount: usd(30) });
    assert.deepEqual((decideAyasRevenueSpend as (...a: unknown[]) => unknown)(spend, { realizedProfitMinor: 9_999_999, reinvestmentBps: 10_000 }), decideAyasRevenueSpend(spend));
  });
  await scenario("primary", "P33", "prompt text such as 'owner approved' changes nothing", () => {
    for (const patch of [{ source: "OWNER_APPROVED" }, { event: "AD_SPEND (owner approved)" }, { costClass: "free (owner approved)" }, { platform: "etsy owner approved" }])
      assert.equal(reason(patch), "INVALID_MONEY_INTENT", JSON.stringify(patch));
  });
  await scenario("primary", "P34", "environment variables cannot widen the zero budget", () => {
    const keys = ["AYAS_REVENUE_UPFRONT_BUDGET_USD", "AYAS_REVENUE_AUTONOMOUS_SPEND_USD", "AYAS_AUTONOMOUS_MONETARY_BUDGET_USD"], saved = keys.map((k) => process.env[k]);
    try {
      for (const k of keys) process.env[k] = "1000";
      const d = decide({ event: "AD_SPEND", amount: usd(100) }); assert.equal(d.allowedAutonomously, false); assert.equal(d.budgetUsd, 0);
      assert.equal(AYAS_REVENUE_UPFRONT_BUDGET_USD, 0); assert.equal(AYAS_AUTONOMOUS_MONETARY_BUDGET_USD, 0);
    } finally { keys.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; }); }
  });
  await scenario("primary", "P35", "across every operation, event, cost, source and amount, nothing allowed moves money", () => {
    let allowed = 0;
    for (const operation of AYAS_REVENUE_OPERATIONS) for (const event of AYAS_REVENUE_MONEY_EVENTS)
      for (const costClass of ["local-zero-cost", "free-public", "paid", "subscription", "metered-free-tier", "unknown-cost"]) for (const source of ["PLATFORM_FACT", "LOCAL_PLAN", "OWNER_POLICY"])
        for (const amount of [null, usd(0), usd(1)]) {
          const d = decide({ operation, event, costClass, source, amount }); assert.equal(d.budgetUsd, 0); assert.equal(d.grantsActionAuthority, false);
          if (!d.allowedAutonomously) continue;
          allowed++; assert.equal(d.monetaryMutation, false);
          assert.ok(event === "NONE" || event === "PASSIVE_PLATFORM_FEE_OBSERVED", `${operation} ${event}`);
          assert.notEqual(AYAS_REVENUE_OPERATION_EFFECT[operation], "FINANCIAL_COMMITMENT"); assert.ok(costClass === "local-zero-cost" || costClass === "free-public");
          assert.ok(!AYAS_REVENUE_ACTIVE_MONEY_EVENTS.includes(event));
        }
    assert.ok(allowed > 0);
  });
  await scenario("primary", "P36", "an event of NONE cannot carry money", () => {
    assert.equal(reason({ amount: usd(1) }), "INVALID_MONEY_INTENT"); assert.equal(reason({ amount: usd(0) }), "ZERO_COST_OPERATION");
  });
  await scenario("primary", "P37", "the global zero-cost policy is unchanged", () => {
    assert.equal(AYAS_AUTONOMOUS_MONETARY_BUDGET_USD, 0);
    const expected: Record<string, [boolean, string]> = { "local-zero-cost": [true, "AYAS_ZERO_COST_ALLOWED_LOCAL"], "free-public": [true, "AYAS_ZERO_COST_ALLOWED_FREE_PUBLIC"],
      paid: [false, "AYAS_ZERO_COST_DENIED_MONETARY"], subscription: [false, "AYAS_ZERO_COST_DENIED_MONETARY"], "metered-free-tier": [false, "AYAS_ZERO_COST_DENIED_MONETARY"], "unknown-cost": [false, "AYAS_ZERO_COST_DENIED_UNKNOWN"] };
    for (const [cls, [allowedClass, code]] of Object.entries(expected)) { const d = evaluateAyasZeroCost(cls as Parameters<typeof evaluateAyasZeroCost>[0]); assert.equal(d.allowed, allowedClass); assert.equal(d.reasonCode, code); assert.equal(d.budgetUsd, 0); }
  });
  await scenario("primary", "P38", "hostile intents are refused without being read; the module stays inside its boundary", () => {
    let read = false; const accessor = intent(); Object.defineProperty(accessor, "event", { enumerable: true, get: () => { read = true; return "NONE"; } });
    assert.equal(decideAyasRevenueSpend(accessor).reasonCode, "INVALID_MONEY_INTENT"); assert.equal(read, false);
    const amountGetter = intent({ event: "AD_SPEND" }); Object.defineProperty(amountGetter, "amount", { enumerable: true, get: () => usd(0) });
    assert.equal(decideAyasRevenueSpend(amountGetter).reasonCode, "INVALID_MONEY_INTENT");
    for (const raw of [null, "AD_SPEND", [intent()], Object.assign(Object.create(null), intent())]) assert.equal(decideAyasRevenueSpend(raw).reasonCode, "INVALID_MONEY_INTENT");
    const source = fs.readFileSync(SPEND, "utf8");
    for (const m of source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) assert.match(m[1]!, /^(?:\.\/AyasRevenue[A-Za-z]+|\.\.\/policy\/AyasZeroCostPolicy)$/, m[1]);
    for (const p of [SPEND, "docs/AYAS_REVENUE_SPEND_POLICY.md", "scripts/smoke-ayas-revenue-spend-policy.ts", "scripts/smoke-ayas-revenue-spend-policy-mutations.ts"])
      assert.equal(classifyPatchTarget(p).level, "FORBIDDEN_AUTONOMOUS", p);
  });
  await scenario("primary", "P39", "nested money accessors and throwing proxies fail closed without executing getters", () => {
    let reads = 0;
    for (const key of ["valueMinor", "currency"]) {
      const amount = usd(0); Object.defineProperty(amount, key, { enumerable: true, get() { reads++; throw new Error("money getter executed"); } });
      assert.equal(reason({ event: "AD_SPEND", amount }), "INVALID_MONEY_INTENT");
    }
    assert.equal(reads, 0);
    for (const raw of [new Proxy(intent(), { getPrototypeOf() { throw new Error("hostile reflection"); } }),
      new Proxy(intent(), {}), intent({ amount: new Proxy(usd(0), {}) })]) {
      assert.doesNotThrow(() => { assert.equal(decideAyasRevenueSpend(raw).reasonCode, "INVALID_MONEY_INTENT"); });
    }
  });
  await scenario("primary", "P40", "money and intent schemas reject omitted, extra and symbol properties", () => {
    for (const key of Object.keys(intent())) { const raw = intent(); delete raw[key]; assert.equal(decideAyasRevenueSpend(raw).reasonCode, "INVALID_MONEY_INTENT", key); }
    for (const amount of [{ valueMinor: 0 }, { currency: "USD" }, { ...usd(0), ownerApproved: true }, { ...usd(0), [Symbol("budget")]: 10 }]) {
      assert.equal(reason({ amount }), "INVALID_MONEY_INTENT");
    }
    assert.equal(reason({ [Symbol("owner")]: true }), "INVALID_MONEY_INTENT");
  });

  /* ------------------------------------------------- frozen held-out --- */
  await scenario("held-out", "H01", "an Etsy listing renewal fee is an active commitment", () => { assert.equal(reason({ operation: "LISTING_UPDATE", event: "ACTIVE_FEE_COMMITMENT", amount: usd(20) }), "UPFRONT_SPEND_DENIED"); });
  await scenario("held-out", "H02", "buying Upwork Connects is a paid bid", () => { assert.equal(reason({ platform: "upwork", operation: "PROPOSAL_SUBMIT", event: "PAID_CREDIT_OR_BID", amount: usd(150) }), "UPFRONT_SPEND_DENIED"); });
  await scenario("held-out", "H03", "Fiverr promotion without a price is unknown cost", () => { assert.equal(reason({ platform: "fiverr", operation: "LISTING_UPDATE", event: "AD_SPEND", amount: null }), "UNKNOWN_COST_DENIED"); });
  await scenario("held-out", "H04", "a Udemy premium free trial is a subscription", () => { assert.equal(reason({ platform: "udemy", operation: "COURSE_PUBLISH", event: "SUBSCRIPTION", amount: usd(0) }), "MONETARY_COMMITMENT_DENIED"); });
  await scenario("held-out", "H05", "a Lemon Squeezy payout read may record the observed fee", () => {
    assert.equal(reason({ platform: "lemon-squeezy", operation: "PAYOUT_LIST_READ", event: "PASSIVE_PLATFORM_FEE_OBSERVED", amount: usd(245), source: "PLATFORM_FACT" }), "PASSIVE_FEE_OBSERVATION");
  });
  await scenario("held-out", "H06", "a Lemon Squeezy refund needs the owner", () => { assert.equal(reason({ platform: "lemon-squeezy", operation: "REFUND", event: "REFUND", amount: usd(500) }), "FINANCIAL_OPERATION_OWNER_REQUIRED"); });
  await scenario("held-out", "H07", "free credits that can overrun are metered", () => { assert.equal(reason({ operation: "ORDER_LIST_READ", costClass: "metered-free-tier" }), "MONETARY_COMMITMENT_DENIED"); });
  await scenario("held-out", "H08", "analytics of unknown cost are denied", () => { assert.equal(reason({ operation: "ANALYTICS_READ", costClass: "unknown-cost" }), "UNKNOWN_COST_DENIED"); });
  await scenario("held-out", "H09", "a withdrawal with an owner-policy source is still denied", () => {
    assert.equal(reason({ operation: "PAYOUT_LIST_READ", event: "TRANSFER_OR_WITHDRAWAL", amount: usd(10_000), source: "OWNER_POLICY" }), "UPFRONT_SPEND_DENIED");
  });
  await scenario("held-out", "H10", "an Upwork proposal: the draft is free, the submit is free but owner-gated", () => {
    assert.equal(reason({ platform: "upwork", operation: "PROPOSAL_DRAFT", costClass: "local-zero-cost" }), "ZERO_COST_OPERATION");
    assert.equal(reason({ platform: "upwork", operation: "PROPOSAL_SUBMIT" }), "ZERO_COST_OPERATION");
    assert.equal(ayasRevenueModeFor("PROPOSAL_SUBMIT" as AyasRevenueOperation), "EXECUTE");
  });

  if (SELECTED !== undefined) { assert.equal(results.length, 1, `unknown case ${SELECTED}`); console.log(`case ${SELECTED}: PASS`); return; }
  for (const r of results) if (!r.ok) console.log(`FAIL ${r.id} ${r.detail ?? ""}`);
  const tally = (set: string) => ({ pass: results.filter((r) => r.set === set && r.ok).length, total: results.filter((r) => r.set === set).length });
  const primary = tally("primary"), heldOut = tally("held-out"), pass = results.every((r) => r.ok) && primary.total === 40 && heldOut.total === 10;
  console.log(`Stage 16.1 revenue spend policy: ${pass ? "PASS" : "FAIL"} (${primary.pass}/${primary.total} primary, ${heldOut.pass}/${heldOut.total} held-out; no money moved)`);
  console.log(JSON.stringify({ status: pass ? "PASS" : "FAIL", suite: "ayas-revenue-spend-policy", primary, heldOut, budgetUsd: 0, moneyMovement: "NONE" }));
  process.exitCode = pass ? 0 : 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
