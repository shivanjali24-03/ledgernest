import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import clsx from 'clsx';
import { spring } from '../motion/tokens';
import { ToastContext, type ToastTone } from './toastContext';

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}
let next = 1;

export default function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  // Clear pending dismissals on unmount, so none fires after the provider (or a test's page) is gone.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);
  const show = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = next++;
    setToasts((t) => [...t.slice(-2), { id, message, tone }]);
    const timer = setTimeout(
      () => {
        timers.current.delete(timer);
        setToasts((t) => t.filter((x) => x.id !== id));
      },
      tone === 'error' ? 6000 : 3500,
    );
    timers.current.add(timer);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[70] flex flex-col items-center gap-2 sm:inset-x-auto sm:end-4 sm:items-end">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              role={t.tone === 'error' ? 'alert' : 'status'}
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={spring.snappy}
              className={clsx(
                'pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-xl px-4 py-3 text-sm font-medium shadow-pop',
                t.tone === 'error' ? 'bg-expense text-white' : 'bg-ink-900 text-white dark:bg-white dark:text-ink-900',
              )}
            >
              {t.tone === 'error' ? <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />}
              <span>{t.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
