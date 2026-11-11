import { findIndianState } from '../taxes/index.js';

/**
 * Indian addresses from the PIN code: India Post's directory gives each PIN's post offices (localities) with their
 * block, district and state. The state is matched to the GST list (whose codes are fixed by law); the district and
 * the towns/localities fill the address form's choices.
 */

/** A PIN code: six digits, not starting with 0 */
export const PIN_CODE = /^[1-9]\d{5}$/;

export interface PinLocality {
  /** The post office's name: a town, village or locality */
  name: string;
  block: string | null;
  district: string;
  delivery: boolean;
}

export interface PinLookup {
  pin: string;
  /** From the GST state list; null if India Post's state name doesn't match one */
  state: { code: string; name: string } | null;
  district: string | null;
  /** Choices for the city or town: the district and the blocks (taluks) in it */
  cities: string[];
  localities: PinLocality[];
}

const clean = (v: unknown) => (typeof v === 'string' && v.trim() && v.trim().toUpperCase() !== 'NA' ? v.trim().replace(/\s+/g, ' ') : null);

/** India Post's answer for a PIN (an array with one entry), as the address form uses it; null when the PIN isn't known */
export function pinLookupFromIndiaPost(pin: string, body: unknown): PinLookup | null {
  const first = Array.isArray(body) ? (body[0] as Record<string, unknown> | undefined) : undefined;
  if (!first || first.Status !== 'Success' || !Array.isArray(first.PostOffice)) return null;
  const localities: PinLocality[] = [];
  for (const o of first.PostOffice.slice(0, 100) as Record<string, unknown>[]) {
    const name = clean(o.Name);
    const district = clean(o.District);
    if (!name || !district || (clean(o.Pincode) && clean(o.Pincode) !== pin)) continue;
    localities.push({ name: name.slice(0, 80), block: clean(o.Block)?.slice(0, 80) ?? null, district: district.slice(0, 80), delivery: o.DeliveryStatus === 'Delivery' });
  }
  if (!localities.length) return null;
  const states = (first.PostOffice as Record<string, unknown>[]).map((o) => clean(o.State)).filter((s): s is string => !!s);
  const found = states.length ? findIndianState(states[0]!) : undefined;
  const district = localities[0]!.district;
  const cities = [...new Set([district, ...localities.map((l) => l.block).filter((b): b is string => !!b)])];
  localities.sort((a, b) => Number(b.delivery) - Number(a.delivery) || a.name.localeCompare(b.name));
  return { pin, state: found ? { code: found.code, name: found.name } : null, district, cities, localities };
}
