/**
 * WhatsApp's click-to-chat link (wa.me): opens WhatsApp, or WhatsApp Web, with the message typed and ready to send.
 * Free, with no account or API key: the person sending presses send themselves.
 */

/** An Indian mobile number as WhatsApp wants it (91 and ten digits), or null for landlines and anything unclear */
export function indianMobile(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2); // 0091… dialled from abroad
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  return /^[6-9]\d{9}$/.test(d) ? `91${d}` : null;
}

/** To that number when there is one, else WhatsApp asks who to send it to */
export const whatsappLink = (text: string, phone?: string | null) => `https://wa.me/${indianMobile(phone) ?? ''}?text=${encodeURIComponent(text)}`;
