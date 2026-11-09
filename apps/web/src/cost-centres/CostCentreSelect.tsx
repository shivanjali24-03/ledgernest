import { useTranslation } from 'react-i18next';
import type { CostCentre } from './types';

/**
 * Which cost centre or project a line belongs to: a small select under the line's main field. Archived ones only
 * appear when a line already has one (and can't be picked again).
 */
export default function CostCentreSelect({ centres, value, onChange, label, disabled }: { centres: readonly CostCentre[]; value: string; onChange: (id: string) => void; label: string; disabled?: boolean }) {
  const { t } = useTranslation();
  const shown = centres.filter((c) => !c.archived || c.id === value);
  if (!shown.length) return null;
  return (
    <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="mt-1 h-8 w-full rounded-md border border-ink-200 bg-white px-2 text-xs text-ink-600 disabled:opacity-70 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300">
      <option value="">{t('costCentres.none')}</option>
      {shown.map((c) => (
        <option key={c.id} value={c.id} disabled={c.archived}>
          {c.code} · {c.name}
        </option>
      ))}
    </select>
  );
}
