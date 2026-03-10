/**
 * Waiter module for synchronous NeoFS operations.
 * 
 * NeoFS operations are asynchronous by nature - after sending a request,
 * data needs to propagate through the network. The Waiter class provides
 * convenience methods that poll until operations are confirmed.
 * 
 * @example
 * ```typescript
 * import { NeoFSClient, Waiter } from 'neofs-sdk-ts-node';
 * 
 * const client = new NeoFSClient({ endpoint, signer });
 * const waiter = new Waiter(client);
 * 
 * // Create container and wait for confirmation
 * const containerId = await waiter.containerPut({
 *   basicAcl: 0x1fbf8cff,
 *   placementPolicy: { replicas: [{ count: 2 }] }
 * });
 * 
 * // Upload object and wait for confirmation
 * const objectId = await waiter.objectPut({
 *   containerId,
 *   payload: Buffer.from('Hello, NeoFS!'),
 *   attributes: { 'Content-Type': 'text/plain' }
 * });
 * 
 * console.log('Object confirmed:', objectId);
 * ```
 */

export { Waiter, WaiterOptions, ConfirmationTimeoutError, DEFAULT_POLL_INTERVAL } from './waiter';
