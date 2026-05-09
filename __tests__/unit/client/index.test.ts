import { describe, expect, it } from 'vitest';
import * as clientExports from '../../../src/client';
import { ObjectClient as ObjectFacade } from '../../../src/client/object';
import { ObjectClient as StreamingObjectClient } from '../../../src/client/object-streaming';

describe('client entrypoint exports', () => {
  it('exports object facade and streaming object client aliases', () => {
    expect(clientExports.ObjectClient).toBe(ObjectFacade);
    expect(clientExports.StreamingObjectClient).toBe(StreamingObjectClient);
  });
});
