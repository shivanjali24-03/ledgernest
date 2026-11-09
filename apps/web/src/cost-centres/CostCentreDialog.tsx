import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { COST_CENTRE_KINDS, type CostCentreKind } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import Button from '../ui/Button';
import { SelectField, TextField } from '../ui/Field';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import { costCentreErrorMessage } from './errors';
import type { CostCentre, CostCentresApi } from './types';

/** Add a cost centre or project, or change one */
export default function CostCentreDialog({ api, centre, onClose }: { api: CostCentresApi; centre?: CostCentre; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [code, setCode] = useState(centre?.code ?? '');
  const [name, setName] = useState(centre?.name ?? '');
  const [kind, setKind] = useState<CostCentreKind>(centre?.kind ?? 'department');
  const [description, setDescription] = useState(centre?.description ?? '');
  const codeOk = /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(code.trim());
  const save = useMutation({
    mutationFn: () => {
      const input = { code: code.trim(), name: name.trim(), kind, description: description.trim() || null };
      return centre ? api.update(centre.id, input) : api.create(input);
    },
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['cost-centres'] });
      toast(t(centre ? 'costCentres.updated' : 'costCentres.added', { name: c.name }));
      onClose();
    },
    onError: (e) => toast(costCentreErrorMessage(e, t), 'error'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (codeOk && name.trim()) save.mutate();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t(centre ? 'costCentres.editTitle' : 'costCentres.addTitle')}
      description={t('costCentres.dialogBody')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="cost-centre-form" loading={save.isPending} disabled={!codeOk || !name.trim()}>
            {t(centre ? 'common.save' : 'costCentres.add')}
          </Button>
        </>
      }
    >
      <form id="cost-centre-form" onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-2">
        <TextField label={t('costCentres.fields.code')} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={20} dir="ltr" className="font-mono" hint={t('costCentres.codeHint')} error={code && !codeOk ? t('costCentres.codeInvalid') : undefined} data-autofocus />
        <SelectField label={t('costCentres.fields.kind')} value={kind} onChange={(e) => setKind(e.target.value as CostCentreKind)} options={COST_CENTRE_KINDS.map((k) => ({ value: k, label: t(`costCentres.kinds.${k}`) }))} />
        <div className="sm:col-span-2">
          <TextField label={t('costCentres.fields.name')} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} dir="auto" />
        </div>
        <div className="sm:col-span-2">
          <TextField label={t('costCentres.fields.description')} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} dir="auto" />
        </div>
      </form>
    </Modal>
  );
}
