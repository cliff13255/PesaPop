import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import request from 'supertest';
import { expect } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { issueToken } from '../src/services/auth.service.js';
import { newId } from '../src/lib/ids.js';
import type { Providers, PaymentProvider, PaymentLinkProvider } from '../src/services/providers/types.js';
import type { Role } from '@prisma/client';

// ---------- OpenAPI contract check ----------
const spec = YAML.parse(readFileSync(fileURLToPath(new URL('../../docs/openapi.yaml', import.meta.url)), 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
const addFormats = (addFormatsModule as unknown as { default?: typeof addFormatsModule }).default ?? addFormatsModule;
(addFormats as unknown as (a: Ajv2020) => void)(ajv);
ajv.addSchema(spec, 'spec');

const deref = (obj: any): any => {
  while (obj?.$ref) obj = obj.$ref.slice(2).split('/').reduce((o: any, k: string) => o[k], spec);
  return obj;
};

/** Fails the test if body does not match the documented response. */
export function expectContract(path: string, method: string, res: { status: number; body: unknown }) {
  const op = spec.paths[path]?.[method];
  expect(op, `spec has no ${method.toUpperCase()} ${path}`).toBeTruthy();
  const resp = deref(op.responses[String(res.status)]);
  expect(resp, `spec documents no ${res.status} for ${method.toUpperCase()} ${path}`).toBeTruthy();
  const ref = resp.content['application/json'].schema.$ref as string;
  const validate = ajv.getSchema(`spec${ref}`)!;
  const ok = validate(res.body);
  expect(ok, `${method.toUpperCase()} ${path} ${res.status} violates spec: ${ajv.errorsText(validate.errors)}\n${JSON.stringify(res.body, null, 2)}`).toBe(true);
}

// ---------- fakes ----------
export function fakeProviders(overrides: Partial<PaymentProvider> = {}, link?: Partial<PaymentLinkProvider>) {
  const calls: string[] = [];
  const payment: PaymentProvider = {
    name: 'fake',
    async initiate(p) {
      calls.push(p.id);
      return { status: 'pending', providerReference: `ref_${p.id}` };
    },
    ...overrides,
  };
  const providers: Providers = {
    payment: () => payment,
    link: { name: 'fake-link', createLink: async () => null, ...link },
  };
  return { providers, calls };
}

export function makeApp(providers?: Providers) {
  return request(createApp({ providers: providers ?? fakeProviders().providers }));
}

// ---------- data ----------
export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Message","Conversation","Payment","PaymentDraft","PaymentRequest","User" RESTART IDENTITY CASCADE',
  );
}

let counter = 0;
export async function createUser(role: Role = 'customer') {
  counter += 1;
  const n = String(counter).padStart(8, '0');
  const user = await prisma.user.create({
    data: {
      id: newId('usr'),
      name: `Test ${role} ${counter}`,
      phone: `+2547${n}`,
      email: `${role}${counter}-${Date.now()}@example.co.ke`,
      role,
      passwordHash: 'not-a-real-hash',
    },
  });
  return { user, token: issueToken(user), auth: { Authorization: `Bearer ${issueToken(user)}` } };
}

export const draftBody = {
  method: 'mpesa_stk',
  amount: 500,
  phone: '+254712345678',
  recipient: 'Kenya Power',
  reference: 'ACC-104233',
};
