// Request schemas. These mirror docs/openapi.yaml; change both together.
import { z } from 'zod';

export const PHONE_RE = /^\+254(7|1)[0-9]{8}$/;

export const phone = z
  .string({ error: 'must be an E.164 Kenyan mobile number, e.g. +254712345678' })
  .regex(PHONE_RE, 'must be an E.164 Kenyan mobile number, e.g. +254712345678');

export const amountKES = z
  .int({ error: 'must be a whole number of KES' })
  .min(1, 'must be at least 1 KES')
  .max(250000, 'must be at most 250,000 KES');

export const role = z.enum(['customer', 'merchant'], { error: 'must be customer or merchant' });
export const paymentMethod = z.enum(['mpesa_stk', 'payhero', 'lipwa'], {
  error: 'must be one of mpesa_stk, payhero, lipwa',
});
export const paymentStatus = z.enum(['pending', 'success', 'failed'], {
  error: 'must be one of pending, success, failed',
});

const trimmed = (min: number, max: number) =>
  z
    .string({ error: `must be ${min}-${max} characters` })
    .trim()
    .min(min, `must be ${min}-${max} characters`)
    .max(max, `must be ${min}-${max} characters`);

export const registerBody = z.strictObject({
  name: trimmed(2, 100),
  phone,
  email: z.email({ error: 'must be a valid email address' }).max(254).toLowerCase(),
  password: z.string({ error: 'must be 8-128 characters' }).min(8, 'must be 8-128 characters').max(128, 'must be 8-128 characters'),
  role,
});

export const loginBody = z.strictObject({
  email: z.email({ error: 'must be a valid email address' }).toLowerCase(),
  password: z.string({ error: 'is required' }).min(1, 'is required').max(128),
});

export const createPaymentBody = z.strictObject({
  method: paymentMethod,
  amount: amountKES,
  phone,
  recipient: trimmed(1, 100),
  reference: trimmed(1, 64).optional(),
});

export const createPaymentRequestBody = z.strictObject({
  amount: amountKES,
  customer_phone: phone,
  description: trimmed(1, 140),
});

/** Query strings arrive as strings; empty status means "all". */
export const listQuery = z.object({
  status: z.preprocess((v) => (v === '' ? undefined : v), paymentStatus.optional()),
  page: z.coerce.number({ error: 'must be an integer >= 1' }).int('must be an integer >= 1').min(1, 'must be an integer >= 1').default(1),
  limit: z.coerce
    .number({ error: 'must be an integer between 1 and 100' })
    .int('must be an integer between 1 and 100')
    .min(1, 'must be an integer between 1 and 100')
    .max(100, 'must be an integer between 1 and 100')
    .default(20),
});

export type RegisterBody = z.infer<typeof registerBody>;
export type LoginBody = z.infer<typeof loginBody>;
export type CreatePaymentBody = z.infer<typeof createPaymentBody>;
export type CreatePaymentRequestBody = z.infer<typeof createPaymentRequestBody>;
export type ListQuery = z.infer<typeof listQuery>;
