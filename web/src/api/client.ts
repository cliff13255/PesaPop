// The ONLY place the frontend talks to the network. It calls the PesaPop API (Supabase
// Edge Function) and nothing else: never Claude or PayHero directly.
import type {
  AssistantMessageResponse,
  ConfirmPaymentResponse,
  CreatePaymentInput,
  MerchantSummary,
  Page,
  Payment,
  PaymentDraftResponse,
  PaymentStatus,
  PublicConfig,
  TransactionItem,
} from './types';

export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:8787/api').replace(/\/$/, '');
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ---------- per-browser demo identity (no accounts) ----------
const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode: lasts until reload */
    }
  },
  remove(k: string) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

let memorySession: string | null = null;
export function sessionId(): string {
  const saved = store.get('pesapop.session');
  if (saved) return saved;
  if (!memorySession) {
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    memorySession = 'web_' + Array.from(bytes, (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b & 63]).join('');
    store.set('pesapop.session', memorySession);
  }
  return memorySession;
}

export const accessCode = {
  get: () => store.get('pesapop.code'),
  set: (c: string) => store.set('pesapop.code', c),
  clear: () => store.remove('pesapop.code'),
};

let onAccessCodeRequired: (() => void) | null = null;
export function setAccessCodeHandler(fn: (() => void) | null) {
  onAccessCodeRequired = fn;
}

const FRIENDLY: Record<string, string> = {
  internal_error: 'Something went wrong on our side. Please try again.',
};

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Demo-Session': sessionId() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const code = accessCode.get();
  if (code) headers['X-Demo-Code'] = code;
  if (ANON_KEY) {
    headers.apikey = ANON_KEY;
    headers.Authorization = `Bearer ${ANON_KEY}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(
      0,
      'network_error',
      import.meta.env.DEV
        ? `Cannot reach the PesaPop API at ${API_URL}. Start it with "npm run dev" (or "npm run dev:api") in the repo root.`
        : 'Cannot reach PesaPop. Check your connection and try again.',
    );
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const code: string = data?.error?.code ?? 'internal_error';
    if (code === 'access_code_required') onAccessCodeRequired?.();
    throw new ApiError(res.status, code, FRIENDLY[code] ?? data?.error?.message ?? 'Something went wrong. Please try again.');
  }
  return data as T;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
};

type ListParams = { status?: PaymentStatus; page?: number; limit?: number };

export const api = {
  config: () => request<PublicConfig>('GET', '/config'),
  assistantMessage: (message: string, conversationId?: string | null) =>
    request<AssistantMessageResponse>('POST', '/assistant/messages', { message, ...(conversationId ? { conversation_id: conversationId } : {}) }),
  /** Creates a draft only. No money moves. */
  createPayment: (input: CreatePaymentInput) => request<PaymentDraftResponse>('POST', '/payments', input),
  /** Creates a draft for an STK push to the customer. No money moves. */
  createPaymentRequest: (input: { amount: number; customer_phone: string; description: string }) =>
    request<PaymentDraftResponse>('POST', '/payment-requests', input),
  /** The only call that moves money. Call it only from an explicit Confirm tap. */
  confirmPayment: (confirmationId: string) => request<ConfirmPaymentResponse>('POST', `/payments/${encodeURIComponent(confirmationId)}/confirm`),
  getPayment: (id: string) => request<Payment>('GET', `/payments/${encodeURIComponent(id)}`),
  listTransactions: (p: ListParams = {}) => request<Page<TransactionItem>>('GET', `/transactions${qs(p)}`),
  merchantSummary: () => request<MerchantSummary>('GET', '/merchant/summary'),
  merchantTransactions: (p: ListParams = {}) => request<Page<TransactionItem>>('GET', `/merchant/transactions${qs(p)}`),
};
