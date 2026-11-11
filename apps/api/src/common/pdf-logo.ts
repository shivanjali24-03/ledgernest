import { deflateSync, inflateSync } from 'node:zlib';
import { jpegImage, type PdfImage } from '@ledgernest/shared';
import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * A PNG as an image a PDF can show: the scanlines unfiltered and split into colour and alpha (a PDF soft mask), each
 * deflated again. 8-bit, non-interlaced PNGs of every colour type; anything else gives null and the PDF goes without.
 */
export function pngImage(buf: Buffer): PdfImage | null {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let off = 8;
  let w = 0;
  let h = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  let plte: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const t = buf.toString('ascii', off + 4, off + 8);
    const d = buf.subarray(off + 8, off + 8 + len);
    if (t === 'IHDR') {
      w = d.readUInt32BE(0);
      h = d.readUInt32BE(4);
      depth = d[8]!;
      type = d[9]!;
      interlace = d[12]!;
    } else if (t === 'PLTE') plte = d;
    else if (t === 'tRNS') trns = d;
    else if (t === 'IDAT') idat.push(d);
    else if (t === 'IEND') break;
    off += 12 + len;
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[
    type
  ];
  if (
    !w ||
    !h ||
    depth !== 8 ||
    interlace !== 0 ||
    !channels ||
    w * h > 4_000_000
  )
    return null;
  if (type === 3 && !plte) return null;
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  const stride = w * channels;
  if (raw.length < h * (stride + 1)) return null;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[row + x - channels]! : 0;
      const b = y ? px[row - stride + x]! : 0;
      const c = y && x >= channels ? px[row - stride + x - channels]! : 0;
      let v = raw[src + x]!;
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[row + x] = v & 0xff;
    }
  }
  const n = w * h;
  const gray = type === 0 || type === 4;
  const color = Buffer.alloc(n * (gray ? 1 : 3));
  const alpha = Buffer.alloc(n, 255);
  for (let i = 0; i < n; i++) {
    if (type === 0) color[i] = px[i]!;
    else if (type === 4) {
      color[i] = px[i * 2]!;
      alpha[i] = px[i * 2 + 1]!;
    } else if (type === 2) px.copy(color, i * 3, i * 3, i * 3 + 3);
    else if (type === 6) {
      px.copy(color, i * 3, i * 4, i * 4 + 3);
      alpha[i] = px[i * 4 + 3]!;
    } else {
      const k = px[i]!;
      plte!.copy(color, i * 3, k * 3, k * 3 + 3);
      if (trns && k < trns.length) alpha[i] = trns[k]!;
    }
  }
  return {
    width: w,
    height: h,
    filter: 'FlateDecode',
    colorSpace: gray ? 'DeviceGray' : 'DeviceRGB',
    data: deflateSync(color),
    ...(alpha.some((v) => v !== 255) ? { smask: deflateSync(alpha) } : {}),
  };
}

/** The organisation's logo for its PDFs; null when there's none or it's a kind PDFs can't show (WebP) */
export async function organizationLogo(
  prisma: PrismaService,
  organizationId: string,
): Promise<PdfImage | null> {
  const logo = await prisma.organizationLogo.findUnique({
    where: { organizationId },
    select: { contentType: true, data: true },
  });
  if (!logo) return null;
  const bytes = Buffer.from(logo.data);
  if (logo.contentType === 'image/jpeg')
    return jpegImage(new Uint8Array(bytes));
  if (logo.contentType === 'image/png') return pngImage(bytes);
  return null;
}

/** The signatory's signature and the seal, ready for a PDF (each null when not uploaded or not readable) */
export async function organizationSignature(
  prisma: PrismaService,
  organizationId: string,
): Promise<{
  anchor: string;
  image: PdfImage | null;
  seal: PdfImage | null;
  /** The signatory's name and designation, for the line under "Authorised signatory" */
  name: string | null;
}> {
  const [rows, org] = await Promise.all([
    prisma.organizationImage.findMany({
      where: { organizationId },
      select: { kind: true, contentType: true, data: true },
    }),
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { signatoryName: true, signatoryDesignation: true },
    }),
  ]);
  const read = (kind: string) => {
    const r = rows.find((x) => x.kind === kind);
    if (!r) return null;
    const bytes = Buffer.from(r.data);
    return r.contentType === 'image/jpeg'
      ? jpegImage(new Uint8Array(bytes))
      : pngImage(bytes);
  };
  return {
    anchor: 'Authorised signatory',
    image: read('signature'),
    seal: read('seal'),
    name: org?.signatoryName
      ? `${org.signatoryName}${org.signatoryDesignation ? `, ${org.signatoryDesignation}` : ''}`
      : null,
  };
}
