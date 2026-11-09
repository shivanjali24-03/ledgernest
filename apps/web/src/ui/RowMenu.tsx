import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { scaleIn } from '../motion/tokens';

export interface RowMenuItem {
  key: string;
  label: ReactNode;
  icon: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** A row's "more actions" menu: opens on click, closes on Escape, outside click or choosing an item. */
export default function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    // Move focus into the menu so keyboard users land on the first action
    root.current?.querySelector<HTMLButtonElement>('[role=menuitem]:not(:disabled)')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!items.length) return null;
  return (
    <div ref={root} className="relative inline-block">
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-800 dark:hover:bg-ink-800 dark:hover:text-ink-200"
      >
        <MoreHorizontal className="size-5" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={menuId}
            role="menu"
            aria-label={label}
            variants={scaleIn}
            initial="hidden"
            animate="show"
            exit="exit"
            className="absolute end-0 z-30 mt-1 w-56 origin-top-right rounded-xl border border-ink-200 bg-white p-1 shadow-pop rtl:origin-top-left dark:border-ink-700 dark:bg-ink-900"
          >
            {items.map(({ key, label: text, icon: Icon, onSelect, danger, disabled }) => (
              <button
                key={key}
                type="button"
                role="menuitem"
                disabled={disabled}
                onClick={() => {
                  setOpen(false);
                  onSelect();
                }}
                className={clsx(
                  'flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-start text-sm disabled:cursor-not-allowed disabled:opacity-40',
                  danger ? 'text-expense hover:bg-expense/10' : 'hover:bg-ink-100 dark:hover:bg-ink-800',
                )}
              >
                <Icon className="size-4" aria-hidden /> {text}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
