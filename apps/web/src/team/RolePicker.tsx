import { useTranslation } from 'react-i18next';
import { SelectField } from '../ui/Field';
import type { RolesResponse } from './types';

/**
 * Every role, with the ones you aren't allowed to give shown but disabled,
 * so people can see what exists without being able to escalate.
 */
export default function RolePicker({ roles, value, onChange, label }: { roles: RolesResponse; value: string; onChange: (v: string) => void; label: string }) {
  const { t } = useTranslation();
  const locked = ` (${t('team.roles.notYours')})`;
  const options = [
    ...roles.builtIn.map((r) => ({ value: `b:${r.key}`, label: t(`roles.${r.key}`) + (r.canAssign ? '' : locked), disabled: !r.canAssign })),
    ...roles.custom.map((r) => ({ value: `c:${r.id}`, label: r.name + (r.canAssign ? '' : locked), disabled: !r.canAssign })),
  ];
  const description = roles.builtIn.find((r) => `b:${r.key}` === value);
  return (
    <SelectField
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={options}
      hint={description ? t(`team.roles.describe.${description.key}`) : undefined}
    />
  );
}
