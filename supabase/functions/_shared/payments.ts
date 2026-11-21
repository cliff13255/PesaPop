import type { Config } from './config.ts';
import type { DraftRow, PaymentRow, Sql } from './db.ts';
import { ApiError, notFound } from './errors.ts';
import type { PaymentProvider } from './providers.ts';
import { newId } from './util.ts';

export const DRAFT_TTL_MINUTES = 10;

export interface DraftInput {
  kind: 'payment' | 'request';
  amount: number;
  phone: string;
  recipient: string;
  reference: string | null;
}

/** Stores a draft the user must explicitly confirm. Never contacts a payment provider. */
export async function createDraft(sql: Sql, sessionId: string, input: DraftInput): Promise<DraftRow> {
  const [row] = await sql<DraftRow[]>`
    insert into public.payment_drafts (id, session_id, kind, amount, fee, phone, recipient, reference, expires_at)
    values (${newId('cnf', 24)}, ${sessionId}, ${input.kind}, ${input.amount}, 0, ${input.phone}, ${input.recipient},
            ${input.reference}, now() + make_interval(mins => ${DRAFT_TTL_MINUTES}))
    returning *`;
  return row!;
}

/**
 * The ONLY code path that moves money.
 * Idempotent: payments.draft_id is unique, so repeated or concurrent confirms of one draft
 * resolve to one payment, and only the request that inserted it calls the provider.
 */
export async function confirm(
  sql: Sql,
  config: Config,
  provider: PaymentProvider,
  sessionId: string,
  ipHash: string,
  confirmationId: string,
): Promise<PaymentRow> {
  const [draft] = await sql<DraftRow[]>`select * from public.payment_drafts where id = ${confirmationId}`;
  // Another browser's draft looks exactly like a missing one.
  if (!draft || draft.session_id !== sessionId) throw notFound('Payment draft not found.');

  const [existing] = await sql<PaymentRow[]>`select * from public.payments where draft_id = ${draft.id}`;
  if (existing) return existing;

  if (new Date(draft.expires_at).getTime() <= Date.now()) {
    throw new ApiError(410, 'draft_expired', 'This payment expired before it was confirmed. Please start again.');
  }

  const count = (await sql<{ count: number }[]>`
    select count(*)::int as count from public.payments
    where (session_id = ${sessionId} or ip_hash = ${ipHash})
      and created_at > now() - make_interval(mins => ${config.rateLimitWindowMinutes})`)[0]?.count ?? 0;
  if (count >= config.rateLimitCount) {
    throw new ApiError(429, 'rate_limited', `Demo limit reached: ${config.rateLimitCount} payments every ${config.rateLimitWindowMinutes} minutes. Please try again later.`);
  }

  const inserted = await sql<PaymentRow[]>`
    insert into public.payments (id, draft_id, session_id, ip_hash, kind, status, amount, fee, phone, recipient, reference, provider)
    values (${newId('pay')}, ${draft.id}, ${sessionId}, ${ipHash}, ${draft.kind}, 'pending', ${draft.amount}, ${draft.fee},
            ${draft.phone}, ${draft.recipient}, ${draft.reference}, ${provider.name})
    on conflict (draft_id) do nothing
    returning *`;
  const payment = inserted[0];
  if (!payment) {
    // Lost a race with a concurrent confirm of the same draft: return its payment, never charge twice.
    const [winner] = await sql<PaymentRow[]>`select * from public.payments where draft_id = ${draft.id}`;
    return winner!;
  }

  let result;
  try {
    result = await provider.initiate(payment);
  } catch (err) {
    console.error(`[provider:${provider.name}] initiate threw payment=${payment.id}:`, err instanceof Error ? err.message : String(err));
    result = { status: 'failed' as const, failureReason: 'We could not reach the payment provider. You have not been charged.' };
  }

  const [updated] = result.status === 'failed'
    ? await sql<PaymentRow[]>`
        update public.payments set status = 'failed', updated_at = now(),
          failure_reason = ${result.failureReason ?? 'The payment provider rejected this payment.'},
          provider_reference = ${result.providerReference ?? null}
        where id = ${payment.id} returning *`
    : await sql<PaymentRow[]>`
        update public.payments set provider_reference = ${result.providerReference ?? null}, updated_at = now()
        where id = ${payment.id} returning *`;
  return updated!;
}
