/** Stage16.4 negative controls change only a copied TS closure in an owned gitless TEMP directory. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const repo = process.cwd(), parent = fs.realpathSync.native(os.tmpdir());
const temp = fs.mkdtempSync(path.join(parent, "ayas-revenue-etsy-audit-")), link = path.join(temp, "node_modules");
const test = "scripts/smoke-ayas-revenue-etsy-adapter.ts", copied = new Set<string>();
function copy(file: string) {
  if (copied.has(file)) return; copied.add(file); const to = path.join(temp, file); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(repo, file), to);
  if (!/\.tsx?$/.test(file)) return;
  for (const m of fs.readFileSync(to, "utf8").matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]/g)) {
    const base = path.resolve(path.dirname(path.join(repo, file)), m[1]!);
    const found = [base, base + ".ts", base + ".tsx", base + ".json", path.join(base, "index.ts")].find(f => fs.existsSync(f) && fs.statSync(f).isFile());
    if (found) { const rel = path.relative(repo, found).replace(/\\/g, "/"); assert.ok(!rel.startsWith("..") && !path.isAbsolute(rel)); copy(rel); }
  }
}
const D = "src/lib/ayas/revenue/adapters/etsy/", A = `${D}AyasEtsyAdapter.ts`, S = `${D}AyasEtsySchemas.ts`, M = `${D}AyasEtsyMapper.ts`, W = `${D}AyasEtsyWebhook.ts`;
const mutants: readonly (readonly [string, string, string, string, string])[] = [
  ["write operation declared", S, '"ANALYTICS_READ", "LISTING_DRAFT"]);', '"ANALYTICS_READ", "LISTING_DRAFT", "LISTING_CREATE"]);', "P01"],
  ["read scope widened to write", S, 'ACCOUNT_STATUS_READ: Object.freeze(["shops_r"])', 'ACCOUNT_STATUS_READ: Object.freeze(["shops_r", "listings_w"])', "P03"],
  ["write scope not recognized", S, '"listings_w", "listings_d", ', '"listings_d", ', "P09"],
  ["inexact money accepted", S, "if (!Number.isSafeInteger(scaled) || scaled % (divisor as number) !== 0) return null;", "if (!Number.isSafeInteger(scaled)) return null;", "P23"],
  ["negative money accepted", S, "(amount as number) < 0 || ", "", "P23"],
  ["zero-decimal currencies scaled", S, 'c === "JPY" || c === "KRW" ? 0 : 2', "2", "P24"],
  ["documented header spelling ignored", S, '"x-remaining-this-second", "x-remaining-this-secon"', '"x-remaining-this-second"', "P30"],
  ["malformed rate-limit header trusted", S, "/^\\d{1,9}$/.test(v.trim())", 'v.trim() !== ""', "P30"],
  ["connection gate skipped", A, 'if (gate.gate !== "CONNECTION_OK" || request.accountRef !== accountRef)', "if (request.accountRef !== accountRef)", "P05"],
  ["adapter account not bound", A, " || request.accountRef !== accountRef) return fail", ") return fail", "P65"],
  ["read mode not enforced", A, 'if (!accepts(request, reads) || request.mode !== "READ")', "if (!accepts(request, reads))", "P42"],
  ["non-GET method", A, 'method: "GET", host: AYAS_ETSY_API_HOST', 'method: "POST", host: AYAS_ETSY_API_HOST', "P03"],
  ["other host", A, "host: AYAS_ETSY_API_HOST, path: planned.path", 'host: "api.etsy.com", path: planned.path', "P03"],
  ["mutable query handed to transport", A, "query: Object.freeze({ ...planned.query })", "query: { ...planned.query }", "P39"],
  ["rate limit not reported", A, 'if (status === 429) return fail(request, "UNAVAILABLE", "RATE_LIMITED");', "", "P29"],
  ["401 not blocked", A, 'if (status === 401) return fail(request, "BLOCKED", "AUTH_REFUSED");', "", "P13"],
  ["403 not blocked", A, 'if (status === 403) return fail(request, "BLOCKED", "SCOPE_REFUSED");', "", "P13"],
  ["404 not classified", A, 'if (status === 404) return fail(request, "ERROR", "NOT_FOUND");', "", "P31"],
  ["5xx not classified", A, 'if (status >= 500 && status <= 599) return fail(request, "UNAVAILABLE", "UPSTREAM_UNAVAILABLE");', "", "P31"],
  ["non-200 accepted", A, 'if (status !== 200) return fail(request, "ERROR", "REQUEST_REJECTED");', "", "P31"],
  ["oversized answer accepted", A, 'if (size > AYAS_ETSY_MAX_RESPONSE_BYTES) return fail(request, "ERROR", "RESPONSE_TOO_LARGE");', "", "P34"],
  ["answer not snapshotted", A, "const snapshot = snapshotAyasRevenueValue(answer);", "const snapshot = { ok: true as const, value: answer };", "P35"],
  ["non-string headers accepted", A, ' || !Object.values(rawHeaders).every((v) => typeof v === "string")', "", "P35"],
  ["non-integer status accepted", A, "!Number.isSafeInteger(response.status) || ", "", "P35"],
  ["header case kept", A, "headers[k.toLowerCase()] = v as string;", "headers[k] = v as string;", "P30"],
  ["token for another shop accepted", A, 'if (shopRef !== shopId) return fail(request, "BLOCKED", "SHOP_MISMATCH");', "", "P04"],
  ["shop facts for another shop accepted", A, 'if (planned.kind === "SHOP_FACTS" && item.shopRef !== shopId)', "if (false)", "P28"],
  ["receipt read not bound to requested receipt", A, 'if (planned.kind === "RECEIPT" && item.receiptRef !== planned.receiptRef)', "if (false)", "P22"],
  ["payments not bound to requested receipt", A, " || (x as { receiptRef: string }).receiptRef !== planned.receiptRef", "", "P25"],
  ["malformed record skipped silently", A, 'if (items.some((x) => x === null)) return fail(request, "ERROR", "RESPONSE_INVALID");', "", "P33"],
  ["page longer than requested accepted", A, " || body.results.length > planned.limit", "", "P66"],
  ["cursor past the total", A, "next < (body.count as number) && ", "", "P67"],
  ["cursor past the offset cap", A, " && next <= AYAS_ETSY_MAX_OFFSET", "", "P18"],
  ["offset cap dropped", A, " || offset > AYAS_ETSY_MAX_OFFSET", "", "P18"],
  ["cursor shape unchecked", A, " || !/^o\\d{1,5}$/.test(cursor)", "", "P17"],
  ["listing state open set", A, "(AYAS_ETSY_LISTING_STATES as readonly unknown[]).includes(p.state)", 'typeof p.state === "string"', "P16"],
  ["listing payload extra keys", A, 'Object.keys(p).join() === "state" && ', "", "P16"],
  ["receipt payload extra keys", A, 'Object.keys(p).join() === "receiptId" && ', "", "P40"],
  ["receipt id unchecked at plan", A, 'isAyasEtsyId(p.receiptId) && cursor === null\n        ? one("RECEIPT"', 'cursor === null\n        ? one("RECEIPT"', "P40"],
  ["payments payload extra keys", A, 'Object.keys(p).sort().join() === "kind,receiptId" && ', "", "P40"],
  ["ledger window unbounded", A, " && (p.maxCreated as number) - (p.minCreated as number) <= AYAS_ETSY_LEDGER_WINDOW_MAX_SECONDS", "", "P26"],
  ["ledger window order unchecked", A, "(p.maxCreated as number) > (p.minCreated as number) && ", "", "P26"],
  ["links allowed in draft", A, " && !URL_LIKE.test(v)", "", "P45"],
  ["fourteen tags allowed", A, "tags.length > 13", "tags.length > 14", "P45"],
  ["duplicate tags allowed", A, "new Set(tags.map((t) => String(t).toLowerCase())).size !== tags.length", "false", "P45"],
  ["zero price draft allowed", A, " || (p.price as { valueMinor: number }).valueMinor < 1", "", "P45"],
  ["extra draft fields allowed", A, "Object.keys(p).sort().join() !== [...DRAFT_KEYS].sort().join()", "false", "P45"],
  ["missing rights not listed", A, '...(p.rightsEvidenceDigest === null ? ["RIGHTS_EVIDENCE_MISSING"] : []), ', "", "P44"],
  ["publication opened", A, 'publication: "CLOSED",', 'publication: "OPEN",', "P43"],
  ["owner approval dropped from publication plan", A, '"OWNER_APPROVAL", ', "", "P43"],
  ["draft digest misses commercial fields", A, "const draftDigest = digestAyasRevenueData(p);", "const draftDigest = digestAyasRevenueData(p.title);", "P46"],
  ["write-scoped connection unreported", A, 'if (granted.some((s) => (AYAS_ETSY_WRITE_SCOPES as readonly unknown[]).includes(s))) return "CONNECTED_WRITE_SCOPED";', "", "P09"],
  ["revoked connection unreported", A, 'if (gate.health === "REAUTH_REQUIRED") return "REVOKED";', "", "P07"],
  ["buyer name kept", M, "transactionCount: transactions.length, refundCount: refunds.length };", "transactionCount: transactions.length, refundCount: refunds.length, buyer: raw.name };", "P20"],
  ["listing url kept", M, "tagCount: tags.length, createdAt, updatedAt };", "tagCount: tags.length, createdAt, updatedAt, link: raw.url };", "P14"],
  ["cross-currency amount accepted", M, "return m !== null && m.currency === currency ? m : null;", "return m;", "H11"],
  ["unsettled payment counted as revenue", M, 'if (p.status !== "settled") unknown.push(', "if (false) unknown.push(", "P58"],
  ["missing fee becomes zero", M, 'else inputs.push(entry("PAYMENT_PROCESSING_FEE", `payment:${p.paymentRef}:processing-fee`, p.fees, p.createdAt));',
    'inputs.push(entry("PAYMENT_PROCESSING_FEE", `payment:${p.paymentRef}:processing-fee`, p.fees ?? { valueMinor: 0, currency: p.currency }, p.createdAt));', "P58"],
  ["failed refund counted", M, "if (!a.success) continue;", "", "P59"],
  ["refund units assumed for any currency", M, " || AYAS_ETSY_CURRENCY_EXPONENT[p.currency] !== 2", "", "P59"],
  ["evidence digest not bound to payment", M, "const evidenceDigest = digestAyasRevenueData(p);", "const evidenceDigest = digestAyasRevenueData(p.paymentRef);", "P62"],
  ["platform fee silently omitted", M, "unknown.push(`PLATFORM_FEE_NOT_IN_PAYMENT:${p.paymentRef}`);", "", "P57"],
  ["payout gap silently omitted", M, 'unknown.push("PAYOUT_FROM_LEDGER_TYPES_UNVERIFIED");', "", "P57"],
  ["ledger units claimed verified", M, "amount: raw.amount as number, currency: raw.currency, unitsVerified: false,", "amount: raw.amount as number, currency: raw.currency, unitsVerified: true,", "P27"],
  ["mapping accepts another platform", M, ' || r.platform !== "etsy"', "", "P60"],
  ["mapping accepts a non-OK read", M, ' || r.status !== "OK"', "", "P60"],
  ["mapping accepts another transport", M, ' || r.evidence.transport !== "OFFICIAL_API"', "", "P60"],
  ["mapping accepts another read kind", M, ' || data.kind !== "RECEIPT_PAYMENTS"', "", "P60"],
  ["signature not checked", W, 'if (!signatureMatches(input.signingSecret, `${id}.${ts}.${input.rawBody}`, signature)) return out("REJECTED", "SIGNATURE_INVALID");', "", "P49"],
  ["signed content omits the delivery id", W, "`${id}.${ts}.${input.rawBody}`", "`${ts}.${input.rawBody}`", "P48"],
  ["signature compared by length only", W, "given.length === expected.length && timingSafeEqual(given, expected)", "given.length === expected.length", "P49"],
  ["timestamp window widened", W, "> AYAS_ETSY_WEBHOOK_TOLERANCE_SECONDS", "> 86_400", "P50"],
  ["duplicate deliveries accepted", W, 'if (input.seenDeliveryIds.has(id)) return out("DUPLICATE", "DELIVERY_ALREADY_SEEN", id);', "", "P51"],
  ["unknown events accepted", W, 'if (!(AYAS_ETSY_WEBHOOK_EVENTS as readonly unknown[]).includes(body.event_type)) return out("REJECTED", "UNKNOWN_EVENT", id);', "", "P52"],
  ["webhook shop not bound", W, " || shopRef !== input.expectedShopId", "", "P54"],
  ["resource host not allowlisted", W, "!(AYAS_ETSY_RESOURCE_HOSTS as readonly string[]).includes(url.hostname) || ", "", "P53"],
  ["plain http resource accepted", W, 'url.protocol !== "https:" || ', "", "P53"],
  ["resource port accepted", W, 'url.port !== "" || ', "", "P53"],
  ["resource credentials accepted", W, 'url.username !== "" || url.password !== ""', "false", "P53"],
  ["resource query accepted", W, ' || url.search !== ""', "", "P53"],
  ["resource for another shop accepted", W, " || match[1] !== shopRef", "", "P53"],
  ["duplicated header accepted", W, "hits.length === 1 && ", "hits.length >= 1 && ", "P56"],
  ["returned shop identity unchecked", A, 'ayasEtsyIdOf(item.shop_id) !== shopId', 'false', "P68"],
  ["refund belongs to another payment", M, " || ayasEtsyIdOf(a.payment_id) !== paymentRef", "", "P69"],
  ["oversized refund accepted", M, " && (v as number) <= AYAS_REVENUE_MAX_MINOR_UNITS", "", "P72"],
  ["mapping monetary effects unchecked", M, " || r.evidence.monetaryMutation !== false", "", "P70"],
  ["mapping currency confusion", M, " && v.currency === currency", "", "P70"],
  ["mapping money bound removed", M, " && (v.valueMinor as number) <= AYAS_REVENUE_MAX_MINOR_UNITS", "", "P70"],
  ["mapping invokes nested accessors", M, 'if (!isAyasRevenueBoundedJson(result, AYAS_ETSY_MAX_RESPONSE_BYTES)) return refusedMapping("INVALID_PAYMENT_READ");', "", "P71"],
];
const env: NodeJS.ProcessEnv = { NODE_ENV: "test" }; for (const k of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[k]) env[k] = process.env[k];
const run = (id?: string) => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env: id ? { ...env, AYAS_REVENUE_ETSY_MUTATION_CASE: id } : env, encoding: "utf8", windowsHide: true, timeout: 60_000, maxBuffer: 4_000_000 });
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
  console.log(JSON.stringify({ status: "PASS", baseline: JSON.parse(baseline.stdout), negativeControls: { total: mutants.length, caught, equivalents: [] }, noLiveIO: true }, null, 2));
} finally {
  if (fs.existsSync(link)) { if (process.platform === "win32") fs.rmdirSync(link); else fs.unlinkSync(link); }
  assert.ok(!fs.existsSync(link)); assert.equal(path.dirname(fs.realpathSync.native(temp)).toLowerCase(), parent.toLowerCase()); assert.ok(path.basename(temp).startsWith("ayas-revenue-etsy-audit-"));
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
