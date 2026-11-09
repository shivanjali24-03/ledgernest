import { useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Building2, HandCoins, Plus, Send } from 'lucide-react';
import type { PaymentKind } from '@ledgernest/shared';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../../i18n';
import { billErrorMessage } from '../../bills/errors';
import { formatDate, formatMoney } from '../../lib/format';
import { useMoney } from '../../lib/useMoney';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Pill, Segmented, SkeletonRows } from '../../ui/Kit';
import RowMenu from '../../ui/RowMenu';
import { useToast } from '../../ui/toastContext';
import ReceiptDialog from '../ReceiptDialog';
import type { Payment } from '../types';
import { usePaymentsApi } from '../usePaymentsApi';

const PAGE_SIZE = 25;

/** Money received from customers and paid to vendors, and the invoices and bills it settled. */
export default function Payments() {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  const session = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const api = usePaymentsApi();
  const canManage = session.permissions.has('payments.manage');
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState<'all' | PaymentKind>('all');
  const [recording, setRecording] = useState<PaymentKind | null>(null);
  const [voiding, setVoiding] = useState<Payment | null>(null);
  const query = useQuery({ queryKey: ['payments', session.organizationId, session.role ?? session.customRoleName, kind, page], queryFn: () => api!.list({ kind: kind === 'all' ? undefined : kind, page, pageSize: PAGE_SIZE }), enabled: !!api, placeholderData: keepPreviousData });
  const voidIt = useMutation({
    mutationFn: ({ p, reason }: { p: Payment; reason?: string }) => api!.void(p.id, reason),
    onSuccess: (p) => {
      setVoiding(null);
      for (const k of ['payments', 'invoices', 'bills', 'contacts', 'journals', 'reports']) void queryClient.invalidateQueries({ queryKey: [k] });
      toast(t('payments.voided', { number: p.number }));
    },
    onError: (e) => {
      setVoiding(null);
      toast(billErrorMessage(e, t), 'error');
    },
  });
  if (!api) {
    return (
      <Card>
        <EmptyState icon={<Building2 className="size-5" />} title={t('team.noOrganization')} body={t('team.noOrganizationBody')} />
      </Card>
    );
  }
  const data = query.data;
  const amount = (p: Payment, minor: number) => (p.currency ? formatMoney(minor, p.currency, locale) : money.format(minor));
  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <PageHeader
          eyebrow={<span dir="auto">{session.organization}</span>}
          title={t('payments.title')}
          description={t('payments.description')}
          actions={
            canManage ? (
              <>
                <Button variant="secondary" icon={<Send className="size-4 rtl:-scale-x-100" />} onClick={() => setRecording('payment')}>
                  {t('payments.payVendor')}
                </Button>
                <Button icon={<Plus className="size-4" />} onClick={() => setRecording('receipt')}>
                  {t('payments.receive')}
                </Button>
              </>
            ) : undefined
          }
        />
      </motion.div>
      <motion.div variants={fadeUp}>
        <Segmented<'all' | PaymentKind>
          label={t('payments.filter')}
          value={kind}
          onChange={(v) => (setKind(v), setPage(1))}
          options={[
            { value: 'all', label: t('payments.filters.all') },
            { value: 'receipt', label: t('payments.filters.receipt') },
            { value: 'payment', label: t('payments.filters.payment') },
          ]}
        />
      </motion.div>
      <motion.div variants={fadeUp}>
        <Card className="overflow-hidden">
          {query.isPending ? (
            <SkeletonRows rows={5} />
          ) : query.isError ? (
            <ErrorState onRetry={() => void query.refetch()} />
          ) : !data!.items.length ? (
            <EmptyState icon={<HandCoins className="size-5" />} title={t('payments.empty')} body={t('payments.emptyBody')} />
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-ink-800">
              {data!.items.map((p) => (
                <li key={p.id} className={clsx('flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3', p.status === 'void' && 'opacity-60')}>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <Link to={`/journals/${p.journalEntry.id}`} className="font-mono font-semibold text-brand-700 hover:underline dark:text-brand-300" dir="ltr">
                        {p.number}
                      </Link>
                      <span className="font-medium" dir="auto">
                        {p.contact.name}
                      </span>
                      {p.status === 'void' && <Pill>{t('payments.void')}</Pill>}
                    </span>
                    <span className="block text-sm text-ink-500">
                      {formatDate(`${p.date}T00:00:00Z`, locale)} · {p.bankAccount.name}
                      {p.reference && ` · ${p.reference}`}
                    </span>
                    {p.allocations.length > 0 && (
                      <span className="block text-xs text-ink-500">
                        {t('payments.paid')}{' '}
                        {p.allocations.map((a, n) => (
                          <span key={a.documentId}>
                            {n > 0 && ', '}
                            <Link to={`/${a.kind === 'bill' ? 'bills' : 'invoices'}/${a.documentId}`} className="font-mono hover:underline" dir="ltr">
                              {a.documentNumber}
                            </Link>
                          </span>
                        ))}
                        {p.unallocated > 0 && ` · ${t('payments.onAccount', { amount: amount(p, p.unallocated) })}`}
                      </span>
                    )}
                  </span>
                  <span className={clsx('font-mono font-semibold tabular-nums', p.kind === 'receipt' ? 'text-income' : 'text-expense')} dir="ltr">
                    {p.kind === 'payment' && '−'}
                    {amount(p, p.amount)}
                  </span>
                  {canManage && p.status === 'posted' && <RowMenu label={t('payments.actionsFor', { number: p.number })} items={[{ key: 'void', label: t(p.kind === 'receipt' ? 'payments.voidAction' : 'payments.voidPayment'), icon: Ban, danger: true, onSelect: () => setVoiding(p) }]} />}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </motion.div>
      {data && data.total > PAGE_SIZE && <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />}
      {recording && <ReceiptDialog api={api} kind={recording} onClose={() => setRecording(null)} onDone={() => setRecording(null)} />}
      <ConfirmDialog
        open={!!voiding}
        title={voiding ? t('payments.voidTitle', { number: voiding.number }) : ''}
        body={t(voiding?.kind === 'payment' ? 'payments.voidPaymentBody' : 'payments.voidBody')}
        confirmLabel={t(voiding?.kind === 'payment' ? 'payments.voidPayment' : 'payments.voidAction')}
        tone="danger"
        askReason
        busy={voidIt.isPending}
        onConfirm={(reason) => voiding && voidIt.mutate({ p: voiding, reason })}
        onClose={() => setVoiding(null)}
      />
    </motion.div>
  );
}
