import { Prisma, type Payment, type PaymentDraft, type User } from '@prisma/client';
import { ApiError, errors } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { prisma } from '../lib/prisma.js';
import type { CreatePaymentBody } from '../schemas.js';
import type { Providers } from './providers/types.js';

export const DRAFT_TTL_MS = 10 * 60_000;

/**
 * Stores a draft the user must explicitly confirm. Never contacts a payment provider.
 * Shared by POST /payments and the AI assistant.
 */
export async function createDraft(userId: string, input: CreatePaymentBody): Promise<PaymentDraft> {
  return prisma.paymentDraft.create({
    data: {
      id: newId('cnf', 18),
      userId,
      method: input.method,
      amount: input.amount,
      fee: 0,
      phone: input.phone,
      recipient: input.recipient,
      reference: input.reference ?? null,
      expiresAt: new Date(Date.now() + DRAFT_TTL_MS),
    },
  });
}

/**
 * The ONLY code path that may move money.
 * Idempotent: Payment.draftId is unique, so concurrent or repeated confirms of the
 * same draft resolve to one payment, and only the request that created it calls the provider.
 */
export async function confirm(userId: string, confirmationId: string, providers: Providers): Promise<Payment> {
  const draft = await prisma.paymentDraft.findUnique({ where: { id: confirmationId }, include: { payment: true } });
  // Other users' drafts look exactly like missing ones.
  if (!draft || draft.userId !== userId) throw errors.notFound('Payment draft not found.');
  if (draft.payment) return draft.payment;
  if (draft.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(410, 'draft_expired', 'This payment expired before it was confirmed. Please start again.');
  }

  const provider = providers.payment(draft.method);
  let payment: Payment;
  try {
    payment = await prisma.payment.create({
      data: {
        id: newId('pay'),
        userId,
        draftId: draft.id,
        status: 'pending',
        method: draft.method,
        amount: draft.amount,
        fee: draft.fee,
        phone: draft.phone,
        recipient: draft.recipient,
        reference: draft.reference,
        provider: provider.name,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Lost a race with a concurrent confirm of the same draft: return its payment, do not charge again.
      return prisma.payment.findUniqueOrThrow({ where: { draftId: draft.id } });
    }
    throw err;
  }

  let result;
  try {
    result = await provider.initiate(payment);
  } catch (err) {
    console.error(`[provider:${provider.name}] initiate failed payment=${payment.id}:`, err instanceof Error ? err.message : String(err));
    result = { status: 'failed' as const, failureReason: 'We could not reach the payment provider. You have not been charged.' };
  }

  if (result.status === 'failed') {
    return prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'failed', failureReason: result.failureReason ?? 'The payment provider rejected this payment.', providerReference: result.providerReference ?? null },
    });
  }
  if (result.providerReference) {
    return prisma.payment.update({ where: { id: payment.id }, data: { providerReference: result.providerReference } });
  }
  return payment;
}

/** The payer, or the merchant receiving it, may read a payment. */
export async function getPayment(user: User, id: string): Promise<Payment> {
  const payment = await prisma.payment.findUnique({ where: { id } });
  if (!payment || (payment.userId !== user.id && payment.merchantId !== user.id)) {
    throw errors.notFound('Payment not found.');
  }
  return payment;
}
