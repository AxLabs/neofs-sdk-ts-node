/**
 * Waiter provides synchronous wrappers for asynchronous NeoFS operations.
 * 
 * After sending a request (like creating a container), NeoFS operations are
 * asynchronous - the data needs to propagate through the network. The waiter
 * polls the network until the operation is confirmed.
 */

import { NeoFSClient } from '../client';
import { ContainerID, ObjectID, Address } from '../types';
import { ContainerPutParams, Container } from '../client/container';
import { ObjectPutParams, ObjectHeader } from '../client/object';

/**
 * Default interval between confirmation checks (in milliseconds).
 */
export const DEFAULT_POLL_INTERVAL = 1000;

/**
 * Error thrown when a confirmation timeout occurs.
 * Note: This doesn't necessarily mean the operation failed - the request
 * was sent successfully, but confirmation timed out.
 */
export class ConfirmationTimeoutError extends Error {
  constructor(operation: string) {
    super(`Confirmation timeout for operation: ${operation}`);
    this.name = 'ConfirmationTimeoutError';
  }
}

/**
 * Options for waiter operations.
 */
export interface WaiterOptions {
  /**
   * Interval between confirmation checks in milliseconds.
   * @default 1000
   */
  pollInterval?: number;
  
  /**
   * Maximum time to wait for confirmation in milliseconds.
   * @default 30000
   */
  timeout?: number;
}

/**
 * Result from a poll check function.
 */
type PollResult = 
  | { status: 'success' }
  | { status: 'retry' }
  | { status: 'error'; error: Error };

/**
 * Internal poll function that repeatedly checks until success or timeout.
 * 
 * The check function should return:
 * - { status: 'success' } when the operation is confirmed
 * - { status: 'retry' } when we should keep polling (e.g., "not found" which is expected)
 * - { status: 'error', error } when a real error occurs that should stop polling
 */
async function poll(
  check: () => Promise<PollResult>,
  pollInterval: number,
  timeout: number,
  operation: string
): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const result = await check();
    
    switch (result.status) {
      case 'success':
        return;
      case 'error':
        throw result.error;
      case 'retry':
        // Wait before next check
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        break;
    }
  }
  
  throw new ConfirmationTimeoutError(operation);
}

/**
 * Checks if an error indicates "not found" status.
 * This is expected during propagation and should trigger a retry.
 */
function isNotFoundError(error: Error): boolean {
  const message = error.message.toLowerCase();
  // Container not found: code 3072
  // Object not found: code 2049
  return message.includes('code: 3072') || 
         message.includes('code: 2049') ||
         message.includes('not found');
}

/**
 * Waiter provides synchronous alternatives to asynchronous NeoFS operations.
 * 
 * Example:
 * ```typescript
 * const waiter = new Waiter(client);
 * 
 * // Create container and wait for it to be available
 * const containerId = await waiter.containerPut({ 
 *   container: {
 *     basicAcl: 0x1fbf8cff, 
 *     placementPolicy: { replicas: [{ count: 2, selector: '' }], ... },
 *     ...
 *   }
 * });
 * 
 * // Container is now confirmed to exist
 * const info = await client.container().get({ containerId });
 * ```
 */
export class Waiter {
  private client: NeoFSClient;
  private defaultPollInterval: number;
  private defaultTimeout: number;

  constructor(
    client: NeoFSClient,
    options?: WaiterOptions
  ) {
    this.client = client;
    this.defaultPollInterval = options?.pollInterval ?? DEFAULT_POLL_INTERVAL;
    this.defaultTimeout = options?.timeout ?? 30000;
  }

  /**
   * Set the default poll interval.
   */
  setPollInterval(interval: number): void {
    this.defaultPollInterval = interval;
  }

  /**
   * Set the default timeout.
   */
  setTimeout(timeout: number): void {
    this.defaultTimeout = timeout;
  }

