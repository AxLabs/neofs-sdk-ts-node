import { describe, expect, it } from 'vitest';
import * as sdk from '../../src/index';

describe('package index re-exports', () => {
  it('exports core surface symbols', () => {
    expect(sdk.NeoFSClient).toBeDefined();
    expect(sdk.Waiter).toBeDefined();
    expect(sdk.Table).toBeDefined();
    expect(sdk.BearerToken).toBeDefined();
    expect(sdk.Decimal).toBeDefined();
    expect(sdk.UserID).toBeDefined();
    expect(sdk.publicReadEACL).toBeDefined();
  });
});
