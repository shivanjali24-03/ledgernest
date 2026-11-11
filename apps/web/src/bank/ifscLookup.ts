import { useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { IFSC, type IfscLookup } from '@ledgernest/shared';
import { ApiClientContext } from '../auth/apiClientContext';
import { ApiError } from '../auth/client';

const branch = (ifsc: string, bank: string, name: string, city: string, state: string): IfscLookup => ({ ifsc, bank, branch: name, address: null, city, state, upi: true, neft: true, rtgs: true, imps: true });
/** A few real branches for the demo, which has no server to ask the directory */
const DEMO: Record<string, IfscLookup> = {
  HDFC0001234: branch('HDFC0001234', 'HDFC Bank', 'BANER', 'PUNE', 'MAHARASHTRA'),
  SBIN0000454: branch('SBIN0000454', 'State Bank of India', 'PUNE MAIN', 'PUNE', 'MAHARASHTRA'),
  ICIC0000039: branch('ICIC0000039', 'ICICI Bank', 'PUNE - BUND GARDEN ROAD', 'PUNE', 'MAHARASHTRA'),
  UTIB0000003: branch('UTIB0000003', 'Axis Bank', 'BANGALORE MAIN', 'BANGALORE', 'KARNATAKA'),
};

/** The branch an IFSC names (through the API, which asks Razorpay's directory and keeps the answer), or the demo's */
export function useIfscLookup(code: string, enabled = true) {
  const client = useContext(ApiClientContext);
  const ifsc = code.trim().toUpperCase();
  return useQuery<IfscLookup, Error>({
    queryKey: ['ifsc', ifsc],
    enabled: enabled && IFSC.test(ifsc),
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      if (client) return client.request<IfscLookup>(`/geo/ifsc/${ifsc}`);
      const d = DEMO[ifsc];
      if (!d) throw new ApiError('not_found', 404, undefined, undefined, { reason: 'unknown_ifsc' });
      return d;
    },
  });
}
