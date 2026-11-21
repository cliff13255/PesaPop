import { beforeEach, describe, expect, it } from 'vitest';
import type { PaymentStatus } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';
import { newId } from '../src/lib/ids.js';
import { createUser, expectContract, fakeProviders, makeApp, resetDb } from './helpers.js';

beforeEach(resetDb);

/** Inserts a confirmed payment directly (as a provider callback would leave it). */
async function insertPayment(userId: string, status: PaymentStatus, amount: number, opts: { merchantId?: string; minutesAgo?: number } = {}) {
  const draft = await prisma.paymentDraft.create({
    data: {
      id: newId('cnf'),
      userId,
      method: 'mpesa_stk',
      amount,
      phone: '+254712345678',
      recipient: 'Shop',
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  return prisma.payment.create({
    data: {
      id: newId('pay'),
      userId,
      draftId: draft.id,
      merchantId: opts.merchantId ?? null,
      status,
      method: 'mpesa_stk',
      amount,
      fee: 0,
      phone: draft.phone,
      recipient: draft.recipient,
      provider: 'test',
      mpesaReceipt: status === 'success' ? `S${Math.random().toString(36).slice(2, 11).toUpperCase()}` : null,
      createdAt: new Date(Date.now() - (opts.minutesAgo ?? 0) * 60_000),
    },
  });
}

describe('GET /transactions', () => {
  it('paginates newest first and only shows the caller\'s payments', async () => {
    const me = await createUser();
    const other = await createUser();
    for (let i = 0; i < 7; i++) await insertPayment(me.user.id, 'success', 100 + i, { minutesAgo: i });
    await insertPayment(other.user.id, 'success', 9999);

    const api = makeApp();
    const page1 = await api.get('/transactions?limit=3').set(me.auth);
    expect(page1.status).toBe(200);
    expectContract('/transactions', 'get', page1);
    expect(page1.body.pagination).toEqual({ page: 1, limit: 3, total: 7, total_pages: 3 });
    expect(page1.body.items.map((i: { amount: number }) => i.amount)).toEqual([100, 101, 102]);
    expect(page1.body.items[0].reference).toMatch(/^S/);

    const page3 = await api.get('/transactions?limit=3&page=3').set(me.auth);
    expect(page3.body.items).toHaveLength(1);
    expect(page3.body.items.some((i: { amount: number }) => i.amount === 9999)).toBe(false);
  });

  it('filters by status, and empty status means all', async () => {
    const me = await createUser();
    await insertPayment(me.user.id, 'success', 100);
    await insertPayment(me.user.id, 'failed', 200);
    await insertPayment(me.user.id, 'pending', 300);
    const api = makeApp();
    const failed = await api.get('/transactions?status=failed').set(me.auth);
    expectContract('/transactions', 'get', failed);
    expect(failed.body.items.map((i: { status: string }) => i.status)).toEqual(['failed']);
    const all = await api.get('/transactions?status=').set(me.auth);
    expect(all.body.pagination.total).toBe(3);
  });

  it('shows merchants the payments they received', async () => {
    const merchant = await createUser('merchant');
    const customer = await createUser();
    await insertPayment(customer.user.id, 'success', 750, { merchantId: merchant.user.id });
    const res = await makeApp().get('/transactions').set(merchant.auth);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].amount).toBe(750);
  });

  it.each([['status=done'], ['page=0'], ['limit=101'], ['page=abc']])('rejects %s', async (qs) => {
    const me = await createUser();
    const res = await makeApp().get(`/transactions?${qs}`).set(me.auth);
    expect(res.status).toBe(400);
    expectContract('/transactions', 'get', res);
  });

  it('returns an empty page, not an error, when there is nothing', async () => {
    const me = await createUser();
    const res = await makeApp().get('/transactions').set(me.auth);
    expect(res.body).toEqual({ items: [], pagination: { page: 1, limit: 20, total: 0, total_pages: 0 } });
  });
});

describe('GET /merchant/summary', () => {
  it('returns counts and KES totals by status', async () => {
    const merchant = await createUser('merchant');
    const customer = await createUser();
    const m = { merchantId: merchant.user.id };
    await insertPayment(customer.user.id, 'success', 1000, m);
    await insertPayment(customer.user.id, 'success', 2500, m);
    await insertPayment(customer.user.id, 'pending', 300, m);
    await insertPayment(customer.user.id, 'failed', 50, m);
    await insertPayment(customer.user.id, 'success', 99999); // not this merchant's
    const res = await makeApp().get('/merchant/summary').set(merchant.auth);
    expect(res.status).toBe(200);
    expectContract('/merchant/summary', 'get', res);
    expect(res.body).toEqual({
      currency: 'KES',
      total_received: 3500,
      success: { count: 2, total: 3500 },
      pending: { count: 1, total: 300 },
      failed: { count: 1, total: 50 },
    });
  });

  it('is zeroed for a new merchant and forbidden to customers', async () => {
    const merchant = await createUser('merchant');
    const customer = await createUser();
    const api = makeApp();
    const empty = await api.get('/merchant/summary').set(merchant.auth);
    expect(empty.body.total_received).toBe(0);
    const forbidden = await api.get('/merchant/summary').set(customer.auth);
    expect(forbidden.status).toBe(403);
    expectContract('/merchant/summary', 'get', forbidden);
  });
});

describe('/payment-requests', () => {
  const body = { amount: 2500, customer_phone: '+254711222333', description: 'Invoice #1050: 5 crates of eggs' };

  it('creates a request (link null until Lipwa is wired) and lists it', async () => {
    const merchant = await createUser('merchant');
    const api = makeApp();
    const created = await api.post('/payment-requests').set(merchant.auth).send(body);
    expect(created.status).toBe(201);
    expectContract('/payment-requests', 'post', created);
    expect(created.body).toMatchObject({ amount: 2500, status: 'pending', link: null });

    const list = await api.get('/payment-requests').set(merchant.auth);
    expectContract('/payment-requests', 'get', list);
    expect(list.body.items.map((r: { id: string }) => r.id)).toEqual([created.body.id]);
  });

  it('stores the link from the link provider, and survives a link provider error', async () => {
    const merchant = await createUser('merchant');
    const ok = fakeProviders({}, { createLink: async (r) => `https://lipwa.link/p/${r.id}` });
    const res = await makeApp(ok.providers).post('/payment-requests').set(merchant.auth).send(body);
    expect(res.body.link).toBe(`https://lipwa.link/p/${res.body.id}`);

    const broken = fakeProviders({}, { createLink: async () => { throw new Error('down'); } });
    const res2 = await makeApp(broken.providers).post('/payment-requests').set(merchant.auth).send(body);
    expect(res2.status).toBe(201);
    expect(res2.body.link).toBeNull();
  });

  it("only lists the merchant's own requests", async () => {
    const a = await createUser('merchant');
    const b = await createUser('merchant');
    const api = makeApp();
    await api.post('/payment-requests').set(a.auth).send(body);
    const res = await api.get('/payment-requests').set(b.auth);
    expect(res.body.items).toEqual([]);
  });

  it('is forbidden to customers and validates input', async () => {
    const customer = await createUser();
    const merchant = await createUser('merchant');
    const api = makeApp();
    const post = await api.post('/payment-requests').set(customer.auth).send(body);
    expect(post.status).toBe(403);
    expectContract('/payment-requests', 'post', post);
    expect((await api.get('/payment-requests').set(customer.auth)).status).toBe(403);
    const bad = await api.post('/payment-requests').set(merchant.auth).send({ ...body, customer_phone: '0711222333' });
    expect(bad.status).toBe(400);
    expectContract('/payment-requests', 'post', bad);
  });
});
