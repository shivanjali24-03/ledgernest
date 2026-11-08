import { motion } from 'motion/react';
import { useLocation } from 'react-router';
import { Hammer } from 'lucide-react';
import { fadeUp, stagger } from '../motion/tokens';
import { NAV } from '../layout/nav';

/** Placeholder for features on the roadmap, linking to the public feature list. */
export default function ComingSoon() {
  const { pathname } = useLocation();
  const item = NAV.flatMap((g) => g.items).find((i) => i.to === pathname);
  return (
    <motion.div variants={stagger(0.08)} initial="hidden" animate="show" className="grid min-h-[60vh] place-items-center text-center">
      <div className="max-w-md">
        <motion.span variants={fadeUp} className="mx-auto grid size-16 place-items-center rounded-2xl bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-200">
          {item ? <item.icon className="size-8" /> : <Hammer className="size-8" />}
        </motion.span>
        <motion.h1 variants={fadeUp} className="mt-5 text-2xl font-bold tracking-tight">
          {item?.label ?? 'This page'} is on the way
        </motion.h1>
        <motion.p variants={fadeUp} className="mt-2 text-ink-500">
          It's part of the LedgerNest roadmap. See what's planned and follow progress on GitHub.
        </motion.p>
        <motion.a
          variants={fadeUp}
          href="https://github.com/shivanjali24-03/ledgernest/blob/develop/docs/FEATURES.md"
          className="mt-6 inline-flex h-11 items-center rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white shadow-card hover:bg-brand-700"
        >
          View the feature list
        </motion.a>
      </div>
    </motion.div>
  );
}
