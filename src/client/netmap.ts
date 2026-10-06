import { ClientConfig } from './client';
import { signRequest } from './request-signing';
import { grpcCallOptions } from './grpc-call';

// Import proto definitions - using our generated classes
import { NetmapServiceClient } from '../gen/netmap/service_grpc_pb';
import { 
  LocalNodeInfoRequest, 
  LocalNodeInfoRequest_Body,
  LocalNodeInfoResponse,
  NetworkInfoRequest,
  NetworkInfoRequest_Body,
  NetworkInfoResponse,
  NetmapSnapshotRequest,
  NetmapSnapshotRequest_Body,
  NetmapSnapshotResponse
} from '../gen/netmap/service_pb';
import { NeoFsV2Refs } from '../gen/refs/types_pb';
import { NeoFsV2Session } from '../gen/session/types_pb';
import { NeoFsV2Netmap } from '../gen/netmap/types_pb';
import * as grpc from '@grpc/grpc-js';

/**
 * Node state enumeration
 */
export enum NodeState {
  UNSPECIFIED = 0,
  ONLINE = 1,
  OFFLINE = 2,
  MAINTENANCE = 3,
}

/**
 * Node attribute structure
 */
export interface NodeAttribute {
  key: string;
  value: string;
  parents: string[];
}

/**
 * Node information structure
 */
export interface NodeInfo {
  publicKey: Uint8Array;
  addresses: string[];
  attributes: NodeAttribute[];
  state: NodeState;
}

/**
 * Network configuration parameter
 */
export interface NetworkConfigParameter {
  key: Uint8Array;
  value: Uint8Array;
}

/**
 * Network configuration structure
 */
export interface NetworkConfig {
  parameters: NetworkConfigParameter[];
}

/**
 * Network information structure
 */
export interface NetworkInfo {
  currentEpoch: number;
  magicNumber: number;
  msPerBlock: number;
  networkConfig: NetworkConfig;
  /** Network map version (API v2.27+). 0 when the node did not report one. */
  netmapVersion: number;
}

/**
 * Network map structure
 */
export interface Netmap {
  /** @deprecated Network maps are versioned since API v2.27. */
  epoch: number;
  nodes: NodeInfo[];
  /** Network map version (API v2.27+). 0 when the node did not report one. */
  version: number;
}

/**
 * Local node info response structure
 */
export interface LocalNodeInfo {
  version: {
    major: number;
    minor: number;
  };
  nodeInfo: NodeInfo;
}

/**
 * Client for interacting with NeoFS Netmap service.
 */
export class NetmapClient {
  private config: ClientConfig;
  private client: NetmapServiceClient;

