import { z } from 'zod';
import { parseQuantity } from '../invoices/index.js';

/**
 * Serial numbers: each unit of goods like phones (IMEI), appliances or machines carries its own number, recorded as
 * it's bought and as it's sold, so a customer's warranty claim or a stolen phone can be traced to the bill and the
 * invoice. Quantities of these goods are whole units, one serial each.
 */

export const serialNoSchema = z
  .string()
  .trim()
  .min(3, 'A serial number has at least 3 characters.')
  .max(50)
  .regex(/^[A-Za-z0-9][A-Za-z0-9/._-]*$/, 'Use letters, digits, dots, dashes, slashes or underscores.');

/** Serials as typed: one per line, or separated by commas or spaces; blanks dropped, case kept */
export const parseSerials = (text: string) =>
  text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

export const serialsSchema = z.array(serialNoSchema).max(10_000).optional().default([]);

/** The same serial twice in a list, ignoring case */
export function duplicateSerials(serials: string[]) {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const s of serials) {
    const k = s.toUpperCase();
    if (seen.has(k)) twice.add(s);
    seen.add(k);
  }
  return [...twice];
}

/** Whether serials fit a line's quantity: whole units, one serial each */
export function serialsProblem(quantity: string, serials: string[]): 'not_whole' | 'count' | 'duplicate' | null {
  const q = parseQuantity(quantity);
  if (q === null || q % 10_000n !== 0n) return 'not_whole';
  if (BigInt(serials.length) !== q / 10_000n) return 'count';
  if (duplicateSerials(serials).length) return 'duplicate';
  return null;
}

/** A 15-digit IMEI's Luhn check digit is right (other serials have none to check) */
export function imeiValid(serial: string) {
  if (!/^\d{15}$/.test(serial)) return true;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = Number(serial[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}
