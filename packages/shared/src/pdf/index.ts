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
  /** Text after the table (terms, bank details), wrapped to the page; on a page of its own if it doesn't fit */
  after?: string[];
  /** Bottom-left of every page */
  footer?: string;
  /** The first row is the header */
  rows: (string | number | null)[][];
  /** A QR code at the top right of the first page (e.g. to pay by UPI), with a line or two of caption under it */
  qr?: PdfQr;
  /** A second QR code to the left of the first (e.g. an e-invoice's signed QR beside the UPI one) */
  qr2?: PdfQr;
  /** The organisation's logo at the top left of the first page, the heading under it */
  logo?: PdfImage | null;
  /**
   * A signature and a seal, drawn by the line of `after` that reads `anchor` (e.g. "Authorised signatory"): the
   * signature just above it, the seal beside it
   */
  signature?: { anchor: string; image?: PdfImage | null; seal?: PdfImage | null };
}

/** A QR code's modules, its size in points (88 by default, quiet zone included) and a line or two of caption */
export interface PdfQr {
  modules: boolean[][];
  caption?: string[];
  side?: number;
}

/** An image ready to embed: JPEG as it is (DCTDecode), or zlib-compressed samples (FlateDecode), with alpha as a soft mask */
export interface PdfImage {
  width: number;
  height: number;
  filter: 'DCTDecode' | 'FlateDecode';
  colorSpace: 'DeviceRGB' | 'DeviceGray' | 'DeviceCMYK';
  data: Uint8Array;
  /** For PNG data embedded as it is: its predictor, colours and columns */
  decodeParms?: string;
  /** zlib-compressed 8-bit alpha, the same size */
  smask?: Uint8Array;
}

/** A JPEG's size and colours, read from its frame header; null if it isn't one PDF can show */
export function jpegImage(bytes: Uint8Array): PdfImage | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1]!;
    const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    // Baseline, extended or progressive frames
    if (marker >= 0xc0 && marker <= 0xc2) {
      const height = (bytes[i + 5]! << 8) | bytes[i + 6]!;
      const width = (bytes[i + 7]! << 8) | bytes[i + 8]!;
      const comps = bytes[i + 9]!;
      const colorSpace = comps === 1 ? 'DeviceGray' : comps === 4 ? 'DeviceCMYK' : 'DeviceRGB';
      return width && height ? { width, height, filter: 'DCTDecode', colorSpace, data: bytes } : null;
    }
    i += 2 + len;
  }
  return null;
}

const binary = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
};

export const PDF_TYPE = 'application/pdf';

/** Helvetica widths (per 1000 em) for space to tilde */
const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
/** Windows-1252's characters in 0x80–0x9F */
const CP1252: Record<string, number> = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };

/**
 * Scripts Helvetica can't show (Devanagari, for Hindi and Marathi) are shaped into the glyphs of an embedded TrueType
 * font: conjuncts, half forms and matras placed as the font says. The server sets a shaper once (HarfBuzz with Noto
 * Sans Devanagari); without one, those letters print as "?" as before.
 */
export interface PdfShaper {
  /** The font's PostScript name, e.g. NotoSansDevanagari-Regular */
  fontName: string;
  /** The TrueType file, Flate-compressed, and its length before */
  fontFile: Uint8Array;
  fontLength: number;
  unitsPerEm: number;
  ascent: number;
  descent: number;
  capHeight: number;
  bbox: [number, number, number, number];
  /** One word's glyphs: id, advance and offsets, in font units */
  shape(text: string): { gid: number; ax: number; dx: number; dy: number }[];
}
let shaper: PdfShaper | null = null;
export const setPdfShaper = (s: PdfShaper | null) => {
  shaper = s;
};

/**
 * While a document is laid out, each shaped word stands in as one private-use character (so measuring, wrapping and
 * escaping work as for any text); writing the page turns it into glyphs of the embedded font.
 */
