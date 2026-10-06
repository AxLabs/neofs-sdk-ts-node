import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConfirmationTimeoutError,
  DEFAULT_POLL_INTERVAL,
  Waiter,
} from '../../../src/waiter/waiter';

describe('Waiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const cid = { value: new Uint8Array([1, 2, 3]) };

  it('DEFAULT_POLL_INTERVAL is 1000ms', () => {
    expect(DEFAULT_POLL_INTERVAL).toBe(1000);
  });

  it('ConfirmationTimeoutError has stable name', () => {
    const e = new ConfirmationTimeoutError('x');
    expect(e.name).toBe('ConfirmationTimeoutError');
    expect(e.message).toContain('x');
  });

  it('containerPut waits until get succeeds after not-found', async () => {
    const put = vi.fn().mockResolvedValue(cid);
    const get = vi
      .fn()
      .mockRejectedValueOnce(new Error('NeoFS error: not found (code: 3072)'))
      .mockResolvedValueOnce({ version: { major: 2, minor: 0 } });

    const neo = {
      container: () => ({ put, get }),
    } as any;

    const waiter = new Waiter(neo, { pollInterval: 50, timeout: 10_000 });
    const p = waiter.containerPut({ container: {} as any }, { initialDelay: 100, pollInterval: 50 });

    await vi.runAllTimersAsync();
    await expect(p).resolves.toEqual(cid);

    expect(put).toHaveBeenCalled();
    expect(get.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('containerPut throws ConfirmationTimeoutError when get never succeeds', async () => {
    const put = vi.fn().mockResolvedValue(cid);
    const get = vi.fn().mockRejectedValue(new Error('code: 3072'));

    const neo = {
      container: () => ({ put, get }),
    } as any;

    const waiter = new Waiter(neo, { pollInterval: 100, timeout: 500, initialDelay: 0 });
    const p = waiter.containerPut({ container: {} as any }, { initialDelay: 0, pollInterval: 100, timeout: 500 });

    const rejection = expect(p).rejects.toThrow(ConfirmationTimeoutError);
    await vi.runAllTimersAsync();
    await rejection;
  });

  it('containerDelete succeeds when get eventually returns not found', async () => {
    const del = vi.fn().mockResolvedValue(undefined);
    const get = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('NOT_FOUND'));

    const neo = {
      container: () => ({ delete: del, get }),
    } as any;

    const waiter = new Waiter(neo, { pollInterval: 50, timeout: 5000 });
    const p = waiter.containerDelete(cid);

    await vi.runAllTimersAsync();
    await p;

    expect(del).toHaveBeenCalled();
  });

  it('objectPut polls head until success', async () => {
    const put = vi.fn().mockResolvedValue({ value: new Uint8Array([9]) });
    const head = vi
      .fn()
      .mockRejectedValueOnce(new Error('code: 2049'))
      .mockResolvedValueOnce({ containerId: cid, ownerId: new Uint8Array(25) });

    const header = { containerId: cid, ownerId: new Uint8Array(25) };
    const neo = {
      object: () => ({ put, head }),
    } as any;

    const waiter = new Waiter(neo, { pollInterval: 40, timeout: 8000 });
    const p = waiter.objectPut({ header, payload: new Uint8Array([1]) } as any);

    await vi.runAllTimersAsync();
    await p;

    expect(put).toHaveBeenCalled();
    expect(head.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('objectPut forwards bearerToken to object put', async () => {
    const put = vi.fn().mockResolvedValue({ value: new Uint8Array([9]) });
    const head = vi.fn().mockResolvedValue({ containerId: cid, ownerId: new Uint8Array(25) });
    const bearerToken = { toProto: () => ({}) };
    const params = { header: { containerId: cid, ownerId: new Uint8Array(25) }, payload: new Uint8Array([1]), bearerToken };

    const waiter = new Waiter({ object: () => ({ put, head }) } as any, { pollInterval: 40, timeout: 8000 });
    const pending = waiter.objectPut(params as any);
    await vi.runAllTimersAsync();
    await pending;

    expect(put).toHaveBeenCalledWith(params);
  });

  it('setPollInterval and setTimeout change defaults', () => {
    const neo = { container: () => ({ put: vi.fn(), get: vi.fn() }) } as any;
    const w = new Waiter(neo);
    w.setPollInterval(333);
    w.setTimeout(444);
    expect((w as any).defaultPollInterval).toBe(333);
    expect((w as any).defaultTimeout).toBe(444);
  });
});
