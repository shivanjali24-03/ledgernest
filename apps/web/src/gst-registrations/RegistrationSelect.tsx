import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSession } from '../layout/session';
import { SelectField } from '../ui/Field';
import { useGstRegistrationsApi } from './api';

/** Which GSTIN a document is under: only once the business has more than one; empty = its own */
export default function RegistrationSelect({ value, onChange, disabled }: { value: string; onChange: (id: string) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  const session = useSession();
  const api = useGstRegistrationsApi();
  const q = useQuery({ queryKey: ['gst-registrations', session.organizationId], queryFn: () => api!.list(), enabled: !!api });
  const regs = (q.data?.registrations ?? []).filter((r) => !r.archived || r.id === value);
  if (!regs.length || !q.data?.primary) return null;
  return (
    <SelectField
      label={t('gstRegistrations.under')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      options={[{ value: '', label: `${q.data.primary.gstin} (${t('gstRegistrations.own')})` }, ...regs.map((r) => ({ value: r.id, label: `${r.gstin} · ${r.state ?? r.stateCode}${r.tradeName ? ` · ${r.tradeName}` : ''}` }))]}
    />
  );
}
