import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import Button from './Button';
import { inputClass } from './Field';
import Modal from './Modal';

/** "Are you sure?" with an optional reason that is stored in the audit log. */
export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  tone = 'primary',
  askReason = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  askReason?: boolean;
  busy?: boolean;
  onConfirm: (reason?: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={body}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant={tone} loading={busy} onClick={() => onConfirm(reason.trim() || undefined)} data-autofocus={askReason ? undefined : true}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {askReason && (
        <label className="block text-sm font-medium">
          {t('common.reasonOptional')}
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={3}
            data-autofocus
            className={`${inputClass} mt-1.5 h-auto border-ink-200 py-2 dark:border-ink-700`}
          />
          <span className="mt-1 block text-xs font-normal text-ink-500">{t('common.reasonHint')}</span>
        </label>
      )}
    </Modal>
  );
}
