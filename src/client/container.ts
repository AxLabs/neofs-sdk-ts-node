import { ClientConfig } from './client';
import { Signer, NeoFSSignature, publicKeyBytes, ECDSASignerRFC6979 } from 'neofs-sdk-ts-core/crypto';
import { NodeState, NodeAttribute } from './netmap';
import { ContainerID } from '../types';

// Import proto definitions - using our generated classes
import { ContainerServiceClient } from '../gen/container/service_grpc_pb';
import { 
  ListRequest,
  ListRequest_Body,
  ListResponse,
  PutRequest,
  PutRequest_Body,
  PutResponse,
  GetRequest,
  GetRequest_Body,
  GetResponse,
  DeleteRequest,
  DeleteRequest_Body
} from '../gen/container/service_pb';
import { NeoFsV2Container } from '../gen/container/types_pb';
import { NeoFsV2Refs } from '../gen/refs/types_pb';
import { NeoFsV2Session } from '../gen/session/types_pb';
import { NeoFsV2Netmap } from '../gen/netmap/types_pb';
import * as grpc from '@grpc/grpc-js';

/**
 * Container attribute structure
 */
export interface ContainerAttribute {
  key: string;
  value: string;
}

/**
 * Placement policy replica structure
 */
export interface PlacementReplica {
  count: number;
  selector: string;
}

/**
 * Placement policy selector structure
 */
export interface PlacementSelector {
  name: string;
  count: number;
  clause: number; // Clause enum
  attribute: string;
  filter: string;
}

/**
 * Placement policy filter structure
 */
export interface PlacementFilter {
  name: string;
  key: string;
  op: number; // Operation enum
  value: string;
  filters: PlacementFilter[];
}

/**
 * Placement policy structure
 */
export interface PlacementPolicy {
  replicas: PlacementReplica[];
  containerBackupFactor: number;
  selectors: PlacementSelector[];
  filters: PlacementFilter[];
}

/**
 * Container structure
 */
export interface Container {
  version: {
    major: number;
    minor: number;
  };
  ownerId?: Uint8Array; // Optional - will be generated from signer if not provided
  nonce: Uint8Array;
  basicAcl: number;
  attributes: ContainerAttribute[];
  placementPolicy: PlacementPolicy;
}

/**
 * Container ID structure
 */

/**
 * Parameters for creating a container
 */
export interface ContainerPutParams {
  container: Container;
}

/**
 * Parameters for getting a container
 */
export interface ContainerGetParams {
  containerId: ContainerID;
}

/**
 * Parameters for listing containers
 */
export interface ContainerListParams {
  ownerId?: Uint8Array;
}

/**
 * Parameters for deleting a container
 */
export interface ContainerDeleteParams {
  containerId: ContainerID;
}

/**
 * Client for interacting with NeoFS Container service.
 */
export class ContainerClient {
  private config: ClientConfig;
  private client: ContainerServiceClient;

