// PayHero M-Pesa STK Push adapter.
//
// !! UNVERIFIED: PayHero's docs (docs.payhero.co.ke) could not be read when this was written.
// !! Every line marked ASSUMPTION must be checked against the official docs before switching
// !! PROVIDER_MODE to sandbox or live. Keep PROVIDER_MODE=simulated until then.
//
// Assumptions to verify:
//  A1. Endpoint: POST {PAYHERO_BASE_URL}/api/v2/payments
//  A2. Auth: Authorization: Basic base64(PAYHERO_API_USERNAME:PAYHERO_API_PASSWORD)
//  A3. Body: { amount, phone_number: "2547XXXXXXXX" (no +), channel_id: number, provider: "m-pesa",
//             external_reference, customer_name, callback_url }
//  A4. Success response contains CheckoutRequestID and/or reference
//  A5. Callback body: { status, response: { ExternalReference, CheckoutRequestID, ResultCode (0 = paid),
//             ResultDesc, MpesaReceiptNumber, Amount, Status } }
//  A6. Callbacks are not signed, so we authenticate them with a secret token in the callback URL
//      and by matching our payment id + CheckoutRequestID + amount.
import type { Config } from './config.ts';
import type { PaymentRow } from './db.ts';
import type { InitiateResult, PaymentProvider } from './providers.ts';

const TIMEOUT_MS = 15_000;

export function createPayHeroProvider(config: Config, fetchFn: typeof fetch): PaymentProvider {
  const ph = config.payhero;
  return {
    name: 'payhero',
    async initiate(payment: PaymentRow): Promise<InitiateResult> {
      if (!ph.username || !ph.password || !ph.channelId || !ph.callbackUrl || !ph.callbackToken) {
        console.error('[provider:payhero] not configured: set PAYHERO_API_USERNAME, PAYHERO_API_PASSWORD, PAYHERO_CHANNEL_ID, PAYHERO_CALLBACK_URL, PAYHERO_CALLBACK_TOKEN');
        return { status: 'failed', failureReason: 'Payments are not configured on the server yet. You have not been charged.' };
      }
      const callback = new URL(ph.callbackUrl);
      callback.searchParams.set('token', ph.callbackToken);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      console.info(`[provider:payhero] initiate payment=${payment.id} amount=${payment.amount} mode=${config.providerMode}`);
      try {
        const res = await fetchFn(`${ph.baseUrl}/api/v2/payments`, { // ASSUMPTION A1
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${btoa(`${ph.username}:${ph.password}`)}`, // ASSUMPTION A2
          },
          body: JSON.stringify({ // ASSUMPTION A3
            amount: payment.amount,
            phone_number: payment.phone.replace(/^\+/, ''),
            channel_id: Number(ph.channelId),
            provider: 'm-pesa',
            external_reference: payment.id,
            customer_name: payment.recipient.slice(0, 50),
            callback_url: callback.toString(),
          }),
        });
        const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        if (!res.ok || !data) {
          console.error(`[provider:payhero] rejected payment=${payment.id} http=${res.status}`);
          return { status: 'failed', failureReason: 'PayHero could not start the M-Pesa prompt. You have not been charged.' };
        }
        const ref = (data.CheckoutRequestID ?? data.reference ?? null) as string | null; // ASSUMPTION A4
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

/** Parses a PayHero callback body. Returns null if it does not look like one. ASSUMPTION A5. */
export function parsePayHeroCallback(body: unknown): CallbackResult | null {
  const r = (body as { response?: Record<string, unknown> } | null)?.response;
  if (!r || typeof r !== 'object') return null;
  const paymentId = typeof r.ExternalReference === 'string' ? r.ExternalReference : null;
  if (!paymentId) return null;
  const code = Number(r.ResultCode);
  const success = code === 0 && (r.Status === undefined || String(r.Status).toLowerCase() === 'success');
  return {
    paymentId,
    providerReference: typeof r.CheckoutRequestID === 'string' ? r.CheckoutRequestID : null,
    success,
    receipt: typeof r.MpesaReceiptNumber === 'string' && r.MpesaReceiptNumber ? r.MpesaReceiptNumber : null,
    amount: r.Amount === undefined || r.Amount === null ? null : Number(r.Amount),
    reason: success ? null : typeof r.ResultDesc === 'string' && r.ResultDesc ? r.ResultDesc : 'The M-Pesa payment did not complete.',
  };
}
