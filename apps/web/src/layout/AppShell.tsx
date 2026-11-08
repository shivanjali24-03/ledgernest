import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { ChevronsLeft, Menu, Search } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { BUILT_IN_ROLE_IDS, type BuiltInRoleId } from '@ledgernest/shared';
import { page, spring } from '../motion/tokens';
import CommandPalette from './CommandPalette';
import Logo from './Logo';
import { visibleNav } from './nav';
import LanguageSwitcher from './LanguageSwitcher';
import { roleLabel, useSession } from './session';
import ThemeToggle from './ThemeToggle';
import UserMenu from './UserMenu';

export default function AppShell() {
  const session = useSession();
  const { t, i18n } = useTranslation();
  const rtl = i18n.dir() === 'rtl';
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { setRole } = session;
  const groups = useMemo(() => visibleNav(session.permissions), [session.permissions]);

  // ⌘/Ctrl+K opens the command palette from anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const sidebar = (
    <nav aria-label={t('shell.mainNav')} className="flex h-full flex-col gap-1 px-3 py-4">
      <div className={clsx('mb-4 flex items-center gap-2.5 px-2', collapsed && 'lg:justify-center lg:px-0')}>
        <Logo className="size-9 shrink-0" />
        {!collapsed && <span className="text-[17px] font-bold tracking-tight">LedgerNest</span>}
      </div>
      <LayoutGroup id="nav">
        <div className="flex-1 space-y-5 overflow-y-auto">
          {groups.map((g) => (
            <div key={g.labelKey}>
              {!collapsed && <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-400">{t(g.labelKey)}</p>}
              <ul className="space-y-0.5">
                {g.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end ?? item.to === '/'}
                      title={collapsed ? t(item.labelKey) : undefined}
                      onClick={() => setMobileOpen(false)}
                      className={({ isActive }) =>
                        clsx(
                          'relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
                          collapsed && 'lg:justify-center lg:px-0',
                          isActive ? 'text-brand-800 dark:text-brand-100' : 'text-ink-600 hover:text-ink-900 dark:text-ink-300 dark:hover:text-white',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {/* One pill shared by all items: it glides to the active one (transform only) */}
                          {isActive && (
                            <motion.span
                              layoutId="nav-pill"
                              transition={spring.glide}
                              className="absolute inset-0 rounded-xl bg-brand-100/80 dark:bg-brand-900/60"
                              aria-hidden
                            />
                          )}
                          <item.icon className="relative size-[18px] shrink-0" aria-hidden />
                          {!collapsed && <span className="relative flex-1 truncate">{t(item.labelKey)}</span>}
                          {!collapsed && !item.ready && (
                            <span className="relative rounded-md bg-ink-100 px-1.5 py-0.5 text-[10px] font-semibold text-ink-500 dark:bg-ink-800">{t('nav.soon')}</span>
                          )}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </LayoutGroup>
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="mt-2 hidden h-9 items-center gap-2 rounded-xl px-3 text-sm text-ink-500 hover:bg-ink-100 lg:flex dark:hover:bg-ink-800"
        aria-label={collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')}
      >
        <motion.span animate={{ rotate: collapsed ? 180 : 0 }} transition={spring.snappy} className="inline-flex">
          {/* Mirror for right-to-left on a separate element, so it doesn't fight the rotation */}
          <ChevronsLeft className="size-4 rtl:-scale-x-100" />
        </motion.span>
        {!collapsed && t('shell.collapse')}
      </button>
    </nav>
  );

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Desktop sidebar */}
      <aside
        className={clsx(
          // Width changes instantly (animating width would re-layout every frame); the content fades instead
          'hidden shrink-0 border-e border-ink-200 bg-white/70 backdrop-blur-xl lg:block dark:border-ink-800 dark:bg-ink-900/60',
          collapsed ? 'w-[76px]' : 'w-64',
        )}
      >
        {sidebar}
      </aside>

      {/* Mobile drawer: slides with transform */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div className="fixed inset-0 z-40 bg-ink-950/40 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileOpen(false)} />
            <motion.aside
              className="fixed inset-y-0 start-0 z-50 w-72 bg-white shadow-pop lg:hidden dark:bg-ink-900"
              initial={{ x: rtl ? '100%' : '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: rtl ? '100%' : '-100%' }}
              transition={spring.gentle}
            >
              {sidebar}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-ink-200 bg-white/70 px-4 backdrop-blur-xl lg:px-6 dark:border-ink-800 dark:bg-ink-900/60">
          <button className="rounded-xl p-2 hover:bg-ink-100 lg:hidden dark:hover:bg-ink-800" onClick={() => setMobileOpen(true)} aria-label={t('shell.openMenu')}>
            <Menu className="size-5" />
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold" dir="auto">
              {session.organization ?? t('auth.platform')}
            </p>
            <p className="truncate text-xs text-ink-500" dir="auto">
              {roleLabel(session, t)}
            </p>
          </div>

          <button
            onClick={() => setPaletteOpen(true)}
            className="ms-auto hidden h-10 w-72 items-center gap-2 rounded-xl border border-ink-200 bg-ink-50 px-3 text-sm text-ink-400 hover:border-ink-300 md:flex dark:border-ink-700 dark:bg-ink-800/60"
          >
            <Search className="size-4" /> {t('shell.search')}
            <kbd className="ms-auto rounded-md border border-ink-200 px-1.5 text-[11px] dark:border-ink-600">⌘K</kbd>
          </button>
          <button className="ms-auto rounded-xl p-2 hover:bg-ink-100 md:hidden dark:hover:bg-ink-800" onClick={() => setPaletteOpen(true)} aria-label={t('shell.search')}>
            <Search className="size-5" />
          </button>

          {/* Role preview exists only in the demo; with real data the server decides */}
          {setRole && (
          <label className="hidden items-center gap-2 text-xs text-ink-500 sm:flex">
            <span>{t('shell.previewAs')}</span>
            <select
              value={session.role ?? undefined}
              onChange={(e) => setRole(e.target.value as BuiltInRoleId)}
              className="h-9 rounded-xl border border-ink-200 bg-white px-2 text-sm text-ink-800 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-100"
              aria-label={t('shell.previewAsLabel')}
            >
              {BUILT_IN_ROLE_IDS.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </select>
          </label>
          )}

          <LanguageSwitcher />
          <ThemeToggle />
          <UserMenu />
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={location.pathname} variants={page} initial="hidden" animate="show" exit="exit" className="mx-auto max-w-7xl p-4 lg:p-8">
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} groups={groups} />
    </div>
  );
}
