import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NetmapClient, NodeState } from '../../../src/client/netmap';
import { NetmapServiceClient } from '../../../src/gen/netmap/service_grpc_pb';
import { expectDeadline, expectNoDeadline } from '../helpers/deadline';

vi.mock('@grpc/grpc-js', () => ({
  credentials: {
    createSsl: vi.fn(() => ({})),
    createInsecure: vi.fn(() => ({})),
  },
}));

vi.mock('@axlabs/neofs-sdk-ts-core/crypto', () => ({
  publicKeyBytes: vi.fn(() => new Uint8Array(33).fill(4)),
}));

vi.mock('../../../src/gen/netmap/service_grpc_pb', () => ({
  NetmapServiceClient: vi.fn(function NetmapServiceClientMock(this: any) {
    this.localNodeInfo = vi.fn();
    this.networkInfo = vi.fn();
    this.netmapSnapshot = vi.fn();
  }),
}));

describe('NetmapClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeClient(grpc: any, timeout?: number) {
    const ctor = vi.mocked(NetmapServiceClient as any);
    ctor.mockImplementation(function (this: any) {
      Object.assign(this, grpc);
    });
    const signer = {
      public: vi.fn(() => ({})),
      sign: vi.fn(() => new Uint8Array([1])),
      scheme: vi.fn(() => 1),
    };
    return new NetmapClient({
      endpoint: 'grpc://netmap.test:9090',
      signer: signer as any,
      ...(timeout !== undefined ? { timeout } : {}),
    });
  }

  it('localNodeInfo maps version and node', async () => {
    const client = makeClient({
      localNodeInfo: vi.fn().mockResolvedValue({
        Body: {
          Version: { Major: 2, Minor: 18 },
          NodeInfo: {
            PublicKey: new Uint8Array([7, 8]),
            Addresses: ['1.2.3.4:8080'],
            Attributes: [{ Key: 'k', Value: 'v', Parents: ['p'] }],
            State: NodeState.ONLINE,
          },
        },
      }),
    });
    const got = await client.localNodeInfo();
    expect(got.version).toEqual({ major: 2, minor: 18 });
    expect(got.nodeInfo.publicKey).toEqual(new Uint8Array([7, 8]));
    expect(got.nodeInfo.addresses).toEqual(['1.2.3.4:8080']);
    expect(got.nodeInfo.attributes[0]).toEqual({ key: 'k', value: 'v', parents: ['p'] });
    expect(got.nodeInfo.state).toBe(NodeState.ONLINE);
  });

  it('localNodeInfo throws on status error', async () => {
    const client = makeClient({
      localNodeInfo: vi.fn().mockResolvedValue({
        MetaHeader: { Status: { Code: 9, Message: 'bad' } },
        Body: {},
      }),
    });
    await expect(client.localNodeInfo()).rejects.toThrow(
      'Failed to get local node info: NeoFS error: bad (code: 9)',
    );
  });

  it('localNodeInfo throws when body missing fields', async () => {
    const client = makeClient({
      localNodeInfo: vi.fn().mockResolvedValue({ Body: {} }),
    });
    await expect(client.localNodeInfo()).rejects.toThrow(
      'Failed to get local node info: Missing version or node info in response',
    );
  });

  it('networkInfo maps epoch and config parameters', async () => {
    const client = makeClient({
      networkInfo: vi.fn().mockResolvedValue({
        Body: {
          NetworkInfo: {
            CurrentEpoch: 99n,
            MagicNumber: 123n,
            MsPerBlock: 15n,
            NetworkConfig: {
              Parameters: [{ Key: new Uint8Array([1]), Value: new Uint8Array([2]) }],
            },
            NetmapVersion: 8n,
          },
        },
      }),
    });
    const n = await client.networkInfo();
    expect(n.currentEpoch).toBe(99);
    expect(n.magicNumber).toBe(123);
    expect(n.msPerBlock).toBe(15);
    expect(n.netmapVersion).toBe(8);
    expect(n.networkConfig.parameters).toEqual([
      { key: new Uint8Array([1]), value: new Uint8Array([2]) },
    ]);
  });

  it('netmapSnapshot maps nodes and epoch', async () => {
    const client = makeClient({
      netmapSnapshot: vi.fn().mockResolvedValue({
        Body: {
          Netmap: {
            Epoch: 5n,
            Version: 3n,
            Nodes: [
              {
                PublicKey: new Uint8Array([1]),
                Addresses: ['a'],
                Attributes: [],
                State: NodeState.OFFLINE,
              },
            ],
          },
        },
      }),
    });
    const snap = await client.netmapSnapshot();
    expect(snap.epoch).toBe(5);
    expect(snap.version).toBe(3);
    expect(snap.nodes).toHaveLength(1);
    expect(snap.nodes[0].state).toBe(NodeState.OFFLINE);
  });

  const deadlineCases = [
    {
      name: 'localNodeInfo',
      call: (client: NetmapClient) => client.localNodeInfo(),
      ok: {
        Body: {
          Version: { Major: 2, Minor: 18 },
          NodeInfo: { PublicKey: new Uint8Array([1]), Addresses: [], Attributes: [], State: 1 },
        },
      },
    },
    {
      name: 'networkInfo',
      call: (client: NetmapClient) => client.networkInfo(),
      ok: {
        Body: {
          NetworkInfo: { CurrentEpoch: 1n, MagicNumber: 1n, MsPerBlock: 1n, NetworkConfig: { Parameters: [] } },
        },
      },
    },
    {
      name: 'netmapSnapshot',
      call: (client: NetmapClient) => client.netmapSnapshot(),
      ok: { Body: { Netmap: { Epoch: 1n, Nodes: [] } } },
    },
  ] as const;

  for (const spec of deadlineCases) {
    it(`${spec.name}() passes the configured deadline`, async () => {
      const rpc = vi.fn().mockResolvedValue(spec.ok);
      const client = makeClient({ [spec.name]: rpc }, 2500);
      await spec.call(client);
      expectDeadline(rpc.mock.calls[0][2], 2500);
    });

    it(`${spec.name}() stays unbounded when timeout is omitted`, async () => {
      const rpc = vi.fn().mockResolvedValue(spec.ok);
      const client = makeClient({ [spec.name]: rpc });
      await spec.call(client);
      expectNoDeadline(rpc.mock.calls[0][2]);
    });
  }
});
