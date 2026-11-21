// Design system primitives. Styles live in styles.css.
import { useEffect, useRef, type ReactNode } from 'react';
import type { PaymentStatus } from '../api/types';
import { useDemo } from '../demo/DemoContext';

export function Spinner({ label = 'Loading', block = false }: { label?: string; block?: boolean }) {
  return (
    <div className={block ? 'spinner-block' : 'spinner-inline'} role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span className={block ? '' : 'sr-only'}>{label}</span>
    </div>
  );
}

const STATUS_TEXT: Record<PaymentStatus, string> = { pending: 'Pending', success: 'Successful', failed: 'Failed' };

export function StatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <span className={`badge badge-${status}`}>
      <span className="badge-icon" aria-hidden="true">
        {status === 'success' ? '✓' : status === 'failed' ? '✕' : '•'}
      </span>
      {STATUS_TEXT[status]}
    </span>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-banner" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">◌</div>
      <p className="empty-title">{title}</p>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

/** Tells the viewer exactly how real the payments are. */
export function ModeBanner() {
  const { config } = useDemo();
  if (!config || config.provider_mode === 'live') return null;
  return (
    <div className={`mode-banner mode-${config.provider_mode}`} role="note">
      <div className="container">
        {config.provider_mode === 'simulated'
          ? 'Demo mode: payments are simulated. No real M-Pesa prompt is sent and no money moves.'
          : 'PayHero sandbox: test payments only.'}{' '}
        Max KES {config.max_amount.toLocaleString('en-KE')} per payment.
      </div>
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row" />
      ))}
    </div>
  );
}

/** Accessible modal: focus moves in, Escape closes, background is inert to clicks. */
export function Modal({
  title,
  onClose,
  children,
  closeDisabled = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  closeDisabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !closeDisabled) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose, closeDisabled]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !closeDisabled && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabIndex={-1} ref={ref}>
        <div className="modal-head">
          <h2 id="modal-title">{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose} disabled={closeDisabled}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
