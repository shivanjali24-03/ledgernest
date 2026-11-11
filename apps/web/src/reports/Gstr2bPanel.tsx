import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, FileJson, FileQuestion, HelpCircle, ShieldAlert, Upload } from 'lucide-react';
import clsx from 'clsx';
import { GSTR2B_MAX_BYTES, gstr2bRows, type Gstr2bRow, type Gstr2bStatus } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../auth/client';
import { useIntlLocale } from '../i18n';
import { formatDate } from '../lib/format';
import { csvBlob } from '../lib/listCsv';
import { saveBlob } from '../lib/saveBlob';
import { useMoney } from '../lib/useMoney';
import Button from '../ui/Button';
import { Card, EmptyState } from '../ui/Kit';
import type { Gstr2bReport, ReportsApi } from './types';

const SHOWN: Gstr2bStatus[] = ['mismatch', 'missing_in_2b', 'missing_in_books', 'probable', 'matched', 'note'];
const ICON = { mismatch: AlertTriangle, missing_in_2b: ShieldAlert, missing_in_books: FileQuestion, probable: HelpCircle, matched: CheckCircle2, note: FileJson } as const;
const TONE: Record<Gstr2bStatus, string> = {
  mismatch: 'text-expense',
  missing_in_2b: 'text-expense',
  missing_in_books: 'text-amber-600 dark:text-amber-400',
  probable: 'text-amber-600 dark:text-amber-400',
  matched: 'text-income',
  note: 'text-ink-500',
};
const taxOf = (h: { igst: number; cgst: number; sgst: number; cess: number }) => h.igst + h.cgst + h.sgst + h.cess;

/**
 * GSTR-2B against the books: upload the JSON from the GST portal and see, worst first, invoices whose amounts differ,
 * bills the supplier hasn't filed (input credit at risk), filed invoices not yet in the books, probable matches with
 * the number typed differently, and what matched. Nothing is stored; the file is read and the result shown.
 */
