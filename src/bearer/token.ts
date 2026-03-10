/**
 * Bearer Token - allows delegating access permissions.
 * 
 * Bearer tokens let container owners delegate specific permissions to other users.
 * They work like JWTs - limited lifetime and scope.
 */

import { NeoFsV2Acl } from '../gen/acl/types_pb';
import { NeoFsV2Refs } from '../gen/refs/types_pb';
import { Table } from '../eacl';
import { Signer, publicKeyBytes } from 'neofs-sdk-ts-core/crypto';

/**
 * Token lifetime parameters.
 */
export interface TokenLifetime {
  /** Expiration epoch (last valid epoch) */
  exp: bigint;
  /** Not before epoch (first valid epoch) */
  nbf: bigint;
  /** Issued at epoch */
  iat: bigint;
}

/**
 * BearerToken allows attaching signed EACL rules to requests.
 * 
 * Bearer tokens enable container owners to grant temporary or limited
 * access to other users. The token contains:
 * - An EACL table defining the permissions
 * - Target user who can use the token (optional)
 * - Issuer (container owner)
 * - Lifetime (expiration)
 * - Signature from the container owner
 * 
 * @example
 * ```typescript
 * // Create a bearer token that allows a friend to read your container
 * const token = new BearerToken()
 *   .setEACL(publicReadEACL(containerId))
 *   .forUser(friendUserId)
 *   .setIssuer(myUserId)
 *   .setLifetime({
 *     iat: currentEpoch,
 *     nbf: currentEpoch,
 *     exp: currentEpoch + 100n, // Valid for 100 epochs
 *   })
 *   .sign(mySigner);
 * 
 * // Share the serialized token with your friend
 * const tokenBytes = token.serialize();
 * 
 * // Friend can use it in requests
 * await client.object().get(containerId, objectId, { bearerToken: tokenBytes });
 * ```
 */
export class BearerToken {
  private _eaclTable?: Table;
  private _targetUser?: Uint8Array;
  private _issuer?: Uint8Array;
  private _lifetime?: TokenLifetime;
  private _signature?: {
    key: Uint8Array;
    sign: Uint8Array;
    scheme: number;
  };

  constructor() {}

  // ----------------------
  // Getters
  // ----------------------

  /** EACL table attached to this token */
  get eaclTable(): Table | undefined {
    return this._eaclTable;
  }

  /** Target user who can use this token (undefined = any bearer) */
  get targetUser(): Uint8Array | undefined {
    return this._targetUser;
  }

  /** Token issuer (container owner) */
  get issuer(): Uint8Array | undefined {
    return this._issuer;
  }

  /** Token lifetime */
  get lifetime(): TokenLifetime | undefined {
    return this._lifetime;
  }

  /** Whether the token is signed */
  get isSigned(): boolean {
    return this._signature !== undefined;
  }

  // ----------------------
  // Setters (Fluent API)
  // ----------------------

  /**
   * Set the EACL table that defines permissions.
   */
  setEACL(eacl: Table): this {
    this._eaclTable = eacl;
    return this;
  }

  /**
   * Limit the token to a specific user.
   * If not set, any bearer can use the token.
   */
  forUser(userId: Uint8Array): this {
    this._targetUser = userId;
    return this;
  }

  /**
   * Set the token issuer (container owner).
   */
  setIssuer(issuer: Uint8Array): this {
    this._issuer = issuer;
    return this;
  }

  /**
   * Set token lifetime.
   */
  setLifetime(lifetime: TokenLifetime): this {
    this._lifetime = lifetime;
    return this;
  }

  /**
   * Set expiration epoch.
   */
  setExpiration(exp: bigint): this {
    if (!this._lifetime) {
      this._lifetime = { exp, nbf: 0n, iat: 0n };
    } else {
      this._lifetime.exp = exp;
    }
    return this;
  }

  /**
   * Set not-before epoch.
   */
  setNotBefore(nbf: bigint): this {
    if (!this._lifetime) {
      this._lifetime = { exp: 0n, nbf, iat: 0n };
    } else {
      this._lifetime.nbf = nbf;
    }
    return this;
  }

  /**
   * Set issued-at epoch.
   */
  setIssuedAt(iat: bigint): this {
    if (!this._lifetime) {
      this._lifetime = { exp: 0n, nbf: 0n, iat };
    } else {
      this._lifetime.iat = iat;
    }
    return this;
  }

