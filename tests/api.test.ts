import { beforeEach, describe, expect, it } from 'vitest';
import { DRAFT_MARKER, rulesModel } from '../supabase/functions/_shared/assistant.ts';
import { simulatedProvider } from '../supabase/functions/_shared/providers.ts';
import { createPayHeroProvider, parsePayHeroCallback } from '../supabase/functions/_shared/payhero.ts';
import { loadConfig } from '../supabase/functions/_shared/config.ts';
import { draftBody, expectContract, fakeAssistant, fakeProvider, makeApi, resetDb, SESSION_A, SESSION_B, sql } from './helpers.ts';

beforeEach(resetDb);

describe('public routes', () => {
  it('health and config need no session', async () => {
    const api = makeApi({ env: { MAX_AMOUNT: '750', DEMO_ACCESS_CODE: 'x' } });
    const h = await api('GET', '/health', { session: null });
    expect(h.status).toBe(200);
    expectContract('/health', 'get', h);
    const c = await api('GET', '/config', { session: null });
    expectContract('/config', 'get', c);
    expect(c.body).toMatchObject({ provider_mode: 'live', max_amount: 750, access_code_required: true });
  });

  it('answers CORS preflight', async () => {
    const api = makeApi();
    const r = await api('OPTIONS', '/payments', { session: null });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-headers')).toContain('x-demo-session');
  });

  it('requires a valid session id', async () => {
    const api = makeApi();
    const r = await api('POST', '/payments', { body: draftBody, session: null });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('validation_error');
    expect((await api('POST', '/payments', { body: draftBody, session: 'short' })).status).toBe(400);
  });

  it('enforces the optional demo passcode', async () => {
    const api = makeApi({ env: { DEMO_ACCESS_CODE: 'tembo42' } });
    const no = await api('POST', '/payments', { body: draftBody });
    expect(no.status).toBe(401);
    expectContract('/payments', 'post', no);
    expect(no.body.error.code).toBe('access_code_required');
    const yes = await api('POST', '/payments', { body: draftBody, headers: { 'x-demo-code': 'tembo42' } });
    expect(yes.status).toBe(201);
  });
});

describe('drafts', () => {
  it('creates a draft without contacting the provider', async () => {
    const fake = fakeProvider();
    const api = makeApi({ provider: fake.provider });
    const r = await api('POST', '/payments', { body: draftBody });
    expect(r.status).toBe(201);
    expectContract('/payments', 'post', r);
    expect(r.body.payment_summary).toMatchObject({ kind: 'payment', amount: 500, total: 500, method: 'mpesa_stk' });
    expect(fake.calls).toHaveLength(0);
    expect((await sql`select count(*)::int as n from public.payments`)[0]!.n).toBe(0);
  });

  it.each([
    ['over the demo cap', { amount: 1001 }, 'amount'],
    ['decimal', { amount: 10.5 }, 'amount'],
    ['bad phone', { phone: '0712345678' }, 'phone'],
    ['missing recipient', { recipient: undefined }, 'recipient'],
    ['unknown field', { method: 'lipwa' }, 'method'],
  ])('rejects %s', async (_n, patch, field) => {
    const api = makeApi();
    const r = await api('POST', '/payments', { body: { ...draftBody, ...patch } });
    expect(r.status).toBe(400);
    expectContract('/payments', 'post', r);
    expect(r.body.error.message).toContain(field);
  });

  it('merchant payment requests become drafts that STK-push the customer', async () => {
    const api = makeApi({ env: { SHOP_NAME: 'Duka Demo' } });
    const r = await api('POST', '/payment-requests', { body: { amount: 250, customer_phone: '+254711222333', description: 'Invoice 7' } });
    expect(r.status).toBe(201);
    expectContract('/payment-requests', 'post', r);
    expect(r.body.payment_summary).toMatchObject({ kind: 'request', recipient: 'Duka Demo', phone: '+254711222333', reference: 'Invoice 7' });
  });
});

