import { Link } from 'react-router';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import type { EinvoiceProblem } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import type { Invoice } from './types';

/** What the e-invoice portal would refuse on this invoice, each with where to fix it */
export default function EinvoiceProblemsDialog({ invoice, problems, onClose }: { invoice: Invoice; problems: EinvoiceProblem[]; onClose: () => void }) {
  const { t } = useTranslation();
  const where = (p: EinvoiceProblem): { text: string; to?: string } => {
    if ('party' in p) return { text: t(`invoices.einvoice.problems.${p.code}_${p.party}`), to: p.party === 'seller' ? '/settings' : `/contacts/${invoice.contact.id}` };
    if (p.code === 'hsn') {
      const line = invoice.lines[p.line - 1];
      return { text: t('invoices.einvoice.problems.hsn', { line: p.line, description: line?.description ?? '' }), to: line?.item ? '/items' : undefined };
    }
    return { text: t(`invoices.einvoice.problems.${p.code}`) };
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t('invoices.einvoice.problemsTitle')}
      description={t('invoices.einvoice.problemsBody')}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      <ul className="divide-y divide-ink-100 text-sm dark:divide-ink-800">
        {problems.map((p, n) => {
          const w = where(p);
          return (
            <li key={n} className="flex items-start gap-2 py-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <span className="flex-1">{w.text}</span>
              {w.to && (
                <Link to={w.to} onClick={onClose} className="inline-flex shrink-0 items-center text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
                  {t('invoices.einvoice.fix')} <ChevronRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
