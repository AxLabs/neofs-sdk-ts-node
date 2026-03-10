#!/usr/bin/env node
/**
 * NeoFS SDK Web Server Example
 * Provides a web UI for NeoFS operations
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  NeoFSClient,
  type ClientConfig,
  type NetworkInfo,
  type Container,
  type ContainerID,
  type ObjectHeader,
  type ObjectID,
} from 'neofs-sdk-ts-node';
import {
  ECDSASignerRFC6979,
  type Signer,
  publicKeyBytes,
  tzHash,
} from 'neofs-sdk-ts-core/crypto';
import { ownerIdFromPublicKey } from 'neofs-sdk-ts-core/user';
import { Decimal } from 'neofs-sdk-ts-core/types';
import * as crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Generate a UUID v4 nonce for container creation
// UUID v4 format requires:
// - Byte 6: version 4 (high nibble = 0x40)
// - Byte 8: variant 1 (high bits = 0x80)
function generateNonce(): Uint8Array {
  const nonce = new Uint8Array(16);
  crypto.randomFillSync(nonce);
  // Set version to 4 (UUID v4)
  nonce[6] = (nonce[6] & 0x0f) | 0x40;
  // Set variant to 1 (RFC 4122)
  nonce[8] = (nonce[8] & 0x3f) | 0x80;
  return nonce;
}

// Application state
interface AppState {
  client: NeoFSClient | null;
  signer: Signer | null;
  endpoint: string;
  networkInfo: NetworkInfo | null;
  balance: Decimal | null;
  containerIds: ContainerID[];
  containers: Map<string, Container>;
  selectedContainerId: ContainerID | null;
  selectedContainer: Container | null;
  objectIds: ObjectID[];
  objects: Map<string, ObjectHeader>;
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

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// API Routes

// Get current state
app.get('/api/state', (req, res) => {
  res.json({
    connected: state.client !== null,
    hasSigner: state.signer !== null,
    endpoint: state.endpoint,
    publicKey: state.signer ? bytesToHex(state.signer.getPublicKey()) : null,
    ownerId: state.signer ? bytesToHex(ownerIdFromPublicKey(publicKeyBytes(state.signer.public()))) : null,
    networkInfo: state.networkInfo,
    balance: state.balance ? {
      value: state.balance.toString(),
      precision: state.balance.getPrecision(),
    } : null,
    containerCount: state.containerIds.length,
    selectedContainer: state.selectedContainerId ? bytesToHex(state.selectedContainerId.value) : null,
    objectCount: state.objectIds.length,
  });
});

// Key Management
app.post('/api/key/load', async (req, res) => {
  try {
    const { wif } = req.body;
    if (!wif) {
      return res.status(400).json({ error: 'WIF is required' });
    }
    
    const signer = ECDSASignerRFC6979.fromWIF(wif.trim());
    state.signer = signer;
    const pubKey = signer.getPublicKey();
    
    res.json({
      success: true,
      publicKey: bytesToHex(pubKey),
      ownerId: bytesToHex(ownerIdFromPublicKey(publicKeyBytes(signer.public()))),
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/key/generate', async (req, res) => {
  try {
    const signer = ECDSASignerRFC6979.generate();
    state.signer = signer;
    const pubKey = signer.getPublicKey();
    
    res.json({
      success: true,
      publicKey: bytesToHex(pubKey),
      ownerId: bytesToHex(ownerIdFromPublicKey(publicKeyBytes(signer.public()))),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Connection
app.post('/api/connect', async (req, res) => {
  try {
    if (!state.signer) {
      return res.status(400).json({ error: 'Please load or generate a key first' });
    }
    
    if (state.client) {
      return res.status(400).json({ error: 'Already connected' });
    }
    
    const config: ClientConfig = {
      endpoint: state.endpoint,
      signer: state.signer,
    };
    
    const client = new NeoFSClient(config);
    state.client = client;
    
    res.json({ success: true, message: 'Connected successfully' });
  } catch (error: any) {
    state.client = null;
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/disconnect', (req, res) => {
  state.client = null;
  state.networkInfo = null;
  state.balance = null;
  state.containers = new Map();
  state.containerIds = [];
  state.selectedContainer = null;
  state.selectedContainerId = null;
  state.objects = new Map();
  state.objectIds = [];
  res.json({ success: true });
});

app.post('/api/endpoint', (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) {
    return res.status(400).json({ error: 'Endpoint is required' });
  }
  state.endpoint = endpoint.trim();
  res.json({ success: true, endpoint: state.endpoint });
});

// Network Operations
app.get('/api/network/info', async (req, res) => {
  try {
    if (!state.client) {
      return res.status(400).json({ error: 'Not connected' });
    }
    
    const info = await state.client.netmap().networkInfo();
    state.networkInfo = info;
    
    res.json({
      success: true,
      data: {
        currentEpoch: info.currentEpoch.toString(),
        magicNumber: info.magicNumber.toString(),
        msPerBlock: info.msPerBlock.toString(),
        configParameters: info.networkConfig.parameters.length,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/network/balance', async (req, res) => {
  try {
    if (!state.client) {
      return res.status(400).json({ error: 'Not connected' });
    }
    
    const balance = await state.client.accounting().getBalance();
    state.balance = balance;
    
    res.json({
      success: true,
      data: {
        value: balance.toString(),
        precision: balance.getPrecision(),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/network/node-info', async (req, res) => {
  try {
    if (!state.client) {
      return res.status(400).json({ error: 'Not connected' });
    }
    
    const nodeInfo = await state.client.netmap().localNodeInfo();
    
    res.json({
      success: true,
      data: {
        version: `${nodeInfo.version.major}.${nodeInfo.version.minor}`,
        publicKey: bytesToHex(nodeInfo.nodeInfo.publicKey),
        addresses: nodeInfo.nodeInfo.addresses,
        state: nodeInfo.nodeInfo.state,
        attributes: nodeInfo.nodeInfo.attributes,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Container Operations
app.get('/api/containers', async (req, res) => {
  try {
    if (!state.client) {
      return res.status(400).json({ error: 'Not connected' });
    }
    
    const containerIds = await state.client.container().list();
    state.containerIds = containerIds;
    
    // Fetch info for each container
    const containers: any[] = [];
    for (const containerId of containerIds) {
      try {
        const container = await state.client.container().get({ containerId });
        const containerIdHex = bytesToHex(containerId.value);
        state.containers.set(containerIdHex, container);
        containers.push({
          id: containerIdHex,
          name: container.attributes.find(a => a.key === 'Name')?.value || 'Unnamed',
          ownerId: container.ownerId ? bytesToHex(container.ownerId) : undefined,
          basicAcl: container.basicAcl,
        });
      } catch (error: any) {
        containers.push({
          id: bytesToHex(containerId.value),
          error: error.message,
        });
      }
    }
    
    res.json({ success: true, data: containers });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/containers/create', async (req, res) => {
  try {
    if (!state.client) {
      return res.status(400).json({ error: 'Not connected' });
    }
    
    const { name } = req.body;
    const containerName = name || `container-${Date.now()}`;
    
    const containerId = await state.client.container().put({
      container: {
        version: { major: 2, minor: 18 },
        ownerId: ownerIdFromPublicKey(publicKeyBytes(state.signer!.public())),
        nonce: generateNonce(),
        basicAcl: 0x1fbfbfff, // Public read-write
        attributes: [
          { key: 'Name', value: containerName },
        ],
        placementPolicy: {
          replicas: [{ count: 1, selector: '' }],
          selectors: [],
          filters: [],
          containerBackupFactor: 0,
        },
      },
    });
    
    res.json({
      success: true,
      data: {
        containerId: bytesToHex(containerId.value),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/containers/:id', async (req, res) => {
  try {
    if (!state.client) {
      return res.status(400).json({ error: 'Not connected' });
    }
    
    const containerId: ContainerID = { value: hexToBytes(req.params.id) };
    const container = await state.client.container().get({ containerId });
    
    res.json({
      success: true,
      data: {
        id: req.params.id,
        ownerId: container.ownerId ? bytesToHex(container.ownerId) : undefined,
        basicAcl: container.basicAcl,
        attributes: container.attributes,
        placementPolicy: container.placementPolicy,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/containers/:id/select', (req, res) => {
  const containerId: ContainerID = { value: hexToBytes(req.params.id) };
  state.selectedContainerId = containerId;
  const container = state.containers.get(req.params.id);
  state.selectedContainer = container || null;
  res.json({ success: true });
});

app.delete('/api/containers/:id', async (req, res) => {
  try {
    if (!state.client) {
      return res.status(400).json({ error: 'Not connected' });
    }
    
    const containerId: ContainerID = { value: hexToBytes(req.params.id) };
    await state.client.container().delete({ containerId });
    
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Object Operations
app.get('/api/objects', async (req, res) => {
  try {
    if (!state.client) {
      return res.status(400).json({ error: 'Not connected' });
    }
    
    if (!state.selectedContainerId) {
      return res.status(400).json({ error: 'No container selected' });
    }
    
    // Pagination params
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100); // Max 100 per page
    const fetchHeaders = req.query.headers !== 'false'; // Default to fetching headers
    
    console.log('Searching objects in container:', bytesToHex(state.selectedContainerId.value));
    
    const objectIds = await state.client.object().search({
      containerId: state.selectedContainerId,
      filters: [],
    });
    
    const totalCount = objectIds.length;
    console.log('Found', totalCount, 'objects, showing page', page, 'with limit', limit);
    
    state.objectIds = objectIds;
    
    // Paginate the results
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedIds = objectIds.slice(startIndex, endIndex);
    
    const objects: any[] = [];
    
    // Only fetch headers for paginated objects
    for (const objectId of paginatedIds) {
      const objectIdHex = bytesToHex(objectId.value);
      
      if (fetchHeaders) {
        try {
          const address = {
            containerId: state.selectedContainerId!,
            objectId,
          };
          const header = await state.client.object().head({ address });
          state.objects.set(objectIdHex, header);
          
          // Extract filename from attributes if available
          // Proto returns PascalCase, but we might also have lowercase from our wrapper
          let filename = null;
          const attrs = (header as any).Attributes || (header as any).attributes || [];
          for (const attr of attrs) {
            if ((attr.Key || attr.key) === 'FileName') {
              filename = attr.Value || attr.value;
              break;
            }
          }
          
          // Handle both PascalCase (proto) and lowercase (our types)
          const payloadLen = (header as any).PayloadLength || (header as any).payloadLength || 0;
          const size = typeof payloadLen === 'bigint' ? payloadLen.toString() : String(payloadLen);
          
          objects.push({
            id: objectIdHex,
            filename,
            size,
            createdAt: ((header as any).CreationEpoch || (header as any).creationEpoch || 'N/A').toString(),
          });
        } catch (error: any) {
          console.error('Error getting object header:', error.message);
          objects.push({
            id: objectIdHex,
            error: error.message,
          });
        }
      } else {
        // Just return IDs without headers
        objects.push({
          id: objectIdHex,
        });
      }
    }
    
    res.json({
      success: true,
      data: objects,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasNext: endIndex < totalCount,
        hasPrev: page > 1,
      },
    });
  } catch (error: any) {
    console.error('Search objects error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/objects/put', async (req, res) => {
  try {
    if (!state.client) {
      return res.status(400).json({ error: 'Not connected' });
    }
    
    if (!state.selectedContainerId) {
      return res.status(400).json({ error: 'No container selected' });
    }
    
    const { data, filename } = req.body;
    if (!data) {
      return res.status(400).json({ error: 'Data is required' });
    }
    
    console.log('Put object request:', { data: data.substring(0, 50) + '...', filename });
    
    const payload = typeof data === 'string' ? new TextEncoder().encode(data) : hexToBytes(data);
    
    // Generate owner ID
    const ownerId = ownerIdFromPublicKey(publicKeyBytes(state.signer!.public()));
    
    // Calculate payload hash (SHA256)
    const payloadHash = crypto.createHash('sha256').update(payload).digest();
    
    // Calculate homomorphic hash (Tillich-Zémor)
    const homomorphicHash = tzHash(payload);
    
    console.log('Creating object with header:', {
      containerId: bytesToHex(state.selectedContainerId.value),
      payloadLength: payload.length,
    });
    
    // Create object header
    const header = {
      containerId: state.selectedContainerId,
      ownerId,
      objectType: 0, // Regular object
      payloadLength: payload.length,
      payloadHash: {
        type: 2, // SHA256 (ChecksumType_SHA256 = 2)
        sum: payloadHash,
      },
      homomorphicHash: {
        type: 1, // TillichZemor (ChecksumType_TZ = 1)
        sum: homomorphicHash,
      },
      attributes: [
        ...(filename ? [{ key: 'FileName', value: filename }] : []),
        { key: 'ContentType', value: 'application/octet-stream' },
        { key: 'Application', value: 'NeoFS-Web-UI' },
      ],
      version: { major: 2, minor: 0 },
    };
    
    const objectId = await state.client.object().put({
      header,
      payload,
    });
    
    console.log('Object created:', bytesToHex(objectId.value));
    
    res.json({
      success: true,
      data: {
        objectId: bytesToHex(objectId.value),
      },
    });
  } catch (error: any) {
    console.error('Put object error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/objects/:id', async (req, res) => {
  try {
    if (!state.client) {
      return res.status(400).json({ error: 'Not connected' });
    }
    
    if (!state.selectedContainerId) {
      return res.status(400).json({ error: 'No container selected' });
    }
    
    const objectId: ObjectID = { value: hexToBytes(req.params.id) };
    const address = {
      containerId: state.selectedContainerId,
      objectId,
    };
    const result = await state.client.object().get({
      address,
    });
    
    // Get filename from attributes if available
    let filename = 'object_' + req.params.id.substring(0, 8);
    let contentType = 'application/octet-stream';
    
    if (result.header && (result.header as any).Attributes) {
      for (const attr of (result.header as any).Attributes || []) {
        if (attr.Key === 'FileName' && attr.Value) {
          filename = attr.Value;
        }
        if (attr.Key === 'ContentType' && attr.Value) {
          contentType = attr.Value;
        }
      }
    }
    
    res.json({
      success: true,
      data: {
        id: req.params.id,
        filename,
        contentType,
        payload: Array.from(result.payload).map(b => b.toString(16).padStart(2, '0')).join(''),
        payloadBase64: Buffer.from(result.payload).toString('base64'),
        header: result.header,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Download endpoint - returns the actual file
app.get('/api/objects/:id/download', async (req, res) => {
  try {
    if (!state.client) {
      return res.status(400).json({ error: 'Not connected' });
    }
    
    if (!state.selectedContainerId) {
      return res.status(400).json({ error: 'No container selected' });
    }
    
    const objectId: ObjectID = { value: hexToBytes(req.params.id) };
    const address = {
      containerId: state.selectedContainerId,
      objectId,
    };
    
    console.log('Downloading object:', req.params.id);
    
    const result = await state.client.object().get({
      address,
    });
    
    // Get filename and content type from attributes
    let filename = 'object_' + req.params.id.substring(0, 8);
    let contentType = 'application/octet-stream';
    
    if (result.header && (result.header as any).Attributes) {
      for (const attr of (result.header as any).Attributes || []) {
        if (attr.Key === 'FileName' && attr.Value) {
          filename = attr.Value;
        }
        if (attr.Key === 'ContentType' && attr.Value) {
          contentType = attr.Value;
        }
      }
    }
    
    console.log('Sending file:', filename, 'size:', result.payload.length, 'type:', contentType);
    
    // Set headers for file download
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', result.payload.length);
    
    // Send the binary data
    res.send(Buffer.from(result.payload));
  } catch (error: any) {
    console.error('Download error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/objects/:id', async (req, res) => {
  try {
    if (!state.client) {
      return res.status(400).json({ error: 'Not connected' });
    }
    
    if (!state.selectedContainerId) {
      return res.status(400).json({ error: 'No container selected' });
    }
    
    const objectId: ObjectID = { value: hexToBytes(req.params.id) };
    const address = {
      containerId: state.selectedContainerId,
      objectId,
    };
    await state.client.object().delete({
      address,
    });
    
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`NeoFS Web UI running at http://localhost:${PORT}`);
});
