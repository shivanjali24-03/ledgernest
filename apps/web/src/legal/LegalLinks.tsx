import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';

/** Privacy · Terms, for the foot of public pages */
export default function LegalLinks({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('legal.nav')} className={`flex items-center justify-center gap-3 text-xs text-ink-500 ${className}`}>
      <Link to="/privacy" className="hover:underline">
        {t('legal.privacy')}
      </Link>
      <span aria-hidden>·</span>
      <Link to="/terms" className="hover:underline">
        {t('legal.terms')}
      </Link>
    </nav>
  );
}
