import { z } from 'zod';
import { rupeesInWords } from '../invoices/words.js';
import { pdfPageBytes, type PdfText } from '../pdf/index.js';

/**
 * Printing a payment onto a cheque leaf. Indian banks' cheques follow CTS-2010: 8 × 3⅝ inches, the date in eight
 * boxes at the top right, the payee across, the amount in words on two lines and in figures in a box on the right.
 * Exact places differ a little between banks and printers, so the whole print can be nudged in millimetres.
 * "A/c Payee" crossing (two lines at the top left) is on by default, so the cheque can only be paid into an account.
 */

const MM = 72 / 25.4;
/** The CTS-2010 leaf, in millimetres */
export const CHEQUE_WIDTH_MM = 203.2;
export const CHEQUE_HEIGHT_MM = 92.075;

export const chequeOptionsSchema = z.object({
  /** Move everything right (or left, negative), in millimetres */
  offsetX: z.coerce.number().min(-30).max(30).default(0),
  /** Move everything down (or up, negative), in millimetres */
  offsetY: z.coerce.number().min(-30).max(30).default(0),
  /** Cross the cheque "A/c Payee" */
  crossed: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});
export type ChequeOptions = z.output<typeof chequeOptionsSchema>;

export interface ChequeInput {
  payee: string;
  /** yyyy-mm-dd */
  date: string;
  /** Paise */
  amount: number;
}

/** The amount in words split over the cheque's two lines (the first is shorter: it starts after "Rupees" is printed) */
export function chequeWords(amount: number, first = 62, rest = 80): [string, string] {
  const words = `${rupeesInWords(amount).replace(/^Indian Rupees /, '')}`.split(' ');
  let a = '';
  let i = 0;
  for (; i < words.length && `${a} ${words[i]}`.trim().length <= first; i++) a = `${a} ${words[i]}`.trim();
  const b = words.slice(i).join(' ');
  return [a, b.length > rest ? `${b.slice(0, rest - 1)}…` : b];
}

/** Figures as on a cheque: Indian grouping, guarded so nothing can be added in front or behind */
export function chequeFigures(amount: number): string {
  const rupees = Math.floor(amount / 100);
  const paise = amount % 100;
  const s = String(rupees);
  const grouped = s.length > 3 ? `${s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${s.slice(-3)}` : s;
  return `**${grouped}${paise ? `.${String(paise).padStart(2, '0')}` : ''}/-`;
}

/** What goes where, in millimetres from the leaf's top left */
export function chequeLayout(c: ChequeInput, o: ChequeOptions) {
  const [w1, w2] = chequeWords(c.amount);
  const at = (x: number, y: number) => ({ x: x + o.offsetX, y: y + o.offsetY });
  const texts: (Omit<PdfText, 'x' | 'y'> & { x: number; y: number })[] = [
    // DDMMYYYY in the eight boxes, about 5 mm apart
    { ...at(155.5, 11.5), text: c.date.split('-').reverse().join(''), size: 11, spacing: 8.6 },
    { ...at(20, 22), text: c.payee.toUpperCase().slice(0, 60), size: 11 },
    { ...at(36, 30.5), text: w1, size: 10 },
    { ...at(12, 38.5), text: w2, size: 10 },
    { ...at(158, 39.5), text: chequeFigures(c.amount), size: 12, bold: true },
  ];
  const lines = o.crossed
    ? [
        { x1: 8, y1: 16, x2: 22, y2: 4 },
        { x1: 16, y1: 16, x2: 30, y2: 4 },
      ].map((l) => ({ x1: l.x1 + o.offsetX, y1: l.y1 + o.offsetY, x2: l.x2 + o.offsetX, y2: l.y2 + o.offsetY }))
    : [];
  if (o.crossed) texts.push({ ...at(12.5, 12.5), text: 'A/c Payee', size: 7, bold: true });
  return { texts, lines };
}

/** The cheque as a one-page PDF the size of the leaf, to print with the leaf fed in */
export function chequePdfBytes(c: ChequeInput, o: ChequeOptions): Uint8Array {
  const { texts, lines } = chequeLayout(c, o);
  const h = CHEQUE_HEIGHT_MM * MM;
  return pdfPageBytes({
    width: CHEQUE_WIDTH_MM * MM,
    height: h,
    texts: texts.map((t) => ({ ...t, x: t.x * MM, y: h - t.y * MM })),
    lines: lines.map((l) => ({ x1: l.x1 * MM, y1: h - l.y1 * MM, x2: l.x2 * MM, y2: h - l.y2 * MM })),
  });
}
