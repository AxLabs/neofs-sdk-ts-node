import { ECDSASignerRFC6979 } from '@axlabs/neofs-sdk-ts-core/crypto';

/** Fixed test key (32 bytes) so signatures are stable across runs. */
const DEFAULT_SK = new Uint8Array(32);
DEFAULT_SK[31] = 42;

export function createTestSigner(privateKeyBytes: Uint8Array = DEFAULT_SK): ReturnType<
  typeof ECDSASignerRFC6979.fromPrivateKeyBytes
> {
  return ECDSASignerRFC6979.fromPrivateKeyBytes(privateKeyBytes);
}
