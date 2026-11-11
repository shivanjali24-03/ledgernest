import { deflateSync, inflateSync } from 'node:zlib';
import { pngImage } from './pdf-logo.js';

/** A PNG made by hand: chunks with dummy CRCs (they aren't checked) */
function png(w: number, h: number, type: number, rows: number[][], extra: [string, number[]][] = []) {
  const chunk = (t: string, d: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(d.length);
    return Buffer.concat([len, Buffer.from(t, 'ascii'), d, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = type;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...extra.map(([t, d]) => chunk(t, Buffer.from(d))),
    chunk('IDAT', deflateSync(Buffer.from(rows.flat()))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('PNG logos for PDFs', () => {
  it('unfilters RGB rows (Sub and Up filters) into plain samples, with no mask when opaque', () => {
    // 2 x 2: row 1 with Sub (second pixel adds the first), row 2 with Up (adds the row above)
    const img = pngImage(png(2, 2, 2, [[1, 10, 20, 30, 5, 5, 5], [2, 1, 1, 1, 2, 2, 2]]))!;
    expect(img).toMatchObject({ width: 2, height: 2, filter: 'FlateDecode', colorSpace: 'DeviceRGB' });
    expect([...inflateSync(Buffer.from(img.data))]).toEqual([10, 20, 30, 15, 25, 35, 11, 21, 31, 17, 27, 37]);
    expect(img.smask).toBeUndefined();
  });

  it('splits alpha into a soft mask for RGBA, and reads palettes with transparency', () => {
    const rgba = pngImage(png(1, 1, 6, [[0, 200, 100, 50, 128]]))!;
    expect([...inflateSync(Buffer.from(rgba.data))]).toEqual([200, 100, 50]);
    expect([...inflateSync(Buffer.from(rgba.smask!))]).toEqual([128]);
    const pal = pngImage(png(2, 1, 3, [[0, 1, 0]], [['PLTE', [0, 0, 0, 255, 0, 0]], ['tRNS', [0]]]))!;
    expect([...inflateSync(Buffer.from(pal.data))]).toEqual([255, 0, 0, 0, 0, 0]);
    expect([...inflateSync(Buffer.from(pal.smask!))]).toEqual([255, 0]);
  });

  it('gives up on what it can’t show', () => {
    expect(pngImage(Buffer.from('not a png at all, really not a png'))).toBeNull();
    const interlaced = png(1, 1, 2, [[0, 1, 2, 3]]);
    interlaced[8 + 8 + 12] = 1;
    expect(pngImage(interlaced)).toBeNull();
  });
});
