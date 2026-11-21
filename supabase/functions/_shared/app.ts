// PesaPop API as a plain fetch handler: (Request) => Response.
// Runs as the Supabase Edge Function `api` (Deno) and under Node for tests and local dev.
import type { AssistantModel, ChatTurn } from './assistant.ts';
import { DRAFT_MARKER } from './assistant.ts';
import type { Config } from './config.ts';
import type { DraftRow, PaymentRow, Sql } from './db.ts';
import { ApiError, bad, notFound } from './errors.ts';
import { parsePayHeroCallback } from './payhero.ts';
import { confirm, createDraft } from './payments.ts';
import type { PaymentProvider } from './providers.ts';
import { settleSimulated } from './providers.ts';
import { assistantBody, createPaymentBody, createPaymentRequestBody, listQuery, parseOrThrow, SESSION_RE } from './schemas.ts';
import type { ListQuery } from './schemas.ts';
import { maskPhone, newId, normalizePhone, safeEqual, sha256Hex } from './util.ts';

export interface Deps {
  sql: Sql;
  config: Config;
  provider: PaymentProvider;
  assistant: AssistantModel;
}

// ---------- serializers (exact shapes from docs/openapi.yaml) ----------
const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());

const toSummary = (d: DraftRow) => ({
  kind: d.kind,
  method: 'mpesa_stk' as const,
  amount: d.amount,
  fee: d.fee,
  total: d.amount + d.fee,
  currency: 'KES' as const,
  phone: d.phone,
  recipient: d.recipient,
  reference: d.reference,
  expires_at: iso(d.expires_at)!,
});

const toPayment = (p: PaymentRow, mask: boolean) => ({
  id: p.id,
  kind: p.kind,
  status: p.status,
  method: 'mpesa_stk' as const,
  provider: p.provider,
  amount: p.amount,
  fee: p.fee,
  total: p.amount + p.fee,
  currency: 'KES' as const,
  phone: mask ? maskPhone(p.phone) : p.phone,
  recipient: p.recipient,
  reference: p.reference,
  mpesa_receipt: p.status === 'success' ? p.mpesa_receipt : null,
  paid_at: p.status === 'success' ? iso(p.paid_at) : null,
  failure_reason: p.status === 'failed' ? p.failure_reason : null,
  created_at: iso(p.created_at)!,
  updated_at: iso(p.updated_at)!,
});

const toTransaction = (p: PaymentRow, mask: boolean) => ({
  id: p.id,
  kind: p.kind,
  reference: p.status === 'success' && p.mpesa_receipt ? p.mpesa_receipt : p.id,
  amount: p.amount,
  currency: 'KES' as const,
  method: 'mpesa_stk' as const,
  recipient: p.recipient,
  phone: mask ? maskPhone(p.phone) : p.phone,
  created_at: iso(p.created_at)!,
  status: p.status,
});

const pagination = (q: ListQuery, total: number) => ({ page: q.page, limit: q.limit, total, total_pages: Math.ceil(total / q.limit) });

