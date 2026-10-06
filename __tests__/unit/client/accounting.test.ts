import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Decimal } from '@axlabs/neofs-sdk-ts-core/types';
import { AccountingClient } from '../../../src/client/accounting';
import { AccountingServiceClient } from '../../../src/gen/accounting/service_grpc_pb';
import { expectDeadline, expectNoDeadline } from '../helpers/deadline';

vi.mock('@grpc/grpc-js', () => ({
  credentials: {
    createSsl: vi.fn(() => ({})),
    createInsecure: vi.fn(() => ({})),
  },
}));

vi.mock('@axlabs/neofs-sdk-ts-core/crypto', () => ({
  publicKeyBytes: vi.fn(() => new Uint8Array(33).fill(3)),
}));

vi.mock('../../../src/gen/accounting/service_grpc_pb', () => ({
  AccountingServiceClient: vi.fn(function AccountingServiceClientMock(this: any) {
    this.balance = vi.fn();
  }),
}));

describe('AccountingClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function clientWithGrpc(
    grpcClient: { balance: ReturnType<typeof vi.fn> },
    accountId?: Uint8Array,
    timeout?: number,
  ) {
    const ctor = vi.mocked(AccountingServiceClient as any);
    ctor.mockImplementation(function (this: any) {
      this.balance = grpcClient.balance;
    });
    const signer = {
      public: vi.fn(() => ({})),
      sign: vi.fn(() => new Uint8Array([9])),
      scheme: vi.fn(() => 1),
    };
    const ac = new AccountingClient({
      endpoint: 'grpc://acct.test:9090',
      signer: signer as any,
      ...(timeout !== undefined ? { timeout } : {}),
    });
    return { ac, signer, grpcClient };
  }

  it('getBalance returns Decimal from response body', async () => {
    const balanceFn = vi.fn().mockResolvedValue({
      MetaHeader: undefined,
      Body: { Balance: { Value: 1_000_000n, Precision: 8 } },
    });
    const { ac } = clientWithGrpc({ balance: balanceFn }, new Uint8Array(25));
    const d = await ac.getBalance({
      accountId: new Uint8Array(25),
    });
    expect(d).toBeInstanceOf(Decimal);
    expect(d.toNumber()).toBe(0.01);
    expect(balanceFn).toHaveBeenCalledTimes(1);
    const req = balanceFn.mock.calls[0][0];
    expect(req.Body.OwnerId.Value).toEqual(new Uint8Array(25));
  });

  it('getBalance returns zero Decimal when body has no balance', async () => {
    const { ac } = clientWithGrpc({
      balance: vi.fn().mockResolvedValue({ Body: {} }),
    });
    const d = await ac.getBalance({ accountId: new Uint8Array(25) });
    expect(d.toNumber()).toBe(0);
  });

  it('getBalance throws when status code is non-zero', async () => {
    const { ac } = clientWithGrpc({
      balance: vi.fn().mockResolvedValue({
        MetaHeader: { Status: { Code: 1, Message: 'denied' } },
        Body: {},
      }),
    });
    await expect(ac.getBalance({ accountId: new Uint8Array(25) })).rejects.toThrow(
      'Failed to get balance: NeoFS error: denied (code: 1)',
    );
  });

  it('getBalance wraps gRPC errors', async () => {
    const { ac } = clientWithGrpc({
      balance: vi.fn().mockRejectedValue(new Error('deadline')),
    });
    await expect(ac.getBalance({ accountId: new Uint8Array(25) })).rejects.toThrow(
      'Failed to get balance: deadline',
    );
  });

  it('getBalance passes the configured deadline', async () => {
    const balance = vi.fn().mockResolvedValue({ Body: {} });
    const { ac } = clientWithGrpc({ balance }, undefined, 2500);
    await ac.getBalance({ accountId: new Uint8Array(25) });
    expectDeadline(balance.mock.calls[0][2], 2500);
  });

  it('getBalance stays unbounded when timeout is omitted', async () => {
    const balance = vi.fn().mockResolvedValue({ Body: {} });
    const { ac } = clientWithGrpc({ balance });
    await ac.getBalance({ accountId: new Uint8Array(25) });
    expectNoDeadline(balance.mock.calls[0][2]);
  });

  it('getBalance still wraps gRPC errors when a deadline is set', async () => {
    const balance = vi.fn().mockRejectedValue(new Error('4 DEADLINE_EXCEEDED'));
    const { ac } = clientWithGrpc({ balance }, undefined, 2500);
    await expect(ac.getBalance({ accountId: new Uint8Array(25) })).rejects.toThrow(
      'Failed to get balance: 4 DEADLINE_EXCEEDED',
    );
    expectDeadline(balance.mock.calls[0][2], 2500);
  });
});
