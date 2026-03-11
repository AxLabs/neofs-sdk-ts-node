import { ClientConfig } from './client';
import { Signer, NeoFSSignature, publicKeyBytes } from '@axlabs/neofs-sdk-ts-core/crypto';

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
}

/**
 * Network map structure
 */
export interface Netmap {
  epoch: number;
  nodes: NodeInfo[];
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
      version.Minor = 18;
      metaHeader.Version = version;
      metaHeader.Ttl = 2;
      request.MetaHeader = metaHeader;

      // Create proper protobuf verification header
      const verifyHeader = new NeoFsV2Session.RequestVerificationHeader();

      // Generate proper signatures for the request
      // Sign the request body
      const bodyData = request.Body!.serializeBinary();
      const bodySignature = this.config.signer.sign(bodyData);

      // Sign the meta header
      const metaData = request.MetaHeader!.serializeBinary();
      const metaSignature = this.config.signer.sign(metaData);

      // Sign the verification header (origin signature)
      const originData = verifyHeader.serializeBinary();
      const originSignature = this.config.signer.sign(originData);

      // Create body signature
      const bodySig = new NeoFsV2Refs.Signature();
      bodySig.Key = publicKeyBytes(this.config.signer.public());
      bodySig.Sign = bodySignature;
      bodySig.Scheme = this.config.signer.scheme() as unknown as NeoFsV2Refs.SignatureScheme;
      verifyHeader.BodySignature = bodySig;

      // Create meta signature
      const metaSig = new NeoFsV2Refs.Signature();
      metaSig.Key = publicKeyBytes(this.config.signer.public());
      metaSig.Sign = metaSignature;
      metaSig.Scheme = this.config.signer.scheme() as unknown as NeoFsV2Refs.SignatureScheme;
      verifyHeader.MetaSignature = metaSig;

      // Create origin signature
      const originSig = new NeoFsV2Refs.Signature();
      originSig.Key = publicKeyBytes(this.config.signer.public());
      originSig.Sign = originSignature;
      originSig.Scheme = this.config.signer.scheme() as unknown as NeoFsV2Refs.SignatureScheme;
      verifyHeader.OriginSignature = originSig;

      request.VerifyHeader = verifyHeader;

      // Make the gRPC call using our generated service client
      const response = await this.client.localNodeInfo(request);

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
      version.Minor = 18;
      metaHeader.Version = version;
      metaHeader.Ttl = 2;
      request.MetaHeader = metaHeader;

      // Create proper protobuf verification header
      const verifyHeader = new NeoFsV2Session.RequestVerificationHeader();

      // Generate proper signatures for the request
      const bodyData = request.Body!.serializeBinary();
      const bodySignature = this.config.signer.sign(bodyData);

      const metaData = request.MetaHeader!.serializeBinary();
      const metaSignature = this.config.signer.sign(metaData);

      const originData = verifyHeader.serializeBinary();
      const originSignature = this.config.signer.sign(originData);

      // Create signatures
      const bodySig = new NeoFsV2Refs.Signature();
      bodySig.Key = publicKeyBytes(this.config.signer.public());
      bodySig.Sign = bodySignature;
      bodySig.Scheme = this.config.signer.scheme() as unknown as NeoFsV2Refs.SignatureScheme;
      verifyHeader.BodySignature = bodySig;

      const metaSig = new NeoFsV2Refs.Signature();
      metaSig.Key = publicKeyBytes(this.config.signer.public());
      metaSig.Sign = metaSignature;
      metaSig.Scheme = this.config.signer.scheme() as unknown as NeoFsV2Refs.SignatureScheme;
      verifyHeader.MetaSignature = metaSig;

      const originSig = new NeoFsV2Refs.Signature();
      originSig.Key = publicKeyBytes(this.config.signer.public());
      originSig.Sign = originSignature;
      originSig.Scheme = this.config.signer.scheme() as unknown as NeoFsV2Refs.SignatureScheme;
      verifyHeader.OriginSignature = originSig;

      request.VerifyHeader = verifyHeader;

      // Make the gRPC call using our generated service client
      const response = await this.client.networkInfo(request);

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
      version.Minor = 18;
      metaHeader.Version = version;
      metaHeader.Ttl = 2;
      request.MetaHeader = metaHeader;

      // Create proper protobuf verification header
      const verifyHeader = new NeoFsV2Session.RequestVerificationHeader();

      // Generate proper signatures for the request
      const bodyData = request.Body!.serializeBinary();
      const bodySignature = this.config.signer.sign(bodyData);

      const metaData = request.MetaHeader!.serializeBinary();
      const metaSignature = this.config.signer.sign(metaData);

      const originData = verifyHeader.serializeBinary();
      const originSignature = this.config.signer.sign(originData);

      // Create signatures
      const bodySig = new NeoFsV2Refs.Signature();
      bodySig.Key = publicKeyBytes(this.config.signer.public());
      bodySig.Sign = bodySignature;
      bodySig.Scheme = this.config.signer.scheme() as unknown as NeoFsV2Refs.SignatureScheme;
      verifyHeader.BodySignature = bodySig;

      const metaSig = new NeoFsV2Refs.Signature();
      metaSig.Key = publicKeyBytes(this.config.signer.public());
      metaSig.Sign = metaSignature;
      metaSig.Scheme = this.config.signer.scheme() as unknown as NeoFsV2Refs.SignatureScheme;
      verifyHeader.MetaSignature = metaSig;

      const originSig = new NeoFsV2Refs.Signature();
      originSig.Key = publicKeyBytes(this.config.signer.public());
      originSig.Sign = originSignature;
      originSig.Scheme = this.config.signer.scheme() as unknown as NeoFsV2Refs.SignatureScheme;
      verifyHeader.OriginSignature = originSig;

      request.VerifyHeader = verifyHeader;

      // Make the gRPC call using our generated service client
      const response = await this.client.netmapSnapshot(request);

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
      };
    } catch (error: any) {
      throw new Error(`Failed to get netmap snapshot: ${error.message}`);
    }
  }
}
