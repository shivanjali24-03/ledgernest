import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '../i18n';

/** Native select: accessible, works on every device, and shows each language in its own script. */
export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  return (
    <label className="relative flex items-center rounded-xl hover:bg-ink-100 dark:hover:bg-ink-800">
      <Languages className="pointer-events-none absolute start-2 size-5 text-ink-600 dark:text-ink-300" aria-hidden />
      <select
        value={i18n.language}
        onChange={(e) => void i18n.changeLanguage(e.target.value)}
        aria-label={t('shell.language')}
        className="h-9 cursor-pointer appearance-none bg-transparent ps-9 pe-2 text-sm font-medium outline-none"
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
