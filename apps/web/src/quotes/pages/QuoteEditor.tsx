import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dueDateFor as addDays, QUOTE_MOVES, QUOTE_VALID_DAYS, quoteEditable } from '@ledgernest/shared';
import { ArrowLeft, Check, Copy, FileOutput, Mail, Printer, Undo2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../auth/client';
import { useIntlLocale } from '../../i18n';
import { invoiceErrorMessage } from '../../invoices/errors';
import SalesDraftForm, { type SalesDraftPayload } from '../../invoices/SalesDraftForm';
import { formatDate, formatMoney } from '../../lib/format';
import { useMoney } from '../../lib/useMoney';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import Button from '../../ui/Button';
import { Card, ErrorState, PageHeader, Pill, SkeletonRows } from '../../ui/Kit';
import { useToast } from '../../ui/toastContext';
import EmailQuoteDialog from '../EmailQuoteDialog';
import { quoteTone } from '../tone';
import type { Quote, QuotesApi } from '../types';
import { useQuotesApi } from '../useQuotesApi';

const QUOTE_REASONS = ['not_editable', 'not_draft', 'bad_move', 'already_invoiced', 'declined', 'not_sendable', 'mail_off', 'no_email', 'mail_failed'];
/** A translated explanation for a quote refusal; line and customer problems read as they do for invoices */
function quoteErrorMessage(e: unknown, t: (k: string) => string) {
  const reason = e instanceof ApiError ? e.details?.reason : undefined;
  return typeof reason === 'string' && QUOTE_REASONS.includes(reason) ? t(`quotes.errors.${reason}`) : invoiceErrorMessage(e, t as never);
}

/** `template`: a quote to copy into a new one (same customer, lines and notes; dated today) */
function DraftForm({ quote, template, api }: { quote: Quote | null; template?: Quote; api: QuotesApi }) {
  const { t } = useTranslation();
  const toQuote = (p: SalesDraftPayload) => ({ contactId: p.contactId, quoteDate: p.date, expiryDate: p.until ?? addDays(p.date, QUOTE_VALID_DAYS), reference: p.reference, notes: p.notes, placeOfSupply: p.placeOfSupply, lines: p.lines });
  return (
    <SalesDraftForm
      config={{
        initial: quote ? { ...quote, contactId: quote.contact.id, date: quote.quoteDate, until: quote.expiryDate } : template ? { ...template, contactId: template.contact.id, date: undefined, until: null } : null,
        save: async (p, send) => {
          const saved = quote ? await api.update(quote.id, toQuote(p)) : await api.create(toQuote(p));
          const done = send && saved.status === 'draft' ? await api.move(saved.id, 'sent') : saved;
          return { id: done.id, message: send ? t('quotes.sent', { number: done.number }) : t('quotes.saved', { number: done.number }) };
        },
        remove: quote?.status === 'draft' ? () => api.remove(quote.id) : undefined,
        errorMessage: (e) => quoteErrorMessage(e, t),
        path: (id) => `/quotes/${id}`,
        listPath: '/quotes',
        invalidate: ['quotes'],
        autoUntil: (date) => addDays(date, QUOTE_VALID_DAYS),
        untilHint: () => t('quotes.expiryHint', { days: QUOTE_VALID_DAYS }),
        labels: { date: t('quotes.fields.quoteDate'), until: t('quotes.fields.expiryDate'), save: t('quotes.save'), extra: quote?.status === 'sent' ? t('quotes.saveSent') : t('quotes.saveAndSend'), delete: t('quotes.delete'), deleteTitle: t('quotes.deleteTitle'), deleteBody: t('quotes.deleteBody'), deleted: t('quotes.deleted') },
      }}
    />
  );
}

/** A settled quote (or one you can't change): its lines and totals, to read or print */
function QuoteView({ quote }: { quote: Quote }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  const fmt = (minor: number) => (quote.currency ? formatMoney(minor, quote.currency, locale) : money.format(minor));
  const day = (d: string) => formatDate(`${d}T00:00:00Z`, locale);
  return (
    <Card className="overflow-hidden">
      <dl className="grid gap-4 border-b border-ink-100 p-5 text-sm sm:grid-cols-4 dark:border-ink-800">
        <div>
          <dt className="text-xs text-ink-500">{t('invoices.fields.customer')}</dt>
          <dd className="font-medium" dir="auto">
            {quote.contact.name}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-500">{t('quotes.fields.quoteDate')}</dt>
          <dd>{day(quote.quoteDate)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-500">{t('quotes.fields.expiryDate')}</dt>
          <dd>{day(quote.expiryDate)}</dd>
        </div>
        {quote.reference && (
          <div>
            <dt className="text-xs text-ink-500">{t('invoices.fields.reference')}</dt>
            <dd dir="auto">{quote.reference}</dd>
          </div>
        )}
      </dl>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-800">
            <tr>
              <th scope="col" className="px-4 py-2.5 text-start font-semibold">
                {t('invoices.columns.description')}
              </th>
              <th scope="col" className="px-4 py-2.5 text-end font-semibold">
                {t('invoices.columns.qty')}
              </th>
              <th scope="col" className="px-4 py-2.5 text-end font-semibold">
                {t('invoices.columns.discount')}
              </th>
              <th scope="col" className="px-4 py-2.5 text-start font-semibold">
                {t('invoices.columns.tax')}
              </th>
              <th scope="col" className="px-4 py-2.5 text-end font-semibold">
                {t('invoices.columns.amount')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
            {quote.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2.5" dir="auto">
                  {l.description}
                </td>
                <td className="px-4 py-2.5 text-end font-mono tabular-nums" dir="ltr">
                  {l.quantity}
                </td>
                <td className="px-4 py-2.5 text-end font-mono tabular-nums" dir="ltr">
                  {l.discount ? `${l.discount}%` : ''}
                </td>
                <td className="px-4 py-2.5 text-ink-500">{l.taxGroup?.name ?? ''}</td>
                <td className="px-4 py-2.5 text-end font-mono tabular-nums" dir="ltr">
                  {fmt(l.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="ms-auto grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 border-t border-ink-100 p-5 text-sm dark:border-ink-800" role="status" aria-label={t('invoices.totals')}>
        <dt className="text-ink-500">{t('invoices.subtotal')}</dt>
        <dd className="text-end font-mono tabular-nums" dir="ltr">
          {fmt(quote.subtotal)}
        </dd>
        <dt className="text-ink-500">{t('quotes.tax')}</dt>
        <dd className="text-end font-mono tabular-nums" dir="ltr">
          {fmt(quote.taxTotal)}
        </dd>
        <dt className="border-t border-ink-200 pt-1 font-semibold dark:border-ink-700">{t('invoices.total')}</dt>
        <dd className="border-t border-ink-200 pt-1 text-end font-mono font-semibold tabular-nums dark:border-ink-700" dir="ltr">
          {fmt(quote.total)}
        </dd>
      </dl>
      {quote.notes && (
        <p className="border-t border-ink-100 p-5 text-sm text-ink-600 dark:border-ink-800 dark:text-ink-300" dir="auto">
          {quote.notes}
        </p>
      )}
    </Card>
  );
}

/** One quote: a new or open one to edit, a settled one to read; moved on, or turned into an invoice, from the header */
export default function QuoteEditor() {
  const { t } = useTranslation();
  const { id } = useParams();
  const session = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const api = useQuotesApi();
  const isNew = !id || id === 'new';
  const key = ['quotes', session.organizationId, 'one', id] as const;
  const query = useQuery({ queryKey: key, queryFn: () => api!.get(id!), enabled: !!api && !isNew });
  const quote = query.data;
  const [params] = useSearchParams();
  const copyId = isNew ? params.get('copy') : null;
  const copy = useQuery({ queryKey: ['quotes', session.organizationId, 'one', copyId], queryFn: () => api!.get(copyId!), enabled: !!api && !!copyId });
  const canManage = session.permissions.has('invoices.manage');
  const [emailing, setEmailing] = useState(false);
  const move = useMutation({
    mutationFn: (status: 'draft' | 'sent' | 'accepted' | 'declined') => api!.move(quote!.id, status),
    onSuccess: (q) => {
      queryClient.setQueryData(key, q);
      void queryClient.invalidateQueries({ queryKey: ['quotes'] });
      toast(t(`quotes.moved.${q.status}`, { number: q.number }));
    },
    onError: (e) => toast(quoteErrorMessage(e, t), 'error'),
  });
  const convert = useMutation({
    mutationFn: () => api!.convert(quote!.id, {}),
    onSuccess: (r) => {
      for (const k of ['quotes', 'invoices']) void queryClient.invalidateQueries({ queryKey: [k] });
      toast(t('quotes.converted', { number: r.quote.number }));
      navigate(`/invoices/${r.invoiceId}`);
    },
    onError: (e) => toast(quoteErrorMessage(e, t), 'error'),
  });
  const moves = quote ? QUOTE_MOVES[quote.status] : [];
  const editable = !!quote && canManage && quoteEditable(quote.status);

  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp} className="print:hidden">
        <Link to="/quotes" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800 dark:hover:text-ink-200">
          <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden /> {t('quotes.title')}
        </Link>
        <PageHeader
          title={isNew ? t('quotes.newTitle') : (quote?.number ?? '')}
          description={isNew ? t('quotes.newHint') : undefined}
          actions={
            quote ? (
              <>
                <Pill tone={quote.status === 'invoiced' || quote.status === 'accepted' ? 'brand' : 'neutral'}>
                  <span className={quoteTone(quote.state)}>{t(`quotes.states.${quote.state}`)}</span>
                </Pill>
                {canManage && (
                  <Button variant="ghost" icon={<Copy className="size-4" />} onClick={() => navigate(`/quotes/new?copy=${quote.id}`)}>
                    {t('quotes.duplicate')}
                  </Button>
                )}
                {!editable && (
                  <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => window.print()}>
                    {t('invoices.print')}
                  </Button>
                )}
                {canManage && quote.status !== 'invoiced' && quote.status !== 'declined' && (
                  <Button variant="secondary" icon={<Mail className="size-4" />} onClick={() => setEmailing(true)}>
                    {t('quotes.email.action')}
                  </Button>
                )}
                {canManage && quote.status !== 'invoiced' && quote.status !== 'declined' && (
                  <Button icon={<FileOutput className="size-4" />} loading={convert.isPending} onClick={() => convert.mutate()}>
                    {t('quotes.convert')}
                  </Button>
                )}
                {canManage && moves.includes('accepted') && (
                  <Button variant="secondary" icon={<Check className="size-4" />} loading={move.isPending && move.variables === 'accepted'} onClick={() => move.mutate('accepted')}>
                    {t('quotes.accept')}
                  </Button>
                )}
                {canManage && moves.includes('declined') && (
                  <Button variant="ghost" icon={<X className="size-4" />} loading={move.isPending && move.variables === 'declined'} onClick={() => move.mutate('declined')}>
                    {t('quotes.decline')}
                  </Button>
                )}
                {canManage && (quote.status === 'accepted' || quote.status === 'declined') && (
                  <Button variant="ghost" icon={<Undo2 className="size-4" />} loading={move.isPending && move.variables === 'sent'} onClick={() => move.mutate('sent')}>
                    {t('quotes.reopen')}
                  </Button>
                )}
              </>
            ) : undefined
          }
        />
      </motion.div>
      <motion.div variants={fadeUp} className="space-y-4">
        {!api ? null : isNew ? (
          canManage ? (
            copyId ? (
              copy.data ? (
                <DraftForm key={`copy-${copyId}`} quote={null} template={copy.data} api={api} />
              ) : (
                <Card>
                  <SkeletonRows rows={6} />
                </Card>
              )
            ) : (
              <DraftForm key="new" quote={null} api={api} />
            )
          ) : null
        ) : query.isPending ? (
          <Card>
            <SkeletonRows rows={6} />
          </Card>
        ) : query.isError ? (
          <Card>
            <ErrorState onRetry={() => void query.refetch()} />
          </Card>
        ) : editable ? (
          <DraftForm key={`${quote!.id}-${quote!.updatedAt}`} quote={quote!} api={api} />
        ) : (
          <QuoteView quote={quote!} />
        )}
        {quote?.invoice && (
          <p className="text-sm text-ink-500 print:hidden">
            {t('quotes.becameInvoice')}{' '}
            <Link to={`/invoices/${quote.invoice.id}`} className="font-mono font-semibold text-brand-700 hover:underline dark:text-brand-300" dir="ltr">
              {quote.invoice.number ?? t('quotes.draftInvoice')}
            </Link>
          </p>
        )}
      </motion.div>
      {emailing && quote && api && (
        <EmailQuoteDialog
          api={api}
          quote={quote}
          errorMessage={(e) => quoteErrorMessage(e, t)}
          onClose={() => setEmailing(false)}
          onSent={(q) => {
            setEmailing(false);
            queryClient.setQueryData(key, q);
            void queryClient.invalidateQueries({ queryKey: ['quotes'] });
          }}
        />
      )}
    </motion.div>
  );
}
