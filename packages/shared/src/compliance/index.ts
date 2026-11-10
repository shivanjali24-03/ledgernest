/**
 * India's statutory due dates for a small business, so they show up before they're missed: GSTR-1 (the 11th) and
 * GSTR-3B (the 20th) for each month for a monthly GST filer, the annual GSTR-9 (31 December after the year), and
 * the four advance-tax instalments (15 June, September, December and March). Dates the government extends are
 * announced case by case; these are the regular ones.
 */

export type ComplianceKind = 'gstr1' | 'gstr3b' | 'gstr9' | 'advance_tax';

export interface ComplianceItem {
  kind: ComplianceKind;
  /** The period it covers */
  from: string;
  to: string;
  due: string;
  /** For advance tax: the share of the year's tax to have paid by then */
  share?: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const monthEnd = (y: number, m: number) => `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Due dates from a little before today (recently missed) to the horizon, soonest first. GST returns only for a
 * GST-registered business; financial years start in April, as Indian tax years do.
 */
export function complianceDueDates(today: string, { gst, horizonDays = 45, lookbackDays = 10 }: { gst: boolean; horizonDays?: number; lookbackDays?: number }): ComplianceItem[] {
  const from = addDays(today, -lookbackDays);
  const to = addDays(today, horizonDays);
  const out: ComplianceItem[] = [];
  const [y, m] = today.split('-').map(Number) as [number, number];
  // Months whose returns could fall due in the window: the last few and this one
  for (let k = -3; k <= 1; k++) {
    const d = new Date(Date.UTC(y, m - 1 + k, 1));
    const py = d.getUTCFullYear();
    const pm = d.getUTCMonth() + 1;
    const next = new Date(Date.UTC(py, pm, 1));
    const ny = next.getUTCFullYear();
    const nm = next.getUTCMonth() + 1;
    const period = { from: `${py}-${pad(pm)}-01`, to: monthEnd(py, pm) };
    if (gst) {
      out.push({ kind: 'gstr1', ...period, due: `${ny}-${pad(nm)}-11` });
      out.push({ kind: 'gstr3b', ...period, due: `${ny}-${pad(nm)}-20` });
    }
  }
  for (const fyStart of [y - 2, y - 1, y]) {
    const fy = { from: `${fyStart}-04-01`, to: `${fyStart + 1}-03-31` };
    if (gst) out.push({ kind: 'gstr9', ...fy, due: `${fyStart + 1}-12-31` });
    for (const [due, share] of [
      [`${fyStart}-06-15`, 0.15],
      [`${fyStart}-09-15`, 0.45],
      [`${fyStart}-12-15`, 0.75],
      [`${fyStart + 1}-03-15`, 1],
    ] as const)
      out.push({ kind: 'advance_tax', ...fy, due, share });
  }
  return out.filter((i) => i.due >= from && i.due <= to).sort((a, b) => a.due.localeCompare(b.due) || a.kind.localeCompare(b.kind));
}
