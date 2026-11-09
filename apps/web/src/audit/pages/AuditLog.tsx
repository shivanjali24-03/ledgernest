import { useCallback, useContext, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { motion } from 'motion/react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AUDIT_ACTION_GROUPS, AUDIT_EXPORT_LIMIT, type AuditActionGroup } from '@ledgernest/shared';
import { Building2, Download, Lock, ScrollText, SearchX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../../i18n';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import { apiErrorMessage } from '../../platform/errors';
import { PlatformApiContext } from '../../platform/context';
import { useRoles } from '../../team/queries';
import Button from '../../ui/Button';
import { Card, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../ui/Kit';
import { useToast } from '../../ui/toastContext';
import AuditEntryRow from '../AuditEntryRow';
import AuditFilters, { type FilterValues } from '../AuditFilters';
import { dayBoundary } from '../diff';
import type { AuditEntry, AuditFilters as Filters, AuditScope } from '../types';
import { useAuditApi } from '../useAuditApi';

/** Saves a downloaded file in the browser. */
function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Entries grouped under "Today", "Yesterday" or the date, in the reader's time zone. */
function byDay(items: AuditEntry[], locale: string, t: (k: string) => string) {
  const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const fmt = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const days: { key: string; label: string; items: AuditEntry[] }[] = [];
  for (const e of items) {
    const d = new Date(e.createdAt);
    const k = key(d);
    let day = days[days.length - 1];
    if (day?.key !== k) {
      day = {
        key: k,
        label: k === key(today) ? t('audit.today') : k === key(yesterday) ? t('audit.yesterday') : fmt.format(d),
        items: [],
      };
      days.push(day);
    }
    day.items.push(e);
  }
  return days;
}

const isGroup = (v: string | null): v is AuditActionGroup => !!v && v in AUDIT_ACTION_GROUPS;

/** The organisation's audit log, or (scope "platform") the whole platform's, for Super Admins. */
export default function AuditLog({ scope }: { scope: AuditScope }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const session = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const api = useAuditApi(scope);
  const platformApi = useContext(PlatformApiContext);
  const [params, setParams] = useSearchParams();

  const values: FilterValues = {
    group: isGroup(params.get('group')) ? params.get('group')! : '',
    person: params.get('person') ?? '',
    org: scope === 'platform' ? (params.get('org') ?? '') : '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
  };
  const filters: Filters = useMemo(
    () => ({
      group: (values.group || undefined) as AuditActionGroup | undefined,
      actorId: values.person || undefined,
      organizationId: values.org || undefined,
      from: dayBoundary(values.from, 'start'),
      to: dayBoundary(values.to, 'end'),
    }),
    [values.group, values.person, values.org, values.from, values.to],
  );
  const badRange = !!(values.from && values.to && values.from > values.to);

  const onFilters = useCallback(
    (patch: Partial<FilterValues>) =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          for (const [k, v] of Object.entries(patch))
            if (v) n.set(k, v);
            else n.delete(k);
          return n;
        },
        { replace: true },
      ),
    [setParams],
  );

  const base = ['audit', scope, session.organizationId, session.role ?? session.customRoleName] as const;
  const log = useInfiniteQuery({
    queryKey: [...base, 'log', filters],
    queryFn: ({ pageParam }) => api!.list(filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!api && !badRange,
  });
  const people = useQuery({
    queryKey: [...base, 'actors'],
    queryFn: () => api!.actors(),
    enabled: !!api,
  });
  const organizations = useQuery({
    queryKey: ['platform', 'organizations', { pageSize: 100 }],
    queryFn: () => platformApi!.listOrganizations({ pageSize: 100 }),
    enabled: scope === 'platform' && !!platformApi,
  });
  // Custom role names for "role changed" entries, when this person may see roles
  const roles = useRoles();
  const roleName = useCallback((id: string) => roles.data?.custom.find((r) => r.id === id)?.name, [roles.data]);

  const exportCsv = useMutation({
    mutationFn: () => api!.exportCsv(filters),
    onSuccess: (out) => {
      saveFile(out.blob, out.filename);
      toast(
        out.truncated
          ? t('audit.exportTruncated', {
              limit: AUDIT_EXPORT_LIMIT.toLocaleString(locale),
            })
          : t('audit.exported', { file: out.filename }),
        out.truncated ? 'error' : undefined,
      );
      // The export itself is now in the log
      void queryClient.invalidateQueries({ queryKey: base });
    },
    onError: (e) => toast(apiErrorMessage(e, t), 'error'),
  });

  if (!api) {
    return (
      <Card>
        <EmptyState icon={<Building2 className="size-5" />} title={t('team.noOrganization')} body={t('team.noOrganizationBody')} />
      </Card>
    );
  }

  const items = log.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = Object.values(values).some(Boolean);
  const days = byDay(items, locale, t);

  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <PageHeader
          eyebrow={scope === 'platform' ? t('platform.eyebrow') : <span dir="auto">{session.organization}</span>}
          title={scope === 'platform' ? t('audit.platformTitle') : t('audit.title')}
          description={scope === 'platform' ? t('audit.platformDescription') : t('audit.description')}
          actions={
            <Button variant="secondary" icon={<Download className="size-4" />} loading={exportCsv.isPending} disabled={badRange} onClick={() => exportCsv.mutate()}>
              {exportCsv.isPending ? t('audit.exporting') : t('audit.export')}
            </Button>
          }
        />
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-income/10 px-2.5 py-1 text-xs font-medium text-income">
          <Lock className="size-3.5" aria-hidden /> {t('audit.tamperProof')}
        </p>
      </motion.div>

      <motion.div variants={fadeUp}>
        <Card className="p-4">
          <AuditFilters scope={scope} values={values} onChange={onFilters} people={people.data ?? []} organizations={organizations.data?.items ?? []} />
        </Card>
      </motion.div>

      <motion.div variants={fadeUp}>
        <Card className="overflow-hidden">
          {badRange ? (
            <EmptyState icon={<SearchX className="size-5" />} title={t('audit.filters.badRange')} />
          ) : log.isPending ? (
            <SkeletonRows rows={6} />
          ) : log.isError ? (
            <ErrorState onRetry={() => void log.refetch()} />
          ) : items.length === 0 ? (
            filtered ? (
              <EmptyState
                icon={<SearchX className="size-5" />}
                title={t('audit.noMatches')}
                action={
                  <Button
                    variant="secondary"
                    onClick={() =>
                      onFilters({
                        group: '',
                        person: '',
                        org: '',
                        from: '',
                        to: '',
                      })
                    }
                  >
                    {t('audit.filters.clear')}
                  </Button>
                }
              />
            ) : (
              <EmptyState icon={<ScrollText className="size-5" />} title={t('audit.empty')} body={scope === 'platform' ? undefined : t('audit.emptyBody')} />
            )
          ) : (
            <>
              {days.map((day) => (
                <section key={day.key} aria-labelledby={`audit-day-${day.key}`}>
                  <h2
                    id={`audit-day-${day.key}`}
                    className="border-b border-ink-100 bg-ink-50/70 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-400 dark:border-ink-800 dark:bg-ink-950/30"
                  >
                    {day.label}
                  </h2>
                  <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                    {day.items.map((e) => (
                      <AuditEntryRow key={e.id} entry={e} showOrganization={scope === 'platform'} roleName={scope === 'organization' ? roleName : undefined} />
                    ))}
                  </ul>
                </section>
              ))}
              <div className="flex items-center justify-center border-t border-ink-100 p-4 dark:border-ink-800">
                {log.hasNextPage ? (
                  <Button variant="secondary" loading={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
                    {t('audit.loadMore')}
                  </Button>
                ) : (
                  <p className="text-xs text-ink-400" role="status">
                    {t('audit.allLoaded', { count: items.length })}
                  </p>
                )}
              </div>
            </>
          )}
        </Card>
      </motion.div>
    </motion.div>
  );
}
