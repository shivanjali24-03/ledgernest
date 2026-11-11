import { useState } from 'react';
import { monthlyInstalments, toMinor, type Instalment } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import Button from '../ui/Button';
import { inputClass, TextField } from '../ui/Field';
import { Card } from '../ui/Kit';

/**
 * Paying an invoice in instalments: split the total into equal monthly ones from a first day, then change any day or
 * amount. They must add up to the total; the last one is the due date.
 */
export default function InstalmentsEditor({ value, onChange, total, issueDate, plain, digits, disabled }: { value: Instalment[] | null; onChange: (v: Instalment[] | null) => void; total: number; issueDate: string; plain: (minor: number) => string; digits: number; disabled?: boolean }) {
  const { t } = useTranslation();
  const [count, setCount] = useState('3');
  const [first, setFirst] = useState(issueDate);
  const sum = (value ?? []).reduce((s, x) => s + x.amount, 0);
  const cell = clsx(inputClass, 'h-9 border-ink-200 dark:border-ink-700');
  return (
    <Card className="p-5">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={!!value} disabled={disabled || total <= 0} onChange={(e) => onChange(e.target.checked ? monthlyInstalments(total, Number(count) || 3, first) : null)} className="size-4 rounded accent-brand-600" />
        {t('instalments.toggle')}
      </label>
      {value && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-28">
              <TextField label={t('instalments.count')} type="number" min={2} max={60} value={count} onChange={(e) => setCount(e.target.value)} disabled={disabled} />
            </div>
            <div className="w-44">
              <TextField label={t('instalments.first')} type="date" value={first} min={issueDate} onChange={(e) => setFirst(e.target.value)} disabled={disabled} />
            </div>
            <Button size="sm" variant="secondary" disabled={disabled || !(Number(count) >= 2)} onClick={() => onChange(monthlyInstalments(total, Math.min(60, Number(count)), first))}>
              {t('instalments.splitMonthly')}
            </Button>
          </div>
          <table className="w-full max-w-md text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th scope="col" className="py-1 text-start font-semibold">#</th>
                <th scope="col" className="py-1 text-start font-semibold">{t('instalments.due')}</th>
                <th scope="col" className="py-1 text-end font-semibold">{t('instalments.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {value.map((x, n) => (
                <tr key={n}>
                  <td className="py-1 pe-2 text-ink-500">{n + 1}</td>
                  <td className="py-1 pe-2">
                    <input aria-label={t('instalments.dueN', { n: n + 1 })} type="date" value={x.dueDate} disabled={disabled} onChange={(e) => onChange(value.map((y, k) => (k === n ? { ...y, dueDate: e.target.value } : y)))} className={cell} />
                  </td>
                  <td className="py-1">
                    <input
                      aria-label={t('instalments.amountN', { n: n + 1 })}
                      defaultValue={plain(x.amount)}
                      key={`${n}-${x.amount}`}
                      disabled={disabled}
                      onBlur={(e) => {
                        const m = toMinor(e.target.value, digits);
                        if (m !== null) onChange(value.map((y, k) => (k === n ? { ...y, amount: m } : y)));
                      }}
                      inputMode="decimal"
                      dir="ltr"
                      className={clsx(cell, 'text-end font-mono')}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={clsx('text-sm', sum === total ? 'text-ink-500' : 'text-expense')} role="status">
            {sum === total ? t('instalments.addsUp') : t('instalments.mismatch', { sum: plain(sum), total: plain(total) })}
          </p>
        </div>
      )}
    </Card>
  );
}
