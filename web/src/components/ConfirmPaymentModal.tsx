// The ONLY place in the app that calls confirmPayment (the money-moving call).
// Used by both the Pay page and the Assistant page.
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { PaymentSummary } from '../api/types';
import { formatDate, formatKES } from '../lib/format';
import { ErrorBanner, Modal } from './ui';

export function ConfirmPaymentModal({
  summary,
  confirmationId,
  onCancel,
}: {
  summary: PaymentSummary;
  confirmationId: string;
  onCancel: () => void;
}) {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  // A ref, not just state, so a fast double tap can never send two requests.
  const sent = useRef(false);

  const confirm = async () => {
    if (sent.current) return;
    sent.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.confirmPayment(confirmationId);
      navigate(`/payments/${res.id}`);
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError(0, 'unknown', 'Something went wrong. Please try again.');
      setError(e);
      setSubmitting(false);
      // Confirm is idempotent on the server, so retrying a network failure is safe.
      // An expired or missing draft cannot be retried.
      if (e.status === 0 || e.status >= 500) sent.current = false;
    }
  };

  const isRequest = summary.kind === 'request';
  const dead = error?.code === 'draft_expired' || error?.code === 'not_found';

  return (
    <Modal title="Confirm payment" onClose={onCancel} closeDisabled={submitting}>
      <p className="muted">
        {isRequest
          ? 'Check the details. Confirming sends an M-Pesa prompt to the customer, who approves it on their phone.'
          : 'Check every detail. Money only moves when you tap Confirm.'}
      </p>
      <dl className="summary">
        <dt>{isRequest ? 'Paying to' : 'Paying'}</dt>
        <dd>{summary.recipient}</dd>
        <dt>Amount</dt>
        <dd>{formatKES(summary.amount)}</dd>
        <dt>Fee</dt>
        <dd>{summary.fee === 0 ? 'None' : formatKES(summary.fee)}</dd>
        <dt>Total</dt>
        <dd className="summary-total">{formatKES(summary.total)}</dd>
        <dt>Method</dt>
        <dd>M-Pesa STK Push</dd>
        <dt>{isRequest ? 'Customer phone' : 'Prompt sent to'}</dt>
        <dd>{summary.phone}</dd>
        {summary.reference && (
          <>
            <dt>{isRequest ? 'Description' : 'Reference'}</dt>
            <dd>{summary.reference}</dd>
          </>
        )}
      </dl>
      <p className="hint">
        This review expires at {formatDate(summary.expires_at)}. The M-Pesa PIN is only ever entered on the phone, never in PesaPop.
      </p>
      {error && (
        <ErrorBanner message={error.code === 'draft_expired' ? 'This payment expired before you confirmed it. Please start again.' : error.message} />
      )}
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={submitting}>
          {dead ? 'Close' : 'Cancel'}
        </button>
        {!dead && (
          <button type="button" className="btn btn-primary" onClick={confirm} disabled={submitting}>
            {submitting ? 'Confirming…' : isRequest ? `Send request for ${formatKES(summary.total)}` : `Confirm ${formatKES(summary.total)}`}
          </button>
        )}
      </div>
    </Modal>
  );
}