  constructor(config: ClientConfig) {
    this.config = config;
    // Create Node.js gRPC client using our generated service client
    const credentials = config.endpoint.startsWith('grpcs://')
      ? grpc.credentials.createSsl()
      : grpc.credentials.createInsecure();

    this.client = new ContainerServiceClient(
      config.endpoint.replace(/^grpcs?:\/\//, ''),
      credentials
    );
  }

  /**
   * Generate a proper NeoFS account ID from an ECDSA public key.
   * This implements the same logic as the C# SDK's PublicKeyToAddress.
   */
  private generateNeoFSAccountId(publicKey: any): Uint8Array {
    // Get the public key bytes (compressed format)
    const pubKeyBytes = publicKeyBytes(publicKey);
    
    // Step 1: Create signature redeem script
    const script = this.createSignatureRedeemScript(pubKeyBytes);
    
    // Step 2: Calculate script hash (SHA256 + RIPEMD160)
    const scriptHash = this.calculateScriptHash(script);
    
    // Step 3: Create address with version byte + script hash + checksum
    const address = this.createAddress(scriptHash);
    
    // Step 4: Convert Base58 address to OwnerID bytes
    const accountId = this.base58Decode(address);
    
    return accountId;
  }

  /**
   * Creates signature redeem script from compressed public key.
   */
  private createSignatureRedeemScript(publicKey: Uint8Array): Uint8Array {
    if (publicKey.length !== 33) {
      throw new Error(`Invalid compressed public key length: ${publicKey.length}, expected 33`);
    }

    // CheckSig descriptor: SHA256("System.Crypto.CheckSig")
    const checkSigDescriptor = new Uint8Array(4);
    const descriptorHash = require('crypto').createHash('sha256')
      .update('System.Crypto.CheckSig', 'ascii')
      .digest();
    checkSigDescriptor.set(descriptorHash.slice(0, 4));

    // Create script: [0x0c, 33, publicKey, 0x41, checkSigDescriptor]
    const script = new Uint8Array(1 + 1 + 33 + 1 + 4);
    let offset = 0;

    script[offset++] = 0x0c; // PUSHDATA1
    script[offset++] = 33;   // 33 bytes
    script.set(publicKey, offset);
    offset += 33;
    script[offset++] = 0x41; // SYSCALL
    script.set(checkSigDescriptor, offset);

    return script;
  }

  /**
   * Calculates script hash using SHA256 + RIPEMD160.
   */
  private calculateScriptHash(script: Uint8Array): Uint8Array {
    // SHA256
    const sha256Hash = require('crypto').createHash('sha256').update(script).digest();

    // RIPEMD160 using crypto-js
    const CryptoJS = require('crypto-js');
    const wordArray = CryptoJS.lib.WordArray.create(sha256Hash);
    const hash = CryptoJS.RIPEMD160(wordArray);
    const bytes = [];
    for (let i = 0; i < hash.sigBytes; i++) {
      bytes.push((hash.words[Math.floor(i / 4)] >>> (24 - (i % 4) * 8)) & 0xff);
    }
    return new Uint8Array(bytes);
  }

  /**
   * Creates address with version byte + script hash + checksum.
   */
  private createAddress(scriptHash: Uint8Array): string {
    // Create data: [version, scriptHash]
    const data = new Uint8Array(21);
    data[0] = 0x35; // NeoAddressVersion
    data.set(scriptHash, 1);

    // Calculate checksum: double SHA256 of data
    const checksum = require('crypto').createHash('sha256')
      .update(require('crypto').createHash('sha256').update(data).digest())
      .digest();

    // Create final address: data + first 4 bytes of checksum
    const address = new Uint8Array(25);
    address.set(data, 0);
    address.set(checksum.slice(0, 4), 21);

    // Encode as Base58
    return this.base58Encode(address);
  }

  /**
   * Base58 encoding implementation.
   */
  private base58Encode(data: Uint8Array): string {
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let value = BigInt('0x' + Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(''));

    if (value === 0n) return '1';

    let result = '';
    while (value > 0n) {
      const remainder = value % 58n;
      value = value / 58n;
      result = alphabet[Number(remainder)] + result;
    }

    // Add leading '1's for leading zero bytes
    for (let i = 0; i < data.length && data[i] === 0; i++) {
      result = '1' + result;
    }

    return result;
  }

  /**
   * Base58 decoding implementation.
   */
  private base58Decode(encoded: string): Uint8Array {
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let value = 0n;
    
    // Decode Base58 string to BigInteger
    for (let i = 0; i < encoded.length; i++) {
      const digit = alphabet.indexOf(encoded[i]);
      if (digit < 0) {
        throw new Error(`Invalid Base58 character '${encoded[i]}' at position ${i}`);
      }
      value = value * 58n + BigInt(digit);
    }
    
    // Convert BigInteger to byte array
    const leadingZeros = encoded.match(/^1+/)?.[0].length || 0;
    const bytes = [];
    
    while (value > 0n) {
      bytes.unshift(Number(value & 0xFFn));
      value = value >> 8n;
    }
    
    // Add leading zeros
    const result = new Uint8Array(leadingZeros + bytes.length);
    result.set(bytes, leadingZeros);
    
    return result;
  }

  /**
   * Calculate container signature using RFC6979.
   * The signature should be calculated over the entire marshalled container.
   */
  private calculateContainerSignature(containerProto: any): Uint8Array {
    // Create RFC6979 signer for container signatures
    const rfc6979Signer = ECDSASignerRFC6979.fromPrivateKeyBytes((this.config.signer as any).privateKey);
    
    // Sign the entire marshalled container proto message
    const containerData = containerProto.serializeBinary();
    return rfc6979Signer.sign(containerData);
  }


  /**
   * Create a new container.
   */
  async put(params: ContainerPutParams): Promise<ContainerID> {
    try {
      // Generate owner ID if not provided
      let ownerId = params.container.ownerId;
      if (!ownerId || ownerId.length === 0) {
        ownerId = this.generateNeoFSAccountId(this.config.signer.public());
      }

      // Create the container proto message using our generated classes
      const containerProto = new NeoFsV2Container.Container();
      
      // Set version
      const version = new NeoFsV2Refs.Version();
      version.Major = params.container.version.major;
      version.Minor = params.container.version.minor;
      containerProto.Version = version;

      // Set owner ID
      const ownerIdProto = new NeoFsV2Refs.OwnerID();
      ownerIdProto.Value = ownerId;
      containerProto.OwnerId = ownerIdProto;

      // Set nonce
      containerProto.Nonce = params.container.nonce;

      // Set basic ACL
      containerProto.BasicAcl = params.container.basicAcl;

      // Set attributes
      const attributes: NeoFsV2Container.Container_Attribute[] = [];
      params.container.attributes.forEach(attr => {
        const attrProto = new NeoFsV2Container.Container_Attribute();
        attrProto.Key = attr.key;
        attrProto.Value = attr.value;
        attributes.push(attrProto);
      });
      containerProto.Attributes = attributes;

      // Set placement policy
      const policyProto = new NeoFsV2Netmap.PlacementPolicy();
      
      // Set replicas
      const replicas: NeoFsV2Netmap.Replica[] = [];
      params.container.placementPolicy.replicas.forEach(replica => {
        const replicaProto = new NeoFsV2Netmap.Replica();
        replicaProto.Count = replica.count;
        replicaProto.Selector = replica.selector;
        replicas.push(replicaProto);
      });
      policyProto.Replicas = replicas;

      // Set selectors
      const selectors: NeoFsV2Netmap.Selector[] = [];
      params.container.placementPolicy.selectors.forEach(selector => {
        const selectorProto = new NeoFsV2Netmap.Selector();
        selectorProto.Name = selector.name;
        selectorProto.Count = selector.count;
        selectorProto.Clause = selector.clause;
        selectorProto.Attribute = selector.attribute;
        selectorProto.Filter = selector.filter;
        selectors.push(selectorProto);
      });
      policyProto.Selectors = selectors;

      // Set filters
      const filters: NeoFsV2Netmap.Filter[] = [];
      params.container.placementPolicy.filters.forEach(filter => {
        const filterProto = new NeoFsV2Netmap.Filter();
        filterProto.Name = filter.name;
        filterProto.Key = filter.key;
        filterProto.Op = filter.op;
        filterProto.Value = filter.value;
        filterProto.Filters = []; // TODO: Handle nested filters
        filters.push(filterProto);
      });
      policyProto.Filters = filters;

      policyProto.ContainerBackupFactor = params.container.placementPolicy.containerBackupFactor;
      containerProto.PlacementPolicy = policyProto;

      // Calculate container signature (must be done after setting all fields)
      const containerSignature = this.calculateContainerSignature(containerProto);

      // Create the request using our generated classes
      const request = new PutRequest();
      
      // Create the request body
      const requestBody = new PutRequest_Body();
      requestBody.Container = containerProto;
      
      // Create RFC6979 signature
      const signatureRFC6979 = new NeoFsV2Refs.SignatureRFC6979();
      signatureRFC6979.Key = publicKeyBytes(this.config.signer.public());
      signatureRFC6979.Sign = containerSignature;
      requestBody.Signature = signatureRFC6979;
      
      request.Body = requestBody;

      // Create the meta header
      const metaHeader = new NeoFsV2Session.RequestMetaHeader();
      const versionMeta = new NeoFsV2Refs.Version();
      versionMeta.Major = 2;
      versionMeta.Minor = 18;
      metaHeader.Version = versionMeta;
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
      const response = await this.client.put(request);

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

      const containerIdProto = body.ContainerId;
      if (!containerIdProto) {
        throw new Error('Missing container ID in response');
      }

      return {
        value: new Uint8Array(containerIdProto.Value),
      };
    } catch (error: any) {
      throw new Error(`Failed to create container: ${error.message}`);
    }
  }

  /**
   * Get a container by ID.
   */
  async get(params: ContainerGetParams): Promise<Container> {
    try {
      // Create the request using our generated classes
      const request = new GetRequest();
      
      // Create the request body
      const requestBody = new GetRequest_Body();
      const containerIdProto = new NeoFsV2Refs.ContainerID();
      containerIdProto.Value = params.containerId.value;
      requestBody.ContainerId = containerIdProto;
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
      const response = await this.client.get(request);

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

      const containerProto = body.Container;
      if (!containerProto) {
        throw new Error('Missing container in response');
      }

      // Convert attributes
      const attributes: ContainerAttribute[] = [];
      const protoAttributes = containerProto.Attributes || [];
      for (const attr of protoAttributes) {
        attributes.push({
          key: attr.Key,
          value: attr.Value,
        });
      }

      // Convert placement policy
      const policyProto = containerProto.PlacementPolicy;
      const policy: PlacementPolicy = {
        replicas: [],
        containerBackupFactor: policyProto?.ContainerBackupFactor || 0,
        selectors: [],
        filters: [],
      };

      if (policyProto) {
        // Convert replicas
        const protoReplicas = policyProto.Replicas || [];
        for (const replica of protoReplicas) {
          policy.replicas.push({
            count: replica.Count,
            selector: replica.Selector,
          });
        }

        // Convert selectors
        const protoSelectors = policyProto.Selectors || [];
        for (const selector of protoSelectors) {
          policy.selectors.push({
            name: selector.Name,
            count: selector.Count,
            clause: selector.Clause,
            attribute: selector.Attribute,
            filter: selector.Filter,
          });
        }

        // Convert filters
        const protoFilters = policyProto.Filters || [];
        for (const filter of protoFilters) {
          policy.filters.push({
            name: filter.Name,
            key: filter.Key,
            op: filter.Op,
            value: filter.Value,
            filters: [], // TODO: Handle nested filters
          });
        }
      }

      return {
        version: {
          major: containerProto.Version?.Major || 0,
          minor: containerProto.Version?.Minor || 0,
        },
        ownerId: new Uint8Array(containerProto.OwnerId?.Value || []),
        nonce: new Uint8Array(containerProto.Nonce),
        basicAcl: containerProto.BasicAcl,
        attributes,
        placementPolicy: policy,
      };
    } catch (error: any) {
      throw new Error(`Failed to get container: ${error.message}`);
    }
  }

  /**
   * List containers owned by a specific owner.
   */
  async list(params: ContainerListParams = {}): Promise<ContainerID[]> {
    try {
      // Use provided owner ID or generate from signer
      let ownerId = params.ownerId;
      if (!ownerId) {
        ownerId = this.generateNeoFSAccountId(this.config.signer.public());
      }

      // Create the request using our generated classes
      const request = new ListRequest();
      
      // Create the request body
      const requestBody = new ListRequest_Body();
      const ownerIdProto = new NeoFsV2Refs.OwnerID();
      ownerIdProto.Value = ownerId;
      requestBody.OwnerId = ownerIdProto;
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
      const response = await this.client.list(request);

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
        // No containers found - return empty array
        return [];
      }

      const containerIds: ContainerID[] = [];
      const protoContainerIds = body.ContainerIds || [];
      
      for (const containerIdProto of protoContainerIds) {
        containerIds.push({
          value: new Uint8Array(containerIdProto.Value),
        });
      }

      return containerIds;
    } catch (error: any) {
      throw new Error(`Failed to list containers: ${error.message}`);
    }
  }

