import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import { pagination, toTransaction } from '../lib/serializers.js';
import type { ListQuery } from '../schemas.js';
import * as tx from '../services/transaction.service.js';

export async function listTransactions(req: Request, res: Response) {
  const q = res.locals.query as ListQuery;
  const { items, total } = await tx.listTransactions(currentUser(req), q);
  res.json({ items: items.map(toTransaction), pagination: pagination(q.page, q.limit, total) });
}

export async function merchantSummary(req: Request, res: Response) {
  res.json(await tx.merchantSummary(currentUser(req).id));
}
