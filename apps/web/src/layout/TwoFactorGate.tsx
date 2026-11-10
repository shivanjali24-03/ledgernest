import { useContext, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ApiClientContext } from '../auth/apiClientContext';
import { AuthContext } from '../auth/context';
import TwoFactorDialog from '../auth/TwoFactorDialog';
import Button from '../ui/Button';
import { Card } from '../ui/Kit';

/** In place of every page while the organisation requires two-factor sign-in and this person hasn't set it up */
export default function TwoFactorGate({ organization }: { organization: string | null }) {
  const { t } = useTranslation();
  const client = useContext(ApiClientContext);
  const auth = useContext(AuthContext);
  const [open, setOpen] = useState(false);
  return (
    <Card className="mx-auto mt-10 max-w-lg p-8 text-center">
      <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200">
        <ShieldCheck className="size-6" aria-hidden />
      </div>
      <h1 className="mt-4 text-xl font-semibold">{t('twoFactor.gate.title')}</h1>
      <p className="mt-2 text-sm text-ink-500">{t('twoFactor.gate.body', { organization: organization ?? '' })}</p>
      <div className="mt-6 flex justify-center gap-2">
        <Button onClick={() => setOpen(true)} disabled={!client}>
          {t('twoFactor.setUp')}
        </Button>
        <Button variant="ghost" onClick={() => void auth?.signOut()}>
          {t('twoFactor.gate.signOut')}
        </Button>
      </div>
      {open && client && (
        <TwoFactorDialog
          client={client}
          onClose={() => {
            setOpen(false);
            // Turned on: the organisation opens
            void auth?.reload();
          }}
        />
      )}
    </Card>
  );
}
