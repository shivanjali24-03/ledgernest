import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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

/**
 * A row's "more actions" menu: opens on click, closes on Escape, outside click, scrolling or choosing an item.
 * The menu is drawn on top of the page (not inside the row), so a table or toolbar that scrolls sideways
 * never clips it; it opens below the button, or above when there's no room.
 */
export default function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const menu = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number; up: boolean } | null>(null);

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const width = 224;
    const height = items.length * 36 + 10;
    const up = r.bottom + 4 + height > window.innerHeight && r.top - 4 - height > 0;
    const rtl = document.documentElement.dir === 'rtl';
    const left = Math.min(Math.max(8, rtl ? r.left : r.right - width), window.innerWidth - width - 8);
    setPlace({ top: up ? r.top - 4 - height : r.bottom + 4, left, up });
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && !menu.current?.contains(e.target as Node) && setOpen(false);
    // The page moved under it: close rather than float in the wrong place
    const onScroll = (e: Event) => !menu.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    // Move focus into the menu so keyboard users land on the first action
    requestAnimationFrame(() => menu.current?.querySelector<HTMLButtonElement>('[role=menuitem]:not(:disabled)')?.focus());
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
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
        className="rounded-lg p-2 text-ink-500 hover:bg-ink-100 hover:text-ink-800 dark:hover:bg-ink-800 dark:hover:text-ink-200"
      >
        <MoreHorizontal className="size-5" />
      </button>
      {createPortal(
      <AnimatePresence>
        {open && place && (
          <motion.div
            ref={menu}
            style={{ position: 'fixed', top: place.top, left: place.left }}
            id={menuId}
            role="menu"
            aria-label={label}
            variants={scaleIn}
            initial="hidden"
            animate="show"
            exit="exit"
            className={clsx('z-[70] w-56 rounded-xl border border-ink-200 bg-white p-1 shadow-pop dark:border-ink-700 dark:bg-ink-900', place.up ? 'origin-bottom' : 'origin-top')}
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
      </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
