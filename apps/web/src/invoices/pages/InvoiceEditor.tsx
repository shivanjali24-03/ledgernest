import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dueDateFor } from '@ledgernest/shared';
import { ArrowLeft, BellRing, Ban, Copy, FileDown, FileMinus, HandCoins, Mail, Printer, Repeat } from 'lucide-react';
import RecurringDialog from '../../recurring/RecurringDialog';
import { templateOf } from '../../recurring/templateOf';
import { useRecurringApi } from '../../recurring/useRecurringApi';
import CreditNoteDialog from '../../credit-notes/CreditNoteDialog';
import { useCreditNotesApi } from '../../credit-notes/useCreditNotesApi';
import ReceiptDialog from '../../payments/ReceiptDialog';
import { usePaymentsApi } from '../../payments/usePaymentsApi';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../../i18n';
import { formatDate } from '../../lib/format';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { Card, ErrorState, PageHeader, Pill, SkeletonRows } from '../../ui/Kit';
import { useToast } from '../../ui/toastContext';
import InvoiceDocument from '../InvoiceDocument';
import { invoiceErrorMessage } from '../errors';
import SalesDraftForm, { type SalesDraftPayload } from '../SalesDraftForm';
import ReminderDialog from '../ReminderDialog';
import { saveBlob } from '../../lib/saveBlob';
import EmailInvoiceDialog from '../EmailInvoiceDialog';
import { stateTone } from '../state';
import type { Invoice, InvoicesApi } from '../types';
import { useInvoicesApi } from '../useInvoicesApi';
import DocumentAttachments from '../../attachments/DocumentAttachments';

/** A draft invoice: the shared sales form, saved as an invoice and issued from its second button */
/** `template`: an invoice to copy into a new draft (same customer, lines and notes; dated today, no reference) */
function DraftForm({ invoice, template, api }: { invoice: Invoice | null; template?: Invoice; api: InvoicesApi }) {
  const { t } = useTranslation();
  const toInvoice = (p: SalesDraftPayload) => ({ ...p, issueDate: p.date, dueDate: p.until, date: undefined, until: undefined });
  return (
    <SalesDraftForm
      config={{
        initial: invoice ? { ...invoice, contactId: invoice.contact.id, date: invoice.issueDate, until: invoice.dueDate } : template ? { ...template, contactId: template.contact.id, date: undefined, until: null, reference: null } : null,
        save: async (p, issue) => {
          const saved = invoice ? await api.update(invoice.id, toInvoice(p)) : await api.create(toInvoice(p));
          const done = issue ? await api.issue(saved.id) : saved;
          return { id: done.id, message: issue ? t('invoices.issued', { number: done.number }) : t('invoices.saved') };
        },
        remove: invoice ? () => api.remove(invoice.id) : undefined,
        errorMessage: (e) => invoiceErrorMessage(e, t),
        path: (id) => `/invoices/${id}`,
        listPath: '/invoices',
        invalidate: ['invoices', 'journals', 'journal', 'reports'],
        creditCheck: true,
        autoUntil: (date, customer) => (customer ? dueDateFor(date, customer.paymentTermsDays) : ''),
        untilHint: (customer) => (customer ? t('invoices.dueHint', { days: customer.paymentTermsDays }) : undefined),
        labels: { date: t('invoices.fields.issueDate'), until: t('invoices.fields.dueDate'), save: t('invoices.saveDraft'), extra: t('invoices.issue'), delete: t('invoices.deleteDraft'), deleteTitle: t('invoices.deleteTitle'), deleteBody: t('invoices.deleteBody'), deleted: t('invoices.deleted') },
      }}
    />
  );
}

