import { CheckCircle2, AlertTriangle, FileBarChart } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../i18n';
import { formatDate } from '../lib/format';
import { Card, EmptyState, ErrorState, SkeletonRows } from '../ui/Kit';
import StatementTable, { type StatementBlock } from './StatementTable';
import type { BalanceSheet, ProfitAndLoss } from './types';

type Common = { isPending: boolean; isError: boolean; onRetry: () => void; onAccount: (accountId: string) => void };

function State({ isPending, isError, onRetry, empty }: Omit<Common, 'onAccount'> & { empty: boolean }) {
  const { t } = useTranslation();
  if (isPending)
    return (
      <Card>
        <SkeletonRows rows={8} />
      </Card>
    );
  if (isError)
    return (
      <Card>
        <ErrorState onRetry={onRetry} />
      </Card>
    );
  if (empty)
    return (
      <Card>
        <EmptyState icon={<FileBarChart className="size-5" />} title={t('reports.statements.empty')} body={t('reports.statements.emptyBody')} />
      </Card>
    );
  return null;
}

/** The profit and loss: sections with their accounts, gross and operating profit between, net profit at the foot. */
export function ProfitAndLossPanel({ data, ...rest }: Common & { data: ProfitAndLoss | undefined }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const state = <State {...rest} empty={!!data && data.sections.every((s) => !s.rows.length)} />;
  if (rest.isPending || rest.isError || !data || data.sections.every((s) => !s.rows.length)) return state;
  const day = (d: string) => formatDate(`${d}T00:00:00Z`, locale);
  const columns = data.columns.map((c) => (c.costCentre !== undefined ? (c.costCentre ? `${c.costCentre.code} · ${c.costCentre.name}` : t('costCentres.unassigned')) : data.compare === 'months' ? new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${c.from}T00:00:00Z`)) : `${day(c.from)} – ${day(c.to)}`));
  const section = (key: ProfitAndLoss['sections'][number]['section']): StatementBlock[] => {
    const s = data.sections.find((x) => x.section === key)!;
    return s.rows.length ? [{ kind: 'section', key, title: t(`reports.statements.pnl.${key}`), rows: s.rows, total: s.total, totalLabel: t('reports.statements.totalOf', { section: t(`reports.statements.pnl.${key}`) }) }] : [];
  };
  const blocks: StatementBlock[] = [
    ...section('revenue'),
    ...section('costOfSales'),
    { kind: 'line', key: 'gross', label: t('reports.statements.pnl.grossProfit'), amounts: data.grossProfit },
    ...section('operatingExpenses'),
    { kind: 'line', key: 'operating', label: t('reports.statements.pnl.operatingProfit'), amounts: data.operatingProfit },
    ...section('otherIncome'),
    ...section('otherExpenses'),
    { kind: 'line', key: 'net', label: t(data.netProfit[0]! < 0 ? 'reports.statements.pnl.netLoss' : 'reports.statements.pnl.netProfit'), amounts: data.netProfit, strong: true },
  ];
  return (
    <Card className="overflow-hidden">
      <StatementTable caption={t('reports.statements.pnlTitle')} columns={columns} blocks={blocks} onAccount={rest.onAccount} />
    </Card>
  );
}

/** The balance sheet: assets, then liabilities and equity (with profit not yet closed), and whether they agree. */
export function BalanceSheetPanel({ data, ...rest }: Common & { data: BalanceSheet | undefined }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const empty = !!data && data.sections.every((s) => !s.rows.length) && data.profitThisYear.every((v) => !v);
  if (rest.isPending || rest.isError || !data || empty) return <State {...rest} empty={empty} />;
  const columns = data.columns.map((d) => formatDate(`${d}T00:00:00Z`, locale));
  const section = (key: BalanceSheet['sections'][number]['section']): StatementBlock[] => {
    const s = data.sections.find((x) => x.section === key)!;
    return s.rows.length ? [{ kind: 'section', key, title: t(`reports.statements.bs.${key}`), rows: s.rows, total: s.total, totalLabel: t('reports.statements.totalOf', { section: t(`reports.statements.bs.${key}`) }) }] : [];
  };
  const eq = data.sections.find((s) => s.section === 'equity')!;
  const blocks: StatementBlock[] = [
    ...section('currentAssets'),
    ...section('nonCurrentAssets'),
    { kind: 'line', key: 'assets', label: t('reports.statements.bs.totalAssets'), amounts: data.totalAssets, strong: true },
    ...section('currentLiabilities'),
    ...section('nonCurrentLiabilities'),
    { kind: 'line', key: 'liabilities', label: t('reports.statements.bs.totalLiabilities'), amounts: data.totalLiabilities },
    {
      kind: 'section',
      key: 'equity',
      title: t('reports.statements.bs.equity'),
      rows: [
        ...eq.rows,
        ...(data.profitThisYear.some((v) => v) ? [{ accountId: 'profit-this-year', code: '', name: t('reports.statements.bs.profitThisYear', { date: formatDate(`${data.yearStart[0]}T00:00:00Z`, locale) }), depth: 0, parentId: null, hasChildren: false, amounts: data.profitThisYear }] : []),
        ...(data.profitEarlierYears.some((v) => v) ? [{ accountId: 'profit-earlier', code: '', name: t('reports.statements.bs.profitEarlier'), depth: 0, parentId: null, hasChildren: false, amounts: data.profitEarlierYears }] : []),
      ],
      total: data.totalEquity,
      totalLabel: t('reports.statements.totalOf', { section: t('reports.statements.bs.equity') }),
    },
    { kind: 'line', key: 'le', label: t('reports.statements.bs.totalLiabilitiesEquity'), amounts: data.columns.map((_c, k) => data.totalLiabilities[k]! + data.totalEquity[k]!), strong: true },
  ];
  return (
    <>
      <p className={`flex items-center gap-2 text-sm ${data.balanced.every(Boolean) ? 'text-income' : 'text-expense'}`} role="status">
        {data.balanced.every(Boolean) ? <CheckCircle2 className="size-4" aria-hidden /> : <AlertTriangle className="size-4" aria-hidden />}
        {t(data.balanced.every(Boolean) ? 'reports.statements.bs.balanced' : 'reports.statements.bs.notBalanced')}
      </p>
      <Card className="overflow-hidden">
        <StatementTable caption={t('reports.statements.bsTitle')} columns={columns} blocks={blocks} onAccount={(id) => !id.startsWith('profit-') && rest.onAccount(id)} />
      </Card>
    </>
  );
}
