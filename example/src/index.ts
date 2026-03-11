#!/usr/bin/env node
/**
 * NeoFS SDK Example for Node.js
 * Demonstrates basic NeoFS operations
 */

import * as readline from 'readline';
import {
  NeoFSClient,
  type ClientConfig,
  type NetworkInfo,
  type Container,
  type ContainerID,
  type ObjectHeader,
  type ObjectID,
  type Address,
  type ObjectGetResult,
} from 'neofs-sdk-ts-node';
import {
  ECDSASignerRFC6979,
  type Signer,
  publicKeyBytes,
} from '@axlabs/neofs-sdk-ts-core/crypto';
import { ownerIdFromPublicKey } from '@axlabs/neofs-sdk-ts-core/user';
import { Decimal } from '@axlabs/neofs-sdk-ts-core/types';
import * as crypto from 'crypto';

// Helper to convert bytes to hex
const bytesToHex = (bytes: Uint8Array): string => {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
};

// Helper to convert hex to bytes
const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
};

// Helper to convert string to bytes
const stringToBytes = (str: string): Uint8Array => {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i);
  }
  return bytes;
};

// Helper to convert bytes to string
const bytesToString = (bytes: Uint8Array): string => {
  return String.fromCharCode(...bytes);
};

// Logging utilities
const log = {
  info: (msg: string) => console.log(`[INFO] ${msg}`),
  success: (msg: string) => console.log(`[✓] ${msg}`),
  error: (msg: string) => console.error(`[✗] ${msg}`),
  warn: (msg: string) => console.warn(`[!] ${msg}`),
  debug: (msg: string) => console.log(`[DEBUG] ${msg}`),
};

// Application state
interface AppState {
  client: NeoFSClient | null;
  signer: Signer | null;
  endpoint: string;
  networkInfo: NetworkInfo | null;
  balance: Decimal | null;
  containerIds: ContainerID[];
  containers: Map<string, Container>; // Map containerId hex to Container
  selectedContainerId: ContainerID | null;
  selectedContainer: Container | null;
  objectIds: ObjectID[];
  objects: Map<string, ObjectHeader>; // Map objectId hex to ObjectHeader
}

const state: AppState = {
  client: null,
  signer: null,
  endpoint: 'grpc://st1.t5.fs.neo.org:8080',
  networkInfo: null,
  balance: null,
  containerIds: [],
  containers: new Map(),
  selectedContainerId: null,
  selectedContainer: null,
  objectIds: [],
  objects: new Map(),
};

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Helper to prompt for input
const question = (query: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
};

// Helper to prompt for password (WIF)
// Note: For simplicity, we'll just use regular input (not hidden)
// In a production app, you'd want to use a proper password input library
const questionPassword = (query: string): Promise<string> => {
  return question(query);
};

// Menu functions
async function showMainMenu() {
  console.log('\n' + '='.repeat(60));
  console.log('NeoFS SDK Node.js Example');
  console.log('='.repeat(60));
  console.log('1. Key Management');
  console.log('2. Connection');
  console.log('3. Network Operations');
  console.log('4. Container Operations');
  console.log('5. Object Operations');
  console.log('0. Exit');
  console.log('='.repeat(60));
  
  const choice = await question('\nSelect an option: ');
  return choice.trim();
}

async function keyManagementMenu() {
  console.log('\n--- Key Management ---');
  console.log('1. Load WIF');
  console.log('2. Generate New Key');
  console.log('3. Show Public Key');
  console.log('0. Back');
  
  const choice = await question('\nSelect an option: ');
  
  switch (choice.trim()) {
    case '1': {
      const wif = await questionPassword('Enter WIF private key: ');
      if (!wif.trim()) {
        log.error('WIF cannot be empty');
        break;
      }
      
      try {
        const signer = ECDSASignerRFC6979.fromWIF(wif.trim());
        state.signer = signer;
        const pubKey = signer.getPublicKey();
        log.success('Signer loaded from WIF');
        log.info(`Public key: ${bytesToHex(pubKey).substring(0, 32)}...`);
      } catch (error) {
        log.error(`Failed to load WIF: ${error}`);
      }
      break;
    }
    case '2': {
      try {
        const signer = ECDSASignerRFC6979.generate();
        state.signer = signer;
        const pubKey = signer.getPublicKey();
        log.success('New key pair generated');
        log.info(`Public key: ${bytesToHex(pubKey).substring(0, 32)}...`);
        log.warn('This is a random key - save it if you want to keep it!');
      } catch (error) {
        log.error(`Failed to generate key: ${error}`);
      }
      break;
    }
    case '3': {
      if (state.signer) {
        const pubKey = state.signer.getPublicKey();
        log.info(`Public key: ${bytesToHex(pubKey)}`);
        const ownerId = ownerIdFromPublicKey(publicKeyBytes(state.signer.public()));
        log.info(`Owner ID: ${bytesToHex(ownerId)}`);
      } else {
        log.error('No signer loaded');
      }
      break;
    }
  }
}