/** One invoice: a new or draft one to edit, or an issued one to read, print or void. */
export default function InvoiceEditor() {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const { id } = useParams();
  const session = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const api = useInvoicesApi();
  const isNew = !id || id === 'new';
  const key = ['invoices', session.organizationId, 'one', id] as const;
  const query = useQuery({ queryKey: key, queryFn: () => api!.get(id!), enabled: !!api && !isNew });
  const invoice = query.data;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const copyId = isNew ? params.get('copy') : null;
  const forContact = isNew ? params.get('contact') : null;
  const copy = useQuery({ queryKey: ['invoices', session.organizationId, 'one', copyId], queryFn: () => api!.get(copyId!), enabled: !!api && !!copyId });
  const [voiding, setVoiding] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [crediting, setCrediting] = useState(false);
  const [repeating, setRepeating] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const download = useMutation({
    mutationFn: () => api!.pdf(invoice!.id),
    onSuccess: (f) => saveBlob(f),
    onError: (e) => toast(invoiceErrorMessage(e, t), 'error'),
  });
  const recurringApi = useRecurringApi();
  const creditNotesApi = useCreditNotesApi();
  const paymentsApi = usePaymentsApi();
  const canReceive = session.permissions.has('payments.manage');
  const voidIt = useMutation({
    mutationFn: (reason?: string) => api!.void(invoice!.id, { reason }),
    onSuccess: (i) => {
      setVoiding(false);
      queryClient.setQueryData(key, i);
      for (const k of ['invoices', 'journals', 'reports']) void queryClient.invalidateQueries({ queryKey: [k] });
      toast(t('invoices.voided', { number: i.number }));
    },
    onError: (e) => {
      setVoiding(false);
      toast(invoiceErrorMessage(e, t), 'error');
    },
  });
  const canManage = session.permissions.has('invoices.manage');
  const title = isNew ? t('invoices.newTitle') : (invoice?.number ?? t('invoices.draftTitle'));

  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp} className="print:hidden">
        <Link to="/invoices" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800 dark:hover:text-ink-200">
          <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden /> {t('invoices.title')}
        </Link>
        <PageHeader
          title={title}
          description={invoice && invoice.status !== 'draft' ? undefined : t('invoices.draftHint')}
          actions={
            invoice ? (
              <>
                <Pill tone={invoice.status === 'issued' ? 'brand' : 'neutral'}>
                  <span className={stateTone(invoice.state)}>{t(`invoices.states.${invoice.state}`)}</span>
                </Pill>
                {canManage && (
                  <Button variant="ghost" icon={<Copy className="size-4" />} onClick={() => navigate(`/invoices/new?copy=${invoice.id}`)}>
                    {t('invoices.duplicate')}
                  </Button>
                )}
                {invoice.status !== 'draft' && (
                  <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => window.print()}>
                    {t('invoices.print')}
                  </Button>
                )}
                {invoice.status !== 'draft' && (
                  <Button variant="ghost" icon={<FileDown className="size-4" />} loading={download.isPending} onClick={() => download.mutate()}>
                    {t('common.downloadPdf')}
                  </Button>
                )}
                {invoice.status === 'issued' && canReceive && invoice.balance > 0 && (
                  <Button icon={<HandCoins className="size-4" />} onClick={() => setReceiving(true)}>
                    {t('payments.recordPayment')}
                  </Button>
                )}
                {invoice.status === 'issued' && canManage && (
                  <Button variant="secondary" icon={<Mail className="size-4" />} onClick={() => setEmailing(true)}>
                    {t('invoices.email.action')}
                  </Button>
                )}
                {invoice.status === 'issued' && canManage && invoice.balance > 0 && (
                  <Button variant="secondary" icon={<BellRing className="size-4" />} onClick={() => setReminding(true)}>
                    {t('invoices.reminder.action')}
                  </Button>
                )}
                {invoice.status !== 'void' && canManage && (
                  <Button variant="ghost" icon={<Repeat className="size-4" />} onClick={() => setRepeating(true)}>
                    {t('recurring.makeRecurring')}
                  </Button>
                )}
                {invoice.status === 'issued' && canManage && (
                  <Button variant="secondary" icon={<FileMinus className="size-4" />} onClick={() => setCrediting(true)}>
                    {t('creditNotes.new')}
                  </Button>
                )}
                {invoice.status === 'issued' && canManage && invoice.amountPaid === 0 && (
                  <Button variant="ghost" icon={<Ban className="size-4" />} onClick={() => setVoiding(true)}>
                    {t('invoices.void')}
                  </Button>
                )}
              </>
            ) : undefined
          }
        />
      </motion.div>
      <motion.div variants={fadeUp} className="space-y-4">
        {!api ? null : isNew ? (
          copyId ? (
            copy.data ? (
              <DraftForm key={`copy-${copyId}`} invoice={null} template={copy.data} api={api} />
            ) : (
              <Card>
                <SkeletonRows rows={6} />
              </Card>
            )
          ) : (
            <DraftForm key={`new-${forContact ?? ''}`} invoice={null} template={forContact ? ({ contact: { id: forContact }, lines: [], currency: null, notes: null, placeOfSupply: null } as unknown as Invoice) : undefined} api={api} />
          )
        ) : query.isPending ? (
          <Card>
            <SkeletonRows rows={6} />
          </Card>
        ) : query.isError ? (
          <Card>
            <ErrorState onRetry={() => void query.refetch()} />
          </Card>
        ) : invoice!.status === 'draft' ? (
          <DraftForm key={invoice!.id} invoice={invoice!} api={api} />
        ) : (
          <>
            <InvoiceDocument invoice={invoice!} />
            <p className="text-sm text-ink-500 print:hidden">
              {invoice!.journalEntry && (
                <>
                  {t('invoices.postedAs')}{' '}
                  <Link to={`/journals/${invoice!.journalEntry.id}`} className="font-mono font-semibold text-brand-700 hover:underline dark:text-brand-300" dir="ltr">
                    {invoice!.journalEntry.number}
                  </Link>
                </>
              )}
              {invoice!.payments.map((p) => (
                <span key={p.id}>
                  {' · '}
                  {t('payments.paidBy')}{' '}
                  <span className="font-mono" dir="ltr">
                    {p.number}
                  </span>
                </span>
              ))}
              {invoice!.recurring && (
                <>
                  {' · '}
                  {t('recurring.raisedBy')}{' '}
                  <Link to="/recurring" className="hover:underline" dir="auto">
                    {invoice!.recurring.name}
                  </Link>
                </>
              )}
              {invoice!.credits.map((c, n) => (
                <span key={`${c.id}-${n}`}>
                  {' · '}
                  {t('creditNotes.creditedBy')}{' '}
                  <Link to="/credit-notes" className="font-mono hover:underline" dir="ltr">
                    {c.number}
                  </Link>
                </span>
              ))}
              {invoice!.creditNotes
                .filter((c) => c.status === 'issued' && !invoice!.credits.some((x) => x.id === c.id))
                .map((c) => (
                  <span key={c.id}>
                    {' · '}
                    {t('creditNotes.creditedBy')}{' '}
                    <Link to="/credit-notes" className="font-mono hover:underline" dir="ltr">
                      {c.number}
                    </Link>
                  </span>
                ))}
              {invoice!.reminders > 0 && invoice!.lastRemindedAt && (
                <span>
                  {' · '}
                  {t('invoices.reminder.history', { count: invoice!.reminders, date: formatDate(invoice!.lastRemindedAt, locale) })}
                </span>
              )}
              {invoice!.voidEntry && (
                <>
                  {' · '}
                  {t('invoices.voidedBy')}{' '}
                  <Link to={`/journals/${invoice!.voidEntry.id}`} className="font-mono font-semibold text-brand-700 hover:underline dark:text-brand-300" dir="ltr">
                    {invoice!.voidEntry.number}
                  </Link>
                </>
              )}
            </p>
          </>
        )}
        {invoice && <DocumentAttachments documentType="invoice" documentId={invoice.id} />}
      </motion.div>
      {emailing && invoice && api && <EmailInvoiceDialog api={api} invoice={invoice} onClose={() => setEmailing(false)} />}
      {reminding && invoice && api && <ReminderDialog api={api} invoice={invoice} onClose={() => setReminding(false)} onSent={(r) => { setReminding(false); queryClient.setQueryData(key, { ...invoice, ...r }); void queryClient.invalidateQueries({ queryKey: ['audit'] }); }} />}
      {repeating && invoice && recurringApi && <RecurringDialog api={recurringApi} template={templateOf(invoice)} onClose={() => setRepeating(false)} onSaved={() => setRepeating(false)} />}
      {crediting && invoice && creditNotesApi && (
        <CreditNoteDialog
          invoice={invoice}
          api={creditNotesApi}
          onClose={() => setCrediting(false)}
          onDone={() => {
            setCrediting(false);
            void queryClient.invalidateQueries({ queryKey: key });
          }}
        />
      )}
      {receiving && invoice && paymentsApi && (
        <ReceiptDialog
          api={paymentsApi}
          contactId={invoice.contact.id}
          documentId={invoice.id}
          onClose={() => setReceiving(false)}
          onDone={() => {
            setReceiving(false);
            void queryClient.invalidateQueries({ queryKey: key });
          }}
        />
      )}
      <ConfirmDialog
        open={voiding}
        title={invoice ? t('invoices.voidTitle', { number: invoice.number }) : ''}
        body={t('invoices.voidBody')}
        confirmLabel={t('invoices.void')}
        tone="danger"
        askReason
        busy={voidIt.isPending}
        onConfirm={(reason) => voidIt.mutate(reason)}
        onClose={() => setVoiding(false)}
      />
    </motion.div>
  );
}