describe('confirm (the only money-moving call)', () => {
  async function draft(api: ReturnType<typeof makeApi>, session = SESSION_A) {
    return (await api('POST', '/payments', { body: draftBody, session })).body.confirmation_id as string;
  }

  it('sends one STK push and returns pending', async () => {
    const fake = fakeProvider();
    const api = makeApi({ provider: fake.provider });
    const cid = await draft(api);
    const r = await api('POST', `/payments/${cid}/confirm`);
    expect(r.status).toBe(200);
    expectContract('/payments/{confirmation_id}/confirm', 'post', r);
    expect(r.body.status).toBe('pending');
    expect(fake.calls).toEqual([r.body.id]);
  });

  it('is idempotent, including six simultaneous taps', async () => {
    const fake = fakeProvider();
    const api = makeApi({ provider: fake.provider });
    const cid = await draft(api);
    const all = await Promise.all(Array.from({ length: 6 }, () => api('POST', `/payments/${cid}/confirm`)));
    expect(all.every((r) => r.status === 200)).toBe(true);
    expect(new Set(all.map((r) => r.body.id)).size).toBe(1);
    expect(fake.calls).toHaveLength(1);
    const again = await api('POST', `/payments/${cid}/confirm`);
    expect(again.body.id).toBe(all[0]!.body.id);
    expect(fake.calls).toHaveLength(1);
  });

  it("returns 404 for another browser's draft and sends nothing", async () => {
    const fake = fakeProvider();
    const api = makeApi({ provider: fake.provider });
    const cid = await draft(api, SESSION_A);
    const r = await api('POST', `/payments/${cid}/confirm`, { session: SESSION_B });
    expect(r.status).toBe(404);
    expectContract('/payments/{confirmation_id}/confirm', 'post', r);
    expect(fake.calls).toHaveLength(0);
  });

  it('returns 410 for an expired draft', async () => {
    const fake = fakeProvider();
    const api = makeApi({ provider: fake.provider });
    const cid = await draft(api);
    await sql`update public.payment_drafts set expires_at = now() - interval '1 second' where id = ${cid}`;
    const r = await api('POST', `/payments/${cid}/confirm`);
    expect(r.status).toBe(410);
    expectContract('/payments/{confirmation_id}/confirm', 'post', r);
    expect(fake.calls).toHaveLength(0);
  });

  it('rate-limits per browser and per IP', async () => {
    const api = makeApi({ env: { RATE_LIMIT_COUNT: '2' } });
    for (let i = 0; i < 2; i++) expect((await api('POST', `/payments/${await draft(api)}/confirm`)).status).toBe(200);
    const blocked = await api('POST', `/payments/${await draft(api)}/confirm`);
    expect(blocked.status).toBe(429);
    expectContract('/payments/{confirmation_id}/confirm', 'post', blocked);
    // A new browser on the same IP is also blocked.
    const sameIp = await api('POST', `/payments/${await draft(api, SESSION_B)}/confirm`, { session: SESSION_B });
    expect(sameIp.status).toBe(429);
    // A different browser and IP is fine.
    const other = await api('POST', `/payments/${await draft(api, SESSION_B)}/confirm`, { session: SESSION_B, ip: '10.9.9.9' });
    expect(other.status).toBe(200);
  });

  it('marks the payment failed, never success, when the provider throws or rejects', async () => {
    const throwing = makeApi({ provider: fakeProvider({ initiate: async () => { throw new Error('ECONNRESET'); } }).provider });
    const c1 = await throwing('POST', `/payments/${await draft(throwing)}/confirm`);
    expect(c1.body.status).toBe('failed');
    const p1 = await throwing('GET', `/payments/${c1.body.id}`);
    expectContract('/payments/{id}', 'get', p1);
    expect(p1.body).toMatchObject({ status: 'failed', mpesa_receipt: null });
    expect(p1.body.failure_reason).toMatch(/not been charged/);

    const rejecting = makeApi({ provider: fakeProvider({ initiate: async () => ({ status: 'failed', failureReason: 'Invalid phone.' }) }).provider });
    const c2 = await rejecting('POST', `/payments/${await draft(rejecting)}/confirm`);
    expect((await rejecting('GET', `/payments/${c2.body.id}`)).body.failure_reason).toBe('Invalid phone.');
  });
});

