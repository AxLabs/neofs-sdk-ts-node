import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ObjectClient } from '../../../src/client/object-streaming';
import { ObjectServiceClient } from '../../../src/gen/object/service_grpc_pb';
import { expectDeadline, expectNoDeadline } from '../helpers/deadline';
import { BearerToken } from '../../../src/bearer/token';

vi.mock('@grpc/grpc-js', () => ({
  credentials: {
    createSsl: vi.fn(() => ({ kind: 'ssl' })),
    createInsecure: vi.fn(() => ({ kind: 'insecure' })),
  },
}));

vi.mock('@axlabs/neofs-sdk-ts-core/crypto', () => ({
  publicKeyBytes: vi.fn(() => new Uint8Array([1, 2, 3])),
}));

vi.mock('../../../src/client/session', () => ({
  SessionClient: class SessionClient {
    async create() {
      return {
        id: new Uint8Array([1]),
        ownerId: new Uint8Array([2]),
        lifetime: { exp: 1, nbf: 1, iat: 1 },
        sessionKey: new Uint8Array([3]),
      };
    }
  },
}));

vi.mock('../../../src/gen/object/service_grpc_pb', () => ({
  ObjectServiceClient: vi.fn(function ObjectServiceClientMock(this: any) {
    this.get = vi.fn();
    this.getRange = vi.fn();
    this.put = vi.fn();
    this.head = vi.fn();
    this.delete = vi.fn();
    this.search = vi.fn();
    this.searchV2 = vi.fn();
  }),
}));

class FakeReadableCall<T = any> {
  private handlers: Record<string, Array<(payload?: T | any) => void>> = {};

  on(event: string, handler: (payload?: T | any) => void): this {
    this.handlers[event] ??= [];
    this.handlers[event].push(handler);
    return this;
  }

  emit(event: 'data' | 'error' | 'end', payload?: T | any): void {
    for (const h of this.handlers[event] ?? []) h(payload);
  }
}

function createAddress() {
  return {
    containerId: { value: new Uint8Array([10, 11, 12]) },
    objectId: { value: new Uint8Array([20, 21, 22]) },
  };
}

function createSigner() {
  return {
    sign: vi.fn(() => new Uint8Array([9, 9, 9])),
    public: vi.fn(() => ({ mocked: true })),
    scheme: vi.fn(() => 1),
  };
}

function createClient(timeout?: number) {
  const signer = createSigner();
  const client = new ObjectClient({} as any, {
    signer: signer as any,
    endpoint: 'grpc://example.test:8080',
    ...(timeout !== undefined ? { timeout } : {}),
  });
  const ctor = vi.mocked(ObjectServiceClient as any);
  const grpcClient = ctor.mock.results.at(-1)?.value as any;
  return { client, grpcClient, signer };
}

describe('streaming ObjectClient get()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('collects payload when Init and Chunk arrive together', async () => {
    const { client, grpcClient } = createClient();
    const call = new FakeReadableCall();
    grpcClient.get.mockReturnValue(call);

    const header = { PayloadLength: 4n };
    const signature = { Sign: new Uint8Array([7]) };
    const promise = client.get({ address: createAddress() });

    call.emit('data', {
      Body: {
        Init: {
          ObjectId: { Value: new Uint8Array([1, 2, 3]) },
          Signature: signature,
          Header: header,
        },
        Chunk: new Uint8Array([65, 66]),
      },
    });
    call.emit('data', { Body: { Chunk: new Uint8Array([67, 68]) } });
    call.emit('end');

    await expect(promise).resolves.toEqual({
      objectId: { value: new Uint8Array([1, 2, 3]) },
      header: expect.objectContaining({ payloadLength: 4 }),
      signature,
      payload: new Uint8Array([65, 66, 67, 68]),
    });
  });

  it('rejects get() when stream reports SplitInfo', async () => {
    const { client, grpcClient } = createClient();
    const call = new FakeReadableCall();
    grpcClient.get.mockReturnValue(call);

    const promise = client.get({ address: createAddress() });
    call.emit('data', { Body: { SplitInfo: { LastPart: true } } });

    await expect(promise).rejects.toThrow('SplitInfo not supported yet');
  });

  it('rejects get() when no header is received', async () => {
    const { client, grpcClient } = createClient();
    const call = new FakeReadableCall();
    grpcClient.get.mockReturnValue(call);

    const promise = client.get({ address: createAddress() });
    call.emit('data', { Body: { Chunk: new Uint8Array([1]) } });
    call.emit('end');

    await expect(promise).rejects.toThrow('No object header in response');
  });

  it('wraps gRPC errors in get()', async () => {
    const { client, grpcClient } = createClient();
    const call = new FakeReadableCall();
    grpcClient.get.mockReturnValue(call);

    const promise = client.get({ address: createAddress() });
    call.emit('error', { message: 'network failed' });

    await expect(promise).rejects.toThrow('Failed to get object: network failed');
  });
});