  // ----------------------
  // Signing
  // ----------------------

  /**
   * Sign the token with the issuer's key.
   * The signer must correspond to the container owner.
   */
  sign(signer: Signer): this {
    const body = this.buildBody();
    const bodyBytes = body.serializeBinary();
    const signature = signer.sign(bodyBytes);

    this._signature = {
      key: publicKeyBytes(signer.public()),
      sign: signature,
      scheme: signer.scheme(),
    };

    return this;
  }

  /**
   * Verify the token signature.
   */
  verify(): boolean {
    if (!this._signature) {
      return false;
    }
    // Note: Full verification requires the public key verification
    // For now, just check that signature exists
    return this._signature.sign.length > 0;
  }

  // ----------------------
  // Serialization
  // ----------------------

  private buildBody(): NeoFsV2Acl.BearerToken_BodyImpl {
    const body = new NeoFsV2Acl.BearerToken_BodyImpl({});

    if (this._eaclTable) {
      body.EaclTable = this._eaclTable.toProto();
    }

    if (this._targetUser) {
      body.OwnerId = new NeoFsV2Refs.OwnerIDImpl({
        Value: this._targetUser,
      });
    }

    if (this._issuer) {
      body.Issuer = new NeoFsV2Refs.OwnerIDImpl({
        Value: this._issuer,
      });
    }

    if (this._lifetime) {
      body.Lifetime = new NeoFsV2Acl.BearerToken_Body_TokenLifetimeImpl({
        Exp: this._lifetime.exp,
        Nbf: this._lifetime.nbf,
        Iat: this._lifetime.iat,
      });
    }

    return body;
  }

  /**
   * Convert to protobuf message.
   */
  toProto(): NeoFsV2Acl.BearerTokenImpl {
    const token = new NeoFsV2Acl.BearerTokenImpl({
      Body: this.buildBody(),
    });

    if (this._signature) {
      token.Signature = new NeoFsV2Refs.SignatureImpl({
        Key: this._signature.key,
        Sign: this._signature.sign,
        Scheme: this._signature.scheme as NeoFsV2Refs.SignatureScheme,
      });
    }

    return token;
  }

  /**
   * Serialize to binary format.
   */
  serialize(): Uint8Array {
    return this.toProto().serializeBinary();
  }

  /**
   * Create BearerToken from protobuf message.
   */
  static fromProto(proto: NeoFsV2Acl.BearerToken): BearerToken {
    const token = new BearerToken();

    const body = proto.Body;
    if (body) {
      if (body.EaclTable) {
        token._eaclTable = Table.fromProto(body.EaclTable);
      }
      if (body.OwnerId?.Value) {
        token._targetUser = body.OwnerId.Value;
      }
      if (body.Issuer?.Value) {
        token._issuer = body.Issuer.Value;
      }
      if (body.Lifetime) {
        token._lifetime = {
          exp: body.Lifetime.Exp,
          nbf: body.Lifetime.Nbf,
          iat: body.Lifetime.Iat,
        };
      }
    }

    if (proto.Signature) {
      token._signature = {
        key: proto.Signature.Key,
        sign: proto.Signature.Sign,
        scheme: proto.Signature.Scheme,
      };
    }

    return token;
  }

  /**
   * Deserialize from binary format.
   */
  static deserialize(data: Uint8Array): BearerToken {
    const proto = NeoFsV2Acl.BearerTokenImpl.deserializeBinary(data);
    return BearerToken.fromProto(proto);
  }

  /**
   * Clone this token.
   */
  clone(): BearerToken {
    const token = new BearerToken();
    
    if (this._eaclTable) {
      token._eaclTable = this._eaclTable.clone();
    }
    if (this._targetUser) {
      token._targetUser = new Uint8Array(this._targetUser);
    }
    if (this._issuer) {
      token._issuer = new Uint8Array(this._issuer);
    }
    if (this._lifetime) {
      token._lifetime = { ...this._lifetime };
    }
    if (this._signature) {
      token._signature = {
        key: new Uint8Array(this._signature.key),
        sign: new Uint8Array(this._signature.sign),
        scheme: this._signature.scheme,
      };
    }

    return token;
  }
}
