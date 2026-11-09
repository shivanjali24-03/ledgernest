import { useContext, useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, KeyRound, Pause, Play, Plus, RefreshCw, RotateCw, Send, Trash2, Webhook as WebhookIcon, History } from 'lucide-react';
import clsx from 'clsx';
import { API_KEY_SCOPES, WEBHOOK_EVENTS, type ApiKeyScope, type WebhookEvent } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { ApiClientContext } from '../../auth/apiClientContext';
import { useIntlLocale } from '../../i18n';
import { formatRelative } from '../../lib/format';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { SelectField, TextField } from '../../ui/Field';
import { Card, CopyField, EmptyState, ErrorState, PageHeader, Pill, SkeletonRows } from '../../ui/Kit';
import Modal from '../../ui/Modal';
import RowMenu from '../../ui/RowMenu';
import { useToast } from '../../ui/toastContext';
import type { ApiKey, IntegrationsApi, Webhook } from '../types';
import { useIntegrationsApi } from '../useIntegrationsApi';

/** API keys and webhooks: letting other systems call LedgerNest, and telling them when things change. */
export default function Integrations() {
  const { t } = useTranslation();
  const session = useSession();
  const api = useIntegrationsApi();
  const demo = !useContext(ApiClientContext);
  if (!api) {
    return (
      <Card>
        <EmptyState icon={<Building2 className="size-5" />} title={t('team.noOrganization')} body={t('team.noOrganizationBody')} />
      </Card>
    );
  }
  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <PageHeader eyebrow={<span dir="auto">{session.organization}</span>} title={t('integrations.title')} description={t('integrations.description')} />
      </motion.div>
      {demo && (
        <motion.p variants={fadeUp} className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800 dark:bg-brand-500/10 dark:text-brand-200">
          {t('integrations.demoNote')}
        </motion.p>
      )}
      <motion.div variants={fadeUp}>
        <Keys api={api} />
      </motion.div>
      <motion.div variants={fadeUp}>
        <Webhooks api={api} />
      </motion.div>
    </motion.div>
  );
}