describe('streaming ObjectClient getRange()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds request and returns concatenated range payload', async () => {
    const { client, grpcClient } = createClient();
    const call = new FakeReadableCall();
    grpcClient.get.mockReturnValue(call);

    const address = createAddress();
    const promise = client.getRange({
      address,
      range: { offset: 5n, length: 4n },
    });

    const request = grpcClient.get.mock.calls[0][0];
    expect(request.Body.Range.Offset).toBe(5n);
    expect(request.Body.Range.Length).toBe(4n);
    expect(request.Body.Raw).toBe(false);
    expect(request.Body.PayloadOnly).toBe(true);
    expect(request.Body.Address.ContainerId.Value).toEqual(address.containerId.value);
    expect(request.Body.Address.ObjectId.Value).toEqual(address.objectId.value);

    call.emit('data', { Body: { Chunk: new Uint8Array([1, 2]) } });
    call.emit('data', { Body: { Chunk: new Uint8Array([3, 4]) } });
    call.emit('end');

    await expect(promise).resolves.toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('passes through explicit raw=true in getRange()', async () => {
    const { client, grpcClient } = createClient();
    const call = new FakeReadableCall();
    grpcClient.get.mockReturnValue(call);

    const promise = client.getRange({
      address: createAddress(),
      range: { offset: 0n, length: 1n },
      raw: true,
    });

    const request = grpcClient.get.mock.calls[0][0];
    expect(request.Body.Raw).toBe(true);

    call.emit('data', { Body: { Chunk: new Uint8Array([255]) } });
    call.emit('end');

    await expect(promise).resolves.toEqual(new Uint8Array([255]));
  });

  it('rejects getRange() when assembled length differs from requested length', async () => {
    const { client, grpcClient } = createClient();
    const call = new FakeReadableCall();
    grpcClient.get.mockReturnValue(call);

    const promise = client.getRange({
      address: createAddress(),
      range: { offset: 0n, length: 5n },
    });

    call.emit('data', { Body: { Chunk: new Uint8Array([1, 2, 3, 4]) } });
    call.emit('end');

    await expect(promise).rejects.toThrow(
      'Get range size mismatch: expected 5 bytes, assembled 4',
    );
  });

  it('rejects getRange() when stream reports SplitInfo', async () => {
    const { client, grpcClient } = createClient();
    const call = new FakeReadableCall();
    grpcClient.get.mockReturnValue(call);

    const promise = client.getRange({
      address: createAddress(),
      range: { offset: 0n, length: 1n },
    });
    call.emit('data', { Body: { SplitInfo: { LastPart: true } } });

    await expect(promise).rejects.toThrow('SplitInfo not supported yet');
  });

  it('wraps gRPC errors in getRange()', async () => {
    const { client, grpcClient } = createClient();
    const call = new FakeReadableCall();
    grpcClient.get.mockReturnValue(call);

    const promise = client.getRange({
      address: createAddress(),
      range: { offset: 0n, length: 1n },
    });
    call.emit('error', { message: 'unavailable' });

    await expect(promise).rejects.toThrow('Failed to get object range: unavailable');
  });
});

