import { Link, useSearchParams } from 'react-router';
import { motion } from 'motion/react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { ACCOUNT_TYPES, currencyDigits, fiscalYearOf, fiscalYearSpan, todayIn, type AgingSide } from '@ledgernest/shared';
import { AlertTriangle, Building2, CheckCircle2, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAccountsApi } from '../../accounts/useAccountsApi';
import { useIntlLocale } from '../../i18n';
import { formatDate } from '../../lib/format';
import { useMoney } from '../../lib/useMoney';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import { apiErrorMessage } from '../../platform/errors';
import { useOrganizationSettings } from '../../settings/useOrganizationSettings';
import Button from '../../ui/Button';
import { SelectField, TextField } from '../../ui/Field';
import { Card, EmptyState, ErrorState, PageHeader, Segmented, SkeletonRows } from '../../ui/Kit';
import Tabs from '../../ui/Tabs';
import { useToast } from '../../ui/toastContext';
import AgingPanel from '../AgingPanel';
import TaxSummaryPanel from '../TaxSummaryPanel';
import { useReportsApi } from '../useReportsApi';

type Tab = 'trial-balance' | 'ledger' | 'tax' | 'aging';

function saveBlob({ blob, filename }: { blob: Blob; filename: string }) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const th = 'px-4 py-2.5 font-semibold';

