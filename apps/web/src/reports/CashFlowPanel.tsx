import { Waves } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useMoney } from '../lib/useMoney';
import { Card, EmptyState, ErrorState, SkeletonRows } from '../ui/Kit';
import type { CashFlow } from './types';

type Line = { key: string; label: string; amount: number; kind?: 'total' | 'grand' | 'sub'; accountId?: string };

/** The cash flow statement, by the indirect method (from profit) or the direct (by what the cash was for). */
export default function CashFlowPanel({ data, method, isPending, isError, onRetry, onAccount }: { data: CashFlow | undefined; method: 'indirect' | 'direct'; isPending: boolean; isError: boolean; onRetry: () => void; onAccount: (accountId: string) => void }) {
  const { t } = useTranslation();
  const money = useMoney();
  if (isPending)
    return (
      <Card>
        <SkeletonRows rows={8} />
      </Card>
    );
  if (isError || !data)
    return (
      <Card>
        <ErrorState onRetry={onRetry} />
      </Card>
    );
  if (!data.openingCash && !data.closingCash && !data.netChange && !data.indirect.netProfit)
    return (
      <Card>
        <EmptyState icon={<Waves className="size-5" />} title={t('reports.statements.empty')} body={t('reports.statements.emptyBody')} />
      </Card>
    );
  const k = (s: string) => t(`reports.cashFlow.${s}`);
  const i = data.indirect;
  const d = data.direct;
  const sections: { title: string; lines: Line[] }[] =
    method === 'indirect'
      ? [
          {
            title: k('operating'),
            lines: [
              { key: 'profit', label: k('netProfit'), amount: i.netProfit },
              ...(i.depreciation ? [{ key: 'dep', label: k('depreciation'), amount: i.depreciation }] : []),
              ...i.workingCapital.map((r) => ({ key: r.accountId, label: t('reports.cashFlow.changeIn', { account: `${r.code} ${r.name}` }), amount: r.amount, kind: 'sub' as const, accountId: r.accountId })),
              { key: 'op', label: k('fromOperating'), amount: i.operating, kind: 'total' },
            ],
          },
          {
            title: k('investing'),
            lines: [
              ...i.investingRows.map((r) => ({ key: r.accountId, label: `${r.code} ${r.name}`, amount: r.amount, kind: 'sub' as const, accountId: r.accountId })),
              ...(i.depreciation ? [{ key: 'dep2', label: k('lessDepreciation'), amount: -i.depreciation, kind: 'sub' as const }] : []),
              { key: 'inv', label: k('fromInvesting'), amount: i.investing, kind: 'total' },
            ],
          },
          {
            title: k('financing'),
            lines: [...i.financingRows.map((r) => ({ key: r.accountId, label: `${r.code} ${r.name}`, amount: r.amount, kind: 'sub' as const, accountId: r.accountId })), { key: 'fin', label: k('fromFinancing'), amount: i.financing, kind: 'total' }],
          },
        ]
      : [
          {
            title: k('operating'),
            lines: [
              ...(['customers', 'otherReceipts', 'vendors', 'staff', 'taxes', 'otherPayments'] as const).filter((x) => d[x]).map((x) => ({ key: x, label: k(`direct.${x}`), amount: d[x] })),
              { key: 'op', label: k('fromOperating'), amount: d.operating, kind: 'total' },
            ],
          },
          { title: k('investing'), lines: [{ key: 'inv', label: k('fromInvesting'), amount: d.investing, kind: 'total' }] },
          { title: k('financing'), lines: [{ key: 'fin', label: k('fromFinancing'), amount: d.financing, kind: 'total' }] },
        ];
  const foot: Line[] = [
    { key: 'net', label: k('netChange'), amount: data.netChange, kind: 'grand' },
    { key: 'open', label: k('opening'), amount: data.openingCash },
    { key: 'close', label: k('closing'), amount: data.closingCash, kind: 'total' },
  ];
  const row = (l: Line) => (
    <tr key={l.key} className={clsx(l.kind === 'total' && 'font-semibold', l.kind === 'grand' && 'border-y-2 border-ink-200 bg-ink-50/60 text-base font-semibold dark:border-ink-700 dark:bg-ink-800/40')}>
      <td className={clsx('py-1.5 pe-4', l.kind === 'sub' ? 'ps-8' : 'ps-4')}>
        {l.accountId ? (
          <button type="button" className="text-start hover:underline" onClick={() => onAccount(l.accountId!)} dir="auto">
            {l.label}
          </button>
        ) : (
          <span dir="auto">{l.label}</span>
        )}
      </td>
      <td className={clsx('px-4 py-1.5 text-end font-mono tabular-nums', l.amount < 0 && 'text-expense')} dir="ltr">
        {l.amount ? money.plain(l.amount) : '–'}
      </td>
    </tr>
  );
  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <caption className="sr-only">{k('title')}</caption>
        {sections.map((s) => (
          <tbody key={s.title} className="border-b border-ink-100 dark:border-ink-800">
            <tr>
              <th scope="rowgroup" colSpan={2} className="px-4 pb-1 pt-4 text-start text-xs font-semibold uppercase tracking-wide text-ink-500">
                {s.title}
              </th>
            </tr>
            {s.lines.map(row)}
          </tbody>
        ))}
        <tbody>{foot.map(row)}</tbody>
      </table>
    </Card>
  );
}