describe('streaming ObjectClient head()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns full header from Header wrapper', async () => {
    const { client, grpcClient } = createClient();
    const inner = { ContainerId: { Value: new Uint8Array([1]) }, OwnerId: { Value: new Uint8Array([2]) } };
    grpcClient.head.mockResolvedValue({
      Body: { Header: { Header: inner } },
    });
    await expect(client.head({ address: createAddress() })).resolves.toMatchObject({
      containerId: { value: new Uint8Array([1]) },
      ownerId: new Uint8Array([2]),
    });
  });

  it('maps ShortHeader to ObjectHeader shape', async () => {
    const { client, grpcClient } = createClient();
    const addr = createAddress();
    grpcClient.head.mockResolvedValue({
      Body: {
        ShortHeader: {
          OwnerId: { Value: new Uint8Array([5, 6]) },
          ObjectType: 0,
          PayloadLength: 100n,
          Version: { Major: 2, Minor: 0 },
        },
      },
    });
    const h = await client.head({ address: addr });
    expect(h.containerId).toEqual(addr.containerId);
    expect(h.ownerId).toEqual(new Uint8Array([5, 6]));
    expect(h.payloadLength).toBe(100);
    expect(h.version).toEqual({ major: 2, minor: 0 });
  });

  it('throws on SplitInfo', async () => {
    const { client, grpcClient } = createClient();
    grpcClient.head.mockResolvedValue({ Body: { SplitInfo: {} } });
    await expect(client.head({ address: createAddress() })).rejects.toThrow(
      'SplitInfo not supported yet',
    );
  });

  it('throws when body missing', async () => {
    const { client, grpcClient } = createClient();
    grpcClient.head.mockResolvedValue({});
    await expect(client.head({ address: createAddress() })).rejects.toThrow('No response body received');
  });
});

describe('streaming ObjectClient delete()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns address on success', async () => {
    const { client, grpcClient } = createClient();
    grpcClient.delete.mockResolvedValue({});
    const addr = createAddress();
    await expect(client.delete({ address: addr })).resolves.toBe(addr);
  });
});

describe('streaming ObjectClient search()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('collects object ids from stream', async () => {
    const { client, grpcClient } = createClient();
    const call = new FakeReadableCall();
    grpcClient.search.mockReturnValue(call);

    const p = client.search({
      containerId: { value: new Uint8Array([1, 2]) },
      filters: [{ key: 'k', value: 'v', matchType: 1 }],
    });

    call.emit('data', { Body: { IdList: [{ Value: new Uint8Array([10]) }, { Value: new Uint8Array([11]) }] } });
    call.emit('end');

    await expect(p).resolves.toEqual([{ value: new Uint8Array([10]) }, { value: new Uint8Array([11]) }]);
    const req = grpcClient.search.mock.calls[0][0];
    expect(req.Body.ContainerId.Value).toEqual(new Uint8Array([1, 2]));
    expect(req.Body.Filters[0].Key).toBe('k');
  });

  it('wraps stream errors', async () => {
    const { client, grpcClient } = createClient();
    const call = new FakeReadableCall();
    grpcClient.search.mockReturnValue(call);
    const p = client.search({ containerId: { value: new Uint8Array([1]) } });
    call.emit('error', { message: 'rpc' });
    await expect(p).rejects.toThrow('Failed to search objects: rpc');
  });
});

describe('streaming ObjectClient searchV2()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses attributes and cursor', async () => {
    const { client, grpcClient } = createClient();
    grpcClient.searchV2.mockResolvedValue({
      Body: {
        Result: [
          {
            Id: { Value: new Uint8Array([7]) },
            Attributes: ['a=b', 'c=d=e'],
          },
        ],
        Cursor: 'next-page',
      },
    });

    const out = await client.searchV2({
      containerId: { value: new Uint8Array([3]) },
      filters: [{ key: 'x', value: 'y', matchType: 0 }],
      limit: 50,
      cursor: 'cur',
    });

    expect(out.cursor).toBe('next-page');
    expect(out.result[0].id).toEqual({ value: new Uint8Array([7]) });
    expect(out.result[0].attributes).toEqual([
      { key: 'a', value: 'b' },
      { key: 'c', value: 'd=e' },
    ]);
    const req = grpcClient.searchV2.mock.calls[0][0];
    expect(req.Body.Count).toBe(50);
    expect(req.Body.Cursor).toBe('cur');
  });

  it('throws when body missing', async () => {
    const { client, grpcClient } = createClient();
    grpcClient.searchV2.mockResolvedValue({});
    await expect(
      client.searchV2({ containerId: { value: new Uint8Array([1]) } }),
    ).rejects.toThrow('No response body received');
  });
});

