/**
 * jest-dom's matchers (toBeInTheDocument, toHaveTextContent, …) for Vitest 5's types.
 * jest-dom 7 still augments Vitest 4's `Assertion<T>`; Vitest 5 exposes `Matchers<R, T>` for this.
 * Remove this file once jest-dom ships Vitest 5 typings.
 */
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration merging
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> extends TestingLibraryMatchers<unknown, R> {}
}
