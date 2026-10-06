import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContainerClient } from '../../../src/client/container';
import { ContainerServiceClient } from '../../../src/gen/container/service_grpc_pb';
import { createTestSigner } from '../helpers/rfc6979-signer';
import { Record, Table, Target } from '../../../src/eacl';
import { expectDeadline, expectNoDeadline } from '../helpers/deadline';

vi.mock('@grpc/grpc-js', () => ({
  credentials: {
    createSsl: vi.fn(() => ({})),
    createInsecure: vi.fn(() => ({})),
  },
}));

vi.mock('../../../src/gen/container/service_grpc_pb', () => ({
  ContainerServiceClient: vi.fn(function ContainerServiceClientMock(this: any) {
    this.put = vi.fn();
    this.get = vi.fn();
    this.list = vi.fn();
    this.delete = vi.fn();
    this.setExtendedACL = vi.fn();
  }),
}));

const minimalContainer = {
  version: { major: 2, minor: 27 },
  ownerId: new Uint8Array(25).fill(11),
  nonce: new Uint8Array([1, 2]),
  basicAcl: 0x1f,
  attributes: [{ key: 'Name', value: 't' }],
  placementPolicy: {
    replicas: [{ count: 1, selector: '' }],
    containerBackupFactor: 0,
    selectors: [],
    filters: [],
  },
};

