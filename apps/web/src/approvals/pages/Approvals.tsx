import { useState } from 'react';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Building2, Check, HandCoins, Landmark, Receipt, Undo2, UserCheck, X } from 'lucide-react';
import clsx from 'clsx';
import { APPROVAL_DOCUMENTS, toMinor, type ApprovalDocument } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useIntlLocale } from '../../i18n';
import { formatDate, formatRelative } from '../../lib/format';
import { useMoney } from '../../lib/useMoney';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import Button from '../../ui/Button';
import { TextField } from '../../ui/Field';
import { Card, EmptyState, ErrorState, PageHeader, Pill, Segmented, SkeletonRows } from '../../ui/Kit';
import Modal from '../../ui/Modal';
import { useToast } from '../../ui/toastContext';
import { approvalErrorMessage } from '../errors';
import type { ApprovalRequest, ApprovalRule, ApprovalsApi } from '../types';
import { useApprovalsApi } from '../useApprovalsApi';

type View = 'pending' | 'history';
const ICON = { journal: BookOpen, bill: Receipt, payment: HandCoins, bank_spend: Landmark } as const;

/** Approvals: what's waiting for a yes, what was decided, and the rules that hold documents. */
export default function Approvals() {
  const { t } = useTranslation();
  const session = useSession();
  const api = useApprovalsApi();
  const [view, setView] = useState<View>('pending');
  const [deciding, setDeciding] = useState<{ r: ApprovalRequest; approve: boolean } | null>(null);
  const role = session.role ?? session.customRoleName;
  const canApprove = session.permissions.has('approvals.approve');
  const list = useQuery({ queryKey: ['approvals', session.organizationId, role, view], queryFn: () => api!.list(view === 'pending' ? 'pending' : undefined), enabled: !!api && canApprove });

  if (!api) {
    return (
      <Card>
        <EmptyState icon={<Building2 className="size-5" />} title={t('team.noOrganization')} body={t('team.noOrganizationBody')} />
      </Card>
    );
  }
  const items = (list.data?.items ?? []).filter((r) => view === 'pending' || r.status !== 'pending');
  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <PageHeader eyebrow={<span dir="auto">{session.organization}</span>} title={t('approvals.title')} description={t('approvals.description')} />
      </motion.div>
      {canApprove && (
        <>
          <motion.div variants={fadeUp}>
            <Segmented<View>
              label={t('approvals.view')}
              value={view}
              onChange={setView}
              options={[
                { value: 'pending', label: list.data && view === 'pending' ? t('approvals.pendingCount', { count: list.data.pending }) : t('approvals.pending') },
                { value: 'history', label: t('approvals.history') },
              ]}
            />
          </motion.div>
          <motion.div variants={fadeUp}>
            <Card className="overflow-hidden">
              {list.isPending ? (
                <SkeletonRows rows={3} />
              ) : list.isError ? (
                <ErrorState onRetry={() => void list.refetch()} />
              ) : !items.length ? (
                <EmptyState icon={<UserCheck className="size-5" />} title={t(view === 'pending' ? 'approvals.nothingPending' : 'approvals.noHistory')} body={view === 'pending' ? t('approvals.nothingPendingBody') : undefined} />
              ) : (
                <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                  {items.map((r) => (
                    <RequestRow key={r.id} r={r} onDecide={(approve) => setDeciding({ r, approve })} api={api} />
                  ))}
                </ul>
              )}
            </Card>
          </motion.div>
        </>
      )}
      <motion.div variants={fadeUp}>
        <Rules api={api} />
      </motion.div>
      {deciding && <DecideDialog api={api} request={deciding.r} approve={deciding.approve} onClose={() => setDeciding(null)} />}
    </motion.div>
  );
}

