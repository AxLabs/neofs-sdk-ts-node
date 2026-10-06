import { beforeEach, describe, expect, it, vi } from 'vitest';

const accountingInstances: { config: unknown }[] = [];
const netmapInstances: { config: unknown }[] = [];
const containerInstances: { config: unknown }[] = [];
const objectInstances: { client: unknown; config: unknown }[] = [];

vi.mock('../../../src/client/accounting', () => ({
  AccountingClient: vi.fn(function AccountingClientMock(this: any, config: any) {
    accountingInstances.push({ config });
  }),
}));

vi.mock('../../../src/client/netmap', () => ({
  NetmapClient: vi.fn(function NetmapClientMock(this: any, config: any) {
    netmapInstances.push({ config });
  }),
}));

vi.mock('../../../src/client/container', () => ({
  ContainerClient: vi.fn(function ContainerClientMock(this: any, config: any) {
    containerInstances.push({ config });
  }),
}));

vi.mock('../../../src/client/object', () => ({
  ObjectClient: vi.fn(function ObjectClientMock(this: any, client: any, cfg: any) {
    objectInstances.push({ client, config: cfg });
  }),
}));

import { NeoFSClient } from '../../../src/client/client';
import { AccountingClient } from '../../../src/client/accounting';

describe('NeoFSClient', () => {
  beforeEach(() => {
    accountingInstances.length = 0;
    netmapInstances.length = 0;
    containerInstances.length = 0;
    objectInstances.length = 0;
    vi.clearAllMocks();
  });

  const signer = { sign: vi.fn(), public: vi.fn(), scheme: vi.fn() } as any;

  it('merges default timeout into config', () => {
    const c = new NeoFSClient({ endpoint: 'grpc://x', signer });
    expect(c.getConfig().timeout).toBe(30000);
    expect(c.getConfig().endpoint).toBe('grpc://x');
  });

  it('getConfig returns a shallow copy', () => {
    const c = new NeoFSClient({ endpoint: 'grpc://x', signer, timeout: 5 });
    const a = c.getConfig();
    const b = c.getConfig();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('object() returns stable wrapper between updates', () => {
    const c = new NeoFSClient({ endpoint: 'grpc://x', signer });
    const o1 = c.object();
    expect(o1).toBe(c.object());
    c.updateConfig({ endpoint: 'grpc://y' });
    expect(c.object()).not.toBe(o1);
  });

  it('constructs sub-clients with endpoint and signer', () => {
    const c = new NeoFSClient({ endpoint: 'grpc://node:8080', signer });
    expect(accountingInstances).toHaveLength(1);
    expect((accountingInstances[0].config as any).endpoint).toBe('grpc://node:8080');
    expect((accountingInstances[0].config as any).signer).toBe(signer);
    expect(objectInstances).toHaveLength(1);
    expect((objectInstances[0].config as any).endpoint).toBe('grpc://node:8080');
    expect((objectInstances[0].config as any).timeout).toBe(30000);
    expect(objectInstances[0].client).toBe(c);
  });

  it('updateConfig rebuilds sub-clients and merges', () => {
    const c = new NeoFSClient({ endpoint: 'grpc://a', signer, timeout: 100 });
    expect(AccountingClient).toHaveBeenCalledTimes(1);
    c.updateConfig({ endpoint: 'grpc://b', timeout: 200 });
    expect(c.getConfig().endpoint).toBe('grpc://b');
    expect(c.getConfig().timeout).toBe(200);
    expect(AccountingClient).toHaveBeenCalledTimes(2);
    const lastCall = vi.mocked(AccountingClient).mock.calls.at(-1)![0] as any;
    expect(lastCall.endpoint).toBe('grpc://b');
    expect(lastCall.timeout).toBe(200);
    expect((objectInstances.at(-1)!.config as any).timeout).toBe(200);
  });
});
