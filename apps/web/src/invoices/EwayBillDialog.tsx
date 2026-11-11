import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { EWAY_MODES, ewayTransportSchema, type EwayMode, type EwayProblem } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../auth/client';
import { saveBlob } from '../lib/saveBlob';
import Button from '../ui/Button';
import { SelectField, TextField } from '../ui/Field';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import { invoiceErrorMessage } from './errors';
import type { Invoice, InvoicesApi } from './types';

/**
 * An issued invoice's goods as an e-way bill for the portal's bulk upload. The vehicle (or, off the road, the
 * transport document) is Part B: fill it now, or leave it for the portal. What the portal would refuse shows here.
 */
export default function EwayBillDialog({ invoice, api, onClose }: { invoice: Invoice; api: InvoicesApi; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [mode, setMode] = useState<EwayMode>('road');
  const [distance, setDistance] = useState('');
  // Prefilled from the invoice's dispatch details
  const [vehicleNo, setVehicle] = useState(invoice.dispatch?.vehicleNo ?? '');
  const [docNo, setDocNo] = useState('');
  const [docDate, setDocDate] = useState('');
  const [transporterId, setTransporterId] = useState('');
  const [transporterName, setTransporterName] = useState(invoice.dispatch?.dispatchedThrough ?? '');
  const [problems, setProblems] = useState<EwayProblem[] | null>(null);
  const transport = ewayTransportSchema.safeParse({ mode, distanceKm: distance.trim() ? Number(distance) : 0, vehicleNo: mode === 'road' ? vehicleNo : null, docNo: mode === 'road' ? null : docNo, docDate: mode === 'road' ? null : docDate, transporterId, transporterName });
  const bad = transport.success ? null : String(transport.error.issues[0]?.path[0] ?? '');
  const make = useMutation({
    mutationFn: () => api.ewayBill(invoice.id, transport.data!),
    onSuccess: (f) => {
      saveBlob(f);
      toast(t('invoices.eway.done'));
      onClose();
    },
    onError: (e) => (e instanceof ApiError && e.details?.reason === 'eway_incomplete' ? setProblems(e.details.problems as EwayProblem[]) : toast(invoiceErrorMessage(e, t), 'error')),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (bad) return toast(t(`invoices.eway.invalid.${bad}`), 'error');
    make.mutate();
  };
  const where = (p: EwayProblem): { text: string; to?: string } => {
    if ('party' in p) return { text: t(p.code === 'gstin' && p.party === 'buyer' ? 'invoices.eway.problems.gstin_buyer' : `invoices.einvoice.problems.${p.code}_${p.party}`), to: p.party === 'seller' ? '/settings' : `/contacts/${invoice.contact.id}` };
    if (p.code === 'hsn') {
      const line = invoice.lines[p.line - 1];
      return { text: t('invoices.einvoice.problems.hsn', { line: p.line, description: line?.description ?? '' }), to: line?.item ? '/items' : undefined };
    }
    if (p.code === 'no_goods' || p.code === 'transport_doc') return { text: t(`invoices.eway.problems.${p.code}`) };
    return { text: t(`invoices.einvoice.problems.${p.code}`) };
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t('invoices.eway.title', { number: invoice.number })}
      description={t('invoices.eway.body')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="eway-form" loading={make.isPending}>
            {t('invoices.eway.download')}
          </Button>
        </>
      }
    >
      <form id="eway-form" onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-2">
        <SelectField label={t('invoices.eway.fields.mode')} value={mode} onChange={(e) => setMode(e.target.value as EwayMode)} options={EWAY_MODES.map((m) => ({ value: m, label: t(`invoices.eway.modes.${m}`) }))} />
        <TextField label={t('invoices.eway.fields.distance')} hint={t('invoices.eway.fields.distanceHint')} value={distance} onChange={(e) => setDistance(e.target.value.replace(/\D/g, ''))} inputMode="numeric" dir="ltr" placeholder="0" error={bad === 'distanceKm' ? t('invoices.eway.invalid.distanceKm') : undefined} />
        {mode === 'road' ? (
          <TextField className="sm:col-span-2 font-mono uppercase" label={t('invoices.eway.fields.vehicle')} hint={t('invoices.eway.fields.vehicleHint')} value={vehicleNo} onChange={(e) => setVehicle(e.target.value)} placeholder="MH12AB1234" dir="ltr" error={bad === 'vehicleNo' ? t('invoices.eway.invalid.vehicleNo') : undefined} />
        ) : (
          <>
            <TextField label={t('invoices.eway.fields.docNo')} value={docNo} onChange={(e) => setDocNo(e.target.value)} dir="ltr" />
            <TextField label={t('invoices.eway.fields.docDate')} type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
          </>
        )}
        <TextField className="font-mono uppercase" label={t('invoices.eway.fields.transporterId')} value={transporterId} onChange={(e) => setTransporterId(e.target.value)} dir="ltr" error={bad === 'transporterId' ? t('invoices.eway.invalid.transporterId') : undefined} />
        <TextField label={t('invoices.eway.fields.transporterName')} value={transporterName} onChange={(e) => setTransporterName(e.target.value)} dir="auto" />
      </form>
      {problems && (
        <div className="mt-4 rounded-lg border border-warning/40 p-3" role="alert">
          <p className="text-sm font-medium">{t('invoices.eway.problemsTitle')}</p>
          <ul className="mt-1 divide-y divide-ink-100 text-sm dark:divide-ink-800">
            {problems.map((p, n) => {
              const w = where(p);
              return (
                <li key={n} className="flex items-start gap-2 py-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                  <span className="flex-1">{w.text}</span>
                  {w.to && (
                    <Link to={w.to} onClick={onClose} className="inline-flex shrink-0 items-center text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
                      {t('invoices.einvoice.fix')} <ChevronRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Modal>
  );
}
