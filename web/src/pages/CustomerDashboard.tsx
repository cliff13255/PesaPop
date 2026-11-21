import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { TransactionRow } from '../components/TransactionRow';
import { Card, EmptyState, ErrorBanner, Skeleton } from '../components/ui';
import { useApi } from '../lib/useApi';

export function CustomerDashboard() {
  const recent = useApi(() => api.listTransactions({ limit: 5 }), []);

  return (
    <div className="container page">
      <h1>Habari 👋</h1>
      <p className="muted">Pay anyone with M-Pesa. You always confirm before anything is sent.</p>

      <div className="grid-3 actions">
        <Link to="/pay" className="action-card">
          <span className="action-icon" aria-hidden="true">📱</span>
          <strong>Pay with M-Pesa</strong>
          <span className="muted small">Fill in a short form</span>
        </Link>
        <Link to="/assistant" className="action-card">
          <span className="action-icon" aria-hidden="true">💬</span>
          <strong>Ask the AI assistant</strong>
          <span className="muted small">“Send 500 to John”</span>
        </Link>
        <Link to="/history" className="action-card">
          <span className="action-icon" aria-hidden="true">🧾</span>
          <strong>Your history</strong>
          <span className="muted small">Every payment and its status</span>
        </Link>
      </div>

      <Card>
        <div className="card-head">
          <h2>Recent payments</h2>
          <Link to="/history">View all</Link>
        </div>
        {recent.loading && <Skeleton rows={4} />}
        {recent.error && <ErrorBanner message={recent.error} onRetry={recent.reload} />}
        {recent.data && !recent.loading &&
          (recent.data.items.length === 0 ? (
            <EmptyState title="No payments yet">
              <Link to="/pay" className="btn btn-primary btn-sm">
                Make your first payment
              </Link>
            </EmptyState>
          ) : (
            <ul className="tx-list">
              {recent.data.items.map((tx) => (
                <TransactionRow key={tx.id} tx={tx} />
              ))}
            </ul>
          ))}
      </Card>
    </div>
  );
}
