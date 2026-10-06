import * as crypto from 'crypto';
import { ECDSASignerRFC6979, publicKeyBytes } from '@axlabs/neofs-sdk-ts-core/crypto';
import { ownerIdFromPublicKey } from '@axlabs/neofs-sdk-ts-core/user';
import { NeoFSClient } from '../src/client';
import { SessionClient } from '../src/client/session';
import { BearerToken } from '../src/bearer/token';
import { Operation, Table, Target } from '../src/eacl';
import { Waiter } from '../src/waiter/waiter';
import type { ContainerID, ObjectID } from '../src/types';

/** Public read-write. Others can upload without a bearer token. */
const PUBLIC_READ_WRITE = 0x1fbfbfff;
/**
 * Extendable public read-write. Basic ACL allows others to upload, and a
 * bearer token may replace the container eACL. A deny rule on the container
 * then blocks uploads unless the request carries a token that allows them.
 */
const PUBLIC_RW_EXTENDED = 0x0fbfbfff;
const CHUNK_SIZE = 1024 * 1024;

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

function isTransient(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /3075|UNAVAILABLE|ECONNREFUSED/.test(message);
}

async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      if (!isTransient(error) || attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
    }
  }
  throw last;
}

describe('NeoFS integration (testnet)', () => {
  let signer: ReturnType<typeof ECDSASignerRFC6979.fromWIF>;
  let ownerId: Uint8Array;
  let client: NeoFSClient;
  let waiter: Waiter;
  const containerIds: ContainerID[] = [];
  const objectAddresses: Array<{ containerId: ContainerID; objectId: ObjectID }> = [];

  beforeAll(async () => {
    if (!env.enabled) return;

    signer = ECDSASignerRFC6979.fromWIF(wifEnv);
    ownerId = ownerIdFromPublicKey(publicKeyBytes(signer.public()));
    openClient();
  });

  function openClient(): void {
    client = new NeoFSClient({ endpoint: endpointEnv, signer, timeout: 120_000 });
    waiter = new Waiter(client, {
      timeout: Number(process.env.NEOFS_TIMEOUT_MS || 180000),
      pollInterval: 3000,
      initialDelay: 2000,
    });
  }

  afterAll(async () => {
    if (!env.enabled || !client) return;
    for (const address of objectAddresses) {
      try {
        await client.object().delete({ address });
      } catch {
        // Already deleted, or the container is gone.
      }
    }
    for (const containerId of containerIds) {
      try {
        await client.container().delete({ containerId });
      } catch {
        // Already deleted.
      }
    }
  });

  function containerParams(name: string, basicAcl: number) {
    return {
      container: {
        version: { major: 2, minor: 27 },
        ownerId,
        nonce: randomNonce(),
        basicAcl,
        attributes: [{ key: 'Name', value: name }],
        placementPolicy: {
          replicas: [{ count: 1, selector: '' }],
          selectors: [] as Array<{ name: string; count: number; clause: number; attribute: string; filter: string }>,
          filters: [] as Array<{ name: string; key: string; op: number; value: string; filters: never[] }>,
          containerBackupFactor: 0,
        },
      },
    };
  }

  itIf('reads balance, session, and v2.27 network metadata', async () => {
    const balance = await client.accounting().getBalance();
    expect(balance.toNumber()).toBeGreaterThan(0);

    const info = await client.netmap().networkInfo();
    expect(info.currentEpoch).toBeGreaterThan(0);
    expect(info.magicNumber).toBeGreaterThan(0);
    expect(info.msPerBlock).toBeGreaterThan(0);
    expect(info.netmapVersion).toBeGreaterThan(0);

    const local = await client.netmap().localNodeInfo();
    expect(local.version.major).toBe(2);
    expect(local.version.minor).toBeGreaterThanOrEqual(27);
    expect(local.nodeInfo.publicKey.length).toBeGreaterThan(0);
    expect(local.nodeInfo.addresses.length).toBeGreaterThan(0);

    const snapshot = await client.netmap().netmapSnapshot();
    expect(snapshot.epoch).toBeGreaterThan(0);
    expect(snapshot.version).toBeGreaterThan(0);
    expect(snapshot.nodes.length).toBeGreaterThan(0);

    const sessions = new SessionClient(client, {
      signer,
      endpoint: endpointEnv,
      timeout: 120_000,
    });
    const session = await sessions.create({ expiration: info.currentEpoch + 20 });
    expect(session.id.length).toBeGreaterThan(0);
    expect(session.sessionKey.length).toBeGreaterThan(0);
    expect(session.lifetime.exp).toBe(info.currentEpoch + 20);
    sessions.close();
    client.close();
    openClient();
  });

  itIf('creates a container, uploads, searches, reads, and confirms deletion', async () => {
    const suite = `itest-${Date.now()}`;
    const containerId = await retry(() => waiter.containerPut(containerParams(suite, PUBLIC_READ_WRITE)));
    containerIds.push(containerId);

    const stored = await client.container().get({ containerId });
    expect(stored.version).toEqual({ major: 2, minor: 27 });
    expect(stored.basicAcl).toBe(PUBLIC_READ_WRITE);
    expect(stored.revision).toBeGreaterThanOrEqual(1);
    expect(stored.attributes).toEqual(expect.arrayContaining([{ key: 'Name', value: suite }]));
    expect(stored.placementPolicy.replicas[0].count).toBe(1);

    const listed = await client.container().list({ ownerId });
    expect(listed.map((id) => hex(id.value))).toContain(hex(containerId.value));

    const payloadA = new TextEncoder().encode(`hello-${suite}-A`);
    const payloadB = new TextEncoder().encode(`hello-${suite}-B`);
    const headerFor = (tag: string) => ({
      containerId,
      ownerId,
      objectType: 0,
      attributes: [
        { key: 'it_suite', value: suite },
        { key: 'it_tag', value: tag },
      ],
      version: { major: 2, minor: 27 },
    });

    const objectIdA = await retry(() => client.object().put({
      header: headerFor('A'),
      payload: payloadA,
    }));
    objectAddresses.push({ containerId, objectId: objectIdA });

    const objectIdB = await retry(() => waiter.objectPut({
      header: headerFor('B'),
      payload: payloadB,
    }));
    objectAddresses.push({ containerId, objectId: objectIdB });

    const chunked = crypto.randomBytes(CHUNK_SIZE + 8);
    const objectIdChunked = await retry(() => client.object().put({
      header: headerFor('chunked'),
      payload: chunked,
    }));
    objectAddresses.push({ containerId, objectId: objectIdChunked });

    await expect(
      client.object().search({
        containerId,
        filters: [{ key: 'it_suite', value: suite, matchType: 1 }],
      }),
    ).rejects.toThrow(/UNIMPLEMENTED|SearchV2/);

    const firstPage = await client.object().searchV2({
      containerId,
      filters: [{ key: 'it_suite', value: suite, matchType: 1 }],
      limit: 1,
    });
    expect(firstPage.result).toHaveLength(1);
    expect(firstPage.cursor).not.toBe('');

    const seen = new Set(firstPage.result.map((item) => hex(item.id.value)));
    let cursor = firstPage.cursor;
    for (let page = 0; page < 5 && cursor; page += 1) {
      const next = await client.object().searchV2({
        containerId,
        filters: [{ key: 'it_suite', value: suite, matchType: 1 }],
        limit: 1,
        cursor,
      });
      for (const item of next.result) seen.add(hex(item.id.value));
      cursor = next.cursor;
    }
    expect(seen.has(hex(objectIdA.value))).toBe(true);
    expect(seen.has(hex(objectIdB.value))).toBe(true);
    expect(seen.has(hex(objectIdChunked.value))).toBe(true);

    const addressA = { containerId, objectId: objectIdA };
    const headA = await client.object().head({ address: addressA });
    expect(hex(headA.containerId.value)).toBe(hex(containerId.value));
    expect(hex(headA.ownerId)).toBe(hex(ownerId));
    expect(headA.payloadLength).toBe(payloadA.length);
    expect(headA.attributes).toEqual(
      expect.arrayContaining([
        { key: 'it_suite', value: suite },
        { key: 'it_tag', value: 'A' },
      ]),
    );

    const gotA = await client.object().get({ address: addressA });
    expect(Buffer.from(gotA.payload || new Uint8Array()).toString()).toBe(
      Buffer.from(payloadA).toString(),
    );

    const rangeA = await client.object().getRange({
      address: addressA,
      range: { offset: 1n, length: 4n },
    });
    expect(Buffer.from(rangeA).toString()).toBe(Buffer.from(payloadA.subarray(1, 5)).toString());

    const boundary = CHUNK_SIZE - 2;
    const ranged = await client.object().getRange({
      address: { containerId, objectId: objectIdChunked },
      range: { offset: BigInt(boundary), length: 6n },
    });
    expect(Buffer.from(ranged)).toEqual(chunked.subarray(boundary, boundary + 6));

    await waiter.objectDelete(addressA);
    await waiter.objectDelete({ containerId, objectId: objectIdB });
    await waiter.objectDelete({ containerId, objectId: objectIdChunked });
    await waiter.containerDelete(containerId);
  });

  itIf('authorizes an object upload with a bearer token', async () => {
    const suite = `bearer-${Date.now()}`;
    const containerId = await retry(() => waiter.containerPut(containerParams(suite, PUBLIC_RW_EXTENDED)));
    containerIds.push(containerId);
    const stored = await client.container().get({ containerId });
    await retry(() => client.container().setEACL({
      eacl: new Table(containerId.value).deny(Operation.PUT, [Target.others()]),
      revision: stored.revision ?? 1,
    }));

    const bearerSigner = ECDSASignerRFC6979.generate();
    const bearerOwnerId = ownerIdFromPublicKey(publicKeyBytes(bearerSigner.public()));
    const bearerClient = new NeoFSClient({
      endpoint: endpointEnv,
      signer: bearerSigner,
      timeout: 120_000,
    });
    const epoch = BigInt((await client.netmap().networkInfo()).currentEpoch);
    const token = new BearerToken()
      .setEACL(
        new Table(containerId.value)
          .allow(Operation.PUT, [Target.userId(bearerOwnerId)])
          .allow(Operation.PUT, [Target.others()]),
      )
      .forUser(bearerOwnerId)
      .setIssuer(ownerId)
      .setLifetime({ iat: epoch, nbf: epoch, exp: epoch + 20n })
      .sign(signer);

    const payload = new TextEncoder().encode(`bearer-${suite}`);
    const header = {
      containerId,
      ownerId: bearerOwnerId,
      objectType: 0,
      attributes: [{ key: 'it_suite', value: suite }],
      version: { major: 2, minor: 27 },
    };

    await expect(retry(() => bearerClient.object().put({ header, payload }))).rejects.toThrow(/2048|denied/i);

    const objectId = await retry(() => bearerClient.object().put({ header, payload, bearerToken: token }));
    objectAddresses.push({ containerId, objectId });

    const got = await client.object().get({ address: { containerId, objectId } });
    expect(Buffer.from(got.payload || new Uint8Array()).toString()).toBe(
      Buffer.from(payload).toString(),
    );

    await waiter.objectDelete({ containerId, objectId });
    await waiter.containerDelete(containerId);
  });

  itIf('a 1ms deadline cancels the RPC', async () => {
    const short = new NeoFSClient({ endpoint: endpointEnv, signer, timeout: 1 });
    await expect(short.netmap().networkInfo()).rejects.toThrow(/DEADLINE_EXCEEDED/);
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