  /**
   * Create a container and wait until it's confirmed to exist.
   * 
   * @param params - Container creation parameters
   * @param waiterOptions - Waiter-specific options
   * @returns The container ID once confirmed
   */
  async containerPut(
    params: ContainerPutParams,
    waiterOptions?: WaiterOptions
  ): Promise<ContainerID> {
    const containerId = await this.client.container().put(params);

    const pollInterval = waiterOptions?.pollInterval ?? this.defaultPollInterval;
    const timeout = waiterOptions?.timeout ?? this.defaultTimeout;

    await poll(
      async (): Promise<PollResult> => {
        try {
          const container = await this.client.container().get({ containerId });
          return container !== undefined 
            ? { status: 'success' } 
            : { status: 'retry' };
        } catch (error) {
          if (error instanceof Error && isNotFoundError(error)) {
            // Container not found - keep polling (expected during propagation)
            return { status: 'retry' };
          }
          // Real error - stop polling and report
          return { status: 'error', error: error as Error };
        }
      },
      pollInterval,
      timeout,
      'containerPut'
    );

    return containerId;
  }

  /**
   * Delete a container and wait until it's confirmed to be gone.
   * 
   * @param containerId - The container ID to delete
   * @param waiterOptions - Waiter-specific options
   */
  async containerDelete(
    containerId: ContainerID,
    waiterOptions?: WaiterOptions
  ): Promise<void> {
    await this.client.container().delete({ containerId });

    const pollInterval = waiterOptions?.pollInterval ?? this.defaultPollInterval;
    const timeout = waiterOptions?.timeout ?? this.defaultTimeout;

    await poll(
      async (): Promise<PollResult> => {
        try {
          const container = await this.client.container().get({ containerId });
          // Container still exists - keep polling
          return container === undefined 
            ? { status: 'success' } 
            : { status: 'retry' };
        } catch (error) {
          if (error instanceof Error && isNotFoundError(error)) {
            // Container not found - success!
            return { status: 'success' };
          }
          // Real error - stop polling and report
          return { status: 'error', error: error as Error };
        }
      },
      pollInterval,
      timeout,
      'containerDelete'
    );
  }

  /**
   * Upload an object and wait until it's confirmed to exist.
   * 
   * @param params - Object upload parameters
   * @param waiterOptions - Waiter-specific options
   * @returns The object ID once confirmed
   */
  async objectPut(
    params: ObjectPutParams,
    waiterOptions?: WaiterOptions
  ): Promise<ObjectID> {
    const objectId = await this.client.object().put(params);

    const pollInterval = waiterOptions?.pollInterval ?? this.defaultPollInterval;
    const timeout = waiterOptions?.timeout ?? this.defaultTimeout;

    const address: Address = {
      containerId: params.header.containerId,
      objectId,
    };

    await poll(
      async (): Promise<PollResult> => {
        try {
          // Try to HEAD the object to confirm it exists
          const header = await this.client.object().head({ address });
          return header !== undefined 
            ? { status: 'success' } 
            : { status: 'retry' };
        } catch (error) {
          if (error instanceof Error && isNotFoundError(error)) {
            // Object not found - keep polling (expected during propagation)
            return { status: 'retry' };
          }
          // Real error - stop polling and report
          return { status: 'error', error: error as Error };
        }
      },
      pollInterval,
      timeout,
      'objectPut'
    );

    return objectId;
  }

  /**
   * Delete an object and wait until it's confirmed to be gone.
   * 
   * @param address - The object address (containerId + objectId) to delete
   * @param waiterOptions - Waiter-specific options
   */
  async objectDelete(
    address: Address,
    waiterOptions?: WaiterOptions
  ): Promise<void> {
    await this.client.object().delete({ address });

    const pollInterval = waiterOptions?.pollInterval ?? this.defaultPollInterval;
    const timeout = waiterOptions?.timeout ?? this.defaultTimeout;

    await poll(
      async (): Promise<PollResult> => {
        try {
          const header = await this.client.object().head({ address });
          // Object still exists - keep polling
          return header === undefined 
            ? { status: 'success' } 
            : { status: 'retry' };
        } catch (error) {
          if (error instanceof Error && isNotFoundError(error)) {
            // Object not found - success!
            return { status: 'success' };
          }
          // Real error - stop polling and report
          return { status: 'error', error: error as Error };
        }
      },
      pollInterval,
      timeout,
      'objectDelete'
    );
  }
}