async function connectionMenu() {
  console.log('\n--- Connection ---');
  console.log(`Current endpoint: ${state.endpoint}`);
  console.log(`Status: ${state.client ? 'Connected' : 'Disconnected'}`);
  console.log('1. Connect');
  console.log('2. Disconnect');
  console.log('3. Change Endpoint');
  console.log('0. Back');
  
  const choice = await question('\nSelect an option: ');
  
  switch (choice.trim()) {
    case '1': {
      if (!state.signer) {
        log.error('Please load or generate a key first');
        return;
      }
      
      if (state.client) {
        log.warn('Already connected');
        return;
      }
      
      try {
        log.info(`Connecting to ${state.endpoint}...`);
        
        const config: ClientConfig = {
          endpoint: state.endpoint,
          signer: state.signer,
        };
        
        const client = new NeoFSClient(config);
        state.client = client;
        
        log.success('Connected successfully!');
      } catch (error) {
        log.error(`Connection failed: ${error}`);
        state.client = null;
      }
      break;
    }
    case '2': {
      if (state.client) {
        state.client = null;
        state.networkInfo = null;
        state.balance = null;
        state.containers = new Map();
        state.selectedContainer = null;
        state.objects = new Map();
        log.info('Disconnected');
      } else {
        log.warn('Not connected');
      }
      break;
    }
    case '3': {
      const endpoint = await question('Enter new endpoint (e.g., grpc://st1.t5.fs.neo.org:8080): ');
      if (endpoint.trim()) {
        state.endpoint = endpoint.trim();
        log.info(`Endpoint set to: ${state.endpoint}`);
        if (state.client) {
          log.warn('You need to reconnect for the change to take effect');
        }
      }
      break;
    }
  }
}

async function networkOperationsMenu() {
  if (!state.client) {
    log.error('Not connected. Please connect first.');
    return;
  }
  
  console.log('\n--- Network Operations ---');
  console.log('1. Get Network Info');
  console.log('2. Get Balance');
  console.log('3. Get Local Node Info');
  console.log('0. Back');
  
  const choice = await question('\nSelect an option: ');
  
  switch (choice.trim()) {
    case '1': {
      try {
        log.info('Fetching network info...');
        const info = await state.client.netmap().networkInfo();
        state.networkInfo = info;
        log.success(`Current epoch: ${info.currentEpoch}`);
        log.info(`Magic number: ${info.magicNumber}`);
        log.info(`Ms per block: ${info.msPerBlock}`);
        log.info(`Config entries: ${info.networkConfig.parameters.length || 0}`);
      } catch (error) {
        log.error(`Failed to get network info: ${error}`);
      }
      break;
    }
    case '2': {
      try {
        log.info('Fetching balance...');
        const balance = await state.client.accounting().getBalance();
        state.balance = balance;
        log.success(`Balance: ${balance.toString()} (precision: ${balance.getPrecision()})`);
      } catch (error) {
        log.error(`Failed to get balance: ${error}`);
      }
      break;
    }
    case '3': {
      try {
        log.info('Fetching local node info...');
        const nodeInfo = await state.client.netmap().localNodeInfo();
        log.success(`Node version: ${nodeInfo.version.major}.${nodeInfo.version.minor}`);
        log.info(`Addresses: ${nodeInfo.nodeInfo.addresses.join(', ') || 'none'}`);
        const stateStr = ['UNSPECIFIED', 'ONLINE', 'OFFLINE', 'MAINTENANCE'][nodeInfo.nodeInfo.state] || 'UNKNOWN';
        log.info(`State: ${stateStr}`);
        
        nodeInfo.nodeInfo.attributes.slice(0, 5).forEach(attr => {
          log.info(`  ${attr.key}: ${attr.value}`);
        });
      } catch (error) {
        log.error(`Failed to get local node: ${error}`);
      }
      break;
    }
  }
}