describe('PayHero callback', () => {
  async function pendingPayment() {
    const api = makeApi();
    const cid = (await api('POST', '/payments', { body: draftBody })).body.confirmation_id;
    const c = await api('POST', `/payments/${cid}/confirm`);
    return { api, id: c.body.id as string };
  }
  const cb = (id: string, extra: Record<string, unknown> = {}) => ({
    status: true,
    response: { ExternalReference: id, CheckoutRequestID: `ws_CO_${id}`, ResultCode: 0, ResultDesc: 'ok', MpesaReceiptNumber: 'SKL4H7QW2P', Amount: 500, Status: 'Success', ...extra },
  });

  it('rejects a callback without the secret token', async () => {
    const { api, id } = await pendingPayment();
    const r = await api('POST', '/webhooks/payhero?token=wrong', { body: cb(id), session: null });
    expect(r.status).toBe(401);
    expectContract('/webhooks/payhero', 'post', r);
    expect((await api('GET', `/payments/${id}`)).body.status).toBe('pending');
  });

  it('marks success exactly once with the M-Pesa receipt, ignoring replays', async () => {
    const { api, id } = await pendingPayment();
    const r = await api('POST', '/webhooks/payhero?token=cb-secret', { body: cb(id), session: null });
    expect(r.status).toBe(200);
    expectContract('/webhooks/payhero', 'post', r);
    const p = await api('GET', `/payments/${id}`);
    expectContract('/payments/{id}', 'get', p);
    expect(p.body).toMatchObject({ status: 'success', mpesa_receipt: 'SKL4H7QW2P' });
    const replay = await api('POST', '/webhooks/payhero?token=cb-secret', { body: cb(id, { ResultCode: 1032, Status: 'Failed' }), session: null });
    expect(replay.status).toBe(200);
    expect((await api('GET', `/payments/${id}`)).body.status).toBe('success');
  });

  it('records failure reasons, and treats an amount mismatch as failed', async () => {
    const a = await pendingPayment();
    await a.api('POST', '/webhooks/payhero?token=cb-secret', { body: cb(a.id, { ResultCode: 1032, ResultDesc: 'Request cancelled by user', Status: 'Failed' }), session: null });
    expect((await a.api('GET', `/payments/${a.id}`)).body).toMatchObject({ status: 'failed', failure_reason: 'Request cancelled by user' });

    await resetDb();
    const b = await pendingPayment();
    await b.api('POST', '/webhooks/payhero?token=cb-secret', { body: cb(b.id, { Amount: 1 }), session: null });
    expect((await b.api('GET', `/payments/${b.id}`)).body).toMatchObject({ status: 'failed', failure_reason: 'The amount paid did not match the request.' });
  });

  it('rejects a callback whose CheckoutRequestID does not match', async () => {
    const { api, id } = await pendingPayment();
    const r = await api('POST', '/webhooks/payhero?token=cb-secret', { body: cb(id, { CheckoutRequestID: 'ws_CO_other' }), session: null });
    expect(r.status).toBe(400);
    expect((await api('GET', `/payments/${id}`)).body.status).toBe('pending');
  });
});

