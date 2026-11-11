import clsx from 'clsx';
import { parseQuantity, parseSerials } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { inputClass } from '../ui/Field';

/** Serial numbers for a line of goods: one per unit, typed or scanned one per line (or with commas) */
export default function SerialsInput({ value, onChange, quantity, label, disabled }: { value: string; onChange: (v: string) => void; quantity: string; label: string; disabled?: boolean }) {
  const { t } = useTranslation();
  const count = parseSerials(value).length;
  const q = parseQuantity(quantity);
  const needed = q !== null && q % 10_000n === 0n ? Number(q / 10_000n) : null;
  const ok = needed !== null && count === needed;
  return (
    <div className="mt-1">
      <textarea
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={Math.min(4, Math.max(1, count || 1))}
        placeholder={t('serials.placeholder')}
        dir="ltr"
        className={clsx(inputClass, 'h-auto min-h-9 resize-y py-1.5 font-mono text-xs', ok ? 'border-ink-200 dark:border-ink-700' : 'border-expense')}
      />
      <span className={clsx('block text-xs', ok ? 'text-ink-500' : 'text-expense')}>{needed === null ? t('serials.wholeUnits') : t('serials.count', { count, needed })}</span>
    </div>
  );
}