async function containerOperationsMenu() {
  if (!state.client) {
    log.error('Not connected. Please connect first.');
    return;
  }
  
  console.log('\n--- Container Operations ---');
  console.log('1. List Containers');
  console.log('2. Create Container');
  console.log('3. Get Container Info');
  console.log('4. Delete Container');
  console.log('5. Select Container');
  if (state.selectedContainerId) {
    const nameAttr = state.selectedContainer?.attributes.find(a => a.key === 'Name');
    console.log(`Selected: ${nameAttr?.value || 'Unnamed'} (${bytesToHex(state.selectedContainerId.value).substring(0, 16)}...)`);
  }
  console.log('0. Back');
  
  const choice = await question('\nSelect an option: ');
  
  switch (choice.trim()) {
    case '1': {
      try {
        log.info('Listing containers...');
        const containerIds = await state.client.container().list();
        state.containerIds = containerIds;
        state.containers.clear();
        
        if (containerIds.length === 0) {
          log.info('No containers found');
        } else {
          log.success(`Found ${containerIds.length} containers`);
          // Fetch info for each container
          for (let i = 0; i < containerIds.length; i++) {
            try {
              const container = await state.client.container().get({
                containerId: containerIds[i],
              });
              const containerIdHex = bytesToHex(containerIds[i].value);
              state.containers.set(containerIdHex, container);
              const nameAttr = container.attributes.find(a => a.key === 'Name');
              const name = nameAttr?.value || 'Unnamed';
              const acl = container.basicAcl ? `0x${container.basicAcl.toString(16)}` : 'N/A';
              log.info(`  ${i + 1}. ${name} (ACL: ${acl})`);
            } catch (err) {
              log.warn(`  ${i + 1}. Failed to get info for container ${bytesToHex(containerIds[i].value).substring(0, 16)}...`);
            }
          }
        }
      } catch (error) {
        log.error(`Failed to list containers: ${error}`);
      }
      break;
    }
    case '2': {
      const name = await question('Container name (or press Enter for auto-generated): ');
      const containerName = name.trim() || `test-container-${Date.now()}`;
      
      try {
        log.info(`Creating container "${containerName}"...`);
        
        // Generate owner ID from signer
        const ownerId = ownerIdFromPublicKey(publicKeyBytes(state.signer!.public()));
        
        // Generate nonce
        const nonce = crypto.randomBytes(16);
        
        // Create container object
        const container: Container = {
          version: { major: 2, minor: 18 },
          ownerId,
          nonce,
          basicAcl: 0x1FBFBFFF, // PRIVATE
          attributes: [
            { key: 'Name', value: containerName },
          ],
          placementPolicy: {
            replicas: [
              { count: 2, selector: 'REP 2' },
            ],
            selectors: [],
            filters: [],
            containerBackupFactor: 0,
          },
        };
        
        const containerId = await state.client.container().put({
          container,
        });
        
        log.success('Container created!');
        log.info(`Container ID: ${bytesToHex(containerId.value).substring(0, 32)}...`);
        
        // Refresh container list
        const containerIds = await state.client.container().list();
        state.containerIds = containerIds;
        const containerIdHex = bytesToHex(containerId.value);
        state.containers.set(containerIdHex, container);
      } catch (error) {
        log.error(`Failed to create container: ${error}`);
      }
      break;
    }
    case '3': {
      if (state.containerIds.length === 0) {
        log.error('No containers available. List containers first.');
        break;
      }
      
      const indexStr = await question(`Enter container number (1-${state.containerIds.length}): `);
      const index = parseInt(indexStr.trim(), 10) - 1;
      
      if (index < 0 || index >= state.containerIds.length) {
        log.error('Invalid container number');
        break;
      }
      
      const containerId = state.containerIds[index];
      
      try {
        log.info('Fetching container info...');
        const info = await state.client.container().get({
          containerId,
        });
        
        if (info) {
          log.success('Container info retrieved');
          const nameAttr = info.attributes.find(a => a.key === 'Name');
          log.info(`Name: ${nameAttr?.value || 'Unnamed'}`);
          log.info(`Basic ACL: 0x${info.basicAcl?.toString(16) || 'N/A'}`);
          log.info(`Attributes: ${info.attributes?.length || 0}`);
          info.attributes.slice(0, 5).forEach(attr => {
            log.info(`  ${attr.key}: ${attr.value}`);
          });
        } else {
          log.warn('Container not found');
        }
      } catch (error) {
        log.error(`Failed to get container info: ${error}`);
      }
      break;
    }
    case '4': {
      if (state.containerIds.length === 0) {
        log.error('No containers available. List containers first.');
        break;
      }
      
      const indexStr = await question(`Enter container number to delete (1-${state.containerIds.length}): `);
      const index = parseInt(indexStr.trim(), 10) - 1;
      
      if (index < 0 || index >= state.containerIds.length) {
        log.error('Invalid container number');
        break;
      }
      
      const containerId = state.containerIds[index];
      const containerIdHex = bytesToHex(containerId.value);
      const container = state.containers.get(containerIdHex);
      const nameAttr = container?.attributes.find(a => a.key === 'Name');
      const name = nameAttr?.value || 'Unnamed';
      const confirm = await question(`Are you sure you want to delete "${name}"? (yes/no): `);
      
      if (confirm.trim().toLowerCase() !== 'yes') {
        log.info('Cancelled');
        break;
      }
      
      try {
        log.info('Deleting container...');
        await state.client.container().delete({
          containerId,
        });
        
        log.success('Container deleted!');
        
        // Clear selection if this was the selected container
        if (state.selectedContainerId && bytesToHex(state.selectedContainerId.value) === containerIdHex) {
          state.selectedContainerId = null;
          state.selectedContainer = null;
          state.objectIds = [];
          state.objects.clear();
        }
        
        // Refresh container list
        const containerIds = await state.client.container().list();
        state.containerIds = containerIds;
        state.containers.delete(containerIdHex);
      } catch (error) {
        log.error(`Failed to delete container: ${error}`);
      }
      break;
    }
    case '5': {
      if (state.containerIds.length === 0) {
        log.error('No containers available. List containers first.');
        break;
      }
      
      const indexStr = await question(`Enter container number to select (1-${state.containerIds.length}): `);
      const index = parseInt(indexStr.trim(), 10) - 1;
      
      if (index < 0 || index >= state.containerIds.length) {
        log.error('Invalid container number');
        break;
      }
      
      const containerId = state.containerIds[index];
      const containerIdHex = bytesToHex(containerId.value);
      const container = state.containers.get(containerIdHex);
      
      if (!container) {
        // Fetch container info if not cached
        try {
          const fetchedContainer = await state.client.container().get({ containerId });
          state.containers.set(containerIdHex, fetchedContainer);
          state.selectedContainerId = containerId;
          state.selectedContainer = fetchedContainer;
        } catch (error) {
          log.error(`Failed to get container info: ${error}`);
          break;
        }
      } else {
        state.selectedContainerId = containerId;
        state.selectedContainer = container;
      }
      
      state.objectIds = [];
      state.objects.clear();
      const nameAttr = state.selectedContainer.attributes.find(a => a.key === 'Name');
      log.success(`Selected container: ${nameAttr?.value || 'Unnamed'}`);
      break;
    }
  }
}

