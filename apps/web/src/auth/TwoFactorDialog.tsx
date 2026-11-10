import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { saveBlob } from '../lib/saveBlob';
import { apiErrorMessage } from '../platform/errors';
import Button from '../ui/Button';
import { TextField } from '../ui/Field';
import { SkeletonRows } from '../ui/Kit';
import Modal from '../ui/Modal';
import UpiQr from '../ui/UpiQr';
import { useToast } from '../ui/toastContext';
import { ApiError, type AuthClient } from './client';

type Step = { kind: 'status' } | { kind: 'password' } | { kind: 'scan'; secret: string; uri: string } | { kind: 'codes'; codes: string[] } | { kind: 'regenerate' } | { kind: 'disable' };

/**
 * Two-factor sign-in with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…): turn it on by
 * scanning a QR code and entering a code, keep the ten recovery codes, make new ones, or turn it off.
 */
export default function TwoFactorDialog({ client, onClose }: { client: AuthClient; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['two-factor'], queryFn: () => client.twoFactor.status() });
  const [step, setStep] = useState<Step>({ kind: 'status' });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fail = (e: unknown) => {
    const reason = e instanceof ApiError ? (e.details?.reason as string | undefined) : undefined;
    setError(reason === 'wrong_password' ? t('twoFactor.errors.password') : reason === 'wrong_code' ? t('twoFactor.errors.code') : apiErrorMessage(e, t));
  };
  const go = (s: Step) => {
    setStep(s);
    setPassword('');
    setCode('');
    setError(null);
  };
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['two-factor'] });
  const setup = useMutation({ mutationFn: () => client.twoFactor.setup(password), onSuccess: (s) => go({ kind: 'scan', ...s }), onError: fail });
  const enable = useMutation({
    mutationFn: () => client.twoFactor.enable(code.replace(/\s/g, '')),
    onSuccess: (r) => {
      refresh();
      toast(t('twoFactor.enabled'));
      go({ kind: 'codes', codes: r.recoveryCodes });
    },
    onError: fail,
  });
  const regenerate = useMutation({
    mutationFn: () => client.twoFactor.recoveryCodes(code),
    onSuccess: (r) => {
      refresh();
      go({ kind: 'codes', codes: r.recoveryCodes });
    },
    onError: fail,
  });
  const disable = useMutation({
    mutationFn: () => client.twoFactor.disable(password, code),
    onSuccess: () => {
      refresh();
      toast(t('twoFactor.disabled'));
      go({ kind: 'status' });
    },
    onError: fail,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (step.kind === 'password') setup.mutate();
    else if (step.kind === 'scan') enable.mutate();
    else if (step.kind === 'regenerate') regenerate.mutate();
    else if (step.kind === 'disable') disable.mutate();
  };
  const busy = setup.isPending || enable.isPending || regenerate.isPending || disable.isPending;
  const codesText = step.kind === 'codes' ? `${t('twoFactor.codesFileTitle')}\n\n${step.codes.join('\n')}\n` : '';
  const primary = { password: t('twoFactor.continue'), scan: t('twoFactor.turnOn'), regenerate: t('twoFactor.makeCodes'), disable: t('twoFactor.turnOff') } as const;

  return (
    <Modal
      open
      onClose={onClose}
      title={t('twoFactor.title')}
      description={t('twoFactor.body')}
      footer={
        step.kind === 'status' || step.kind === 'codes' ? (
          <Button variant="secondary" onClick={step.kind === 'codes' ? () => go({ kind: 'status' }) : onClose}>
            {step.kind === 'codes' ? t('twoFactor.saved') : t('common.close')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => go({ kind: 'status' })}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="two-factor-form" loading={busy} variant={step.kind === 'disable' ? 'danger' : 'primary'}>
              {primary[step.kind]}
            </Button>
          </>
        )
      }
    >
      {step.kind === 'status' ? (
        !status.data ? (
          <SkeletonRows rows={2} />
        ) : status.data.enabled ? (
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-income">
              <ShieldCheck className="size-4" aria-hidden /> {t('twoFactor.isOn')}
            </p>
            <p className="text-ink-500">{t('twoFactor.codesLeft', { count: status.data.recoveryCodesLeft })}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => go({ kind: 'regenerate' })}>
                {t('twoFactor.newCodes')}
              </Button>
              <Button variant="ghost" onClick={() => go({ kind: 'disable' })}>
                {t('twoFactor.turnOff')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="text-ink-600 dark:text-ink-300">{t('twoFactor.isOff')}</p>
            <Button onClick={() => go({ kind: 'password' })}>{t('twoFactor.setUp')}</Button>
          </div>
        )
      ) : step.kind === 'codes' ? (
        <div className="space-y-3 text-sm">
          <p>{t('twoFactor.codesBody')}</p>
          <ul aria-label={t('twoFactor.codesLabel')} className="grid grid-cols-2 gap-2 rounded-xl bg-ink-50 p-3 font-mono dark:bg-ink-900" dir="ltr">
            {step.codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" icon={<Copy className="size-4" />} onClick={() => void navigator.clipboard?.writeText(codesText).then(() => toast(t('twoFactor.copied')))}>
              {t('twoFactor.copy')}
            </Button>
            <Button variant="secondary" size="sm" icon={<Download className="size-4" />} onClick={() => saveBlob({ blob: new Blob([codesText], { type: 'text/plain' }), filename: 'ledgernest-recovery-codes.txt' })}>
              {t('twoFactor.download')}
            </Button>
          </div>
        </div>
      ) : (
        <form id="two-factor-form" onSubmit={submit} noValidate className="space-y-3">
          {step.kind === 'scan' && (
            <div className="flex flex-col items-center gap-3 text-sm sm:flex-row sm:items-start">
              <UpiQr value={step.uri} label={t('twoFactor.qrLabel')} size={152} />
              <div className="space-y-2">
                <p>{t('twoFactor.scan')}</p>
                <p className="text-xs text-ink-500">{t('twoFactor.manual')}</p>
                <code className="block break-all rounded-lg bg-ink-50 px-2 py-1 font-mono text-xs dark:bg-ink-900" dir="ltr">
                  {step.secret.replace(/(.{4})/g, '$1 ').trim()}
                </code>
              </div>
            </div>
          )}
          {(step.kind === 'password' || step.kind === 'disable') && <TextField label={t('twoFactor.password')} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />}
          {step.kind !== 'password' && (
            <TextField
              label={step.kind === 'scan' ? t('twoFactor.codeFromApp') : t('twoFactor.codeOrRecovery')}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode={step.kind === 'scan' ? 'numeric' : undefined}
              autoComplete="one-time-code"
              dir="ltr"
              className="font-mono tracking-widest"
              autoFocus={step.kind !== 'disable'}
            />
          )}
          {error && (
            <p role="alert" className="text-sm text-expense">
              {error}
            </p>
          )}
        </form>
      )}
    </Modal>
  );
}
