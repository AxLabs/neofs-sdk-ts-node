import { NeoFSClient } from './client';
import { ContainerID, ObjectID, Address, ObjectGetResult } from '../types';
import { ObjectGetParams } from './object';
import { SessionClient, SessionToken } from './session';
import { Signer, publicKeyBytes } from '@axlabs/neofs-sdk-ts-core/crypto';
import { NeoFsV2Refs } from '../gen/refs/types_pb';
import { NeoFsV2Session } from '../gen/session/types_pb';
import { NeoFsV2Object } from '../gen/object/types_pb';
import { PutRequest, PutRequest_Body, PutResponse, GetRequest, GetRequest_Body, HeadRequest, HeadRequest_Body, DeleteRequest, DeleteRequest_Body, SearchRequest, SearchRequest_Body, SearchV2Request, SearchV2Request_Body, GetResponse, GetResponse_Body, HeadResponse, HeadResponse_Body, DeleteResponse, DeleteResponse_Body, SearchResponse, SearchResponse_Body, SearchV2Response, SearchV2Response_Body, SearchV2Response_OIDWithMeta, PutRequest_Body_Init } from '../gen/object/service_pb';
import { ObjectServiceClient } from '../gen/object/service_grpc_pb';
import * as grpc from '@grpc/grpc-js';
import * as crypto from 'crypto';

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
  private client: any;
  private signer: any;
  private endpoint: string;
  private sessionClient: SessionClient;
  private sessionToken: SessionToken | null = null;
  private neofsClient: NeoFSClient;

  constructor(neofsClient: NeoFSClient, config: { signer: any; endpoint: string }) {
    this.neofsClient = neofsClient;
    this.signer = config.signer;
    this.endpoint = config.endpoint;
    this.sessionClient = new SessionClient(neofsClient, config);
    
    // Create gRPC client
    const credentials = config.endpoint.startsWith('grpcs://')
      ? grpc.credentials.createSsl()
      : grpc.credentials.createInsecure();

    this.client = new ObjectServiceClient(
      config.endpoint.replace(/^grpcs?:\/\//, ''),
      credentials
    );
  }

  /**
   * Initialize session token for object operations.
   */
  async initializeSession(): Promise<void> {
    // Always create a fresh session to avoid expiration issues
    // Session tokens expire quickly (within minutes), so we need to refresh
    
    // Get current epoch from network
    let currentEpoch = 0;
    try {
      const networkInfo = await this.neofsClient.netmap().networkInfo();
      currentEpoch = networkInfo.currentEpoch;
      console.log('Current network epoch:', currentEpoch);
    } catch (error) {
      console.warn('Failed to get network info, using epoch 0:', error);
    }
    
    // Set expiration to current epoch + 100 (about 100 epochs in the future)
    const expiration = currentEpoch + 100;

    console.log('Creating new session token with expiration:', expiration);
    this.sessionToken = await this.sessionClient.create({
      expiration,
    });
    console.log('Session token created');
  }
  
  /**
   * Reset the session token to force a new session on next operation
   */
  resetSession(): void {
    this.sessionToken = null;
  }

  private sha256(data: Uint8Array): Uint8Array {
    return new Uint8Array(crypto.createHash('sha256').update(data).digest());
  }

  private getVersion(): Uint8Array {
    return new Uint8Array([0, 2]); // Version 2.0
  }

  private signRequest(request: any): void {
    if (!this.signer) return;
    
    // Get existing verification header (if any)
    const existingVerifyHeader = request.VerifyHeader;
    
    // Serialize the request body (not the entire request)
    const bodySerialized = request.Body!.serializeBinary();
    
    // Create signature for body
    const bodySignatureBytes = this.signer.sign(bodySerialized);
    
    // Create signature object
    const bodySignature = new NeoFsV2Refs.Signature();
    const publicKeyBytes = new Uint8Array(this.signer.public().maxEncodedSize());
    this.signer.public().encode(publicKeyBytes);
    bodySignature.Key = publicKeyBytes;
    bodySignature.Sign = bodySignatureBytes;
    bodySignature.Scheme = this.signer.scheme() as unknown as NeoFsV2Refs.SignatureScheme;
    
    // Serialize the meta header
    const metaSerialized = request.MetaHeader!.serializeBinary();
    
    // Create signature for meta header
    const metaSignatureBytes = this.signer.sign(metaSerialized);
    
    const metaSignature = new NeoFsV2Refs.Signature();
    metaSignature.Key = publicKeyBytes;
    metaSignature.Sign = metaSignatureBytes;
    metaSignature.Scheme = this.signer.scheme() as unknown as NeoFsV2Refs.SignatureScheme;
    
    // Create verification header
    const verifyHeader = new NeoFsV2Session.RequestVerificationHeader();
    
    // Only set body signature if there's no existing verification header
    if (!existingVerifyHeader) {
      verifyHeader.BodySignature = bodySignature;
    }
    verifyHeader.MetaSignature = metaSignature;
    
    // Set origin signature to signature of existing verification header (if any)
    if (existingVerifyHeader) {
      const existingVerifyHeaderSerialized = existingVerifyHeader.serializeBinary();
      const originSignatureBytes = this.signer.sign(existingVerifyHeaderSerialized);
      
      const originSignature = new NeoFsV2Refs.Signature();
      originSignature.Key = publicKeyBytes;
      originSignature.Sign = originSignatureBytes;
      originSignature.Scheme = this.signer.scheme() as unknown as NeoFsV2Refs.SignatureScheme;
      
      verifyHeader.OriginSignature = originSignature;
    } else {
      // For the first request, sign empty byte array (like C# and Go implementations)
      const emptySignatureBytes = this.signer.sign(new Uint8Array(0));
      
      const originSignature = new NeoFsV2Refs.Signature();
      originSignature.Key = publicKeyBytes;
      originSignature.Sign = emptySignatureBytes;
      originSignature.Scheme = this.signer.scheme() as unknown as NeoFsV2Refs.SignatureScheme;
      
      verifyHeader.OriginSignature = originSignature;
    }
    
    // Set the verification header on the request
    request.VerifyHeader = verifyHeader;
  }

  /**
   * Download an object from NeoFS using streaming.
   * NO session tokens - uses verification headers.
   * Note: get() is a SERVER STREAMING call - request goes in, stream comes out.
   */
  async get(params: ObjectGetParams): Promise<ObjectGetResult> {
    // Set body
    const body = new GetRequest_Body();
    const addressProto = new NeoFsV2Refs.Address();
    
    const containerIdProto = new NeoFsV2Refs.ContainerID();
    containerIdProto.Value = params.address.containerId.value;
    addressProto.ContainerId = containerIdProto;
    
    const objectIdProto = new NeoFsV2Refs.ObjectID();
    objectIdProto.Value = params.address.objectId.value;
    addressProto.ObjectId = objectIdProto;
    
    body.Address = addressProto;
    body.Raw = params.raw || false;

    // Create meta header (no session token!)
    const metaHeader = new NeoFsV2Session.RequestMetaHeader();
    const version = new NeoFsV2Refs.Version();
    version.Major = 2;
    version.Minor = 18;
    metaHeader.Version = version;
    metaHeader.Ttl = 2;

    // Create verification header
    const verifyHeader = this.createVerificationHeader(body.serializeBinary(), metaHeader);

    // Create get request
    const request = new GetRequest();
    request.Body = body;
    request.MetaHeader = metaHeader;
    request.VerifyHeader = verifyHeader;

    // Make the gRPC server streaming call - pass request directly
    return new Promise((resolve, reject) => {
      // Server streaming: pass request to get(), receive stream
      const call = this.client.get(request);
      
      let objectHeader: any = null;
      let objectSignature: any = null;
      let objectId: ObjectID | null = null;
      const payloadChunks: Uint8Array[] = [];

      call.on('data', (response: any) => {
        const responseBody = response.Body;
        if (!responseBody) return;
        
        // Check which part of the response we have
        if (responseBody.Init) {
          const init = responseBody.Init;
          objectId = { value: new Uint8Array(init.ObjectId?.Value || []) };
          objectSignature = init.Signature;
          objectHeader = init.Header;
        } else if (responseBody.Chunk) {
          const chunk = new Uint8Array(responseBody.Chunk);
          payloadChunks.push(chunk);
        } else if (responseBody.SplitInfo) {
          reject(new Error('SplitInfo not supported yet'));
          return;
        }
      });

      call.on('error', (error: any) => {
        console.error('Get call error:', error);
        reject(new Error(`Failed to get object: ${error.message}`));
      });

      call.on('end', () => {
        if (!objectHeader || !objectId) {
          reject(new Error('No object header in response'));
          return;
        }

        // Combine all payload chunks
        const totalLength = payloadChunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const payload = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of payloadChunks) {
          payload.set(chunk, offset);
          offset += chunk.length;
        }

        resolve({
          objectId,
          header: objectHeader,
          signature: objectSignature,
          payload
        });
      });
    });
  }

  /**
   * Upload an object to NeoFS using streaming.
   * Based on the React Native client implementation - NO session tokens needed.
   */
  async put(params: ObjectPutParams): Promise<ObjectID> {
    // Create object header
    const headerProto = new NeoFsV2Object.Header();
    
    // Set version
    const headerVersion = new NeoFsV2Refs.Version();
    headerVersion.Major = params.header.version?.major || 2;
    headerVersion.Minor = params.header.version?.minor || 0;
    headerProto.Version = headerVersion;

    // Set container ID
    const containerIdProto = new NeoFsV2Refs.ContainerID();
    containerIdProto.Value = params.header.containerId.value;
    headerProto.ContainerId = containerIdProto;

    // Set owner ID
    const ownerIdProto = new NeoFsV2Refs.OwnerID();
    ownerIdProto.Value = params.header.ownerId;
    headerProto.OwnerId = ownerIdProto;

    // Set object type (REGULAR = 0)
    headerProto.ObjectType = params.header.objectType ?? 0;

    // Set payload length
    if (params.payload) {
      headerProto.PayloadLength = BigInt(params.payload.length);
    } else if (params.header.payloadLength !== undefined) {
      headerProto.PayloadLength = BigInt(params.header.payloadLength);
    }

    // Set payload hash (SHA256)
    if (params.header.payloadHash) {
      const payloadHash = new NeoFsV2Refs.Checksum();
      payloadHash.Type = params.header.payloadHash.type;
      payloadHash.Sum = params.header.payloadHash.sum;
      headerProto.PayloadHash = payloadHash;
    }

    // Set homomorphic hash if provided
    if (params.header.homomorphicHash) {
      const homomorphicHash = new NeoFsV2Refs.Checksum();
      homomorphicHash.Type = params.header.homomorphicHash.type;
      homomorphicHash.Sum = params.header.homomorphicHash.sum;
      headerProto.HomomorphicHash = homomorphicHash;
    }

    // Set attributes
    if (params.header.attributes) {
      const attributes: NeoFsV2Object.Header_Attribute[] = [];
      params.header.attributes.forEach(attr => {
        const attrProto = new NeoFsV2Object.Header_Attribute();
        attrProto.Key = attr.key;
        attrProto.Value = attr.value;
        attributes.push(attrProto);
      });
      headerProto.Attributes = attributes;
    }

    // Calculate object ID = SHA256(serialized header)
    const headerBytes = headerProto.serializeBinary();
    const objectIdBytes = this.sha256(headerBytes);
    const objectIdProto = new NeoFsV2Refs.ObjectID();
    objectIdProto.Value = objectIdBytes;

    console.log('Calculated Object ID:', Buffer.from(objectIdBytes).toString('hex'));

    // Sign the object ID (protobuf-serialized form)
    const objectIdSerialized = objectIdProto.serializeBinary();
    const objectIdSignature = this.signer.sign(objectIdSerialized);

    // Create object signature
    const objectSignature = new NeoFsV2Refs.Signature();
    objectSignature.Key = publicKeyBytes(this.signer.public());
    objectSignature.Sign = objectIdSignature;
    objectSignature.Scheme = this.signer.scheme() as unknown as NeoFsV2Refs.SignatureScheme;

    // Create init body
    const init = new PutRequest_Body_Init();
    init.ObjectId = objectIdProto;
    init.Signature = objectSignature;
    init.Header = headerProto;
    init.CopiesNumber = params.copiesNumber || 0;

    const initBody = new PutRequest_Body();
    initBody.Init = init;

    // Create meta header (no session token!)
    const metaHeader = new NeoFsV2Session.RequestMetaHeader();
    const version = new NeoFsV2Refs.Version();
    version.Major = 2;
    version.Minor = 18;
    metaHeader.Version = version;
    metaHeader.Ttl = 2;

    // Create verification header for init request
    const initVerifyHeader = this.createVerificationHeader(initBody.serializeBinary(), metaHeader);

    // Create init request
    const initRequest = new PutRequest();
    initRequest.Body = initBody;
    initRequest.MetaHeader = metaHeader;
    initRequest.VerifyHeader = initVerifyHeader;

    // Use streaming for object upload
    return new Promise((resolve, reject) => {
      const call = this.client.put(undefined, undefined, (error: any, response: PutResponse) => {
        if (error) {
          console.error('Put gRPC error:', error);
          reject(error);
          return;
        }
        
        console.log('Put response received:', JSON.stringify({
          hasBody: !!response?.Body,
          hasObjectId: !!response?.Body?.ObjectId,
          hasMetaHeader: !!response?.MetaHeader,
          status: response?.MetaHeader?.Status ? {
            code: response.MetaHeader.Status.Code,
            message: response.MetaHeader.Status.Message
          } : null
        }));
        
        // Check for error status in response
        if (response?.MetaHeader?.Status && response.MetaHeader.Status.Code !== 0) {
          const status = response.MetaHeader.Status;
          reject(new Error(`NeoFS error: ${status.Message} (code: ${status.Code})`));
          return;
        }
        
        // Return the calculated object ID (we already know it)
        resolve({ value: objectIdBytes });
      });
      
      // Send the initial request with header
      call.write(initRequest);
      
      // Send payload chunks if provided
      if (params.payload && params.payload.length > 0) {
        const chunkSize = 1024 * 1024; // 1MB chunks
        let offset = 0;
        
        while (offset < params.payload.length) {
          const end = Math.min(offset + chunkSize, params.payload.length);
          const chunk = params.payload.slice(offset, end);
          
          const chunkBody = new PutRequest_Body();
          chunkBody.Chunk = chunk;
          
          const chunkMetaHeader = new NeoFsV2Session.RequestMetaHeader();
          chunkMetaHeader.Version = version;
          chunkMetaHeader.Ttl = 2;
          
          const chunkVerifyHeader = this.createVerificationHeader(chunkBody.serializeBinary(), chunkMetaHeader);
          
          const chunkRequest = new PutRequest();
          chunkRequest.Body = chunkBody;
          chunkRequest.MetaHeader = chunkMetaHeader;
          chunkRequest.VerifyHeader = chunkVerifyHeader;
          
          call.write(chunkRequest);
          offset = end;
        }
      }
      
      // End the stream and get response
      call.end();
    });
  }
  
  /**
   * Create verification header with proper signatures (like React Native client).
   */
  private createVerificationHeader(
    bodyBytes: Uint8Array,
    metaHeader: NeoFsV2Session.RequestMetaHeader
  ): NeoFsV2Session.RequestVerificationHeader {
    const pubKey = publicKeyBytes(this.signer.public());
    const scheme = this.signer.scheme() as unknown as NeoFsV2Refs.SignatureScheme;

    // Sign the body
    const bodySignature = this.signer.sign(bodyBytes);

    // Sign the serialized meta header
    const metaBytes = metaHeader.serializeBinary();
    const metaSignature = this.signer.sign(metaBytes);

    // For origin signature, we sign an empty byte array (no origin header)
    const originSignature = this.signer.sign(new Uint8Array(0));

    const verifyHeader = new NeoFsV2Session.RequestVerificationHeader();
    
    const bodySig = new NeoFsV2Refs.Signature();
    bodySig.Key = pubKey;
    bodySig.Sign = bodySignature;
    bodySig.Scheme = scheme;
    verifyHeader.BodySignature = bodySig;
    
    const metaSig = new NeoFsV2Refs.Signature();
    metaSig.Key = pubKey;
    metaSig.Sign = metaSignature;
    metaSig.Scheme = scheme;
    verifyHeader.MetaSignature = metaSig;
    
    const originSig = new NeoFsV2Refs.Signature();
    originSig.Key = pubKey;
    originSig.Sign = originSignature;
    originSig.Scheme = scheme;
    verifyHeader.OriginSignature = originSig;

    return verifyHeader;
  }


  /**
   * Get object metadata without downloading payload.
   * NO session tokens - uses verification headers.
   */
  async head(params: ObjectHeadParams): Promise<ObjectHeader> {
    // Set body
    const body = new HeadRequest_Body();
    const addressProto = new NeoFsV2Refs.Address();
    
    const containerIdProto = new NeoFsV2Refs.ContainerID();
    containerIdProto.Value = params.address.containerId.value;
    addressProto.ContainerId = containerIdProto;
    
    const objectIdProto = new NeoFsV2Refs.ObjectID();
    objectIdProto.Value = params.address.objectId.value;
    addressProto.ObjectId = objectIdProto;
    
    body.Address = addressProto;
    body.Raw = params.raw || false;

    // Create meta header (no session token!)
    const metaHeader = new NeoFsV2Session.RequestMetaHeader();
    const version = new NeoFsV2Refs.Version();
    version.Major = 2;
    version.Minor = 18;
    metaHeader.Version = version;
    metaHeader.Ttl = 2;

    // Create verification header
    const verifyHeader = this.createVerificationHeader(body.serializeBinary(), metaHeader);

    // Create head request
    const request = new HeadRequest();
    request.Body = body;
    request.MetaHeader = metaHeader;
    request.VerifyHeader = verifyHeader;

    // Make the gRPC call
    const response = await this.client.head(request);
    
    // Parse response
    const responseBody = response.Body;
    if (!responseBody) {
      throw new Error('No response body received');
    }
    
    if (responseBody.Header) {
      const headerWithSig = responseBody.Header;
      return headerWithSig.Header!;
    } else if (responseBody.ShortHeader) {
      const shortHeader = responseBody.ShortHeader;
      // Convert short header to full header format
      return {
        containerId: params.address.containerId,
        ownerId: new Uint8Array(shortHeader.OwnerId?.Value || []),
        objectType: shortHeader.ObjectType,
        payloadLength: Number(shortHeader.PayloadLength),
        payloadHash: shortHeader.PayloadHash ? {
          type: shortHeader.PayloadHash.Type,
          sum: new Uint8Array(shortHeader.PayloadHash.Sum)
        } : undefined,
        homomorphicHash: shortHeader.HomomorphicHash ? {
          type: shortHeader.HomomorphicHash.Type,
          sum: new Uint8Array(shortHeader.HomomorphicHash.Sum)
        } : undefined,
        version: shortHeader.Version ? {
          major: shortHeader.Version.Major,
          minor: shortHeader.Version.Minor
        } : undefined
      };
    } else if (responseBody.SplitInfo) {
      throw new Error('SplitInfo not supported yet');
    } else {
      throw new Error('Malformed object head response');
    }
  }

  /**
   * Delete an object from NeoFS.
   * NO session tokens - uses verification headers.
   */
  async delete(params: ObjectDeleteParams): Promise<Address> {
    // Set body
    const body = new DeleteRequest_Body();
    const addressProto = new NeoFsV2Refs.Address();
    
    const containerIdProto = new NeoFsV2Refs.ContainerID();
    containerIdProto.Value = params.address.containerId.value;
    addressProto.ContainerId = containerIdProto;
    
    const objectIdProto = new NeoFsV2Refs.ObjectID();
    objectIdProto.Value = params.address.objectId.value;
    addressProto.ObjectId = objectIdProto;
    
    body.Address = addressProto;

    // Create meta header (no session token!)
    const metaHeader = new NeoFsV2Session.RequestMetaHeader();
    const version = new NeoFsV2Refs.Version();
    version.Major = 2;
    version.Minor = 18;
    metaHeader.Version = version;
    metaHeader.Ttl = 2;

    // Create verification header
    const verifyHeader = this.createVerificationHeader(body.serializeBinary(), metaHeader);

    // Create delete request
    const request = new DeleteRequest();
    request.Body = body;
    request.MetaHeader = metaHeader;
    request.VerifyHeader = verifyHeader;

    // Make the gRPC call
    const response = await this.client.delete(request);
    
    // Parse response - delete returns the address
    return params.address;
  }

  /**
   * Search for objects in a container.
   * NO session tokens - uses verification headers like React Native client.
   */
  async search(params: ObjectSearchParams): Promise<ObjectID[]> {
    // Set body
    const body = new SearchRequest_Body();
    const containerIdProto = new NeoFsV2Refs.ContainerID();
    containerIdProto.Value = params.containerId.value;
    body.ContainerId = containerIdProto;
    body.Version = 1; // Search version 1
    
    if (params.filters) {
      const filters: NeoFsV2Object.SearchFilter[] = [];
      params.filters.forEach(filter => {
        const filterProto = new NeoFsV2Object.SearchFilter();
        filterProto.Key = filter.key;
        filterProto.Value = filter.value;
        filterProto.MatchType = filter.matchType || 0;
        filters.push(filterProto);
      });
      body.Filters = filters;
    }

    // Create meta header (no session token!)
    const metaHeader = new NeoFsV2Session.RequestMetaHeader();
    const version = new NeoFsV2Refs.Version();
    version.Major = 2;
    version.Minor = 18;
    metaHeader.Version = version;
    metaHeader.Ttl = 2;

    // Create verification header
    const verifyHeader = this.createVerificationHeader(body.serializeBinary(), metaHeader);

    // Create search request
    const request = new SearchRequest();
    request.Body = body;
    request.MetaHeader = metaHeader;
    request.VerifyHeader = verifyHeader;

    // Make the gRPC streaming call
    return new Promise((resolve, reject) => {
      const call = this.client.search(request);
      const results: ObjectID[] = [];

      call.on('data', (response: SearchResponse) => {
        const responseBody = response.Body;
        if (responseBody && responseBody.IdList) {
          for (const id of responseBody.IdList) {
            results.push({ value: new Uint8Array(id.Value) });
          }
        }
      });

      call.on('error', (error: any) => {
        reject(new Error(`Failed to search objects: ${error.message}`));
      });

      call.on('end', () => {
        resolve(results);
      });
    });
  }

  /**
   * Search for objects in a container (v2).
   * NO session tokens - uses verification headers.
   */
  async searchV2(params: ObjectSearchV2Params): Promise<ObjectSearchV2Result> {
    // Set body
    const body = new SearchV2Request_Body();
    const containerIdProto = new NeoFsV2Refs.ContainerID();
    containerIdProto.Value = params.containerId.value;
    body.ContainerId = containerIdProto;
    body.Version = 1; // Search version 1
    
    if (params.filters) {
      const filters: NeoFsV2Object.SearchFilter[] = [];
      params.filters.forEach(filter => {
        const filterProto = new NeoFsV2Object.SearchFilter();
        filterProto.Key = filter.key;
        filterProto.Value = filter.value;
        filterProto.MatchType = filter.matchType || 0;
        filters.push(filterProto);
      });
      body.Filters = filters;
    }
    
    if (params.limit) {
      body.Count = params.limit;
    }
    
    if (params.cursor) {
      body.Cursor = params.cursor;
    }

    // Create meta header (no session token!)
    const metaHeader = new NeoFsV2Session.RequestMetaHeader();
    const version = new NeoFsV2Refs.Version();
    version.Major = 2;
    version.Minor = 18;
    metaHeader.Version = version;
    metaHeader.Ttl = 2;

    // Create verification header
    const verifyHeader = this.createVerificationHeader(body.serializeBinary(), metaHeader);

    // Create search request
    const request = new SearchV2Request();
    request.Body = body;
    request.MetaHeader = metaHeader;
    request.VerifyHeader = verifyHeader;

    // Make the gRPC call
    const response = await this.client.searchV2(request);
    
    // Parse response
    const responseBody = response.Body;
    if (!responseBody) {
      throw new Error('No response body received');
    }
    
    const results = (responseBody.Result || []).map((item: SearchV2Response_OIDWithMeta) => ({
      id: { value: new Uint8Array(item.Id?.Value || []) },
      attributes: (item.Attributes || []).map((attr: string) => {
        // Attributes are stored as strings in format "key=value"
        const parts = attr.split('=');
        return {
          key: parts[0] || '',
          value: parts.slice(1).join('=') || ''
        };
      })
    }));
    
    return {
      result: results,
      cursor: responseBody.Cursor || ''
    };
  }
}
