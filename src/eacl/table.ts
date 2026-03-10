/**
 * EACL Table - Extended Access Control List for a container.
 */

import { NeoFsV2Acl } from '../gen/acl/types_pb';
import { NeoFsV2Refs } from '../gen/refs/types_pb';
import { Record } from './record';
import { Target } from './target';
import { Filter } from './filter';
import { Action, Operation, Role, Match, HeaderType } from './enums';

/**
 * Table represents an Extended ACL rules table for a single container.
 * 
 * @example
 * ```typescript
 * // Create an EACL that allows public read but only owner can write/delete
 * const eacl = new Table(containerId)
 *   .addRecord(Record.allowGet([Target.others()]))
 *   .addRecord(Record.allowHead([Target.others()]))
 *   .addRecord(Record.allowSearch([Target.others()]))
 *   .addRecord(Record.denyPut([Target.others()]))
 *   .addRecord(Record.denyDelete([Target.others()]));
 * 
 * // Serialize for API calls
 * const bytes = eacl.serialize();
 * ```
 */
export class Table {
  private _containerId?: Uint8Array;
  private _records: Record[];
  private _version: { major: number; minor: number };

  constructor(containerId?: Uint8Array) {
    this._containerId = containerId;
    this._records = [];
    this._version = { major: 2, minor: 18 };
  }

  /** Container ID this EACL applies to */
  get containerId(): Uint8Array | undefined {
    return this._containerId;
  }

  /** Set the container ID */
  setContainerId(id: Uint8Array): this {
    this._containerId = id;
    return this;
  }

  /** Access control records */
  get records(): Record[] {
    return this._records;
  }

  /** EACL format version */
  get version(): { major: number; minor: number } {
    return this._version;
  }

  /** Set EACL format version */
  setVersion(major: number, minor: number): this {
    this._version = { major, minor };
    return this;
  }

  // ----------------------
  // Fluent Builder API
  // ----------------------

  /**
   * Add a record to the table.
   */
  addRecord(record: Record): this {
    this._records.push(record);
    return this;
  }

  /**
   * Add multiple records to the table.
   */
  addRecords(records: Record[]): this {
    this._records.push(...records);
    return this;
  }

  /**
   * Add an ALLOW rule.
   */
  allow(operation: Operation, targets: Target[], filters?: Filter[]): this {
    return this.addRecord(Record.allow(operation, targets, filters));
  }

  /**
   * Add a DENY rule.
   */
  deny(operation: Operation, targets: Target[], filters?: Filter[]): this {
    return this.addRecord(Record.deny(operation, targets, filters));
  }

  /**
   * Allow all operations for the given targets.
   */
  allowAll(targets: Target[]): this {
    return this
      .allow(Operation.GET, targets)
      .allow(Operation.HEAD, targets)
      .allow(Operation.PUT, targets)
      .allow(Operation.DELETE, targets)
      .allow(Operation.SEARCH, targets)
      .allow(Operation.RANGE, targets)
      .allow(Operation.RANGE_HASH, targets);
  }

  /**
   * Deny all operations for the given targets.
   */
  denyAll(targets: Target[]): this {
    return this
      .deny(Operation.GET, targets)
      .deny(Operation.HEAD, targets)
      .deny(Operation.PUT, targets)
      .deny(Operation.DELETE, targets)
      .deny(Operation.SEARCH, targets)
      .deny(Operation.RANGE, targets)
      .deny(Operation.RANGE_HASH, targets);
  }

  /**
   * Allow read operations (GET, HEAD, SEARCH, RANGE, RANGE_HASH) for the given targets.
   */
  allowRead(targets: Target[]): this {
    return this
      .allow(Operation.GET, targets)
      .allow(Operation.HEAD, targets)
      .allow(Operation.SEARCH, targets)
      .allow(Operation.RANGE, targets)
      .allow(Operation.RANGE_HASH, targets);
  }

  /**
   * Deny read operations for the given targets.
   */
  denyRead(targets: Target[]): this {
    return this
      .deny(Operation.GET, targets)
      .deny(Operation.HEAD, targets)
      .deny(Operation.SEARCH, targets)
      .deny(Operation.RANGE, targets)
      .deny(Operation.RANGE_HASH, targets);
  }

