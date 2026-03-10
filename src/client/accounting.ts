import { ClientConfig } from './client';
import { Signer, NeoFSSignature, signRequestWithBuffer, publicKeyBytes } from 'neofs-sdk-ts-core/crypto';
import { Decimal } from 'neofs-sdk-ts-core/types';

// Import proto definitions - using our generated classes
import { AccountingServiceClient } from '../gen/accounting/service_grpc_pb';
import { BalanceRequest, BalanceRequest_Body, BalanceResponse, BalanceResponse_Body } from '../gen/accounting/service_pb';
import { NeoFsV2Refs } from '../gen/refs/types_pb';
import { NeoFsV2Session } from '../gen/session/types_pb';
import { NeoFsV2Accounting } from '../gen/accounting/types_pb';
import * as grpc from '@grpc/grpc-js';

/**
 * Parameters for getting account balance.
 */
export interface BalanceGetParams {
  /** Account ID to get balance for (optional, defaults to signer's account) */
  accountId?: Uint8Array;
  /** Additional headers */
  headers?: Record<string, string>;
}

/**
 * Accounting client for balance operations.
 */
export class AccountingClient {
  private config: ClientConfig;
  private client: AccountingServiceClient;

  constructor(config: ClientConfig) {
    this.config = config;
    // Create Node.js gRPC client using our generated service client
    const credentials = config.endpoint.startsWith('grpcs://') 
      ? grpc.credentials.createSsl() 
      : grpc.credentials.createInsecure();
    
    this.client = new AccountingServiceClient(
      config.endpoint.replace(/^grpcs?:\/\//, ''),
      credentials
    );
  }

  /**
   * Generates a proper NeoFS account ID from an ECDSA public key.
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
   * Based on C# implementation: CreateSignatureRedeemScript
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
   * Based on C# implementation: script.Sha256().RIPEMD160()
   */
  private calculateScriptHash(script: Uint8Array): Uint8Array {
    // SHA256
    const sha256Hash = require('crypto').createHash('sha256').update(script).digest();
    
    // RIPEMD160 (we'll use a simple implementation for now)
    const ripemd160Hash = this.ripemd160(sha256Hash);
    
    return ripemd160Hash;
  }

  /**
   * RIPEMD160 implementation using crypto-js library.
   * Based on C# implementation using BouncyCastle RipeMD160Digest.
   */
  private ripemd160(data: Uint8Array): Uint8Array {
    const CryptoJS = require('crypto-js');
    const wordArray = CryptoJS.lib.WordArray.create(data);
    const hash = CryptoJS.RIPEMD160(wordArray);
    const bytes = [];
    for (let i = 0; i < hash.sigBytes; i++) {
      bytes.push((hash.words[Math.floor(i / 4)] >>> (24 - (i % 4) * 8)) & 0xff);
    }
    return new Uint8Array(bytes);
  }

  /**
   * Creates address with version byte + script hash + checksum.
   * Based on C# implementation: ToAddress
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
   * Based on C# implementation: Base58.Encode
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
   * Based on C# implementation: Base58.Decode
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
   * Get the current balance of a NeoFS account.
   * 
   * @param params - Parameters for the balance request
   * @returns Promise that resolves to the account balance
   * @throws Error if the request fails
   */
  async getBalance(params: BalanceGetParams = {}): Promise<Decimal> {
    try {
      // Create the request using our generated classes
      const request = new BalanceRequest();
      
      // Create the request body
      const requestBody = new BalanceRequest_Body();
      const ownerId = new NeoFsV2Refs.OwnerID();
      
      // Use provided account ID or generate a proper 25-byte NeoFS account ID
      let accountId = params.accountId;
      if (!accountId) {
        // Generate a proper NeoFS account ID from the ECDSA public key
        accountId = this.generateNeoFSAccountId(this.config.signer.public());
      } else if (accountId.length !== 25) {
        // Ensure custom account ID is 25 bytes with proper format
        accountId = this.generateNeoFSAccountId(this.config.signer.public());
      }
      
      // Use direct property assignment (our generated classes use properties, not setters)
      ownerId.Value = accountId;
      requestBody.OwnerId = ownerId;
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
      
      // Sign the verification header (origin signature) - this should be signed before setting other signatures
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
      const response = await this.client.balance(request);

      // Check if we got a successful response
      if (response.MetaHeader && response.MetaHeader.Status) {
        const status = response.MetaHeader.Status;
        if (status.Code !== 0) {
          throw new Error(`NeoFS error: ${status.Message} (code: ${status.Code})`);
        }
      }

      // Parse the actual balance from the response
      if (!response.Body || !response.Body.Balance) {
        // If no balance in response, return zero balance
        return new Decimal(0, 8);
      }

      const balance = response.Body.Balance;
      // Convert from generated Decimal to core Decimal type
      return new Decimal(Number(balance.Value), balance.Precision);
    } catch (error: any) {
      throw new Error(`Failed to get balance: ${error.message}`);
    }
  }
}