function RequestRow({ r, onDecide, api }: { r: ApprovalRequest; onDecide: (approve: boolean) => void; api: ApprovalsApi }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  const toast = useToast();
  const qc = useQueryClient();
  const session = useSession();
  const Icon = ICON[r.documentType];
  const link = !r.documentId ? null : r.documentType === 'journal' ? `/journals/${r.documentId}` : r.documentType === 'bill' ? `/bills/${r.documentId}` : r.documentType === 'payment' ? '/payments' : '/banking';
  // In the demo there's one person, so the previewed role stands for who sent it
  const mine = session.email.endsWith('@ledgernest.demo') ? r.requestedBy.email === `${session.role ?? 'admin'}@ledgernest.demo` : r.requestedBy.email === session.email;
  const withdraw = useMutation({
    mutationFn: () => api.cancel(r.id),
    onSuccess: () => (void qc.invalidateQueries({ queryKey: ['approvals'] }), toast(t('approvals.withdrawn'))),
    onError: (e) => toast(approvalErrorMessage(e, t), 'error'),
  });
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300" aria-hidden>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          {link ? (
            <Link to={link} className="font-medium hover:underline" dir="auto">
              {r.summary}
            </Link>
          ) : (
            <span className="font-medium" dir="auto">
              {r.summary}
            </span>
          )}
          <Pill>{t(`approvals.documents.${r.documentType}`)}</Pill>
          {r.status !== 'pending' && <Pill tone={r.status === 'approved' ? 'brand' : 'neutral'}>{t(`approvals.statuses.${r.status}`)}</Pill>}
        </span>
        <span className="block text-sm text-ink-500">
          {t('approvals.sentBy', { name: r.requestedBy.name, when: formatRelative(r.createdAt, locale) })}
          {r.payment && ` · ${formatDate(`${r.payment.date}T00:00:00Z`, locale)}`}
          {r.decidedBy && ` · ${t(r.status === 'approved' ? 'approvals.approvedBy' : r.status === 'rejected' ? 'approvals.sentBackBy' : 'approvals.closedBy', { name: r.decidedBy.name })}`}
        </span>
        {r.note && (
          <span className="mt-1 block text-sm italic text-ink-600 dark:text-ink-300" dir="auto">
            “{r.note}”
          </span>
        )}
      </span>
      <span className="font-mono text-sm font-semibold tabular-nums" dir="ltr">
        {money.format(r.amount)}
      </span>
      {r.status === 'pending' && (
        <span className="flex gap-2">
          {mine ? (
            <Button size="sm" variant="ghost" icon={<Undo2 className="size-4" />} loading={withdraw.isPending} onClick={() => withdraw.mutate()}>
              {t('approvals.withdraw')}
            </Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" icon={<X className="size-4" />} onClick={() => onDecide(false)} aria-label={t('approvals.sendBackFor', { summary: r.summary })}>
                {t('approvals.sendBack')}
              </Button>
              <Button size="sm" icon={<Check className="size-4" />} onClick={() => onDecide(true)} aria-label={t('approvals.approveFor', { summary: r.summary })}>
                {t('approvals.approve')}
              </Button>
            </>
          )}
        </span>
      )}
    </li>
  );
}

