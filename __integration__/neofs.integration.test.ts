import * as crypto from 'crypto';
import { ECDSASignerRFC6979, publicKeyBytes } from '@axlabs/neofs-sdk-ts-core/crypto';
import { ownerIdFromPublicKey } from '@axlabs/neofs-sdk-ts-core/user';
import { NeoFSClient } from '../src/client';
import { Waiter } from '../src/waiter/waiter';
import type { ContainerID, ObjectID } from '../src/types';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

function randomNonce(): Uint8Array {
  const nonce = new Uint8Array(crypto.randomBytes(16));
  nonce[6] = (nonce[6] & 0x0f) | 0x40;
  nonce[8] = (nonce[8] & 0x3f) | 0x80;
  return nonce;
}

function hex(u8: Uint8Array): string {
  return Buffer.from(u8).toString('hex');
}

const endpointEnv = (process.env.NEOFS_ENDPOINT || '').trim();
const wifEnv = (process.env.NEOFS_WIF || '').trim();

function validateEnv(): { enabled: boolean; error: Error | null } {
  if (!endpointEnv || !wifEnv) return { enabled: false, error: null };
  try {
    ECDSASignerRFC6979.fromWIF(wifEnv);
    return { enabled: true, error: null };
  } catch (e: any) {
    return { enabled: false, error: new Error(`Invalid NEOFS_WIF: ${e?.message || String(e)}`) };
  }
}

const env = validateEnv();
const itIf = env.enabled ? it : it.skip;

describe('NeoFS integration (testnet)', () => {
  let endpoint: string;
  let signer: ReturnType<typeof ECDSASignerRFC6979.fromWIF>;
  let ownerId: Uint8Array;
  let client: NeoFSClient;
  let waiter: Waiter;

  beforeAll(() => {
    if (!env.enabled) return;

    endpoint = endpointEnv;
    signer = ECDSASignerRFC6979.fromWIF(wifEnv);
    ownerId = ownerIdFromPublicKey(publicKeyBytes(signer.public()));
    client = new NeoFSClient({ endpoint, signer });
    waiter = new Waiter(client, {
      timeout: Number(process.env.NEOFS_TIMEOUT_MS || 180000),
      pollInterval: 3000,
      initialDelay: 2000,
    });
  });

  let containerId: ContainerID;
  const createdObjectIds: ObjectID[] = [];

  itIf('creates container, puts objects, searchV2 + get/head/delete work', async () => {
    // Create container (wait until it is visible)
    containerId = await waiter.containerPut({
      container: {
        version: { major: 2, minor: 26 },
        ownerId,
        nonce: randomNonce(),
        basicAcl: 0x1fbfbfff, // public read-write (testnet convenience)
        attributes: [{ key: 'Name', value: `itest-${Date.now()}` }],
        placementPolicy: {
          replicas: [{ count: 1, selector: '' }],
          selectors: [],
          filters: [],
          containerBackupFactor: 0,
        },
      },
    });

    // Upload two objects with searchable attributes
    const payloadA = new TextEncoder().encode(`hello-${Date.now()}-A`);
    const payloadB = new TextEncoder().encode(`hello-${Date.now()}-B`);

    const objectIdA = await client.object().put({
      header: {
        containerId,
        ownerId,
        objectType: 0,
        attributes: [
          { key: 'it_suite', value: 'neofs-sdk-ts-node' },
          { key: 'it_tag', value: 'A' },
        ],
        version: { major: 2, minor: 26 },
      },
      payload: payloadA,
    });
    createdObjectIds.push(objectIdA);

    const objectIdB = await client.object().put({
      header: {
        containerId,
        ownerId,
        objectType: 0,
        attributes: [
          { key: 'it_suite', value: 'neofs-sdk-ts-node' },
          { key: 'it_tag', value: 'B' },
        ],
        version: { major: 2, minor: 26 },
      },
      payload: payloadB,
    });
    createdObjectIds.push(objectIdB);

    // SearchV2
    const resV2 = await client.object().searchV2({
      containerId,
      filters: [{ key: 'it_suite', value: 'neofs-sdk-ts-node', matchType: 1 }],
      limit: 100,
    });
    const v2Hexes = new Set(resV2.result.map((r) => hex(r.id.value)));
    expect(v2Hexes.has(hex(objectIdA.value))).toBe(true);
    expect(v2Hexes.has(hex(objectIdB.value))).toBe(true);

    // Head + Get for one object
    const addressA = { containerId, objectId: objectIdA };
    const headA = await client.object().head({ address: addressA });
    expect(hex(headA.containerId.value)).toBe(hex(containerId.value));

    const gotA = await client.object().get({ address: addressA });
    expect(Buffer.from(gotA.payload || new Uint8Array()).toString()).toBe(
      Buffer.from(payloadA).toString()
    );

    // Delete objects (best-effort; depends on network policy)
    for (const oid of createdObjectIds) {
      await client.object().delete({ address: { containerId, objectId: oid } });
    }
    await client.container().delete({ containerId });
  });

  it('configuration is provided via env vars', async () => {
    if (!env.enabled) {
      const msg =
        env.error?.message ||
        'Integration tests are skipped. Set NEOFS_ENDPOINT and NEOFS_WIF to enable.';
      expect(msg).toBeTruthy();
      return;
    }

    expect(endpointEnv).toBeTruthy();
    expect(wifEnv).toBeTruthy();
  });
});

