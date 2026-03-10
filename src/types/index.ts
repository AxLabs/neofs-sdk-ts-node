export { Decimal } from './decimal';
export * from './user';

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
  header: any; // Object header
  signature: any; // Object signature
  payload: Uint8Array;
}
