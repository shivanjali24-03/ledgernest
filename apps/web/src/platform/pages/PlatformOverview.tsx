import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Building2, Plus, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../../i18n';
import { formatRelative } from '../../lib/format';
import AnimatedNumber from '../../motion/AnimatedNumber';
import { fadeUp, stagger } from '../../motion/tokens';
import Button from '../../ui/Button';
import { Card, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../ui/Kit';
import { usePlatformApi } from '../context';
import { activityKey } from '../options';

function Stat({ icon, label, value, sub }: { icon: ReactNode; label: string; value: number | undefined; sub?: string }) {
  const locale = useIntlLocale();
  const fmt = (n: number) => new Intl.NumberFormat(locale).format(Math.round(n));
  return (
    <motion.article variants={fadeUp} className="lift rounded-card border border-ink-200 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
      <div className="flex items-center gap-2 text-sm text-ink-500">
        <span className="grid size-8 place-items-center rounded-lg bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200">{icon}</span>
        {label}
      </div>
      <p className="tabular mt-3 text-3xl font-bold tracking-tight">{value === undefined ? <span className="inline-block h-8 w-16 animate-pulse rounded bg-ink-100 dark:bg-ink-800" /> : <AnimatedNumber value={value} format={fmt} />}</p>
      {sub && <p className="mt-1 text-xs text-ink-500">{sub}</p>}
    </motion.article>
  );
}

export default function PlatformOverview() {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const api = usePlatformApi();
  const navigate = useNavigate();
  const { data, isError, refetch } = useQuery({ queryKey: ['platform', 'stats'], queryFn: () => api.stats() });

  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <PageHeader
          eyebrow={t('platform.eyebrow')}
          title={t('platform.overview.title')}
          description={t('platform.overview.description')}
          actions={
            <Button icon={<Plus className="size-4" />} onClick={() => navigate('/platform/organizations?new=1')}>
              {t('platform.organizations.new')}
            </Button>
          }
        />
      </motion.div>

      {isError ? (
        <Card>
          <ErrorState onRetry={() => void refetch()} />
        </Card>
      ) : (
        <>
          <motion.section variants={stagger(0.06)} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label={t('platform.overview.keyFigures')}>
            <Stat
              icon={<Building2 className="size-4" />}
              label={t('platform.overview.organizations')}
              value={data?.organizations.total}
              sub={data && t('platform.overview.activeSuspended', { active: data.organizations.active, suspended: data.organizations.suspended })}
            />
            <Stat icon={<Sparkles className="size-4" />} label={t('platform.overview.newThisMonth')} value={data?.organizations.newLast30Days} sub={t('platform.overview.last30Days')} />
            <Stat
              icon={<Users className="size-4" />}
              label={t('platform.overview.users')}
              value={data?.users.total}
              sub={data && t('platform.overview.superAdmins', { count: data.users.superAdmins })}
            />
            <Stat
              icon={<ShieldCheck className="size-4" />}
              label={t('platform.overview.signIns')}
              value={data?.activity.signInsLast7Days}
              sub={data && t('platform.overview.failedSignIns', { count: data.activity.failedSignInsLast7Days })}
            />
          </motion.section>

          <motion.div variants={fadeUp}>
            <Card>
              <h2 className="flex items-center gap-2 border-b border-ink-100 px-5 py-4 font-semibold dark:border-ink-800">
                <Activity className="size-4 text-brand-600" aria-hidden /> {t('platform.overview.recent')}
              </h2>
              {!data ? (
                <SkeletonRows rows={4} />
              ) : data.recent.length === 0 ? (
                <EmptyState icon={<Activity className="size-5" />} title={t('platform.overview.noActivity')} />
              ) : (
                <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                  {data.recent.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
                      <span className="font-medium" dir="auto">
                        {a.actor?.name ?? t('platform.overview.system')}
                      </span>
                      <span className="text-ink-500">{t(activityKey(a.action), { defaultValue: a.action })}</span>
                      {a.organization && (
                        <Link to={`/platform/organizations/${a.organization.id}`} className="font-medium text-brand-700 hover:underline dark:text-brand-300" dir="auto">
                          {a.organization.name}
                        </Link>
                      )}
                      <time dateTime={a.createdAt} className="ms-auto text-xs text-ink-400">
                        {formatRelative(a.createdAt, locale)}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </motion.div>
        </>
      )}
    </motion.div>
  );
}
