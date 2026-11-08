import type { Transition, Variants } from 'motion/react';

/**
 * LedgerNest motion system.
 *
 * Every animation here moves only `transform` (x, y, scale, rotate) and `opacity`.
 * Browsers run those on the GPU compositor, so they stay smooth at the display's
 * full refresh rate (60, 120, 144 or 240 Hz) without re-laying out the page.
 * Springs are used instead of fixed durations so motion feels physical and can be
 * interrupted mid-way without jumping.
 */

export const spring = {
  /** Buttons, toggles, small UI: fast and crisp */
  snappy: { type: 'spring', stiffness: 520, damping: 36, mass: 0.6 },
  /** Cards, panels, pages: soft and settled */
  gentle: { type: 'spring', stiffness: 260, damping: 30, mass: 0.9 },
  /** Shared-layout movement like the active nav pill */
  glide: { type: 'spring', stiffness: 380, damping: 34 },
} satisfies Record<string, Transition>;

export const duration = { fast: 0.15, base: 0.25, slow: 0.4 } as const;

/** Standard ease for non-spring fades: quick start, gentle finish */
export const ease = [0.2, 0.8, 0.2, 1] as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: spring.gentle },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: duration.base, ease } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  show: { opacity: 1, scale: 1, transition: spring.snappy },
  exit: { opacity: 0, scale: 0.98, transition: { duration: duration.fast, ease } },
};

export const page: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: spring.gentle },
  exit: { opacity: 0, y: -6, transition: { duration: duration.fast, ease } },
};

/** Parent that reveals its children one after another */
export const stagger = (step = 0.05, delay = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: step, delayChildren: delay } },
});

/** Properties the compositor can animate without layout or paint. Used by tests. */
export const GPU_SAFE_PROPS = new Set(['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate', 'opacity', 'transition']);
