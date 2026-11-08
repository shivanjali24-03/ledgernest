import { GPU_SAFE_PROPS, fadeIn, fadeUp, page, scaleIn, stagger } from './tokens';

describe('motion tokens', () => {
  it('only animate GPU-safe properties (transform and opacity)', () => {
    for (const variants of [fadeUp, fadeIn, scaleIn, page]) {
      for (const state of Object.values(variants)) {
        if (typeof state !== 'object') continue;
        for (const prop of Object.keys(state)) expect(GPU_SAFE_PROPS.has(prop)).toBe(true);
      }
    }
  });

  it('every entrance starts hidden and ends fully visible', () => {
    for (const v of [fadeUp, fadeIn, scaleIn, page]) {
      expect((v.hidden as { opacity: number }).opacity).toBe(0);
      expect((v.show as { opacity: number }).opacity).toBe(1);
    }
  });

  it('stagger staggers children', () => {
    const v = stagger(0.08, 0.1);
    expect(v.show).toMatchObject({ transition: { staggerChildren: 0.08, delayChildren: 0.1 } });
  });
});