describe('simulated mode', () => {
  it('settles to success after the delay, and to failed for the test number', async () => {
    const api = makeApi({ env: { PROVIDER_MODE: 'simulated' }, provider: simulatedProvider });
    const ok = await api('POST', `/payments/${(await api('POST', '/payments', { body: draftBody })).body.confirmation_id}/confirm`);
    const bad = await api('POST', `/payments/${(await api('POST', '/payments', { body: { ...draftBody, phone: '+254700000000' } })).body.confirmation_id}/confirm`);
    expect((await api('GET', `/payments/${ok.body.id}`)).body.status).toBe('pending');
    await sql`update public.payments set created_at = now() - interval '11 seconds'`;
    const p = await api('GET', `/payments/${ok.body.id}`);
    expectContract('/payments/{id}', 'get', p);
    expect(p.body).toMatchObject({ status: 'success', provider: 'simulated' });
    expect(p.body.mpesa_receipt).toMatch(/^SIM/);
    expect((await api('GET', `/payments/${bad.body.id}`)).body.status).toBe('failed');
  });
});

describe('listings', () => {
  async function seed(api: ReturnType<typeof makeApi>) {
    for (const [session, amount] of [[SESSION_A, 100], [SESSION_A, 200], [SESSION_B, 300]] as const) {
      const cid = (await api('POST', '/payments', { body: { ...draftBody, amount }, session })).body.confirmation_id;
      await api('POST', `/payments/${cid}/confirm`, { session, ip: `10.0.0.${amount}` });
    }
  }

  it('customers see only their own payments', async () => {
    const api = makeApi();
    await seed(api);
    const r = await api('GET', '/transactions');
    expectContract('/transactions', 'get', r);
    expect(r.body.items.map((i: { amount: number }) => i.amount)).toEqual([200, 100]);
    expect(r.body.pagination.total).toBe(2);
    expect(r.body.items[0].phone).toBe('+254712345678');
  });

  it('the merchant view sees everything with other browsers\' phones masked, plus totals', async () => {
    const api = makeApi();
    await seed(api);
    const r = await api('GET', '/merchant/transactions?limit=10');
    expectContract('/merchant/transactions', 'get', r);
    expect(r.body.items).toHaveLength(3);
    const b = r.body.items.find((i: { amount: number }) => i.amount === 300);
    expect(b.phone).toBe('+2547******78');
    const s = await api('GET', '/merchant/summary');
    expectContract('/merchant/summary', 'get', s);
    expect(s.body).toMatchObject({ total_received: 0, pending: { count: 3, total: 600 } });
    const other = await api('GET', `/payments/${b.id}`);
    expect(other.body.phone).toBe('+2547******78');
  });

  it('validates query parameters', async () => {
    const api = makeApi();
    const r = await api('GET', '/transactions?status=done');
    expect(r.status).toBe(400);
    expectContract('/transactions', 'get', r);
  });
});