describe('ContainerClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeClient(grpc: Record<string, any>, timeout?: number) {
    const ctor = vi.mocked(ContainerServiceClient as any);
    ctor.mockImplementation(function (this: any) {
      Object.assign(this, grpc);
    });
    return new ContainerClient({
      endpoint: 'grpc://container.test:9090',
      signer: createTestSigner() as any,
      ...(timeout !== undefined ? { timeout } : {}),
    });
  }

  it('put returns container id from response', async () => {
    const put = vi.fn().mockResolvedValue({
      Body: { ContainerId: { Value: new Uint8Array([10, 11, 12]) } },
    });
    const cc = makeClient({ put });
    const id = await cc.put({ container: minimalContainer as any });
    expect(id).toEqual({ value: new Uint8Array([10, 11, 12]) });
    expect(put).toHaveBeenCalled();
  });

  it('put forwards placement policy initial rules (API v2.22+)', async () => {
    const put = vi.fn().mockResolvedValue({
      Body: { ContainerId: { Value: new Uint8Array([1]) } },
    });
    const cc = makeClient({ put });
    const c = {
      ...minimalContainer,
      placementPolicy: {
        ...minimalContainer.placementPolicy,
        initial: { replicaLimits: [2], maxReplicas: 4, preferLocal: true },
      },
    };
    await cc.put({ container: c as any });
    const proto = put.mock.calls[0][0].Body.Container.PlacementPolicy;
    expect(proto.Initial?.ReplicaLimits).toEqual([2]);
    expect(proto.Initial?.MaxReplicas).toBe(4);
    expect(proto.Initial?.PreferLocal).toBe(true);
  });

  it('put signs and forwards an initial EACL table', async () => {
    const put = vi.fn().mockResolvedValue({
      Body: { ContainerId: { Value: new Uint8Array([1]) } },
    });
    const cc = makeClient({ put });
    const eacl = new Table().addRecord(Record.allowGet([Target.others()]));

    await cc.put({ container: minimalContainer as any, eacl });

    const request = put.mock.calls[0][0];
    expect(request.Body.Eacl).toBeDefined();
    expect(request.Body.EaclSignature).toBeDefined();
    expect(request.VerifyHeader.RequestSignature).toBeDefined();
    expect(request.VerifyHeader.BodySignature).toBeUndefined();
  });

  it('put throws on NeoFS error status', async () => {
    const cc = makeClient({
      put: vi.fn().mockResolvedValue({
        MetaHeader: { Status: { Code: 2, Message: 'fail' } },
        Body: {},
      }),
    });
    await expect(cc.put({ container: minimalContainer as any })).rejects.toThrow(
      'Failed to create container: NeoFS error: fail (code: 2)',
    );
  });

  it('get maps container proto to SDK shape', async () => {
    const cc = makeClient({
      get: vi.fn().mockResolvedValue({
        Body: {
          Container: {
            Version: { Major: 2, Minor: 1 },
            OwnerId: { Value: new Uint8Array([99]) },
            Nonce: new Uint8Array([1]),
            BasicAcl: 7,
            Revision: 4n,
            Attributes: [{ Key: 'a', Value: 'b' }],
            PlacementPolicy: {
              ContainerBackupFactor: 3,
              Replicas: [{ Count: 2, Selector: 's' }],
              Selectors: [
                {
                  Name: 'n',
                  Count: 1,
                  Clause: 0,
                  Attribute: 'attr',
                  Filter: 'f',
                },
              ],
              Filters: [{ Name: 'fn', Key: 'fk', Op: 1, Value: 'v', Filters: [] }],
              Initial: { ReplicaLimits: [1, 0], MaxReplicas: 5, PreferLocal: false },
            },
          },
        },
      }),
    });
    const c = await cc.get({ containerId: { value: new Uint8Array(32).fill(1) } });
    expect(c.version).toEqual({ major: 2, minor: 1 });
    expect(c.ownerId).toEqual(new Uint8Array([99]));
    expect(c.basicAcl).toBe(7);
    expect(c.revision).toBe(4);
    expect(c.attributes).toEqual([{ key: 'a', value: 'b' }]);
    expect(c.placementPolicy.replicas[0]).toEqual({ count: 2, selector: 's' });
    expect(c.placementPolicy.containerBackupFactor).toBe(3);
    expect(c.placementPolicy.selectors[0].name).toBe('n');
    expect(c.placementPolicy.filters[0].key).toBe('fk');
    expect(c.placementPolicy.initial).toEqual({
      replicaLimits: [1, 0],
      maxReplicas: 5,
      preferLocal: false,
    });
  });

  it('list returns container ids or empty array when body absent', async () => {
    const listOk = vi.fn().mockResolvedValue({
      Body: {
        ContainerIds: [{ Value: new Uint8Array([1, 2]) }, { Value: new Uint8Array([3]) }],
      },
    });
    const cc1 = makeClient({ list: listOk });
    const ids = await cc1.list({ ownerId: new Uint8Array(25) });
    expect(ids).toEqual([{ value: new Uint8Array([1, 2]) }, { value: new Uint8Array([3]) }]);

    const cc2 = makeClient({ list: vi.fn().mockResolvedValue({}) });
    const empty = await cc2.list({ ownerId: new Uint8Array(25) });
    expect(empty).toEqual([]);
  });

  it('delete completes when status ok', async () => {
    const del = vi.fn().mockResolvedValue({ MetaHeader: { Status: { Code: 0 } } });
    const cc = makeClient({ delete: del });
    await expect(
      cc.delete({ containerId: { value: new Uint8Array(32).fill(2) } }),
    ).resolves.toBeUndefined();
    expect(del).toHaveBeenCalled();
  });

  const deadlineCases = [
    {
      name: 'put',
      call: (cc: ContainerClient) => cc.put({ container: minimalContainer as any }),
    },
    {
      name: 'get',
      call: (cc: ContainerClient) => cc.get({ containerId: { value: new Uint8Array(32) } }),
    },
    {
      name: 'list',
      call: (cc: ContainerClient) => cc.list({ ownerId: new Uint8Array(25) }),
    },
    {
      name: 'delete',
      call: (cc: ContainerClient) => cc.delete({ containerId: { value: new Uint8Array(32) } }),
    },
  ] as const;

  it('setEACL sends the table and the observed container revision', async () => {
    const setExtendedACL = vi.fn().mockResolvedValue({ MetaHeader: { Status: { Code: 0 } } });
    const cc = makeClient({ setExtendedACL });
    const containerId = new Uint8Array(32).fill(7);
    await cc.setEACL({
      eacl: new Table(containerId).denyWrite([Target.others()]),
      revision: 3,
    });
    const request = setExtendedACL.mock.calls[0][0];
    expect(request.Body.ContainerRevision).toBe(3n);
    expect(request.Body.Eacl.ContainerId.Value).toEqual(containerId);
    expect(request.Body.Signature.Sign).toBeInstanceOf(Uint8Array);
    expectNoDeadline(setExtendedACL.mock.calls[0][2]);
  });

  for (const spec of deadlineCases) {
    it(`${spec.name}() passes the configured deadline`, async () => {
      const rpc = vi.fn().mockResolvedValue({});
      const cc = makeClient({ [spec.name]: rpc }, 2500);
      await spec.call(cc).catch(() => undefined);
      expect(rpc).toHaveBeenCalled();
      expectDeadline(rpc.mock.calls[0][2], 2500);
    });

    it(`${spec.name}() stays unbounded when timeout is omitted`, async () => {
      const rpc = vi.fn().mockResolvedValue({});
      const cc = makeClient({ [spec.name]: rpc });
      await spec.call(cc).catch(() => undefined);
      expect(rpc).toHaveBeenCalled();
      expectNoDeadline(rpc.mock.calls[0][2]);
    });
  }
});