/** Approve (posts it) with an optional note, or send it back with what needs to change */
function DecideDialog({ api, request, approve, onClose }: { api: ApprovalsApi; request: ApprovalRequest; approve: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const money = useMoney();
  const toast = useToast();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: () => (approve ? api.approve(request.id, note.trim() || undefined) : api.reject(request.id, note.trim())),
    onSuccess: () => {
      for (const k of ['approvals', 'journals', 'journal', 'bills', 'payments', 'contacts', 'reports']) void qc.invalidateQueries({ queryKey: [k] });
      toast(t(approve ? 'approvals.approvedToast' : 'approvals.sentBackToast', { summary: request.summary }));
      onClose();
    },
    onError: (e) => toast(approvalErrorMessage(e, t), 'error'),
  });
  const ok = approve || note.trim().length >= 3;
  return (
    <Modal
      open
      onClose={onClose}
      title={t(approve ? 'approvals.approveTitle' : 'approvals.sendBackTitle')}
      description={`${request.summary} · ${money.format(request.amount)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="decide-form" loading={decide.isPending} disabled={!ok}>
            {t(approve ? 'approvals.approveAndPost' : 'approvals.sendBack')}
          </Button>
        </>
      }
    >
      <form id="decide-form" onSubmit={(e) => (e.preventDefault(), ok && decide.mutate())} noValidate className="space-y-3">
        <p className="text-sm text-ink-600 dark:text-ink-300">{t(approve ? 'approvals.approveBody' : 'approvals.sendBackBody')}</p>
        <TextField label={t(approve ? 'approvals.noteOptional' : 'approvals.note')} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} dir="auto" data-autofocus />
      </form>
    </Modal>
  );
}

/** One rule per kind of document: at or above an amount needs approval */
function Rules({ api }: { api: ApprovalsApi }) {
  const { t } = useTranslation();
  const session = useSession();
  const canManage = session.permissions.has('approvals.manage');
  const role = session.role ?? session.customRoleName;
  const rules = useQuery({ queryKey: ['approvals', session.organizationId, role, 'rules'], queryFn: () => api.rules() });
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-ink-100 px-5 py-3 dark:border-ink-800">
        <h2 className="font-semibold">{t('approvals.rulesTitle')}</h2>
        <p className="text-sm text-ink-500">{t(canManage ? 'approvals.rulesBody' : 'approvals.rulesReadOnly')}</p>
      </div>
      {rules.isPending ? (
        <SkeletonRows rows={3} />
      ) : rules.isError ? (
        <ErrorState onRetry={() => void rules.refetch()} />
      ) : (
        <ul className="divide-y divide-ink-100 dark:divide-ink-800">
          {APPROVAL_DOCUMENTS.map((d) => (
            <RuleRow key={`${d}-${rules.data.find((r) => r.documentType === d)?.minAmount ?? 'off'}`} api={api} rule={rules.data.find((r) => r.documentType === d)!} canManage={canManage} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function RuleRow({ api, rule, canManage }: { api: ApprovalsApi; rule: ApprovalRule; canManage: boolean }) {
  const { t } = useTranslation();
  const money = useMoney();
  const toast = useToast();
  const qc = useQueryClient();
  const [on, setOn] = useState(rule.enabled);
  const [amount, setAmount] = useState(rule.minAmount !== null ? money.plain(rule.minAmount) : '');
  const minor = amount.trim() ? toMinor(amount, money.digits) : 0;
  const changed = on !== rule.enabled || (on && minor !== rule.minAmount);
  const save = useMutation({
    mutationFn: () => (on ? api.setRule(rule.documentType, minor!) : api.removeRule(rule.documentType)),
    onSuccess: (rules) => {
      qc.setQueriesData({ queryKey: ['approvals'], predicate: (q) => q.queryKey.at(-1) === 'rules' }, rules);
      toast(t('approvals.ruleSaved', { document: t(`approvals.documents.${rule.documentType}`) }));
    },
    onError: (e) => toast(approvalErrorMessage(e, t), 'error'),
  });
  const label = t(`approvals.rules.${rule.documentType as ApprovalDocument}`);
  return (
    <li className="flex flex-wrap items-end gap-3 px-5 py-3">
      <label className="flex min-w-56 flex-1 items-center gap-2 pb-2 text-sm">
        <input type="checkbox" checked={on} disabled={!canManage} onChange={(e) => setOn(e.target.checked)} className="size-4 rounded accent-brand-600" />
        <span className={clsx('font-medium', !on && 'text-ink-500')}>{label}</span>
      </label>
      {on && (
        <div className="w-48">
          <TextField label={t('approvals.atOrAbove', { currency: money.currency })} value={amount} onChange={(e) => setAmount(e.target.value)} onBlur={() => minor && setAmount(money.plain(minor))} disabled={!canManage} inputMode="decimal" dir="ltr" className="text-end font-mono" placeholder="0.00" error={minor === null ? t('approvals.badAmount') : undefined} />
        </div>
      )}
      {canManage && (
        <Button size="sm" variant={changed ? 'primary' : 'ghost'} disabled={!changed || minor === null} loading={save.isPending} onClick={() => save.mutate()} aria-label={t('approvals.saveRule', { rule: label })}>
          {t('common.save')}
        </Button>
      )}
    </li>
  );
}