describe('assistant', () => {
  it('asks for missing fields, then drafts with a server-written reply, never confirming', async () => {
    const fake = fakeProvider();
    const assistant = fakeAssistant((h) =>
      h.length === 1
        ? { amount: 500, recipient: 'John', reply: 'What is the number?' }
        : { amount: 500, recipient: 'John', phone: '0712 345 678', ready_to_review: true, reply: 'Payment sent!' },
    );
    const api = makeApi({ provider: fake.provider, assistant });
    const a1 = await api('POST', '/assistant/messages', { body: { message: 'send 500 to John' } });
    expect(a1.status).toBe(200);
    expectContract('/assistant/messages', 'post', a1);
    expect(a1.body.missing_fields).toEqual(['phone']);
    expect(a1.body.confirmation_id).toBeNull();

    const a2 = await api('POST', '/assistant/messages', { body: { message: '0712 345 678', conversation_id: a1.body.conversation_id } });
    expectContract('/assistant/messages', 'post', a2);
    expect(a2.body.payment_summary).toMatchObject({ amount: 500, recipient: 'John', phone: '+254712345678' });
    expect(a2.body.reply).not.toMatch(/sent!/);
    expect(a2.body.reply).toMatch(/Nothing has been paid yet/);
    expect(fake.calls).toHaveLength(0);
    expect((await sql`select count(*)::int as n from public.payments`)[0]!.n).toBe(0);
    const stored = await sql`select content from public.messages where role = 'assistant' order by created_at desc limit 1`;
    expect(stored[0]!.content).toContain(DRAFT_MARKER);
  });

  it('enforces the demo cap and rejects bad phone numbers in chat', async () => {
    const api = makeApi({ assistant: fakeAssistant(() => ({ amount: 5000, recipient: 'Mary', phone: '0712345678', ready_to_review: true })) });
    const r = await api('POST', '/assistant/messages', { body: { message: 'pay mary 5k' } });
    expect(r.body.missing_fields).toEqual(['amount']);
    expect(r.body.reply).toMatch(/up to KES 1,000/);
    expect(r.body.confirmation_id).toBeNull();
  });

  it('handles refusals, failures and foreign conversations', async () => {
    const refusing = makeApi({ assistant: fakeAssistant(() => 'refuse') });
    const r = await refusing('POST', '/assistant/messages', { body: { message: 'x' } });
    expect(r.body.reply).toMatch(/can't help/);

    const broken = makeApi({ assistant: fakeAssistant(() => 'throw') });
    const b = await broken('POST', '/assistant/messages', { body: { message: 'hi' } });
    expect(b.status).toBe(502);
    expectContract('/assistant/messages', 'post', b);

    const api = makeApi();
    const mine = await api('POST', '/assistant/messages', { body: { message: 'hi' } });
    const theirs = await api('POST', '/assistant/messages', { body: { message: 'hi', conversation_id: mine.body.conversation_id }, session: SESSION_B });
    expect(theirs.status).toBe(404);
  });

  it('rule-based fallback handles the demo script', async () => {
    const api = makeApi({ assistant: rulesModel });
    const a1 = await api('POST', '/assistant/messages', { body: { message: 'send 500 to John' } });
    expect(a1.body).toMatchObject({ missing_fields: ['phone'], assistant_mode: 'rules' });
    const a2 = await api('POST', '/assistant/messages', { body: { message: '0712 345 678', conversation_id: a1.body.conversation_id } });
    expect(a2.body.payment_summary).toMatchObject({ amount: 500, recipient: 'John', phone: '+254712345678' });
    const a3 = await api('POST', '/assistant/messages', { body: { message: 'pay 1k to Mary 0722000333', conversation_id: a1.body.conversation_id } });
    expect(a3.body.payment_summary).toMatchObject({ amount: 1000, recipient: 'Mary' });
    const a4 = await api('POST', '/assistant/messages', { body: { message: 'cancel that', conversation_id: a1.body.conversation_id } });
    expect(a4.body.payment_summary).toBeNull();
  });
});

describe('PayHero adapter (matches PayHero docs)', () => {
  const payment = {
    id: 'pay_test123', draft_id: 'cnf_x', session_id: SESSION_A, ip_hash: 'h', kind: 'payment' as const, status: 'pending' as const,
    amount: 100, fee: 0, phone: '+254787677676', recipient: 'John', reference: null, provider: 'payhero',
    provider_reference: null, mpesa_receipt: null, paid_at: null, failure_reason: null, created_at: new Date(), updated_at: new Date(),
  };
  const env = {
    PROVIDER_MODE: 'live',
    PAYHERO_AUTH_TOKEN: 'Basic dG9rZW4=',
    PAYHERO_CHANNEL_ID: '133',
    PAYHERO_CALLBACK_URL: 'https://ref.supabase.co/functions/v1/api/webhooks/payhero',
    PAYHERO_CALLBACK_TOKEN: 'cb-secret',
  };
  function capture(status: number, body: unknown) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    return { calls, fetchFn };
  }

  it('sends the documented STK Push request and stores the CheckoutRequestID', async () => {
    const { calls, fetchFn } = capture(201, { success: true, status: 'QUEUED', reference: 'E8UWT7CLUW', CheckoutRequestID: 'ws_CO_15012024164321519708344109' });
    const provider = createPayHeroProvider(loadConfig((k) => (env as Record<string, string>)[k]), fetchFn);
    const r = await provider.initiate(payment);
    expect(r).toEqual({ status: 'pending', providerReference: 'ws_CO_15012024164321519708344109' });
    expect(calls[0]!.url).toBe('https://backend.payhero.co.ke/api/v2/payments');
    expect(calls[0]!.init.method).toBe('POST');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Basic dG9rZW4=');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      amount: 100,
      phone_number: '0787677676',
      channel_id: 133,
      provider: 'm-pesa',
      external_reference: 'pay_test123',
      callback_url: 'https://ref.supabase.co/functions/v1/api/webhooks/payhero?token=cb-secret',
    });
  });

  it('accepts the auth token without the "Basic " prefix too', async () => {
    const { calls, fetchFn } = capture(201, { success: true, CheckoutRequestID: 'ws_1' });
    await createPayHeroProvider(loadConfig((k) => ({ ...env, PAYHERO_AUTH_TOKEN: 'dG9rZW4=' } as Record<string, string>)[k]), fetchFn).initiate(payment);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Basic dG9rZW4=');
  });

  it.each([
    ['an HTTP error', 401, { message: 'Unauthorized' }],
    ['success: false', 201, { success: false }],
  ])('fails (never succeeds) on %s', async (_n, status, body) => {
    const { fetchFn } = capture(status, body);
    const r = await createPayHeroProvider(loadConfig((k) => (env as Record<string, string>)[k]), fetchFn).initiate(payment);
    expect(r.status).toBe('failed');
  });

  it('fails clearly when not configured, without calling PayHero', async () => {
    const { calls, fetchFn } = capture(201, {});
    const r = await createPayHeroProvider(loadConfig((k) => ({ PROVIDER_MODE: 'live' } as Record<string, string>)[k]), fetchFn).initiate(payment);
    expect(r).toMatchObject({ status: 'failed', failureReason: expect.stringMatching(/not configured/) });
    expect(calls).toHaveLength(0);
  });

  it('parses the documented callback body exactly', () => {
    const doc = {
      forward_url: '',
      response: {
        Amount: 10,
        CheckoutRequestID: 'ws_CO_14012024103543427709099876',
        ExternalReference: 'INV-009',
        MerchantRequestID: '3202-70921557-1',
        MpesaReceiptNumber: 'SAE3YULR0Y',
        Phone: '+254709099876',
        ResultCode: 0,
        ResultDesc: 'The service request is processed successfully.',
        Status: 'Success',
      },
      status: true,
    };
    expect(parsePayHeroCallback(doc)).toEqual({
      paymentId: 'INV-009',
      providerReference: 'ws_CO_14012024103543427709099876',
      success: true,
      receipt: 'SAE3YULR0Y',
      amount: 10,
      reason: null,
    });
  });

  it('rejects PROVIDER_MODE=sandbox because PayHero has no sandbox', () => {
    expect(() => loadConfig((k) => ({ PROVIDER_MODE: 'sandbox' } as Record<string, string>)[k])).toThrow(/no sandbox/);
  });

  it('limits prompts to one phone number', async () => {
    const api = makeApi({ env: { RATE_LIMIT_PER_PHONE: '2' } });
    for (let i = 0; i < 2; i++) {
      const s = `sessP${i}_0123456789abcdef`;
      const cid = (await api('POST', '/payments', { body: draftBody, session: s })).body.confirmation_id;
      expect((await api('POST', `/payments/${cid}/confirm`, { session: s, ip: `10.1.1.${i}` })).status).toBe(200);
    }
    const s = 'sessP9_0123456789abcdef';
    const cid = (await api('POST', '/payments', { body: draftBody, session: s })).body.confirmation_id;
    const blocked = await api('POST', `/payments/${cid}/confirm`, { session: s, ip: '10.1.1.9' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.message).toMatch(/this number/);
  });
});