type Cluster = { text: string; glyphs: { gid: number; ax: number; dx: number; dy: number }[]; width: number };
let clusters: Cluster[] = [];
let clusterAt = new Map<string, number>();
const PUA = 0xe000;
const SHAPED_RUN = /[\u0900-\u097F\uA8E0-\uA8FF\u1CD0-\u1CFF][\u0900-\u097F\uA8E0-\uA8FF\u1CD0-\u1CFF\u200C\u200D]*/g;
function startDocument() {
  clusters = [];
  clusterAt = new Map();
}
const isCluster = (c: number) => c >= PUA && c < PUA + clusters.length;
function cluster(text: string): string {
  let n = clusterAt.get(text);
  if (n === undefined) {
    const glyphs = shaper!.shape(text);
    n = clusters.length;
    clusters.push({ text, glyphs, width: (glyphs.reduce((t, g) => t + g.ax, 0) * 1000) / shaper!.unitsPerEm });
    clusterAt.set(text, n);
  }
  return String.fromCharCode(PUA + n);
}

/** Text as Windows-1252 bytes (one char per byte), shaped words as their stand-ins, with what it can't show replaced */
function encode(text: string): string {
  let out = '';
  let clean = text.replace(/₹\s?/g, 'Rs ').replace(/\s+/g, ' ');
  if (shaper) clean = clean.replace(SHAPED_RUN, cluster);
  for (const ch of clean) {
    const c = ch.codePointAt(0)!;
    if (isCluster(c)) out += ch;
    else if (c >= 32 && c < 127) out += ch;
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
    w += isCluster(c) ? clusters[c - PUA]!.width : ((c >= 32 && c < 127 ? WIDTHS[c - 32] : undefined) ?? 556);
  }
  return (w * size * (bold ? 1.06 : 1)) / 1000;
}

function truncate(encoded: string, max: number, size: number, bold: boolean) {
  if (width(encoded, size, bold) <= max) return encoded;
  let s = encoded;
  while (s.length && width(`${s}\x85`, size, bold) > max) s = s.slice(0, -1);
  return `${s}\x85`;
}

/** Encoded text in lines that fit the width: broken at spaces, and inside a word only when it's longer than a line */
function wrapLines(encoded: string, max: number, size: number, bold = false): string[] {
  const out: string[] = [];
  let cur = '';
  const push = (word: string) => {
    let w = word;
    while (width(w, size, bold) > max) {
      let n = w.length;
      while (n > 1 && width(w.slice(0, n), size, bold) > max) n--;
      out.push(w.slice(0, n));
      w = w.slice(n);
    }
    return w;
  };
  for (const word of encoded.split(' ')) {
    const next = cur ? `${cur} ${word}` : word;
    if (width(next, size, bold) <= max) cur = next;
    else {
      if (cur) out.push(cur);
      cur = push(word);
    }
  }
  if (cur) out.push(cur);
  return out;
}

const literal = (encoded: string) => `(${encoded.replace(/[\\()]/g, (m) => `\\${m}`)})`;
const hex4 = (n: number) => n.toString(16).padStart(4, '0');

/**
 * A page's text with its shaped words written out: each as glyphs of the embedded font (F3), placed by their advances
 * and offsets, inside a span carrying the real text so it copies and searches as written. Records each glyph's width.
 */
function writeShaped(content: string, widths: Map<number, number>): string {
  if (!clusters.length) return content;
  const upem = shaper!.unitsPerEm;
  let font = 'F1';
  let size = '10';
  const glyphs = (c: Cluster) => {
    let ops = '';
    let arr = '';
    const flush = () => {
      if (arr) ops += `[${arr.trim()}] TJ `;
      arr = '';
    };
    for (const g of c.glyphs) {
      const adv = (g.ax * 1000) / upem;
      if (!widths.has(g.gid)) widths.set(g.gid, Math.round(adv));
      const w = widths.get(g.gid)!;
      const dx = (g.dx * 1000) / upem;
      if (g.dy) {
        flush();
        ops += `${num((g.dy * Number(size)) / upem)} Ts `;
      }
      if (dx) arr += `${num(-dx)} `;
      arr += `<${hex4(g.gid)}> `;
      // The pen moved the glyph's width (and dx before it); it should have moved its advance
      const back = dx + w - adv;
      if (Math.abs(back) > 0.01) arr += `${num(back)} `;
      if (g.dy) {
        flush();
        ops += '0 Ts ';
      }
    }
    flush();
    let utf16 = 'FEFF';
    for (let i = 0; i < c.text.length; i++) utf16 += hex4(c.text.charCodeAt(i));
    return `/Span << /ActualText <${utf16}> >> BDC /F3 ${size} Tf ${ops}/${font} ${size} Tf EMC `;
  };
  return content.replace(/\/(F[12]) ([\d.]+) Tf|\(((?:\\.|[^\\()])*)\) Tj/g, (m, f: string | undefined, sz: string | undefined, str: string | undefined) => {
    if (f) {
      font = f;
      size = sz!;
      return m;
    }
    if (!/[\uE000-\uF8FF]/.test(str!)) return m;
    let out = '';
    let latin = '';
    const text = str!;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (ch === '\\') {
        latin += ch + (text[++i] ?? '');
        continue;
      }
      const c = ch.charCodeAt(0);
      if (isCluster(c)) {
        if (latin) out += `(${latin}) Tj `;
        latin = '';
        out += glyphs(clusters[c - PUA]!);
      } else latin += ch;
    }
    if (latin) out += `(${latin}) Tj `;
    return out.trimEnd();
  });
}

