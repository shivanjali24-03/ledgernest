import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import LanguageSwitcher from '../layout/LanguageSwitcher';
import Logo from '../layout/Logo';
import ThemeToggle from '../layout/ThemeToggle';
import { stagger } from '../motion/tokens';

/** The frame for pages people see signed out: the logo home, language and theme, and a narrow column */
export default function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex items-center justify-between p-4">
        <Link to="/" className="flex items-center gap-2">
          <Logo className="size-8" />
          <span className="font-bold tracking-tight">LedgerNest</span>
        </Link>
        <div className="flex items-center gap-1">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>
      <main className="flex flex-1 items-start justify-center px-5 pb-16 pt-6 sm:items-center sm:pt-0">
        <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="w-full max-w-md">
          {children}
        </motion.div>
      </main>
    </div>
  );
}
