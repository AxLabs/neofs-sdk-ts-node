/**
 * Decimal represents a decimal number with arbitrary precision.
 * Used for monetary computations in NeoFS to avoid floating point precision issues.
 */
export class Decimal {
  private value: bigint;
  private precision: number;

  constructor(value: bigint | number | string, precision: number) {
    this.value = BigInt(value);
    this.precision = precision;
  }

  /**
   * Creates a Decimal from a protobuf message.
   */
  static fromProtoMessage(proto: any): Decimal {
    return new Decimal(proto.getValue(), proto.getPrecision());
  }

  /**
   * Converts to protobuf message.
   */
  toProtoMessage(): any {
    return {
      value: this.value.toString(),
      precision: this.precision,
    };
  }

  /**
   * Gets the raw value as a bigint.
   */
  getValue(): bigint {
    return this.value;
  }

  /**
   * Gets the precision (number of decimal places).
   */
  getPrecision(): number {
    return this.precision;
  }

  /**
   * Converts to a JavaScript number (may lose precision).
   */
  toNumber(): number {
    return Number(this.value) / Math.pow(10, this.precision);
  }

  /**
   * Converts to a string representation.
   */
  toString(): string {
    const str = this.value.toString();
    if (this.precision === 0) {
      return str;
    }
    
    if (str.length <= this.precision) {
      return '0.' + str.padStart(this.precision, '0');
    }
    
    const integerPart = str.slice(0, -this.precision);
    const decimalPart = str.slice(-this.precision);
    return integerPart + '.' + decimalPart;
  }

  /**
   * Adds another Decimal to this one.
   */
  add(other: Decimal): Decimal {
    if (this.precision !== other.precision) {
      throw new Error('Cannot add decimals with different precision');
    }
    return new Decimal(this.value + other.value, this.precision);
  }

  /**
   * Subtracts another Decimal from this one.
   */
  subtract(other: Decimal): Decimal {
    if (this.precision !== other.precision) {
      throw new Error('Cannot subtract decimals with different precision');
    }
    return new Decimal(this.value - other.value, this.precision);
  }

  /**
   * Multiplies this Decimal by another.
   */
  multiply(other: Decimal): Decimal {
    const resultValue = this.value * other.value;
    const resultPrecision = this.precision + other.precision;
    return new Decimal(resultValue, resultPrecision);
  }

  /**
   * Divides this Decimal by another.
   */
  divide(other: Decimal): Decimal {
    if (other.value === 0n) {
      throw new Error('Division by zero');
    }
    
    // Scale up to maintain precision
    const scale = BigInt(10 ** this.precision);
    const resultValue = (this.value * scale) / other.value;
    return new Decimal(resultValue, this.precision);
  }

  /**
   * Compares this Decimal with another.
   * @returns -1 if this < other, 0 if equal, 1 if this > other
   */
  compare(other: Decimal): number {
    if (this.precision !== other.precision) {
      throw new Error('Cannot compare decimals with different precision');
    }
    
    if (this.value < other.value) return -1;
    if (this.value > other.value) return 1;
    return 0;
  }

  /**
   * Checks if this Decimal equals another.
   */
  equals(other: Decimal): boolean {
    return this.compare(other) === 0;
  }

  /**
   * Checks if this Decimal is zero.
   */
  isZero(): boolean {
    return this.value === 0n;
  }

  /**
   * Checks if this Decimal is positive.
   */
  isPositive(): boolean {
    return this.value > 0n;
  }

  /**
   * Checks if this Decimal is negative.
   */
  isNegative(): boolean {
    return this.value < 0n;
  }
}
