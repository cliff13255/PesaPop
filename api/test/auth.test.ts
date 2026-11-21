import { beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { prisma } from '../src/lib/prisma.js';
import { createUser, expectContract, makeApp, resetDb } from './helpers.js';

const body = {
  name: 'Otieno Ouma',
  phone: '+254733111222',
  email: 'Otieno@Example.co.ke',
  password: 'supersecret1',
  role: 'customer',
};

beforeEach(resetDb);

describe('POST /auth/register', () => {
  it('creates a customer and returns a working token', async () => {
    const api = makeApp();
    const res = await api.post('/auth/register').send(body);
    expect(res.status).toBe(201);
    expectContract('/auth/register', 'post', res);
    expect(res.body.user.email).toBe('otieno@example.co.ke');
    expect(JSON.stringify(res.body)).not.toContain('password');

    const me = await api.get('/me').set('Authorization', `Bearer ${res.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(res.body.user.id);
  });

  it('creates a merchant', async () => {
    const res = await makeApp().post('/auth/register').send({ ...body, role: 'merchant' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('merchant');
  });

  it('stores a bcrypt hash, not the password', async () => {
    const res = await makeApp().post('/auth/register').send(body);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: res.body.user.id } });
    expect(row.passwordHash).not.toBe(body.password);
    expect(row.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('rejects a duplicate email or phone with 409', async () => {
    const api = makeApp();
    await api.post('/auth/register').send(body);
    const dupEmail = await api.post('/auth/register').send({ ...body, phone: '+254733999888' });
    expect(dupEmail.status).toBe(409);
    expectContract('/auth/register', 'post', dupEmail);
    const dupPhone = await api.post('/auth/register').send({ ...body, email: 'other@example.co.ke' });
    expect(dupPhone.status).toBe(409);
  });

  it.each([
    ['local phone format', { phone: '0712345678' }, 'phone'],
    ['short password', { password: 'short' }, 'password'],
    ['bad role', { role: 'admin' }, 'role'],
    ['bad email', { email: 'nope' }, 'email'],
    ['unknown field', { isAdmin: true }, 'isAdmin'],
  ])('rejects %s with 400', async (_name, patch, field) => {
    const res = await makeApp().post('/auth/register').send({ ...body, ...patch });
    expect(res.status).toBe(400);
    expectContract('/auth/register', 'post', res);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.message).toContain(field);
  });

  it('rejects malformed JSON with the standard error shape', async () => {
    const res = await makeApp().post('/auth/register').set('Content-Type', 'application/json').send('{"name":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });
});

describe('POST /auth/login', () => {
  it('logs in with the right password (email is case-insensitive)', async () => {
    const api = makeApp();
    await api.post('/auth/register').send(body);
    const res = await api.post('/auth/login').send({ email: 'OTIENO@example.co.ke', password: body.password });
    expect(res.status).toBe(200);
    expectContract('/auth/login', 'post', res);
  });

  it('returns 401 invalid_credentials for a wrong password or unknown email', async () => {
    const api = makeApp();
    await api.post('/auth/register').send(body);
    const wrong = await api.post('/auth/login').send({ email: body.email, password: 'wrong-password' });
    expect(wrong.status).toBe(401);
    expectContract('/auth/login', 'post', wrong);
    expect(wrong.body.error.code).toBe('invalid_credentials');
    const unknown = await api.post('/auth/login').send({ email: 'ghost@example.co.ke', password: 'whatever1' });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });
});

describe('GET /me', () => {
  it('requires a token', async () => {
    const res = await makeApp().get('/me');
    expect(res.status).toBe(401);
    expectContract('/me', 'get', res);
  });

  it('rejects garbage, wrongly-signed and expired tokens', async () => {
    const { user } = await createUser();
    const api = makeApp();
    const garbage = await api.get('/me').set('Authorization', 'Bearer not-a-jwt');
    expect(garbage.status).toBe(401);
    const forged = jwt.sign({}, 'some-other-secret-that-is-long-enough!!', { subject: user.id });
    expect((await api.get('/me').set('Authorization', `Bearer ${forged}`)).status).toBe(401);
    const expired = jwt.sign({}, process.env.JWT_SECRET!, { subject: user.id, expiresIn: -10 });
    expect((await api.get('/me').set('Authorization', `Bearer ${expired}`)).status).toBe(401);
  });

  it('rejects a token whose user no longer exists', async () => {
    const { user, auth } = await createUser();
    await prisma.user.delete({ where: { id: user.id } });
    const res = await makeApp().get('/me').set(auth);
    expect(res.status).toBe(401);
  });

  it('returns the user', async () => {
    const { user, auth } = await createUser('merchant');
    const res = await makeApp().get('/me').set(auth);
    expect(res.status).toBe(200);
    expectContract('/me', 'get', res);
    expect(res.body).toMatchObject({ id: user.id, role: 'merchant' });
  });
});

describe('system', () => {
  it('GET /health is public', async () => {
    const res = await makeApp().get('/health');
    expect(res.status).toBe(200);
    expectContract('/health', 'get', res);
  });

  it('unknown routes return the standard 404 shape', async () => {
    const res = await makeApp().get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'not_found', message: 'Route not found.' } });
  });
});
