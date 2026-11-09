import { detectDelimiter, parseCsv } from '@ledgernest/shared';

/**
 * Reads the first sheet of an Excel workbook (XLSX) or a CSV file as rows of text, in the browser and without
 * a library: the workbook is a zip of XML files, inflated with the browser's own DecompressionStream.
 */
export async function readSpreadsheet(file: File): Promise<string[][]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readXlsx(bytes);
  let text = new TextDecoder('utf-8').decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return parseCsv(text, detectDelimiter(text));
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The files in a zip, by name, read lazily */
function unzip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error('not a zip');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const dec = new TextDecoder();
  const files = new Map<string, () => Promise<Uint8Array>>();
  for (let n = 0; n < count && view.getUint32(at, true) === 0x02014b50; n++) {
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    files.set(name, async () => {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + size);
      return method === 8 ? inflate(data) : data;
    });
    at += 46 + nameLength + extra + comment;
  }
  return files;
}

const columnIndex = (ref: string) => [...ref.replace(/\d+$/, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

async function readXlsx(bytes: Uint8Array): Promise<string[][]> {
  const files = unzip(bytes);
  const xml = async (name: string) => {
    const f = files.get(name);
    return f ? new DOMParser().parseFromString(new TextDecoder().decode(await f()), 'application/xml') : null;
  };
  // The first sheet in the workbook, through its relationship; sheet1.xml if that can't be followed
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const workbook = await xml('xl/workbook.xml');
  const rels = await xml('xl/_rels/workbook.xml.rels');
  const first = workbook?.getElementsByTagName('sheet')[0];
  const rid = first?.getAttribute('r:id') ?? first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const target = rid ? [...(rels?.getElementsByTagName('Relationship') ?? [])].find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target') : null;
  if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  const text = (el: Element) => [...el.getElementsByTagName('t')].map((t) => t.textContent ?? '').join('');
  const shared = [...((await xml('xl/sharedStrings.xml'))?.getElementsByTagName('si') ?? [])].map(text);
  const sheet = await xml(sheetPath);
  if (!sheet) throw new Error('no sheet');
  const rows: string[][] = [];
  for (const row of sheet.getElementsByTagName('row')) {
    const r = Number(row.getAttribute('r') ?? rows.length + 1) - 1;
    const out: string[] = [];
    for (const c of row.getElementsByTagName('c')) {
      const ref = c.getAttribute('r');
      const at = ref ? columnIndex(ref) : out.length;
      const t = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      out[at] = t === 's' ? (shared[Number(v)] ?? '') : t === 'inlineStr' ? text(c) : t === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : v;
    }
    rows[r] = Array.from(out, (x) => x ?? '');
  }
  return Array.from(rows, (x) => x ?? []);
}