async function objectOperationsMenu() {
  if (!state.client) {
    log.error('Not connected. Please connect first.');
    return;
  }
  
  if (!state.selectedContainer) {
    log.error('No container selected. Please select a container first.');
    return;
  }
  
  const nameAttr = state.selectedContainer.attributes.find(a => a.key === 'Name');
  console.log('\n--- Object Operations ---');
  console.log(`Container: ${nameAttr?.value || 'Unnamed'}`);
  console.log('1. Upload Object');
  console.log('2. List Objects');
  console.log('3. Download Object');
  console.log('4. Get Object Info');
  console.log('5. Delete Object');
  console.log('0. Back');
  
  const choice = await question('\nSelect an option: ');
  
  switch (choice.trim()) {
    case '1': {
      const content = await question('Enter content to upload: ');
      if (!content.trim()) {
        log.error('Content cannot be empty');
        break;
      }
      
      const filename = await question('Filename (or press Enter for auto-generated): ');
      const objectFilename = filename.trim() || `test-${Date.now()}.txt`;
      
      try {
        log.info(`Uploading object "${objectFilename}"...`);
        const payload = stringToBytes(content);
        
        // Generate owner ID
        const ownerId = ownerIdFromPublicKey(publicKeyBytes(state.signer!.public()));
        
        // Calculate payload hash
        const payloadHash = crypto.createHash('sha256').update(payload).digest();
        
        // Create object header
        const header: ObjectHeader = {
          containerId: state.selectedContainerId!,
          ownerId,
          objectType: 0, // Regular object
          payloadLength: payload.length,
          payloadHash: {
            type: 1, // SHA256
            sum: payloadHash,
          },
          attributes: [
            { key: 'FileName', value: objectFilename },
            { key: 'ContentType', value: 'text/plain' },
            { key: 'Application', value: 'NeoFS-Node-Example' },
          ],
          version: { major: 2, minor: 0 },
        };
        
        const objectId = await state.client.object().put({
          header,
          payload,
        });
        
        log.success('Object uploaded!');
        log.info(`Object ID: ${bytesToHex(objectId.value).substring(0, 32)}...`);
        
        // Refresh object list
        await listObjects();
      } catch (error) {
        log.error(`Failed to upload object: ${error}`);
      }
      break;
    }
    case '2': {
      await listObjects();
      break;
    }
    case '3': {
      if (state.objectIds.length === 0) {
        log.error('No objects available. List objects first.');
        break;
      }
      
      const indexStr = await question(`Enter object number (1-${state.objectIds.length}): `);
      const index = parseInt(indexStr.trim(), 10) - 1;
      
      if (index < 0 || index >= state.objectIds.length) {
        log.error('Invalid object number');
        break;
      }
      
      const objectId = state.objectIds[index];
      
      try {
        log.info('Downloading object...');
        const address: Address = {
          containerId: state.selectedContainerId!,
          objectId,
        };
        
        const result: ObjectGetResult = await state.client.object().get({
          address,
        });
        
        if (result) {
          const objectIdHex = bytesToHex(objectId.value);
          const objHeader = state.objects.get(objectIdHex);
          const filename = objHeader?.attributes?.find(a => a.key === 'FileName')?.value || 'unnamed';
          log.success(`Downloaded: ${filename}`);
          log.info(`Size: ${result.payload.length} bytes`);
          
          // Try to show content if it's text
          const contentType = objHeader?.attributes?.find(a => a.key === 'ContentType')?.value;
          if (contentType?.startsWith('text/') || result.payload.length < 1000) {
            const content = bytesToString(result.payload);
            log.info(`Content: "${content.substring(0, 100)}${content.length > 100 ? '...' : ''}"`);
          }
        } else {
          log.warn('Object not found');
        }
      } catch (error) {
        log.error(`Failed to download object: ${error}`);
      }
      break;
    }
    case '4': {
      if (state.objectIds.length === 0) {
        log.error('No objects available. List objects first.');
        break;
      }
      
      const indexStr = await question(`Enter object number (1-${state.objectIds.length}): `);
      const index = parseInt(indexStr.trim(), 10) - 1;
      
      if (index < 0 || index >= state.objectIds.length) {
        log.error('Invalid object number');
        break;
      }
      
      const objectId = state.objectIds[index];
      
      try {
        log.info('Fetching object info...');
        const address: Address = {
          containerId: state.selectedContainerId!,
          objectId,
        };
        
        const info = await state.client.object().head({
          address,
        });
        
        if (info) {
          log.success('Object info retrieved');
          log.info(`Payload size: ${info.payloadLength || 'N/A'} bytes`);
          log.info(`Object type: ${info.objectType || 'N/A'}`);
          log.info(`Attributes: ${info.attributes?.length || 0}`);
          if (info.attributes) {
            info.attributes.slice(0, 5).forEach(attr => {
              log.info(`  ${attr.key}: ${attr.value}`);
            });
          }
          
          // Cache the header
          const objectIdHex = bytesToHex(objectId.value);
          state.objects.set(objectIdHex, info);
        } else {
          log.warn('Object not found');
        }
      } catch (error) {
        log.error(`Failed to get object info: ${error}`);
      }
      break;
    }
    case '5': {
      if (state.objectIds.length === 0) {
        log.error('No objects available. List objects first.');
        break;
      }
      
      const indexStr = await question(`Enter object number to delete (1-${state.objectIds.length}): `);
      const index = parseInt(indexStr.trim(), 10) - 1;
      
      if (index < 0 || index >= state.objectIds.length) {
        log.error('Invalid object number');
        break;
      }
      
      const objectId = state.objectIds[index];
      const objectIdHex = bytesToHex(objectId.value);
      const objHeader = state.objects.get(objectIdHex);
      const filename = objHeader?.attributes?.find(a => a.key === 'FileName')?.value || 'unnamed';
      const confirm = await question(`Are you sure you want to delete "${filename}"? (yes/no): `);
      
      if (confirm.trim().toLowerCase() !== 'yes') {
        log.info('Cancelled');
        break;
      }
      
      try {
        log.info('Deleting object...');
        const address: Address = {
          containerId: state.selectedContainerId!,
          objectId,
        };
        
        await state.client.object().delete({
          address,
        });
        
        log.success('Object deleted!');
        
        // Refresh object list
        await listObjects();
      } catch (error) {
        log.error(`Failed to delete object: ${error}`);
      }
      break;
    }
  }
}

