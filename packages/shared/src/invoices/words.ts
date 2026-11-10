/**
 * Amounts in words the Indian way, as tax invoices print them: lakh and crore, "and" before the last part, paise
 * after the rupees, "Only" at the end. "Indian Rupees One Lakh Eighteen Thousand and Fifty Paise Only".
 */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/** 0–99 */
const twoDigits = (n: number) => (n < 20 ? ONES[n]! : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);

/** 0–999, with "and" before the tens when there are hundreds */
const threeDigits = (n: number) => {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', rest ? twoDigits(rest) : ''].filter(Boolean).join(' and ');
};

/** A whole number in words with the Indian groups: crore, lakh, thousand, then hundreds */
export function numberInWordsIndian(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('A whole number from zero up');
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  if (crore) parts.push(`${numberInWordsIndian(crore)} Crore`);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  const thousand = Math.floor((n % 100_000) / 1000);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  const rest = n % 1000;
  if (rest) parts.push(rest < 100 && parts.length ? `and ${twoDigits(rest)}` : threeDigits(rest));
  return parts.join(' ');
}

/** Paise as the words printed on an Indian invoice */
export function rupeesInWords(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  const words = [rupees || !p ? `Indian Rupees ${numberInWordsIndian(rupees)}` : '', p ? `${rupees ? 'and ' : ''}${twoDigits(p)} Paise` : ''].filter(Boolean).join(' ');
  return `${negative ? 'Minus ' : ''}${words} Only`;
}
