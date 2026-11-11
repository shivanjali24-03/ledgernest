import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '../i18n';

/** Native select: accessible, works on every device, and shows each language in its own script. Icon only on phones. */
export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  return (
    <label className="relative flex items-center rounded-xl hover:bg-ink-100 dark:hover:bg-ink-800">
      <Languages className="pointer-events-none absolute start-2.5 size-5 text-ink-600 sm:start-2 dark:text-ink-300" aria-hidden />
      <select
        value={i18n.language}
        onChange={(e) => void i18n.changeLanguage(e.target.value)}
        aria-label={t('shell.language')}
        className="h-10 w-10 cursor-pointer appearance-none overflow-hidden bg-transparent ps-10 text-sm font-medium outline-none sm:h-9 sm:w-auto sm:ps-9 sm:pe-2"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}