  /**
   * Delete a container by ID.
   */
  async delete(params: ContainerDeleteParams): Promise<void> {
    try {
      // Create the request using our generated classes
      const request = new DeleteRequest();
      
      // Create the request body
      const requestBody = new DeleteRequest_Body();
      const containerIdProto = new NeoFsV2Refs.ContainerID();
      containerIdProto.Value = params.containerId.value;
      requestBody.ContainerId = containerIdProto;

      // Sign the container ID for deletion using RFC6979
      const rfc6979Signer = ECDSASignerRFC6979.fromPrivateKeyBytes((this.config.signer as any).privateKey);
      const containerIdSignature = rfc6979Signer.sign(params.containerId.value);
      
      const signatureRFC6979 = new NeoFsV2Refs.SignatureRFC6979();
      signatureRFC6979.Key = publicKeyBytes(this.config.signer.public());
      signatureRFC6979.Sign = containerIdSignature;
      requestBody.Signature = signatureRFC6979;
      
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

      // For the first request, origin signature should be signature of empty byte array
      const originSignature = this.config.signer.sign(new Uint8Array(0));

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
      const response = await this.client.delete(request);

      // Check response status
      if (response.MetaHeader && response.MetaHeader.Status) {
        const status = response.MetaHeader.Status;
        if (status.Code !== 0) {
          throw new Error(`NeoFS error: ${status.Message} (code: ${status.Code})`);
        }
      }
    } catch (error: any) {
      throw new Error(`Failed to delete container: ${error.message}`);
    }
  }
}
