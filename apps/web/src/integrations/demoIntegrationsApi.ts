import { API_KEY_PREFIX, apiKeyCreateSchema, webhookSchema, type OrganizationPermission } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import type { ApiKey, IntegrationsApi, Webhook, WebhookDelivery } from './types';

/** API keys and webhooks in demo mode, kept in this browser. Nothing is sent anywhere: test pings are recorded only. */
const KEY = 'ledgernest.demo.integrations';
type State = { keys: ApiKey[]; webhooks: (Webhook & { secret: string })[]; deliveries: (WebhookDelivery & { webhookId: string })[] };
const ME = { name: 'Shivanjali Desai', email: 'admin@ledgernest.demo' };

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as State;
  } catch {
    /* fall through */
  }
  return { keys: [], webhooks: [], deliveries: [] };
}
function save(s: State) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}
export const resetDemoIntegrations = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
};

const wait = <T>(fn: () => T | Promise<T>) => new Promise<T>((resolve, reject) => setTimeout(() => Promise.resolve().then(fn).then(resolve, reject), 100));
const random = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b % 64]).join('');
const invalid = (issues: unknown) => new ApiError('validation', 400, undefined, undefined, { fields: issues });

export function createDemoIntegrationsApi(can: (p: OrganizationPermission) => boolean): IntegrationsApi {
  const guard = () => {
    if (!can('integrations.manage')) throw new ApiError('forbidden', 403, undefined, undefined, { missing: ['integrations.manage'] });
  };
  const change = <T>(fn: (s: State) => T) =>
    wait(() => {
      guard();
      const s = load();
      const out = fn(s);
      save(s);
      return out;
    });
  const hook = (s: State, id: string) => {
    const w = s.webhooks.find((x) => x.id === id);
    if (!w) throw new ApiError('not_found', 404);
    return w;
  };
  const view = ({ secret: _s, ...w }: Webhook & { secret: string }, s: State): Webhook => {
    const last = s.deliveries.filter((d) => d.webhookId === w.id).at(-1);
    return { ...w, lastDelivery: last ? { status: last.status, createdAt: last.createdAt } : null };
  };
  // Nothing leaves the browser in the demo: a delivery is recorded as if the endpoint had answered 200
  const deliver = (s: State, webhookId: string, event: string): WebhookDelivery => {
    const now = new Date().toISOString();
    const d = { id: crypto.randomUUID(), webhookId, event, status: 'succeeded' as const, attempts: 1, lastStatus: 200, lastError: null, createdAt: now, deliveredAt: now, nextAttemptAt: null };
    s.deliveries.push(d);
    const { webhookId: _w, ...out } = d;
    return out;
  };
  return {
    keys: () => wait(() => (guard(), load().keys.slice().reverse())),
    createKey: (input) =>
      change((s) => {
        const p = apiKeyCreateSchema.safeParse(input);
        if (!p.success) throw invalid(p.error.issues);
        const key = `${API_KEY_PREFIX}${random(40)}`;
        const k: ApiKey = { id: crypto.randomUUID(), name: p.data.name, prefix: key.slice(0, API_KEY_PREFIX.length + 6), scopes: p.data.scopes, createdAt: new Date().toISOString(), lastUsedAt: null, expiresAt: p.data.expiresInDays ? new Date(Date.now() + p.data.expiresInDays * 86_400_000).toISOString() : null, revokedAt: null, status: 'active', createdBy: ME };
        s.keys.push(k);
        return { ...k, key };
      }),
    revokeKey: (id) =>
      change((s) => {
        const k = s.keys.find((x) => x.id === id);
        if (!k) throw new ApiError('not_found', 404);
        if (k.revokedAt) throw new ApiError('conflict', 409, undefined, undefined, { reason: 'already_revoked' });
        Object.assign(k, { revokedAt: new Date().toISOString(), status: 'revoked' });
      }),
    webhooks: () =>
      wait(() => {
        guard();
        const s = load();
        return s.webhooks.map((w) => view(w, s));
      }),
    createWebhook: (input) =>
      change((s) => {
        const p = webhookSchema.safeParse(input);
        if (!p.success) throw invalid(p.error.issues);
        const w = { id: crypto.randomUUID(), ...p.data, createdAt: new Date().toISOString(), lastDelivery: null, secret: `whsec_${random(32)}` };
        s.webhooks.push(w);
        return { ...view(w, s), secret: w.secret };
      }),
    updateWebhook: (id, input) =>
      change((s) => {
        const p = webhookSchema.partial().safeParse(input);
        if (!p.success) throw invalid(p.error.issues);
        const w = hook(s, id);
        Object.assign(w, Object.fromEntries(Object.entries(p.data).filter(([k]) => k in input)));
        return view(w, s);
      }),
    rotateSecret: (id) =>
      change((s) => {
        const w = hook(s, id);
        w.secret = `whsec_${random(32)}`;
        return { secret: w.secret };
      }),
    removeWebhook: (id) =>
      change((s) => {
        hook(s, id);
        s.webhooks = s.webhooks.filter((w) => w.id !== id);
        s.deliveries = s.deliveries.filter((d) => d.webhookId !== id);
      }),
    deliveries: (id) =>
      wait(() => {
        guard();
        return load()
          .deliveries.filter((d) => d.webhookId === id)
          .reverse()
          .map(({ webhookId: _w, ...d }) => d);
      }),
    ping: (id) => change((s) => (hook(s, id), deliver(s, id, 'ping'))),
    retry: (deliveryId) =>
      change((s) => {
        const d = s.deliveries.find((x) => x.id === deliveryId);
        if (!d) throw new ApiError('not_found', 404);
        Object.assign(d, { status: 'succeeded', attempts: d.attempts + 1, lastStatus: 200, lastError: null, deliveredAt: new Date().toISOString(), nextAttemptAt: null });
        const { webhookId: _w, ...out } = d;
        return out;
      }),
  };
}
