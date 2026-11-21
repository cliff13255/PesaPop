import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { createUser, draftBody, expectContract, fakeProviders, makeApp, resetDb } from './helpers.js';

beforeEach(resetDb);

describe('POST /payments (draft)', () => {
  it('creates a draft and does NOT contact the provider or create a payment', async () => {
    const { auth } = await createUser();
    const { providers, calls } = fakeProviders();
    const res = await makeApp(providers).post('/payments').set(auth).send(draftBody);
    expect(res.status).toBe(201);
    expectContract('/payments', 'post', res);
    expect(res.body.payment_summary).toMatchObject({ amount: 500, fee: 0, total: 500, currency: 'KES', recipient: 'Kenya Power' });
    const expiresIn = Date.parse(res.body.payment_summary.expires_at) - Date.now();
    expect(expiresIn).toBeGreaterThan(9 * 60_000);
    expect(expiresIn).toBeLessThanOrEqual(10 * 60_000);
    expect(calls).toHaveLength(0);
    expect(await prisma.payment.count()).toBe(0);
  });

  it('reference is optional and comes back as null', async () => {
    const { auth } = await createUser();
    const { reference, ...noRef } = draftBody;
    const res = await makeApp().post('/payments').set(auth).send(noRef);
    expect(res.status).toBe(201);
    expect(res.body.payment_summary.reference).toBeNull();
  });

  it.each([
    ['decimal amount', { amount: 10.5 }, 'amount'],
    ['string amount', { amount: '500' }, 'amount'],
    ['zero amount', { amount: 0 }, 'amount'],
    ['bad phone', { phone: '+255712345678' }, 'phone'],
    ['bad method', { method: 'cash' }, 'method'],
    ['missing recipient', { recipient: undefined }, 'recipient'],
  ])('rejects %s', async (_n, patch, field) => {
    const { auth } = await createUser();
    const res = await makeApp().post('/payments').set(auth).send({ ...draftBody, ...patch });
    expect(res.status).toBe(400);
    expectContract('/payments', 'post', res);
    expect(res.body.error.message).toContain(field);
  });

  it('requires auth', async () => {
    const res = await makeApp().post('/payments').send(draftBody);
    expect(res.status).toBe(401);
  });
});

