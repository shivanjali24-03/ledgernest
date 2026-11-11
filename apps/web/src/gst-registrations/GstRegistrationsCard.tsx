import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Landmark, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../auth/client';
import { useSession } from '../layout/session';
import Button from '../ui/Button';
import { TextField } from '../ui/Field';
import { Card, Pill } from '../ui/Kit';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import { useGstRegistrationsApi } from './api';

const REASONS = ['gstin_is_organisation', 'gstin_other_pan', 'gstin_taken', 'no_primary_gstin'];

/** The business's GSTINs in other states: each document says which it's under, and files with it */
export default function GstRegistrationsCard() {
  const { t } = useTranslation();
  const toast = useToast();
  const session = useSession();
  const queryClient = useQueryClient();
  const api = useGstRegistrationsApi();
  const canManage = session.permissions.has('taxes.manage');
  const key = ['gst-registrations', session.organizationId];
  const q = useQuery({ queryKey: key, queryFn: () => api!.list(), enabled: !!api });
  const [adding, setAdding] = useState(false);
  const [gstin, setGstin] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const fail = (e: unknown) => {
    const reason = e instanceof ApiError ? e.details?.reason : undefined;
    toast(typeof reason === 'string' && REASONS.includes(reason) ? t(`gstRegistrations.errors.${reason}`) : t('gstRegistrations.errors.failed'), 'error');
  };
  const add = useMutation({
    mutationFn: () => api!.create({ gstin, tradeName: tradeName || null, address: city || postalCode ? { city: city || null, postalCode: postalCode || null } : null }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: key });
      toast(t('gstRegistrations.added', { gstin: r.gstin }));
      setAdding(false);
      setGstin('');
    },
    onError: fail,
  });
  const archive = useMutation({
    mutationFn: (id: string) => api!.archive(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
    onError: fail,
  });
  if (!q.data?.primary) return null;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 px-5 py-3 dark:border-ink-800">
        <Landmark className="size-5 text-ink-400" aria-hidden />
        <div className="min-w-0 flex-1 basis-56">
          <h2 className="font-semibold">{t('gstRegistrations.title')}</h2>
          <p className="text-sm text-ink-500">{t('gstRegistrations.hint')}</p>
        </div>
        {canManage && (
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
            {t('gstRegistrations.add')}
          </Button>
        )}
      </div>
      <ul className="divide-y divide-ink-100 dark:divide-ink-800">
        <li className="flex items-center gap-3 px-5 py-3">
          <span className="font-mono" dir="ltr">
            {q.data.primary.gstin}
          </span>
          <Pill tone="brand">{t('gstRegistrations.own')}</Pill>
        </li>
        {q.data.registrations.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <span className="font-mono" dir="ltr">
              {r.gstin}
            </span>
            <span className="text-sm text-ink-500">
              {r.state}
              {r.tradeName && ` · ${r.tradeName}`}
            </span>
            {r.archived ? (
              <Pill tone="neutral">{t('gstRegistrations.archived')}</Pill>
            ) : (
              canManage && (
                <Button size="sm" variant="ghost" className="ms-auto" icon={<Archive className="size-4" />} onClick={() => archive.mutate(r.id)}>
                  {t('gstRegistrations.archive')}
                </Button>
              )
            )}
          </li>
        ))}
      </ul>
      {adding && (
        <Modal
          open
          onClose={() => setAdding(false)}
          title={t('gstRegistrations.addTitle')}
          description={t('gstRegistrations.addBody')}
          footer={
            <>
              <Button variant="ghost" onClick={() => setAdding(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" form="gst-registration-form" loading={add.isPending} disabled={gstin.trim().length !== 15}>
                {t('gstRegistrations.save')}
              </Button>
            </>
          }
        >
          <form id="gst-registration-form" onSubmit={(e: FormEvent) => (e.preventDefault(), add.mutate())} noValidate className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <TextField label="GSTIN" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase().replace(/\s/g, ''))} maxLength={15} dir="ltr" className="font-mono uppercase" data-autofocus />
            </div>
            <div className="sm:col-span-2">
              <TextField label={t('gstRegistrations.fields.tradeName')} value={tradeName} onChange={(e) => setTradeName(e.target.value)} dir="auto" />
            </div>
            <TextField label={t('gstRegistrations.fields.city')} value={city} onChange={(e) => setCity(e.target.value)} dir="auto" />
            <TextField label={t('gstRegistrations.fields.postalCode')} value={postalCode} onChange={(e) => setPostalCode(e.target.value)} inputMode="numeric" dir="ltr" />
          </form>
        </Modal>
      )}
    </Card>
  );
}
