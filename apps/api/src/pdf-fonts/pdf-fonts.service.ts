import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { setPdfShaper } from '@ledgernest/shared';
import * as hb from 'harfbuzzjs';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const FONT = 'NotoSansDevanagari-Regular.ttf';

/** Where the font is: next to the app (assets/fonts), from the source or the build */
function fontPath() {
  const here = fileURLToPath(new URL('.', import.meta.url));
  return [
    join(process.cwd(), 'assets/fonts', FONT),
    join(here, '../../assets/fonts', FONT),
    join(here, '../../../assets/fonts', FONT),
  ].find((p) => existsSync(p));
}

/** A big-endian 16-bit signed value of a font table */
const i16 = (t: Uint8Array, at: number) => {
  const v = (t[at]! << 8) | t[at + 1]!;
  return v > 0x7fff ? v - 0x10000 : v;
};

/**
 * Hindi and Marathi on PDFs: HarfBuzz shapes Devanagari words with Noto Sans Devanagari (SIL Open Font License), and
 * the PDF writer embeds the font and draws the glyphs. Without the font, those letters print as "?" as before.
 */
@Injectable()
export class PdfFontsService implements OnModuleInit {
  private readonly log = new Logger('PdfFonts');

  onModuleInit() {
    const path = fontPath();
    if (!path) {
      this.log.warn(
        `${FONT} not found: Hindi and Marathi on PDFs print as "?"`,
      );
      return;
    }
    const data = readFileSync(path);
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const face = new hb.Face(new hb.Blob(bytes.slice().buffer));
    const font = new hb.Font(face);
    const head = face.referenceTable('head');
    const os2 = face.referenceTable('OS/2');
    const ext = font.hExtents();
    const buffer = new hb.Buffer();
    setPdfShaper({
      fontName: 'NotoSansDevanagari-Regular',
      fontFile: new Uint8Array(deflateSync(bytes)),
      fontLength: bytes.length,
      unitsPerEm: face.upem,
      ascent: ext.ascender,
      descent: ext.descender,
      // OS/2 sCapHeight (version 2 and later), else most of the ascent
      capHeight:
        os2 && os2.length >= 90 ? i16(os2, 88) : Math.round(ext.ascender * 0.7),
      bbox: head
        ? [i16(head, 36), i16(head, 38), i16(head, 40), i16(head, 42)]
        : [0, ext.descender, face.upem, ext.ascender],
      shape(text) {
        buffer.reset();
        buffer.addText(text);
        buffer.guessSegmentProperties();
        hb.shape(font, buffer);
        const pos = buffer.getGlyphPositions();
        return buffer.getGlyphInfos().map((g, n) => ({
          gid: g.codepoint,
          ax: pos[n]!.xAdvance,
          dx: pos[n]!.xOffset,
          dy: pos[n]!.yOffset,
        }));
      },
    });
  }
}
