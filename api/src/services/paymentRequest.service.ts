import type { PaymentRequest } from '@prisma/client';
import { newId } from '../lib/ids.js';
import { prisma } from '../lib/prisma.js';
import type { CreatePaymentRequestBody, ListQuery } from '../schemas.js';
import type { Providers } from './providers/types.js';

export async function createPaymentRequest(
  merchantId: string,
  body: CreatePaymentRequestBody,
  providers: Providers,
): Promise<PaymentRequest> {
  const request = await prisma.paymentRequest.create({
    data: {
      id: newId('req'),
      merchantId,
      amount: body.amount,
      customerPhone: body.customer_phone,
      description: body.description,
    },
  });
  let link: string | null = null;
  try {
    link = await providers.link.createLink(request);
  } catch (err) {
    console.error(`[provider:${providers.link.name}] createLink failed request=${request.id}:`, err instanceof Error ? err.message : String(err));
  }
  return link ? prisma.paymentRequest.update({ where: { id: request.id }, data: { link } }) : request;
}

export async function listPaymentRequests(merchantId: string, q: ListQuery) {
  const where = { merchantId, ...(q.status ? { status: q.status } : {}) };
  const [items, total] = await prisma.$transaction([
    prisma.paymentRequest.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    prisma.paymentRequest.count({ where }),
  ]);
  return { items, total };
}
