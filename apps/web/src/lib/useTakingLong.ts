import { useEffect, useState } from 'react';

/** True once `active` has stayed true for `ms`, e.g. to explain a slow first request. */
export function useTakingLong(active: boolean, ms = 5000): boolean {
  const [long, setLong] = useState(false);
  useEffect(() => {
    if (!active) return;
    const h = setTimeout(() => setLong(true), ms);
    return () => {
      clearTimeout(h);
      setLong(false);
    };
  }, [active, ms]);
  return active && long;
}
