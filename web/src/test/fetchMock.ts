import { vi } from 'vitest';

type Handler = (url: string, init: RequestInit) => { status?: number; body: unknown } | undefined;

/** Routes fetch calls to handlers; records every call. Unhandled calls fail the test loudly. */
export function mockFetch(handler: Handler) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const u = new URL(url);
    const path = u.pathname.replace(/^\/api/, '') + u.search;
    calls.push({ method: init.method ?? 'GET', path, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const res = handler(path, init);
    if (!res) throw new Error(`Unhandled fetch: ${init.method ?? 'GET'} ${path}`);
    return new Response(JSON.stringify(res.body), { status: res.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

export const summary = {
  kind: 'payment' as const,
  method: 'mpesa_stk' as const,
  amount: 500,
  fee: 0,
  total: 500,
  currency: 'KES' as const,
  phone: '+254712345678',
  recipient: 'John',
  reference: null,
  expires_at: '2030-01-01T00:00:00.000Z',
};

export const payment = (status: 'pending' | 'success' | 'failed', extra: Record<string, unknown> = {}) => ({
  id: 'pay_1',
  kind: 'payment',
  status,
  method: 'mpesa_stk',
  provider: 'payhero',
  amount: 500,
  fee: 0,
  total: 500,
  currency: 'KES',
  phone: '+254712345678',
  recipient: 'John',
  reference: null,
  mpesa_receipt: status === 'success' ? 'SKL4H7QW2P' : null,
  paid_at: status === 'success' ? '2026-11-21T09:00:00Z' : null,
  failure_reason: status === 'failed' ? 'Insufficient M-Pesa balance.' : null,
  created_at: '2026-11-21T09:00:00Z',
  updated_at: '2026-11-21T09:00:00Z',
  ...extra,
});

export const config = (extra: Record<string, unknown> = {}) => ({
  provider_mode: 'simulated',
  assistant_mode: 'claude',
  max_amount: 1000,
  access_code_required: false,
  shop_name: 'PesaPop Demo Shop',
  ...extra,
});

export const emptyPage = { items: [], pagination: { page: 1, limit: 5, total: 0, total_pages: 0 } };
