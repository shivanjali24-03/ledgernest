import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Monitor, Smartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../i18n';
import { apiErrorMessage } from '../platform/errors';
import Button from '../ui/Button';
import { ErrorState, SkeletonRows } from '../ui/Kit';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import type { AuthClient } from './client';

/** Where you're signed in, with the device, address and when it was last used; sign any other one out */
export default function SessionsDialog({ client, onClose }: { client: AuthClient; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => client.sessions.list() });
  const revoke = useMutation({
    mutationFn: (id: string) => client.sessions.revoke(id),
    onSuccess: () => {
      toast(t('sessions.revoked'));
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (e) => toast(apiErrorMessage(e, t), 'error'),
  });
  const when = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  const device = (d: { browser: string | null; os: string | null }) => (d.browser && d.os ? t('sessions.on', { browser: d.browser, os: d.os }) : (d.browser ?? d.os ?? t('sessions.unknown')));
  return (
    <Modal
      open
      onClose={onClose}
      title={t('sessions.title')}
      description={t('sessions.body')}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      {sessions.isError ? (
        <ErrorState onRetry={() => void sessions.refetch()} />
      ) : !sessions.data ? (
        <SkeletonRows rows={3} />
      ) : (
        <ul aria-label={t('sessions.title')} className="divide-y divide-ink-100 text-sm dark:divide-ink-800">
          {sessions.data.map((s) => {
            const Icon = s.device.mobile ? Smartphone : Monitor;
            return (
              <li key={s.id} className="flex items-center gap-3 py-3">
                <Icon className="size-5 shrink-0 text-ink-400" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {device(s.device)}
                    {s.current && <span className="ms-2 rounded-md bg-income/10 px-1.5 py-0.5 text-[11px] font-semibold text-income">{t('sessions.thisDevice')}</span>}
                  </p>
                  <p className="text-xs text-ink-500">
                    {t('sessions.lastUsed', { when: when(s.lastUsedAt) })}
                    {s.ip && <span dir="ltr"> · {s.ip}</span>}
                  </p>
                </div>
                {!s.current && (
                  <Button variant="ghost" size="sm" loading={revoke.isPending && revoke.variables === s.id} onClick={() => revoke.mutate(s.id)}>
                    {t('sessions.signOut')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