  constructor(config: ClientConfig) {
    this.config = config;
    // Create Node.js gRPC client using our generated service client
    const credentials = config.endpoint.startsWith('grpcs://')
      ? grpc.credentials.createSsl()
      : grpc.credentials.createInsecure();

    this.client = new NetmapServiceClient(
      config.endpoint.replace(/^grpcs?:\/\//, ''),
      credentials
    );
  }

  /**
   * Get information about the local node (the one you're connected to).
   * This is useful for health checks and API version discovery.
   */
  async localNodeInfo(): Promise<LocalNodeInfo> {
    try {
      // Create the request using our generated classes
      const request = new LocalNodeInfoRequest();
      
      // Create the request body (empty for LocalNodeInfo)
      const requestBody = new LocalNodeInfoRequest_Body();
      request.Body = requestBody;

      // Create the meta header
      const metaHeader = new NeoFsV2Session.RequestMetaHeader();
      const version = new NeoFsV2Refs.Version();
      version.Major = 2;
      version.Minor = 27;
      metaHeader.Version = version;
      metaHeader.Ttl = 2;
      request.MetaHeader = metaHeader;

      signRequest(request, this.config.signer);

      // Make the gRPC call using our generated service client
      const response = await this.client.localNodeInfo(
        request,
        undefined,
        grpcCallOptions(this.config.timeout),
      );

      // Check if we got a successful response
      if (response.MetaHeader && response.MetaHeader.Status) {
        const status = response.MetaHeader.Status;
        if (status.Code !== 0) {
          throw new Error(`NeoFS error: ${status.Message} (code: ${status.Code})`);
        }
      }

      // Parse the response
      const body = response.Body;
      if (!body) {
        throw new Error('No response body received');
      }

      const versionInfo = body.Version;
      const nodeInfo = body.NodeInfo;

      if (!versionInfo || !nodeInfo) {
        throw new Error('Missing version or node info in response');
      }

      // Convert attributes
      const attributes: NodeAttribute[] = [];
      const protoAttributes = nodeInfo.Attributes || [];
      for (const attr of protoAttributes) {
        attributes.push({
          key: attr.Key,
          value: attr.Value,
          parents: attr.Parents || [],
        });
      }

      return {
        version: {
          major: versionInfo.Major,
          minor: versionInfo.Minor,
        },
        nodeInfo: {
          publicKey: new Uint8Array(nodeInfo.PublicKey),
          addresses: nodeInfo.Addresses || [],
          attributes,
          state: nodeInfo.State as unknown as NodeState,
        },
      };
    } catch (error: any) {
      throw new Error(`Failed to get local node info: ${error.message}`);
    }
  }

  /**
   * Get information about the NeoFS network.
   * Returns current epoch, magic number, and network configuration.
   */
  async networkInfo(): Promise<NetworkInfo> {
    try {
      // Create the request using our generated classes
      const request = new NetworkInfoRequest();
      
      // Create the request body (empty for NetworkInfo)
      const requestBody = new NetworkInfoRequest_Body();
      request.Body = requestBody;

      // Create the meta header
      const metaHeader = new NeoFsV2Session.RequestMetaHeader();
      const version = new NeoFsV2Refs.Version();
      version.Major = 2;
      version.Minor = 27;
      metaHeader.Version = version;
      metaHeader.Ttl = 2;
      request.MetaHeader = metaHeader;

      signRequest(request, this.config.signer);

      // Make the gRPC call using our generated service client
      const response = await this.client.networkInfo(
        request,
        undefined,
        grpcCallOptions(this.config.timeout),
      );

      // Check response status
      if (response.MetaHeader && response.MetaHeader.Status) {
        const status = response.MetaHeader.Status;
        if (status.Code !== 0) {
          throw new Error(`NeoFS error: ${status.Message} (code: ${status.Code})`);
        }
      }

      // Parse the response
      const body = response.Body;
      if (!body) {
        throw new Error('No response body received');
      }

      const networkInfo = body.NetworkInfo;
      if (!networkInfo) {
        throw new Error('Missing network info in response');
      }

      // Convert network config parameters
      const parameters: NetworkConfigParameter[] = [];
      const protoParameters = networkInfo.NetworkConfig?.Parameters || [];
      for (const param of protoParameters) {
        parameters.push({
          key: new Uint8Array(param.Key),
          value: new Uint8Array(param.Value),
        });
      }

      return {
        currentEpoch: Number(networkInfo.CurrentEpoch),
        magicNumber: Number(networkInfo.MagicNumber),
        msPerBlock: Number(networkInfo.MsPerBlock),
        networkConfig: {
          parameters,
        },
        netmapVersion: Number(networkInfo.NetmapVersion ?? 0n),
      };
    } catch (error: any) {
      throw new Error(`Failed to get network info: ${error.message}`);
    }
  }

  /**
   * Get the current network map snapshot.
   * Returns the complete list of nodes in the network with their attributes.
   */
  async netmapSnapshot(): Promise<Netmap> {
    try {
      // Create the request using our generated classes
      const request = new NetmapSnapshotRequest();
      
      // Create the request body (empty for NetmapSnapshot)
      const requestBody = new NetmapSnapshotRequest_Body();
      request.Body = requestBody;

      // Create the meta header
      const metaHeader = new NeoFsV2Session.RequestMetaHeader();
      const version = new NeoFsV2Refs.Version();
      version.Major = 2;
      version.Minor = 27;
      metaHeader.Version = version;
      metaHeader.Ttl = 2;
      request.MetaHeader = metaHeader;

      signRequest(request, this.config.signer);

      // Make the gRPC call using our generated service client
      const response = await this.client.netmapSnapshot(
        request,
        undefined,
        grpcCallOptions(this.config.timeout),
      );

      // Check response status
      if (response.MetaHeader && response.MetaHeader.Status) {
        const status = response.MetaHeader.Status;
        if (status.Code !== 0) {
          throw new Error(`NeoFS error: ${status.Message} (code: ${status.Code})`);
        }
      }

      // Parse the response
      const body = response.Body;
      if (!body) {
        throw new Error('No response body received');
      }

      const netmap = body.Netmap;
      if (!netmap) {
        throw new Error('Missing netmap in response');
      }

      // Convert nodes
      const nodes: NodeInfo[] = [];
      const protoNodes = netmap.Nodes || [];
      for (const node of protoNodes) {
        const attributes: NodeAttribute[] = [];
        const protoAttributes = node.Attributes || [];
        for (const attr of protoAttributes) {
          attributes.push({
            key: attr.Key,
            value: attr.Value,
            parents: attr.Parents || [],
          });
        }

        nodes.push({
          publicKey: new Uint8Array(node.PublicKey),
          addresses: node.Addresses || [],
          attributes,
          state: node.State as unknown as NodeState,
        });
      }

      return {
        epoch: Number(netmap.Epoch),
        nodes,
        version: Number(netmap.Version ?? 0n),
      };
    } catch (error: any) {
      throw new Error(`Failed to get netmap snapshot: ${error.message}`);
    }
  }

  close(): void {
    this.client.close();
  }
}
