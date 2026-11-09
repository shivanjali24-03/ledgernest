import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { currencyDigits } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../i18n';
import { formatDate } from '../lib/format';
import { useMoney } from '../lib/useMoney';
import Button from '../ui/Button';
import { TextField } from '../ui/Field';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import { currencyErrorMessage } from './errors';
import type { CurrenciesApi, RevalueResult } from './types';

/**
 * Revalue foreign-currency balances at a day's rate (usually a month's last day, before closing it).
 * Shows what moved and links to the entry that booked it.
 */
export default function RevalueDialog({ api, today, onClose }: { api: CurrenciesApi; today: string; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(today);
  const [result, setResult] = useState<RevalueResult | null>(null);
  const run = useMutation({
    mutationFn: () => api.revalue(date),
    onSuccess: (r) => {
      setResult(r);
      for (const key of ['journals', 'journal', 'reports', 'accounts']) void queryClient.invalidateQueries({ queryKey: [key] });
    },
    onError: (e) => toast(currencyErrorMessage(e, t), 'error'),
  });
  const foreign = (minor: number, code: string) => `${code} ${new Intl.NumberFormat(locale, { minimumFractionDigits: currencyDigits(code), maximumFractionDigits: currencyDigits(code) }).format(minor / 10 ** currencyDigits(code))}`;
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={t('currencies.revalue.title')}
      description={result ? undefined : t('currencies.revalue.body')}
      footer={
        result ? (
          <Button onClick={onClose}>{t('currencies.revalue.done')}</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => run.mutate()} loading={run.isPending}>
              {t('currencies.revalue.run')}
            </Button>
          </>
        )
      }
    >
      {!result ? (
        <div className="max-w-xs">
          <TextField type="date" label={t('currencies.revalue.date')} value={date} onChange={(e) => setDate(e.target.value)} hint={t('currencies.revalue.dateHint')} data-autofocus />
        </div>
      ) : (
        <div className="space-y-3 text-sm" role="status">
          {result.entry ? (
            <p>
              {t('currencies.revalue.posted', { date: formatDate(`${result.date}T00:00:00Z`, locale) })}{' '}
              <Link to={`/journals/${result.entry.id}`} className="font-mono font-semibold text-brand-700 hover:underline dark:text-brand-300" dir="ltr">
                {result.entry.number}
              </Link>
            </p>
          ) : (
            <p>{t('currencies.revalue.nothing')}</p>
          )}
          {result.adjustments.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px]">
                <caption className="sr-only">{t('currencies.revalue.title')}</caption>
                <thead className="text-xs uppercase tracking-wide text-ink-400">
                  <tr>
                    <th scope="col" className="py-1.5 text-start font-semibold">
                      {t('journals.fields.account')}
                    </th>
                    <th scope="col" className="py-1.5 text-end font-semibold">
                      {t('currencies.revalue.balance')}
                    </th>
                    <th scope="col" className="py-1.5 text-end font-semibold">
                      {t('currencies.revalue.before')}
                    </th>
                    <th scope="col" className="py-1.5 text-end font-semibold">
                      {t('currencies.revalue.after')}
                    </th>
                    <th scope="col" className="py-1.5 text-end font-semibold">
                      {t('currencies.revalue.difference')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                  {result.adjustments.map((a) => (
                    <tr key={a.accountId}>
                      <th scope="row" className="py-1.5 text-start font-normal" dir="auto">
                        <code className="me-2 text-xs text-ink-400" dir="ltr">
                          {a.code}
                        </code>
                        {a.name}
                      </th>
                      <td className="py-1.5 text-end font-mono tabular-nums" dir="ltr">
                        {foreign(a.foreignBalance, a.currency)} @ {a.rate}
                      </td>
                      <td className="py-1.5 text-end font-mono tabular-nums" dir="ltr">
                        {money.plain(a.before)}
                      </td>
                      <td className="py-1.5 text-end font-mono tabular-nums" dir="ltr">
                        {money.plain(a.after)}
                      </td>
                      <td className={`py-1.5 text-end font-mono tabular-nums ${a.difference > 0 ? 'text-income' : 'text-expense'}`} dir="ltr">
                        {a.difference > 0 ? '+' : '−'}
                        {money.plain(Math.abs(a.difference))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.missingRates.length > 0 && <p className="text-warning">{t('currencies.revalue.missing', { list: result.missingRates.join(', ') })}</p>}
        </div>
      )}
    </Modal>
  );
}
