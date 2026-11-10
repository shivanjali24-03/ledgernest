/** Tally exports XML in UTF-16 more often than not; read whichever it is */
export async function readTallyFile(f: File): Promise<string> {
  const b = new Uint8Array(await f.arrayBuffer());
  const encoding = b[0] === 0xff && b[1] === 0xfe ? 'utf-16le' : b[0] === 0xfe && b[1] === 0xff ? 'utf-16be' : b.length > 1 && b[1] === 0 ? 'utf-16le' : 'utf-8';
  return new TextDecoder(encoding).decode(b);
}
