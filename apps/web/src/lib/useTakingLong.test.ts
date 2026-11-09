import { act, renderHook } from '@testing-library/react';
import { useTakingLong } from './useTakingLong';

describe('useTakingLong', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('turns true only after the wait, and resets when the work ends', () => {
    const { result, rerender } = renderHook(({ active }) => useTakingLong(active, 5000), { initialProps: { active: true } });
    expect(result.current).toBe(false);
    act(() => void vi.advanceTimersByTime(4999));
    expect(result.current).toBe(false);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);

    rerender({ active: false });
    expect(result.current).toBe(false);
    rerender({ active: true });
    expect(result.current).toBe(false); // a new request starts the wait again
  });
});
