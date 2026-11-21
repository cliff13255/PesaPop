import { api } from '../api/client';
import { formatDate, formatKES } from '../lib/format';
import { useApi } from '../lib/useApi';
import { ErrorBanner, Modal, Spinner, StatusBadge } from './ui';

export function PaymentDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: p, error, loading, reload } = useApi(() => api.getPayment(id), [id]);
  return (
    <Modal title="Payment details" onClose={onClose}>
      {loading && <Spinner label="Loading payment" block />}
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {p && !loading && (
        <>
          <div className="detail-head">
            <strong className="detail-amount">{formatKES(p.total)}</strong>
            <StatusBadge status={p.status} />
          </div>
          <dl className="summary">
            <dt>Recipient</dt>
            <dd>{p.recipient}</dd>
            <dt>Type</dt>
            <dd>{p.kind === 'request' ? 'Merchant request' : 'Payment'}</dd>
            <dt>Method</dt>
            <dd>M-Pesa{p.provider === 'simulated' ? ' (simulated)' : ''}</dd>
            <dt>Phone</dt>
            <dd>{p.phone}</dd>
            <dt>Amount</dt>
            <dd>{formatKES(p.amount)}</dd>
            <dt>Fee</dt>
            <dd>{p.fee === 0 ? 'None' : formatKES(p.fee)}</dd>
            {p.reference && (
              <>
                <dt>Reference</dt>
                <dd>{p.reference}</dd>
              </>
            )}
            <dt>Date</dt>
            <dd>{formatDate(p.created_at)}</dd>
            {p.mpesa_receipt && (
              <>
                <dt>M-Pesa receipt</dt>
                <dd className="mono">{p.mpesa_receipt}</dd>
              </>
            )}
            {p.paid_at && (
              <>
                <dt>Paid at</dt>
                <dd>{formatDate(p.paid_at)}</dd>
              </>
            )}
            {p.failure_reason && (
              <>
                <dt>Reason</dt>
                <dd>{p.failure_reason}</dd>
              </>
            )}
            <dt>Payment ID</dt>
            <dd className="mono small">{p.id}</dd>
          </dl>
        </>
      )}
    </Modal>
  );
}