function Keys({ api }: { api: IntegrationsApi }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const session = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const key = ['integrations', session.organizationId, 'keys'];
  const keys = useQuery({ queryKey: key, queryFn: () => api.keys() });
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useState<(ApiKey & { key: string }) | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const revoke = useMutation({
    mutationFn: (k: ApiKey) => api.revokeKey(k.id),
    onSuccess: (_r, k) => (setRevoking(null), void qc.invalidateQueries({ queryKey: key }), toast(t('integrations.keys.revoked', { name: k.name }))),
    onError: () => (setRevoking(null), toast(t('integrations.failed'), 'error')),
  });
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 px-5 py-3 dark:border-ink-800">
        <span className="min-w-0 flex-1">
          <h2 className="font-semibold">{t('integrations.keys.title')}</h2>
          <p className="text-sm text-ink-500">{t('integrations.keys.body')}</p>
        </span>
        <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
          {t('integrations.keys.new')}
        </Button>
      </div>
      {keys.isPending ? (
        <SkeletonRows rows={2} />
      ) : keys.isError ? (
        <ErrorState onRetry={() => void keys.refetch()} />
      ) : !keys.data.length ? (
        <EmptyState icon={<KeyRound className="size-5" />} title={t('integrations.keys.empty')} />
      ) : (
        <ul className="divide-y divide-ink-100 dark:divide-ink-800">
          {keys.data.map((k) => (
            <li key={k.id} className={clsx('flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3', k.status !== 'active' && 'opacity-60')}>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium" dir="auto">
                    {k.name}
                  </span>
                  <code className="text-xs text-ink-500" dir="ltr">
                    {k.prefix}…
                  </code>
                  {k.status !== 'active' && <Pill>{t(`integrations.keys.statuses.${k.status}`)}</Pill>}
                </span>
                <span className="block text-xs text-ink-500">
                  {k.scopes.map((s) => t(`permissions.${s.replace('.', '_')}`)).join(' · ')}
                </span>
                <span className="block text-xs text-ink-400">{[t('integrations.keys.by', { name: k.createdBy.name }), k.lastUsedAt ? t('integrations.keys.lastUsed', { when: formatRelative(k.lastUsedAt, locale) }) : t('integrations.keys.neverUsed')].join(' · ')}</span>
              </span>
              {k.status === 'active' && (
                <Button size="sm" variant="ghost" onClick={() => setRevoking(k)} aria-label={t('integrations.keys.revokeFor', { name: k.name })}>
                  {t('integrations.keys.revoke')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && <NewKeyDialog api={api} onClose={() => setAdding(false)} onMade={(k) => (setAdding(false), setShown(k), void qc.invalidateQueries({ queryKey: key }))} />}
      {shown && (
        <Modal open onClose={() => setShown(null)} title={t('integrations.keys.madeTitle', { name: shown.name })} description={t('integrations.keys.madeBody')} footer={<Button onClick={() => setShown(null)}>{t('integrations.done')}</Button>}>
          <CopyField value={shown.key} label={t('integrations.keys.key')} />
          <p className="mt-3 text-xs text-ink-500">{t('integrations.keys.howTo')}</p>
        </Modal>
      )}
      <ConfirmDialog open={!!revoking} title={revoking ? t('integrations.keys.revokeTitle', { name: revoking.name }) : ''} body={t('integrations.keys.revokeBody')} confirmLabel={t('integrations.keys.revoke')} tone="danger" busy={revoke.isPending} onConfirm={() => revoking && revoke.mutate(revoking)} onClose={() => setRevoking(null)} />
    </Card>
  );
}

function NewKeyDialog({ api, onClose, onMade }: { api: IntegrationsApi; onClose: () => void; onMade: (k: ApiKey & { key: string }) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const session = useSession();
  const mine = API_KEY_SCOPES.filter((s) => session.permissions.has(s));
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Set<ApiKeyScope>>(new Set(mine.filter((s) => s.endsWith('.view'))));
  const [expires, setExpires] = useState('');
  const make = useMutation({
    mutationFn: () => api.createKey({ name: name.trim(), scopes: [...scopes], expiresInDays: expires ? Number(expires) : null }),
    onSuccess: onMade,
    onError: () => toast(t('integrations.failed'), 'error'),
  });
  const ok = name.trim().length >= 2 && scopes.size > 0;
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={t('integrations.keys.newTitle')}
      description={t('integrations.keys.newBody')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="key-form" loading={make.isPending} disabled={!ok}>
            {t('integrations.keys.make')}
          </Button>
        </>
      }
    >
      <form id="key-form" onSubmit={(e: FormEvent) => (e.preventDefault(), ok && make.mutate())} noValidate className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={t('integrations.keys.name')} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('integrations.keys.namePlaceholder')} maxLength={80} dir="auto" data-autofocus />
          <SelectField
            label={t('integrations.keys.expires')}
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
            options={[
              { value: '', label: t('integrations.keys.never') },
              ...['30', '90', '365'].map((d) => ({ value: d, label: t('integrations.keys.days', { count: Number(d) }) })),
            ]}
          />
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">{t('integrations.keys.scopes')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {mine.map((s) => (
              <label key={s} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={scopes.has(s)} onChange={(e) => setScopes((x) => (e.target.checked ? new Set(x).add(s) : new Set([...x].filter((y) => y !== s))))} className="size-4 rounded accent-brand-600" />
                {t(`permissions.${s.replace('.', '_')}`)}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-500">{t('integrations.keys.scopesHint')}</p>
        </fieldset>
      </form>
    </Modal>
  );
}

function Webhooks({ api }: { api: IntegrationsApi }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const session = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const key = ['integrations', session.organizationId, 'webhooks'];
  const hooks = useQuery({ queryKey: key, queryFn: () => api.webhooks() });
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<{ url: string; secret: string } | null>(null);
  const [log, setLog] = useState<Webhook | null>(null);
  const [removing, setRemoving] = useState<Webhook | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['integrations'] });
  const fail = () => toast(t('integrations.failed'), 'error');
  const toggle = useMutation({ mutationFn: (w: Webhook) => api.updateWebhook(w.id, { active: !w.active }), onSuccess: (w) => (refresh(), toast(t(w.active ? 'integrations.hooks.on' : 'integrations.hooks.off'))), onError: fail });
  const ping = useMutation({ mutationFn: (w: Webhook) => api.ping(w.id), onSuccess: (d) => (refresh(), toast(d.status === 'succeeded' ? t('integrations.hooks.pingOk') : t('integrations.hooks.pingFailed', { error: d.lastError ?? '' }), d.status === 'succeeded' ? undefined : 'error')), onError: fail });
  const rotate = useMutation({ mutationFn: (w: Webhook) => api.rotateSecret(w.id).then((r) => ({ url: w.url, secret: r.secret })), onSuccess: setSecret, onError: fail });
  const remove = useMutation({ mutationFn: (w: Webhook) => api.removeWebhook(w.id), onSuccess: () => (setRemoving(null), refresh(), toast(t('integrations.hooks.removed'))), onError: () => (setRemoving(null), fail()) });
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 px-5 py-3 dark:border-ink-800">
        <span className="min-w-0 flex-1">
          <h2 className="font-semibold">{t('integrations.hooks.title')}</h2>
          <p className="text-sm text-ink-500">{t('integrations.hooks.body')}</p>
        </span>
        <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
          {t('integrations.hooks.new')}
        </Button>
      </div>
      {hooks.isPending ? (
        <SkeletonRows rows={2} />
      ) : hooks.isError ? (
        <ErrorState onRetry={() => void hooks.refetch()} />
      ) : !hooks.data.length ? (
        <EmptyState icon={<WebhookIcon className="size-5" />} title={t('integrations.hooks.empty')} />
      ) : (
        <ul className="divide-y divide-ink-100 dark:divide-ink-800">
          {hooks.data.map((w) => (
            <li key={w.id} className={clsx('flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3', !w.active && 'opacity-60')}>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <code className="truncate text-sm font-medium" dir="ltr">
                    {w.url}
                  </code>
                  {!w.active && <Pill>{t('integrations.hooks.paused')}</Pill>}
                </span>
                {w.description && (
                  <span className="block text-sm text-ink-500" dir="auto">
                    {w.description}
                  </span>
                )}
                <span className="block text-xs text-ink-500">{w.events.map((e) => t(`integrations.events.${e.replace('.', '_')}`)).join(' · ')}</span>
                {w.lastDelivery && <span className="block text-xs text-ink-400">{t('integrations.hooks.lastDelivery', { status: t(`integrations.deliveryStatuses.${w.lastDelivery.status}`), when: formatRelative(w.lastDelivery.createdAt, locale) })}</span>}
              </span>
              <RowMenu
                label={t('integrations.hooks.actionsFor', { url: w.url })}
                items={[
                  { key: 'ping', label: t('integrations.hooks.ping'), icon: Send, onSelect: () => ping.mutate(w) },
                  { key: 'log', label: t('integrations.hooks.log'), icon: History, onSelect: () => setLog(w) },
                  { key: 'toggle', label: t(w.active ? 'integrations.hooks.pause' : 'integrations.hooks.resume'), icon: w.active ? Pause : Play, onSelect: () => toggle.mutate(w) },
                  { key: 'rotate', label: t('integrations.hooks.rotate'), icon: RotateCw, onSelect: () => rotate.mutate(w) },
                  { key: 'remove', label: t('integrations.hooks.remove'), icon: Trash2, danger: true, onSelect: () => setRemoving(w) },
                ]}
              />
            </li>
          ))}
        </ul>
      )}
      {adding && <NewWebhookDialog api={api} onClose={() => setAdding(false)} onMade={(w) => (setAdding(false), setSecret({ url: w.url, secret: w.secret }), refresh())} />}
      {secret && (
        <Modal open onClose={() => setSecret(null)} title={t('integrations.hooks.secretTitle')} description={secret.url} footer={<Button onClick={() => setSecret(null)}>{t('integrations.done')}</Button>}>
          <CopyField value={secret.secret} label={t('integrations.hooks.secret')} />
          <p className="mt-3 text-xs text-ink-500">{t('integrations.hooks.verify')}</p>
        </Modal>
      )}
      {log && <DeliveryLog api={api} hook={log} onClose={() => setLog(null)} />}
      <ConfirmDialog open={!!removing} title={removing ? t('integrations.hooks.removeTitle', { url: removing.url }) : ''} body={t('integrations.hooks.removeBody')} confirmLabel={t('integrations.hooks.remove')} tone="danger" busy={remove.isPending} onConfirm={() => removing && remove.mutate(removing)} onClose={() => setRemoving(null)} />
    </Card>
  );
}

function NewWebhookDialog({ api, onClose, onMade }: { api: IntegrationsApi; onClose: () => void; onMade: (w: Webhook & { secret: string }) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [url, setUrl] = useState('https://');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState<Set<WebhookEvent>>(new Set(['invoice.issued']));
  const make = useMutation({
    mutationFn: () => api.createWebhook({ url: url.trim(), description: description.trim() || null, events: [...events] }),
    onSuccess: onMade,
    onError: (e) => toast(e instanceof Error && 'details' in e && (e as { details?: { reason?: string } }).details?.reason?.startsWith('url_') ? t('integrations.hooks.badUrl') : t('integrations.failed'), 'error'),
  });
  const ok = /^https?:\/\/[^/\s]+\.?[^\s]*$/i.test(url.trim()) && events.size > 0;
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={t('integrations.hooks.newTitle')}
      description={t('integrations.hooks.newBody')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="hook-form" loading={make.isPending} disabled={!ok}>
            {t('integrations.hooks.add')}
          </Button>
        </>
      }
    >
      <form id="hook-form" onSubmit={(e: FormEvent) => (e.preventDefault(), ok && make.mutate())} noValidate className="space-y-4">
        <TextField label={t('integrations.hooks.url')} value={url} onChange={(e) => setUrl(e.target.value)} dir="ltr" inputMode="url" className="font-mono" data-autofocus />
        <TextField label={t('integrations.hooks.description')} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} dir="auto" />
        <fieldset>
          <legend className="mb-2 text-sm font-medium">{t('integrations.hooks.events')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {WEBHOOK_EVENTS.map((ev) => (
              <label key={ev} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={events.has(ev)} onChange={(e) => setEvents((x) => (e.target.checked ? new Set(x).add(ev) : new Set([...x].filter((y) => y !== ev))))} className="size-4 rounded accent-brand-600" />
                {t(`integrations.events.${ev.replace('.', '_')}`)}
              </label>
            ))}
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}

function DeliveryLog({ api, hook, onClose }: { api: IntegrationsApi; hook: Webhook; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const key = ['integrations', 'deliveries', hook.id];
  const list = useQuery({ queryKey: key, queryFn: () => api.deliveries(hook.id) });
  const retry = useMutation({ mutationFn: (id: string) => api.retry(id), onSuccess: () => (void qc.invalidateQueries({ queryKey: ['integrations'] }), toast(t('integrations.hooks.retried'))), onError: () => toast(t('integrations.failed'), 'error') });
  return (
    <Modal open size="lg" onClose={onClose} title={t('integrations.hooks.logTitle')} description={hook.url}>
      {list.isPending ? (
        <SkeletonRows rows={3} />
      ) : !list.data?.length ? (
        <p className="text-sm text-ink-500">{t('integrations.hooks.noDeliveries')}</p>
      ) : (
        <ul className="divide-y divide-ink-100 rounded-xl border border-ink-100 text-sm dark:divide-ink-800 dark:border-ink-800">
          {list.data.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <code className="text-xs" dir="ltr">
                {d.event}
              </code>
              <Pill tone={d.status === 'succeeded' ? 'brand' : 'neutral'}>{t(`integrations.deliveryStatuses.${d.status}`)}</Pill>
              <span className="min-w-0 flex-1 text-xs text-ink-500">
                {[formatRelative(d.createdAt, locale), t('integrations.hooks.attempts', { count: d.attempts }), d.lastStatus ? `HTTP ${d.lastStatus}` : null, d.lastError].filter(Boolean).join(' · ')}
              </span>
              {d.status !== 'succeeded' && (
                <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} loading={retry.isPending} onClick={() => retry.mutate(d.id)}>
                  {t('integrations.hooks.retry')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
