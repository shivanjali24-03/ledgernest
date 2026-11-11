import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, MailCheck, MessageCircle, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../i18n';
import { formatMoney } from '../lib/format';
import { whatsappLink } from '../lib/whatsapp';
import { apiErrorMessage } from '../platform/errors';
import Button from '../ui/Button';
import { Card, EmptyState, ErrorState, SkeletonRows } from '../ui/Kit';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import type { ConfirmationRow, ReportsApi } from './types';

const confirmationUrl = (token: string) => new URL(`b/${token}`, `${window.location.origin}${import.meta.env.BASE_URL}`).toString();
const TONE = { pending: 'text-ink-600 dark:text-ink-300', agreed: 'text-income', disputed: 'text-expense' } as const;

/**
 * Balance confirmations for the audit: ask every customer (or vendor) with a balance on the day to confirm it, by
 * email or a link on WhatsApp, and see who agreed, who disputed and what their books say.
 */
export default function ConfirmationsPanel({ api, asOf, side, canRequest, queryKey }: { api: ReportsApi; asOf: string; side: 'receivable' | 'payable'; canRequest: boolean; queryKey: readonly unknown[] }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [send, setSend] = useState(true);
  const key = [...queryKey, 'confirmations', asOf, side];
  const list = useQuery({ queryKey: key, queryFn: () => api.confirmations(asOf, side) });
  const ask = useMutation({
    mutationFn: () => api.requestConfirmations({ asOf, side, send }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: key });
      setAsking(false);
      toast(r.created ? t('confirmations.asked', { count: r.created, emailed: r.emailed }) : t('confirmations.nobody'), r.created ? undefined : 'error');
    },
    onError: (e) => toast(apiErrorMessage(e, t), 'error'),
  });
  const money = (minor: number, currency: string) => formatMoney(minor, currency, locale);
  const message = (r: ConfirmationRow) => t(side === 'receivable' ? 'confirmations.whatsappReceivable' : 'confirmations.whatsappPayable', { name: r.contact.name, date: asOf, amount: money(Math.abs(r.balance), r.currency), url: confirmationUrl(r.token) });
  const counts = { agreed: 0, disputed: 0, pending: 0 };
  for (const r of list.data ?? []) counts[r.status] += 1;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-500">{list.data?.length ? t('confirmations.summary', counts) : t('confirmations.hint')}</p>
        {canRequest && (
          <Button icon={<Send className="size-4" />} onClick={() => setAsking(true)}>
            {t('confirmations.ask')}
          </Button>
        )}
      </div>
      <Card className="relative overflow-x-auto">
        {list.isError ? (
          <ErrorState onRetry={() => void list.refetch()} />
        ) : !list.data ? (
          <SkeletonRows rows={4} />
        ) : !list.data.length ? (
          <EmptyState icon={<MailCheck className="size-5" />} title={t('confirmations.emptyTitle')} body={t('confirmations.emptyBody')} />
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">{t('confirmations.title')}</caption>
            <thead className="text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th scope="col" className="px-4 py-2 text-start font-semibold">{t('confirmations.cols.party')}</th>
                <th scope="col" className="px-4 py-2 text-end font-semibold">{t('confirmations.cols.ours')}</th>
                <th scope="col" className="px-4 py-2 text-start font-semibold">{t('confirmations.cols.status')}</th>
                <th scope="col" className="px-4 py-2 text-end font-semibold">{t('confirmations.cols.theirs')}</th>
                <th scope="col" className="px-4 py-2 font-semibold"><span className="sr-only">{t('confirmations.cols.share')}</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
              {list.data.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className="px-4 py-2 text-start font-normal">
                    <span className="font-medium">{r.contact.name}</span>
                    {r.note && <span className="block max-w-xs text-xs text-ink-500" dir="auto">“{r.note}”</span>}
                  </th>
                  <td className="px-4 py-2 text-end font-mono tabular-nums" dir="ltr">{money(r.balance, r.currency)}</td>
                  <td className={`px-4 py-2 font-medium ${TONE[r.status]}`}>
                    {t(`confirmations.states.${r.status}`)}
                    {r.respondedBy && <span className="block text-xs font-normal text-ink-500">{t('confirmations.by', { name: r.respondedBy })}</span>}
                    {r.status === 'pending' && <span className="block text-xs font-normal text-ink-500">{r.views ? t('confirmations.opened', { count: r.views }) : r.sentTo ? t('confirmations.emailedTo', { email: r.sentTo }) : t('confirmations.notOpened')}</span>}
                  </td>
                  <td className="px-4 py-2 text-end font-mono tabular-nums" dir="ltr">{r.theirBalance === null ? '–' : money(r.theirBalance, r.currency)}</td>
                  <td className="px-4 py-2">
                    {r.status === 'pending' && (
                      <span className="flex justify-end gap-1">
                        <button type="button" aria-label={t('confirmations.copy', { name: r.contact.name })} onClick={() => void navigator.clipboard?.writeText(confirmationUrl(r.token)).then(() => toast(t('confirmations.copied')))} className="grid size-8 place-items-center rounded-lg text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800">
                          <Copy className="size-4" aria-hidden />
                        </button>
                        <a aria-label={t('confirmations.whatsapp', { name: r.contact.name })} href={whatsappLink(message(r), r.contact.whatsapp ?? r.contact.phone)} target="_blank" rel="noopener noreferrer" className="grid size-8 place-items-center rounded-lg text-[#1fa855] hover:bg-ink-100 dark:hover:bg-ink-800">
                          <MessageCircle className="size-4" aria-hidden />
                        </a>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {asking && (
        <Modal
          open
          onClose={() => setAsking(false)}
          title={t('confirmations.askTitle')}
          description={t(side === 'receivable' ? 'confirmations.askBodyReceivable' : 'confirmations.askBodyPayable', { date: asOf })}
          footer={
            <>
              <Button variant="ghost" onClick={() => setAsking(false)}>
                {t('common.cancel')}
              </Button>
              <Button loading={ask.isPending} onClick={() => ask.mutate()}>
                {t('confirmations.askNow')}
              </Button>
            </>
          }
        >
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} className="mt-0.5 size-4 rounded accent-brand-600" />
            <span>
              <span className="font-medium">{t('confirmations.email')}</span>
              <span className="block text-ink-500">{t('confirmations.emailHint')}</span>
            </span>
          </label>
        </Modal>
      )}
    </div>
  );
}
