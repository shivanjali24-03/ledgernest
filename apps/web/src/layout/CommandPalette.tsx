import { useDeferredValue, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { Contact as ContactIcon, CornerDownLeft, FileSignature, FileText, Receipt, Search, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { scaleIn, fadeIn } from '../motion/tokens';
import { useBillsApi } from '../bills/useBillsApi';
import { useContactsApi } from '../contacts/useContactsApi';
import { useInvoicesApi } from '../invoices/useInvoicesApi';
import { useQuotesApi } from '../quotes/useQuotesApi';
import type { NavGroup } from './nav';
import { useSession } from './session';

type Result = { to: string; label: string; group: string; icon: LucideIcon; sub?: string };
const PER_KIND = 4;

/** ⌘/Ctrl+K palette: jump to any page you can access, by name or keyword, or find a contact, invoice, quote or bill. */
export default function CommandPalette({ open, onClose, groups }: { open: boolean; onClose: () => void; groups: NavGroup[] }) {
  return <AnimatePresence>{open && <PaletteBody key="palette" onClose={onClose} groups={groups} />}</AnimatePresence>;
}

// Mounted only while open, so the search starts empty every time without a reset effect
function PaletteBody({ onClose, groups }: { onClose: () => void; groups: NavGroup[] }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const { t } = useTranslation();

  const pages = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    const all = groups.flatMap((g) => g.items.map((i) => ({ to: i.to, icon: i.icon, keywords: i.keywords, label: t(i.labelKey), group: t(g.labelKey) })));
    // Search the translated name, plus English keywords so shortcuts work in any language
    return q ? all.filter((i) => `${i.label} ${i.group} ${i.keywords ?? ''}`.toLowerCase().includes(q)) : all;
  }, [groups, query, t]);

  // Documents too, from two characters on, each kind only for people who can see it
  const session = useSession();
  const can = (p: Parameters<typeof session.permissions.has>[0]) => session.permissions.has(p);
  const deferred = useDeferredValue(query.trim());
  const searching = deferred.length >= 2 && !!session.organizationId;
  const contactsApi = useContactsApi();
  const invoicesApi = useInvoicesApi();
  const quotesApi = useQuotesApi();
  const billsApi = useBillsApi();
  const key = (kind: string) => ['palette', session.organizationId, session.role ?? session.customRoleName, kind, deferred];
  const contacts = useQuery({ queryKey: key('contacts'), queryFn: () => contactsApi!.list({ search: deferred, page: 1, pageSize: PER_KIND }), enabled: searching && !!contactsApi && can('contacts.view') });
  const invoices = useQuery({ queryKey: key('invoices'), queryFn: () => invoicesApi!.list({ search: deferred, page: 1, pageSize: PER_KIND }), enabled: searching && !!invoicesApi && can('invoices.view') });
  const quotes = useQuery({ queryKey: key('quotes'), queryFn: () => quotesApi!.list({ search: deferred, page: 1, pageSize: PER_KIND }), enabled: searching && !!quotesApi && can('invoices.view') });
  const bills = useQuery({ queryKey: key('bills'), queryFn: () => billsApi!.list({ search: deferred, page: 1, pageSize: PER_KIND }), enabled: searching && !!billsApi && can('bills.view') });
  const results = useMemo<Result[]>(() => {
    if (!searching) return pages;
    const docs: Result[] = [
      ...(contacts.data?.items ?? []).map((c) => ({ to: `/contacts/${c.id}`, label: c.name, group: t('palette.kinds.contact'), icon: ContactIcon, sub: c.legalName ?? undefined })),
      ...(invoices.data?.items ?? []).map((i) => ({ to: `/invoices/${i.id}`, label: i.number ?? t('invoices.draft'), group: t('palette.kinds.invoice'), icon: FileText, sub: i.contact.name })),
      ...(quotes.data?.items ?? []).map((q) => ({ to: `/quotes/${q.id}`, label: q.number, group: t('palette.kinds.quote'), icon: FileSignature, sub: q.contact.name })),
      ...(bills.data?.items ?? []).map((b) => ({ to: `/bills/${b.id}`, label: b.number ?? t('invoices.draft'), group: t('palette.kinds.bill'), icon: Receipt, sub: b.contact.name })),
    ];
    return [...pages, ...docs];
  }, [searching, pages, contacts.data, invoices.data, quotes.data, bills.data, t]);

  const go = (to: string) => {
    onClose();
    navigate(to);
  };

  return (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink-950/40 p-4 pt-[12vh] backdrop-blur-sm"
          variants={fadeIn}
          initial="hidden"
          animate="show"
          exit="hidden"
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={t('palette.title')}
            className="w-full max-w-xl overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-pop dark:border-ink-800 dark:bg-ink-900"
            variants={scaleIn}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              }
              if (e.key === 'Enter' && results[active]) go(results[active].to);
            }}
          >
            <div className="flex items-center gap-3 border-b border-ink-100 px-4 dark:border-ink-800">
              <Search className="size-4 text-ink-400" aria-hidden />
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                placeholder={t('palette.placeholder')}
                aria-label={t('shell.search')}
                className="h-14 w-full bg-transparent text-[15px] outline-none placeholder:text-ink-400"
              />
              <kbd className="rounded-md border border-ink-200 px-1.5 py-0.5 text-[11px] text-ink-500 dark:border-ink-700">Esc</kbd>
            </div>
            <ul className="max-h-80 overflow-y-auto p-2" role="listbox" aria-label={t('palette.results')}>
              {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-500">{t('palette.noMatches', { query })}</li>}
              {results.map((r, i) => (
                <li key={`${r.group}-${r.to}`} role="option" aria-selected={i === active}>
                  <button
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(r.to)}
                    className={clsx(
                      'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm',
                      i === active ? 'bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-200' : 'text-ink-700 dark:text-ink-200',
                    )}
                  >
                    <r.icon className="size-4 shrink-0 opacity-70" aria-hidden />
                    <span className="flex-1 truncate">
                      <span className="font-medium" dir="auto">
                        {r.label}
                      </span>
                      {r.sub && (
                        <span className="ms-2 text-xs text-ink-400" dir="auto">
                          {r.sub}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-ink-400">{r.group}</span>
                    {i === active && <CornerDownLeft className="size-3.5 text-ink-400" aria-hidden />}
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
  );
}
