import { NeoFSClient } from './client';
import { Signer, publicKeyBytes } from '@axlabs/neofs-sdk-ts-core/crypto';
import { ObjectID, ContainerID } from '../types';
import * as grpc from '@grpc/grpc-js';
import * as crypto from 'crypto';
import RIPEMD160 from 'ripemd160';

// Import proto definitions
import { SessionServiceClient } from '../gen/session/service_grpc_pb';
import { CreateRequest, CreateRequest_Body, CreateResponse, CreateResponse_Body } from '../gen/session/service_pb';
import { NeoFsV2Session } from '../gen/session/types_pb';
import { NeoFsV2Refs } from '../gen/refs/types_pb';
import { signRequest as signV26Request } from './request-signing';
import { grpcCallOptions } from './grpc-call';

export interface SessionToken {
  id: Uint8Array;
  ownerId: Uint8Array;
  lifetime: {
    exp: number;
    nbf: number;
    iat: number;
  };
  sessionKey: Uint8Array;
  context?: {
    object?: {
      verb: number;
      address: {
        containerId: ContainerID;
        objectId: ObjectID;
      };
    };
    container?: {
      verb: number;
      wildcard: boolean;
      containerId?: ContainerID;
    };
  };
  signature?: {
    key: Uint8Array;
    sign: Uint8Array;
    scheme: number;
  };
}

export interface SessionCreateParams {
  expiration: number;
}

export interface SessionCreateResponse {
  id: Uint8Array;
  sessionKey: Uint8Array;
}

export class SessionClient {
  private client: SessionServiceClient;
  private signer: Signer;
  private endpoint: string;
  private timeout?: number;

