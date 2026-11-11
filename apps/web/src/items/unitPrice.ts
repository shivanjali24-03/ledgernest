/** A unit price moved between an item's units: a box of 12 costs 12 times a piece */
export function priceInUnit(price: number | null, factor: string, toAlt: boolean) {
  if (price === null) return null;
  const f = Number(factor);
  return Math.round(toAlt ? price * f : price / f);
}
