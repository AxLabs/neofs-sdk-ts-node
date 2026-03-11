import { NeoFSClient } from '../client';
import { Signer, PublicKey } from '@axlabs/neofs-sdk-ts-core/crypto';
import { ContainerID, ObjectID, Address, ObjectGetResult } from '../types';
import { ObjectClient as StreamingObjectClient } from './object-streaming';

export interface ObjectHeader {
  containerId: ContainerID;
  ownerId: Uint8Array;
  objectType?: number;
  payloadLength?: number;
  payloadHash?: {
    type: number;
    sum: Uint8Array;
  };
  homomorphicHash?: {
    type: number;
    sum: Uint8Array;
  };
  attributes?: Array<{
    key: string;
    value: string;
  }>;
  signature?: {
    key: Uint8Array;
    sign: Uint8Array;
    scheme?: number;
  };
  version?: {
    major: number;
    minor: number;
  };
}

export interface ObjectPutParams {
  header: ObjectHeader;
  payload?: Uint8Array;
  copiesNumber?: number;
}

export interface ObjectGetParams {
  address: Address;
  raw?: boolean;
}

export interface ObjectHeadParams {
  address: Address;
  raw?: boolean;
}

export interface ObjectDeleteParams {
  address: Address;
}

export interface ObjectSearchParams {
  containerId: ContainerID;
  filters?: Array<{
    key: string;
    value: string;
    matchType: number;
  }>;
  limit?: number;
  offset?: number;
}

export interface ObjectSearchV2Params {
  containerId: ContainerID;
  filters?: Array<{
    key: string;
    value: string;
    matchType: number;
  }>;
  limit?: number;
  cursor?: string;
}

export interface ObjectSearchResult {
  id: ObjectID;
  attributes: Array<{
    key: string;
    value: string;
  }>;
}

export interface ObjectSearchV2Result {
  result: ObjectSearchResult[];
  cursor: string;
}

export class ObjectClient {
  private streamingClient: StreamingObjectClient;

  constructor(client: NeoFSClient, config: { signer: Signer; endpoint: string }) {
    this.streamingClient = new StreamingObjectClient(client, config);
  }

  // Delegate all methods to the streaming client
  async put(params: ObjectPutParams): Promise<ObjectID> {
    return this.streamingClient.put(params);
  }

  async get(params: ObjectGetParams): Promise<ObjectGetResult> {
    return this.streamingClient.get(params);
  }

  async head(params: ObjectHeadParams): Promise<ObjectHeader> {
    return this.streamingClient.head(params);
  }

  async delete(params: ObjectDeleteParams): Promise<Address> {
    return this.streamingClient.delete(params);
  }

  async search(params: ObjectSearchParams): Promise<ObjectID[]> {
    return this.streamingClient.search(params);
  }

  async searchV2(params: ObjectSearchV2Params): Promise<ObjectSearchV2Result> {
    return this.streamingClient.searchV2(params);
  }
}