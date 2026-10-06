import { expect } from 'vitest';

/** Deadline must sit within a few milliseconds of Date.now() + timeout. */
export function expectDeadline(options: { deadline?: number } | undefined, timeoutMs: number): void {
  expect(typeof options?.deadline).toBe('number');
  const expected = Date.now() + timeoutMs;
  expect(Math.abs((options!.deadline as number) - expected)).toBeLessThan(50);
}

/** No timeout means the call stays unbounded. */
export function expectNoDeadline(options: { deadline?: number } | undefined): void {
  if (options == null) return;
  expect(options).toEqual({});
}
