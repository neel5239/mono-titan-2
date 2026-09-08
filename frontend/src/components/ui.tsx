import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { errorMessage, isNetworkError } from '../api/client';
import { useT } from '../i18n';
import { IconCheck, IconClose, IconInfo, IconWarning } from './Icons';

type AlertKind = 'error' | 'warn' | 'info' | 'good';

export function Alert({ kind, title, children }: { kind: AlertKind; title?: string; children?: ReactNode }) {
  const Icon = kind === 'good' ? IconCheck : kind === 'info' ? IconInfo : IconWarning;
  return (
    <div className={`alert alert--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon />
      <div className="alert__body">
        {title ? <div className="alert__title">{title}</div> : null}
        {children ? <div>{children}</div> : null}
      </div>
    </div>
  );
}

/** Renders an API error. Network failures get the "server not running" copy. */
export function ErrorAlert({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useT();
  const network = isNetworkError(error);
  const msg = network ? t('app.serverDown') : errorMessage(error);
  const [before, cmd, after] = msg.split('`');
  return (
    <div className="alert alert--error" role="alert">
      <IconWarning />
      <div className="alert__body">
        <div className="alert__title">{t('app.errorTitle')}</div>
        <div>
          {before}
          {cmd ? <code>{cmd}</code> : null}
          {after}
        </div>
        {network ? <div className="muted xs">{t('app.serverDownHint')}</div> : null}
        {onRetry ? (
          <div>
            <button type="button" className="btn btn--secondary btn--sm" onClick={onRetry}>
              {t('app.retry')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Loading({ label, block = false }: { label?: string; block?: boolean }) {
  const { t } = useT();
  return (
    <div className={`loading${block ? ' loading--block' : ''}`} role="status" aria-live="polite">
      <div className={`spinner${block ? ' spinner--lg' : ''}`} />
      <span>{label ?? t('app.loading')}</span>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Toast({ message, onDone, ms = 3200 }: { message: string | null; onDone: () => void; ms?: number }) {
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(() => onDoneRef.current(), ms);
    return () => window.clearTimeout(id);
  }, [message, ms]);
  if (!message) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}

export function Dialog({
  title,
  onClose,
  children,
  small = false,
  printable = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  small?: boolean;
  printable?: boolean;
}) {
  const { t } = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    if (printable) document.body.classList.add('print-dialog');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('print-dialog');
    };
  }, [onClose, printable]);

  return createPortal(
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog${small ? ' dialog--sm' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog__header no-print">
          <h2>{title}</h2>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} aria-label={t('app.close')}>
            <IconClose />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
