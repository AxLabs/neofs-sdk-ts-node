import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/client/object-streaming', () => ({
  ObjectClient: vi.fn(function ObjectStreamingClientMock(this: any) {
    this.put = vi.fn();
    this.get = vi.fn();
    this.getRange = vi.fn();
    this.head = vi.fn();
    this.delete = vi.fn();
    this.search = vi.fn();
    this.searchV2 = vi.fn();
  }),
}));

import { ObjectClient } from '../../../src/client/object';
import { ObjectClient as StreamingObjectClient } from '../../../src/client/object-streaming';

function createWrapperClient() {
  const wrapper = new ObjectClient({} as any, { signer: {} as any, endpoint: 'grpc://unit.test' });
  const ctor = vi.mocked(StreamingObjectClient as any);
  const streaming = ctor.mock.results.at(-1)?.value as any;
  return { wrapper, streaming };
}

describe('ObjectClient delegations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates put()', async () => {
    const { wrapper, streaming } = createWrapperClient();
    const params = { header: { containerId: { value: new Uint8Array([1]) }, ownerId: new Uint8Array([2]) } };
    const result = { value: new Uint8Array([3]) };
    streaming.put.mockResolvedValue(result);

    await expect(wrapper.put(params as any)).resolves.toBe(result);
    expect(streaming.put).toHaveBeenCalledWith(params);
  });

  it('delegates get()', async () => {
    const { wrapper, streaming } = createWrapperClient();
    const params = { address: { containerId: { value: new Uint8Array([1]) }, objectId: { value: new Uint8Array([2]) } } };
    const result = { objectId: params.address.objectId, header: {}, signature: {}, payload: new Uint8Array([1]) };
    streaming.get.mockResolvedValue(result);

    await expect(wrapper.get(params as any)).resolves.toBe(result);
    expect(streaming.get).toHaveBeenCalledWith(params);
  });

  it('delegates getRange()', async () => {
    const { wrapper, streaming } = createWrapperClient();
    const params = {
      address: { containerId: { value: new Uint8Array([1]) }, objectId: { value: new Uint8Array([2]) } },
      range: { offset: 0n, length: 2n },
      raw: false,
    };
    const result = new Uint8Array([4, 5]);
    streaming.getRange.mockResolvedValue(result);

    await expect(wrapper.getRange(params as any)).resolves.toBe(result);
    expect(streaming.getRange).toHaveBeenCalledWith(params);
  });

  it('delegates head()', async () => {
    const { wrapper, streaming } = createWrapperClient();
    const params = { address: { containerId: { value: new Uint8Array([1]) }, objectId: { value: new Uint8Array([2]) } } };
    const result = { containerId: { value: new Uint8Array([1]) }, ownerId: new Uint8Array([9]) };
    streaming.head.mockResolvedValue(result);

    await expect(wrapper.head(params as any)).resolves.toBe(result);
    expect(streaming.head).toHaveBeenCalledWith(params);
  });

  it('delegates delete()', async () => {
    const { wrapper, streaming } = createWrapperClient();
    const params = { address: { containerId: { value: new Uint8Array([1]) }, objectId: { value: new Uint8Array([2]) } } };
    const result = params.address;
    streaming.delete.mockResolvedValue(result);

    await expect(wrapper.delete(params as any)).resolves.toBe(result);
    expect(streaming.delete).toHaveBeenCalledWith(params);
  });

  it('delegates search()', async () => {
    const { wrapper, streaming } = createWrapperClient();
    const params = { containerId: { value: new Uint8Array([1]) }, filters: [{ key: 'a', value: 'b', matchType: 1 }] };
    const result = [{ value: new Uint8Array([7]) }];
    streaming.search.mockResolvedValue(result);

    await expect(wrapper.search(params as any)).resolves.toBe(result);
    expect(streaming.search).toHaveBeenCalledWith(params);
  });

  it('delegates searchV2()', async () => {
    const { wrapper, streaming } = createWrapperClient();
    const params = { containerId: { value: new Uint8Array([1]) }, limit: 10 };
    const result = { result: [{ id: { value: new Uint8Array([8]) }, attributes: [] }], cursor: 'next' };
    streaming.searchV2.mockResolvedValue(result);

    await expect(wrapper.searchV2(params as any)).resolves.toBe(result);
    expect(streaming.searchV2).toHaveBeenCalledWith(params);
  });
});
