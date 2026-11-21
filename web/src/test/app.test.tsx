import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { App } from '../App';
import { DemoProvider } from '../demo/DemoContext';
import { normalizePhone, parseAmount } from '../lib/format';
import { config, emptyPage, mockFetch, payment, summary } from './fetchMock';

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <DemoProvider>
        <App />
      </DemoProvider>
    </MemoryRouter>,
  );

describe('demo app (no accounts)', () => {
  it('landing page goes straight into the demo', async () => {
    mockFetch((path) => (path === '/config' ? { body: config() } : path.startsWith('/transactions') ? { body: emptyPage } : undefined));
    renderAt('/');
    await userEvent.setup().click(screen.getAllByRole('link', { name: /try the demo/i })[0]!);
    expect(await screen.findByText(/habari/i)).toBeInTheDocument();
  });

  it('sends a stable per-browser session id and shows the simulated-mode banner', async () => {
    const calls = mockFetch((path) => (path === '/config' ? { body: config() } : path.startsWith('/transactions') ? { body: emptyPage } : undefined));
    const seen: string[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get('X-Demo-Session') ?? '');
      return orig(input, init);
    }) as typeof fetch;
    renderAt('/dashboard');
    expect(await screen.findByText('No payments yet')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(/payments are simulated/i);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).toMatch(/^web_[A-Za-z0-9_-]{18}$/);
  });

  it('asks for the passcode when the server requires one, then sends it', async () => {
    let codeSent = '';
    mockFetch((path, init) => {
      if (path === '/config') return { body: config({ access_code_required: true }) };
      codeSent = new Headers(init.headers).get('X-Demo-Code') ?? '';
      return path.startsWith('/transactions') ? { body: emptyPage } : undefined;
    });
    renderAt('/dashboard');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Passcode'), 'tembo42');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('No payments yet')).toBeInTheDocument();
    expect(codeSent).toBe('tembo42');
  });

  it('switches to the merchant view and sends a payment request through the confirm popup', async () => {
    const calls = mockFetch((path) => {
      if (path === '/config') return { body: config() };
      if (path.startsWith('/transactions') || path.startsWith('/merchant/transactions')) return { body: emptyPage };
      if (path === '/merchant/summary')
        return { body: { shop_name: 'PesaPop Demo Shop', currency: 'KES', total_received: 0, success: { count: 0, total: 0 }, pending: { count: 0, total: 0 }, failed: { count: 0, total: 0 } } };
      if (path === '/payment-requests')
        return { status: 201, body: { payment_summary: { ...summary, kind: 'request', recipient: 'PesaPop Demo Shop', phone: '+254711222333', reference: 'Eggs' }, confirmation_id: 'cnf_r' } };
      if (path === '/payments/cnf_r/confirm') return { body: { id: 'pay_r', status: 'pending', confirmation_id: 'cnf_r' } };
      if (path === '/payments/pay_r') return { body: payment('pending', { id: 'pay_r', kind: 'request' }) };
      return undefined;
    });
    renderAt('/dashboard');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Merchant' }));
    expect(await screen.findByRole('heading', { name: 'PesaPop Demo Shop' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Request payment' }));
    await user.type(screen.getByLabelText('Amount (KES)'), '500');
    await user.type(screen.getByLabelText('Customer phone'), '0711 222 333');
    await user.type(screen.getByLabelText('Description'), 'Eggs');
    await user.click(screen.getByRole('button', { name: 'Review request' }));
    expect(calls.find((c) => c.path === '/payment-requests')?.body).toEqual({ amount: 500, customer_phone: '+254711222333', description: 'Eggs' });
    expect(calls.some((c) => c.path.endsWith('/confirm'))).toBe(false);
    await user.click(await screen.findByRole('button', { name: /send request for kes 500/i }));
    await waitFor(() => expect(calls.filter((c) => c.path.endsWith('/confirm'))).toHaveLength(1));
  });

  it('blocks amounts over the demo cap before calling the API', async () => {
    const calls = mockFetch((path) => (path === '/config' ? { body: config({ max_amount: 1000 }) } : undefined));
    renderAt('/pay');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Amount (KES)'), '5000');
    await user.click(screen.getByRole('button', { name: 'Review payment' }));
    expect(screen.getByText(/from 1 to 1,000 KES/)).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/payments')).toBe(false);
  });
});

describe('format helpers', () => {
  it.each([
    ['0712 345 678', '+254712345678'],
    ['254712345678', '+254712345678'],
    ['+254 112 345 678', '+254112345678'],
    ['0812345678', null],
  ])('normalizePhone(%s)', (input, out) => expect(normalizePhone(input)).toBe(out));

  it.each([
    ['1,500', 1500],
    ['10.5', null],
    ['0', null],
  ])('parseAmount(%s)', (input, out) => expect(parseAmount(input)).toBe(out));
});
