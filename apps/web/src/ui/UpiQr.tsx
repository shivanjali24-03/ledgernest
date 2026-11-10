import { useMemo } from 'react';
import { qrMatrix, qrSvgPath } from '@ledgernest/shared';

/** A QR code, always dark on white with its quiet zone so phone cameras read it in dark mode and in print */
export default function UpiQr({ value, label, size = 128 }: { value: string; label: string; size?: number }) {
  const { d, size: n } = useMemo(() => qrSvgPath(qrMatrix(value)), [value]);
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${n} ${n}`} width={size} height={size} shapeRendering="crispEdges" className="shrink-0 rounded-lg bg-white">
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
