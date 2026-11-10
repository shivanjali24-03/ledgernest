import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { FileCode2 } from 'lucide-react';
import { fiscalYearOf, fiscalYearSpan, todayIn } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { saveBlob } from '../lib/saveBlob';
import { useReportsApi } from '../reports/useReportsApi';
import Button from '../ui/Button';
import { TextField } from '../ui/Field';
import { Card } from '../ui/Kit';
import { useToast } from '../ui/toastContext';
import { useOrganizationSettings } from './useOrganizationSettings';

/** For an accountant who works in Tally Prime: the ledgers, then the vouchers for some dates, as Tally XML */
export default function TallyCard() {
  const { t } = useTranslation();
  const toast = useToast();
  const api = useReportsApi();
  const settings = useOrganizationSettings().data;
  const today = todayIn(settings?.timeZone ?? 'Asia/Kolkata');
  const year = fiscalYearSpan(fiscalYearOf(today, settings?.fiscalYearStartMonth ?? 4), settings?.fiscalYearStartMonth ?? 4);
  const [from, setFrom] = useState(year.startDate);
  const [to, setTo] = useState(today);
  const download = useMutation({
    mutationFn: (part: 'masters' | 'vouchers') => api!.tally(part, from, to),
    onSuccess: (f) => saveBlob(f),
    onError: () => toast(t('tally.failed'), 'error'),
  });
  if (!api) return null;
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <FileCode2 className="size-5 text-brand-600" aria-hidden /> {t('tally.title')}
      </h2>
      <p className="mt-1 text-sm text-ink-500">{t('tally.body')}</p>
      <ol className="mt-3 list-decimal space-y-3 ps-5 text-sm">
        <li>
          <span className="block">{t('tally.step1')}</span>
          <Button variant="secondary" size="sm" className="mt-1.5" loading={download.isPending && download.variables === 'masters'} onClick={() => download.mutate('masters')}>
            {t('tally.masters')}
          </Button>
        </li>
        <li>
          <span className="block">{t('tally.step2')}</span>
          <div className="mt-1.5 flex flex-wrap items-end gap-3">
            <div className="w-40">
              <TextField label={t('reports.from')} type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
            </div>
            <div className="w-40">
              <TextField label={t('reports.to')} type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} error={from > to ? t('audit.filters.badRange') : undefined} />
            </div>
            <Button variant="secondary" size="sm" disabled={from > to} loading={download.isPending && download.variables === 'vouchers'} onClick={() => download.mutate('vouchers')}>
              {t('tally.vouchers')}
            </Button>
          </div>
        </li>
      </ol>
    </Card>
  );
}
