import { Signer, publicKeyBytes } from '@axlabs/neofs-sdk-ts-core/crypto';
import { NeoFsV2Refs } from '../gen/refs/types_pb';
import { NeoFsV2Session } from '../gen/session/types_pb';

function encodeVarint(value: number): Uint8Array {
  const bytes: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value > 0) byte |= 0x80;
    bytes.push(byte);
  } while (value > 0);
  return Uint8Array.from(bytes);
}

function encodeMessageField(fieldNumber: number, message: Uint8Array): Uint8Array {
  const length = encodeVarint(message.length);
  const result = new Uint8Array(1 + length.length + message.length);
  result[0] = (fieldNumber << 3) | 2;
  result.set(length, 1);
  result.set(message, 1 + length.length);
  return result;
}

/**
 * Signs the protobuf request fields defined by NeoFS API v2.26:
 * field 1 (body) followed by field 2 (meta header), excluding field 3
 * (verification header).
 */
export function createRequestVerificationHeader(
  body: Uint8Array | { serializeBinary(): Uint8Array },
  metaHeader: NeoFsV2Session.RequestMetaHeader,
  signer: Signer,
): NeoFsV2Session.RequestVerificationHeader {
  const bodyBytes = body instanceof Uint8Array ? body : body.serializeBinary();
  const encodedMeta = encodeMessageField(2, metaHeader.serializeBinary());
  // Stable protobuf encoding omits a zero-length body field. Empty netmap
  // requests are signed over the meta header alone.
  let signedData: Uint8Array;
  if (bodyBytes.length === 0) {
    signedData = encodedMeta;
  } else {
    const encodedBody = encodeMessageField(1, bodyBytes);
    signedData = new Uint8Array(encodedBody.length + encodedMeta.length);
    signedData.set(encodedBody);
    signedData.set(encodedMeta, encodedBody.length);
  }

  const signature = new NeoFsV2Refs.Signature();
  signature.Key = publicKeyBytes(signer.public());
  signature.Sign = signer.sign(signedData);
  signature.Scheme = signer.scheme() as unknown as NeoFsV2Refs.SignatureScheme;

  const verifyHeader = new NeoFsV2Session.RequestVerificationHeader();
  verifyHeader.RequestSignature = signature;
  return verifyHeader;
}

export function signRequest(
  request: {
    Body?: { serializeBinary(): Uint8Array };
    MetaHeader?: NeoFsV2Session.RequestMetaHeader;
    VerifyHeader?: NeoFsV2Session.RequestVerificationHeader;
  },
  signer: Signer,
): void {
  if (!request.Body || !request.MetaHeader) {
    throw new Error('request body and meta header are required for signing');
  }
  request.VerifyHeader = createRequestVerificationHeader(request.Body, request.MetaHeader, signer);
}
