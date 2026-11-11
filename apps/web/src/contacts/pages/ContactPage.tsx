import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BellRing, FileSignature, FileText, MessageCircle, Pencil, Plus, Receipt, Share2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useBillsApi } from '../../bills/useBillsApi';
import { useIntlLocale } from '../../i18n';
import { stateTone } from '../../invoices/state';
import { useInvoicesApi } from '../../invoices/useInvoicesApi';
import { countryName, formatDate, formatMoney } from '../../lib/format';
import { useMoney } from '../../lib/useMoney';
import { whatsappLink } from '../../lib/whatsapp';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import { quoteTone } from '../../quotes/tone';
import { useQuotesApi } from '../../quotes/useQuotesApi';
import { invoiceErrorMessage } from '../../invoices/errors';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { useToast } from '../../ui/toastContext';
import { Card, ErrorState, PageHeader, Pill, SkeletonRows } from '../../ui/Kit';
import ContactDialog from '../ContactDialog';
import ShareAccountDialog from '../ShareAccountDialog';
import { useContactsApi } from '../useContactsApi';

const RECENT = 8;

/** A short list of a contact's recent documents, with a link to see them all */
function Recent({ title, icon, empty, children, more }: { title: string; icon: ReactNode; empty: string; children: ReactNode[] | null; more?: ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <h2 className="flex items-center gap-2 border-b border-ink-100 px-5 py-3 text-sm font-semibold dark:border-ink-800">
        {icon}
        {title}
      </h2>
      {children === null ? <SkeletonRows rows={3} /> : children.length ? <ul className="divide-y divide-ink-100 dark:divide-ink-800">{children}</ul> : <p className="px-5 py-4 text-sm text-ink-500">{empty}</p>}
      {more && <div className="border-t border-ink-100 px-5 py-2.5 text-sm dark:border-ink-800">{more}</div>}
    </Card>
  );
}

