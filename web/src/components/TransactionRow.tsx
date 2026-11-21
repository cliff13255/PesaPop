import type { TransactionItem } from '../api/types';
import { formatDate, formatKES } from '../lib/format';
import { StatusBadge } from './ui';

/** `merchant` rows show who paid (masked phone) and whether it was a request. */
export function TransactionRow({ tx, onClick, merchant = false }: { tx: TransactionItem; onClick?: () => void; merchant?: boolean }) {
  const title = merchant ? (tx.kind === 'request' ? `Request to ${tx.phone}` : `From ${tx.phone}`) : tx.kind === 'request' ? `Requested by ${tx.recipient}` : tx.recipient;
  const content = (
    <>
      <div className="tx-main">
        <span className="tx-recipient">{title}</span>
        <span className="tx-meta">M-Pesa · {formatDate(tx.created_at)}</span>
        <span className="tx-ref">{tx.reference}</span>
      </div>
      <div className="tx-side">
        <span className="tx-amount">{formatKES(tx.amount)}</span>
        <StatusBadge status={tx.status} />
      </div>
    </>
  );
  return onClick ? (
    <li>
      <button type="button" className="tx-row tx-row-btn" onClick={onClick}>
        {content}
      </button>
    </li>
  ) : (
    <li className="tx-row">{content}</li>
  );
}
