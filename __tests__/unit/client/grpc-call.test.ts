import { describe, expect, it } from 'vitest';
import { grpcCallOptions } from '../../../src/client/grpc-call';

describe('grpcCallOptions', () => {
  it('returns an absolute deadline for a positive timeout', () => {
    const before = Date.now();
    const options = grpcCallOptions(2500);
    const after = Date.now();
    expect(typeof options.deadline).toBe('number');
    const deadline = options.deadline as number;
    expect(deadline).toBeGreaterThanOrEqual(before + 2500);
    expect(deadline).toBeLessThanOrEqual(after + 2500);
  });

  it.each([undefined, 0, -1])('returns no deadline for %s', (timeout) => {
    expect(grpcCallOptions(timeout)).toEqual({});
  });
});