export default function Gstr2bPanel({ api, from, to, registrationId }: { api: ReportsApi; from: string; to: string; registrationId?: string }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [tooBig, setTooBig] = useState(false);
  const [filter, setFilter] = useState<Gstr2bStatus | null>(null);
  const run = useMutation({ mutationFn: (content: string) => api.gstr2b(content, from, to, registrationId), onSuccess: () => setFilter(null) });
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setFileName(f.name);
    setTooBig(f.size > GSTR2B_MAX_BYTES);
    if (f.size > GSTR2B_MAX_BYTES) return;
    run.mutate(await f.text());
  };
  const day = (d: string) => (d ? formatDate(`${d}T00:00:00Z`, locale) : '–');
  const label = (s: Gstr2bStatus) => t(`reports.gstr2b.status.${s}`);
  const r: Gstr2bReport | undefined = run.data;
  const rows = r ? r.rows.filter((x) => !filter || x.status === filter) : [];
  const reason = run.error instanceof ApiError ? (run.error.details?.reason as string | undefined) : undefined;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-4 p-4">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{t('reports.gstr2b.uploadTitle')}</p>
          <p className="text-sm text-ink-500">{t('reports.gstr2b.uploadHint', { from: day(from), to: day(to) })}</p>
          {fileName && <p className="mt-1 truncate font-mono text-xs text-ink-500">{fileName}</p>}
        </div>
        <input ref={input} type="file" accept=".json,application/json" className="sr-only" aria-label={t('reports.gstr2b.file')} onChange={(e) => void pick(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
        <Button icon={<Upload className="size-4" />} loading={run.isPending} disabled={from > to} onClick={() => input.current?.click()}>
          {r ? t('reports.gstr2b.another') : t('reports.gstr2b.choose')}
        </Button>
      </Card>

      {(tooBig || run.isError) && (
        <p role="alert" className="rounded-xl bg-expense/10 px-4 py-3 text-sm text-expense">
          {tooBig ? t('reports.gstr2b.errors.too_big') : reason === 'not_json' || reason === 'not_gstr2b' ? t(`reports.gstr2b.errors.${reason}`) : t('reports.gstr2b.errors.failed')}
        </p>
      )}

      {!r && !run.isPending && (
        <Card>
          <EmptyState icon={<FileJson className="size-5" />} title={t('reports.gstr2b.emptyTitle')} body={t('reports.gstr2b.emptyBody')} />
        </Card>
      )}

      {r && (
        <>
          {r.otherGstin && (
            <p role="alert" className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {t('reports.gstr2b.otherGstin', { gstin: r.gstin })}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" role="group" aria-label={t('reports.gstr2b.summary')}>
            {SHOWN.filter((s) => s !== 'note').map((s) => {
              const Icon = ICON[s];
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={filter === s}
                  onClick={() => setFilter(filter === s ? null : s)}
                  className={clsx('rounded-2xl border bg-white p-4 text-start transition-colors hover:border-brand-400 dark:bg-ink-900', filter === s ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-ink-200 dark:border-ink-800')}
                >
                  <span className={clsx('flex items-center gap-1.5 text-sm font-medium', TONE[s])}>
                    <Icon className="size-4" aria-hidden /> {label(s)}
                  </span>
                  <span className="mt-1 block text-2xl font-semibold tabular-nums">{r.summary[s].count}</span>
                  <span className="block text-xs text-ink-500" dir="ltr">
                    {t('reports.gstr2b.taxOf', { amount: money.format(r.summary[s].tax) })}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-sm text-ink-500">
            {r.summary.missing_in_2b.count > 0 ? t('reports.gstr2b.atRisk', { amount: money.format(r.summary.missing_in_2b.tax), count: r.summary.missing_in_2b.count }) : t('reports.gstr2b.noneAtRisk')}
            {r.skipped > 0 && ` ${t('reports.gstr2b.skipped', { count: r.skipped })}`}
          </p>
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-4 py-3 dark:border-ink-800">
              <h3 className="font-semibold">{filter ? label(filter) : t('reports.gstr2b.all', { count: r.rows.length })}</h3>
              <Button
                variant="secondary"
                icon={<Download className="size-4" />}
                onClick={() => saveBlob({ blob: csvBlob(gstr2bRows(r, Object.fromEntries(SHOWN.map((s) => [s, label(s)])) as Record<Gstr2bStatus, string>)), filename: `gstr-2b-${r.period ?? `${from}-${to}`}.csv` })}
              >
                {t('reports.gstr2b.csv')}
              </Button>
            </div>
            {rows.length === 0 ? (
              <p className="px-4 py-6 text-sm text-ink-500">{t('reports.gstr2b.nothing')}</p>
            ) : (
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <caption className="sr-only">{t('reports.gstr2b.title')}</caption>
                  <thead className="text-xs uppercase tracking-wide text-ink-400">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-start font-semibold">
                        {t('reports.gstr2b.cols.status')}
                      </th>
                      <th scope="col" className="px-3 py-2 text-start font-semibold">
                        {t('reports.gstr2b.cols.supplier')}
                      </th>
                      <th scope="col" className="px-3 py-2 text-start font-semibold">
                        {t('reports.gstr2b.cols.inPortal')}
                      </th>
                      <th scope="col" className="px-3 py-2 text-start font-semibold">
                        {t('reports.gstr2b.cols.inBooks')}
                      </th>
                      <th scope="col" className="px-3 py-2 text-end font-semibold">
                        {t('reports.gstr2b.cols.portalTax')}
                      </th>
                      <th scope="col" className="px-3 py-2 text-end font-semibold">
                        {t('reports.gstr2b.cols.booksTax')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                    {rows.map((x, n) => (
                      <Row key={n} row={x} label={label(x.status)} day={day} plain={money.plain} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Row({ row: x, label, day, plain }: { row: Gstr2bRow; label: string; day: (d: string) => string; plain: (minor: number) => string }) {
  const { t } = useTranslation();
  const Icon = ICON[x.status];
  return (
    <tr className="align-top">
      <td className="px-3 py-2">
        <span className={clsx('inline-flex items-center gap-1 font-medium', TONE[x.status])}>
          <Icon className="size-3.5" aria-hidden /> {label}
        </span>
        {x.problems.length > 0 && <span className="block text-xs text-ink-500">{x.problems.map((p) => t(`reports.gstr2b.problems.${p}`)).join(' · ')}</span>}
      </td>
      <td className="px-3 py-2">
        <span className="block" dir="auto">
          {x.supplierName ?? '–'}
        </span>
        <span className="font-mono text-xs text-ink-500">{x.supplierGstin}</span>
      </td>
      <td className="px-3 py-2">
        {x.doc ? (
          <>
            <span className="font-mono" dir="ltr">
              {x.doc.number}
            </span>
            <span className="block text-xs text-ink-500">
              {day(x.doc.date)}
              {x.doc.kind !== 'invoice' && ` · ${t(`reports.gstr2b.kinds.${x.doc.kind}`)}`}
              {!x.doc.itcAvailable && ` · ${t('reports.gstr2b.noItc')}`}
            </span>
          </>
        ) : (
          <span className="text-ink-400">–</span>
        )}
      </td>
      <td className="px-3 py-2">
        {x.bill ? (
          <>
            <Link to={x.bill.kind === 'debit_note' ? '/debit-notes' : `/bills/${x.bill.id}`} className="font-mono hover:underline" dir="ltr">
              {x.bill.vendorReference ?? x.bill.number ?? t('reports.gstr2b.bill')}
            </Link>
            <span className="block text-xs text-ink-500">
              {day(x.bill.date)}
              {x.bill.number && ` · ${x.bill.number}`}
            </span>
          </>
        ) : (
          <span className="text-ink-400">–</span>
        )}
      </td>
      <td className="px-3 py-2 text-end font-mono tabular-nums" dir="ltr">
        {x.doc ? plain(taxOf(x.doc.heads)) : '–'}
      </td>
      <td className="px-3 py-2 text-end font-mono tabular-nums" dir="ltr">
        {x.bill ? plain(taxOf(x.bill.heads)) : '–'}
        {x.diff && x.diff.tax !== 0 && <span className="block text-xs text-expense">{(x.diff.tax > 0 ? '+' : '') + plain(x.diff.tax)}</span>}
      </td>
    </tr>
  );
}
