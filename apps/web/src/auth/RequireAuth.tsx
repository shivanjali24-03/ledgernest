import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import Logo from '../layout/Logo';
import { useAuth } from './context';

/** Shown while the session is being restored: a breathing logo (scale + opacity only). */
export function Splash() {
  const { t } = useTranslation();
  return (
    <div className="grid h-dvh place-items-center" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-4">
        <motion.div animate={{ scale: [1, 1.08, 1], opacity: [0.85, 1, 0.85] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}>
          <Logo className="size-12" />
        </motion.div>
        <p className="text-sm text-ink-500">{t('auth.loading')}</p>
      </div>
    </div>
  );
}

/** Lets signed-in users through; sends everyone else to sign in, remembering where they were going. */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') return <Splash />;
  if (state.status === 'signedOut') {
    const here = location.pathname + location.search;
    return <Navigate to={here === '/' ? '/sign-in' : `/sign-in?next=${encodeURIComponent(here)}`} replace />;
  }
  return children;
}