describe('streaming ObjectClient put()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('streams init and chunks then resolves calculated object id', async () => {
    const { client, grpcClient } = createClient();
    const chunks: any[] = [];
    grpcClient.put.mockImplementation((_a: any, _b: any, cb: any) => {
      return {
        write: (msg: any) => chunks.push(msg),
        end: () => {
          queueMicrotask(() =>
            cb(null, {
              MetaHeader: { Status: { Code: 0 } },
              Body: {},
            }),
          );
        },
      };
    });

    const containerId = { value: new Uint8Array(32).fill(4) };
    const ownerId = new Uint8Array(25).fill(8);
    const oid = await client.put({
      header: {
        containerId,
        ownerId,
        objectType: 0,
        version: { major: 2, minor: 0 },
        attributes: [],
      },
      payload: new Uint8Array([1, 2, 3, 4]),
    });

    expect(oid.value).toBeInstanceOf(Uint8Array);
    expect(oid.value.length).toBe(32);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('put rejects when response status non-zero', async () => {
    const { client, grpcClient } = createClient();
    grpcClient.put.mockImplementation((_a: any, _b: any, cb: any) => {
      return {
        write: vi.fn(),
        end: () => {
          queueMicrotask(() =>
            cb(null, {
              MetaHeader: { Status: { Code: 500, Message: 'nope' } },
              Body: {},
            }),
          );
        },
      };
    });

    await expect(
      client.put({
        header: {
          containerId: { value: new Uint8Array(32) },
          ownerId: new Uint8Array(25),
          attributes: [],
          version: { major: 2, minor: 0 },
        },
      }),
    ).rejects.toThrow('NeoFS error: nope (code: 500)');
  });
});

const DEADLINE_MS = 4_000;

function putHeader() {
  return {
    containerId: { value: new Uint8Array(32).fill(4) },
    ownerId: new Uint8Array(25).fill(8),
    attributes: [] as Array<{ key: string; value: string }>,
    version: { major: 2, minor: 0 },
  };
}

async function objectCallOptions(
  client: ObjectClient,
  grpcClient: any,
  method: 'get' | 'getRange' | 'put' | 'head' | 'delete' | 'search' | 'searchV2',
): Promise<unknown> {
  if (method === 'get' || method === 'getRange') {
    const call = new FakeReadableCall();
    grpcClient.get.mockReturnValue(call);
    const pending =
      method === 'get'
        ? client.get({ address: createAddress() })
        : client.getRange({
            address: createAddress(),
            range: { offset: 0n, length: 1n },
          });
    call.emit('error', new Error('stop'));
    await pending.catch(() => undefined);
    return grpcClient.get.mock.calls[0][2];
  }
  if (method === 'search') {
    const call = new FakeReadableCall();
    grpcClient.search.mockReturnValue(call);
    const pending = client.search({ containerId: { value: new Uint8Array([1]) } });
    call.emit('end');
    await pending;
    return grpcClient.search.mock.calls[0][2];
  }
  if (method === 'put') {
    grpcClient.put.mockImplementation((_meta: unknown, _options: unknown, cb: any) => ({
      write: vi.fn(),
      end: () => {
        queueMicrotask(() => cb(null, { MetaHeader: { Status: { Code: 0 } }, Body: {} }));
      },
    }));
    await client.put({ header: putHeader(), payload: new Uint8Array([1]) });
    return grpcClient.put.mock.calls[0][1];
  }
  if (method === 'head') {
    grpcClient.head.mockResolvedValue({});
    await client.head({ address: createAddress() }).catch(() => undefined);
    return grpcClient.head.mock.calls[0][2];
  }
  if (method === 'delete') {
    grpcClient.delete.mockResolvedValue({});
    await client.delete({ address: createAddress() });
    return grpcClient.delete.mock.calls[0][2];
  }
  grpcClient.searchV2.mockResolvedValue({});
  await client.searchV2({ containerId: { value: new Uint8Array([1]) } }).catch(() => undefined);
  return grpcClient.searchV2.mock.calls[0][2];
}

describe('streaming ObjectClient gRPC deadlines', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const methods = ['get', 'getRange', 'put', 'head', 'delete', 'search', 'searchV2'] as const;

  for (const method of methods) {
    it(`${method}() passes the configured deadline`, async () => {
      const { client, grpcClient } = createClient(DEADLINE_MS);
      const options = await objectCallOptions(client, grpcClient, method);
      expectDeadline(options as { deadline?: number }, DEADLINE_MS);
    });

    it(`${method}() stays unbounded when timeout is omitted`, async () => {
      const { client, grpcClient } = createClient();
      const options = await objectCallOptions(client, grpcClient, method);
      expectNoDeadline(options as { deadline?: number });
    });
  }

  it('put() rejects the underlying gRPC error', async () => {
    const { client, grpcClient } = createClient(DEADLINE_MS);
    const grpcError = Object.assign(new Error('4 DEADLINE_EXCEEDED: Deadline exceeded'), { code: 4 });
    grpcClient.put.mockImplementation((_meta: unknown, options: { deadline?: number }, cb: any) => {
      expectDeadline(options, DEADLINE_MS);
      return {
        write: vi.fn(),
        end: () => {
          queueMicrotask(() => cb(grpcError));
        },
      };
    });

    await expect(client.put({ header: putHeader() })).rejects.toBe(grpcError);
  });
});

