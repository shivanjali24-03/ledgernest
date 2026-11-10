import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../auth/client';
import { useAuth } from '../auth/context';
import { useSession } from '../layout/session';
import { apiErrorMessage } from '../platform/errors';
import Button from '../ui/Button';
import { TextField } from '../ui/Field';
import { Card } from '../ui/Kit';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import type { SettingsApi } from './types';

/** For Owners: delete the organisation and all its books, after typing its name. A backup first is the advice. */
export default function DeleteOrganizationCard({ api }: { api: SettingsApi }) {
  const { t } = useTranslation();
  const session = useSession();
  const auth = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const remove = useMutation({
    mutationFn: () => api.remove(name),
    onSuccess: async () => {
      toast(t('settings.delete.done', { name: session.organization }));
      await auth.reload();
      navigate('/');
    },
  });
  const mismatch = remove.error instanceof ApiError && remove.error.details?.reason === 'name_mismatch';
  return (
    <Card className="border-expense/40 p-5">
      <h2 className="flex items-center gap-2 font-semibold text-expense">
        <AlertTriangle className="size-5" aria-hidden /> {t('settings.delete.title')}
      </h2>
      <p className="mt-1 text-sm text-ink-600 dark:text-ink-300">{t('settings.delete.body')}</p>
      <Button variant="danger" className="mt-3" onClick={() => setOpen(true)}>
        {t('settings.delete.action')}
      </Button>
      {open && (
        <Modal
          open
          onClose={() => setOpen(false)}
          title={t('settings.delete.confirmTitle', { name: session.organization })}
          description={t('settings.delete.confirmBody')}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button variant="danger" loading={remove.isPending} disabled={name.trim() !== (session.organization ?? '').trim()} onClick={() => remove.mutate()}>
                {t('settings.delete.confirm')}
              </Button>
            </>
          }
        >
          <TextField label={t('settings.delete.typeName', { name: session.organization })} value={name} onChange={(e) => setName(e.target.value)} dir="auto" data-autofocus error={mismatch ? t('settings.delete.mismatch') : undefined} />
          {remove.isError && !mismatch && (
            <p role="alert" className="mt-2 text-sm text-expense">
              {apiErrorMessage(remove.error, t)}
            </p>
          )}
        </Modal>
      )}
    </Card>
  );
}
