import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { INTEREST_MIN_CHARGE, toMinor } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../i18n';
import { formatMoney } from '../lib/format';
import { useSession } from '../layout/session';
import Button from '../ui/Button';
import { TextField } from '../ui/Field';
import { Card } from '../ui/Kit';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import { invoiceErrorMessage } from './errors';
import type { Invoice, InvoicesApi } from './types';

/**
 * Interest on late payment on an issued invoice: what's accrued, what's been invoiced and waived, and what's left;
 * raising a draft invoice for what's left (GST at the supply's rates), or waiving some of it with a reason.
 */
export default function InterestPanel({ invoice, api }: { invoice: Invoice; api: InvoicesApi }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const session = useSession();
  const canManage = session.permissions.has('invoices.manage');
  const cur = invoice.currency ?? 'INR';
  const money = (minor: number) => formatMoney(minor, cur, locale);
  const key = ['invoices', session.organizationId, 'interest', invoice.id];
  const status = useQuery({ queryKey: key, queryFn: () => api.interestStatus(invoice.id) });
  const [waiving, setWaiving] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const raise = useMutation({
    mutationFn: () => api.raiseInterest(invoice.id),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      toast(t('invoices.interest.raised'));
      navigate(`/invoices/${d.id}`);
    },
    onError: (e) => toast(invoiceErrorMessage(e, t), 'error'),
  });
  const waive = useMutation({
    mutationFn: () => api.waiveInterest(invoice.id, { amount: amount.trim() ? (toMinor(amount, 2) ?? undefined) : undefined, reason: reason.trim() }),
    onSuccess: (s) => {
      qc.setQueryData(key, s);
      setWaiving(false);
      toast(t('invoices.interest.waived_msg'));
    },
    onError: (e) => toast(invoiceErrorMessage(e, t), 'error'),
  });
  const s = status.data;
  if (!s || (!s.accrued && !s.charges.length && !s.waivers.length)) return null;
  return (
    <Card className="p-4 print:hidden">
      <h2 className="font-semibold">{t('invoices.interest.panelTitle')}</h2>
      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        {(['accrued', 'charged', 'waived', 'chargeable'] as const).map((k) => (
          <div key={k}>
            <dt className="text-xs text-ink-500">{t(`invoices.interest.panel${k[0]!.toUpperCase()}${k.slice(1)}`)}</dt>
            <dd className="font-mono tabular-nums" dir="ltr" data-testid={`interest-${k}`}>
              {money(s[k])}
            </dd>
          </div>
        ))}
      </dl>
      {(s.charges.length > 0 || s.waivers.length > 0) && (
        <ul className="mt-3 space-y-1 text-xs text-ink-600 dark:text-ink-300">
          {s.charges.map((c) => (
            <li key={c.id}>
              <Link to={`/invoices/${c.id}`} className="font-mono hover:underline" dir="ltr">
                {c.number ?? t('invoices.draftTitle')}
              </Link>{' '}
              · {money(c.interest)}
            </li>
          ))}
          {s.waivers.map((w) => (
            <li key={w.id}>
              {t('invoices.interest.waiverLine', { amount: money(w.amount), date: w.date, reason: w.reason })}
            </li>
          ))}
        </ul>
      )}
      {canManage && s.chargeable >= INTEREST_MIN_CHARGE && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" loading={raise.isPending} onClick={() => raise.mutate()}>
            {t('invoices.interest.raise', { amount: money(s.chargeable) })}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setAmount((s.chargeable / 100).toFixed(2));
              setReason('');
              setWaiving(true);
            }}
          >
            {t('invoices.interest.waive')}
          </Button>
        </div>
      )}
      {waiving && (
        <Modal
          open
          onClose={() => setWaiving(false)}
          title={t('invoices.interest.waiveTitle')}
          description={t('invoices.interest.waiveBody', { amount: money(s.chargeable) })}
          footer={
            <>
              <Button variant="ghost" onClick={() => setWaiving(false)}>
                {t('common.cancel')}
              </Button>
              <Button loading={waive.isPending} disabled={reason.trim().length < 3} onClick={() => waive.mutate()}>
                {t('invoices.interest.waive')}
              </Button>
            </>
          }
        >
          <div className="grid gap-3">
            <TextField label={t('invoices.interest.waiveAmount', { currency: cur })} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" dir="ltr" className="text-end font-mono" />
            <TextField label={t('invoices.interest.waiveReason')} value={reason} onChange={(e) => setReason(e.target.value)} dir="auto" />
          </div>
        </Modal>
      )}
    </Card>
  );
}
