import { describe, expect, it } from 'vitest';
import { numberInWordsIndian, rupeesInWords } from './words.js';

describe('amounts in words, the Indian way', () => {
  it.each([
    [0, 'Zero'],
    [7, 'Seven'],
    [15, 'Fifteen'],
    [40, 'Forty'],
    [99, 'Ninety Nine'],
    [100, 'One Hundred'],
    [101, 'One Hundred and One'],
    [999, 'Nine Hundred and Ninety Nine'],
    [1000, 'One Thousand'],
    [1005, 'One Thousand and Five'],
    [1250, 'One Thousand Two Hundred and Fifty'],
    [99_999, 'Ninety Nine Thousand Nine Hundred and Ninety Nine'],
    [1_00_000, 'One Lakh'],
    [1_18_000, 'One Lakh Eighteen Thousand'],
    [12_34_567, 'Twelve Lakh Thirty Four Thousand Five Hundred and Sixty Seven'],
    [1_00_00_000, 'One Crore'],
    [2_50_00_075, 'Two Crore Fifty Lakh and Seventy Five'],
    [1234_56_78_901, 'One Thousand Two Hundred and Thirty Four Crore Fifty Six Lakh Seventy Eight Thousand Nine Hundred and One'],
  ])('%i → %s', (n, words) => expect(numberInWordsIndian(n)).toBe(words));

  it('writes rupees and paise as an invoice prints them', () => {
    expect(rupeesInWords(1_18_000_00)).toBe('Indian Rupees One Lakh Eighteen Thousand Only');
    expect(rupeesInWords(1_18_000_50)).toBe('Indian Rupees One Lakh Eighteen Thousand and Fifty Paise Only');
    expect(rupeesInWords(75)).toBe('Seventy Five Paise Only');
    expect(rupeesInWords(0)).toBe('Indian Rupees Zero Only');
    expect(rupeesInWords(-500_00)).toBe('Minus Indian Rupees Five Hundred Only');
  });

  it('refuses what isn’t a whole number', () => {
    expect(() => numberInWordsIndian(1.5)).toThrow(RangeError);
    expect(() => numberInWordsIndian(-1)).toThrow(RangeError);
  });
});
