/**
 * EACL Filter - matches resources based on attributes.
 */

import { Match, HeaderType, ObjectFilters } from './enums';

/**
 * Filter describes a binary property of an access-controlled NeoFS resource.
 */
export class Filter {
  private _headerType: HeaderType;
  private _match: Match;
  private _key: string;
  private _value: string;

  constructor(
    headerType: HeaderType,
    key: string,
    match: Match,
    value: string
  ) {
    this._headerType = headerType;
    this._key = key;
    this._match = match;
    this._value = value;
  }

  /** Header type to filter on */
  get headerType(): HeaderType {
    return this._headerType;
  }

  /** Attribute key to match */
  get key(): string {
    return this._key;
  }

  /** Match operator */
  get match(): Match {
    return this._match;
  }

  /** Value to match against */
  get value(): string {
    return this._value;
  }

  // ----------------------
  // Static Constructors
  // ----------------------

  /**
   * Create a filter for object attributes.
   */
  static objectAttribute(key: string, match: Match, value: string): Filter {
    return new Filter(HeaderType.OBJECT, key, match, value);
  }

  /**
   * Create a filter for request X-headers.
   */
  static requestHeader(key: string, match: Match, value: string): Filter {
    return new Filter(HeaderType.REQUEST, key, match, value);
  }

  /**
   * Create a filter for service headers.
   */
  static serviceHeader(key: string, match: Match, value: string): Filter {
    return new Filter(HeaderType.SERVICE, key, match, value);
  }

  /**
   * Filter by object ID.
   */
  static objectId(objectId: string): Filter {
    return Filter.objectAttribute(ObjectFilters.OBJECT_ID, Match.STRING_EQUAL, objectId);
  }

  /**
   * Filter by container ID.
   */
  static containerId(containerId: string): Filter {
    return Filter.objectAttribute(ObjectFilters.CONTAINER_ID, Match.STRING_EQUAL, containerId);
  }

  /**
   * Filter by owner ID.
   */
  static ownerId(ownerId: string): Filter {
    return Filter.objectAttribute(ObjectFilters.OWNER_ID, Match.STRING_EQUAL, ownerId);
  }

  /**
   * Filter by creation epoch.
   */
  static creationEpoch(match: Match, epoch: bigint): Filter {
    return Filter.objectAttribute(ObjectFilters.CREATION_EPOCH, match, epoch.toString());
  }

  /**
   * Filter by payload size.
   */
  static payloadSize(match: Match, size: bigint): Filter {
    return Filter.objectAttribute(ObjectFilters.PAYLOAD_SIZE, match, size.toString());
  }

  /**
   * Clone this filter.
   */
  clone(): Filter {
    return new Filter(this._headerType, this._key, this._match, this._value);
  }
}
