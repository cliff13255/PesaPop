// Contract tests: every mock response is validated against docs/openapi.yaml.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createApp, FAILING_PHONE } from '../src/app.js';
import { DEMO_TOKENS, DEMO_PASSWORD } from '../src/seed.js';

const spec = YAML.parse(readFileSync(fileURLToPath(new URL('../../docs/openapi.yaml', import.meta.url)), 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(spec, 'spec');

const deref = (obj) => {
  while (obj?.$ref) {
    obj = obj.$ref.slice(2).split('/').reduce((o, k) => o[k], spec);
  }
  return obj;
};

/** Assert `body` matches the documented response for path/method/status. */
function assertContract(pathTemplate, method, status, body) {
  const op = spec.paths[pathTemplate]?.[method];
  assert.ok(op, `spec has no ${method.toUpperCase()} ${pathTemplate}`);
  const resp = deref(op.responses[String(status)]);
  assert.ok(resp, `spec documents no ${status} for ${method.toUpperCase()} ${pathTemplate}`);
  const schema = resp.content['application/json'].schema;
  const validate = schema.$ref
    ? ajv.getSchema(`spec${schema.$ref}`)
    : ajv.compile({ $ref: 'spec#/components/schemas/Error' });
  const ok = validate(body);
  assert.ok(ok, `${method.toUpperCase()} ${pathTemplate} ${status} violates spec: ${ajv.errorsText(validate.errors)}\n${JSON.stringify(body, null, 2)}`);
}

let server;
let base;
const SUCCESS_AFTER = 300;

before(async () => {
  server = createApp({ successAfterMs: SUCCESS_AFTER }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function call(method, path, { body, token = DEMO_TOKENS.customer } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(base + path, { method, headers, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const draftBody = { method: 'mpesa_stk', amount: 500, phone: '+254712345678', recipient: 'Kenya Power', reference: 'ACC-104233' };

test('health', async () => {
  const r = await call('GET', '/health', { token: null });
  assert.equal(r.status, 200);
  assertContract('/health', 'get', 200, r.body);
});

test('register, duplicate, validation', async () => {
  const body = { name: 'Otieno Ouma', phone: '+254733111222', email: 'otieno@example.co.ke', password: 'supersecret1', role: 'customer' };
  const r = await call('POST', '/auth/register', { body, token: null });
  assert.equal(r.status, 201);
  assertContract('/auth/register', 'post', 201, r.body);
  assert.equal(r.body.user.role, 'customer');
  assert.equal(r.body.user.password, undefined);

  const dup = await call('POST', '/auth/register', { body, token: null });
  assert.equal(dup.status, 409);
  assertContract('/auth/register', 'post', 409, dup.body);

  const badPhone = await call('POST', '/auth/register', { body: { ...body, phone: '0712345678' }, token: null });
  assert.equal(badPhone.status, 400);
  assert.equal(badPhone.body.error.code, 'validation_error');
  assertContract('/auth/register', 'post', 400, badPhone.body);
});

test('login, wrong password, me', async () => {
  const r = await call('POST', '/auth/login', { body: { email: 'merchant@pesapop.test', password: DEMO_PASSWORD }, token: null });
  assert.equal(r.status, 200);
  assertContract('/auth/login', 'post', 200, r.body);

  const me = await call('GET', '/me', { token: r.body.token });
  assert.equal(me.status, 200);
  assertContract('/me', 'get', 200, me.body);
  assert.equal(me.body.role, 'merchant');

  const wrong = await call('POST', '/auth/login', { body: { email: 'merchant@pesapop.test', password: 'nope' }, token: null });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error.code, 'invalid_credentials');
  assertContract('/auth/login', 'post', 401, wrong.body);

  const anon = await call('GET', '/me', { token: null });
  assert.equal(anon.status, 401);
  assertContract('/me', 'get', 401, anon.body);

  const anyToken = await call('GET', '/me', { token: 'whatever' });
  assert.equal(anyToken.status, 200);
});

test('draft -> confirm (idempotent) -> pending -> success', async () => {
  const d = await call('POST', '/payments', { body: draftBody });
  assert.equal(d.status, 201);
  assertContract('/payments', 'post', 201, d.body);
  assert.equal(d.body.payment_summary.total, 500);

  const c1 = await call('POST', `/payments/${d.body.confirmation_id}/confirm`);
  assert.equal(c1.status, 200);
  assertContract('/payments/{confirmation_id}/confirm', 'post', 200, c1.body);
  assert.equal(c1.body.status, 'pending');

  const c2 = await call('POST', `/payments/${d.body.confirmation_id}/confirm`);
  assert.equal(c2.status, 200);
  assert.equal(c2.body.id, c1.body.id, 'second confirm must return the same payment');

  const p1 = await call('GET', `/payments/${c1.body.id}`);
  assertContract('/payments/{id}', 'get', 200, p1.body);
  assert.equal(p1.body.status, 'pending');
  assert.equal(p1.body.receipt, null);

  await sleep(SUCCESS_AFTER + 50);
  const p2 = await call('GET', `/payments/${c1.body.id}`);
  assertContract('/payments/{id}', 'get', 200, p2.body);
  assert.equal(p2.body.status, 'success');
  assert.ok(p2.body.receipt.mpesa_receipt);
});

test('failing phone ends in failed', async () => {
  const d = await call('POST', '/payments', { body: { ...draftBody, phone: FAILING_PHONE } });
  const c = await call('POST', `/payments/${d.body.confirmation_id}/confirm`);
  await sleep(SUCCESS_AFTER + 50);
  const p = await call('GET', `/payments/${c.body.id}`);
  assertContract('/payments/{id}', 'get', 200, p.body);
  assert.equal(p.body.status, 'failed');
  assert.ok(p.body.failure_reason);
});

test('ownership, expiry, validation on payments', async () => {
  const d = await call('POST', '/payments', { body: draftBody });
  const other = await call('POST', `/payments/${d.body.confirmation_id}/confirm`, { token: DEMO_TOKENS.merchant });
  assert.equal(other.status, 404);
  assertContract('/payments/{confirmation_id}/confirm', 'post', 404, other.body);

  const decimal = await call('POST', '/payments', { body: { ...draftBody, amount: 10.5 } });
  assert.equal(decimal.status, 400);
  assertContract('/payments', 'post', 400, decimal.body);

  const missing = await call('GET', '/payments/pay_doesnotexist');
  assert.equal(missing.status, 404);
  assertContract('/payments/{id}', 'get', 404, missing.body);

  const shortLived = createApp({ draftTtlMs: 1 }).listen(0);
  await new Promise((r) => shortLived.once('listening', r));
  const b = `http://127.0.0.1:${shortLived.address().port}`;
  const h = { 'content-type': 'application/json', authorization: `Bearer ${DEMO_TOKENS.customer}` };
  const dr = await (await fetch(`${b}/payments`, { method: 'POST', headers: h, body: JSON.stringify(draftBody) })).json();
  await sleep(10);
  const ex = await fetch(`${b}/payments/${dr.confirmation_id}/confirm`, { method: 'POST', headers: h });
  const exBody = await ex.json();
  shortLived.close();
  assert.equal(ex.status, 410);
  assert.equal(exBody.error.code, 'draft_expired');
  assertContract('/payments/{confirmation_id}/confirm', 'post', 410, exBody);
});

test('assistant asks for missing fields, then drafts, never confirms', async () => {
  const a1 = await call('POST', '/assistant/messages', { body: { message: 'send 500 to John' } });
  assert.equal(a1.status, 200);
  assertContract('/assistant/messages', 'post', 200, a1.body);
  assert.deepEqual(a1.body.missing_fields, ['phone']);
  assert.equal(a1.body.confirmation_id, null);

  const a2 = await call('POST', '/assistant/messages', {
    body: { message: 'his number is 0712 345 678', conversation_id: a1.body.conversation_id },
  });
  assertContract('/assistant/messages', 'post', 200, a2.body);
  assert.deepEqual(a2.body.missing_fields, []);
  assert.equal(a2.body.payment_summary.amount, 500);
  assert.equal(a2.body.payment_summary.recipient, 'John');
  assert.equal(a2.body.payment_summary.phone, '+254712345678');
  assert.ok(a2.body.confirmation_id);

  // The draft is not a payment until confirmed.
  const tx = await call('GET', '/transactions?limit=100');
  assert.ok(!tx.body.items.some((i) => i.amount === 500 && i.recipient === 'John'));

  const k = await call('POST', '/assistant/messages', { body: { message: 'pay 1k to Mary 0722000333' } });
  assert.equal(k.body.payment_summary.amount, 1000);

  const cancel = await call('POST', '/assistant/messages', { body: { message: 'cancel that', conversation_id: a1.body.conversation_id } });
  assertContract('/assistant/messages', 'post', 200, cancel.body);
  assert.equal(cancel.body.payment_summary, null);

  const foreign = await call('POST', '/assistant/messages', {
    body: { message: 'hi', conversation_id: a1.body.conversation_id },
    token: DEMO_TOKENS.merchant,
  });
  assert.equal(foreign.status, 404);
  assertContract('/assistant/messages', 'post', 404, foreign.body);
});

test('transactions: pagination and status filter', async () => {
  const r = await call('GET', '/transactions?page=2&limit=5');
  assert.equal(r.status, 200);
  assertContract('/transactions', 'get', 200, r.body);
  assert.equal(r.body.items.length, 5);
  assert.equal(r.body.pagination.page, 2);

  const f = await call('GET', '/transactions?status=failed&limit=100');
  assertContract('/transactions', 'get', 200, f.body);
  assert.ok(f.body.items.length > 0);
  assert.ok(f.body.items.every((i) => i.status === 'failed'));

  const bad = await call('GET', '/transactions?status=done');
  assert.equal(bad.status, 400);
  assertContract('/transactions', 'get', 400, bad.body);
});

test('merchant endpoints and role checks', async () => {
  const forbidden = await call('GET', '/merchant/summary');
  assert.equal(forbidden.status, 403);
  assertContract('/merchant/summary', 'get', 403, forbidden.body);

  const s = await call('GET', '/merchant/summary', { token: DEMO_TOKENS.merchant });
  assert.equal(s.status, 200);
  assertContract('/merchant/summary', 'get', 200, s.body);
  assert.equal(s.body.total_received, s.body.success.total);
  assert.equal(s.body.success.count + s.body.pending.count + s.body.failed.count, 30);

  const created = await call('POST', '/payment-requests', {
    token: DEMO_TOKENS.merchant,
    body: { amount: 2500, customer_phone: '+254711222333', description: 'Invoice #1050: 5 crates of eggs' },
  });
  assert.equal(created.status, 201);
  assertContract('/payment-requests', 'post', 201, created.body);
  assert.match(created.body.link, /^https:\/\//);

  const list = await call('GET', '/payment-requests', { token: DEMO_TOKENS.merchant });
  assertContract('/payment-requests', 'get', 200, list.body);
  assert.equal(list.body.items[0].id, created.body.id);

  const custList = await call('GET', '/payment-requests');
  assert.equal(custList.status, 403);
  assertContract('/payment-requests', 'get', 403, custList.body);
});