function uploadToken(): BearerToken {
  return new BearerToken().setLifetime({ iat: 1n, nbf: 1n, exp: 5n });
}

function collectPutMessages(grpcClient: { put: ReturnType<typeof vi.fn> }) {
  const messages: any[] = [];
  grpcClient.put.mockImplementation((_meta: unknown, _options: unknown, cb: any) => ({
    write: (msg: any) => messages.push(msg),
    end: () => {
      queueMicrotask(() => cb(null, { MetaHeader: { Status: { Code: 0 } }, Body: {} }));
    },
  }));
  return messages;
}

function signedBytes(signer: { sign: ReturnType<typeof vi.fn> }): string[] {
  return signer.sign.mock.calls.map((call) => Buffer.from(call[0] as Uint8Array).toString('hex'));
}

describe('streaming ObjectClient bearer token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('attaches the token to init and chunk messages before signing', async () => {
    const { client, grpcClient } = createClient();
    const messages = collectPutMessages(grpcClient);
    const token = uploadToken();

    await client.put({
      header: putHeader(),
      payload: new Uint8Array([1, 2, 3, 4]),
      bearerToken: token,
    });

    expect(messages.length).toBeGreaterThanOrEqual(2);
    const encoded = token.toProto().serializeBinary();
    for (const message of messages) {
      expect(message.MetaHeader.BearerToken.serializeBinary()).toEqual(encoded);
      expect(message.VerifyHeader).toBeDefined();
    }
  });

  it('attaches the token to an init-only upload', async () => {
    const { client, grpcClient } = createClient();
    const messages = collectPutMessages(grpcClient);
    const token = uploadToken();

    await client.put({ header: putHeader(), bearerToken: token });

    expect(messages).toHaveLength(1);
    expect(messages[0].MetaHeader.BearerToken.serializeBinary()).toEqual(
      token.toProto().serializeBinary(),
    );
  });

  it('leaves BearerToken unset when none is provided', async () => {
    const { client, grpcClient } = createClient();
    const messages = collectPutMessages(grpcClient);

    await client.put({ header: putHeader(), payload: new Uint8Array([1, 2]) });

    expect(messages.length).toBeGreaterThanOrEqual(2);
    for (const message of messages) {
      expect(message.MetaHeader.BearerToken).toBeUndefined();
    }
  });

  it('signs different meta-header bytes when a token is attached', async () => {
    const { client, grpcClient, signer } = createClient();
    collectPutMessages(grpcClient);
    const payload = new Uint8Array([1, 2]);
    const header = putHeader();

    await client.put({ header, payload });
    const withoutToken = signedBytes(signer);

    signer.sign.mockClear();
    await client.put({ header, payload, bearerToken: uploadToken() });
    const withToken = signedBytes(signer);

    expect(withToken[0]).toEqual(withoutToken[0]);
    expect(withToken.slice(1)).not.toEqual(withoutToken.slice(1));
  });

  it('still rejects a NeoFS status error when a token is attached', async () => {
    const { client, grpcClient } = createClient();
    grpcClient.put.mockImplementation((_meta: unknown, _options: unknown, cb: any) => ({
      write: vi.fn(),
      end: () => {
        queueMicrotask(() =>
          cb(null, { MetaHeader: { Status: { Code: 2048, Message: 'denied' } }, Body: {} }),
        );
      },
    }));

    await expect(
      client.put({ header: putHeader(), bearerToken: uploadToken() }),
    ).rejects.toThrow('NeoFS error: denied (code: 2048)');
  });

  it('still rejects a gRPC error when a token is attached', async () => {
    const { client, grpcClient } = createClient();
    const grpcError = new Error('7 PERMISSION_DENIED');
    grpcClient.put.mockImplementation((_meta: unknown, _options: unknown, cb: any) => ({
      write: vi.fn(),
      end: () => {
        queueMicrotask(() => cb(grpcError));
      },
    }));

    await expect(
      client.put({ header: putHeader(), bearerToken: uploadToken() }),
    ).rejects.toBe(grpcError);
  });
});
