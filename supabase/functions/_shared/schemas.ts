// Request validation. Mirrors docs/openapi.yaml; change both together.
import { z } from 'zod';

export const PHONE_RE = /^\+254(7|1)[0-9]{8}$/;
export const SESSION_RE = /^[A-Za-z0-9_-]{16,64}$/;

export const phone = z
  .string({ error: 'must be a Kenyan mobile number in the form +2547XXXXXXXX' })
  .regex(PHONE_RE, 'must be a Kenyan mobile number in the form +2547XXXXXXXX');

export const amountKES = (max: number) =>
  z
    .int({ error: 'must be a whole number of KES' })
    .min(1, 'must be at least KES 1')
    .max(max, `must be at most KES ${max.toLocaleString('en-KE')} in this demo`);

const text = (min: number, max: number) =>
  z
    .string({ error: `must be ${min}-${max} characters` })
    .trim()
    .min(min, `must be ${min}-${max} characters`)
    .max(max, `must be ${min}-${max} characters`);

export const createPaymentBody = (max: number) =>
  z.strictObject({
    amount: amountKES(max),
    phone,
    recipient: text(1, 100),
    reference: text(1, 64).optional(),
  });

export const createPaymentRequestBody = (max: number) =>
  z.strictObject({
    amount: amountKES(max),
    customer_phone: phone,
    description: text(1, 140),
  });

export const assistantBody = z.strictObject({
  message: text(1, 2000),
  conversation_id: z.string().min(1).max(64).optional(),
});

export const listQuery = z.object({
  status: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.enum(['pending', 'success', 'failed'], { error: 'must be pending, success or failed' }).optional()),
  page: z.coerce.number({ error: 'must be an integer >= 1' }).int('must be an integer >= 1').min(1, 'must be an integer >= 1').default(1),
  limit: z.coerce
    .number({ error: 'must be an integer from 1 to 100' })
    .int('must be an integer from 1 to 100')
    .min(1, 'must be an integer from 1 to 100')
    .max(100, 'must be an integer from 1 to 100')
    .default(20),
});

export type CreatePaymentInput = z.infer<ReturnType<typeof createPaymentBody>>;
export type ListQuery = z.infer<typeof listQuery>;

export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, makeError: (msg: string) => Error): T {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const issue = r.error.issues[0] as { path: PropertyKey[]; message: string; code: string; keys?: string[] } | undefined;
  if (!issue) throw makeError('Invalid request.');
  if (issue.code === 'unrecognized_keys' && issue.keys?.length) throw makeError(`Unknown field: ${issue.keys[0]}`);
  const field = issue.path.map(String).join('.');
  throw makeError(field ? `${field} ${issue.message}` : issue.message);
}
