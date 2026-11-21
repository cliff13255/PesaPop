import { useState } from 'react';
import { api } from '../api/client';
import type { PaymentStatus } from '../api/types';
import { PaymentDetailModal } from '../components/PaymentDetailModal';
import { TransactionRow } from '../components/TransactionRow';
import { Card, EmptyState, ErrorBanner, Skeleton, StatusBadge } from '../components/ui';
import { formatDate, formatKES } from '../lib/format';
import { useApi } from '../lib/useApi';
import { useDemo } from '../demo/DemoContext';

const TABS: { label: string; value?: PaymentStatus }[] = [
  { label: 'All' },
  { label: 'Successful', value: 'success' },
  { label: 'Pending', value: 'pending' },
  { label: 'Failed', value: 'failed' },
];
const LIMIT = 10;

export function HistoryPage() {
  const { role } = useDemo();
  const merchant = role === 'merchant';
  const [status, setStatus] = useState<PaymentStatus | undefined>();
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, error, loading, reload } = useApi(
    () => (merchant ? api.merchantTransactions : api.listTransactions)({ status, page, limit: LIMIT }),
    [status, page, merchant],
  );

  const choose = (s?: PaymentStatus) => {
    setStatus(s);
    setPage(1);
  };

  return (
    <div className="container page">
      <h1>{merchant ? 'All shop payments' : 'Your payments'}</h1>
      <div className="tabs scroll" role="tablist" aria-label="Filter by status">
        {TABS.map((t) => (
          <button key={t.label} type="button" role="tab" aria-selected={status === t.value} className={status === t.value ? 'tab active' : 'tab'} onClick={() => choose(t.value)}>
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        {loading && <Skeleton rows={6} />}
        {error && <ErrorBanner message={error} onRetry={reload} />}
        {data && !loading && data.items.length === 0 && (
          <EmptyState title={status ? `No ${TABS.find((t) => t.value === status)?.label.toLowerCase()} payments` : 'No payments yet'} />
        )}
        {data && !loading && data.items.length > 0 && (
          <>
            {/* Table on wide screens */}
            <table className="tx-table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>{merchant ? 'Phone' : 'Recipient'}</th>
                  <th>Type</th>
                  <th className="num">Amount</th>
                  <th>Date (Nairobi)</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((tx) => (
                  <tr key={tx.id} onClick={() => setOpenId(tx.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpenId(tx.id)}>
                    <td className="mono">{tx.reference}</td>
                    <td>{merchant ? tx.phone : tx.recipient}</td>
                    <td>{tx.kind === 'request' ? 'Request' : 'Payment'}</td>
                    <td className="num">{formatKES(tx.amount)}</td>
                    <td>{formatDate(tx.created_at)}</td>
                    <td>
                      <StatusBadge status={tx.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Cards on mobile */}
            <ul className="tx-list tx-list-mobile">
              {data.items.map((tx) => (
                <TransactionRow key={tx.id} tx={tx} merchant={merchant} onClick={() => setOpenId(tx.id)} />
              ))}
            </ul>
            <div className="pager">
              <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <span className="muted small">
                Page {data.pagination.page} of {Math.max(1, data.pagination.total_pages)} · {data.pagination.total} payments
              </span>
              <button type="button" className="btn btn-secondary btn-sm" disabled={page >= data.pagination.total_pages} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </div>
          </>
        )}
      </Card>
      {openId && <PaymentDetailModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