async function listObjects() {
  if (!state.client || !state.selectedContainerId) return;
  
  try {
    log.info('Searching for objects...');
    const objectIds = await state.client.object().search({
      containerId: state.selectedContainerId,
      filters: [],
    });
    
    log.success(`Found ${objectIds.length} objects`);
    state.objectIds = objectIds;
    state.objects.clear();
    
    // Get info for each object (limit to first 10)
    for (const objectId of objectIds.slice(0, 10)) {
      try {
        const address: Address = {
          containerId: state.selectedContainerId,
          objectId,
        };
        const info = await state.client.object().head({
          address,
        });
        if (info) {
          const objectIdHex = bytesToHex(objectId.value);
          state.objects.set(objectIdHex, info);
          const filename = info.attributes?.find(a => a.key === 'FileName')?.value || 'unnamed';
          log.info(`  - ${filename} (${info.payloadLength || 0} bytes)`);
        }
      } catch (err) {
        log.warn(`  - Failed to get info for object ${bytesToHex(objectId.value).substring(0, 16)}...`);
      }
    }
    
    if (objectIds.length > 10) {
      log.info(`  ... and ${objectIds.length - 10} more`);
    }
  } catch (error) {
    log.error(`Failed to list objects: ${error}`);
  }
}

// Main application loop
async function main() {
  console.log('Welcome to NeoFS SDK Node.js Example!');
  console.log('This example demonstrates basic NeoFS operations.');
  
  while (true) {
    const choice = await showMainMenu();
    
    switch (choice) {
      case '1':
        await keyManagementMenu();
        break;
      case '2':
        await connectionMenu();
        break;
      case '3':
        await networkOperationsMenu();
        break;
      case '4':
        await containerOperationsMenu();
        break;
      case '5':
        await objectOperationsMenu();
        break;
      case '0':
        console.log('\nGoodbye!');
        rl.close();
        process.exit(0);
        break;
      default:
        log.warn('Invalid option');
        break;
    }
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n\nGoodbye!');
  rl.close();
  process.exit(0);
});

// Start the application
main().catch((error) => {
  log.error(`Fatal error: ${error}`);
  rl.close();
  process.exit(1);
});
