import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import type { InvoiceStatus, SyncStatus } from '../lib/types';
import { STATUS_LABEL } from '../lib/format';

/* ---------------- Button ---------------- */
export function Button({
  children,
  variant = 'primary',
  size,
  className = '',
  block,
  ...rest
}: {
  children: ReactNode;
  variant?: 'primary' | 'dark' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'lg';
  block?: boolean;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`btn btn-${variant}${size ? ` btn-${size}` : ''}${block ? ' btn-block' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ---------------- Card ---------------- */
export function Card({ title, right, children, className = '' }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`card ${className}`}>
      {(title || right) && (
        <div className="card-title">
          <span>{title}</span>
          {right && <span>{right}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

/* ---------------- Spinner ---------------- */
export function Spinner({ label }: { label?: string }) {
  return (
    <div className="center-fill">
      <div className="spinner" />
      {label && <div style={{ fontSize: 14 }}>{label}</div>}
    </div>
  );
}

/* ---------------- EmptyState ---------------- */
export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="es-icon">{icon}</div>
      <h4>{title}</h4>
      {text && <p>{text}</p>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}

/* ---------------- Badge ---------------- */
export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>;
}

/* ---------------- Modal ---------------- */
export function Modal({
  open,
  title,
  onClose,
  children,
  width
}: {
  open: boolean;
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={width ? { maxWidth: width } : undefined}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={17} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/* ---------------- ConfirmDialog ---------------- */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  danger = true,
  onConfirm,
  onCancel
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} title={title} onClose={onCancel} width={400}>
      <div style={{ color: 'var(--text-2)', fontSize: 14, marginBottom: 18 }}>{message}</div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

/* ---------------- Form field ---------------- */
export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="search-input">
      <Search size={17} />
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || 'Search…'}
        style={{ paddingLeft: 38 }}
      />
    </div>
  );
}

/* ---------------- StatCard ---------------- */
export function StatCard({ label, value, icon, tone = 'blue' }: { label: string; value: string; icon: ReactNode; tone?: 'blue' | 'green' | 'amber' | 'navy' | 'red' }) {
  const tones: Record<string, { bg: string; color: string }> = {
    blue: { bg: 'var(--blue-bg)', color: 'var(--blue)' },
    green: { bg: 'var(--green-bg)', color: 'var(--green)' },
    amber: { bg: 'var(--amber-bg)', color: 'var(--amber)' },
    red: { bg: 'var(--red-bg)', color: 'var(--red)' },
    navy: { bg: 'var(--navy-800)', color: '#fff' }
  };
  const t = tones[tone];
  return (
    <div className="card stat-card">
      <div className="stat-label">
        <span className="stat-icon" style={{ background: t.bg, color: t.color }}>
          {icon}
        </span>
        {label}
      </div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

/* ---------------- SyncPill ---------------- */
const SYNC_META: Record<SyncStatus, string> = {
  synced: 'Synced',
  syncing: 'Syncing…',
  offline: 'Offline',
  error: 'Sync error'
};

export function SyncPill({ status, demo, errorMsg }: { status: SyncStatus; demo?: boolean; errorMsg?: string | null }) {
  const cls = demo ? 'demo' : status;
  const title = demo
    ? 'Demo mode: data stays on this device'
    : status === 'error' && errorMsg
      ? errorMsg
      : undefined;
  return (
    <span className={`sync-pill ${cls}`} title={title}>
      <span className="dot" />
      {demo ? 'Demo mode' : SYNC_META[status]}
    </span>
  );
}

/* ---------------- Toasts ---------------- */
interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info' | 'warn';
  message: string;
}

const ToastCtx = createContext<{ toast: (message: string, kind?: Toast['kind']) => void }>({ toast: () => undefined });

export function useToast() {
  return useContext(ToastCtx).toast;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const toast = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <span style={{ flex: 1 }}>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------------- misc ---------------- */
export function Row({ children, gap = 10, style, className }: { children: ReactNode; gap?: number; style?: React.CSSProperties; className?: string }) {
  return (
    <div className={className} style={{ display: 'flex', alignItems: 'center', gap, flexWrap: 'wrap', ...style }}>
      {children}
    </div>
  );
}

export function numInput(value: number | string, onChange: (v: string) => void, placeholder = '0') {
  return (
    <input
      type="number"
      inputMode="decimal"
      className="input"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      min={0}
      step="any"
    />
  );
}
