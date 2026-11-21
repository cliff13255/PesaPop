import type { Prisma, User } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { ListQuery } from '../schemas.js';

/** Customers see payments they made; merchants see payments they received. */
const scope = (user: User): Prisma.PaymentWhereInput =>
  user.role === 'merchant' ? { merchantId: user.id } : { userId: user.id };

export async function listTransactions(user: User, q: ListQuery) {
  const where: Prisma.PaymentWhereInput = { ...scope(user), ...(q.status ? { status: q.status } : {}) };
  const [items, total] = await prisma.$transaction([
    prisma.payment.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    prisma.payment.count({ where }),
  ]);
  return { items, total };
}

export async function merchantSummary(merchantId: string) {
  const rows = await prisma.payment.groupBy({
    by: ['status'],
    where: { merchantId },
    _count: { _all: true },
    _sum: { amount: true },
  });
  const bucket = (status: 'success' | 'pending' | 'failed') => {
    const row = rows.find((r) => r.status === status);
    return { count: row?._count._all ?? 0, total: row?._sum.amount ?? 0 };
  };
  const success = bucket('success');
  return { currency: 'KES' as const, total_received: success.total, success, pending: bucket('pending'), failed: bucket('failed') };
}
