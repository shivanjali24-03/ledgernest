import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import Button from '../ui/Button';
import { TextField } from '../ui/Field';

export type PersonForm = { name: string; designation: string; email: string; phone: string; whatsapp: string; primary: boolean };
const blank = (): PersonForm => ({ name: '', designation: '', email: '', phone: '', whatsapp: '', primary: false });

/** The people to deal with at a customer or vendor: up to 10, one of them the main contact */
export default function PersonsEditor({ value, onChange, errors = {} }: { value: PersonForm[]; onChange: (v: PersonForm[]) => void; errors?: Record<string, string | undefined> }) {
  const { t } = useTranslation();
  const set = (n: number, patch: Partial<PersonForm>) => onChange(value.map((p, i) => (i === n ? { ...p, ...patch } : patch.primary ? { ...p, primary: false } : p)));
  return (
    <fieldset className="space-y-3" aria-label={t('contacts.persons.title')}>
      <legend className="text-sm font-medium">{t('contacts.persons.title')}</legend>
      {errors.persons && <p className="text-xs text-expense">{errors.persons}</p>}
      {value.map((p, n) => (
        <div key={n} className="grid gap-3 rounded-xl border border-ink-100 p-3 sm:grid-cols-2 dark:border-ink-800">
          <TextField label={t('contacts.persons.name', { n: n + 1 })} value={p.name} onChange={(e) => set(n, { name: e.target.value })} error={errors[`persons.${n}.name`]} dir="auto" />
          <TextField label={t('contacts.persons.designation')} value={p.designation} onChange={(e) => set(n, { designation: e.target.value })} dir="auto" />
          <TextField label={t('contacts.fields.email')} type="email" value={p.email} onChange={(e) => set(n, { email: e.target.value })} error={errors[`persons.${n}.email`]} dir="ltr" />
          <TextField label={t('contacts.fields.phone')} value={p.phone} onChange={(e) => set(n, { phone: e.target.value })} error={errors[`persons.${n}.phone`]} dir="ltr" inputMode="tel" />
          <TextField label={t('contacts.fields.whatsapp')} value={p.whatsapp} onChange={(e) => set(n, { whatsapp: e.target.value })} error={errors[`persons.${n}.whatsapp`]} dir="ltr" inputMode="tel" />
          <div className="flex items-end justify-between gap-2">
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="radio" name="primary-person" checked={p.primary} onChange={() => set(n, { primary: true })} className="size-4 accent-brand-600" />
              {t('contacts.persons.primary')}
            </label>
            <button type="button" onClick={() => onChange(value.filter((_, i) => i !== n))} aria-label={t('contacts.persons.remove', { n: n + 1 })} className="grid size-9 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-expense dark:hover:bg-ink-800">
              <X className="size-4" />
            </button>
          </div>
        </div>
      ))}
      {value.length < 10 && (
        <Button type="button" variant="ghost" icon={<Plus className="size-4" />} onClick={() => onChange([...value, { ...blank(), primary: !value.length }])}>
          {t('contacts.persons.add')}
        </Button>
      )}
    </fieldset>
  );
}
