import type { Payment, PaymentMethod, PaymentRequest } from '@prisma/client';

export interface InitiateResult {
  /** A provider can only accept (pending) or reject (failed) at initiation. Success arrives later via callback. */
  status: 'pending' | 'failed';
  providerReference?: string | null;
  failureReason?: string | null;
}

/**
 * Moves money. Called ONLY from PaymentService.confirm, exactly once per payment.
 * Dev 2 implements PayHero (mpesa_stk, payhero) and Lipwa behind this interface in Phase 3.
 */
export interface PaymentProvider {
  readonly name: string;
  initiate(payment: Payment): Promise<InitiateResult>;
}

/** Creates a shareable payment link for a merchant's payment request (Lipwa). */
export interface PaymentLinkProvider {
  readonly name: string;
  /** Returns the link, or null if no link could be created. */
  createLink(request: PaymentRequest): Promise<string | null>;
}

export interface Providers {
  payment(method: PaymentMethod): PaymentProvider;
  link: PaymentLinkProvider;
}
