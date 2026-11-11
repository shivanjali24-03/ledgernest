import clsx from 'clsx';
import { inputClass } from '../ui/Field';
import type { Item } from './types';

/** For an item sold or bought in two units (pieces and boxes of 12): which one a line's quantity and price are in */
export default function UnitSelect({ item, inAlt, onChange, label, disabled }: { item: Item | undefined; inAlt: boolean; onChange: (inAlt: boolean) => void; label: string; disabled?: boolean }) {
  if (!item?.altUnit || !item.altFactor) return null;
  return (
    <select aria-label={label} value={inAlt ? 'alt' : 'main'} disabled={disabled} onChange={(e) => onChange(e.target.value === 'alt')} className={clsx(inputClass, 'mt-1 h-8 border-ink-200 text-xs dark:border-ink-700')}>
      <option value="main">{item.unit ?? '—'}</option>
      <option value="alt">
        {item.altUnit} (× {item.altFactor})
      </option>
    </select>
  );
}
