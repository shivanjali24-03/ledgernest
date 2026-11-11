import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Copy, Search } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import Button from './Button';
import { inputClass } from './Field';

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      {/* The title takes the room; a long description wraps rather than pushing the actions onto their own row */}
      <div className="min-w-0 flex-1 basis-80">
        {eyebrow && <div className="mb-1 text-sm font-medium text-brand-700 dark:text-brand-300">{eyebrow}</div>}
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl" dir="auto">
          {title}
        </h1>
        {description && <p className="mt-1 text-sm text-ink-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:ms-auto sm:justify-end">{actions}</div>}
    </header>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={clsx('rounded-card border border-ink-200 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900', className)}>{children}</section>;
}

export function StatusBadge({ status }: { status: 'ACTIVE' | 'SUSPENDED' }) {
  const { t } = useTranslation();
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold',
        status === 'ACTIVE' ? 'bg-income/10 text-income' : 'bg-warning/10 text-warning',
      )}
    >
      <span className={clsx('size-1.5 rounded-full', status === 'ACTIVE' ? 'bg-income' : 'bg-warning')} aria-hidden />
      {t(`common.status.${status}`)}
    </span>
  );
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'brand' }) {
  return (
    <span className={clsx('inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold', tone === 'brand' ? 'bg-brand-100 text-brand-800 dark:bg-brand-900/60 dark:text-brand-100' : 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300')}>
      {children}
    </span>
  );
}

/** Search box that reports its value after the user stops typing for a moment. */
export function SearchInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [text, setText] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => text !== value && onChange(text), 300);
    return () => clearTimeout(h);
  }, [text, value, onChange]);
  return (
    <label className="relative block w-full sm:w-72">
      <span className="sr-only">{label}</span>
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" aria-hidden />
      <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={label} className={clsx(inputClass, 'border-ink-200 ps-9 dark:border-ink-700')} />
    </label>
  );
}

/** Segmented filter, e.g. All / Active / Suspended. */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    // Scrolls sideways instead of overflowing when the options don't fit (long labels, narrow phones)
    <div role="radiogroup" aria-label={label} className="scroll-cue inline-flex max-w-full overflow-x-auto rounded-xl border border-ink-200 p-1 dark:border-ink-700">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={(e) => (onChange(o.value), e.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }))}
          className={clsx(
            'h-8 shrink-0 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors',
            value === o.value ? 'bg-brand-100 text-brand-800 dark:bg-brand-900/60 dark:text-brand-100' : 'text-ink-500 hover:text-ink-800 dark:hover:text-ink-200',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <nav className="flex items-center justify-between gap-2 px-4 py-3 text-sm text-ink-500" aria-label={t('common.pagination')}>
      <span>{t('common.pageOf', { page, pages })}</span>
      <div className="flex gap-1">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t('common.previous')}>
          <ChevronLeft className="size-4 rtl:-scale-x-100" />
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label={t('common.next')}>
          <ChevronRight className="size-4 rtl:-scale-x-100" />
        </Button>
      </div>
    </nav>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="grid size-12 place-items-center rounded-2xl bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200">{icon}</div>
      <p className="mt-4 font-semibold">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-ink-500">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-14 text-center">
      <AlertTriangle className="size-8 text-warning" aria-hidden />
      <p className="mt-3 font-semibold">{t('common.loadFailed')}</p>
      <Button variant="secondary" className="mt-4" onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </div>
  );
}

/** Grey placeholder rows while data loads (pulse uses opacity only). */
export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  const { t } = useTranslation();
  return (
    <div className="divide-y divide-ink-100 dark:divide-ink-800" role="status" aria-label={t('common.loading')}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-4 px-4 py-4">
          <div className="h-4 w-1/3 rounded bg-ink-100 dark:bg-ink-800" />
          <div className="h-4 w-1/5 rounded bg-ink-100 dark:bg-ink-800" />
          <div className="ms-auto h-4 w-16 rounded bg-ink-100 dark:bg-ink-800" />
        </div>
      ))}
    </div>
  );
}

/** Read-only value with a copy button, e.g. an invitation link. */
export function CopyField({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the text is selectable */
    }
  };
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <div className="flex gap-2">
        <input readOnly value={value} dir="ltr" onFocus={(e) => e.currentTarget.select()} aria-label={label} className={clsx(inputClass, 'border-ink-200 font-mono text-xs dark:border-ink-700')} />
        <Button variant="secondary" onClick={() => void copy()} icon={copied ? <Check className="size-4 text-income" /> : <Copy className="size-4" />}>
          {copied ? t('common.copied') : t('common.copy')}
        </Button>
      </div>
    </div>
  );
}
