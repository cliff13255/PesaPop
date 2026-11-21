// PesaPop mock API. Matches docs/openapi.yaml exactly; state is in memory and
// resets on restart. This is demo data only: no real money ever moves here.
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import { seed, DEMO_TOKENS } from './seed.js';

export const SUCCESS_AFTER_MS = 10_000;
export const DRAFT_TTL_MS = 10 * 60_000;
// Any payment to this phone number turns `failed` instead of `success`, so the
// Bubble team and QA can exercise the failure path.
export const FAILING_PHONE = '+254700000000';

const PHONE_RE = /^\+254(7|1)[0-9]{8}$/;
const METHODS = ['mpesa_stk', 'payhero', 'lipwa'];
const STATUSES = ['pending', 'success', 'failed'];

const id = (prefix) => `${prefix}_${crypto.randomBytes(8).toString('base64url').slice(0, 12)}`;
const now = () => new Date().toISOString();

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const bad = (message) => new ApiError(400, 'validation_error', message);

// ---------- validation helpers ----------
function requireObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('Request body must be a JSON object.');
}
function rejectUnknown(body, allowed) {
  const extra = Object.keys(body).filter((k) => !allowed.includes(k));
  if (extra.length) throw bad(`Unknown field: ${extra[0]}`);
}
function str(body, key, { min = 1, max = 1000, optional = false } = {}) {
  const v = body[key];
  if (v === undefined && optional) return undefined;
  if (typeof v !== 'string' || v.trim().length < min || v.length > max) {
    throw bad(`${key} is required and must be ${min}-${max} characters.`);
  }
  return v.trim();
}
function phone(body, key) {
  const v = body[key];
  if (typeof v !== 'string' || !PHONE_RE.test(v)) {
    throw bad(`${key} must be an E.164 Kenyan mobile number, e.g. +254712345678`);
  }
  return v;
}
function amount(body, key = 'amount') {
  const v = body[key];
  if (!Number.isInteger(v) || v < 1 || v > 250000) throw bad(`${key} must be a whole number of KES between 1 and 250000.`);
  return v;
}
function oneOf(body, key, values) {
  const v = body[key];
  if (!values.includes(v)) throw bad(`${key} must be one of: ${values.join(', ')}`);
  return v;
}
function paging(query) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if (!Number.isInteger(page) || page < 1) throw bad('page must be an integer >= 1.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw bad('limit must be an integer between 1 and 100.');
  let status;
  if (query.status !== undefined && query.status !== '') {
    if (!STATUSES.includes(query.status)) throw bad(`status must be one of: ${STATUSES.join(', ')}`);
    status = query.status;
  }
  return { page, limit, status };
}
function paginate(list, { page, limit }) {
  const total = list.length;
  return {
    items: list.slice((page - 1) * limit, page * limit),
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
}

// ---------- mock assistant (rule-based stand-in for the Claude route) ----------
function normalisePhone(raw) {
  const digits = raw.replace(/[\s-]/g, '');
  let m;
  if ((m = digits.match(/^\+254([71]\d{8})$/))) return `+254${m[1]}`;
  if ((m = digits.match(/^254([71]\d{8})$/))) return `+254${m[1]}`;
  if ((m = digits.match(/^0([71]\d{8})$/))) return `+254${m[1]}`;
  return null;
}
function extractIntent(text, into) {
  const t = text.toLowerCase();
  if (/\blipwa\b/.test(t)) into.method = 'lipwa';
  else if (/\bpayhero\b/.test(t)) into.method = 'payhero';
  else if (/m-?pesa|stk/.test(t)) into.method = 'mpesa_stk';

  const phoneMatch = text.match(/(\+?254|0)[\s-]?[71]\d{2}[\s-]?\d{3}[\s-]?\d{3}/);
  if (phoneMatch) {
    const p = normalisePhone(phoneMatch[0]);
    if (p) into.phone = p;
  }
  const withoutPhone = phoneMatch ? text.replace(phoneMatch[0], ' ') : text;
  const amt = withoutPhone.match(/(?:kes|ksh|sh)?\s*(\d[\d,]*)(\s*k\b)?\s*(?:bob|kes|ksh|shillings|\/=)?/i);
  if (amt) {
    let n = Number(amt[1].replace(/,/g, ''));
    if (amt[2]) n *= 1000;
    if (Number.isInteger(n) && n >= 1 && n <= 250000) into.amount = n;
  }
  const rec = withoutPhone.match(/\bto\s+([A-Za-z][A-Za-z.'&-]*(?:\s+[A-Z][A-Za-z.'&-]*)*)/);
  if (rec) into.recipient = rec[1];
  else if (/electricity|kplc|kenya power|tokens/.test(t)) into.recipient = 'Kenya Power';
  else if (/water bill/.test(t)) into.recipient = 'Nairobi Water';

  const ref = text.match(/\b(?:ref(?:erence)?|account|acc)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Za-z0-9-]{3,})/i);
  if (ref) into.reference = ref[1];
  return into;
}
const FIELD_QUESTIONS = {
  amount: 'how much (in KES)',
  recipient: 'who you are paying',
  phone: 'the M-Pesa phone number that should get the payment prompt',
};

