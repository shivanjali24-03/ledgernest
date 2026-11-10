/**
 * A small PDF writer for report tables: no dependencies, the standard Helvetica fonts, A4 (landscape when the
 * columns need it), a header row repeated on every page, numbers right-aligned, and a footer with page numbers.
 *
 * The standard fonts only cover Windows-1252 (Western European text): the rupee sign becomes "Rs", and other
 * characters outside it (Devanagari, Arabic) become "?". Excel and CSV keep every character.
 */

export interface PdfTable {
  title: string;
  /** Under the title, e.g. the organisation and period */
  subtitle?: string;
  /** More lines under the subtitle on the first page (who it's from and to, dates, tax numbers) */
  info?: string[];
  /** Bottom-left of every page */
  footer?: string;
  /** The first row is the header */
  rows: (string | number | null)[][];
}

export const PDF_TYPE = 'application/pdf';

/** Helvetica widths (per 1000 em) for space to tilde */
const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
/** Windows-1252's characters in 0x80–0x9F */
const CP1252: Record<string, number> = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };

/** Text as Windows-1252 bytes (one char per byte), with what it can't show replaced */
function encode(text: string): string {
  let out = '';
  for (const ch of text.replace(/₹\s?/g, 'Rs ').replace(/\s+/g, ' ')) {
    const c = ch.codePointAt(0)!;
    if (c >= 32 && c < 127) out += ch;
    else if (c >= 0xa0 && c <= 0xff) out += ch;
    else if (CP1252[ch] !== undefined) out += String.fromCharCode(CP1252[ch]);
    else out += '?';
  }
  return out;
}

function width(encoded: string, size: number, bold = false) {
  let w = 0;
  for (let i = 0; i < encoded.length; i++) {
    const c = encoded.charCodeAt(i);
    w += (c >= 32 && c < 127 ? WIDTHS[c - 32] : undefined) ?? 556;
  }
  return (w * size * (bold ? 1.06 : 1)) / 1000;
}

function truncate(encoded: string, max: number, size: number, bold: boolean) {
  if (width(encoded, size, bold) <= max) return encoded;
  let s = encoded;
  while (s.length && width(`${s}\x85`, size, bold) > max) s = s.slice(0, -1);
  return `${s}\x85`;
}

const literal = (encoded: string) => `(${encoded.replace(/[\\()]/g, (m) => `\\${m}`)})`;
const num = (n: number) => (Math.round(n * 100) / 100).toString();
const NUMERIC = /^[-−(]?(Rs\s?)?[\d,]+(\.\d+)?%?\)?$/;

export function pdfTableBytes(table: PdfTable): Uint8Array {
  const size = 8;
  const rowH = 13;
  const margin = 40;
  const pad = 4;
  const rows = table.rows.map((r) => r.map((c) => encode(c === null ? '' : String(c))));
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  const cols = Math.max(0, ...rows.map((r) => r.length));
  const natural = Array.from({ length: cols }, (_, j) => Math.min(220, Math.max(24, ...rows.map((r, i) => width(r[j] ?? '', size, i === 0) + pad * 2))));
  const sum = natural.reduce((a, b) => a + b, 0);
  const landscape = sum > 595 - margin * 2;
  const [pw, ph] = landscape ? [842, 595] : [595, 842];
  const avail = pw - margin * 2;
  const widths = sum > avail ? natural.map((w) => (w * avail) / sum) : natural;
  // Columns of numbers go right, except codes, GSTINs, documents and dates (as in the Excel export)
  const numeric = Array.from({ length: cols }, (_, j) => !/code|gstin|document|number|hsn|reference|date|section/i.test(header[j] ?? '') && body.some((r) => r[j]) && body.every((r) => !r[j] || NUMERIC.test(r[j])));

  const top = ph - margin;
  const info = (table.info ?? []).slice(0, 12);
  const firstY = top - (table.subtitle ? 44 : 30) - info.length * 11 - (info.length ? 6 : 0);
  const perFirst = Math.floor((firstY - margin - 24) / rowH) - 1;
  const perPage = Math.floor((top - margin - 24) / rowH) - 1;
  const pages: string[][][] = [];
  let rest = body;
  do {
    const n = pages.length === 0 ? perFirst : perPage;
    pages.push(rest.slice(0, n));
    rest = rest.slice(n);
  } while (rest.length);

  const line = (cells: string[], y: number, bold: boolean) => {
    let x = margin;
    let out = '';
    cells.forEach((c, j) => {
      const w = widths[j] ?? 0;
      const t = truncate(c, w - pad * 2, size, bold);
      if (t) {
        const tx = numeric[j] ? x + w - pad - width(t, size, bold) : x + pad;
        out += `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${num(tx)} ${num(y)} Td ${literal(t)} Tj ET\n`;
      }
      x += w;
    });
    return out;
  };

  const streams = pages.map((pageRows, p) => {
    let s = '0 g\n';
    let y = top;
    if (p === 0) {
      s += `BT /F2 14 Tf ${margin} ${num(y - 14)} Td ${literal(encode(table.title))} Tj ET\n`;
      if (table.subtitle) s += `BT /F1 9 Tf ${margin} ${num(y - 30)} Td ${literal(encode(table.subtitle))} Tj ET\n`;
      info.forEach((l, k) => {
        s += `BT /F1 8.5 Tf ${margin} ${num(y - (table.subtitle ? 44 : 30) - 4 - k * 11)} Td ${literal(truncate(encode(l), pw - margin * 2, 8.5, false))} Tj ET\n`;
      });
      y = firstY;
    }
    s += line(header, y - 9, true);
    s += `0.6 G 0.5 w ${margin} ${num(y - rowH + 1)} m ${num(pw - margin)} ${num(y - rowH + 1)} l S\n`;
    y -= rowH;
    for (const r of pageRows) {
      s += line(r, y - 9, false);
      y -= rowH;
    }
    s += `0.4 g BT /F1 7 Tf ${margin} ${margin - 16} Td ${literal(encode(table.footer ?? ''))} Tj ET\n`;
    const pn = encode(`Page ${p + 1} of ${pages.length}`);
    s += `BT /F1 7 Tf ${num(pw - margin - width(pn, 7))} ${margin - 16} Td ${literal(pn)} Tj ET\n`;
    return s;
  });

  // Objects: 1 catalog, 2 pages, 3 and 4 fonts, then a page and its content for each page.
  const objects: string[] = [];
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  streams.forEach((s, i) => {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`);
    objects.push(`<< /Length ${s.length} >>\nstream\n${s}endstream`);
  });
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
