import { motion } from 'motion/react';
import { ArrowDownRight, ArrowUpRight, CheckCircle2, Circle, Sparkles } from 'lucide-react';
import clsx from 'clsx';
import AnimatedNumber from '../motion/AnimatedNumber';
import { fadeUp, stagger } from '../motion/tokens';
import { formatCompactMoney, formatPercent } from '../lib/format';
import { ROLE_LABELS, useSession } from '../layout/session';

// Sample figures (integers in paise) until the books are connected
const KPIS = [
  { label: 'Cash & bank', value: 48_215_000_00, change: 0.082, trend: [32, 35, 34, 38, 41, 40, 44, 48] },
  { label: 'Receivables', value: 12_640_000_00, change: -0.031, trend: [14, 13, 15, 13, 12, 13, 12, 12.6] },
  // For payables, going up is bad news, so the colours are inverted
  { label: 'Payables', value: 7_980_000_00, change: 0.012, trend: [7, 8, 7.5, 8.2, 7.9, 8.1, 7.7, 8], higherIsWorse: true },
  { label: 'Net profit (YTD)', value: 21_370_000_00, change: 0.164, trend: [4, 7, 9, 11, 13, 16, 19, 21.4] },
];

const SETUP = [
  { label: 'Create your organisation', done: true },
  { label: 'Invite your team and assign roles', done: true },
  { label: 'Choose a chart of accounts template', done: false },
  { label: 'Set your fiscal year and base currency', done: false },
  { label: 'Connect a bank account', done: false },
];

/** Tiny line chart; the line draws itself in (stroke animation, no layout). */
function Sparkline({ points, up }: { points: number[]; up: boolean }) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const d = points.map((p, i) => `${(i / (points.length - 1)) * 100},${30 - ((p - min) / (max - min || 1)) * 26 - 2}`).join(' L');
  return (
    <svg viewBox="0 0 100 30" className="h-10 w-full" preserveAspectRatio="none" aria-hidden>
      <motion.path
        d={`M${d}`}
        fill="none"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={up ? 'stroke-income' : 'stroke-expense'}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.1, ease: [0.2, 0.8, 0.2, 1] }}
      />
    </svg>
  );
}

export default function Dashboard() {
  const session = useSession();
  const done = SETUP.filter((s) => s.done).length;
  const firstName = session.name.split(' ')[0];

  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.header variants={fadeUp} className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-brand-700 dark:text-brand-300">{ROLE_LABELS[session.role]} view</p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Good to see you, {firstName}</h1>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-3 py-1 text-xs font-semibold text-warning">
          <Sparkles className="size-3.5" /> Sample data
        </span>
      </motion.header>

      <motion.section variants={stagger(0.07)} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Key figures">
        {KPIS.map((k) => {
          const rising = k.change >= 0;
          const good = 'higherIsWorse' in k && k.higherIsWorse ? !rising : rising;
          return (
            <motion.article key={k.label} variants={fadeUp} className="lift rounded-card border border-ink-200 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
              <p className="text-sm text-ink-500">{k.label}</p>
              <p className="mt-1 text-2xl font-bold tracking-tight">
                <AnimatedNumber value={k.value} format={(n) => formatCompactMoney(Math.round(n))} />
              </p>
              <p className={clsx('mt-1 inline-flex items-center gap-1 text-xs font-semibold', good ? 'text-income' : 'text-expense')}>
                {rising ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
                {formatPercent(k.change)} vs last month
              </p>
              <Sparkline points={k.trend} up={good} />
            </motion.article>
          );
        })}
      </motion.section>

      <motion.section variants={fadeUp} className="rounded-card border border-ink-200 bg-white p-6 shadow-card dark:border-ink-800 dark:bg-ink-900" aria-labelledby="setup-title">
        <div className="flex items-center justify-between">
          <h2 id="setup-title" className="text-lg font-semibold">
            Set up your books
          </h2>
          <span className="text-sm text-ink-500">
            {done} of {SETUP.length} done
          </span>
        </div>
        {/* Progress bar animates scaleX (transform), not width */}
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
          <motion.div
            className="h-full origin-left rounded-full bg-gradient-to-r from-brand-400 to-brand-600 rtl:origin-right"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: done / SETUP.length }}
            transition={{ type: 'spring', stiffness: 120, damping: 22 }}
          />
        </div>
        <motion.ul variants={stagger(0.05, 0.2)} initial="hidden" animate="show" className="mt-4 grid gap-2 sm:grid-cols-2">
          {SETUP.map((s) => (
            <motion.li key={s.label} variants={fadeUp} className="flex items-center gap-2.5 text-sm">
              {s.done ? <CheckCircle2 className="size-5 text-income" /> : <Circle className="size-5 text-ink-300" />}
              <span className={clsx(s.done && 'text-ink-400 line-through')}>{s.label}</span>
            </motion.li>
          ))}
        </motion.ul>
      </motion.section>
    </motion.div>
  );
}
