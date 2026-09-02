import { describe, expect, it, vi } from 'vitest';
import { ECDSASignerRFC6979 } from '@axlabs/neofs-sdk-ts-core/crypto';
import { BalanceRequest, BalanceRequest_Body } from '../../../src/gen/accounting/service_pb';
import { NeoFsV2Refs } from '../../../src/gen/refs/types_pb';
import { NeoFsV2Session } from '../../../src/gen/session/types_pb';
import { signRequest } from '../../../src/client/request-signing';

describe('request signing', () => {
  it('signs body and meta request fields with one v2.26 signature', () => {
    const signer = ECDSASignerRFC6979.generate();
    const body = new BalanceRequest_Body();
    body.OwnerId = new NeoFsV2Refs.OwnerID({ Value: Uint8Array.from([1, 2, 3]) });

    const version = new NeoFsV2Refs.Version({ Major: 2, Minor: 26 });
    const metaHeader = new NeoFsV2Session.RequestMetaHeader({ Version: version, Ttl: 2 });
    const request = new BalanceRequest({ Body: body, MetaHeader: metaHeader });
    const unsignedRequest = request.serializeBinary();
    const originalSign = signer.sign.bind(signer);
    let signedData = new Uint8Array();
    vi.spyOn(signer, 'sign').mockImplementation(data => {
      signedData = data;
      return originalSign(data);
    });

    signRequest(request, signer);

    expect(request.VerifyHeader?.RequestSignature).toBeDefined();
    expect(request.VerifyHeader?.BodySignature).toBeUndefined();
    expect(request.VerifyHeader?.MetaSignature).toBeUndefined();
    expect(request.VerifyHeader?.OriginSignature).toBeUndefined();

    expect(signedData).toEqual(unsignedRequest);
  });
});
