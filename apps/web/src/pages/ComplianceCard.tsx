import { Link } from 'react-router';
import { CalendarClock, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../i18n';
import { useMoney } from '../lib/useMoney';
import type { Compliance } from '../reports/types';

/** India's due dates coming up: the GST returns (with GSTR-3B's tax to pay so far), the annual return, advance tax */
export default function ComplianceCard({ data }: { data: Compliance }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  const day = (d: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
  const month = (d: string) => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
  const fy = (from: string) => `${from.slice(0, 4)}-${String(Number(from.slice(2, 4)) + 1).padStart(2, '0')}`;
  const link = (i: Compliance['items'][number]) =>
    i.kind === 'gstr1' ? `/reports?tab=gst&return=gstr-1&from=${i.from}&to=${i.to}` : i.kind === 'gstr3b' ? `/reports?tab=gst&from=${i.from}&to=${i.to}` : i.kind === 'gstr9' ? `/reports?tab=tax&from=${i.from}&to=${i.to}` : i.kind === 'tds' ? `/reports?tab=tds&from=${i.from}&to=${i.to}` : '/reports?tab=pnl';
  return (
    <section className="rounded-card border border-ink-200 bg-white p-6 shadow-card dark:border-ink-800 dark:bg-ink-900" aria-labelledby="compliance-title">
      <h2 id="compliance-title" className="flex items-center gap-2 text-lg font-semibold">
        <CalendarClock className="size-5 text-brand-600" aria-hidden /> {t('dashboard.compliance.title')}
      </h2>
      <p className="mb-3 text-sm text-ink-500">{t('dashboard.compliance.hint')}</p>
      <ul className="divide-y divide-ink-100 dark:divide-ink-800">
        {data.items.map((i) => (
          <li key={`${i.kind}-${i.due}`}>
            <Link to={link(i)} className="flex items-center gap-3 py-2.5 text-sm hover:text-brand-700 dark:hover:text-brand-300">
              <span className={clsx('w-16 shrink-0 rounded-lg px-2 py-1 text-center text-xs font-semibold', i.daysLeft < 0 ? 'bg-expense/10 text-expense' : i.daysLeft <= 3 ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200' : 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300')}>{day(i.due)}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t(`dashboard.compliance.kinds.${i.kind}`, { period: i.kind === 'gstr1' || i.kind === 'gstr3b' || i.kind === 'tds' ? month(i.from) : fy(i.from), share: Math.round((i.share ?? 0) * 100) })}</span>
                <span className="block text-xs text-ink-500">
                  {i.daysLeft < 0 ? t('dashboard.compliance.overdue', { count: -i.daysLeft }) : i.daysLeft === 0 ? t('dashboard.compliance.today') : t('dashboard.compliance.daysLeft', { count: i.daysLeft })}
                  {i.amount !== undefined && ` · ${i.kind === 'tds' ? t('dashboard.compliance.tdsToPay', { amount: money.format(i.amount) }) : i.amount > 0 ? t('dashboard.compliance.toPay', { amount: money.format(i.amount) }) : t('dashboard.compliance.nothingToPay')}`}
                </span>
              </span>
              <ChevronRight className="size-4 text-ink-400 rtl:-scale-x-100" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
