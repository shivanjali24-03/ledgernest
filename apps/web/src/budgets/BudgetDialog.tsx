import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useCostCentres } from '../cost-centres/useCostCentresApi';
import { useSession } from '../layout/session';
import { usePeriodsApi } from '../periods/usePeriodsApi';
import Button from '../ui/Button';
import { SelectField, TextField } from '../ui/Field';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import { budgetErrorMessage } from './errors';
import type { BudgetGrid, BudgetsApi, BudgetSummary } from './types';

type Start = 'actuals' | 'budget' | 'empty';

/** Start a budget for a financial year: from last year's actuals or another budget (up or down by a percentage), or blank */
export function NewBudgetDialog({ api, budgets, onClose, onDone }: { api: BudgetsApi; budgets: BudgetSummary[]; onClose: () => void; onDone: (b: BudgetGrid) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const session = useSession();
  const periods = usePeriodsApi();
  const years = useQuery({ queryKey: ['periods', session.organizationId, session.role ?? session.customRoleName], queryFn: () => periods!.list(), enabled: !!periods });
  const all = years.data?.years ?? [];
  const current = all.find((y) => y.current) ?? all.at(-1);
  const [yearId, setYear] = useState('');
  const year = yearId || current?.id || '';
  const yearName = all.find((y) => y.id === year)?.name ?? '';
  const [name, setName] = useState('');
  const [startFrom, setStart] = useState<Start>('actuals');
  const [budgetId, setBudget] = useState('');
  const [adjust, setAdjust] = useState('0');
  const centres = (useCostCentres().data ?? []).filter((c) => !c.archived);
  const [costCentreId, setCostCentre] = useState('');
  const pct = Number(adjust.replace(',', '.'));
  const problem = !year ? 'year' : startFrom === 'budget' && !(budgetId || budgets[0]?.id) ? 'budget' : !Number.isFinite(pct) || pct < -100 || pct > 1000 ? 'adjust' : null;
  const save = useMutation({
    mutationFn: () => api.create({ name: name.trim() || t('budgets.defaultName', { year: yearName }), fiscalYearId: year, startFrom, budgetId: startFrom === 'budget' ? budgetId || budgets[0]!.id : null, adjustPercent: startFrom === 'empty' ? 0 : pct, costCentreId: costCentreId || null }),
    onSuccess: (b) => {
      void qc.invalidateQueries({ queryKey: ['budgets'] });
      toast(t('budgets.created', { name: b.name }));
      onDone(b);
    },
    onError: (e) => toast(budgetErrorMessage(e, t), 'error'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (problem) return toast(t(`budgets.problems.${problem}`), 'error');
    save.mutate();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t('budgets.newTitle')}
      description={t('budgets.newBody')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="budget-form" loading={save.isPending} disabled={!!problem}>
            {t('budgets.create')}
          </Button>
        </>
      }
    >
      <form id="budget-form" onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-2">
        <SelectField label={t('budgets.fields.year')} value={year} onChange={(e) => setYear(e.target.value)} options={all.length ? [...all].reverse().map((y) => ({ value: y.id, label: y.name })) : [{ value: '', label: t('budgets.noYears') }]} />
        <TextField label={t('budgets.fields.name')} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('budgets.defaultName', { year: yearName })} maxLength={120} dir="auto" data-autofocus />
        <SelectField
          label={t('budgets.fields.startFrom')}
          value={startFrom}
          onChange={(e) => setStart(e.target.value as Start)}
          options={[
            { value: 'actuals', label: t('budgets.start.actuals') },
            { value: 'budget', label: t('budgets.start.budget'), disabled: !budgets.length },
            { value: 'empty', label: t('budgets.start.empty') },
          ]}
        />
        {startFrom !== 'empty' && <TextField label={t('budgets.fields.adjust')} hint={t('budgets.adjustHint')} value={adjust} onChange={(e) => setAdjust(e.target.value)} inputMode="decimal" dir="ltr" className="text-end font-mono" />}
        {centres.length > 0 && (
          <div className="sm:col-span-2">
            <SelectField label={t('budgets.fields.costCentre')} hint={t('budgets.costCentreHint')} value={costCentreId} onChange={(e) => setCostCentre(e.target.value)} options={[{ value: '', label: t('budgets.wholeOrganisation') }, ...centres.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))]} />
          </div>
        )}
        {startFrom === 'budget' && (
          <div className="sm:col-span-2">
            <SelectField label={t('budgets.fields.budget')} value={budgetId || budgets[0]?.id || ''} onChange={(e) => setBudget(e.target.value)} options={budgets.map((b) => ({ value: b.id, label: `${b.name} · ${b.fiscalYear.name}` }))} />
          </div>
        )}
      </form>
    </Modal>
  );
}

/** Give a budget another name */
export function RenameBudgetDialog({ api, budget, onClose }: { api: BudgetsApi; budget: { id: string; name: string }; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(budget.name);
  const save = useMutation({
    mutationFn: () => api.rename(budget.id, name.trim()),
    onSuccess: (b) => {
      void qc.invalidateQueries({ queryKey: ['budgets'] });
      toast(t('budgets.renamed', { name: b.name }));
      onClose();
    },
    onError: (e) => toast(budgetErrorMessage(e, t), 'error'),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t('budgets.renameTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="budget-rename" loading={save.isPending} disabled={!name.trim()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form id="budget-rename" onSubmit={(e) => (e.preventDefault(), name.trim() && save.mutate())} noValidate>
        <TextField label={t('budgets.fields.name')} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} dir="auto" data-autofocus />
      </form>
    </Modal>
  );
}
