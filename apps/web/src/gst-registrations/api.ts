import { gstinStateCode, gstRegistrationSchema, INDIAN_STATES, panOfGstin } from '@ledgernest/shared';
import { useContext, useMemo } from 'react';
import { ApiError, type AuthClient } from '../auth/client';
import { ApiClientContext } from '../auth/apiClientContext';
import { useSession } from '../layout/session';
import type { GstRegistration, GstRegistrationsApi } from './types';

export function createLiveGstRegistrationsApi(client: AuthClient, organizationId: string): GstRegistrationsApi {
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) => client.request<T>(`/gst-registrations${path}`, { ...init, headers: { 'X-Organization-Id': organizationId } });
  return {
    list: () => r(''),
    create: (input) => r('', { method: 'POST', json: input }),
    archive: (id) => r(`/${id}/archive`, { method: 'POST' }),
  };
}

/** The demo company (GSTIN 27AAPFN1234C1Z5) keeps its other GSTINs in this browser */
const KEY = 'ledgernest.demo.gstRegistrations.v1';
const PRIMARY = '27AAPFN1234C1Z5';
const load = (): GstRegistration[] => {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? 'null') as GstRegistration[] | null) ?? [];
  } catch {
    return [];
  }
};
export const resetDemoGstRegistrations = () => localStorage.removeItem(KEY);
const refuse = (status: 400 | 409, reason: string) => new ApiError(status === 400 ? 'validation' : 'conflict', status, undefined, undefined, { reason, field: 'gstin' });
export function createDemoGstRegistrationsApi(): GstRegistrationsApi {
  const wait = <T>(fn: () => T) => new Promise<T>((resolve, reject) => setTimeout(() => Promise.resolve().then(fn).then(resolve, reject), 120));
  return {
    list: () => wait(() => ({ primary: { gstin: PRIMARY, stateCode: '27' }, registrations: load() })),
    create: (input) =>
      wait(() => {
        const d = gstRegistrationSchema.parse(input);
        if (d.gstin === PRIMARY) throw refuse(409, 'gstin_is_organisation');
        if (panOfGstin(d.gstin) !== panOfGstin(PRIMARY)) throw refuse(400, 'gstin_other_pan');
        const all = load();
        if (all.some((x) => x.gstin === d.gstin)) throw refuse(409, 'gstin_taken');
        const code = gstinStateCode(d.gstin)!;
        const r: GstRegistration = { id: crypto.randomUUID(), gstin: d.gstin, stateCode: code, state: INDIAN_STATES.find((s) => s.code === code)?.name ?? null, tradeName: d.tradeName, address: d.address, archived: false };
        localStorage.setItem(KEY, JSON.stringify([...all, r]));
        return r;
      }),
    archive: (id) =>
      wait(() => {
        localStorage.setItem(KEY, JSON.stringify(load().map((x) => (x.id === id ? { ...x, archived: true } : x))));
      }),
  };
}

export function useGstRegistrationsApi(): GstRegistrationsApi | null {
  const client = useContext(ApiClientContext);
  const { organizationId } = useSession();
  return useMemo(() => (client ? (organizationId ? createLiveGstRegistrationsApi(client, organizationId) : null) : createDemoGstRegistrationsApi()), [client, organizationId]);
}
