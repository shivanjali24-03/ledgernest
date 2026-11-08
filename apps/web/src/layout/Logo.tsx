import { useId } from 'react';

/** LedgerNest mark: a nest of three ledger lines with a rising bar, on a teal tile. */
export default function Logo({ className }: { className?: string }) {
  // Unique per instance: a shared id breaks when the first logo is inside a hidden element
  const tile = `ln-tile-${useId()}`;
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label="LedgerNest">
      <defs>
        <linearGradient id={tile} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1fe0c8" />
          <stop offset="1" stopColor="#067e74" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="13" fill={`url(#${tile})`} />
      <path d="M12 31c4 5 20 5 24 0" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M14 26c3 3.5 17 3.5 20 0" fill="none" stroke="#fff" strokeOpacity=".7" strokeWidth="2.6" strokeLinecap="round" />
      <rect x="17" y="13" width="4" height="9" rx="2" fill="#fff" />
      <rect x="23" y="10" width="4" height="12" rx="2" fill="#fff" />
      <rect x="29" y="15" width="4" height="7" rx="2" fill="#fff" fillOpacity=".8" />
    </svg>
  );
}
