import { NotFoundException } from '@nestjs/common';
import { sniffLogoType } from '@ledgernest/shared';

/**
 * The type to serve a stored logo, signature or seal as, from its bytes rather than the stored label: a PNG,
 * JPEG or WebP image, or nothing at all. Uploads are checked already; this also covers rows that arrived
 * another way (a restored backup), so nothing but an image is ever served from these endpoints.
 */
export function servableImageType(data: Uint8Array): string {
  const type = sniffLogoType(data);
  if (!type) throw new NotFoundException('No image here.');
  return type;
}