/** Reports over posted entries: the trial balance at a date, and an account's general ledger for a range. */
export default function Reports() {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  const session = useSession();
  const toast = useToast();
  const api = useReportsApi();
  const accountsApi = useAccountsApi();
  const settings = useOrganizationSettings().data;
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab | null) ?? 'trial-balance';
  const today = todayIn(settings?.timeZone ?? 'Asia/Kolkata');
  const year = fiscalYearSpan(fiscalYearOf(today, settings?.fiscalYearStartMonth ?? 4), settings?.fiscalYearStartMonth ?? 4);
  const asOf = params.get('asOf') ?? today;
  // Tax is filed monthly, so its default range is this month
  const from = params.get('from') ?? (tab === 'tax' ? `${today.slice(0, 8)}01` : year.startDate);
  const to = params.get('to') ?? today;
  const accountId = params.get('account') ?? '';
  const canExport = session.permissions.has('reports.export');
  const set = (patch: Record<string, string | null>) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        for (const [k, v] of Object.entries(patch)) if (v) n.set(k, v);
        else n.delete(k);
        return n;
      },
      { replace: true },
    );

  const key = ['reports', session.organizationId, session.role ?? session.customRoleName] as const;
  const tb = useQuery({ queryKey: [...key, 'tb', asOf], queryFn: () => api!.trialBalance(asOf), enabled: !!api && tab === 'trial-balance', placeholderData: keepPreviousData });
  const accounts = useQuery({ queryKey: ['accounts', session.organizationId, session.role ?? session.customRoleName, 'all'], queryFn: () => accountsApi!.list(true), enabled: !!accountsApi && tab === 'ledger' });
  const ledger = useQuery({ queryKey: [...key, 'ledger', accountId, from, to], queryFn: () => api!.ledger(accountId, from, to), enabled: !!api && tab === 'ledger' && !!accountId && from <= to, placeholderData: keepPreviousData });
  const side = (params.get('side') as AgingSide | null) ?? 'receivables';
  const aging = useQuery({ queryKey: [...key, 'aging', side, asOf], queryFn: () => api!.aging(side, asOf), enabled: !!api && tab === 'aging', placeholderData: keepPreviousData });
  const tax = useQuery({ queryKey: [...key, 'tax', from, to], queryFn: () => api!.taxSummary(from, to), enabled: !!api && tab === 'tax' && from <= to, placeholderData: keepPreviousData });
  const exporting = useMutation({
    mutationFn: () => (tab === 'trial-balance' ? api!.exportTrialBalance(asOf) : tab === 'aging' ? api!.exportAging(side, asOf) : tab === 'tax' ? api!.exportTaxSummary(from, to) : api!.exportLedger(accountId, from, to)),
    onSuccess: (f) => {
      saveBlob(f);
      toast(t('audit.exported', { file: f.filename }));
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
  const day = (d: string) => formatDate(`${d}T00:00:00Z`, locale);
  const fx = ledger.data?.foreign;
  const inForeign = (minor: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: currencyDigits(fx!.currency), maximumFractionDigits: currencyDigits(fx!.currency) }).format(minor / 10 ** currencyDigits(fx!.currency));
  const amount = (n: number) => (n ? money.plain(n) : '');

  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <PageHeader
          eyebrow={<span dir="auto">{session.organization}</span>}
          title={t('reports.title')}
          description={t('reports.description', { currency: money.currency })}
          actions={
            canExport ? (
              <Button variant="secondary" icon={<Download className="size-4" />} loading={exporting.isPending} disabled={tab === 'ledger' && !accountId} onClick={() => exporting.mutate()}>
                {t('reports.export')}
              </Button>
            ) : undefined
          }
        />
      </motion.div>
      <motion.div variants={fadeUp}>
        <Tabs<Tab>
          label={t('reports.title')}
          value={tab}
          onChange={(v) => set({ tab: v === 'trial-balance' ? null : v })}
          tabs={[
            { value: 'trial-balance', label: t('reports.trialBalance') },
            { value: 'ledger', label: t('reports.ledger') },
            { value: 'tax', label: t('reports.tax.title') },
            { value: 'aging', label: t('reports.aging.title') },
          ]}
        />
      </motion.div>

      {tab === 'trial-balance' ? (
        <motion.div variants={fadeUp} className="space-y-4" role="tabpanel">
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-48">
              <TextField label={t('reports.asOf')} type="date" value={asOf} onChange={(e) => e.target.value && set({ asOf: e.target.value })} />
            </div>
            {tb.data && (
              <p role="status" className={`inline-flex items-center gap-1.5 pb-2 text-sm font-medium ${tb.data.balanced ? 'text-income' : 'text-expense'}`}>
                {tb.data.balanced ? <CheckCircle2 className="size-4" aria-hidden /> : <AlertTriangle className="size-4" aria-hidden />}
                {tb.data.balanced ? t('reports.balanced') : t('reports.notBalanced')}
              </p>
            )}
          </div>
          <Card className="overflow-hidden">
            {tb.isPending ? (
              <SkeletonRows rows={8} />
            ) : tb.isError ? (
              <ErrorState onRetry={() => void tb.refetch()} />
            ) : (
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <caption className="sr-only">{t('reports.tbCaption', { date: day(asOf) })}</caption>
                  <thead className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-800">
                    <tr>
                      <th scope="col" className={`${th} text-start`}>
                        {t('journals.fields.account')}
                      </th>
                      <th scope="col" className={`${th} text-end`}>
                        {t('journals.fields.debit')}
                      </th>
                      <th scope="col" className={`${th} text-end`}>
                        {t('journals.fields.credit')}
                      </th>
                    </tr>
                  </thead>
                  {ACCOUNT_TYPES.map((type) => {
                    const rows = tb.data.rows.filter((r) => r.type === type);
                    if (!rows.length) return null;
                    return (
                      <tbody key={type} className="divide-y divide-ink-100 dark:divide-ink-800">
                        <tr className="bg-ink-50/70 dark:bg-ink-950/30">
                          <th scope="rowgroup" colSpan={3} className="px-4 py-1.5 text-start text-xs font-semibold uppercase tracking-wide text-ink-400">
                            {t(`accounts.typesPlural.${type}`)}
                          </th>
                        </tr>
                        {rows.map((r) => (
                          <tr key={r.accountId} className={r.balanceDebit || r.balanceCredit ? '' : 'text-ink-400'}>
                            <th scope="row" className="px-4 py-2 text-start font-normal">
                              <button type="button" className="text-start hover:underline" onClick={() => set({ tab: 'ledger', account: r.accountId })}>
                                <code className="me-2 text-xs text-ink-400" dir="ltr">
                                  {r.code}
                                </code>
                                <span dir="auto">{r.name}</span>
                              </button>
                            </th>
                            <td className="px-4 py-2 text-end font-mono tabular-nums" dir="ltr">
                              {amount(r.balanceDebit)}
                            </td>
                            <td className="px-4 py-2 text-end font-mono tabular-nums" dir="ltr">
                              {amount(r.balanceCredit)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    );
                  })}
                  <tfoot className="border-t-2 border-ink-200 font-semibold dark:border-ink-700">
                    <tr>
                      <th scope="row" className="px-4 py-2.5 text-start">
                        {t('journals.total')}
                      </th>
                      <td className="px-4 py-2.5 text-end font-mono tabular-nums" dir="ltr">
                        {money.format(tb.data.totals.balanceDebit)}
                      </td>
                      <td className="px-4 py-2.5 text-end font-mono tabular-nums" dir="ltr">
                        {money.format(tb.data.totals.balanceCredit)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
        </motion.div>
      ) : tab === 'aging' ? (
        <motion.div variants={fadeUp} className="space-y-4" role="tabpanel">
          <div className="flex flex-wrap items-end gap-4">
            <Segmented<AgingSide>
              label={t('reports.aging.side')}
              value={side}
              onChange={(v) => set({ side: v === 'receivables' ? null : v })}
              options={[
                { value: 'receivables', label: t('reports.aging.receivables') },
                { value: 'payables', label: t('reports.aging.payables') },
              ]}
            />
            <div className="w-48">
              <TextField label={t('reports.asOf')} type="date" value={asOf} onChange={(e) => e.target.value && set({ asOf: e.target.value })} />
            </div>
            <p className="flex-1 pb-2 text-sm text-ink-500">{t('reports.aging.hint')}</p>
          </div>
          <AgingPanel data={aging.data} isPending={aging.isPending} isError={aging.isError} onRetry={() => void aging.refetch()} />
        </motion.div>
      ) : tab === 'tax' ? (
        <motion.div variants={fadeUp} className="space-y-4" role="tabpanel">
          <div className="grid gap-4 sm:grid-cols-[11rem_11rem_minmax(0,1fr)]">
            <TextField label={t('reports.from')} type="date" value={from} onChange={(e) => e.target.value && set({ from: e.target.value })} />
            <TextField label={t('reports.to')} type="date" value={to} min={from} onChange={(e) => e.target.value && set({ to: e.target.value })} error={from > to ? t('audit.filters.badRange') : undefined} />
            <p className="self-end pb-2 text-sm text-ink-500">{t('reports.tax.hint')}</p>
          </div>
          <TaxSummaryPanel data={tax.data} isPending={tax.isPending} isError={tax.isError} onRetry={() => void tax.refetch()} />
        </motion.div>
      ) : (
        <motion.div variants={fadeUp} className="space-y-4" role="tabpanel">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_11rem_11rem]">
            <SelectField
              label={t('journals.fields.account')}
              value={accountId}
              onChange={(e) => set({ account: e.target.value || null })}
              options={[{ value: '', label: t('journals.pickAccount') }, ...(accounts.data ?? []).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))]}
            />
            <TextField label={t('reports.from')} type="date" value={from} onChange={(e) => e.target.value && set({ from: e.target.value })} />
            <TextField label={t('reports.to')} type="date" value={to} min={from} onChange={(e) => e.target.value && set({ to: e.target.value })} error={from > to ? t('audit.filters.badRange') : undefined} />
          </div>
          <Card className="overflow-hidden">
            {!accountId ? (
              <EmptyState icon={<Building2 className="size-5" />} title={t('reports.pickAccount')} />
            ) : ledger.isPending ? (
              <SkeletonRows rows={6} />
            ) : ledger.isError ? (
              <ErrorState onRetry={() => void ledger.refetch()} />
            ) : (
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <caption className="sr-only">{t('reports.ledgerCaption', { account: `${ledger.data.account.code} ${ledger.data.account.name}` })}</caption>
                  <thead className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-800">
                    <tr>
                      <th scope="col" className={`${th} text-start`}>
                        {t('journals.fields.date')}
                      </th>
                      <th scope="col" className={`${th} text-start`}>
                        {t('journals.columns.number')}
                      </th>
                      <th scope="col" className={`${th} text-start`}>
                        {t('journals.fields.memo')}
                      </th>
                      <th scope="col" className={`${th} text-end`}>
                        {t('journals.fields.debit')}
                      </th>
                      <th scope="col" className={`${th} text-end`}>
                        {t('journals.fields.credit')}
                      </th>
                      <th scope="col" className={`${th} text-end`}>
                        {t('reports.balance')}
                      </th>
                      {fx && (
                        <>
                          <th scope="col" className={`${th} text-end`}>
                            {t('reports.fxAmount', { code: fx.currency })}
                          </th>
                          <th scope="col" className={`${th} text-end`}>
                            {t('reports.fxBalance', { code: fx.currency })}
                          </th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                    <tr className="bg-ink-50/70 font-medium dark:bg-ink-950/30">
                      <td className="px-4 py-2" colSpan={5}>
                        {t('reports.opening', { date: day(from) })}
                      </td>
                      <td className="px-4 py-2 text-end font-mono tabular-nums" dir="ltr">
                        {money.plain(ledger.data.openingBalance)}
                      </td>
                      {fx && (
                        <>
                          <td />
                          <td className="px-4 py-2 text-end font-mono tabular-nums" dir="ltr">
                            {inForeign(fx.openingBalance)}
                          </td>
                        </>
                      )}
                    </tr>
                    {ledger.data.rows.length === 0 && (
                      <tr>
                        <td colSpan={fx ? 8 : 6} className="px-4 py-6 text-center text-ink-500">
                          {t('reports.noLines')}
                        </td>
                      </tr>
                    )}
                    {ledger.data.rows.map((r) => (
                      <tr key={r.lineId}>
                        <td className="whitespace-nowrap px-4 py-2 text-ink-600 dark:text-ink-300">{day(r.date)}</td>
                        <td className="px-4 py-2">
                          <Link to={`/journals/${r.entryId}`} className="font-mono text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300" dir="ltr">
                            {r.number}
                          </Link>
                        </td>
                        <td className="px-4 py-2" dir="auto">
                          {r.memo}
                          {r.description && <span className="block text-xs text-ink-400">{r.description}</span>}
                        </td>
                        <td className="px-4 py-2 text-end font-mono tabular-nums" dir="ltr">
                          {amount(r.debit)}
                        </td>
                        <td className="px-4 py-2 text-end font-mono tabular-nums" dir="ltr">
                          {amount(r.credit)}
                        </td>
                        <td className="px-4 py-2 text-end font-mono tabular-nums" dir="ltr">
                          {money.plain(r.balance)}
                        </td>
                        {fx && (
                          <>
                            <td className="px-4 py-2 text-end font-mono tabular-nums" dir="ltr">
                              {r.foreignDebit || r.foreignCredit ? `${inForeign((r.foreignDebit ?? 0) - (r.foreignCredit ?? 0))}${r.rate ? ` @ ${r.rate}` : ''}` : ''}
                            </td>
                            <td className="px-4 py-2 text-end font-mono tabular-nums" dir="ltr">
                              {inForeign(r.foreignBalance ?? 0)}
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-ink-200 font-semibold dark:border-ink-700">
                    <tr>
                      <th scope="row" colSpan={3} className="px-4 py-2.5 text-start">
                        {t('reports.closing', { date: day(to) })}
                      </th>
                      <td className="px-4 py-2.5 text-end font-mono tabular-nums" dir="ltr">
                        {money.plain(ledger.data.totals.debit)}
                      </td>
                      <td className="px-4 py-2.5 text-end font-mono tabular-nums" dir="ltr">
                        {money.plain(ledger.data.totals.credit)}
                      </td>
                      <td className="px-4 py-2.5 text-end font-mono tabular-nums" dir="ltr">
                        {money.format(ledger.data.closingBalance)}
                      </td>
                      {fx && (
                        <>
                          <td />
                          <td className="px-4 py-2.5 text-end font-mono tabular-nums" dir="ltr">
                            {fx.currency} {inForeign(fx.closingBalance)}
                          </td>
                        </>
                      )}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
        </motion.div>
      )}
    </motion.div>
  );
}
