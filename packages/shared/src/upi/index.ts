import qrcode from 'qrcode-generator';

/**
 * UPI (India's Unified Payments Interface): an organisation's UPI ID, the `upi://pay` link that every UPI app
 * (Google Pay, PhonePe, Paytm, BHIM, bank apps) opens with the payee, amount and note filled in, and that link as a
 * QR code to print on invoices or show on screen. Free for everyone: no gateway, no fees, money straight to the bank.
 */

/** name@bank: letters, digits, dot, hyphen and underscore before the @, a handle of letters (and digits) after it */
export const UPI_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,255}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;

export const isUpiId = (v: string) => UPI_ID.test(v.trim());

export interface UpiPayment {
  /** The payee's UPI ID (pa) */
  upiId: string;
  /** The payee's name as the app should show it (pn) */
  name: string;
  /** In paise; left out, the payer types the amount */
  amount?: number | null;
  /** What it's for, shown to the payer and on their statement (tn), e.g. "Invoice INV-0042" */
  note?: string | null;
  /** A reference the payment carries back (tr), e.g. the invoice number */
  reference?: string | null;
}

/** UPI notes and names are short; apps cut or refuse long ones */
const clip = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * The `upi://pay` link for a payment in rupees (UPI only moves INR). Every value is percent-encoded, so the link is
 * plain ASCII and survives QR codes, SMS and WhatsApp whatever script the names are in.
 */
export function upiPayUri(p: UpiPayment): string {
  const parts: [string, string][] = [
    ['pa', p.upiId.trim()],
    ['pn', clip(p.name, 50)],
  ];
  if (p.amount != null && p.amount > 0) parts.push(['am', (p.amount / 100).toFixed(2)]);
  parts.push(['cu', 'INR']);
  if (p.note) parts.push(['tn', clip(p.note, 80)]);
  if (p.reference) parts.push(['tr', clip(p.reference, 35)]);
  return `upi://pay?${parts.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

/** A QR code as rows of modules (true = dark), without the quiet zone; medium error correction, sized to fit */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** The QR code as one SVG path (one square per dark module), for a viewBox of `0 0 size size` with a 4-module quiet zone */
export function qrSvgPath(modules: boolean[][]): { d: string; size: number } {
  let d = '';
  modules.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (dark) d += `M${c + 4} ${r + 4}h1v1h-1z`;
    }),
  );
  return { d, size: modules.length + 8 };
}
