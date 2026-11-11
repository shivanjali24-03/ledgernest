import type { ReactNode } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useMoney } from '../lib/useMoney';
import type { StatementRow } from './types';

export type StatementBlock =
  | { kind: 'section'; key: string; title: string; rows: StatementRow[]; total: number[]; totalLabel: string }
  | { kind: 'line'; key: string; label: string; amounts: number[]; strong?: boolean; tone?: boolean };

/**
 * A financial statement as a table: each section's accounts (sub-accounts indented under their parents, which
 * carry their totals), the section's total, and lines such as gross profit between. Two columns get a change column.
 */
export default function StatementTable({ columns, blocks, onAccount, caption }: { columns: string[]; blocks: StatementBlock[]; onAccount?: (accountId: string) => void; caption: string }) {
  const { t } = useTranslation();
  const money = useMoney();
  const change = columns.length === 2;
  const cell = (n: number) => (n ? money.plain(n) : '–');
  const delta = (a: number[]) => {
    const d = a[0]! - a[1]!;
    return (
      <td className={clsx('px-4 py-1.5 text-end font-mono tabular-nums', d > 0 ? 'text-income' : d < 0 ? 'text-expense' : 'text-ink-400')} dir="ltr">
        {d ? `${d > 0 ? '+' : '−'}${money.plain(Math.abs(d))}` : '–'}
        {a[1] ? <span className="ms-1 text-xs text-ink-400">({Math.round((d / Math.abs(a[1]!)) * 100)}%)</span> : null}
      </td>
    );
  };
  const amounts = (a: number[], strong = false): ReactNode => (
    <>
      {a.map((n, k) => (
        <td key={k} className={clsx('px-4 py-1.5 text-end font-mono tabular-nums', strong && 'font-semibold', n < 0 && 'text-expense')} dir="ltr">
          {cell(n)}
        </td>
      ))}
      {change && delta(a)}
    </>
  );
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-800">
          <tr>
            <th scope="col" className="px-4 py-2.5 text-start font-semibold">
              {t('reports.statements.account')}
            </th>
            {columns.map((c) => (
              <th key={c} scope="col" className="px-4 py-2.5 text-end font-semibold">
                {c}
              </th>
            ))}
            {change && (
              <th scope="col" className="px-4 py-2.5 text-end font-semibold">
                {t('reports.statements.change')}
              </th>
            )}
          </tr>
        </thead>
        {blocks.map((b) =>
          b.kind === 'section' ? (
            <tbody key={b.key} className="border-b border-ink-100 dark:border-ink-800">
              <tr>
                <th scope="rowgroup" colSpan={columns.length + 1 + (change ? 1 : 0)} className="px-4 pb-1 pt-4 text-start text-xs font-semibold uppercase tracking-wide text-ink-500">
                  {b.title}
                </th>
              </tr>
              {b.rows.map((r) => (
                <tr key={r.accountId} className="hover:bg-ink-50/60 dark:hover:bg-ink-800/40">
                  <td className="py-1.5 pe-4" style={{ paddingInlineStart: `${1 + r.depth * 1.25}rem` }}>
                    {onAccount ? (
                      <button type="button" className={clsx('text-start hover:underline', r.hasChildren && 'font-medium')} onClick={() => onAccount(r.accountId)} dir="auto">
                        <span className="me-2 font-mono text-xs text-ink-400">{r.code}</span>
                        {r.name}
                      </button>
                    ) : (
                      <span dir="auto">{r.name}</span>
                    )}
                  </td>
                  {amounts(r.amounts, r.hasChildren)}
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="px-4 py-2">{b.totalLabel}</td>
                {amounts(b.total, true)}
              </tr>
            </tbody>
          ) : (
            <tbody key={b.key}>
              <tr className={clsx(b.strong ? 'border-y-2 border-ink-200 bg-ink-50/60 text-base dark:border-ink-700 dark:bg-ink-800/40' : 'border-b border-ink-100 dark:border-ink-800', 'font-semibold')}>
                <td className="px-4 py-2.5">{b.label}</td>
                {amounts(b.amounts, true)}
              </tr>
            </tbody>
          ),
        )}
      </table>
    </div>
  );
}
