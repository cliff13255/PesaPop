// Map database rows to the exact response shapes in docs/openapi.yaml.
import type { Payment, PaymentDraft, PaymentRequest, User } from '@prisma/client';

export const toUser = (u: User) => ({
  id: u.id,
  name: u.name,
  phone: u.phone,
  email: u.email,
  role: u.role,
  created_at: u.createdAt.toISOString(),
});

export const toPaymentSummary = (d: PaymentDraft) => ({
  method: d.method,
  amount: d.amount,
  fee: d.fee,
  total: d.amount + d.fee,
  currency: 'KES' as const,
  phone: d.phone,
  recipient: d.recipient,
  reference: d.reference,
  expires_at: d.expiresAt.toISOString(),
});

const receiptProvider = (p: Payment) => (p.method === 'mpesa_stk' ? 'mpesa' : p.method);

export const toPayment = (p: Payment) => ({
  id: p.id,
  status: p.status,
  method: p.method,
  amount: p.amount,
  fee: p.fee,
  total: p.amount + p.fee,
  currency: 'KES' as const,
  phone: p.phone,
  recipient: p.recipient,
  reference: p.reference,
  receipt:
    p.status === 'success'
      ? {
          provider: receiptProvider(p),
          provider_reference: p.providerReference,
          mpesa_receipt: p.mpesaReceipt,
          paid_at: p.paidAt?.toISOString() ?? null,
        }
      : null,
  failure_reason: p.failureReason,
  created_at: p.createdAt.toISOString(),
  updated_at: p.updatedAt.toISOString(),
});

export const toTransaction = (p: Payment) => ({
  id: p.id,
  reference: p.mpesaReceipt ?? p.id,
  amount: p.amount,
  currency: 'KES' as const,
  method: p.method,
  recipient: p.recipient,
  created_at: p.createdAt.toISOString(),
  status: p.status,
});

export const toPaymentRequest = (r: PaymentRequest) => ({
  id: r.id,
  amount: r.amount,
  currency: 'KES' as const,
  customer_phone: r.customerPhone,
  description: r.description,
  status: r.status,
  link: r.link,
  created_at: r.createdAt.toISOString(),
});

export const pagination = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  total_pages: Math.ceil(total / limit),
});
