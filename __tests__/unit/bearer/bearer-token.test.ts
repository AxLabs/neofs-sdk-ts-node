import { describe, expect, it } from 'vitest';
import { BearerToken } from '../../../src/bearer/token';
import { publicReadEACL } from '../../../src/eacl';
import { createTestSigner } from '../helpers/rfc6979-signer';

describe('BearerToken', () => {
  const cid = new Uint8Array(16).fill(2);
  const uid = new Uint8Array(25).fill(3);

  it('fluent setters and getters', () => {
    const t = new BearerToken()
      .setEACL(publicReadEACL(cid))
      .forUser(uid)
      .setIssuer(uid)
      .setLifetime({ exp: 10n, nbf: 1n, iat: 2n });
    expect(t.eaclTable).toBeDefined();
    expect(t.targetUser).toEqual(uid);
    expect(t.issuer).toEqual(uid);
    expect(t.lifetime).toEqual({ exp: 10n, nbf: 1n, iat: 2n });
    expect(t.isSigned).toBe(false);
  });

  it('setExpiration / setNotBefore / setIssuedAt initialize lifetime', () => {
    const t = new BearerToken().setExpiration(5n).setNotBefore(1n).setIssuedAt(2n);
    expect(t.lifetime).toEqual({ exp: 5n, nbf: 1n, iat: 2n });
  });

  it('sign sets signature and verify returns true', () => {
    const signer = createTestSigner();
    const t = new BearerToken().setEACL(publicReadEACL(cid)).sign(signer as any);
    expect(t.isSigned).toBe(true);
    expect(t.verify()).toBe(true);
  });

  it('serialize and deserialize roundtrip', () => {
    const signer = createTestSigner();
    const original = new BearerToken()
      .setEACL(publicReadEACL(cid))
      .forUser(uid)
      .setIssuer(uid)
      .setLifetime({ exp: 9n, nbf: 0n, iat: 0n })
      .sign(signer as any);

    const bytes = original.serialize();
    const restored = BearerToken.deserialize(bytes);
    expect(restored.targetUser).toEqual(uid);
    expect(restored.issuer).toEqual(uid);
    expect(restored.eaclTable?.records.length).toBe(original.eaclTable!.records.length);
    expect(restored.verify()).toBe(true);
  });

  it('verify false without signature', () => {
    expect(new BearerToken().verify()).toBe(false);
  });

  it('clone copies signed token', () => {
    const signer = createTestSigner();
    const a = new BearerToken()
      .setEACL(publicReadEACL(cid))
      .forUser(uid)
      .sign(signer as any);
    const b = a.clone();
    expect(b).not.toBe(a);
    expect(b.verify()).toBe(true);
    expect(b.eaclTable).not.toBe(a.eaclTable);
    expect(b.eaclTable?.records.length).toBe(a.eaclTable?.records.length);
  });
});