/** One customer or vendor: details, what's owed either way, and their recent invoices, quotes and bills */
export default function ContactPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const locale = useIntlLocale();
  const money = useMoney();
  const session = useSession();
  const navigate = useNavigate();
  const api = useContactsApi();
  const invoicesApi = useInvoicesApi();
  const quotesApi = useQuotesApi();
  const billsApi = useBillsApi();
  const [editing, setEditing] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [sharing, setSharing] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const can = (p: Parameters<typeof session.permissions.has>[0]) => session.permissions.has(p);
  const key = ['contacts', session.organizationId, 'one', id] as const;
  const query = useQuery({ queryKey: key, queryFn: () => api!.get(id!), enabled: !!api && !!id });
  const c = query.data;
  const role = session.role ?? session.customRoleName;
  const invoices = useQuery({ queryKey: ['invoices', session.organizationId, role, 'contact', id], queryFn: () => invoicesApi!.list({ contactId: id, page: 1, pageSize: RECENT }), enabled: !!invoicesApi && !!c?.isCustomer && can('invoices.view') });
  const quotes = useQuery({ queryKey: ['quotes', session.organizationId, role, 'contact', id], queryFn: () => quotesApi!.list({ contactId: id, page: 1, pageSize: RECENT }), enabled: !!quotesApi && !!c?.isCustomer && can('invoices.view') });
  const overdue = useQuery({ queryKey: ['invoices', session.organizationId, role, 'contact', id, 'overdue'], queryFn: () => invoicesApi!.list({ contactId: id, state: 'overdue', page: 1, pageSize: 50 }), enabled: !!invoicesApi && !!c?.isCustomer && can('invoices.manage') });
  const remind = useMutation({
    mutationFn: () => invoicesApi!.remindOverdue(id!),
    onSuccess: (r) => {
      setReminding(false);
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      toast(t(session.mode === 'demo' ? 'contacts.page.remindedDemo' : 'contacts.page.reminded', { count: r.sent, email: r.sentTo }), r.failed.length ? 'error' : 'success');
    },
    onError: (e) => {
      setReminding(false);
      toast(invoiceErrorMessage(e, t), 'error');
    },
  });
  const bills = useQuery({ queryKey: ['bills', session.organizationId, role, 'contact', id], queryFn: () => billsApi!.list({ contactId: id, page: 1, pageSize: RECENT }), enabled: !!billsApi && !!c?.isVendor && can('bills.view') });
  const day = (d: string) => formatDate(`${d}T00:00:00Z`, locale);
  /** The customer's overdue invoices as a WhatsApp message, with the total when they're all in one currency */
  const overdueMessage = (items: { number: string | null; balance: number; currency: string | null; dueDate: string }[]) => {
    const list = items.map((i) => `• ${i.number} · ${amount(i.balance, i.currency)} · ${t('contacts.page.dueOn', { date: day(i.dueDate) })}`).join('\n');
    const one = new Set(items.map((i) => i.currency)).size === 1;
    return one
      ? t('contacts.page.whatsappOverdue', { name: c!.name, organization: session.organization, list, total: amount(items.reduce((x, i) => x + i.balance, 0), items[0]!.currency) })
      : t('contacts.page.whatsappOverdueMixed', { name: c!.name, organization: session.organization, list });
  };
  const amount = (minor: number, currency: string | null) => (currency ? formatMoney(minor, currency, locale) : money.format(minor));

  if (query.isError)
    return (
      <Card>
        <ErrorState onRetry={() => void query.refetch()} />
      </Card>
    );
  if (!c)
    return (
      <Card>
        <SkeletonRows rows={6} />
      </Card>
    );
  const address = [c.billingAddress.line1, c.billingAddress.line2, c.billingAddress.city, c.billingAddress.region, c.billingAddress.postalCode, c.billingAddress.country ? countryName(c.billingAddress.country, locale) : null].filter(Boolean).join(', ');
  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <Link to="/contacts" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800 dark:hover:text-ink-200">
          <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden /> {t('contacts.title')}
        </Link>
        <PageHeader
          title={c.name}
          description={[c.legalName, c.email, c.phone].filter(Boolean).join(' · ') || undefined}
          actions={
            <>
              {c.isCustomer && <Pill tone="brand">{t('contacts.customer')}</Pill>}
              {c.isVendor && <Pill>{t('contacts.vendor')}</Pill>}
              {c.isCustomer && can('invoices.manage') && !!overdue.data?.total && (
                <Button variant="secondary" icon={<BellRing className="size-4" />} onClick={() => setReminding(true)}>
                  {t('contacts.page.remindOverdue', { count: overdue.data.total })}
                </Button>
              )}
              {c.isCustomer && can('invoices.manage') && !!overdue.data?.items.length && (
                <a
                  href={whatsappLink(overdueMessage(overdue.data.items), c.whatsapp ?? c.phone)}
                  target="_blank"
                  rel="noopener noreferrer"
                  // Noted as chased, for the Collections list
                  onClick={() => void api?.chased(c.id, 'whatsapp').then(() => qc.invalidateQueries({ queryKey: ['contacts'] }), () => {})}
                  // Secondary, like the email reminder: the page keeps one primary action
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-ink-200 bg-white px-4 text-sm font-semibold text-ink-800 hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100 dark:hover:bg-ink-800"
                >
                  <MessageCircle className="size-4 text-[#137a3c] dark:text-[#3ccf7a]" aria-hidden /> {t('contacts.page.whatsappRemind')}
                </a>
              )}
              {c.isCustomer && can('invoices.manage') && (
                <Button variant="secondary" icon={<Share2 className="size-4" />} onClick={() => setSharing(true)}>
                  {c.share?.views ? t('contacts.account.actionOpened', { count: c.share.views }) : t('contacts.account.action')}
                </Button>
              )}
              {can('contacts.manage') && (
                <Button variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                  {t('contacts.edit')}
                </Button>
              )}
              {c.isCustomer && can('invoices.manage') && (
                <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => navigate(`/quotes/new?contact=${c.id}`)}>
                  {t('quotes.new')}
                </Button>
              )}
              {c.isCustomer && can('invoices.manage') && (
                <Button icon={<Plus className="size-4" />} onClick={() => navigate(`/invoices/new?contact=${c.id}`)}>
                  {t('invoices.new')}
                </Button>
              )}
            </>
          }
        />
      </motion.div>
      <motion.div variants={fadeUp} className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4 sm:col-span-1">
          <dl className="space-y-2 text-sm">
            {c.taxId && (
              <div>
                <dt className="text-xs text-ink-500">{t('contacts.fields.taxId')}</dt>
                <dd className="font-mono" dir="ltr">
                  {c.taxId}
                </dd>
              </div>
            )}
            {address && (
              <div>
                <dt className="text-xs text-ink-500">{t('contacts.page.address')}</dt>
                <dd dir="auto">{address}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-ink-500">{t('contacts.page.terms')}</dt>
              <dd>{c.paymentTermsDays ? t('contacts.terms', { days: c.paymentTermsDays }) : t('contacts.onReceipt')}</dd>
            </div>
          </dl>
        </Card>
        {c.isCustomer && c.receivable !== undefined && (
          <Card className="p-4">
            <p className="text-xs text-ink-500">{t('contacts.page.owedToUs')}</p>
            <p className="mt-1 font-mono text-xl font-semibold tabular-nums" dir="ltr">
              {amount(c.receivable, c.currency)}
            </p>
            {c.creditLimit != null && (
              <p className={`mt-1 text-xs ${c.receivable > c.creditLimit ? 'text-expense' : 'text-ink-500'}`}>
                {t('contacts.page.limit', { limit: amount(c.creditLimit, c.currency), used: c.creditLimit ? Math.round((Math.max(0, c.receivable) / c.creditLimit) * 100) : 100 })}
              </p>
            )}
            {can('reports.view') && (
              <Link to={`/reports?tab=statement&contact=${c.id}`} className="mt-2 inline-block text-sm text-brand-700 hover:underline dark:text-brand-300">
                {t('contacts.customerStatement')}
              </Link>
            )}
          </Card>
        )}
        {c.isVendor && c.payable !== undefined && (
          <Card className="p-4">
            <p className="text-xs text-ink-500">{t('contacts.page.weOwe')}</p>
            <p className="mt-1 font-mono text-xl font-semibold tabular-nums" dir="ltr">
              {amount(c.payable, c.currency)}
            </p>
            {can('reports.view') && (
              <Link to={`/reports?tab=statement&side=payables&contact=${c.id}`} className="mt-2 inline-block text-sm text-brand-700 hover:underline dark:text-brand-300">
                {t('contacts.vendorStatement')}
              </Link>
            )}
          </Card>
        )}
      </motion.div>
      <motion.div variants={fadeUp} className="grid gap-4 lg:grid-cols-2">
        {c.isCustomer && can('invoices.view') && (
          <Recent
            title={t('invoices.title')}
            icon={<FileText className="size-4 text-ink-400" />}
            empty={t('contacts.page.noInvoices')}
            more={invoices.data && invoices.data.total > RECENT ? <span className="text-ink-500">{t('contacts.page.more', { count: invoices.data.total - RECENT })}</span> : undefined}
          >
            {invoices.data
              ? invoices.data.items.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <Link to={`/invoices/${i.id}`} className="font-mono font-semibold text-brand-700 hover:underline dark:text-brand-300" dir="ltr">
                      {i.number ?? t('invoices.draft')}
                    </Link>
                    <span className="text-ink-500">{day(i.issueDate)}</span>
                    <span className={`ms-auto font-medium ${stateTone(i.state)}`}>{t(`invoices.states.${i.state}`)}</span>
                    <span className="w-32 text-end font-mono tabular-nums" dir="ltr">
                      {amount(i.total, i.currency)}
                    </span>
                  </li>
                ))
              : null}
          </Recent>
        )}
        {c.isCustomer && can('invoices.view') && (
          <Recent title={t('quotes.title')} icon={<FileSignature className="size-4 text-ink-400" />} empty={t('contacts.page.noQuotes')}>
            {quotes.data
              ? quotes.data.items.map((q) => (
                  <li key={q.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <Link to={`/quotes/${q.id}`} className="font-mono font-semibold text-brand-700 hover:underline dark:text-brand-300" dir="ltr">
                      {q.number}
                    </Link>
                    <span className="text-ink-500">{day(q.quoteDate)}</span>
                    <span className={`ms-auto font-medium ${quoteTone(q.state)}`}>{t(`quotes.states.${q.state}`)}</span>
                    <span className="w-32 text-end font-mono tabular-nums" dir="ltr">
                      {amount(q.total, q.currency)}
                    </span>
                  </li>
                ))
              : null}
          </Recent>
        )}
        {c.isVendor && can('bills.view') && (
          <Recent title={t('bills.title')} icon={<Receipt className="size-4 text-ink-400" />} empty={t('contacts.page.noBills')}>
            {bills.data
              ? bills.data.items.map((b) => (
                  <li key={b.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <Link to={`/bills/${b.id}`} className="font-mono font-semibold text-brand-700 hover:underline dark:text-brand-300" dir="ltr">
                      {b.number ?? t('invoices.draft')}
                    </Link>
                    <span className="text-ink-500">{day(b.billDate)}</span>
                    <span className="ms-auto w-32 text-end font-mono tabular-nums" dir="ltr">
                      {amount(b.total, b.currency)}
                    </span>
                  </li>
                ))
              : null}
          </Recent>
        )}
      </motion.div>
      {sharing && api && <ShareAccountDialog api={api} contact={c} onClose={() => setSharing(false)} />}
      <ConfirmDialog open={reminding} title={t('contacts.page.remindTitle', { name: c.name })} body={c.email ? t('contacts.page.remindBody', { count: overdue.data?.total ?? 0, email: c.email }) : t('contacts.page.remindNoEmail')} confirmLabel={t('contacts.page.remindConfirm')} busy={remind.isPending} onConfirm={() => remind.mutate()} onClose={() => setReminding(false)} />
      {editing && api && <ContactDialog api={api} contact={c} onClose={() => setEditing(false)} onSaved={() => (setEditing(false), void query.refetch())} />}
    </motion.div>
  );
}
