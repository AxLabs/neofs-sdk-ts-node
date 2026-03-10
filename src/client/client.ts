import { Signer } from 'neofs-sdk-ts-core/crypto';
import { AccountingClient } from './accounting';
import { NetmapClient } from './netmap';
import { ContainerClient } from './container';
import { ObjectClient } from './object';

/**
 * Configuration for the NeoFS client.
 */
export interface ClientConfig {
  /** gRPC endpoint URL */
  endpoint: string;
  /** Signer for authentication */
  signer: Signer;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Additional headers */
  headers?: Record<string, string>;
}

/**
 * Main NeoFS client class.
 */
export class NeoFSClient {
  private config: ClientConfig;
  private accountingClient: AccountingClient;
  private netmapClient: NetmapClient;
  private containerClient: ContainerClient;
  private objectClient: ObjectClient;

  constructor(config: ClientConfig) {
    this.config = {
      timeout: 30000, // 30 seconds default
      ...config,
    };
    this.accountingClient = new AccountingClient(this.config);
    this.netmapClient = new NetmapClient(this.config);
    this.containerClient = new ContainerClient(this.config);
    this.objectClient = new ObjectClient(this, { signer: this.config.signer, endpoint: this.config.endpoint });
  }

  /**
   * Get the accounting client for balance operations.
   */
  accounting(): AccountingClient {
    return this.accountingClient;
  }

  /**
   * Get the netmap client for network operations.
   */
  netmap(): NetmapClient {
    return this.netmapClient;
  }

  /**
   * Get the container client for container operations.
   */
  container(): ContainerClient {
    return this.containerClient;
  }

  /**
   * Get the object client for object operations.
   */
  object(): ObjectClient {
    return this.objectClient;
  }

  /**
   * Get the current configuration.
   */
  getConfig(): ClientConfig {
    return { ...this.config };
  }

  /**
   * Update the client configuration.
   */
  updateConfig(config: Partial<ClientConfig>): void {
    this.config = { ...this.config, ...config };
    this.accountingClient = new AccountingClient(this.config);
    this.netmapClient = new NetmapClient(this.config);
    this.containerClient = new ContainerClient(this.config);
    this.objectClient = new ObjectClient(this, { signer: this.config.signer, endpoint: this.config.endpoint });
  }
}
