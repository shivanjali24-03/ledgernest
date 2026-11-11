import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../auth/client';
import Button from '../ui/Button';
import { SelectField, TextField } from '../ui/Field';
import { Card } from '../ui/Kit';
import { useToast } from '../ui/toastContext';
import type { TaxesApi, TaxRate } from './types';

/**
 * GST compensation cess on goods that still carry it (tobacco and pan masala, on top of GST at 28%): pick the GST
 * rate and the cess rate, and a group within the state and one between states are made.
 */
export default function CessCard({ api, rates, canManage }: { api: TaxesApi; rates: TaxRate[]; canManage: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const gstRates = [...new Set(rates.filter((r) => r.kind === 'igst' && !r.archived).map((r) => r.ratePpm))].sort((a, b) => b - a);
  const [gst, setGst] = useState(String(gstRates.find((x) => x === 280_000) ?? gstRates[0] ?? ''));
  const [cess, setCess] = useState('');
  const add = useMutation({
    mutationFn: () => api.addCess({ gstRatePpm: Number(gst), cessRatePpm: Math.round(Number(cess) * 10_000) }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['taxes'] });
      toast(r.created.groups.length ? t('taxes.cess.added', { groups: r.created.groups.join(', ') }) : t('taxes.cess.already'));
      setCess('');
    },
    onError: (e) => toast(e instanceof ApiError && e.details?.reason === 'gst_not_set_up' ? t('taxes.cess.gstFirst') : t('taxes.cess.failed'), 'error'),
  });
  if (!gstRates.length || !canManage) return null;
  return (
    <Card className="p-5">
      <h2 className="font-semibold">{t('taxes.cess.title')}</h2>
      <p className="mt-1 text-sm text-ink-500">{t('taxes.cess.body')}</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="w-40">
          <SelectField label={t('taxes.cess.gstRate')} value={gst} onChange={(e) => setGst(e.target.value)} options={gstRates.map((r) => ({ value: String(r), label: `${r / 10_000}%` }))} />
        </div>
        <div className="w-32">
          <TextField label={t('taxes.cess.cessRate')} value={cess} onChange={(e) => setCess(e.target.value)} inputMode="decimal" dir="ltr" className="text-end font-mono" placeholder="12" />
        </div>
        <Button variant="secondary" loading={add.isPending} disabled={!(Number(cess) > 0)} onClick={() => add.mutate()}>
          {t('taxes.cess.add')}
        </Button>
      </div>
    </Card>
  );
}
