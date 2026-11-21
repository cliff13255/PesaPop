import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import type { PaymentDraftResponse } from '../api/types';
import { ConfirmPaymentModal } from '../components/ConfirmPaymentModal';
import { Card, ErrorBanner } from '../components/ui';
import { useDemo } from '../demo/DemoContext';
import { normalizePhone, parseAmount } from '../lib/format';

export function PayPage() {
  const { config } = useDemo();
  const max = config?.max_amount ?? 250000;
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [recipient, setRecipient] = useState('');
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<PaymentDraftResponse | null>(null);

  const review = async (e: FormEvent) => {
    e.preventDefault();
    setApiError(null);
    const amt = parseAmount(amount);
    const ph = normalizePhone(phone);
    const errs: Record<string, string> = {};
    if (amt === null || amt > max) errs.amount = `Enter a whole amount from 1 to ${max.toLocaleString('en-KE')} KES.`;
    if (!ph) errs.phone = 'Enter a Kenyan mobile number, e.g. 0712 345 678.';
    if (!recipient.trim()) errs.recipient = 'Who are you paying?';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setBusy(true);
    try {
      setDraft(await api.createPayment({ amount: amt!, phone: ph!, recipient: recipient.trim(), ...(reference.trim() ? { reference: reference.trim() } : {}) }));
    } catch (err) {
      setApiError(err instanceof ApiError ? err.message : 'Could not prepare this payment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container narrow page">
      <h1>Pay with M-Pesa</h1>
      <Card>
        <form onSubmit={review} className="form" noValidate>
          <label className="field">
            <span>Amount (KES)</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="500" aria-invalid={!!errors.amount} />
            {errors.amount && <small className="field-error">{errors.amount}</small>}
          </label>
          <label className="field">
            <span>Paying</span>
            <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="e.g. Kenya Power or John Mwangi" maxLength={100} aria-invalid={!!errors.recipient} />
            {errors.recipient && <small className="field-error">{errors.recipient}</small>}
          </label>
          <label className="field">
            <span>Your M-Pesa number (gets the prompt)</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="0712 345 678" aria-invalid={!!errors.phone} />
            {errors.phone && <small className="field-error">{errors.phone}</small>}
          </label>
          <label className="field">
            <span>
              Account number or reference <span className="muted">(optional)</span>
            </span>
            <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={64} />
          </label>
          {apiError && <ErrorBanner message={apiError} />}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Preparing…' : 'Review payment'}
          </button>
          <p className="hint">Reviewing does not move any money.</p>
        </form>
      </Card>
      {draft && <ConfirmPaymentModal summary={draft.payment_summary} confirmationId={draft.confirmation_id} onCancel={() => setDraft(null)} />}
    </div>
  );
}
