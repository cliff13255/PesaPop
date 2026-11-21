// PayHero M-Pesa STK Push adapter.
//
// Checked against PayHero's developer docs (pages "Authorization", "Initiate MPESA STK Push"
// and "Payment Callback") on 2026-11-21:
//  - POST https://backend.payhero.co.ke/api/v2/payments
//  - Authorization: Basic <token copied from PayHero dashboard -> API Keys>
//  - Body: amount (integer), phone_number ("0787677676" format), channel_id (integer),
//          provider "m-pesa", external_reference, callback_url (customer_name optional, not sent)
//  - 201 response: { success: true, status: "QUEUED", reference, CheckoutRequestID }
//  - Callback: { forward_url, response: { Amount, CheckoutRequestID, ExternalReference,
//          MerchantRequestID, MpesaReceiptNumber, Phone, ResultCode, ResultDesc, Status }, status }
//  - The docs describe no callback signature, so callbacks are authenticated with a secret token
//    in our callback URL and by matching payment id + CheckoutRequestID + amount.
// PayHero has no sandbox: every request is real. Test with KES 1 to your own phone.
import type { Config } from './config.ts';
import type { PaymentRow } from './db.ts';
import type { InitiateResult, PaymentProvider } from './providers.ts';

const TIMEOUT_MS = 15_000;

/** +254712345678 -> 0712345678 (the format in PayHero's docs). */
export const toPayHeroPhone = (e164: string) => `0${e164.slice(-9)}`;

export function createPayHeroProvider(config: Config, fetchFn: typeof fetch): PaymentProvider {
  const ph = config.payhero;
  return {
    name: 'payhero',
    async initiate(payment: PaymentRow): Promise<InitiateResult> {
      if (!ph.authToken || !ph.channelId || !ph.callbackUrl || !ph.callbackToken) {
        console.error('[provider:payhero] not configured: set PAYHERO_AUTH_TOKEN, PAYHERO_CHANNEL_ID, PAYHERO_CALLBACK_URL, PAYHERO_CALLBACK_TOKEN');
        return { status: 'failed', failureReason: 'Payments are not configured on the server yet. You have not been charged.' };
      }
      const callback = new URL(ph.callbackUrl);
      callback.searchParams.set('token', ph.callbackToken);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      console.info(`[provider:payhero] initiate payment=${payment.id} amount=${payment.amount}`);
      try {
        const res = await fetchFn(`${ph.baseUrl}/api/v2/payments`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Basic ${ph.authToken}` },
          body: JSON.stringify({
            amount: payment.amount,
            phone_number: toPayHeroPhone(payment.phone),
            channel_id: Number(ph.channelId),
            provider: 'm-pesa',
            external_reference: payment.id,
            callback_url: callback.toString(),
          }),
        });
        const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        if (!res.ok || !data || data.success !== true) {
          console.error(`[provider:payhero] rejected payment=${payment.id} http=${res.status}`);
          return { status: 'failed', failureReason: 'PayHero could not start the M-Pesa prompt. You have not been charged.' };
        }
        const ref = (data.CheckoutRequestID ?? data.reference ?? null) as string | null;
        return { status: 'pending', providerReference: ref };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export interface CallbackResult {
  paymentId: string;
  providerReference: string | null;
  success: boolean;
  receipt: string | null;
  amount: number | null;
  reason: string | null;
}

/** Parses a PayHero payment callback body. Returns null if it does not look like one. */
export function parsePayHeroCallback(body: unknown): CallbackResult | null {
  const r = (body as { response?: Record<string, unknown> } | null)?.response;
  if (!r || typeof r !== 'object') return null;
  const paymentId = typeof r.ExternalReference === 'string' ? r.ExternalReference : null;
  if (!paymentId) return null;
  const success = Number(r.ResultCode) === 0 && String(r.Status ?? '').toLowerCase() === 'success';
  return {
    paymentId,
    providerReference: typeof r.CheckoutRequestID === 'string' ? r.CheckoutRequestID : null,
    success,
    receipt: typeof r.MpesaReceiptNumber === 'string' && r.MpesaReceiptNumber ? r.MpesaReceiptNumber : null,
    amount: r.Amount === undefined || r.Amount === null ? null : Number(r.Amount),
    reason: success ? null : typeof r.ResultDesc === 'string' && r.ResultDesc ? r.ResultDesc : 'The M-Pesa payment did not complete.',
  };
}