/** The embedded font's objects (Type0, its CID font, descriptor and file), numbered from `first`; F3 is `first` */
function shapedFontObjects(first: number, widths: Map<number, number>): string[] {
  const f = shaper!;
  const k = 1000 / f.unitsPerEm;
  const w = [...widths].sort((a, b) => a[0] - b[0]).map(([gid, width]) => `${gid} [${width}]`).join(' ');
  return [
    `<< /Type /Font /Subtype /Type0 /BaseFont /${f.fontName} /Encoding /Identity-H /DescendantFonts [${first + 1} 0 R] >>`,
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${f.fontName} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${first + 2} 0 R /CIDToGIDMap /Identity /DW 1000 /W [${w}] >>`,
    `<< /Type /FontDescriptor /FontName /${f.fontName} /Flags 32 /FontBBox [${f.bbox.map((v) => Math.round(v * k)).join(' ')}] /ItalicAngle 0 /Ascent ${Math.round(f.ascent * k)} /Descent ${Math.round(f.descent * k)} /CapHeight ${Math.round(f.capHeight * k)} /StemV 80 /FontFile2 ${first + 3} 0 R >>`,
    `<< /Length ${f.fontFile.length} /Length1 ${f.fontLength} /Filter /FlateDecode >>\nstream\n${binary(f.fontFile)}\nendstream`,
  ];
}
const num = (n: number) => (Math.round(n * 100) / 100).toString();
const NUMERIC = /^[-−(]?(Rs\s?)?[\d,]+(\.\d+)?%?\)?$/;

export function pdfTableBytes(table: PdfTable): Uint8Array {
  startDocument();
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
  // The logo fits 120 x 40 points, keeping its shape; the heading starts under it
  const logo = table.logo ?? null;
  const logoScale = logo ? Math.min(120 / logo.width, 40 / logo.height) : 0;
  const logoW = logo ? logo.width * logoScale : 0;
  const logoH = logo ? logo.height * logoScale : 0;
  const headTop = logo ? top - logoH - 10 : top;
  const rawInfo = (table.info ?? []).slice(0, 12);
  // QR codes at the top right, side by side (88pt squares unless sized, quiet zone included), captions under each;
  // the heading's text keeps clear of them
  const two = !!table.qr?.modules.length && !!table.qr2?.modules.length;
  // Captions wrap under their code (alone, a caption may run a little to the left), three lines at most
  const qrs = [table.qr, table.qr2]
    .filter((q): q is PdfQr => !!q?.modules.length)
    .map((q) => {
      const side = q.side ?? 88;
      const room = side + (two ? 10 : 40);
      return { ...q, side, caption: (q.caption ?? []).flatMap((c, k) => wrapLines(encode(c), room, 7, k === 0).map((l) => ({ text: l, bold: k === 0 }))).slice(0, 3) };
    });
  const qrN = qrs.length;
  const qrBottom = Math.min(...qrs.map((q) => top - q.side - q.caption.length * 9));
  const headWidth = pw - margin * 2 - qrs.reduce((w, q) => w + q.side + 12, 0);
  // Lines under the heading wrap to the room beside the codes rather than being cut short (an IRN must be whole)
  const info = rawInfo.flatMap((l) => wrapLines(encode(l), headWidth, 8.5)).slice(0, 16);
  const firstY = Math.min(headTop - (table.subtitle ? 44 : 30) - info.length * 11 - (info.length ? 6 : 0), qrN ? qrBottom - 8 : Infinity);
  const perFirst = Math.floor((firstY - margin - 24) / rowH) - 1;
  const perPage = Math.floor((top - margin - 24) / rowH) - 1;
  const pages: string[][][] = [];
  let rest = body;
  do {
    const n = pages.length === 0 ? perFirst : perPage;
    pages.push(rest.slice(0, n));
    rest = rest.slice(n);
  } while (rest.length);

  // Text after the table: wrapped by words to the page, then on the last page if it fits, else a page of its own
  const wrap = (text: string) => {
    const out: string[] = [];
    let cur = '';
    for (const word of encode(text).split(' ')) {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && width(next, 8.5) > pw - margin * 2) {
        out.push(cur);
        cur = word;
      } else cur = next;
    }
    out.push(cur);
    return out;
  };
  const after = (table.after ?? []).flatMap((t) => (t.trim() ? wrap(t) : [''])).slice(0, 60);
  const lastRows = pages[pages.length - 1]!.length;
  const lastTop = pages.length === 1 ? firstY : top;
  const room = lastTop - rowH - lastRows * rowH - (margin + 24);
  // The signature and seal, by their line
  const sigAt = table.signature ? after.indexOf(encode(table.signature.anchor)) : -1;
  const sig = sigAt >= 0 ? (table.signature!.image ?? null) : null;
  const seal = sigAt >= 0 ? (table.signature!.seal ?? null) : null;
  const fit = (img: PdfImage, w: number, h: number) => {
    const k = Math.min(w / img.width, h / img.height);
    return { w: img.width * k, h: img.height * k };
  };
  // Between the "For …" line and the anchor: the two blank lines' height
  const sigBox = sig ? fit(sig, 110, 20) : null;
  const sealBox = seal ? fit(seal, 60, 60) : null;
  const afterOwnPage = after.length > 0 && room < 12 + after.length * 11 + (sealBox ? 30 : 0);
  if (afterOwnPage) pages.push([]);

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
      if (logo) s += `q ${num(logoW)} 0 0 ${num(logoH)} ${margin} ${num(top - logoH)} cm /Im1 Do Q\n`;
      y = headTop;
      s += `BT /F2 14 Tf ${margin} ${num(y - 14)} Td ${literal(truncate(encode(table.title), headWidth, 14, true))} Tj ET\n`;
      if (table.subtitle) s += `BT /F1 9 Tf ${margin} ${num(y - 30)} Td ${literal(truncate(encode(table.subtitle), headWidth, 9, false))} Tj ET\n`;
      info.forEach((l, k) => {
        s += `BT /F1 8.5 Tf ${margin} ${num(y - (table.subtitle ? 44 : 30) - 4 - k * 11)} Td ${literal(l)} Tj ET\n`;
      });
      let right = pw - margin;
      for (const q of qrs) {
        // One filled square per dark module, inside a 4-module quiet zone
        const n = q.modules.length;
        const cell = q.side / (n + 8);
        const x0 = right - q.side + 4 * cell;
        const y0 = top - 4 * cell;
        s += '0 g\n';
        q.modules.forEach((row, r) =>
          row.forEach((dark, c) => {
            if (dark) s += `${num(x0 + c * cell)} ${num(y0 - (r + 1) * cell)} ${num(cell)} ${num(cell)} re\n`;
          }),
        );
        s += 'f\n';
        q.caption.forEach((l, k) => {
          s += `BT /${l.bold ? 'F2' : 'F1'} 7 Tf ${num(right - width(l.text, 7, l.bold))} ${num(top - q.side - 6 - k * 9)} Td ${literal(l.text)} Tj ET\n`;
        });
        right -= q.side + 12;
      }
      y = firstY;
    }
    const last = p === pages.length - 1;
    if (!(last && afterOwnPage)) {
      s += line(header, y - 9, true);
      s += `0.6 G 0.5 w ${margin} ${num(y - rowH + 1)} m ${num(pw - margin)} ${num(y - rowH + 1)} l S\n`;
      y -= rowH;
      for (const r of pageRows) {
        s += line(r, y - 9, false);
        y -= rowH;
      }
      y -= 12;
    }
    if (last) {
      after.forEach((l, k) => {
        if (l) s += `0 g BT /F1 8.5 Tf ${margin} ${num(y - 9 - k * 11)} Td ${literal(l)} Tj ET\n`;
      });
      const base = y - 9 - sigAt * 11;
      if (sig && sigBox) s += `q ${num(sigBox.w)} 0 0 ${num(sigBox.h)} ${margin} ${num(base + 9)} cm /Im2 Do Q\n`;
      if (seal && sealBox) s += `q ${num(sealBox.w)} 0 0 ${num(sealBox.h)} ${margin + 130} ${num(base - sealBox.h / 2 + 4)} cm /Im3 Do Q\n`;
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
  // The images (each with its soft mask) come after the pages: Im1 the logo, Im2 the signature, Im3 the seal
  const images = ([['Im1', logo], ['Im2', sig], ['Im3', seal]] as [string, PdfImage | null][]).filter((x): x is [string, PdfImage] => !!x[1]);
  let nextId = 5 + streams.length * 2;
  const ids = images.map(([, img]) => {
    const id = nextId;
    nextId += img.smask ? 2 : 1;
    return id;
  });
  const xobject = images.length ? ` /XObject << ${images.map(([name], i) => `/${name} ${ids[i]} 0 R`).join(' ')} >>` : '';
  // Shaped words (Hindi, Marathi) in the embedded font, after the images
  const glyphWidths = new Map<number, number>();
  const written = streams.map((s) => writeShaped(s, glyphWidths));
  const f3 = clusters.length ? ` /F3 ${nextId} 0 R` : '';
  written.forEach((s, i) => {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /Font << /F1 3 0 R /F2 4 0 R${f3} >>${xobject} >> /Contents ${6 + i * 2} 0 R >>`);
    objects.push(`<< /Length ${s.length} >>\nstream\n${s}endstream`);
  });
  images.forEach(([, img], i) => {
    const parms = img.decodeParms ? ` /DecodeParms ${img.decodeParms}` : '';
    const mask = img.smask ? ` /SMask ${ids[i]! + 1} 0 R` : '';
    objects.push(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /${img.colorSpace} /BitsPerComponent 8 /Filter /${img.filter}${parms}${mask} /Length ${img.data.length} >>\nstream\n${binary(img.data)}\nendstream`);
    if (img.smask) objects.push(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${img.smask.length} >>\nstream\n${binary(img.smask)}\nendstream`);
  });
  if (clusters.length) objects.push(...shapedFontObjects(nextId, glyphWidths));
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

