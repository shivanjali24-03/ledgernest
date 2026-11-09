import { useId, type ReactNode } from 'react';
import { LayoutGroup, motion } from 'motion/react';
import clsx from 'clsx';
import { spring } from '../motion/tokens';

/** Accessible tabs (arrow keys move between them) with a gliding underline (transform only). */
export default function Tabs<T extends string>({
  value,
  onChange,
  tabs,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: { value: T; label: ReactNode; count?: number }[];
  label: string;
}) {
  const id = useId();
  const move = (dir: 1 | -1) => {
    const i = tabs.findIndex((t) => t.value === value);
    const next = tabs[(i + dir + tabs.length) % tabs.length]!;
    onChange(next.value);
    document.getElementById(`${id}-${next.value}`)?.focus();
  };
  return (
    <LayoutGroup id={id}>
      <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-ink-200 dark:border-ink-800">
        {tabs.map((t) => {
          const selected = t.value === value;
          return (
            <button
              key={t.value}
              id={`${id}-${t.value}`}
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(t.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  e.preventDefault();
                  const forward = (e.key === 'ArrowRight') !== (document.documentElement.dir === 'rtl');
                  move(forward ? 1 : -1);
                }
              }}
              className={clsx('relative flex h-11 shrink-0 items-center gap-2 px-3 text-sm font-medium transition-colors', selected ? 'text-brand-800 dark:text-brand-200' : 'text-ink-500 hover:text-ink-800 dark:hover:text-ink-200')}
            >
              {t.label}
              {t.count !== undefined && <span className="tabular rounded-md bg-ink-100 px-1.5 text-xs text-ink-600 dark:bg-ink-800 dark:text-ink-300">{t.count}</span>}
              {selected && <motion.span layoutId="tab-underline" transition={spring.glide} className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-600" aria-hidden />}
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