describe('POST /payments/{confirmation_id}/confirm', () => {
  async function draft(auth: Record<string, string>, providers = fakeProviders().providers) {
    const api = makeApp(providers);
    const res = await api.post('/payments').set(auth).send(draftBody);
    return { api, confirmationId: res.body.confirmation_id as string };
  }

  it('creates a pending payment and calls the provider once', async () => {
    const { auth } = await createUser();
    const fake = fakeProviders();
    const { api, confirmationId } = await draft(auth, fake.providers);
    const res = await api.post(`/payments/${confirmationId}/confirm`).set(auth);
    expect(res.status).toBe(200);
    expectContract('/payments/{confirmation_id}/confirm', 'post', res);
    expect(res.body).toMatchObject({ status: 'pending', confirmation_id: confirmationId });
    expect(fake.calls).toEqual([res.body.id]);
    const row = await prisma.payment.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.providerReference).toBe(`ref_${res.body.id}`);
  });

  it('is idempotent: confirming twice returns the same payment and never charges twice', async () => {
    const { auth } = await createUser();
    const fake = fakeProviders();
    const { api, confirmationId } = await draft(auth, fake.providers);
    const first = await api.post(`/payments/${confirmationId}/confirm`).set(auth);
    const second = await api.post(`/payments/${confirmationId}/confirm`).set(auth);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(fake.calls).toHaveLength(1);
    expect(await prisma.payment.count()).toBe(1);
  });

  it('is idempotent under a double tap (concurrent confirms)', async () => {
    const { auth } = await createUser();
    const fake = fakeProviders();
    const { api, confirmationId } = await draft(auth, fake.providers);
    const results = await Promise.all(Array.from({ length: 6 }, () => api.post(`/payments/${confirmationId}/confirm`).set(auth)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(fake.calls).toHaveLength(1);
    expect(await prisma.payment.count()).toBe(1);
  });

  it("returns 404 for another user's draft and does not charge", async () => {
    const owner = await createUser();
    const other = await createUser();
    const fake = fakeProviders();
    const { api, confirmationId } = await draft(owner.auth, fake.providers);
    const res = await api.post(`/payments/${confirmationId}/confirm`).set(other.auth);
    expect(res.status).toBe(404);
    expectContract('/payments/{confirmation_id}/confirm', 'post', res);
    expect(fake.calls).toHaveLength(0);
  });

  it('returns 404 for an unknown confirmation_id', async () => {
    const { auth } = await createUser();
    const res = await makeApp().post('/payments/cnf_nope/confirm').set(auth);
    expect(res.status).toBe(404);
  });

  it('returns 410 for an expired draft and does not charge', async () => {
    const { auth } = await createUser();
    const fake = fakeProviders();
    const { api, confirmationId } = await draft(auth, fake.providers);
    await prisma.paymentDraft.update({ where: { id: confirmationId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await api.post(`/payments/${confirmationId}/confirm`).set(auth);
    expect(res.status).toBe(410);
    expectContract('/payments/{confirmation_id}/confirm', 'post', res);
    expect(res.body.error.code).toBe('draft_expired');
    expect(fake.calls).toHaveLength(0);
  });

  it('marks the payment failed (never success) when the provider throws', async () => {
    const { auth } = await createUser();
    const fake = fakeProviders({
      async initiate() {
        throw new Error('ECONNRESET');
      },
    });
    const { api, confirmationId } = await draft(auth, fake.providers);
    const res = await api.post(`/payments/${confirmationId}/confirm`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('failed');
    const p = await api.get(`/payments/${res.body.id}`).set(auth);
    expectContract('/payments/{id}', 'get', p);
    expect(p.body.status).toBe('failed');
    expect(p.body.failure_reason).toMatch(/not been charged/);
    expect(p.body.receipt).toBeNull();
  });

  it('records the reason when the provider rejects the payment', async () => {
    const { auth } = await createUser();
    const fake = fakeProviders({ initiate: async () => ({ status: 'failed', failureReason: 'Invalid phone number.' }) });
    const { api, confirmationId } = await draft(auth, fake.providers);
    const res = await api.post(`/payments/${confirmationId}/confirm`).set(auth);
    const p = await api.get(`/payments/${res.body.id}`).set(auth);
    expect(p.body).toMatchObject({ status: 'failed', failure_reason: 'Invalid phone number.' });
  });
});

describe('GET /payments/{id}', () => {
  it('returns the payment to its owner, with a receipt only on success', async () => {
    const { auth } = await createUser();
    const api = makeApp();
    const d = await api.post('/payments').set(auth).send(draftBody);
    const c = await api.post(`/payments/${d.body.confirmation_id}/confirm`).set(auth);
    const pending = await api.get(`/payments/${c.body.id}`).set(auth);
    expect(pending.status).toBe(200);
    expectContract('/payments/{id}', 'get', pending);
    expect(pending.body).toMatchObject({ status: 'pending', receipt: null, amount: 500, total: 500 });

    await prisma.payment.update({
      where: { id: c.body.id },
      data: { status: 'success', mpesaReceipt: 'SKL4H7QW2P', paidAt: new Date() },
    });
    const done = await api.get(`/payments/${c.body.id}`).set(auth);
    expectContract('/payments/{id}', 'get', done);
    expect(done.body.receipt).toMatchObject({ provider: 'mpesa', mpesa_receipt: 'SKL4H7QW2P' });
  });

  it("returns 404 for someone else's payment", async () => {
    const owner = await createUser();
    const other = await createUser();
    const api = makeApp();
    const d = await api.post('/payments').set(owner.auth).send(draftBody);
    const c = await api.post(`/payments/${d.body.confirmation_id}/confirm`).set(owner.auth);
    const res = await api.get(`/payments/${c.body.id}`).set(other.auth);
    expect(res.status).toBe(404);
    expectContract('/payments/{id}', 'get', res);
  });
});
