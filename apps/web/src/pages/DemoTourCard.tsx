import { Link } from 'react-router';
import { CalendarCheck, FileSignature, FileUp, GitCompareArrows, Megaphone, QrCode, ShieldCheck, SquarePen } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const TOUR = [
  { key: 'upi', to: '/invoices', icon: QrCode },
  { key: 'collections', to: '/collections', icon: Megaphone },
  { key: 'quotes', to: '/quotes', icon: FileSignature },
  { key: 'gstr2b', to: '/reports?tab=gst&return=gstr-2b', icon: GitCompareArrows },
  { key: 'msme', to: '/reports?tab=msme', icon: ShieldCheck },
  { key: 'yearEnd', to: '/year-end', icon: CalendarCheck },
  { key: 'tally', to: '/imports', icon: FileUp },
  { key: 'cheque', to: '/payments', icon: SquarePen },
] as const;

/** In the demo only: what makes LedgerNest different, each a click away */
export default function DemoTourCard() {
  const { t } = useTranslation();
  return (
    <section className="rounded-card border border-brand-200 bg-brand-50/60 p-6 shadow-card dark:border-brand-900 dark:bg-brand-950/30" aria-labelledby="tour-title">
      <h2 id="tour-title" className="text-lg font-semibold">
        {t('dashboard.tour.title')}
      </h2>
      <p className="mb-4 text-sm text-ink-500">{t('dashboard.tour.body')}</p>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {TOUR.map(({ key, to, icon: Icon }) => (
          <li key={key}>
            <Link to={to} className="flex h-full gap-3 rounded-xl bg-white p-3 text-sm shadow-sm transition-colors hover:bg-brand-50 dark:bg-ink-900 dark:hover:bg-ink-800">
              <Icon className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden />
              <span>
                <span className="block font-medium">{t(`dashboard.tour.items.${key}.title`)}</span>
                <span className="block text-xs text-ink-500">{t(`dashboard.tour.items.${key}.body`)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
