import { useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PIN_CODE, type PinLookup } from '@ledgernest/shared';
import { ApiClientContext } from '../auth/apiClientContext';
import { ApiError } from '../auth/client';

/** A few real PIN codes for the demo, which has no server to ask India Post */
const DEMO: Record<string, Omit<PinLookup, 'pin'>> = {
  '411045': { state: { code: '27', name: 'Maharashtra' }, district: 'Pune', cities: ['Pune', 'Haveli', 'Pune City'], localities: [{ name: 'N.I.A.', block: 'Pune City', district: 'Pune', delivery: true }, { name: 'Baner Gaon', block: 'Haveli', district: 'Pune', delivery: false }] },
  '411057': { state: { code: '27', name: 'Maharashtra' }, district: 'Pune', cities: ['Pune', 'Mulshi', 'Haveli'], localities: [{ name: 'Hinjewadi', block: 'Mulshi', district: 'Pune', delivery: true }, { name: 'Wakad', block: 'Haveli', district: 'Pune', delivery: false }] },
  '411030': { state: { code: '27', name: 'Maharashtra' }, district: 'Pune', cities: ['Pune', 'Pune City'], localities: [{ name: 'Sadashiv Peth', block: 'Pune City', district: 'Pune', delivery: true }, { name: 'Narayan Peth', block: 'Pune City', district: 'Pune', delivery: false }] },
  '560034': { state: { code: '29', name: 'Karnataka' }, district: 'Bangalore', cities: ['Bangalore', 'Bangalore South'], localities: [{ name: 'Koramangala', block: 'Bangalore South', district: 'Bangalore', delivery: true }, { name: 'Agara', block: 'Bangalore South', district: 'Bangalore', delivery: false }] },
  '110001': { state: { code: '07', name: 'Delhi' }, district: 'New Delhi', cities: ['New Delhi'], localities: [{ name: 'Connaught Place', block: 'New Delhi', district: 'New Delhi', delivery: true }, { name: 'Parliament House', block: 'New Delhi', district: 'New Delhi', delivery: false }] },
  '400001': { state: { code: '27', name: 'Maharashtra' }, district: 'Mumbai', cities: ['Mumbai'], localities: [{ name: 'Mumbai G.P.O.', block: 'Mumbai', district: 'Mumbai', delivery: true }, { name: 'Fort', block: 'Mumbai', district: 'Mumbai', delivery: false }] },
};

/**
 * What India Post says about a PIN code (through the API, which keeps the answers), or the demo's sample. Only asks
 * for a complete, well-formed PIN; an unknown PIN or an unreachable directory is an error, and the form lets the
 * address be typed instead.
 */
export function usePinLookup(pin: string, enabled = true) {
  const client = useContext(ApiClientContext);
  const valid = PIN_CODE.test(pin);
  return useQuery<PinLookup, Error>({
    queryKey: ['pincode', pin],
    enabled: enabled && valid,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      if (client) return client.request<PinLookup>(`/geo/pincode/${pin}`);
      const d = DEMO[pin];
      if (!d) throw new ApiError('not_found', 404, undefined, undefined, { reason: 'unknown_pin' });
      return { pin, ...d };
    },
  });
}
