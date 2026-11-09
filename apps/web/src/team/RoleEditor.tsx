import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ORGANIZATION_PERMISSIONS, groupByArea, type OrganizationPermission } from '@ledgernest/shared';
import clsx from 'clsx';
import { useSession } from '../layout/session';
import { TextField } from '../ui/Field';
import { areaKey, permissionKey } from './labels';

export interface RoleDraft {
  name: string;
  description: string;
  permissions: OrganizationPermission[];
}

/**
 * Name, description and a permission matrix grouped by area.
 * Permissions you don't hold yourself are shown but locked: you can't build a role above your own access.
 */
export default function RoleEditor({ id, initial, onSubmit, readOnly = false }: { id: string; initial: RoleDraft; onSubmit: (d: RoleDraft) => void; readOnly?: boolean }) {
  const { t } = useTranslation();
  const session = useSession();
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<{ name?: string; permissions?: string }>({});
  const areas = useMemo(() => Object.entries(groupByArea(ORGANIZATION_PERMISSIONS)) as [string, OrganizationPermission[]][], []);
  const chosen = new Set(draft.permissions);
  const mayGive = (p: OrganizationPermission) => !readOnly && session.permissions.has(p);

  const toggle = (ps: OrganizationPermission[], on: boolean) =>
    setDraft((d) => {
      const next = new Set(d.permissions);
      for (const p of ps) {
        if (!mayGive(p)) continue;
        if (on) next.add(p);
        else next.delete(p);
      }
      return { ...d, permissions: ORGANIZATION_PERMISSIONS.filter((p) => next.has(p)) };
    });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (draft.name.trim().length < 2 || draft.name.trim().length > 40) next.name = t('team.roles.errors.name');
    if (draft.permissions.length === 0) next.permissions = t('team.roles.errors.permissions');
    setErrors(next);
    if (!next.name && !next.permissions) onSubmit({ ...draft, name: draft.name.trim(), description: draft.description.trim() });
  };

  return (
    <form id={id} onSubmit={submit} noValidate className="space-y-5">
      {!readOnly && (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={t('team.roles.name')} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} error={errors.name} maxLength={40} dir="auto" data-autofocus />
          <TextField label={t('team.roles.description')} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} maxLength={200} dir="auto" />
        </div>
      )}
      <fieldset>
        <legend className="flex w-full items-center justify-between text-sm font-medium">
          {t('team.roles.permissions')}
          <span className="tabular text-xs font-normal text-ink-500">{t('team.roles.selected', { count: draft.permissions.length, total: ORGANIZATION_PERMISSIONS.length })}</span>
        </legend>
        {errors.permissions && <p className="mt-1 text-xs text-expense">{errors.permissions}</p>}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {areas.map(([area, perms]) => {
            const givable = perms.filter(mayGive);
            const on = perms.filter((p) => chosen.has(p)).length;
            return (
              <div key={area} className="rounded-xl border border-ink-200 p-3 dark:border-ink-700">
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand-600"
                    checked={on === perms.length}
                    ref={(el) => {
                      if (el) el.indeterminate = on > 0 && on < perms.length;
                    }}
                    disabled={givable.length === 0}
                    onChange={(e) => toggle(perms, e.target.checked)}
                  />
                  {t(areaKey(area))}
                </label>
                <ul className="mt-2 space-y-1.5 ps-6">
                  {perms.map((p) => {
                    const locked = !mayGive(p);
                    return (
                      <li key={p}>
                        <label className={clsx('flex items-start gap-2 text-sm', locked && 'text-ink-400')}>
                          <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={chosen.has(p)} disabled={locked} onChange={(e) => toggle([p], e.target.checked)} />
                          <span>
                            {t(permissionKey(p))}
                            {locked && !readOnly && <span className="block text-[11px]">{t('team.roles.notYours')}</span>}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </fieldset>
    </form>
  );
}
