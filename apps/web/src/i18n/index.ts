import i18n from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import en from './locales/en.json';
import hi from './locales/hi.json';
import mr from './locales/mr.json';

/**
 * The languages offered: LedgerNest is for India for now, so English, Hindi and Marathi.
 * `name` is shown in its own script; `locale` drives number, money and date formats.
 *
 * Spanish, French, German and Arabic (right-to-left) translations stay in ./locales for when the app
 * goes beyond India; they are neither offered nor bundled. To bring one back, import its file, add it
 * here (Arabic with dir 'rtl') and to RESOURCES, and fill in any keys added since.
 */
export const LANGUAGES = [
  { code: 'en', name: 'English', dir: 'ltr', locale: 'en-IN' },
  { code: 'hi', name: 'हिन्दी', dir: 'ltr', locale: 'hi-IN' },
  { code: 'mr', name: 'मराठी', dir: 'ltr', locale: 'mr-IN' },
] as const satisfies readonly { code: string; name: string; dir: 'ltr' | 'rtl'; locale: string }[];

export type LanguageCode = (typeof LANGUAGES)[number]['code'];
export const RESOURCES = { en, hi, mr } satisfies Record<LanguageCode, unknown>;

const KEY = 'ledgernest.lang';
const isSupported = (c: string | null | undefined): c is LanguageCode => !!c && LANGUAGES.some((l) => l.code === c);
export const languageInfo = (code: string) => LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];

/** Saved choice first, then the browser's preferred languages, then English. */
function detect(): LanguageCode {
  try {
    const saved = localStorage.getItem(KEY);
    if (isSupported(saved)) return saved;
  } catch {
    /* storage unavailable */
  }
  for (const pref of navigator.languages ?? [navigator.language]) {
    const base = pref?.slice(0, 2).toLowerCase();
    if (isSupported(base)) return base;
  }
  return 'en';
}

/** Keep <html lang> and <html dir> in sync, so screen readers and right-to-left layout work. */
function applyToDocument(code: string) {
  const info = languageInfo(code);
  document.documentElement.lang = info.code;
  document.documentElement.dir = info.dir;
}

void i18n.use(initReactI18next).init({
  resources: Object.fromEntries(Object.entries(RESOURCES).map(([code, translation]) => [code, { translation }])),
  lng: detect(),
  fallbackLng: 'en',
  supportedLngs: LANGUAGES.map((l) => l.code),
  interpolation: { escapeValue: false }, // React already escapes output
});

applyToDocument(i18n.language);
i18n.on('languageChanged', (code) => {
  applyToDocument(code);
  try {
    localStorage.setItem(KEY, code);
  } catch {
    /* storage unavailable: language still applies for this session */
  }
});

/** The Intl locale for the current language, for money, number and date formatting. */
export function useIntlLocale(): string {
  const { i18n: instance } = useTranslation();
  return languageInfo(instance.language).locale;
}

export default i18n;
