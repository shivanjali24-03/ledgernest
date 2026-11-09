import { ORGANIZATION_AUDIT_GROUPS, AUDIT_ACTION_GROUPS, type AuditActionGroup } from '@ledgernest/shared';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Button from '../ui/Button';
import { SelectField, TextField } from '../ui/Field';
import type { AuditScope } from './types';

export interface FilterValues {
  group: string;
  person: string;
  org: string;
  from: string;
  to: string;
}

interface Props {
  scope: AuditScope;
  values: FilterValues;
  onChange: (patch: Partial<FilterValues>) => void;
  people: { id: string; name: string; email: string }[];
  organizations: { id: string; name: string }[];
}

/** Activity type, person, organisation (platform log) and date range. Kept in the address bar so views can be shared. */
export default function AuditFilters({ scope, values, onChange, people, organizations }: Props) {
  const { t } = useTranslation();
  const groups: AuditActionGroup[] = scope === 'platform' ? (Object.keys(AUDIT_ACTION_GROUPS) as AuditActionGroup[]) : ORGANIZATION_AUDIT_GROUPS;
  const active = Object.values(values).some(Boolean);
  const dateError = values.from && values.to && values.from > values.to ? t('audit.filters.badRange') : undefined;

  return (
    <fieldset className={`grid gap-3 sm:grid-cols-2 ${scope === 'platform' ? 'lg:grid-cols-[repeat(5,minmax(0,1fr))_auto]' : 'lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]'} lg:items-end`}>
      <legend className="sr-only">{t('audit.filters.label')}</legend>
      <SelectField
        label={t('audit.filters.group')}
        value={values.group}
        onChange={(e) => onChange({ group: e.target.value })}
        options={[{ value: '', label: t('audit.filters.allGroups') }, ...groups.map((g) => ({ value: g, label: t(`audit.groups.${g}`) }))]}
      />
      <SelectField
        label={t('audit.filters.person')}
        value={values.person}
        onChange={(e) => onChange({ person: e.target.value })}
        options={[
          { value: '', label: t('audit.filters.everyone') },
          ...people.map((p) => ({
            value: p.id,
            label: `${p.name} · ${p.email}`,
          })),
        ]}
      />
      {scope === 'platform' && (
        <SelectField
          label={t('audit.filters.organization')}
          value={values.org}
          onChange={(e) => onChange({ org: e.target.value })}
          options={[{ value: '', label: t('audit.filters.allOrganizations') }, ...organizations.map((o) => ({ value: o.id, label: o.name }))]}
        />
      )}
      <TextField label={t('audit.filters.from')} type="date" value={values.from} max={values.to || undefined} onChange={(e) => onChange({ from: e.target.value })} />
      <TextField label={t('audit.filters.to')} type="date" value={values.to} min={values.from || undefined} error={dateError} onChange={(e) => onChange({ to: e.target.value })} />
      <Button variant="ghost" icon={<X className="size-4" />} disabled={!active} onClick={() => onChange({ group: '', person: '', org: '', from: '', to: '' })} className="lg:mb-0">
        {t('audit.filters.clear')}
      </Button>
    </fieldset>
  );
}
