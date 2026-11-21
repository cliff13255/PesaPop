import { Router } from 'express';
import { asyncHandler as h } from '../lib/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { createPaymentBody, createPaymentRequestBody, listQuery, loginBody, registerBody } from '../schemas.js';
import * as authC from '../controllers/auth.controller.js';
import * as payC from '../controllers/payments.controller.js';
import * as txC from '../controllers/transactions.controller.js';
import * as reqC from '../controllers/paymentRequests.controller.js';

export const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Auth (public, rate-limited)
router.post('/auth/register', authLimiter, validateBody(registerBody), h(authC.register));
router.post('/auth/login', authLimiter, validateBody(loginBody), h(authC.login));

// Everything below needs a valid token.
router.get('/me', requireAuth, h(authC.me));

router.post('/payments', requireAuth, validateBody(createPaymentBody), h(payC.createPayment));
router.post('/payments/:confirmation_id/confirm', requireAuth, h(payC.confirmPayment));
router.get('/payments/:id', requireAuth, h(payC.getPayment));

router.get('/transactions', requireAuth, validateQuery(listQuery), h(txC.listTransactions));

router.get('/merchant/summary', requireAuth, requireRole('merchant'), h(txC.merchantSummary));
router.post('/payment-requests', requireAuth, requireRole('merchant'), validateBody(createPaymentRequestBody), h(reqC.createPaymentRequest));
router.get('/payment-requests', requireAuth, requireRole('merchant'), validateQuery(listQuery), h(reqC.listPaymentRequests));
