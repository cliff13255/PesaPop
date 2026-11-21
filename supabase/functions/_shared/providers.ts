// Payment providers. initiate() is called ONLY from confirm(), exactly once per payment.
import type { Config } from './config.ts';
import type { PaymentRow, Sql } from './db.ts';
import { createPayHeroProvider } from './payhero.ts';

export interface InitiateResult {
  /** Initiation can only be accepted (pending) or rejected (failed). Success arrives later. */
  status: 'pending' | 'failed';
  providerReference?: string | null;
  failureReason?: string | null;
}

export interface PaymentProvider {
  readonly name: 'payhero' | 'simulated';
  initiate(payment: PaymentRow): Promise<InitiateResult>;
}

export const SIMULATED_DELAY_SECONDS = 10;
/** In simulated mode, payments to this number end as failed so the failure screen can be shown. */
export const SIMULATED_FAILING_PHONE = '+254700000000';

/** No real M-Pesa. The UI labels this mode clearly; payments settle 10 s after confirm. */
export const simulatedProvider: PaymentProvider = {
  name: 'simulated',
  async initiate(payment) {
    console.info(`[provider:simulated] initiate payment=${payment.id} amount=${payment.amount} (no money moved)`);
    return { status: 'pending', providerReference: `SIM-${payment.id.slice(4, 14)}` };
  },
};

/** Settles simulated payments that are older than the delay. Real (PayHero) payments are never touched. */
export async function settleSimulated(sql: Sql): Promise<void> {
  await sql`
    update public.payments set
      status = case when phone = ${SIMULATED_FAILING_PHONE} then 'failed' else 'success' end,
      failure_reason = case when phone = ${SIMULATED_FAILING_PHONE} then 'Simulated failure: the customer cancelled the M-Pesa prompt.' else null end,
      mpesa_receipt = case when phone = ${SIMULATED_FAILING_PHONE} then null else 'SIM' || upper(substr(md5(id), 1, 7)) end,
      paid_at = case when phone = ${SIMULATED_FAILING_PHONE} then null else created_at + make_interval(secs => ${SIMULATED_DELAY_SECONDS}) end,
      updated_at = now()
    where provider = 'simulated' and status = 'pending'
      and created_at <= now() - make_interval(secs => ${SIMULATED_DELAY_SECONDS})`;
}

export function createProvider(config: Config, fetchFn: typeof fetch = fetch): PaymentProvider {
  return config.providerMode === 'simulated' ? simulatedProvider : createPayHeroProvider(config, fetchFn);
}
