import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ACCOUNT_TYPES, INDUSTRIES, type Industry } from '@ledgernest/shared';
import { ArrowLeft, Building, Cpu, Factory, GraduationCap, HandHeart, HardHat, Sprout, Stethoscope, Store, UtensilsCrossed, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { fadeUp, spring } from '../motion/tokens';
import Button from '../ui/Button';
import { SkeletonRows } from '../ui/Kit';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import { accountErrorMessage } from './errors';
import type { AccountsApi } from './types';

const ICONS: Record<Industry, LucideIcon> = {
  retail: Store,
  services: Building,
  manufacturing: Factory,
  healthcare: Stethoscope,
  education: GraduationCap,
  nonprofit: HandHeart,
  construction: HardHat,
  restaurant: UtensilsCrossed,
  it_software: Cpu,
  agriculture: Sprout,
};

/** Pick an industry, preview its chart of accounts, then create it. */
export default function TemplateDialog({ api, onClose, onApplied }: { api: AccountsApi; onClose: () => void; onApplied: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [industry, setIndustry] = useState<Industry | null>(null);
  const preview = useQuery({ queryKey: ['account-template', industry], queryFn: () => api.previewTemplate(industry!), enabled: !!industry });
  const apply = useMutation({
    mutationFn: () => api.applyTemplate(industry!),
    onSuccess: (r) => {
      toast(t('accounts.templates.applied', { count: r.created }));
      onApplied();
    },
    onError: (e) => toast(accountErrorMessage(e, t), 'error'),
  });

  const depthOf = (code: string, all: { code: string; parent?: string }[]): number => {
    const a = all.find((x) => x.code === code);
    return a?.parent ? 1 + depthOf(a.parent, all) : 0;
  };

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={industry ? t('accounts.templates.previewTitle', { industry: t(`accounts.industries.${industry}.name`) }) : t('accounts.templates.title')}
      description={industry ? t('accounts.templates.previewBody', { count: preview.data?.length ?? 0 }) : t('accounts.templates.description')}
      footer={
        industry ? (
          <>
            <Button variant="ghost" icon={<ArrowLeft className="size-4 rtl:-scale-x-100" />} onClick={() => setIndustry(null)}>
              {t('accounts.templates.back')}
            </Button>
            <Button loading={apply.isPending} disabled={!preview.data} onClick={() => apply.mutate()}>
              {t('accounts.templates.apply')}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        )
      }
    >
      <AnimatePresence mode="wait" initial={false}>
        {!industry ? (
          <motion.ul key="pick" variants={fadeUp} initial="hidden" animate="show" exit={{ opacity: 0, transition: { duration: 0.1 } }} className="grid gap-2 sm:grid-cols-2">
            {INDUSTRIES.map((i) => {
              const Icon = ICONS[i];
              return (
                <li key={i}>
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.98 }}
                    transition={spring.snappy}
                    onClick={() => setIndustry(i)}
                    className="flex w-full items-start gap-3 rounded-xl border border-ink-200 p-3 text-start transition-colors hover:border-brand-500 hover:bg-brand-50/50 dark:border-ink-700 dark:hover:bg-brand-900/20"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <span>
                      <span className="block font-semibold">{t(`accounts.industries.${i}.name`)}</span>
                      <span className="block text-xs text-ink-500">{t(`accounts.industries.${i}.description`)}</span>
                    </span>
                  </motion.button>
                </li>
              );
            })}
          </motion.ul>
        ) : (
          <motion.div key="preview" variants={fadeUp} initial="hidden" animate="show" className="max-h-[50vh] overflow-y-auto rounded-xl border border-ink-100 dark:border-ink-800">
            {!preview.data ? (
              <SkeletonRows rows={6} />
            ) : (
              ACCOUNT_TYPES.map((type) => {
                const rows = preview.data.filter((a) => a.type === type);
                if (!rows.length) return null;
                // Parents first in the data; show each under its parent, ordered by code
                const ordered: typeof rows = [];
                const walk = (parent?: string) => {
                  for (const a of rows.filter((r) => r.parent === parent).sort((x, y) => x.code.localeCompare(y.code, 'en', { numeric: true }))) {
                    ordered.push(a);
                    walk(a.code);
                  }
                };
                walk(undefined);
                return (
                  <section key={type}>
                    <h3 className="sticky top-0 border-b border-ink-100 bg-ink-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400 dark:border-ink-800 dark:bg-ink-900">
                      {t(`accounts.typesPlural.${type}`)}
                    </h3>
                    <ul className="divide-y divide-ink-100 text-sm dark:divide-ink-800">
                      {ordered.map((a) => (
                        <li key={a.code} className={clsx('flex gap-3 py-1.5 pe-3', depthOf(a.code, preview.data) === 0 && 'font-medium')} style={{ paddingInlineStart: `${12 + depthOf(a.code, preview.data) * 20}px` }}>
                          <code className="w-20 shrink-0 text-xs text-ink-400" dir="ltr">
                            {a.code}
                          </code>
                          <span dir="auto">{a.name}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Modal>
  );
}
