import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { Payment } from '../api/types';
import { Card, ErrorBanner, Spinner, StatusBadge } from '../components/ui';
import { formatDate, formatKES } from '../lib/format';

export const POLL_MS = 3000;
const GIVE_UP_MS = 3 * 60_000;

/** Polls GET /payments/{id} every 3 s. Shows success ONLY when the API says success. */
export function PaymentStatusPage() {
  const { id = '' } = useParams();
  const [payment, setPayment] = useState<Payment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const started = useRef(Date.now());

  const load = useCallback(async () => {
    try {
      const p = await api.getPayment(id);
      setPayment(p);
      setError(null);
      return p;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this payment.');
      return null;
    }
  }, [id]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      const p = await load();
      if (stopped) return;
      if (p && p.status !== 'pending') return;
      if (Date.now() - started.current > GIVE_UP_MS) {
        setGaveUp(true);
        return;
      }
      timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [load, gaveUp]);

  const checkAgain = () => {
    started.current = Date.now();
    setGaveUp(false);
  };

  if (!payment && !error) return <Spinner label="Loading payment" block />;

  return (
    <div className="container narrow page">
      <Card className="status-card">
        {payment ? (
          <>
            <div className={`status-hero status-${payment.status}`}>
              {payment.status === 'pending' && <span className="spinner spinner-lg" aria-hidden="true" />}
              {payment.status === 'success' && <span className="status-icon">✓</span>}
              {payment.status === 'failed' && <span className="status-icon">✕</span>}
              <h1>
                {payment.status === 'pending' && 'Waiting for M-Pesa…'}
                {payment.status === 'success' && 'Payment successful'}
                {payment.status === 'failed' && 'Payment failed'}
              </h1>
              <p className="muted" aria-live="polite">
                {payment.status === 'pending' &&
                  (payment.provider === 'simulated'
                    ? 'Simulated payment: it will settle in about 10 seconds. No real prompt is sent.'
                    : `An M-Pesa prompt was sent to ${payment.phone}. Enter the PIN on that phone to approve.`)}
                {payment.status === 'success' && `${formatKES(payment.total)} paid to ${payment.recipient}.`}
                {payment.status === 'failed' && (payment.failure_reason ?? 'The payment did not go through. You have not been charged.')}
              </p>
              <StatusBadge status={payment.status} />
            </div>

            {gaveUp && payment.status === 'pending' && (
              <div className="notice">
                Still waiting for a result. It will update in your history once M-Pesa responds.{' '}
                <button type="button" className="link-btn" onClick={checkAgain}>
                  Check again
                </button>
              </div>
            )}

            <dl className="summary">
              <dt>Amount</dt>
              <dd>{formatKES(payment.amount)}</dd>
              <dt>Method</dt>
              <dd>M-Pesa{payment.provider === 'simulated' ? ' (simulated)' : ''}</dd>
              <dt>Recipient</dt>
              <dd>{payment.recipient}</dd>
              {payment.reference && (
                <>
                  <dt>Reference</dt>
                  <dd>{payment.reference}</dd>
                </>
              )}
              {payment.mpesa_receipt && (
                <>
                  <dt>M-Pesa receipt</dt>
                  <dd className="mono">{payment.mpesa_receipt}</dd>
                </>
              )}
              <dt>Started</dt>
              <dd>{formatDate(payment.created_at)}</dd>
              <dt>Payment ID</dt>
              <dd className="mono small">{payment.id}</dd>
            </dl>
          </>
        ) : null}
        {error && <ErrorBanner message={error} onRetry={() => void load()} />}
        <div className="modal-actions">
          <Link to="/history" className="btn btn-secondary">
            View history
          </Link>
          <Link to={payment?.kind === 'request' ? '/merchant' : '/pay'} className="btn btn-primary">
            {payment?.kind === 'request' ? 'Back to dashboard' : 'New payment'}
          </Link>
        </div>
      </Card>
    </div>
  );
}
