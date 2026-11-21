// Placeholder providers used until PayHero and Lipwa are wired in Phase 3.
// They never report success: payments stay `pending` and links stay null, so
// nothing in the UI can show a fake success.
import type { PaymentLinkProvider, PaymentProvider, Providers } from './types.js';

export const stubPaymentProvider: PaymentProvider = {
  name: 'stub',
  async initiate(payment) {
    console.info(`[provider:stub] initiate payment=${payment.id} method=${payment.method} amount=${payment.amount} (no money moved)`);
    return { status: 'pending', providerReference: null };
  },
};

export const stubLinkProvider: PaymentLinkProvider = {
  name: 'stub',
  async createLink(request) {
    console.info(`[provider:stub] createLink request=${request.id} (no link created)`);
    return null;
  },
};

export const stubProviders: Providers = {
  payment: () => stubPaymentProvider,
  link: stubLinkProvider,
};