export function createApp({ successAfterMs = SUCCESS_AFTER_MS, draftTtlMs = DRAFT_TTL_MS } = {}) {
  const db = seed();
  const app = express();

  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));

  // Mock auth: any bearer token is accepted. Tokens issued by this mock map to
  // their user; the demo tokens map to the seeded accounts; anything else is the
  // demo customer.
  const auth = (req, _res, next) => {
    const header = req.get('authorization') || '';
    const m = header.match(/^Bearer\s+(.+)$/i);
    if (!m) return next(new ApiError(401, 'unauthorized', 'Please log in again.'));
    const userId = db.tokens.get(m[1].trim()) ?? db.tokens.get(DEMO_TOKENS.customer);
    req.user = db.users.get(userId);
    next();
  };
  const merchantOnly = (req, _res, next) =>
    req.user.role === 'merchant' ? next() : next(new ApiError(403, 'forbidden', 'This action is only available to merchants.'));

  const publicUser = ({ password, ...u }) => u;
  const issueToken = (user) => {
    const token = `mock.${crypto.randomBytes(18).toString('base64url')}`;
    db.tokens.set(token, user.id);
    return token;
  };

  // Lazily advance pending payments: success (or failed) 10 s after confirm.
  const refresh = (p) => {
    // Only payments confirmed in this session advance; seeded pending rows stay pending.
    if (p.live && p.status === 'pending' && Date.now() - Date.parse(p.created_at) >= successAfterMs) {
      const ts = new Date(Date.parse(p.created_at) + successAfterMs).toISOString();
      if (p.phone === FAILING_PHONE) {
        p.status = 'failed';
        p.failure_reason = 'The customer cancelled the M-Pesa prompt.';
      } else {
        p.status = 'success';
        p.receipt = {
          provider: p.method === 'mpesa_stk' ? 'mpesa' : p.method,
          provider_reference: `ws_CO_${ts.replace(/\D/g, '').slice(0, 14)}${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`,
          mpesa_receipt: crypto.randomBytes(5).toString('hex').toUpperCase().replace(/^./, 'S'),
          paid_at: ts,
        };
      }
      p.updated_at = ts;
    }
    return p;
  };
  const toTransaction = (p) => ({
    id: p.id,
    reference: p.receipt?.mpesa_receipt ?? p.id,
    amount: p.amount,
    currency: 'KES',
    method: p.method,
    recipient: p.recipient,
    created_at: p.created_at,
    status: p.status,
  });
  const userPayments = (user) =>
    [...db.payments.values()]
      .filter((p) => (user.role === 'merchant' ? p.merchant_id === user.id : p.owner_id === user.id))
      .map(refresh)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const createDraft = (user, { method, amount: amt, phone: ph, recipient, reference }) => {
    const draft = {
      confirmation_id: id('cnf'),
      owner_id: user.id,
      payment_id: null,
      summary: {
        method,
        amount: amt,
        fee: 0,
        total: amt,
        currency: 'KES',
        phone: ph,
        recipient,
        reference: reference ?? null,
        expires_at: new Date(Date.now() + draftTtlMs).toISOString(),
      },
    };
    db.drafts.set(draft.confirmation_id, draft);
    return draft;
  };

  // ---------- routes ----------
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.post('/auth/register', (req, res) => {
    const b = req.body;
    requireObject(b);
    rejectUnknown(b, ['name', 'phone', 'email', 'password', 'role']);
    const name = str(b, 'name', { min: 2, max: 100 });
    const ph = phone(b, 'phone');
    const email = str(b, 'email', { max: 254 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('email must be a valid email address.');
    const password = str(b, 'password', { min: 8, max: 128 });
    const role = oneOf(b, 'role', ['customer', 'merchant']);
    for (const u of db.users.values()) {
      if (u.email === email || u.phone === ph) throw new ApiError(409, 'conflict', 'An account with this email or phone already exists.');
    }
    const user = { id: id('usr'), name, phone: ph, email, role, created_at: now(), password };
    db.users.set(user.id, user);
    res.status(201).json({ token: issueToken(user), user: publicUser(user) });
  });

  app.post('/auth/login', (req, res) => {
    const b = req.body;
    requireObject(b);
    rejectUnknown(b, ['email', 'password']);
    const email = str(b, 'email', { max: 254 }).toLowerCase();
    const password = str(b, 'password', { max: 128 });
    const user = [...db.users.values()].find((u) => u.email === email);
    if (!user || user.password !== password) throw new ApiError(401, 'invalid_credentials', 'Wrong email or password.');
    res.json({ token: issueToken(user), user: publicUser(user) });
  });

  app.get('/me', auth, (req, res) => res.json(publicUser(req.user)));

  app.post('/assistant/messages', auth, (req, res) => {
    const b = req.body;
    requireObject(b);
    rejectUnknown(b, ['message', 'conversation_id']);
    const message = str(b, 'message', { max: 2000 });
    let convo;
    if (b.conversation_id !== undefined) {
      convo = db.conversations.get(b.conversation_id);
      if (!convo || convo.owner_id !== req.user.id) throw new ApiError(404, 'not_found', 'Conversation not found.');
    } else {
      convo = { id: id('cnv'), owner_id: req.user.id, fields: {} };
      db.conversations.set(convo.id, convo);
    }

    const out = { conversation_id: convo.id, reply: '', missing_fields: [], payment_summary: null, confirmation_id: null };
    if (/\b(cancel|stop|never ?mind|forget it)\b/i.test(message)) {
      convo.fields = {};
      out.reply = "Okay, I've cancelled that. Nothing was paid. What would you like to do next?";
      return res.json(out);
    }
    if (/\bpin\b|password/i.test(message)) {
      out.reply = 'Never share your M-Pesa PIN or password with anyone, including me. You only enter your PIN on your phone when the M-Pesa prompt appears.';
      return res.json(out);
    }

    const f = extractIntent(message, convo.fields);
    f.method ??= 'mpesa_stk';
    const missing = ['amount', 'recipient', 'phone'].filter((k) => f[k] === undefined);
    if (missing.length) {
      out.missing_fields = missing;
      out.reply = `Sure, I can help with that. Please tell me ${missing.map((k) => FIELD_QUESTIONS[k]).join(', and ')}.`;
      return res.json(out);
    }
    const draft = createDraft(req.user, f);
    convo.fields = {};
    out.payment_summary = draft.summary;
    out.confirmation_id = draft.confirmation_id;
    out.reply = `Here's the payment: KES ${f.amount.toLocaleString('en-KE')} to ${f.recipient} via ${
      { mpesa_stk: 'M-Pesa', payhero: 'PayHero', lipwa: 'Lipwa' }[f.method]
    }, prompt sent to ${f.phone}. Nothing has been paid yet. Review it and tap Confirm if it's correct.`;
    res.json(out);
  });

  app.post('/payments', auth, (req, res) => {
    const b = req.body;
    requireObject(b);
    rejectUnknown(b, ['method', 'amount', 'phone', 'recipient', 'reference']);
    const draft = createDraft(req.user, {
      method: oneOf(b, 'method', METHODS),
      amount: amount(b),
      phone: phone(b, 'phone'),
      recipient: str(b, 'recipient', { max: 100 }),
      reference: str(b, 'reference', { max: 64, optional: true }),
    });
    res.status(201).json({ payment_summary: draft.summary, confirmation_id: draft.confirmation_id });
  });

  app.post('/payments/:confirmation_id/confirm', auth, (req, res) => {
    const draft = db.drafts.get(req.params.confirmation_id);
    if (!draft || draft.owner_id !== req.user.id) throw new ApiError(404, 'not_found', 'Payment draft not found.');
    // Idempotent: a repeat confirm returns the same payment.
    if (draft.payment_id) {
      const p = refresh(db.payments.get(draft.payment_id));
      return res.json({ id: p.id, status: p.status, confirmation_id: draft.confirmation_id });
    }
    if (Date.parse(draft.summary.expires_at) < Date.now()) {
      throw new ApiError(410, 'draft_expired', 'This payment expired. Please start again.');
    }
    const { expires_at, ...s } = draft.summary;
    const ts = now();
    const payment = {
      id: id('pay'),
      owner_id: req.user.id,
      merchant_id: null,
      live: true,
      status: 'pending',
      ...s,
      receipt: null,
      failure_reason: null,
      created_at: ts,
      updated_at: ts,
    };
    db.payments.set(payment.id, payment);
    draft.payment_id = payment.id;
    res.json({ id: payment.id, status: 'pending', confirmation_id: draft.confirmation_id });
  });

  app.get('/payments/:id', auth, (req, res) => {
    const p = db.payments.get(req.params.id);
    if (!p || (p.owner_id !== req.user.id && p.merchant_id !== req.user.id)) {
      throw new ApiError(404, 'not_found', 'Payment not found.');
    }
    const { owner_id, merchant_id, live, ...pub } = refresh(p);
    res.json(pub);
  });

  app.post('/payment-requests', auth, merchantOnly, (req, res) => {
    const b = req.body;
    requireObject(b);
    rejectUnknown(b, ['amount', 'customer_phone', 'description']);
    const r = {
      id: id('req'),
      merchant_id: req.user.id,
      amount: amount(b),
      currency: 'KES',
      customer_phone: phone(b, 'customer_phone'),
      description: str(b, 'description', { max: 140 }),
      status: 'pending',
      link: null,
      created_at: now(),
    };
    r.link = `https://lipwa.link/p/${r.id}`;
    db.paymentRequests.set(r.id, r);
    const { merchant_id, ...pub } = r;
    res.status(201).json(pub);
  });

  app.get('/payment-requests', auth, merchantOnly, (req, res) => {
    const q = paging(req.query);
    const list = [...db.paymentRequests.values()]
      .filter((r) => r.merchant_id === req.user.id && (!q.status || r.status === q.status))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(({ merchant_id, ...pub }) => pub);
    res.json(paginate(list, q));
  });

  app.get('/transactions', auth, (req, res) => {
    const q = paging(req.query);
    const list = userPayments(req.user)
      .filter((p) => !q.status || p.status === q.status)
      .map(toTransaction);
    res.json(paginate(list, q));
  });

  app.get('/merchant/summary', auth, merchantOnly, (req, res) => {
    const buckets = Object.fromEntries(STATUSES.map((s) => [s, { count: 0, total: 0 }]));
    for (const p of userPayments(req.user)) {
      buckets[p.status].count += 1;
      buckets[p.status].total += p.amount;
    }
    res.json({ currency: 'KES', total_received: buckets.success.total, ...buckets });
  });

  // ---------- errors ----------
  app.use((_req, _res, next) => next(new ApiError(404, 'not_found', 'Route not found.')));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof ApiError) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'validation_error', message: 'Request body is not valid JSON.' } });
    }
    console.error(err);
    res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong.' } });
  });

  return app;
}
