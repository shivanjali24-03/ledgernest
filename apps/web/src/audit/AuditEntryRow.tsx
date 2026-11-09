import { useId, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BookOpen, BookOpenCheck, Building2, CalendarRange, ChevronDown, CircleDot, Download, KeyRound, LifeBuoy, LogIn, Mail, Settings, ShieldCheck, Users, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import type { TFunction } from 'i18next';
import type { AuditActionGroup } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../i18n';
import { countryName, formatRelative, monthName } from '../lib/format';
import { fadeUp } from '../motion/tokens';
import { Pill } from '../ui/Kit';
import { deviceOf, diffEntry, groupOf, subjectOf, toneOf, type DiffRow } from './diff';
import type { AuditEntry } from './types';

const ICONS: Record<AuditActionGroup, LucideIcon> = {
  accounts: BookOpenCheck,
  journals: BookOpen,
  periods: CalendarRange,
  signIns: LogIn,
  members: Users,
  invitations: Mail,
  roles: KeyRound,
  settings: Settings,
  supportAccess: LifeBuoy,
  organizations: Building2,
  platformUsers: ShieldCheck,
  exports: Download,
};
const TONES = {
  danger: 'bg-expense/10 text-expense',
  warning: 'bg-warning/10 text-warning',
  neutral: 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300',
};

const actionLabel = (action: string, t: TFunction) => t(`audit.actions.${action.replace(/\./g, '_')}`, { defaultValue: action });

const EMPTY = <span className="text-ink-400">—</span>;

function Value({ field, value, roleName }: { field: string; value: unknown; roleName?: (id: string) => string | undefined }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  if (value === null || value === undefined || value === '') return EMPTY;
  if (typeof value === 'boolean') return <>{value ? t('audit.yes') : t('audit.no')}</>;
  if (field === 'builtInRole' && typeof value === 'string') return <>{t(`roles.${value}`, { defaultValue: value })}</>;
  if (field === 'customRoleId' && typeof value === 'string') return <span dir="auto">{roleName?.(value) ?? <code className="text-xs">{value.slice(0, 8)}</code>}</span>;
  if (field === 'status' && typeof value === 'string') return <>{t(`common.status.${value}`, { defaultValue: value })}</>;
  if (field === 'fiscalYearStartMonth' && typeof value === 'number') return <>{monthName(value, locale)}</>;
  if (field === 'country' && typeof value === 'string') return <>{countryName(value, locale)}</>;
  if (field === 'permissions' && Array.isArray(value)) return <PermissionList items={value.map(String)} />;
  if (typeof value === 'object')
    return (
      <code className="break-all text-xs" dir="ltr">
        {JSON.stringify(value)}
      </code>
    );
  return (
    <span dir="auto" className="break-words">
      {String(value)}
    </span>
  );
}

const permissionLabel = (p: string, t: TFunction) => t(`permissions.${p.replace(/\./g, '_')}`, { defaultValue: p });

function PermissionList({ items, tone }: { items: string[]; tone?: 'added' | 'removed' }) {
  const { t } = useTranslation();
  if (!items.length) return EMPTY;
  return (
    <ul className="flex flex-wrap gap-1">
      {items.map((p) => (
        <li
          key={p}
          className={clsx(
            'rounded-md px-1.5 py-0.5 text-[11px] font-medium',
            tone === 'added'
              ? 'bg-income/10 text-income'
              : tone === 'removed'
                ? 'bg-expense/10 text-expense line-through decoration-expense/50'
                : 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300',
          )}
        >
          {tone === 'added' && <span aria-hidden>+ </span>}
          {tone === 'removed' && <span aria-hidden>− </span>}
          <span className={tone ? 'sr-only' : undefined}>{tone ? `${t(`audit.details.${tone}`)}: ` : ''}</span>
          {permissionLabel(p, t)}
        </li>
      ))}
    </ul>
  );
}

function DiffTable({ rows, roleName }: { rows: DiffRow[]; roleName?: (id: string) => string | undefined }) {
  const { t } = useTranslation();
  const field = (f: string) => t(`audit.fields.${f}`, { defaultValue: f });
  const listCell = (r: DiffRow) =>
    r.list && (
      <>
        <div className="flex flex-wrap gap-1">
          {r.list.removed.length > 0 && <PermissionList items={r.list.removed} tone="removed" />}
          {r.list.added.length > 0 && <PermissionList items={r.list.added} tone="added" />}
        </div>
        {r.list.kept.length > 0 && <p className="mt-1.5 text-xs text-ink-400">{t('audit.details.unchangedCount', { count: r.list.kept.length })}</p>}
      </>
    );
  return (
    <>
      {/* Phones: one field per block, before above after */}
      <dl className="divide-y divide-ink-100 rounded-xl border border-ink-100 sm:hidden dark:divide-ink-800 dark:border-ink-800">
        {rows.map((r) => (
          <div key={r.field} className={clsx('space-y-1 px-3 py-2 text-sm', r.change === 'same' && 'text-ink-400')}>
            <dt className="font-medium">{field(r.field)}</dt>
            {r.list ? (
              <dd>{listCell(r)}</dd>
            ) : (
              <>
                {r.change !== 'added' && (
                  <dd className={clsx('rounded-md px-2 py-1', r.change !== 'same' && 'bg-expense/5')}>
                    <span className="me-1 text-xs text-ink-400">{t('audit.details.before')}:</span>
                    <Value field={r.field} value={r.before} roleName={roleName} />
                  </dd>
                )}
                {r.change !== 'removed' && r.change !== 'same' && (
                  <dd className="rounded-md bg-income/5 px-2 py-1">
                    <span className="me-1 text-xs text-ink-400">{t('audit.details.after')}:</span>
                    <Value field={r.field} value={r.after} roleName={roleName} />
                  </dd>
                )}
              </>
            )}
          </div>
        ))}
      </dl>
      <div className="relative hidden overflow-x-auto rounded-xl border border-ink-100 sm:block dark:border-ink-800">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="bg-ink-50 text-xs uppercase tracking-wide text-ink-400 dark:bg-ink-950/40">
            <tr>
              <th scope="col" className="w-40 px-3 py-2 text-start font-semibold">
                {t('audit.details.field')}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-semibold">
                {t('audit.details.before')}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-semibold">
                {t('audit.details.after')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
            {rows.map((r) => (
              <tr key={r.field} className={clsx(r.change === 'same' && 'text-ink-400')}>
                <th scope="row" className="px-3 py-2 text-start align-top font-medium">
                  {field(r.field)}
                </th>
                {r.list ? (
                  <td colSpan={2} className="px-3 py-2 align-top">
                    {listCell(r)}
                  </td>
                ) : (
                  <>
                    <td className={clsx('px-3 py-2 align-top', r.change === 'changed' || r.change === 'removed' ? 'bg-expense/5' : '')}>
                      {r.change === 'added' ? EMPTY : <Value field={r.field} value={r.before} roleName={roleName} />}
                    </td>
                    <td className={clsx('px-3 py-2 align-top', r.change === 'changed' || r.change === 'added' ? 'bg-income/5' : '')}>
                      {r.change === 'removed' ? EMPTY : <Value field={r.field} value={r.after} roleName={roleName} />}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-400">{label}</dt>
      <dd className="mt-0.5 truncate text-sm">{children}</dd>
    </div>
  );
}

interface Props {
  entry: AuditEntry;
  showOrganization: boolean;
  roleName?: (id: string) => string | undefined;
}

/** One audit entry: a readable summary line that expands to show exactly what changed. */
export default function AuditEntryRow({ entry, showOrganization, roleName }: Props) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const group = groupOf(entry.action);
  const Icon = group ? ICONS[group] : CircleDot;
  const tone = toneOf(entry.action);
  const who = entry.actor ? (entry.actor.name ?? entry.actor.email) : t('audit.system');
  const subject = subjectOf(entry.before, entry.after);
  const rows = diffEntry(entry.before, entry.after);
  const exact = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(entry.createdAt));

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={detailsId}
        className="flex w-full items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-ink-50 focus-visible:bg-ink-50 dark:hover:bg-ink-800/50 dark:focus-visible:bg-ink-800/50"
      >
        <span className={clsx('mt-0.5 grid size-8 shrink-0 place-items-center rounded-full', TONES[tone])} aria-hidden>
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm">
            <span className="font-semibold">{actionLabel(entry.action, t)}</span>
            {subject && (
              <>
                <span className="text-ink-400" aria-hidden>
                  {' · '}
                </span>
                <span className="text-ink-700 dark:text-ink-200" dir="auto">
                  {subject}
                </span>
              </>
            )}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
            <span className="font-medium text-ink-600 dark:text-ink-300" dir="auto">
              {who}
            </span>
            {entry.actor?.name && <span dir="ltr">{entry.actor.email}</span>}
            {entry.actor && !entry.actor.id && <Pill>{t('audit.deletedUser')}</Pill>}
            {showOrganization && entry.organization && (
              <Pill tone="brand">
                <span dir="auto">{entry.organization.name}</span>
              </Pill>
            )}
          </span>
        </span>
        <time dateTime={entry.createdAt} title={exact} className="shrink-0 pt-0.5 text-xs text-ink-500">
          {formatRelative(entry.createdAt, locale)}
        </time>
        <ChevronDown className={clsx('mt-0.5 size-4 shrink-0 text-ink-400 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div id={detailsId} variants={fadeUp} initial="hidden" animate="show" exit={{ opacity: 0, transition: { duration: 0.12 } }} className="space-y-4 px-4 pb-4 sm:ps-15">
            <dl className="grid grid-cols-2 gap-3 rounded-xl bg-ink-50 p-3 sm:grid-cols-4 dark:bg-ink-950/40">
              <Meta label={t('audit.details.when')}>
                <time dateTime={entry.createdAt}>{exact}</time>
              </Meta>
              <Meta label={t('audit.details.ip')}>{entry.ip ? <span dir="ltr">{entry.ip}</span> : EMPTY}</Meta>
              <Meta label={t('audit.details.device')}>
                <span title={entry.userAgent ?? undefined}>{deviceOf(entry.userAgent) ?? EMPTY}</span>
              </Meta>
              <Meta label={t('audit.details.record')}>
                {entry.entityType ? (
                  <span dir="ltr">
                    {t(`audit.entities.${entry.entityType}`, {
                      defaultValue: entry.entityType,
                    })}
                    {entry.entityId && <code className="ms-1 text-xs text-ink-400">{entry.entityId.slice(0, 8)}</code>}
                  </span>
                ) : (
                  EMPTY
                )}
              </Meta>
            </dl>
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">{t('audit.details.changes')}</h3>
              {rows.length ? <DiffTable rows={rows} roleName={roleName} /> : <p className="text-sm text-ink-500">{t('audit.details.noChanges')}</p>}
            </div>
            <p className="text-xs text-ink-400">
              {t('audit.details.entryId')}: <code dir="ltr">{entry.id}</code>
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}