  constructor(neofsClient: NeoFSClient, config: { signer: Signer; endpoint: string; timeout?: number }) {
    this.signer = config.signer;
    this.endpoint = config.endpoint;
    this.timeout = config.timeout;
    
    // Create gRPC client
    const credentials = config.endpoint.startsWith('grpcs://')
      ? grpc.credentials.createSsl()
      : grpc.credentials.createInsecure();

    this.client = new SessionServiceClient(
      config.endpoint.replace(/^grpcs?:\/\//, ''),
      credentials
    );
  }

  /**
   * Create a new session token.
   */
  async create(params: SessionCreateParams): Promise<SessionToken> {
    // Create session create request
    const request = new CreateRequest();
    
    // Set meta header
    const metaHeader = new NeoFsV2Session.RequestMetaHeader();
    const version = new NeoFsV2Refs.Version();
    version.Major = 2;
    version.Minor = 27;
    metaHeader.Version = version;
    metaHeader.Epoch = BigInt(0); // Use current epoch
    metaHeader.Ttl = 2;
    request.MetaHeader = metaHeader;

    // Set body
    const body = new CreateRequest_Body();
    const ownerIdProto = new NeoFsV2Refs.OwnerID();
    // Generate account ID from public key
    const pubKeyBytes = publicKeyBytes(this.signer.public());
    const accountId = this.generateNeoFSAccountId(pubKeyBytes);
    ownerIdProto.Value = accountId;
    body.OwnerId = ownerIdProto;
    body.Expiration = BigInt(params.expiration);
    request.Body = body;

    // Sign the request
    this.signRequest(request);

    // Make the gRPC call
    const response = await this.client.create(request, undefined, grpcCallOptions(this.timeout));

    // Parse response
    const responseBody = response.Body;
    if (!responseBody) {
      throw new Error('No response body received');
    }
    
    const id = new Uint8Array(responseBody.Id);
    const sessionKey = new Uint8Array(responseBody.SessionKey);

    // Create session token
    const sessionToken: SessionToken = {
      id: id,
      ownerId: accountId,
      lifetime: {
        exp: params.expiration,
        nbf: Number(response.MetaHeader?.Epoch || 0),
        iat: Number(response.MetaHeader?.Epoch || 0),
      },
      sessionKey: sessionKey,
    };

    return sessionToken;
  }

  close(): void {
    this.client.close();
  }

  /**
   * Prepare an object session token for a specific operation.
   */
  prepareObjectSessionToken(
    sessionToken: SessionToken,
    address: { containerId: ContainerID; objectId: ObjectID },
    verb: number
  ): SessionToken {
    // Create a copy of the session token
    const preparedToken: SessionToken = {
      ...sessionToken,
      context: {
        object: {
          verb,
          address,
        },
      },
    };

    // Sign the session token body
    this.signSessionToken(preparedToken);

    return preparedToken;
  }

  /**
   * Sign a session token.
   */
  private signSessionToken(sessionToken: SessionToken): void {
    // Create session token body
    const body = new NeoFsV2Session.SessionToken_Body();
    body.Id = sessionToken.id;
    
    const ownerIdProto = new NeoFsV2Refs.OwnerID();
    ownerIdProto.Value = sessionToken.ownerId;
    body.OwnerId = ownerIdProto;

    const lifetime = new NeoFsV2Session.SessionToken_Body_TokenLifetime();
    lifetime.Exp = BigInt(sessionToken.lifetime.exp);
    lifetime.Nbf = BigInt(sessionToken.lifetime.nbf);
    lifetime.Iat = BigInt(sessionToken.lifetime.iat);
    body.Lifetime = lifetime;

    body.SessionKey = sessionToken.sessionKey;

    // Set object context if provided
    if (sessionToken.context?.object) {
      const objectContext = new NeoFsV2Session.ObjectSessionContext();
      objectContext.Verb = sessionToken.context.object.verb;
      
      const target = new NeoFsV2Session.ObjectSessionContext_Target();
      const containerIdProto = new NeoFsV2Refs.ContainerID();
      containerIdProto.Value = sessionToken.context.object.address.containerId.value;
      target.Container = containerIdProto;
      
      const objectIdProto = new NeoFsV2Refs.ObjectID();
      objectIdProto.Value = sessionToken.context.object.address.objectId.value;
      target.Objects = [objectIdProto];
      
      objectContext.Target = target;
      body.Object = objectContext;
    }

    // Serialize the body
    const bodySerialized = body.serializeBinary();

    // Create signature
    const signatureBytes = this.signer.sign(bodySerialized);

    // Get public key bytes
    const pubKeyBytes = publicKeyBytes(this.signer.public());

    sessionToken.signature = {
      key: pubKeyBytes,
      sign: signatureBytes,
      scheme: this.signer.scheme(),
    };
  }

  /**
   * Sign a request.
   */
  private signRequest(request: any): void {
    if (!this.signer) return;
    signV26Request(request, this.signer);
  }

  /**
   * Generate NeoFS account ID from public key.
   */
  private generateNeoFSAccountId(pubKeyBytes: Uint8Array): Uint8Array {
    // Calculate CheckSig descriptor: SHA256("System.Crypto.CheckSig") as little-endian uint32
    const checkSigString = "System.Crypto.CheckSig";
    const checkSigHash = crypto.createHash('sha256').update(checkSigString).digest();
    const checkSigDescriptor = new Uint8Array(4);
    checkSigDescriptor[0] = checkSigHash[0];
    checkSigDescriptor[1] = checkSigHash[1];
    checkSigDescriptor[2] = checkSigHash[2];
    checkSigDescriptor[3] = checkSigHash[3];
    
    // Create signature redeem script (like C# implementation)
    const script = new Uint8Array(40); // 0x0c + 33 + 0x41 + 4
    script[0] = 0x0c; // PUSHDATA1
    script[1] = 33;   // Length of public key
    script.set(pubKeyBytes, 2);
    script[35] = 0x41; // SYSCALL
    script.set(checkSigDescriptor, 36); // CheckSig descriptor (4 bytes)
    
    // SHA256 hash the script
    const sha256Hash = crypto.createHash('sha256').update(script).digest();
    
    // RIPEMD160 hash the result
    const ripemd160 = new RIPEMD160();
    ripemd160.update(sha256Hash);
    const scriptHash = ripemd160.digest(); // 20 bytes
    
    // Create owner ID: version byte (0x35) + scriptHash + checksum
    const data = new Uint8Array(21);
    data[0] = 0x35; // Address version
    data.set(scriptHash, 1);
    
    // Calculate checksum: SHA256(SHA256(data))
    const checksumHash1 = crypto.createHash('sha256').update(data).digest();
    const checksumHash2 = crypto.createHash('sha256').update(checksumHash1).digest();
    const checksum = checksumHash2.slice(0, 4); // First 4 bytes
    
    // Combine: version + scriptHash + checksum = 25 bytes
    const ownerId = new Uint8Array(25);
    ownerId.set(data, 0);
    ownerId.set(checksum, 21);
    
    return ownerId;
  }
}
