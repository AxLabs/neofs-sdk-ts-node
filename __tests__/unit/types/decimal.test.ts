import { describe, expect, it } from 'vitest';
import { Decimal } from '../../../src/types/decimal';

describe('types/Decimal', () => {
  it('fromProtoMessage maps fields', () => {
    const d = Decimal.fromProtoMessage({
      getValue: () => 1500n,
      getPrecision: () => 2,
    });
    expect(d.getValue()).toBe(1500n);
    expect(d.getPrecision()).toBe(2);
    expect(d.toString()).toBe('15.00');
  });

  it('toProtoMessage', () => {
    const d = new Decimal(42n, 1);
    expect(d.toProtoMessage()).toEqual({ value: '42', precision: 1 });
  });

  it('arithmetic and compare', () => {
    const a = new Decimal(100n, 2);
    const b = new Decimal(25n, 2);
    expect(a.add(b).toString()).toBe('1.25');
    expect(a.subtract(b).toString()).toBe('0.75');
    expect(a.multiply(b).getPrecision()).toBe(4);
    expect(a.divide(b).toNumber()).toBe(4);
    expect(a.compare(b)).toBe(1);
    expect(a.equals(new Decimal(100n, 2))).toBe(true);
    expect(a.isZero()).toBe(false);
    expect(a.isPositive()).toBe(true);
  });

  it('rejects mismatched precision for add', () => {
    expect(() => new Decimal(1n, 2).add(new Decimal(1n, 3))).toThrow(
      'Cannot add decimals with different precision',
    );
  });

  it('divide by zero', () => {
    expect(() => new Decimal(1n, 2).divide(new Decimal(0n, 2))).toThrow('Division by zero');
  });
});
