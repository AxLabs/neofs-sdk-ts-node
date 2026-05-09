import { describe, expect, it } from 'vitest';
import { UserID } from '../../../src/types/user';

describe('types/UserID', () => {
  it('fromProtoMessage and toProtoMessage roundtrip shape', () => {
    const u = UserID.fromProtoMessage({ getValue: () => new Uint8Array([1, 2, 3]) });
    const proto = u.toProtoMessage();
    expect(proto.value).toEqual([1, 2, 3]);
  });

  it('fromHex and toHex', () => {
    const u = UserID.fromHex('0a0b');
    expect(u.toHex()).toBe('0a0b');
  });

  it('equals and isZero', () => {
    expect(new UserID(new Uint8Array([0])).isZero()).toBe(true);
    const a = new UserID(new Uint8Array([1]));
    const b = new UserID(new Uint8Array([1]));
    expect(a.equals(b)).toBe(true);
    expect(a.equals(new UserID(new Uint8Array([2])))).toBe(false);
  });

  it('getValue returns a copy', () => {
    const u = new UserID(new Uint8Array([9]));
    const v = u.getValue();
    v[0] = 0;
    expect(u.getValue()).toEqual(new Uint8Array([9]));
  });

  it('toBase58 / fromBase58 throw as documented', () => {
    expect(() => new UserID(new Uint8Array([1])).toBase58()).toThrow('not implemented');
    expect(() => UserID.fromBase58('x')).toThrow('not implemented');
  });
});
