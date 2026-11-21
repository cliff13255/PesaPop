import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmPaymentModal } from '../components/ConfirmPaymentModal';
import { PaymentStatusPage } from '../pages/PaymentStatusPage';
import { mockFetch, payment, summary } from './fetchMock';

function renderModal(onCancel = vi.fn()) {
  return render(
    <MemoryRouter initialEntries={['/pay']}>
      <Routes>
        <Route path="/pay" element={<ConfirmPaymentModal summary={summary} confirmationId="cnf_1" onCancel={onCancel} />} />
        <Route path="/payments/:id" element={<p>status page for payment</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ConfirmPaymentModal', () => {
  it('shows the full summary and sends confirm only once, even on a double tap', async () => {
    const calls = mockFetch((path) =>
      path === '/payments/cnf_1/confirm' ? { body: { id: 'pay_1', status: 'pending', confirmation_id: 'cnf_1' } } : undefined,
    );
    renderModal();
    expect(screen.getByText('John')).toBeInTheDocument();
    expect(screen.getByText('+254712345678')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /confirm kes 500/i });
    const user = userEvent.setup();
    await user.dblClick(btn);
    await screen.findByText('status page for payment');
    expect(calls.filter((c) => c.path.endsWith('/confirm'))).toHaveLength(1);
  });

  it('cancel never calls the API', async () => {
    const calls = mockFetch(() => undefined);
    const onCancel = vi.fn();
    renderModal(onCancel);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('explains an expired draft and removes the Confirm button', async () => {
    mockFetch(() => ({ status: 410, body: { error: { code: 'draft_expired', message: 'expired' } } }));
    renderModal();
    await userEvent.setup().click(screen.getByRole('button', { name: /confirm kes 500/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/expired before you confirmed/i);
    expect(screen.queryByRole('button', { name: /confirm kes/i })).not.toBeInTheDocument();
  });
});

describe('PaymentStatusPage', () => {
  const renderStatus = () =>
    render(
      <MemoryRouter initialEntries={['/payments/pay_1']}>
        <Routes>
          <Route path="/payments/:id" element={<PaymentStatusPage />} />
        </Routes>
      </MemoryRouter>,
    );

  it('stays pending until the API says success, polling every 3 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let status: 'pending' | 'success' = 'pending';
    const calls = mockFetch((path) => (path === '/payments/pay_1' ? { body: payment(status) } : undefined));
    renderStatus();
    expect(await screen.findByText(/waiting for m-pesa/i)).toBeInTheDocument();
    expect(screen.queryByText(/payment successful/i)).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.queryByText(/payment successful/i)).not.toBeInTheDocument();

    status = 'success';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(await screen.findByText(/payment successful/i)).toBeInTheDocument();
    expect(screen.getByText('SKL4H7QW2P')).toBeInTheDocument();

    const n = calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(calls.length).toBe(n); // stops polling once final
    vi.useRealTimers();
  });

  it('shows the failure reason', async () => {
    mockFetch(() => ({ body: payment('failed') }));
    renderStatus();
    expect(await screen.findByText(/payment failed/i)).toBeInTheDocument();
    expect(screen.getByText('Insufficient M-Pesa balance.')).toBeInTheDocument();
  });
});
