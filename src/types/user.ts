/**
 * User ID represents a NeoFS user identifier.
 */
export class UserID {
  private value: Uint8Array;

  constructor(value: Uint8Array) {
    this.value = new Uint8Array(value);
  }

  /**
   * Creates a UserID from a protobuf message.
   */
  static fromProtoMessage(proto: any): UserID {
    return new UserID(new Uint8Array(proto.getValue()));
  }

  /**
   * Converts to protobuf message.
   */
  toProtoMessage(): any {
    return {
      value: Array.from(this.value),
    };
  }

  /**
   * Gets the raw value as bytes.
   */
  getValue(): Uint8Array {
    return new Uint8Array(this.value);
  }

  /**
   * Checks if this UserID is zero (empty).
   */
  isZero(): boolean {
    return this.value.length === 0 || this.value.every(byte => byte === 0);
  }

  /**
   * Converts to a hex string.
   */
  toHex(): string {
    return Array.from(this.value)
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Creates a UserID from a hex string.
   */
  static fromHex(hex: string): UserID {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return new UserID(bytes);
  }

  /**
   * Converts to a base58 string.
   */
  toBase58(): string {
    // This would need a base58 implementation
    throw new Error('Base58 encoding not implemented');
  }

  /**
   * Creates a UserID from a base58 string.
   */
  static fromBase58(base58: string): UserID {
    // This would need a base58 implementation
    throw new Error('Base58 decoding not implemented');
  }

  /**
   * Checks if this UserID equals another.
   */
  equals(other: UserID): boolean {
    if (this.value.length !== other.value.length) {
      return false;
    }
    return this.value.every((byte, index) => byte === other.value[index]);
  }

  /**
   * Converts to a string representation.
   */
  toString(): string {
    return this.toHex();
  }
}
