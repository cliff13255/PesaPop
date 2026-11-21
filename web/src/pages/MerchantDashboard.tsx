import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { PaymentDraftResponse } from '../api/types';
import { ConfirmPaymentModal } from '../components/ConfirmPaymentModal';
import { TransactionRow } from '../components/TransactionRow';
import { Card, EmptyState, ErrorBanner, Modal, Skeleton } from '../components/ui';
import { useDemo } from '../demo/DemoContext';
import { formatKES, normalizePhone, parseAmount } from '../lib/format';
import { useApi } from '../lib/useApi';

export function MerchantDashboard() {
  const summary = useApi(() => api.merchantSummary(), []);
  const recent = useApi(() => api.merchantTransactions({ limit: 8 }), []);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<PaymentDraftResponse | null>(null);

  const s = summary.data;
  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1>{s?.shop_name ?? 'Merchant dashboard'}</h1>
          <p className="muted">Every payment made in this demo, with customer numbers masked.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setFormOpen(true)}>
          Request payment
        </button>
      </div>

      {summary.error && <ErrorBanner message={summary.error} onRetry={summary.reload} />}
      <div className="stats">
        <div className="stat stat-total">
          <span className="stat-label">Total received</span>
          <strong className="stat-value">{s ? formatKES(s.total_received) : '—'}</strong>
          <span className="stat-sub">{s ? `${s.success.count} successful` : ' '}</span>
        </div>
        <div className="stat stat-success">
          <span className="stat-label">Successful</span>
          <strong className="stat-value">{s ? s.success.count : '—'}</strong>
          <span className="stat-sub">{s ? formatKES(s.success.total) : ' '}</span>
        </div>
        <div className="stat stat-pending">
          <span className="stat-label">Pending</span>
          <strong className="stat-value">{s ? s.pending.count : '—'}</strong>
          <span className="stat-sub">{s ? formatKES(s.pending.total) : ' '}</span>
        </div>
        <div className="stat stat-failed">
          <span className="stat-label">Failed</span>
          <strong className="stat-value">{s ? s.failed.count : '—'}</strong>
          <span className="stat-sub">{s ? formatKES(s.failed.total) : ' '}</span>
        </div>
      </div>

      <Card>
        <div className="card-head">
          <h2>Latest payments</h2>
          <Link to="/history">View all</Link>
        </div>
        {recent.loading && <Skeleton rows={4} />}
        {recent.error && <ErrorBanner message={recent.error} onRetry={recent.reload} />}
        {recent.data && !recent.loading &&
          (recent.data.items.length === 0 ? (
            <EmptyState title="No payments yet">Switch to the Customer view to make one, or send a request.</EmptyState>
          ) : (
            <ul className="tx-list">
              {recent.data.items.map((tx) => (
                <TransactionRow key={tx.id} tx={tx} merchant />
              ))}
            </ul>
          ))}
      </Card>

      {formOpen && (
        <RequestPaymentModal
          onClose={() => setFormOpen(false)}
          onDraft={(d) => {
            setFormOpen(false);
            setDraft(d);
          }}
        />
      )}
      {draft && <ConfirmPaymentModal summary={draft.payment_summary} confirmationId={draft.confirmation_id} onCancel={() => setDraft(null)} />}
    </div>
  );
}

function RequestPaymentModal({ onClose, onDraft }: { onClose: () => void; onDraft: (d: PaymentDraftResponse) => void }) {
  const { config } = useDemo();
  const max = config?.max_amount ?? 250000;
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const amt = parseAmount(amount);
    const ph = normalizePhone(phone);
    if (amt === null || amt > max) return setError(`Enter a whole amount from 1 to ${max.toLocaleString('en-KE')} KES.`);
    if (!ph) return setError("Enter the customer's Kenyan mobile number.");
    if (!description.trim()) return setError('Add a short description so the customer knows what this is for.');
    setBusy(true);
    try {
      onDraft(await api.createPaymentRequest({ amount: amt, customer_phone: ph, description: description.trim() }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not prepare the request.');
      setBusy(false);
    }
  };

  return (
    <Modal title="Request a payment" onClose={onClose} closeDisabled={busy}>
      <p className="muted">The customer gets an M-Pesa prompt on their phone after you confirm.</p>
      <form className="form" onSubmit={submit} noValidate>
        <label className="field">
          <span>Amount (KES)</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="250" />
        </label>
        <label className="field">
          <span>Customer phone</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="0711 222 333" />
        </label>
        <label className="field">
          <span>Description</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={140} placeholder="Invoice 1050: 5 crates of eggs" />
        </label>
        {error && <ErrorBanner message={error} />}
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Preparing…' : 'Review request'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
