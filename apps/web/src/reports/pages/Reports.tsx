import { Link, useSearchParams } from 'react-router';
import { motion } from 'motion/react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { ACCOUNT_TYPES, currencyDigits, parseCsv, fiscalYearOf, fiscalYearSpan, PNL_COMPARE, todayIn, type AgingSide, type PnlCompare, type SalesReportBy, type SalesReportSide } from '@ledgernest/shared';
import { AlertTriangle, Building2, CheckCircle2, Download, FileSpreadsheet, Printer } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useAccountsApi } from '../../accounts/useAccountsApi';
import { useCostCentres } from '../../cost-centres/useCostCentresApi';
import { useIntlLocale } from '../../i18n';
import { formatDate } from '../../lib/format';
import { useMoney } from '../../lib/useMoney';
import { csvToRows, xlsx } from '../../lib/xlsx';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import { apiErrorMessage } from '../../platform/errors';
import { useOrganizationSettings } from '../../settings/useOrganizationSettings';
import Button from '../../ui/Button';
import { SelectField, TextField } from '../../ui/Field';
import Gstr2bPanel from '../Gstr2bPanel';
import GstHealthPanel from '../GstHealthPanel';
import CashForecastPanel from '../CashForecastPanel';
import TdsPanel from '../TdsPanel';
import MsmePanel from '../MsmePanel';
import EinvoiceBatchButton from '../EinvoiceBatchButton';
import { Card, EmptyState, ErrorState, PageHeader, Segmented, SkeletonRows } from '../../ui/Kit';
import Tabs from '../../ui/Tabs';
import { useToast } from '../../ui/toastContext';
import AgingPanel from '../AgingPanel';
import CashFlowPanel from '../CashFlowPanel';
import ContactStatementPanel from '../ContactStatementPanel';
import SalesReportPanel from '../SalesReportPanel';
import { Gstr1Panel, Gstr3bPanel } from '../GstReturnsPanel';
import { BalanceSheetPanel, ProfitAndLossPanel } from '../StatementsPanels';
import TaxSummaryPanel from '../TaxSummaryPanel';
import ScheduledReportsPanel from '../../scheduled-reports/ScheduledReportsPanel';
import { useReportsApi } from '../useReportsApi';

