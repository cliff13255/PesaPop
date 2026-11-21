import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import postgres from 'postgres';
import { expect } from 'vitest';
import { createHandler } from '../supabase/functions/_shared/app.ts';
import type { AssistantModel, Extraction } from '../supabase/functions/_shared/assistant.ts';
import { loadConfig } from '../supabase/functions/_shared/config.ts';
import type { PaymentProvider } from '../supabase/functions/_shared/providers.ts';

export const sql = postgres(process.env.TEST_DATABASE_URL!, { prepare: false, onnotice: () => {} });

export async function resetDb() {
  await sql`truncate public.messages, public.conversations, public.payments, public.payment_drafts cascade`;
}

// ---------- contract check against docs/openapi.yaml ----------
const spec = YAML.parse(readFileSync('docs/openapi.yaml', 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ?? addFormatsModule) as (a: Ajv2020) => void;
addFormats(ajv);
ajv.addSchema(spec, 'spec');
const deref = (o: any): any => {
  while (o?.$ref) o = o.$ref.slice(2).split('/').reduce((x: any, k: string) => x[k], spec);
  return o;
};
export function expectContract(path: string, method: string, res: { status: number; body: unknown }) {
  const op = spec.paths[path]?.[method];
  expect(op, `spec has no ${method} ${path}`).toBeTruthy();
  const r = deref(op.responses[String(res.status)]);
  expect(r, `spec documents no ${res.status} for ${method} ${path}`).toBeTruthy();
  const schema = r.content['application/json'].schema;
  const validate = schema.$ref ? ajv.getSchema(`spec${schema.$ref}`)! : ajv.compile(schema);
  expect(validate(res.body), `${method} ${path} ${res.status}: ${ajv.errorsText(validate.errors)}\n${JSON.stringify(res.body)}`).toBe(true);
}

// ---------- fakes ----------
export function fakeProvider(overrides: Partial<PaymentProvider> = {}) {
  const calls: string[] = [];
  const provider: PaymentProvider = {
    name: 'payhero',
    async initiate(p) {
      calls.push(p.id);
      return { status: 'pending', providerReference: `ws_CO_${p.id}` };
    },
    ...overrides,
  };
  return { provider, calls };
}

export function fakeAssistant(script: (history: { role: string; content: string }[]) => Partial<Extraction> | 'refuse' | 'throw') {
  const model: AssistantModel = {
    mode: 'claude',
    async extract(history) {
      const out = script(history);
      if (out === 'throw') throw new Error('boom');
      if (out === 'refuse') return { kind: 'refused' };
      return {
        kind: 'ok',
        extraction: { action: 'collect', reply: 'ok', amount: null, recipient: null, phone: null, reference: null, ready_to_review: false, ...out },
      };
    },
  };
  return model;
}

export function makeApi(opts: { env?: Record<string, string>; provider?: PaymentProvider; assistant?: AssistantModel } = {}) {
  const config = loadConfig((k) => ({ PROVIDER_MODE: 'live', PAYHERO_CALLBACK_TOKEN: 'cb-secret', ...opts.env })[k]);
  const handler = createHandler({
    sql,
    config,
    provider: opts.provider ?? fakeProvider().provider,
    assistant: opts.assistant ?? fakeAssistant(() => ({})),
  });
  return async function call(method: string, path: string, init: { body?: unknown; session?: string | null; headers?: Record<string, string>; ip?: string } = {}) {
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': init.ip ?? '10.0.0.1', ...init.headers };
    if (init.session !== null) headers['x-demo-session'] = init.session ?? SESSION_A;
    const res = await handler(new Request(`http://test/functions/v1/api${path}`, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }));
    return { status: res.status, body: (await res.json().catch(() => null)) as any, headers: res.headers };
  };
}

export const SESSION_A = 'sessA_0123456789abcdef';
export const SESSION_B = 'sessB_0123456789abcdef';
export const draftBody = { amount: 500, phone: '+254712345678', recipient: 'Kenya Power', reference: 'ACC-1' };
