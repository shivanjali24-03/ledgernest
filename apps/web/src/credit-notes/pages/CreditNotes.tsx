import { useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Banknote, Building2, FileDown, FileMinus, Forward, Mail } from 'lucide-react';
import { saveBlob } from '../../lib/saveBlob';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../../i18n';
import { formatDate, formatMoney } from '../../lib/format';
import { useMoney } from '../../lib/useMoney';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Pill, SkeletonRows } from '../../ui/Kit';
import RowMenu from '../../ui/RowMenu';
import { apiErrorMessage } from '../../platform/errors';
import EmailDialog from '../../ui/EmailDialog';
import { useToast } from '../../ui/toastContext';
import ApplyCreditDialog from '../ApplyCreditDialog';
import RefundDialog from '../RefundDialog';
import { creditNoteErrorMessage } from '../errors';
import type { CreditNote } from '../types';
import { useCreditNotesApi } from '../useCreditNotesApi';

const PAGE_SIZE = 25;

/** Credit notes: what was credited against which invoice, and where the credit went. */
export default function CreditNotes() {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  const session = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const api = useCreditNotesApi();
  const canManage = session.permissions.has('invoices.manage');
  const canRefund = session.permissions.has('payments.manage');
  const [page, setPage] = useState(1);
  const [applying, setApplying] = useState<CreditNote | null>(null);
  const [refunding, setRefunding] = useState<CreditNote | null>(null);
  const [voiding, setVoiding] = useState<CreditNote | null>(null);
  const [emailing, setEmailing] = useState<CreditNote | null>(null);
  const query = useQuery({ queryKey: ['credit-notes', session.organizationId, session.role ?? session.customRoleName, page], queryFn: () => api!.list({ page, pageSize: PAGE_SIZE }), enabled: !!api, placeholderData: keepPreviousData });
  const voidIt = useMutation({
    mutationFn: ({ c, reason }: { c: CreditNote; reason?: string }) => api!.void(c.id, reason),
    onSuccess: (c) => {
      setVoiding(null);
      for (const k of ['credit-notes', 'invoices', 'contacts', 'journals', 'reports']) void queryClient.invalidateQueries({ queryKey: [k] });
      toast(t('creditNotes.voided', { number: c.number }));
    },
    onError: (e) => {
      setVoiding(null);
      toast(creditNoteErrorMessage(e, t), 'error');
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
  const amount = (c: CreditNote, minor: number) => (c.currency ? formatMoney(minor, c.currency, locale) : money.format(minor));
  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <PageHeader eyebrow={<span dir="auto">{session.organization}</span>} title={t('creditNotes.title')} description={t('creditNotes.description')} />
      </motion.div>
      <motion.div variants={fadeUp}>
        <Card className="overflow-hidden">
          {query.isPending ? (
            <SkeletonRows rows={5} />
          ) : query.isError ? (
            <ErrorState onRetry={() => void query.refetch()} />
          ) : !data!.items.length ? (
            <EmptyState icon={<FileMinus className="size-5" />} title={t('creditNotes.empty')} body={t('creditNotes.emptyBody')} />
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-ink-800">
              {data!.items.map((c) => (
                <li key={c.id} className={clsx('flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3', c.status === 'void' && 'opacity-60')}>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <Link to={`/journals/${c.journalEntry.id}`} className="font-mono font-semibold text-brand-700 hover:underline dark:text-brand-300" dir="ltr">
                        {c.number}
                      </Link>
                      <span className="font-medium" dir="auto">
                        {c.contact.name}
                      </span>
                      {c.status === 'void' && <Pill>{t('payments.void')}</Pill>}
                      {c.status === 'issued' && c.remaining > 0 && <Pill tone="brand">{t('creditNotes.creditLeft', { amount: amount(c, c.remaining) })}</Pill>}
                    </span>
                    <span className="block text-sm text-ink-500">
                      {formatDate(`${c.date}T00:00:00Z`, locale)} · {t('creditNotes.against')}{' '}
                      <Link to={`/invoices/${c.invoice.id}`} className="font-mono hover:underline" dir="ltr">
                        {c.invoice.number}
                      </Link>
                      {c.reason && ` · ${c.reason}`}
                    </span>
                    {c.applications.length > 0 && (
                      <span className="block text-xs text-ink-500">
                        {c.applications.map((a, n) => (
                          <span key={a.id}>
                            {n > 0 && ' · '}
                            {a.kind === 'invoice' ? (
                              <>
                                {t('creditNotes.onInvoice', { amount: amount(c, a.amount) })}{' '}
                                <Link to={`/invoices/${a.invoice.id}`} className="font-mono hover:underline" dir="ltr">
                                  {a.invoice.number}
                                </Link>
                              </>
                            ) : (
                              t('creditNotes.refundedFrom', { amount: amount(c, a.amount), bank: a.bankAccount?.name ?? '' })
                            )}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="font-mono font-semibold tabular-nums" dir="ltr">
                    {amount(c, c.total)}
                  </span>
                  <RowMenu
                    label={t('payments.actionsFor', { number: c.number })}
                    items={[
                      { key: 'pdf', label: t('common.downloadPdf'), icon: FileDown, onSelect: () => void api!.pdf(c.id).then(saveBlob, (e: unknown) => toast(creditNoteErrorMessage(e, t), 'error')) },
                      ...(c.status === 'issued' && canManage ? [{ key: 'email', label: t('creditNotes.email.action'), icon: Mail, onSelect: () => setEmailing(c) }] : []),
                      ...(c.status === 'issued' && canManage && c.remaining > 0 ? [{ key: 'apply', label: t('creditNotes.applyAction'), icon: Forward, onSelect: () => setApplying(c) }] : []),
                      ...(c.status === 'issued' && canRefund && c.remaining > 0 ? [{ key: 'refund', label: t('creditNotes.refundAction'), icon: Banknote, onSelect: () => setRefunding(c) }] : []),
                      ...(c.status === 'issued' && canManage ? [{ key: 'void', label: t('creditNotes.void'), icon: Ban, danger: true, onSelect: () => setVoiding(c) }] : []),
                    ]}
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </motion.div>
      {data && data.total > PAGE_SIZE && <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />}
      {applying && <ApplyCreditDialog note={applying} api={api} onClose={() => setApplying(null)} />}
      {refunding && <RefundDialog note={refunding} api={api} onClose={() => setRefunding(null)} />}
      {emailing && api && (
        <EmailDialog
          title={t('creditNotes.email.title', { number: emailing.number })}
          description={t('creditNotes.email.body')}
          defaultEmail={null}
          blankHint={t('creditNotes.email.blankHint')}
          send={(input) => api.email(emailing.id, input)}
          sentMessage={(email) => t('creditNotes.email.sent', { email })}
          demoMessage={(email) => t('creditNotes.email.sentDemo', { email })}
          errorMessage={(e) => (e instanceof Error && 'details' in e && (e as { details?: { reason?: string } }).details?.reason === 'no_email' ? t('creditNotes.email.noEmail') : apiErrorMessage(e, t))}
          onClose={() => setEmailing(null)}
        />
      )}
      <ConfirmDialog
        open={!!voiding}
        title={voiding ? t('creditNotes.voidTitle', { number: voiding.number }) : ''}
        body={t('creditNotes.voidBody')}
        confirmLabel={t('creditNotes.void')}
        tone="danger"
        askReason
        busy={voidIt.isPending}
        onConfirm={(reason) => voiding && voidIt.mutate({ c: voiding, reason })}
        onClose={() => setVoiding(null)}
      />
    </motion.div>
  );
}
