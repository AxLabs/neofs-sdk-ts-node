export { Decimal } from './decimal';
export * from './user';

// Re-export enums and helpers from core
export { MatchType, ChecksumType, ObjectType } from '@axlabs/neofs-sdk-ts-core';
export { toContainerId, decodeAttributes, isRetryableNeoFSError } from '@axlabs/neofs-sdk-ts-core';
export { payloadChecksums } from '@axlabs/neofs-sdk-ts-core';
export { createSigner } from '@axlabs/neofs-sdk-ts-core';
export { base58Decode, base58Encode } from '@axlabs/neofs-sdk-ts-core';

export interface ContainerID {
  value: Uint8Array;
}

export interface ObjectID {
  value: Uint8Array;
}

export interface Address {
  containerId: ContainerID;
  objectId: ObjectID;
}

export interface ObjectGetResult {
  objectId: ObjectID;
  header: any;
  signature: any;
  payload: Uint8Array;
}
