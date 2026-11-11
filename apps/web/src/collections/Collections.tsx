import { useMemo } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Mail, MessageCircle } from 'lucide-react';
import { todayIn } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { useContactsApi } from '../contacts/useContactsApi';
import { useInvoicesApi } from '../invoices/useInvoicesApi';
import { useIntlLocale } from '../i18n';
import { formatRelative } from '../lib/format';
import { useMoney } from '../lib/useMoney';
import { whatsappLink } from '../lib/whatsapp';
import { useSession } from '../layout/session';
import { fadeUp, stagger } from '../motion/tokens';
import { apiErrorMessage } from '../platform/errors';
import { useReportsApi } from '../reports/useReportsApi';
import { useOrganizationSettings } from '../settings/useOrganizationSettings';
import Button from '../ui/Button';
import { Card, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui/Kit';
import { useToast } from '../ui/toastContext';

const accountUrl = (token: string) => new URL(`c/${token}`, `${window.location.origin}${import.meta.env.BASE_URL}`).toString();

/**
 * Who to chase today: every customer with something overdue, the most first, with how late, when they were last
 * chased and whether they opened their link. One tap sends a WhatsApp message with their account link (every invoice,
 * one UPI code for the lot), or emails a reminder for each overdue invoice.
 */
export default function Collections() {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  const session = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const reports = useReportsApi();
  const contactsApi = useContactsApi();
  const invoicesApi = useInvoicesApi();
  const settings = useOrganizationSettings().data;
  const canChase = session.permissions.has('invoices.manage');
  const today = todayIn(settings?.timeZone ?? 'Asia/Kolkata');
  const key = ['reports', session.organizationId, 'collections', today];
  const aging = useQuery({ queryKey: key, queryFn: () => reports!.aging('receivables', today), enabled: !!reports });
  const customers = useQuery({ queryKey: ['contacts', session.organizationId, 'collections'], queryFn: () => contactsApi!.list({ type: 'customer', page: 1, pageSize: 100 }), enabled: !!contactsApi });
  const rows = useMemo(() => {
    const byId = new Map((customers.data?.items ?? []).map((c) => [c.id, c]));
    return (aging.data?.contacts ?? [])
      .map((a) => {
        const late = a.documents.filter((d) => d.daysOverdue > 0);
        return { a, contact: byId.get(a.contact.id), overdue: late.reduce((s, d) => s + d.outstanding, 0), count: late.length, oldest: Math.max(0, ...late.map((d) => d.daysOverdue)) };
      })
      .filter((r) => r.overdue > 0)
      .sort((x, y) => y.overdue - x.overdue);
  }, [aging.data, customers.data]);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['contacts'] });
    void queryClient.invalidateQueries({ queryKey: key });
  };
  const whatsapp = useMutation({
    mutationFn: async (r: (typeof rows)[number]) => {
      // Open the window first (inside the click), then fill in the address once the link is made
      const win = window.open('', '_blank');
      const share = await contactsApi!.share(r.a.contact.id);
      const amount = money.format(r.overdue);
      const message = t('collections.message', { name: r.a.contact.name, organization: session.organization, amount, count: r.count, days: r.oldest, link: accountUrl(share.token) });
      const url = whatsappLink(message, r.contact?.whatsapp ?? r.contact?.phone);
      if (win) win.location.href = url;
      else window.open(url, '_blank');
      await contactsApi!.chased(r.a.contact.id, 'whatsapp');
    },
    onSuccess: refresh,
    onError: (e) => toast(apiErrorMessage(e, t), 'error'),
  });
  const email = useMutation({
    mutationFn: (contactId: string) => invoicesApi!.remindOverdue(contactId),
    onSuccess: (r) => {
      refresh();
      toast(t('collections.emailed', { count: r.sent, email: r.sentTo }));
    },
    onError: (e) => toast(apiErrorMessage(e, t), 'error'),
  });
  const total = rows.reduce((s, r) => s + r.overdue, 0);
  // Interest on late payment, when any customer's invoices carry it
  const withInterest = rows.some((r) => !!r.a.interest);
  const raiseAll = useMutation({
    mutationFn: () => invoicesApi!.raiseAllInterest(),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast(t('collections.interestRaised', { count: r.raised.length }));
    },
    onError: (e) => toast(apiErrorMessage(e, t), 'error'),
  });
  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <PageHeader
          eyebrow={<span dir="auto">{session.organization}</span>}
          title={t('collections.title')}
          description={rows.length ? t('collections.summary', { count: rows.length, amount: money.format(total) }) : t('collections.description')}
          actions={
            withInterest && canChase && invoicesApi ? (
              <Button variant="secondary" loading={raiseAll.isPending} onClick={() => raiseAll.mutate()}>
                {t('collections.raiseInterest')}
              </Button>
            ) : undefined
          }
        />
      </motion.div>
      <motion.div variants={fadeUp}>
        <Card className="relative overflow-x-auto">
          {aging.isError ? (
            <ErrorState onRetry={() => void aging.refetch()} />
          ) : !aging.data || !customers.data ? (
            <SkeletonRows rows={5} />
          ) : !rows.length ? (
            <EmptyState icon={<CheckCircle2 className="size-5" />} title={t('collections.emptyTitle')} body={t('collections.emptyBody')} />
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">{t('collections.title')}</caption>
              <thead className="text-xs uppercase tracking-wide text-ink-400">
                <tr>
                  <th scope="col" className="px-4 py-2 text-start font-semibold">{t('collections.cols.customer')}</th>
                  <th scope="col" className="px-4 py-2 text-end font-semibold">{t('collections.cols.overdue')}</th>
                  {withInterest && <th scope="col" className="px-4 py-2 text-end font-semibold">{t('collections.cols.interest')}</th>}
                  <th scope="col" className="px-4 py-2 text-start font-semibold">{t('collections.cols.chased')}</th>
                  <th scope="col" className="px-4 py-2 font-semibold"><span className="sr-only">{t('collections.cols.actions')}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {rows.map((r) => (
                  <tr key={r.a.contact.id}>
                    <th scope="row" className="px-4 py-2.5 text-start font-normal">
                      <Link to={`/contacts/${r.a.contact.id}`} className="font-medium hover:underline">
                        {r.a.contact.name}
                      </Link>
                      <span className="block text-xs text-ink-500">{t('collections.invoices', { count: r.count, days: r.oldest })}</span>
                    </th>
                    <td className="px-4 py-2.5 text-end font-mono font-semibold tabular-nums text-expense" dir="ltr">{money.format(r.overdue)}</td>
                    {withInterest && (
                      <td className="px-4 py-2.5 text-end font-mono tabular-nums text-ink-600 dark:text-ink-300" dir="ltr">
                        {r.a.interest ? money.format(r.a.interest) : '–'}
                      </td>
                    )}
                    <td className="px-4 py-2.5 text-xs text-ink-500">
                      {r.contact?.lastChasedAt ? t('collections.chasedAgo', { when: formatRelative(r.contact.lastChasedAt, locale) }) : t('collections.notChased')}
                      {!!r.contact?.share?.views && <span className="block">{t('collections.opened', { count: r.contact.share.views })}</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {canChase && (
                        <span className="flex justify-end gap-2">
                          <Button variant="secondary" size="sm" icon={<MessageCircle className="size-4 text-[#1fa855]" />} loading={whatsapp.isPending && whatsapp.variables?.a.contact.id === r.a.contact.id} onClick={() => whatsapp.mutate(r)} aria-label={t('collections.whatsapp', { name: r.a.contact.name })}>
                            WhatsApp
                          </Button>
                          {r.contact?.email && (
                            <Button variant="ghost" size="sm" icon={<Mail className="size-4" />} loading={email.isPending && email.variables === r.a.contact.id} onClick={() => email.mutate(r.a.contact.id)} aria-label={t('collections.email', { name: r.a.contact.name })}>
                              {t('collections.emailShort')}
                            </Button>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </motion.div>
    </motion.div>
  );
}