type Tab = 'trial-balance' | 'pnl' | 'balance-sheet' | 'cash-flow' | 'forecast' | 'gst' | 'tds' | 'msme' | 'ledger' | 'tax' | 'aging' | 'statement' | 'sales' | 'scheduled';

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
  const from = params.get('from') ?? (tab === 'tax' || tab === 'gst' || tab === 'tds' ? `${today.slice(0, 8)}01` : year.startDate);
  const to = params.get('to') ?? today;
  const accountId = params.get('account') ?? '';
  const contactId = params.get('contact') ?? '';
  const salesSide = (params.get('sside') as SalesReportSide | null) ?? 'sales';
  const salesBy = (params.get('by') as SalesReportBy | null) ?? 'contact';
  const canExport = session.permissions.has('reports.export');
  const reportTitle = { 'trial-balance': t('reports.trialBalance'), pnl: t('reports.statements.pnlTitle'), 'balance-sheet': t('reports.statements.bsTitle'), 'cash-flow': t('reports.cashFlow.title'), forecast: t('reports.forecast.title'), gst: t('reports.gst.title'), tds: t('reports.tds.title'), msme: t('reports.msme.title'), ledger: t('reports.ledger'), tax: t('reports.tax.title'), aging: t('reports.aging.title'), statement: t('reports.statement.title'), sales: t('reports.sales.title'), scheduled: t('scheduledReports.tab') }[tab];
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
  const centres = useCostCentres(true).data ?? [];
  const compare = (params.get('compare') as PnlCompare | null) ?? 'none';
  const costCentreId = params.get('costCentre') ?? undefined;
  const compareAsOf = params.get('compareAsOf');
  const pnl = useQuery({ queryKey: [...key, 'pnl', from, to, compare, costCentreId], queryFn: () => api!.profitAndLoss(from, to, compare, costCentreId), enabled: !!api && tab === 'pnl' && from <= to, placeholderData: keepPreviousData });
  const bs = useQuery({ queryKey: [...key, 'bs', asOf, compareAsOf], queryFn: () => api!.balanceSheet(asOf, compareAsOf), enabled: !!api && tab === 'balance-sheet', placeholderData: keepPreviousData });
  const method = (params.get('method') as 'indirect' | 'direct' | null) ?? 'indirect';
  const tdsSide = (params.get('side') as 'payable' | 'receivable' | null) ?? 'payable';
  const msmeReport = useQuery({ queryKey: [...key, 'msme', asOf], queryFn: () => api!.msme(asOf), enabled: !!api && tab === 'msme', placeholderData: keepPreviousData });
  const tdsReport = useQuery({ queryKey: [...key, 'tds', from, to, tdsSide], queryFn: () => api!.tds(from, to, tdsSide), enabled: !!api && tab === 'tds' && from <= to, placeholderData: keepPreviousData });
  const forecast = useQuery({ queryKey: [...key, 'forecast'], queryFn: () => api!.cashForecast(13), enabled: !!api && tab === 'forecast' });
  const cf = useQuery({ queryKey: [...key, 'cash-flow', from, to], queryFn: () => api!.cashFlow(from, to), enabled: !!api && tab === 'cash-flow' && from <= to, placeholderData: keepPreviousData });
  const gstReturn = (params.get('return') as 'gstr-3b' | 'gstr-1' | 'gstr-2b' | 'health' | null) ?? 'gstr-3b';
  const india = settings?.country === 'IN';
  const gstHealth = useQuery({ queryKey: [...key, 'gst-health'], queryFn: () => api!.gstHealth(), enabled: !!api && tab === 'gst' && gstReturn === 'health' });
  const g3b = useQuery({ queryKey: [...key, 'gstr3b', from, to], queryFn: () => api!.gstr3b(from, to), enabled: !!api && tab === 'gst' && gstReturn === 'gstr-3b' && from <= to, placeholderData: keepPreviousData });
  const g1 = useQuery({ queryKey: [...key, 'gstr1', from, to], queryFn: () => api!.gstr1(from, to), enabled: !!api && tab === 'gst' && gstReturn === 'gstr-1' && from <= to, placeholderData: keepPreviousData });
  const jsonExport = useMutation({
    mutationFn: () => api!.exportGstr1(from, to, 'json'),
    onSuccess: (f) => {
      saveBlob(f);
      toast(t('audit.exported', { file: f.filename }));
    },
    onError: (e) => toast(apiErrorMessage(e, t), 'error'),
  });
  const side = (params.get('side') as AgingSide | null) ?? 'receivables';
  const aging = useQuery({ queryKey: [...key, 'aging', side, asOf], queryFn: () => api!.aging(side, asOf), enabled: !!api && tab === 'aging', placeholderData: keepPreviousData });
  const tax = useQuery({ queryKey: [...key, 'tax', from, to], queryFn: () => api!.taxSummary(from, to), enabled: !!api && tab === 'tax' && from <= to, placeholderData: keepPreviousData });
  const exporting = useMutation({
    mutationFn: async (format: 'csv' | 'xlsx') => {
      const csvFile = await (tab === 'trial-balance' ? api!.exportTrialBalance(asOf) : tab === 'pnl' ? api!.exportProfitAndLoss(from, to, compare, costCentreId) : tab === 'balance-sheet' ? api!.exportBalanceSheet(asOf, compareAsOf) : tab === 'cash-flow' ? api!.exportCashFlow(from, to) : tab === 'gst' ? api!.exportGstr1(from, to, 'csv') : tab === 'aging' ? api!.exportAging(side, asOf) : tab === 'statement' ? api!.exportStatement(contactId, side, from, to, 'csv') : tab === 'sales' ? api!.exportSales(salesSide, salesBy, from, to) : tab === 'tax' ? api!.exportTaxSummary(from, to) : api!.exportLedger(accountId, from, to));
      if (format === 'csv') return csvFile;
      // Excel from the same figures, numbers as numbers
      return { filename: csvFile.filename.replace(/\.(csv|json)$/, '.xlsx'), blob: xlsx([{ name: reportTitle, rows: csvToRows(await csvFile.blob.text(), parseCsv) }]) };
    },
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
            <div className={clsx('flex flex-wrap gap-2 print:hidden', (tab === 'scheduled' || tab === 'forecast' || tab === 'tds' || tab === 'msme' || (tab === 'gst' && (gstReturn === 'gstr-2b' || gstReturn === 'health'))) && 'hidden')}>
              <Button variant="ghost" icon={<Printer className="size-4" />} onClick={() => window.print()} disabled={(tab === 'ledger' && !accountId) || (tab === 'statement' && !contactId)}>
                {t('reports.print')}
              </Button>
              {canExport && (
                <>
                  <Button variant="secondary" icon={<Download className="size-4" />} loading={exporting.isPending && exporting.variables === 'csv'} disabled={(tab === 'ledger' && !accountId) || (tab === 'statement' && !contactId)} onClick={() => exporting.mutate('csv')}>
                    {t('reports.export')}
                  </Button>
                  <Button variant="secondary" icon={<FileSpreadsheet className="size-4" />} loading={exporting.isPending && exporting.variables === 'xlsx'} disabled={(tab === 'ledger' && !accountId) || (tab === 'statement' && !contactId)} onClick={() => exporting.mutate('xlsx')}>
                    {t('reports.excel')}
                  </Button>
                </>
              )}
            </div>
          }
        />
      </motion.div>
      {/* On paper: who it's for and what it is, in place of the app's own header and the tabs */}
      <div className="hidden print:block">
        <p className="text-lg font-semibold">{settings?.legalName ?? settings?.name ?? session.organization}</p>
        {settings?.taxId && <p className="text-sm">{settings.taxId}</p>}
        <p className="mt-2 text-base font-semibold">{reportTitle}</p>
        <p className="text-sm">{['trial-balance', 'balance-sheet', 'aging', 'forecast'].includes(tab) ? t('reports.printAsOf', { date: day(asOf) }) : t('reports.printRange', { from: day(from), to: day(to) })}</p>
      </div>
      <motion.div variants={fadeUp} className="print:hidden">
        <Tabs<Tab>
          label={t('reports.title')}
          value={tab}
          onChange={(v) => set({ tab: v === 'trial-balance' ? null : v })}
          tabs={[
            { value: 'trial-balance', label: t('reports.trialBalance') },
            { value: 'pnl', label: t('reports.statements.pnlTitle') },
            { value: 'balance-sheet', label: t('reports.statements.bsTitle') },
            { value: 'cash-flow', label: t('reports.cashFlow.title') },
            { value: 'forecast', label: t('reports.forecast.title') },
            ...(india ? [{ value: 'gst' as const, label: t('reports.gst.title') }, { value: 'tds' as const, label: t('reports.tds.title') }, { value: 'msme' as const, label: t('reports.msme.title') }] : []),
            { value: 'ledger', label: t('reports.ledger') },
            { value: 'tax', label: t('reports.tax.title') },
            { value: 'aging', label: t('reports.aging.title') },
            { value: 'statement', label: t('reports.statement.title') },
            { value: 'sales', label: t('reports.sales.title') },
            { value: 'scheduled', label: t('scheduledReports.tab') },
          ]}
        />
      </motion.div>

      {tab === 'trial-balance' ? (
        <motion.div variants={fadeUp} className="space-y-4" role="tabpanel">
          <div className="flex flex-wrap items-end gap-4 print:hidden">
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
      ) : tab === 'pnl' ? (
        <motion.div variants={fadeUp} className="space-y-4" role="tabpanel">
          <div className="flex flex-wrap items-end gap-4 print:hidden">
            <div className="w-44">
              <TextField label={t('reports.from')} type="date" value={from} onChange={(e) => e.target.value && set({ from: e.target.value })} />
            </div>
            <div className="w-44">
              <TextField label={t('reports.to')} type="date" value={to} min={from} onChange={(e) => e.target.value && set({ to: e.target.value })} error={from > to ? t('audit.filters.badRange') : undefined} />
            </div>
            <Segmented<PnlCompare>
              label={t('reports.statements.compare')}
              value={compare}
              onChange={(v) => set({ compare: v === 'none' ? null : v, ...(v === 'costCentres' ? { costCentre: null } : {}) })}
              options={PNL_COMPARE.filter((c) => c !== 'costCentres' || centres.length).map((c) => ({ value: c, label: t(`reports.statements.compares.${c}`) }))}
            />
            {centres.length > 0 && compare !== 'costCentres' && (
              <div className="w-56">
                <SelectField
                  label={t('costCentres.filter')}
                  value={costCentreId ?? ''}
                  onChange={(e) => set({ costCentre: e.target.value || null })}
                  options={[{ value: '', label: t('costCentres.all') }, ...centres.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` })), { value: 'none', label: t('costCentres.unassigned') }]}
                />
              </div>
            )}
          </div>
          {pnl.data?.costCentre && <p className="hidden text-sm print:block">{pnl.data.costCentre === 'none' ? t('costCentres.unassigned') : `${pnl.data.costCentre.code} · ${pnl.data.costCentre.name}`}</p>}
          <ProfitAndLossPanel data={pnl.data} isPending={pnl.isPending} isError={pnl.isError} onRetry={() => void pnl.refetch()} onAccount={(id) => set({ tab: 'ledger', account: id })} />
        </motion.div>
      ) : tab === 'balance-sheet' ? (
        <motion.div variants={fadeUp} className="space-y-4" role="tabpanel">
          <div className="flex flex-wrap items-end gap-4 print:hidden">
            <div className="w-44">
              <TextField label={t('reports.asOf')} type="date" value={asOf} onChange={(e) => e.target.value && set({ asOf: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" checked={!!compareAsOf} onChange={(e) => set({ compareAsOf: e.target.checked ? `${Number(asOf.slice(0, 4)) - 1}${asOf.slice(4)}`.replace('-02-29', '-02-28') : null })} className="size-4 rounded accent-brand-600" />
              {t('reports.statements.compareWith')}
            </label>
            {compareAsOf && (
              <div className="w-44">
                <TextField label={t('reports.statements.compareDate')} type="date" value={compareAsOf} onChange={(e) => e.target.value && set({ compareAsOf: e.target.value })} />
              </div>
            )}
          </div>
          <BalanceSheetPanel data={bs.data} isPending={bs.isPending} isError={bs.isError} onRetry={() => void bs.refetch()} onAccount={(id) => set({ tab: 'ledger', account: id, from: year.startDate, to: asOf })} />
        </motion.div>
      ) : tab === 'cash-flow' ? (
        <motion.div variants={fadeUp} className="space-y-4" role="tabpanel">
          <div className="flex flex-wrap items-end gap-4 print:hidden">
            <div className="w-44">
              <TextField label={t('reports.from')} type="date" value={from} onChange={(e) => e.target.value && set({ from: e.target.value })} />
            </div>
            <div className="w-44">
              <TextField label={t('reports.to')} type="date" value={to} min={from} onChange={(e) => e.target.value && set({ to: e.target.value })} error={from > to ? t('audit.filters.badRange') : undefined} />
            </div>
            <Segmented<'indirect' | 'direct'>
              label={t('reports.cashFlow.method')}
              value={method}
              onChange={(v) => set({ method: v === 'indirect' ? null : v })}
              options={[
                { value: 'indirect', label: t('reports.cashFlow.indirect') },
                { value: 'direct', label: t('reports.cashFlow.byPurpose') },
              ]}
            />
          </div>
          <CashFlowPanel data={cf.data} method={method} isPending={cf.isPending} isError={cf.isError} onRetry={() => void cf.refetch()} onAccount={(id) => set({ tab: 'ledger', account: id })} />
        </motion.div>
      ) : tab === 'tds' ? (
        <motion.div variants={fadeUp} className="space-y-4" role="tabpanel">
          <div className="flex flex-wrap items-end gap-4 print:hidden">
            <div className="w-44">
              <TextField label={t('reports.from')} type="date" value={from} onChange={(e) => e.target.value && set({ from: e.target.value })} />
            </div>
            <div className="w-44">
              <TextField label={t('reports.to')} type="date" value={to} min={from} onChange={(e) => e.target.value && set({ to: e.target.value })} error={from > to ? t('audit.filters.badRange') : undefined} />
            </div>
            <Segmented<'payable' | 'receivable'>
              label={t('reports.tds.side')}
              value={tdsSide}
              onChange={(v) => set({ side: v === 'payable' ? null : v })}
              options={[
                { value: 'payable', label: t('reports.tds.sides.payable') },
                { value: 'receivable', label: t('reports.tds.sides.receivable') },
              ]}
            />
            <p className="flex-1 pb-2 text-sm text-ink-500">{t(tdsSide === 'payable' ? 'reports.tds.hint' : 'reports.tds.hintReceivable')}</p>
          </div>
          <TdsPanel side={tdsSide} data={tdsReport.data} isPending={tdsReport.isPending} isError={tdsReport.isError} onRetry={() => void tdsReport.refetch()} />
        </motion.div>
      ) : tab === 'msme' ? (
        <motion.div variants={fadeUp} className="space-y-4" role="tabpanel">
          <div className="flex flex-wrap items-end gap-4 print:hidden">
            <div className="w-44">
              <TextField label={t('reports.asOf')} type="date" value={asOf} onChange={(e) => e.target.value && set({ asOf: e.target.value })} />
            </div>
            <p className="flex-1 pb-2 text-sm text-ink-500">{t('reports.msme.hint')}</p>
          </div>
          <MsmePanel data={msmeReport.data} isPending={msmeReport.isPending} isError={msmeReport.isError} onRetry={() => void msmeReport.refetch()} />
        </motion.div>
      ) : tab === 'forecast' ? (
        <motion.div variants={fadeUp} className="space-y-4" role="tabpanel">
          <p className="text-sm text-ink-500 print:hidden">{t('reports.forecast.description')}</p>
          <CashForecastPanel data={forecast.data} isPending={forecast.isPending} isError={forecast.isError} onRetry={() => void forecast.refetch()} />
        </motion.div>
      ) : tab === 'gst' ? (
        <motion.div variants={fadeUp} className="space-y-4" role="tabpanel">
          <div className="flex flex-wrap items-end gap-4 print:hidden">
            <Segmented<'gstr-3b' | 'gstr-1' | 'gstr-2b' | 'health'>
              label={t('reports.gst.return')}
              value={gstReturn}
              onChange={(v) => set({ return: v === 'gstr-3b' ? null : v })}
              options={[
                { value: 'gstr-3b', label: 'GSTR-3B' },
                { value: 'gstr-1', label: 'GSTR-1' },
                { value: 'gstr-2b', label: t('reports.gstr2b.tab') },
                { value: 'health', label: t('reports.gstHealth.tab') },
              ]}
            />
            <div className="w-44">
              <TextField label={t('reports.from')} type="date" value={from} onChange={(e) => e.target.value && set({ from: e.target.value })} />
            </div>
            <div className="w-44">
              <TextField label={t('reports.to')} type="date" value={to} min={from} onChange={(e) => e.target.value && set({ to: e.target.value })} error={from > to ? t('audit.filters.badRange') : undefined} />
            </div>
            <p className="flex-1 pb-2 text-sm text-ink-500">{t('reports.gst.hint')}</p>
            {gstReturn === 'gstr-1' && session.permissions.has('invoices.view') && <EinvoiceBatchButton from={from} to={to} />}
          </div>
          {gstReturn === 'health' ? <GstHealthPanel data={gstHealth.data} isPending={gstHealth.isPending} isError={gstHealth.isError} onRetry={() => void gstHealth.refetch()} /> : gstReturn === 'gstr-2b' ? <Gstr2bPanel api={api!} from={from} to={to} /> : gstReturn === 'gstr-3b' ? <Gstr3bPanel data={g3b.data} isPending={g3b.isPending} isError={g3b.isError} onRetry={() => void g3b.refetch()} /> : <Gstr1Panel data={g1.data} isPending={g1.isPending} isError={g1.isError} onRetry={() => void g1.refetch()} onJson={canExport ? () => jsonExport.mutate() : undefined} />}
        </motion.div>
      ) : tab === 'scheduled' ? (
        <motion.div variants={fadeUp} role="tabpanel">
          <ScheduledReportsPanel />
        </motion.div>
      ) : tab === 'sales' ? (
        <motion.div variants={fadeUp} role="tabpanel">
          <SalesReportPanel api={api} side={salesSide} by={salesBy} from={from} to={to} set={set} />
        </motion.div>
      ) : tab === 'statement' ? (
        <motion.div variants={fadeUp} role="tabpanel">
          <ContactStatementPanel api={api} side={side} contactId={contactId} from={from} to={to} set={set} onSave={saveBlob} />
        </motion.div>
      ) : tab === 'aging' ? (
        <motion.div variants={fadeUp} className="space-y-4" role="tabpanel">
          <div className="flex flex-wrap items-end gap-4 print:hidden">
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
          <div className="grid gap-4 print:hidden sm:grid-cols-[11rem_11rem_minmax(0,1fr)]">
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
