# NeoFS SDK Node.js Example

This example demonstrates how to use the NeoFS TypeScript SDK in a Node.js environment.

## Features

The example provides an interactive CLI that demonstrates:

- **Key Management**: Load WIF keys, generate new keys, view public keys
- **Connection**: Connect to NeoFS endpoints, manage connections
- **Network Operations**: Get network info, check balance, get local node info
- **Container Operations**: List, create, get info, delete containers
- **Object Operations**: Upload, list, download, get info, delete objects

## Prerequisites

- Node.js >= 18
- pnpm (or npm/yarn)

## Setup

1. Install dependencies:
```bash
cd example
pnpm install
```

2. Build the SDK (if not already built):
```bash
cd ..
pnpm build
cd example
```

## Running

### Development mode (with auto-reload):
```bash
pnpm dev
```

### Production mode:
```bash
pnpm start
```

Or directly with tsx:
```bash
npx tsx src/index.ts
```

## Usage

1. Start the application
2. Load or generate a key (Menu option 1)
3. Connect to a NeoFS endpoint (Menu option 2)
4. Explore network, container, and object operations

## Example Endpoints

- Testnet: `grpc://st1.t5.fs.neo.org:8080`
- Mainnet: `grpc://st1.fs.neo.org:8080`

## Notes

- This example uses a simple CLI interface
- For production applications, you would typically use a proper UI framework
- The example demonstrates the core SDK functionality without EACL/BearerToken/Waiter (those would need to be implemented for Node.js separately)
