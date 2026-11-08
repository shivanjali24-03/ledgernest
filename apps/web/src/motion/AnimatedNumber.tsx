import { useEffect, useRef } from 'react';
import { animate, useReducedMotion } from 'motion/react';

/**
 * Counts up to `value` with a spring. Updates the text directly each frame
 * (no React re-render per frame), so it stays smooth on high-refresh screens.
 */
export default function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const from = useRef(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce) {
      el.textContent = format(value);
      from.current = value;
      return;
    }
    const controls = animate(from.current, value, {
      type: 'spring',
      stiffness: 90,
      damping: 20,
      onUpdate: (v) => {
        el.textContent = format(v);
      },
    });
    from.current = value;
    return () => controls.stop();
  }, [value, format, reduce]);

  return (
    <span ref={ref} className="tabular">
      {format(reduce ? value : 0)}
    </span>
  );
}
