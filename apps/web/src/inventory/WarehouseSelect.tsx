import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSession } from '../layout/session';
import { SelectField } from '../ui/Field';
import { useInventoryApi } from './useInventoryApi';

/** Which warehouse a document's goods leave or come into: only once there are warehouses; empty = the main one */
export default function WarehouseSelect({ value, onChange, disabled, label }: { value: string; onChange: (id: string) => void; disabled?: boolean; label?: string }) {
  const { t } = useTranslation();
  const session = useSession();
  const api = useInventoryApi();
  const q = useQuery({ queryKey: ['inventory', session.organizationId, 'warehouses'], queryFn: () => api!.warehouses(), enabled: !!api });
  const active = (q.data?.warehouses ?? []).filter((w) => !w.archived || w.id === value);
  if (!active.length) return null;
  const main = active.find((w) => w.isDefault);
  return (
    <SelectField
      label={label ?? t('warehouses.fields.warehouse')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      options={[{ value: '', label: t('warehouses.mainOption', { name: main?.name ?? '' }) }, ...active.filter((w) => !w.isDefault).map((w) => ({ value: w.id, label: `${w.name} (${w.code})` }))]}
    />
  );
}
