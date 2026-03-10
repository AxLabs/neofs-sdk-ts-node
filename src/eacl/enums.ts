/**
 * EACL (Extended Access Control List) enums.
 */

/**
 * Action to take when a rule matches.
 */
export enum Action {
  /** Unspecified action */
  UNSPECIFIED = 0,
  /** Allow the operation */
  ALLOW = 1,
  /** Deny the operation */
  DENY = 2,
}

/**
 * Operation type for access control.
 */
export enum Operation {
  /** Unspecified operation */
  UNSPECIFIED = 0,
  /** ObjectService.Get RPC */
  GET = 1,
  /** ObjectService.Head RPC */
  HEAD = 2,
  /** ObjectService.Put RPC */
  PUT = 3,
  /** ObjectService.Delete RPC */
  DELETE = 4,
  /** ObjectService.Search RPC */
  SEARCH = 5,
  /** ObjectService.GetRange RPC */
  RANGE = 6,
  /** ObjectService.GetRangeHash RPC */
  RANGE_HASH = 7,
}

/**
 * Role of the subject requesting access.
 */
export enum Role {
  /** Unspecified role */
  UNSPECIFIED = 0,
  /** Container owner */
  USER = 1,
  /** Storage/IR nodes (deprecated) */
  SYSTEM = 2,
  /** Anyone else */
  OTHERS = 3,
}

/**
 * Match type for filters.
 */
export enum Match {
  /** Unspecified match type */
  UNSPECIFIED = 0,
  /** String equality */
  STRING_EQUAL = 1,
  /** String inequality */
  STRING_NOT_EQUAL = 2,
  /** Attribute is not present */
  NOT_PRESENT = 3,
  /** Numeric greater than */
  NUM_GT = 4,
  /** Numeric greater or equal */
  NUM_GE = 5,
  /** Numeric less than */
  NUM_LT = 6,
  /** Numeric less or equal */
  NUM_LE = 7,
}

/**
 * Type of header to filter on.
 */
export enum HeaderType {
  /** Unspecified header type */
  UNSPECIFIED = 0,
  /** Request X-Header */
  REQUEST = 1,
  /** Object attribute */
  OBJECT = 2,
  /** Custom service header */
  SERVICE = 3,
}

/**
 * Well-known object filter keys.
 */
export const ObjectFilters = {
  /** Object version */
  VERSION: '$Object:version',
  /** Object ID */
  OBJECT_ID: '$Object:objectID',
  /** Container ID */
  CONTAINER_ID: '$Object:containerID',
  /** Owner ID */
  OWNER_ID: '$Object:ownerID',
  /** Creation epoch */
  CREATION_EPOCH: '$Object:creationEpoch',
  /** Payload size */
  PAYLOAD_SIZE: '$Object:payloadLength',
  /** Payload hash */
  PAYLOAD_HASH: '$Object:payloadHash',
  /** Object type */
  OBJECT_TYPE: '$Object:objectType',
  /** Homomorphic hash */
  HOMOMORPHIC_HASH: '$Object:homomorphicHash',
} as const;
