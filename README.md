# NeoFS TypeScript SDK for Node.js

A Node.js TypeScript SDK for [NeoFS](https://neofs.io/) - a decentralized, distributed object storage network.

## Features

- **Native Node.js**: Uses `@grpc/grpc-js` for optimal performance
- **Streaming Support**: Efficient streaming for large file uploads/downloads
- **Full NeoFS API**: Containers, objects, sessions, EACL, bearer tokens
- **Type Safety**: Complete TypeScript definitions
- **Async/Await**: Modern Promise-based API

## Installation

```bash
npm install neofs-sdk-ts-node
```

## Quick Start

```typescript
import { NeoFSClient, ECDSASigner } from 'neofs-sdk-ts-node';

// Create a signer from your private key
const signer = ECDSASigner.fromHex(privateKeyHex);

// Initialize the client
const client = new NeoFSClient({
  endpoint: 'grpc.testnet.neofs.io:8082',
  signer,
});

// Create a container
const containerId = await client.container().put({
  container: {
    placementPolicy: { replicas: [{ count: 2 }] },
    basicAcl: 0x1fbf8cff, // PUBLIC_READ
  },
});

console.log('Container created:', containerId);

// Upload an object
const objectId = await client.object().put({
  header: { containerId },
  payload: Buffer.from('Hello, NeoFS!'),
  attributes: [
    { key: 'FileName', value: 'hello.txt' },
    { key: 'ContentType', value: 'text/plain' },
  ],
});

console.log('Object uploaded:', objectId);

// Download the object
const result = await client.object().get({
  address: { containerId, objectId },
});

console.log('Content:', Buffer.from(result.payload).toString());
```

## API Overview

### Client Initialization

```typescript
import { NeoFSClient, ECDSASigner, ECDSASignerRFC6979 } from 'neofs-sdk-ts-node';

// From hex private key
const signer = ECDSASigner.fromHex('your-private-key-hex');

// Or generate a new key pair
const signer = ECDSASigner.generate();

// Or use RFC6979 deterministic signatures
const signer = ECDSASignerRFC6979.fromHex('your-private-key-hex');

const client = new NeoFSClient({
  endpoint: 'grpc.testnet.neofs.io:8082',
  signer,
  // Optional: TLS configuration
  // credentials: grpc.credentials.createSsl(),
});
```

### Container Operations

```typescript
// Create a container
const containerId = await client.container().put({
  container: {
    placementPolicy: { replicas: [{ count: 3 }] },
    basicAcl: 0x1fbf8cff,
    attributes: [
      { key: 'Name', value: 'my-container' },
    ],
  },
});

// Get container info
const container = await client.container().get({ containerId });
console.log('Owner:', container?.ownerId);
console.log('Policy:', container?.placementPolicy);

// List containers
const containers = await client.container().list({});

// Delete a container
await client.container().delete({ containerId });
```

### Object Operations

```typescript
// Upload an object
const objectId = await client.object().put({
  header: { containerId },
  payload: Buffer.from('Hello, World!'),
  attributes: [
    { key: 'FileName', value: 'hello.txt' },
    { key: 'ContentType', value: 'text/plain' },
  ],
});

// Get object metadata (HEAD)
const header = await client.object().head({
  address: { containerId, objectId },
});
console.log('Size:', header?.payloadLength);

// Download an object
const result = await client.object().get({
  address: { containerId, objectId },
});
console.log('Payload:', result.payload);

// Search objects
const objectIds = await client.object().search({
  containerId,
  filters: [
    { key: 'FileName', value: 'hello', matchType: 3 }, // COMMON_PREFIX
  ],
});

// Delete an object
await client.object().delete({
  address: { containerId, objectId },
});
```

### Large File Streaming

For large files, use the streaming client:

```typescript
import { StreamingObjectClient } from 'neofs-sdk-ts-node';

// The streaming client handles chunked uploads automatically
const objectId = await client.object().put({
  header: { containerId },
  payload: largeBuffer, // Can be any size
  attributes: [{ key: 'FileName', value: 'large-file.zip' }],
});
```

### Network Information

```typescript
// Get current epoch
const { networkInfo } = await client.netmap().networkInfo();
console.log('Epoch:', networkInfo?.currentEpoch);

// Get local node info
const localInfo = await client.netmap().localNodeInfo();
console.log('Version:', localInfo?.version);

// Get network snapshot
const snapshot = await client.netmap().netmapSnapshot();
console.log('Nodes:', snapshot?.body?.netmap?.nodes?.length);
```

### Session Management

```typescript
// Create a session
const session = await client.session().create({
  expiration: BigInt(currentEpoch + 100),
});
console.log('Session ID:', session.id);
```

### EACL (Extended Access Control)

```typescript
import { Table, Target, Record, Operation, publicReadEACL } from 'neofs-sdk-ts-node';

// Use a preset
const eacl = publicReadEACL(containerId);

// Or build custom rules
const customEacl = new Table(containerId)
  .allowRead([Target.others()])
  .denyWrite([Target.others()])
  .allow(Operation.PUT, [Target.userId(friendId)]);

// Set EACL on container
await client.container().setEACL({
  containerId,
  eaclTable: eacl.toProto(),
});

// Get EACL
const currentEacl = await client.container().getEACL({ containerId });
```

### Bearer Tokens

```typescript
import { BearerToken, publicReadEACL } from 'neofs-sdk-ts-node';

// Create a bearer token for delegated access
const token = new BearerToken()
  .setEACL(publicReadEACL(containerId))
  .forUser(friendUserId)
  .setIssuer(myUserId)
  .setLifetime({
    iat: currentEpoch,
    nbf: currentEpoch,
    exp: currentEpoch + 100n,
  })
  .sign(signer);

// Serialize to share
const tokenBytes = token.serialize();
```

### Waiter (Async Confirmation)

```typescript
import { Waiter } from 'neofs-sdk-ts-node';

const waiter = new Waiter(client);

// Create container and wait for confirmation
const containerId = await waiter.containerPut({
  container: { /* ... */ },
});
// Container is guaranteed to exist at this point

// Upload object and wait for confirmation
const objectId = await waiter.objectPut({
  header: { containerId },
  payload: data,
});
// Object is guaranteed to be readable
```

## Configuration

```typescript
interface ClientConfig {
  /** gRPC endpoint (host:port) */
  endpoint: string;
  
  /** Signer for authentication */
  signer: Signer;
  
  /** Optional gRPC credentials (for TLS) */
  credentials?: grpc.ChannelCredentials;
  
  /** Optional gRPC channel options */
  options?: grpc.ChannelOptions;
}
```

### TLS Configuration

```typescript
import * as grpc from '@grpc/grpc-js';
import * as fs from 'fs';

const client = new NeoFSClient({
  endpoint: 'grpc.example.com:8082',
  signer,
  credentials: grpc.credentials.createSsl(
    fs.readFileSync('ca.pem'),
    fs.readFileSync('client-key.pem'),
    fs.readFileSync('client-cert.pem'),
  ),
});
```

## Error Handling

```typescript
try {
  const result = await client.object().get({
    address: { containerId, objectId },
  });
} catch (error) {
  if (error.code === 2049) {
    console.log('Object not found');
  } else if (error.code === 3072) {
    console.log('Container not found');
  } else {
    throw error;
  }
}
```

## Example Application

See the [example](./example) directory for a complete Express.js application demonstrating:

- Container management
- File upload/download
- Object search
- Web interface

```bash
cd example
npm install
npm start
# Open http://localhost:3000
```

## Development

```bash
# Build
npm run build

# Run tests
npm test

# Generate protobuf types
npm run generate:all

# Lint
npm run lint

# Format
npm run format
```

## License

Apache 2.0 - see [LICENSE](../LICENSE) for details.
