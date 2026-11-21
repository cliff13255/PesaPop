import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import { toPayment, toPaymentSummary } from '../lib/serializers.js';
import * as payments from '../services/payment.service.js';
import type { Providers } from '../services/providers/types.js';

const providersOf = (req: Request) => req.app.locals.providers as Providers;

export async function createPayment(req: Request, res: Response) {
  const draft = await payments.createDraft(currentUser(req).id, req.body);
  res.status(201).json({ payment_summary: toPaymentSummary(draft), confirmation_id: draft.id });
}

export async function confirmPayment(req: Request, res: Response) {
  const confirmationId = String(req.params.confirmation_id);
  const payment = await payments.confirm(currentUser(req).id, confirmationId, providersOf(req));
  res.json({ id: payment.id, status: payment.status, confirmation_id: confirmationId });
}

export async function getPayment(req: Request, res: Response) {
  const payment = await payments.getPayment(currentUser(req), String(req.params.id));
  res.json(toPayment(payment));
}
