import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import { pagination, toPaymentRequest } from '../lib/serializers.js';
import type { ListQuery } from '../schemas.js';
import type { Providers } from '../services/providers/types.js';
import * as requests from '../services/paymentRequest.service.js';

export async function createPaymentRequest(req: Request, res: Response) {
  const created = await requests.createPaymentRequest(currentUser(req).id, req.body, req.app.locals.providers as Providers);
  res.status(201).json(toPaymentRequest(created));
}

export async function listPaymentRequests(req: Request, res: Response) {
  const q = res.locals.query as ListQuery;
  const { items, total } = await requests.listPaymentRequests(currentUser(req).id, q);
  res.json({ items: items.map(toPaymentRequest), pagination: pagination(q.page, q.limit, total) });
}