/** Text placed at a point on a page (points from the bottom left), e.g. on a cheque leaf */
export interface PdfText {
  x: number;
  y: number;
  text: string;
  size?: number;
  bold?: boolean;
  /** Spacing between characters (points), e.g. to fill date boxes */
  spacing?: number;
  /** Turned anticlockwise by this many degrees, e.g. along a cheque's crossing */
  angle?: number;
}

/** One page of positioned text and straight lines, any size, for forms printed onto stationery */
export function pdfPageBytes(page: { width: number; height: number; texts: PdfText[]; lines?: { x1: number; y1: number; x2: number; y2: number; width?: number }[] }): Uint8Array {
  startDocument();
  let s = '0 g 0 G\n';
  for (const l of page.lines ?? []) s += `${num(l.width ?? 0.8)} w ${num(l.x1)} ${num(l.y1)} m ${num(l.x2)} ${num(l.y2)} l S\n`;
  for (const t of page.texts) {
    const r = ((t.angle ?? 0) * Math.PI) / 180;
    const place = t.angle ? `${num(Math.cos(r))} ${num(Math.sin(r))} ${num(-Math.sin(r))} ${num(Math.cos(r))} ${num(t.x)} ${num(t.y)} Tm` : `${num(t.x)} ${num(t.y)} Td`;
    s += `BT /${t.bold ? 'F2' : 'F1'} ${num(t.size ?? 10)} Tf ${num(t.spacing ?? 0)} Tc ${place} ${literal(encode(t.text))} Tj ET\n`;
  }
  const widths = new Map<number, number>();
  s = writeShaped(s, widths);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [5 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R${clusters.length ? ' /F3 7 0 R' : ''} >> >> /Contents 6 0 R >>`,
    `<< /Length ${s.length} >>\nstream\n${s}endstream`,
    ...(clusters.length ? shapedFontObjects(7, widths) : []),
  ];
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
