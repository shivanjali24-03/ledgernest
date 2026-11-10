import { useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { currencyDigits, type AccountStatementLine, type AgingSide } from '@ledgernest/shared';
import { FileText, Mail, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useContactsApi } from '../contacts/useContactsApi';
import { useIntlLocale } from '../i18n';
import { formatDate } from '../lib/format';
import { useSession } from '../layout/session';
import { apiErrorMessage } from '../platform/errors';
import Button from '../ui/Button';
import { SelectField, TextField } from '../ui/Field';
import { Card, EmptyState, ErrorState, Segmented, SkeletonRows } from '../ui/Kit';
import { useToast } from '../ui/toastContext';
import EmailStatementDialog from './EmailStatementDialog';
import type { ReportsApi } from './types';

const th = 'px-4 py-2.5 font-semibold';

/**
 * A contact's statement of account: balance brought forward, each invoice, credit note, bill, payment and void with
 * a running balance, and the balance carried down, one table per currency. Downloads as PDF here; CSV and Excel
 * come from the page's own buttons.
 */
export default function ContactStatementPanel({ api, side, contactId, from, to, set, onSave }: { api: ReportsApi; side: AgingSide; contactId: string; from: string; to: string; set: (patch: Record<string, string | null>) => void; onSave: (f: { blob: Blob; filename: string }) => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const session = useSession();
  const toast = useToast();
  const contactsApi = useContactsApi();
  const [emailing, setEmailing] = useState(false);
  const contacts = useQuery({
    queryKey: ['contacts', session.organizationId, 'statement', side],
    queryFn: () => contactsApi!.list({ type: side === 'receivables' ? 'customer' : 'vendor', page: 1, pageSize: 500 }),
    enabled: !!contactsApi && session.permissions.has('contacts.view'),
  });
  const valid = !!contactId && from <= to;
  const statement = useQuery({
    queryKey: ['reports', session.organizationId, session.role ?? session.customRoleName, 'statement', contactId, side, from, to],
    queryFn: () => api.statement(contactId, side, from, to),
    enabled: valid,
    placeholderData: keepPreviousData,
  });
  const pdf = useMutation({
    mutationFn: () => api.exportStatement(contactId, side, from, to, 'pdf'),
    onSuccess: (f) => {
      onSave(f);
      toast(t('audit.exported', { file: f.filename }));
    },
    onError: (e) => toast(apiErrorMessage(e, t), 'error'),
  });
  const day = (d: string) => formatDate(`${d}T00:00:00Z`, locale);
  const fmt = (minor: number, currency: string, blank = false) => {
    if (blank && minor === 0) return '';
    const digits = currencyDigits(currency);
    return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(minor / 10 ** digits);
  };
  const kindLabel = (l: AccountStatementLine) => (l.voided ? t('reports.statement.voided', { kind: t(`reports.statement.kinds.${l.voided}`) }) : t(`reports.statement.kinds.${l.kind}`));
  const docLink = (l: AccountStatementLine) => {
    const kind = l.voided ?? l.kind;
    return kind === 'invoice' ? `/invoices/${l.documentId}` : kind === 'bill' ? `/bills/${l.documentId}` : null;
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 print:hidden sm:grid-cols-[auto_minmax(0,1fr)_11rem_11rem] sm:items-end">
        <Segmented<AgingSide>
          label={t('reports.aging.side')}
          value={side}
          onChange={(v) => set({ side: v === 'receivables' ? null : v, contact: null })}
          options={[
            { value: 'receivables', label: t('reports.statement.customers') },
            { value: 'payables', label: t('reports.statement.vendors') },
          ]}
        />
        <SelectField
          label={t('reports.statement.contact')}
          value={contactId}
          onChange={(e) => set({ contact: e.target.value || null })}
          options={[{ value: '', label: t('reports.statement.pickContact') }, ...(contacts.data?.items ?? []).map((c) => ({ value: c.id, label: c.name }))]}
        />
        <TextField label={t('reports.from')} type="date" value={from} onChange={(e) => e.target.value && set({ from: e.target.value })} />
        <TextField label={t('reports.to')} type="date" value={to} min={from} onChange={(e) => e.target.value && set({ to: e.target.value })} error={from > to ? t('audit.filters.badRange') : undefined} />
      </div>
      {!contactId ? (
        <Card>
          <EmptyState icon={<Users className="size-5" />} title={t('reports.statement.pickContact')} body={t('reports.statement.hint')} />
        </Card>
      ) : statement.isPending ? (
        <Card>
          <SkeletonRows rows={6} />
        </Card>
      ) : statement.isError ? (
        <Card>
          <ErrorState onRetry={() => void statement.refetch()} />
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink-500">
              <span className="font-semibold text-ink-900 dark:text-white" dir="auto">
                {statement.data.contact.name}
              </span>
              {' · '}
              {t('reports.printRange', { from: day(from), to: day(to) })}
            </p>
            {session.permissions.has('reports.export') && (
              <div className="flex gap-2 print:hidden">
                <Button variant="secondary" size="sm" icon={<Mail className="size-4" />} onClick={() => setEmailing(true)}>
                  {t('reports.statement.email')}
                </Button>
                <Button variant="secondary" size="sm" icon={<FileText className="size-4" />} loading={pdf.isPending} onClick={() => pdf.mutate()}>
                  {t('reports.statement.pdf')}
                </Button>
              </div>
            )}
          </div>
          {statement.data.sections.length === 0 ? (
            <Card>
              <EmptyState icon={<FileText className="size-5" />} title={t('reports.statement.empty')} />
            </Card>
          ) : (
            statement.data.sections.map((sec) => (
              <Card key={sec.currency} className="overflow-hidden">
                <div className="relative overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <caption className="px-4 pt-3 text-start text-xs font-semibold uppercase tracking-wide text-ink-500">{t('reports.statement.inCurrency', { currency: sec.currency })}</caption>
                    <thead className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-800">
                      <tr>
                        <th scope="col" className={`${th} text-start`}>
                          {t('reports.statement.columns.date')}
                        </th>
                        <th scope="col" className={`${th} text-start`}>
                          {t('reports.statement.columns.type')}
                        </th>
                        <th scope="col" className={`${th} text-start`}>
                          {t('reports.statement.columns.number')}
                        </th>
                        <th scope="col" className={`${th} text-end`}>
                          {t('reports.statement.columns.debit')}
                        </th>
                        <th scope="col" className={`${th} text-end`}>
                          {t('reports.statement.columns.credit')}
                        </th>
                        <th scope="col" className={`${th} text-end`}>
                          {t('reports.balance')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                      <tr className="bg-ink-50/70 font-medium dark:bg-ink-950/30">
                        <td className="px-4 py-2" colSpan={5}>
                          {t('reports.statement.broughtForward', { date: day(from) })}
                        </td>
                        <td className="px-4 py-2 text-end font-mono tabular-nums" dir="ltr">
                          {fmt(sec.opening, sec.currency)}
                        </td>
                      </tr>
                      {sec.lines.map((l, i) => {
                        const href = docLink(l);
                        return (
                          <tr key={`${l.documentId}-${l.kind}-${i}`}>
                            <td className="whitespace-nowrap px-4 py-2 text-ink-600 dark:text-ink-300">{day(l.date)}</td>
                            <td className="px-4 py-2">{kindLabel(l)}</td>
                            <td className="px-4 py-2">
                              {href ? (
                                <Link to={href} className="font-mono text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300" dir="ltr">
                                  {l.number}
                                </Link>
                              ) : (
                                <span className="font-mono text-xs" dir="ltr">
                                  {l.number}
                                </span>
                              )}
                              {l.reference && (
                                <span className="block text-xs text-ink-400" dir="auto">
                                  {l.reference}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-end font-mono tabular-nums" dir="ltr">
                              {fmt(l.debit, sec.currency, true)}
                            </td>
                            <td className="px-4 py-2 text-end font-mono tabular-nums" dir="ltr">
                              {fmt(l.credit, sec.currency, true)}
                            </td>
                            <td className="px-4 py-2 text-end font-mono tabular-nums" dir="ltr">
                              {fmt(l.balance, sec.currency)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="border-t-2 border-ink-200 font-semibold dark:border-ink-700">
                      <tr>
                        <td className="px-4 py-2.5" colSpan={3}>
                          {t('reports.statement.carriedDown', { date: day(to) })}
                        </td>
                        <td className="px-4 py-2.5 text-end font-mono tabular-nums" dir="ltr">
                          {fmt(sec.debits, sec.currency)}
                        </td>
                        <td className="px-4 py-2.5 text-end font-mono tabular-nums" dir="ltr">
                          {fmt(sec.credits, sec.currency)}
                        </td>
                        <td className="px-4 py-2.5 text-end font-mono tabular-nums" dir="ltr">
                          {fmt(sec.closing, sec.currency)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </Card>
            ))
          )}
        </>
      )}
      {emailing && statement.data && <EmailStatementDialog api={api} contact={statement.data.contact} side={side} from={from} to={to} onClose={() => setEmailing(false)} />}
    </div>
  );
}
