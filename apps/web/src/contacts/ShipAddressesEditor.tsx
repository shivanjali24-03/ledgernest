import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import IndianAddressFields from '../geo/IndianAddressFields';
import Button from '../ui/Button';
import { TextField } from '../ui/Field';

export type ShipAddressForm = { label: string; line1: string; line2: string; city: string; region: string; postalCode: string };

/** More places goods go to (sites, branches, warehouses), each named; addresses fill from the PIN code */
export default function ShipAddressesEditor({ value, onChange, errors = {} }: { value: ShipAddressForm[]; onChange: (v: ShipAddressForm[]) => void; errors?: Record<string, string | undefined> }) {
  const { t } = useTranslation();
  const set = (n: number, patch: Partial<ShipAddressForm>) => onChange(value.map((a, i) => (i === n ? { ...a, ...patch } : a)));
  return (
    <fieldset className="space-y-3" aria-label={t('contacts.shipAddresses.title')}>
      <legend className="text-sm font-medium">{t('contacts.shipAddresses.title')}</legend>
      {value.map((a, n) => (
        <div key={n} className="grid gap-3 rounded-xl border border-ink-100 p-3 sm:grid-cols-2 dark:border-ink-800">
          <div className="flex items-end gap-2 sm:col-span-2">
            <div className="flex-1">
              <TextField label={t('contacts.shipAddresses.label', { n: n + 1 })} value={a.label} onChange={(e) => set(n, { label: e.target.value })} error={errors[`shipAddresses.${n}.label`]} placeholder={t('contacts.shipAddresses.labelHint')} dir="auto" />
            </div>
            <button type="button" onClick={() => onChange(value.filter((_, i) => i !== n))} aria-label={t('contacts.shipAddresses.remove', { n: n + 1 })} className="mb-0.5 grid size-9 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-expense dark:hover:bg-ink-800">
              <X className="size-4" />
            </button>
          </div>
          <IndianAddressFields value={{ line1: a.line1, line2: a.line2, city: a.city, region: a.region, postalCode: a.postalCode }} onChange={(patch) => set(n, patch)} />
        </div>
      ))}
      {value.length < 20 && (
        <Button type="button" variant="ghost" icon={<Plus className="size-4" />} onClick={() => onChange([...value, { label: '', line1: '', line2: '', city: '', region: '', postalCode: '' }])}>
          {t('contacts.shipAddresses.add')}
        </Button>
      )}
    </fieldset>
  );
}
