import { useCallback, useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'ledgernest.theme';

const read = (): ThemeChoice => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
};

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

/** Applies the theme to <html data-theme> and follows the OS when set to "system". */
export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(read);
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => (choice === 'system' ? (systemDark() ? 'dark' : 'light') : choice));

  useEffect(() => {
    const apply = () => {
      const next = choice === 'system' ? (systemDark() ? 'dark' : 'light') : choice;
      setResolved(next);
      document.documentElement.dataset.theme = next;
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [choice]);

  const set = useCallback((next: ThemeChoice) => {
    setChoice(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* storage unavailable: theme still applies for this session */
    }
  }, []);

  return { choice, resolved, set, toggle: () => set(resolved === 'dark' ? 'light' : 'dark') };
}
