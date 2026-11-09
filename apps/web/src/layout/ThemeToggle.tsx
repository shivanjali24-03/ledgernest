import { AnimatePresence, motion } from 'motion/react';
import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { spring } from '../motion/tokens';
import { useTheme } from '../theme/useTheme';

export default function ThemeToggle() {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <button onClick={theme.toggle} className="rounded-xl p-2 hover:bg-ink-100 dark:hover:bg-ink-800" aria-label={theme.resolved === 'dark' ? t('shell.toLight') : t('shell.toDark')}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={theme.resolved} className="inline-flex" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={spring.snappy}>
          {theme.resolved === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