  /**
   * Allow write operations (PUT, DELETE) for the given targets.
   */
  allowWrite(targets: Target[]): this {
    return this
      .allow(Operation.PUT, targets)
      .allow(Operation.DELETE, targets);
  }

  /**
   * Deny write operations for the given targets.
   */
  denyWrite(targets: Target[]): this {
    return this
      .deny(Operation.PUT, targets)
      .deny(Operation.DELETE, targets);
  }

  // ----------------------
  // Serialization
  // ----------------------

  /**
   * Convert to protobuf message.
   */
  toProto(): NeoFsV2Acl.EACLTableImpl {
    const records = this._records.map(r => {
      const targets = r.targets.map(t => {
        return new NeoFsV2Acl.EACLRecord_TargetImpl({
          Role: t.role as number as NeoFsV2Acl.Role,
          Keys: t.subjects,
        });
      });

      const filters = r.filters.map(f => {
        return new NeoFsV2Acl.EACLRecord_FilterImpl({
          HeaderType: f.headerType as number as NeoFsV2Acl.HeaderType,
          MatchType: f.match as number as NeoFsV2Acl.MatchType,
          Key: f.key,
          Value: f.value,
        });
      });

      return new NeoFsV2Acl.EACLRecordImpl({
        Operation: r.operation as number as NeoFsV2Acl.Operation,
        Action: r.action as number as NeoFsV2Acl.Action,
        Targets: targets,
        Filters: filters,
      });
    });

    return new NeoFsV2Acl.EACLTableImpl({
      Version: new NeoFsV2Refs.VersionImpl({
        Major: this._version.major,
        Minor: this._version.minor,
      }),
      ContainerId: this._containerId 
        ? new NeoFsV2Refs.ContainerIDImpl({ Value: this._containerId })
        : undefined,
      Records: records,
    });
  }

  /**
   * Serialize to binary format.
   */
  serialize(): Uint8Array {
    return this.toProto().serializeBinary();
  }

  /**
   * Create Table from protobuf message.
   */
  static fromProto(proto: NeoFsV2Acl.EACLTable): Table {
    const table = new Table(proto.ContainerId?.Value);
    
    if (proto.Version) {
      table.setVersion(proto.Version.Major, proto.Version.Minor);
    }

    for (const r of proto.Records || []) {
      const targets = (r.Targets || []).map(t => {
        return new Target(t.Role as number as Role, t.Keys || []);
      });

      const filters = (r.Filters || []).map(f => {
        return new Filter(
          f.HeaderType as number as HeaderType,
          f.Key,
          f.MatchType as number as Match,
          f.Value
        );
      });

      table.addRecord(new Record(
        r.Action as number as Action,
        r.Operation as number as Operation,
        targets,
        filters
      ));
    }

    return table;
  }

  /**
   * Deserialize from binary format.
   */
  static deserialize(data: Uint8Array): Table {
    const proto = NeoFsV2Acl.EACLTableImpl.deserializeBinary(data);
    return Table.fromProto(proto);
  }

  /**
   * Clone this table.
   */
  clone(): Table {
    const table = new Table(
      this._containerId ? new Uint8Array(this._containerId) : undefined
    );
    table.setVersion(this._version.major, this._version.minor);
    table._records = this._records.map(r => r.clone());
    return table;
  }
}

// ----------------------
// Common EACL Presets
// ----------------------

/**
 * Create a public-read EACL (anyone can read, only owner can write).
 */
export function publicReadEACL(containerId?: Uint8Array): Table {
  return new Table(containerId)
    .allowRead([Target.others()])
    .denyWrite([Target.others()]);
}

/**
 * Create a private EACL (only owner can access).
 */
export function privateEACL(containerId?: Uint8Array): Table {
  return new Table(containerId)
    .denyAll([Target.others()]);
}

/**
 * Create a public EACL (anyone can read and write).
 */
export function publicEACL(containerId?: Uint8Array): Table {
  return new Table(containerId)
    .allowAll([Target.others()]);
}

/**
 * Create an EACL that allows specific users to access.
 */
export function allowUsersEACL(
  userIds: Uint8Array[],
  containerId?: Uint8Array
): Table {
  const target = Target.users(userIds);
  return new Table(containerId)
    .allowAll([target])
    .denyAll([Target.others()]);
}
