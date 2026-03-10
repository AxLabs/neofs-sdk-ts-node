/**
 * EACL Target - describes who the access rule applies to.
 */

import { Role } from './enums';

/**
 * Target describes the NeoFS parties that are subject to a specific access rule.
 */
export class Target {
  private _role: Role;
  private _subjects: Uint8Array[];

  constructor(role: Role = Role.UNSPECIFIED, subjects: Uint8Array[] = []) {
    this._role = role;
    this._subjects = subjects;
  }

  /** Target role */
  get role(): Role {
    return this._role;
  }

  /** 
   * Target subjects (user IDs or public keys).
   * - 25-byte values are user IDs
   * - 33-byte values are compressed public keys (deprecated, use user IDs)
   */
  get subjects(): Uint8Array[] {
    return this._subjects;
  }

  // ----------------------
  // Static Constructors
  // ----------------------

  /**
   * Target the container owner.
   */
  static user(): Target {
    return new Target(Role.USER);
  }

  /**
   * Target system nodes (storage and IR nodes).
   * @deprecated
   */
  static system(): Target {
    return new Target(Role.SYSTEM);
  }

  /**
   * Target anyone who isn't the owner or system.
   */
  static others(): Target {
    return new Target(Role.OTHERS);
  }

  /**
   * Target specific users by their IDs (25 bytes each).
   */
  static users(userIds: Uint8Array[]): Target {
    return new Target(Role.UNSPECIFIED, userIds);
  }

  /**
   * Target a single user by their ID.
   */
  static userId(userId: Uint8Array): Target {
    return new Target(Role.UNSPECIFIED, [userId]);
  }

  /**
   * Target specific users by their public keys (33 bytes compressed).
   * @deprecated Use user IDs instead
   */
  static publicKeys(keys: Uint8Array[]): Target {
    return new Target(Role.UNSPECIFIED, keys);
  }

  /**
   * Target a single user by their public key.
   * @deprecated Use user IDs instead
   */
  static publicKey(key: Uint8Array): Target {
    return new Target(Role.UNSPECIFIED, [key]);
  }

  /**
   * Clone this target.
   */
  clone(): Target {
    return new Target(
      this._role,
      this._subjects.map(s => new Uint8Array(s))
    );
  }
}
