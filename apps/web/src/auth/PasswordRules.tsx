import { Check, Circle } from 'lucide-react';
import clsx from 'clsx';
import { passwordProblems, type PasswordProblem } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';

const RULES: PasswordProblem[] = ['too_short', 'needs_lowercase', 'needs_uppercase', 'needs_number'];

/** The password rules, ticked off as they're met (the same rules the API checks) */
export default function PasswordRules({ password, id }: { password: string; id?: string }) {
  const { t } = useTranslation();
  const problems = new Set(passwordProblems(password));
  return (
    <ul id={id} className="mt-2 grid grid-cols-2 gap-1 text-xs">
      {RULES.map((r) => {
        const ok = password.length > 0 && !problems.has(r);
        return (
          <li key={r} className={clsx('flex items-center gap-1.5', ok ? 'text-income' : 'text-ink-500')}>
            {ok ? <Check className="size-3.5" aria-hidden /> : <Circle className="size-3.5" aria-hidden />}
            {t(`invite.rules.${r}`)}
            <span className="sr-only">{ok ? t('invite.rules.met') : t('invite.rules.notMet')}</span>
          </li>
        );
      })}
    </ul>
  );
}