// ---------- helpers ----------
function corsHeaders(config: Config, origin: string | null): Record<string, string> {
  const allowAll = config.corsOrigins.includes('*');
  const allowed = allowAll ? '*' : origin && config.corsOrigins.includes(origin) ? origin : '';
  return {
    ...(allowed ? { 'Access-Control-Allow-Origin': allowed } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-demo-session, x-demo-code, authorization, apikey, x-client-info',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > 50_000) throw bad('Request body is too large.');
  if (!text) throw bad('Request body must be a JSON object.');
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw bad('Request body is not valid JSON.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('Request body must be a JSON object.');
  return body;
}

function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}

// ---------- handler ----------
export function createHandler(deps: Deps) {
  const { sql, config, provider, assistant } = deps;

  async function route(req: Request, url: URL, path: string): Promise<{ status?: number; body: unknown }> {
    const method = req.method;

    // Public routes
    if (method === 'GET' && path === '/health') return { body: { status: 'ok' } };
    if (method === 'GET' && path === '/config') {
      return {
        body: {
          provider_mode: config.providerMode,
          assistant_mode: assistant.mode,
          max_amount: config.maxAmount,
          access_code_required: config.accessCode !== null,
          shop_name: config.shopName,
        },
      };
    }
    if (method === 'POST' && path === '/webhooks/payhero') return payheroCallback(req, url);

    // Everything else needs the demo passcode (if one is set) and a browser session id.
    if (config.accessCode !== null) {
      const code = req.headers.get('x-demo-code') ?? '';
      if (!(await safeEqual(code, config.accessCode))) throw new ApiError(401, 'access_code_required', 'Enter the demo passcode to continue.');
    }
    const session = req.headers.get('x-demo-session') ?? '';
    if (!SESSION_RE.test(session)) throw bad('Missing or invalid X-Demo-Session header.');

    if (config.providerMode === 'simulated') await settleSimulated(sql);

    if (method === 'POST' && path === '/payments') {
      const b = parseOrThrow(createPaymentBody(config.maxAmount), await readJson(req), bad);
      const draft = await createDraft(sql, session, { kind: 'payment', amount: b.amount, phone: b.phone, recipient: b.recipient, reference: b.reference ?? null });
      return { status: 201, body: { payment_summary: toSummary(draft), confirmation_id: draft.id } };
    }

    const confirmMatch = path.match(/^\/payments\/([^/]+)\/confirm$/);
    if (method === 'POST' && confirmMatch) {
      const ipHash = await sha256Hex(`${config.ipSalt}:${clientIp(req)}`);
      const cid = decodeURIComponent(confirmMatch[1]!);
      const p = await confirm(sql, config, provider, session, ipHash, cid);
      return { body: { id: p.id, status: p.status, confirmation_id: cid } };
    }

    const paymentMatch = path.match(/^\/payments\/([^/]+)$/);
    if (method === 'GET' && paymentMatch) {
      const [p] = await sql<PaymentRow[]>`select * from public.payments where id = ${decodeURIComponent(paymentMatch[1]!)}`;
      if (!p) throw notFound('Payment not found.');
      // Other browsers (the Merchant view) see the payment with the phone number masked.
      return { body: toPayment(p, p.session_id !== session) };
    }

    if (method === 'GET' && path === '/transactions') {
      const q = parseOrThrow(listQuery, Object.fromEntries(url.searchParams), bad);
      const status = q.status ?? null;
      const items = await sql<PaymentRow[]>`
        select * from public.payments where session_id = ${session} and (${status}::text is null or status = ${status})
        order by created_at desc, id desc limit ${q.limit} offset ${(q.page - 1) * q.limit}`;
      const count = (await sql<{ count: number }[]>`
        select count(*)::int as count from public.payments where session_id = ${session} and (${status}::text is null or status = ${status})`)[0]?.count ?? 0;
      return { body: { items: items.map((p) => toTransaction(p, false)), pagination: pagination(q, count) } };
    }

    if (method === 'POST' && path === '/payment-requests') {
      const b = parseOrThrow(createPaymentRequestBody(config.maxAmount), await readJson(req), bad);
      const draft = await createDraft(sql, session, { kind: 'request', amount: b.amount, phone: b.customer_phone, recipient: config.shopName, reference: b.description });
      return { status: 201, body: { payment_summary: toSummary(draft), confirmation_id: draft.id } };
    }

    if (method === 'GET' && path === '/merchant/summary') {
      const rows = await sql<{ status: string; count: number; total: number }[]>`
        select status, count(*)::int as count, coalesce(sum(amount), 0)::int as total from public.payments group by status`;
      const bucket = (s: string) => {
        const r = rows.find((x) => x.status === s);
        return { count: r?.count ?? 0, total: r?.total ?? 0 };
      };
      const success = bucket('success');
      return { body: { shop_name: config.shopName, currency: 'KES', total_received: success.total, success, pending: bucket('pending'), failed: bucket('failed') } };
    }

    if (method === 'GET' && path === '/merchant/transactions') {
      const q = parseOrThrow(listQuery, Object.fromEntries(url.searchParams), bad);
      const status = q.status ?? null;
      const items = await sql<PaymentRow[]>`
        select * from public.payments where (${status}::text is null or status = ${status})
        order by created_at desc, id desc limit ${q.limit} offset ${(q.page - 1) * q.limit}`;
      const count = (await sql<{ count: number }[]>`
        select count(*)::int as count from public.payments where (${status}::text is null or status = ${status})`)[0]?.count ?? 0;
      return { body: { items: items.map((p) => toTransaction(p, p.session_id !== session)), pagination: pagination(q, count) } };
    }

    if (method === 'POST' && path === '/assistant/messages') return assistantMessage(req, session);

    throw notFound('Route not found.');
  }

  async function assistantMessage(req: Request, session: string) {
    const b = parseOrThrow(assistantBody, await readJson(req), bad);

    let conversationId = b.conversation_id;
    if (conversationId) {
      const [c] = await sql<{ session_id: string }[]>`select session_id from public.conversations where id = ${conversationId}`;
      if (!c || c.session_id !== session) throw notFound('Conversation not found.');
    }

    const recent = (await sql<{ recent: number }[]>`
      select count(*)::int as recent from public.messages m join public.conversations c on c.id = m.conversation_id
      where c.session_id = ${session} and m.role = 'user' and m.created_at > now() - interval '1 minute'`)[0]?.recent ?? 0;
    if (recent >= config.assistantPerMinute) throw new ApiError(429, 'rate_limited', 'Too many messages. Please wait a minute.');

    const stored = conversationId
      ? await sql<ChatTurn[]>`
          select role, content from (
            select role, content, created_at from public.messages where conversation_id = ${conversationId}
            order by created_at desc limit 19) t order by created_at asc`
      : [];
    const history: ChatTurn[] = [...stored, { role: 'user', content: b.message }];
    while (history[0]?.role === 'assistant') history.shift(); // the API needs a user turn first

    let result;
    try {
      result = await assistant.extract(history, config.maxAmount);
    } catch (err) {
      console.error('[assistant] failed:', err instanceof Error ? err.message : String(err));
      throw new ApiError(502, 'assistant_unavailable', 'The assistant is unavailable right now. Please try again, or use the payment form.');
    }

    let reply: string;
    const missing: string[] = [];
    let draft: DraftRow | null = null;

    if (result.kind === 'refused') {
      reply = "Sorry, I can't help with that. I can help you pay someone with M-Pesa.";
    } else {
      const e = result.extraction;
      reply = e.reply;
      if (e.action === 'collect') {
        const phone = e.phone ? normalizePhone(e.phone) : null;
        const amountOk = e.amount !== null && Number.isInteger(e.amount) && e.amount >= 1 && e.amount <= config.maxAmount;
        const recipient = e.recipient?.trim().slice(0, 100) || null;
        if (!amountOk) missing.push('amount');
        if (!recipient) missing.push('recipient');
        if (!phone) missing.push('phone');
        if (e.amount !== null && e.amount > config.maxAmount) {
          reply = `This demo allows payments up to KES ${config.maxAmount.toLocaleString('en-KE')}. What amount would you like to send?`;
        } else if (e.phone && !phone) {
          reply = `"${e.phone}" doesn't look like a Kenyan M-Pesa number. Please send it like 0712 345 678.`;
        }
        if (missing.length === 0 && e.ready_to_review) {
          draft = await createDraft(sql, session, { kind: 'payment', amount: e.amount!, phone: phone!, recipient: recipient!, reference: e.reference?.trim().slice(0, 64) || null });
          // Built by the server, not the model, so it can never claim money moved.
          reply = `Here's the payment: KES ${e.amount!.toLocaleString('en-KE')} to ${recipient}, with the M-Pesa prompt going to ${phone}. Nothing has been paid yet. Review it and tap Confirm if it's correct.`;
        }
      }
    }

    const id = conversationId ?? newId('cnv');
    await sql.begin(async (tx) => {
      if (!conversationId) await tx`insert into public.conversations (id, session_id) values (${id}, ${session})`;
      await tx`insert into public.messages (id, conversation_id, role, content, created_at) values (${newId('msg')}, ${id}, 'user', ${b.message}, now())`;
      await tx`insert into public.messages (id, conversation_id, role, content, created_at)
               values (${newId('msg')}, ${id}, 'assistant', ${draft ? `${reply}\n${DRAFT_MARKER}` : reply}, now() + interval '1 millisecond')`;
    });

    return {
      body: {
        conversation_id: id,
        reply,
        missing_fields: missing,
        payment_summary: draft ? toSummary(draft) : null,
        confirmation_id: draft ? draft.id : null,
        assistant_mode: assistant.mode,
      },
    };
  }

  async function payheroCallback(req: Request, url: URL) {
    const token = config.payhero.callbackToken;
    if (!token || !(await safeEqual(url.searchParams.get('token') ?? '', token))) {
      throw new ApiError(401, 'unauthorized', 'Invalid callback.');
    }
    const parsed = parsePayHeroCallback(await readJson(req));
    if (!parsed) throw bad('Unrecognised callback body.');

    const [p] = await sql<PaymentRow[]>`select * from public.payments where id = ${parsed.paymentId} and provider = 'payhero'`;
    if (!p) throw notFound('Payment not found.');
    if (p.provider_reference && parsed.providerReference && p.provider_reference !== parsed.providerReference) {
      throw bad('Callback does not match this payment.');
    }
    const amountMatches = parsed.amount === null || parsed.amount === p.amount;
    const success = parsed.success && amountMatches;
    const reason = parsed.success && !amountMatches ? 'The amount paid did not match the request.' : parsed.reason;

    // `status = 'pending'` makes this apply exactly once, even if PayHero retries the callback.
    const updated = success
      ? await sql`update public.payments set status = 'success', mpesa_receipt = ${parsed.receipt}, paid_at = now(), updated_at = now()
                  where id = ${p.id} and status = 'pending' returning id`
      : await sql`update public.payments set status = 'failed', failure_reason = ${reason}, updated_at = now()
                  where id = ${p.id} and status = 'pending' returning id`;
    console.info(`[provider:payhero] callback payment=${p.id} result=${success ? 'success' : 'failed'} applied=${updated.length > 0}`);
    return { body: { received: true } };
  }

  return async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const cors = corsHeaders(config, req.headers.get('origin'));
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    // Works for /functions/v1/api/payments (Supabase) and /api/payments (local dev).
    const idx = url.pathname.indexOf('/api');
    const path = (idx >= 0 ? url.pathname.slice(idx + 4) : url.pathname) || '/';

    try {
      const { status = 200, body } = await route(req, url, path.replace(/\/$/, '') || '/');
      return Response.json(body, { status, headers: cors });
    } catch (err) {
      if (err instanceof ApiError) {
        return Response.json({ error: { code: err.code, message: err.message } }, { status: err.status, headers: cors });
      }
      console.error(`[error] ${req.method} ${path}:`, err instanceof Error ? err.stack : String(err));
      return Response.json({ error: { code: 'internal_error', message: 'Something went wrong. Please try again.' } }, { status: 500, headers: cors });
    }
  };
}
