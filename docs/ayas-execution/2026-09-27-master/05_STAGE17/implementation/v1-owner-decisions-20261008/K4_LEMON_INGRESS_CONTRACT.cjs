// Isolated contract simulation. No HTTP listener, real credential or durable store.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHmac } = require('node:crypto');
const root = process.cwd();
const { verifyAyasLemonWebhook } = require(path.join(root, 'src/lib/ayas/revenue/adapters/lemon/AyasLemonWebhook.ts'));
const { lemonWebhook, lemonWire, LEMON_SYNTHETIC_SIGNING_SECRET } = require(path.join(root, 'scripts/fixtures/ayas-lemon-fixture.ts'));
const results = [];
const receiptModel = new Map(); let jobs = 0;
async function ingress(w, options = {}) {
  // Trusted server-side TEST binding; callers cannot select LIVE.
  const pointer = verifyAyasLemonWebhook(w.body, w.headers, LEMON_SYNTHETIC_SIGNING_SECRET, { storeRef: '1', mode: 'TEST' });
  if (!pointer || pointer.mode !== 'TEST') return { status: 400 };
  if (options.storageFailure) return { status: 503 };
  // Models atomic committed-receipt insertion. Actual crash/fsync semantics NOT tested.
  if (receiptModel.has(pointer.eventDigest)) return { status: 200, duplicate: true };
  receiptModel.set(pointer.eventDigest, { eventDigest: pointer.eventDigest, eventCode: pointer.eventCode, resourceType: pointer.resourceType, resourceRef: pointer.resourceRef, mode: 'TEST', state: 'COMMITTED' });
  jobs++;
  return { status: 200, duplicate: false };
}
async function check(id, fn) { await fn(); results.push({ id, outcome: 'PASS' }); }
async function main() {
  const w = lemonWebhook();
  await check('valid-test-notification-commits-before-ack', async () => { const r = await ingress(w); assert.equal(r.status, 200); assert.equal(receiptModel.size, 1); assert.equal(jobs, 1); });
  await check('duplicate-ack-no-second-job', async () => { const r = await ingress(w); assert.equal(r.duplicate, true); assert.equal(jobs, 1); });
  await check('concurrent-duplicate-one-committed-receipt-model', async () => { const fresh = lemonWebhook('order_created', lemonWire('orders', '31')); const before = jobs; const r = await Promise.all([ingress(fresh), ingress(fresh)]); assert.equal(r.filter(x => !x.duplicate).length, 1); assert.equal(jobs, before + 1); });
  await check('bad-signature-no-receipt', async () => { const bad = lemonWebhook(); bad.headers['X-Signature'] = '0'.repeat(64); const before = jobs; assert.equal((await ingress(bad)).status, 400); assert.equal(jobs, before); });
  await check('altered-raw-body-refused', async () => { const bad = lemonWebhook(); bad.body = Buffer.concat([bad.body, Buffer.from(' ')]); assert.equal((await ingress(bad)).status, 400); });
  await check('signed-malformed-json-refused', async () => { const bad = lemonWebhook(); bad.body = Buffer.from('not-json'); bad.headers['X-Signature'] = createHmac('sha256', LEMON_SYNTHETIC_SIGNING_SECRET).update(bad.body).digest('hex'); assert.equal((await ingress(bad)).status, 400); });
  await check('live-notification-refused-at-test-boundary', async () => { const bad = lemonWebhook('order_created', lemonWire('orders', '30', false)); assert.equal((await ingress(bad)).status, 400); });
  await check('foreign-store-refused', async () => { const resource = lemonWire('orders', '30'); resource.attributes.store_id = 2; assert.equal((await ingress(lemonWebhook('order_created', resource))).status, 400); });
  await check('case-duplicate-header-refused', async () => { const bad = lemonWebhook(); bad.headers['x-signature'] = bad.headers['X-Signature']; assert.equal((await ingress(bad)).status, 400); });
  await check('oversized-body-refused', async () => { const bad = lemonWebhook(); bad.body = Buffer.alloc(262145); assert.equal((await ingress(bad)).status, 400); });
  await check('receipt-failure-no-200-and-retry-can-commit', async () => { const fresh = lemonWebhook('order_created', lemonWire('orders', '32')); const before = jobs; assert.equal((await ingress(fresh, { storageFailure: true })).status, 503); assert.equal(jobs, before); assert.equal((await ingress(fresh)).status, 200); assert.equal(jobs, before + 1); });
  await check('receipts-no-raw-pii-secret-or-economic-authority', async () => { const text = JSON.stringify([...receiptModel.values()]); for (const forbidden of ['buyer@example.test', 'Private Customer', LEMON_SYNTHETIC_SIGNING_SECRET, 'total', 'authorizationId']) assert.equal(text.includes(forbidden), false); });
  console.log(JSON.stringify({ schemaVersion: '1', observedAt: new Date().toISOString(), evidenceClass: 'ISOLATED_IN_MEMORY_INGRESS_CONTRACT_SIMULATION', implementation: 'NOT_APPLIED', actualDurability: 'NOT_QUALIFIED', realWebhook: 'NOT_RUN', productionConnection: false, externalWrites: 0, ledgerWrites: 0, authority: 'NONE', cases: results.length, results }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
