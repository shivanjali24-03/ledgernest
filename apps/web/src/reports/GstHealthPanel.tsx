import { Link } from 'react-router';
import { AlertTriangle, CheckCircle2, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, ErrorState, SkeletonRows } from '../ui/Kit';
import type { GstHealth } from './types';

/** Where to fix each kind of problem, and where each example opens */
const FIX: Record<GstHealth['issues'][number]['kind'], { page: string; example?: (id: string) => string }> = {
  org_gstin: { page: '/settings' },
  org_address: { page: '/settings' },
  items_hsn: { page: '/items' },
  customers_state: { page: '/contacts', example: (id) => `/contacts/${id}` },
  customers_einvoice: { page: '/contacts', example: (id) => `/contacts/${id}` },
  vendors_gstin: { page: '/contacts', example: (id) => `/contacts/${id}` },
};

/** The GST health check: what would go wrong when filing, worst first, each with a way to fix it */
export default function GstHealthPanel({ data, isPending, isError, onRetry }: { data: GstHealth | undefined; isPending: boolean; isError: boolean; onRetry: () => void }) {
  const { t } = useTranslation();
  if (!data) return <Card>{isPending ? <SkeletonRows rows={4} /> : isError ? <ErrorState onRetry={onRetry} /> : null}</Card>;
  if (!data.issues.length)
    return (
      <Card className="flex items-start gap-3 p-5">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-income" aria-hidden />
        <div>
          <p className="font-semibold">{t('reports.gstHealth.allClear')}</p>
          <p className="text-sm text-ink-500">{t('reports.gstHealth.allClearBody')}</p>
        </div>
      </Card>
    );
  return (
    <ul className="space-y-3" aria-label={t('reports.gstHealth.title')}>
      {data.issues.map((i) => (
        <li key={i.kind}>
          <Card className="p-4">
            <div className="flex flex-wrap items-start gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{t(`reports.gstHealth.kinds.${i.kind}.title`, { count: i.count })}</p>
                <p className="text-sm text-ink-500">{t(`reports.gstHealth.kinds.${i.kind}.why`)}</p>
                {i.sample.length > 0 && (
                  <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                    {i.sample.map((s) =>
                      FIX[i.kind].example ? (
                        <Link key={s.id} to={FIX[i.kind].example!(s.id)} className="text-brand-700 hover:underline dark:text-brand-300" dir="auto">
                          {s.name}
                        </Link>
                      ) : (
                        <span key={s.id} dir="auto">
                          {s.name}
                        </span>
                      ),
                    )}
                    {i.count > i.sample.length && <span className="text-ink-500">{t('reports.gstHealth.more', { count: i.count - i.sample.length })}</span>}
                  </p>
                )}
              </div>
              <Link to={FIX[i.kind].page} className="inline-flex shrink-0 items-center text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
                {t('reports.gstHealth.fix')} <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
              </Link>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
