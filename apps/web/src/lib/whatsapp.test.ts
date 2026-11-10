import { indianMobile, whatsappLink } from './whatsapp';

describe('WhatsApp links', () => {
  it('reads Indian mobile numbers however they are written', () => {
    for (const p of ['98220 31144', '+91 98220 31144', '+91-98220-31144', '09822031144', '919822031144', '0091 98220 31144']) expect(indianMobile(p), p).toBe('919822031144');
  });

  it('leaves out landlines and anything that is not an Indian mobile', () => {
    for (const p of [null, '', '+91 20 4011 2200', '020 4011 2200', '12345', '+1 415 555 0100', '5822031144']) expect(indianMobile(p), String(p)).toBeNull();
  });

  it('builds the click-to-chat link with the message encoded', () => {
    expect(whatsappLink('Invoice INV/1 · ₹1,000 https://x.in/i/a?b=c', '98220 31144')).toBe(`https://wa.me/919822031144?text=${encodeURIComponent('Invoice INV/1 · ₹1,000 https://x.in/i/a?b=c')}`);
    expect(whatsappLink('Hi', '+91 20 4011 2200')).toBe('https://wa.me/?text=Hi');
  });
});
