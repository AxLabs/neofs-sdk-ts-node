import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionClient } from '../../../src/client/session';
import { SessionServiceClient } from '../../../src/gen/session/service_grpc_pb';
import { createTestSigner } from '../helpers/rfc6979-signer';

vi.mock('@grpc/grpc-js', () => ({
  credentials: {
    createSsl: vi.fn(() => ({})),
    createInsecure: vi.fn(() => ({})),
  },
}));

vi.mock('../../../src/gen/session/service_grpc_pb', () => ({
  SessionServiceClient: vi.fn(function SessionServiceClientMock(this: any) {
    this.create = vi.fn();
  }),
}));

describe('SessionClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeClient(createImpl?: ReturnType<typeof vi.fn>) {
    const ctor = vi.mocked(SessionServiceClient as any);
    ctor.mockImplementation(function (this: any) {
      this.create = createImpl ?? vi.fn();
    });
    const signer = createTestSigner();
    return new SessionClient({} as any, {
      endpoint: 'grpc://session.test:9090',
      signer: signer as any,
    });
  }

  it('create parses id and session key from response', async () => {
    const create = vi.fn().mockResolvedValue({
      Body: {
        Id: new Uint8Array([1, 2]),
        SessionKey: new Uint8Array([3, 4, 5]),
      },
      MetaHeader: { Epoch: BigInt(7) },
    });
    const sc = makeClient(create);
    const token = await sc.create({ expiration: 100 });
    expect(token.id).toEqual(new Uint8Array([1, 2]));
    expect(token.sessionKey).toEqual(new Uint8Array([3, 4, 5]));
    expect(token.lifetime.exp).toBe(100);
    expect(token.lifetime.nbf).toBe(7);
    expect(create).toHaveBeenCalledTimes(1);
    const req = create.mock.calls[0][0];
    expect(req.Body.Expiration).toBe(BigInt(100));
  });

  it('create throws when response body missing', async () => {
    const sc = makeClient(vi.fn().mockResolvedValue({ Body: null }));
    await expect(sc.create({ expiration: 1 })).rejects.toThrow('No response body received');
  });

  it('prepareObjectSessionToken attaches object context', async () => {
    const sc = makeClient();
    const base = {
      id: new Uint8Array([9]),
      ownerId: new Uint8Array(25).fill(8),
      lifetime: { exp: 1, nbf: 0, iat: 0 },
      sessionKey: new Uint8Array([7]),
    };
    const address = {
      containerId: { value: new Uint8Array([1, 2]) },
      objectId: { value: new Uint8Array([3, 4]) },
    };
    const prepared = sc.prepareObjectSessionToken(base as any, address, 2);
    expect(prepared.context?.object?.verb).toBe(2);
    expect(prepared.context?.object?.address).toEqual(address);
    expect(prepared.signature?.sign?.length).toBeGreaterThan(0);
  });
});
