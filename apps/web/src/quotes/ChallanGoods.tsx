import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { todayIn } from '@ledgernest/shared';
import { PackageCheck, Truck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../i18n';
import { formatDate } from '../lib/format';
import { useOrganizationSettings } from '../settings/useOrganizationSettings';
import Button from '../ui/Button';
import { TextField } from '../ui/Field';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import type { Quote, QuotesApi } from './types';

/**
 * A delivery challan's goods: send them (they leave stock but stay ours, in "goods sent on challan") and record them
 * coming back. Invoicing the challan sells what left on it. Goods sent for job work are due back within a year.
 */
export default function ChallanGoods({ quote, api, canManage, errorMessage, onChanged }: { quote: Quote; api: QuotesApi; canManage: boolean; errorMessage: (e: unknown) => string; onChanged: (q: Quote) => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const settings = useOrganizationSettings().data;
  const [open, setOpen] = useState<'dispatch' | 'back' | null>(null);
  const [date, setDate] = useState(() => todayIn(settings?.timeZone ?? 'Asia/Kolkata'));
  const [serials, setSerials] = useState<Record<string, string>>({});
  const d = quote.goods;
  const serialLines = quote.lines.filter((l) => l.item?.trackSerials);
  const done = (q: Quote, message: string) => {
    for (const k of ['quotes', 'inventory', 'items', 'journals', 'reports']) void queryClient.invalidateQueries({ queryKey: [k] });
    toast(message);
    setOpen(null);
    onChanged(q);
  };
  const dispatch = useMutation({
    mutationFn: () =>
      api.dispatch(quote.id, {
        date,
        lines: serialLines.map((l) => ({
          quoteLineId: l.id,
          serials: (serials[l.id] ?? '')
            .split(/[\s,]+/)
            .map((x) => x.trim())
            .filter(Boolean),
        })),
      }),
    onSuccess: (q) => done(q, t('quotes.challan.dispatched', { number: q.number })),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const back = useMutation({
    mutationFn: () => api.goodsBack(quote.id, { date }),
    onSuccess: (q) => done(q, t('quotes.challan.backDone', { number: q.number })),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  if (!d) return null;
  const canDispatch = canManage && !d.dispatchedAt && quote.status !== 'invoiced' && quote.status !== 'declined';
  const canBack = canManage && !!d.dispatchedAt && !d.backAt;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (open === 'dispatch') dispatch.mutate();
    else back.mutate();
  };
  return (
    <section aria-label={t('quotes.challan.goods')} className="flex flex-wrap items-center gap-3 rounded-xl bg-ink-50 px-4 py-3 text-sm print:hidden dark:bg-ink-900">
      <p className="flex-1 text-ink-700 dark:text-ink-200">
        {!d.dispatchedAt
          ? t('quotes.challan.notSent')
          : d.backAt
            ? t(d.backReason === 'invoiced' ? 'quotes.challan.invoicedOn' : 'quotes.challan.backOn', { sent: formatDate(d.dispatchedAt, locale), date: formatDate(d.backAt, locale) })
            : t('quotes.challan.outSince', { date: formatDate(d.dispatchedAt, locale) })}
        {d.jobWorkDue && <span className="block text-xs text-ink-500">{t('quotes.challan.jobWorkDue', { date: formatDate(d.jobWorkDue, locale) })}</span>}
      </p>
      {canDispatch && (
        <Button size="sm" icon={<Truck className="size-4" />} onClick={() => setOpen('dispatch')}>
          {t('quotes.challan.dispatch')}
        </Button>
      )}
      {canBack && (
        <Button size="sm" variant="secondary" icon={<PackageCheck className="size-4" />} onClick={() => setOpen('back')}>
          {t('quotes.challan.back')}
        </Button>
      )}
      {open && (
        <Modal
          open
          onClose={() => setOpen(null)}
          title={t(open === 'dispatch' ? 'quotes.challan.dispatchTitle' : 'quotes.challan.backTitle', { number: quote.number })}
          description={t(open === 'dispatch' ? 'quotes.challan.dispatchBody' : 'quotes.challan.backBody')}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" form="challan-goods-form" loading={dispatch.isPending || back.isPending}>
                {t(open === 'dispatch' ? 'quotes.challan.dispatch' : 'quotes.challan.back')}
              </Button>
            </>
          }
        >
          <form id="challan-goods-form" onSubmit={submit} noValidate className="space-y-3">
            <TextField label={t('quotes.challan.goodsDate')} type="date" value={date} min={open === 'dispatch' ? quote.quoteDate : (d.dispatchedAt ?? undefined)} onChange={(e) => setDate(e.target.value)} />
            {open === 'dispatch' &&
              serialLines.map((l) => (
                <TextField key={l.id} label={t('quotes.challan.serials', { description: l.description, quantity: l.quantity })} value={serials[l.id] ?? ''} onChange={(e) => setSerials((s) => ({ ...s, [l.id]: e.target.value }))} placeholder="IMEI-1, IMEI-2" dir="ltr" className="font-mono" />
              ))}
          </form>
        </Modal>
      )}
    </section>
  );
}
