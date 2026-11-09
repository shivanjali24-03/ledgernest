import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { scaleIn } from '../motion/tokens';
import { initials, roleLabel, useSession } from './session';

/** Avatar button with the account popover: who you are, where, as what, and sign out. */
export default function UserMenu() {
  const session = useSession();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const signOut = async () => {
    setBusy(true);
    await session.signOut();
  };

  return (
    <div ref={root} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t('auth.account')}
        aria-expanded={open}
        aria-controls={menuId}
        className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white transition-transform hover:scale-105"
      >
        {initials(session.name)}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={menuId}
            variants={scaleIn}
            initial="hidden"
            animate="show"
            exit="exit"
            className="absolute end-0 top-12 z-50 w-64 origin-top-right rounded-2xl border border-ink-200 bg-white p-2 shadow-pop rtl:origin-top-left dark:border-ink-700 dark:bg-ink-900"
          >
            <div className="px-3 py-2">
              <p className="truncate text-sm font-semibold" dir="auto">
                {session.name}
              </p>
              <p className="truncate text-xs text-ink-500" dir="ltr">
                {session.email}
              </p>
              <p className="mt-1 truncate text-xs text-ink-500" dir="auto">
                {roleLabel(session, t)}
                {session.organization && ` · ${session.organization}`}
              </p>
            </div>
            <div className="my-1 h-px bg-ink-100 dark:bg-ink-800" />
            <button
              onClick={() => void signOut()}
              disabled={busy}
              className="flex h-10 w-full items-center gap-2.5 rounded-xl px-3 text-sm font-medium text-ink-700 hover:bg-ink-100 disabled:opacity-60 dark:text-ink-200 dark:hover:bg-ink-800"
            >
              <LogOut className="size-4 rtl:-scale-x-100" aria-hidden /> {t('auth.signOut')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
