#!/usr/bin/env sh
# Ensures protoc-gen-grpc-ts binary is in bin/. Prefers building from source
# (core package as sibling in monorepo or PROTOC_GEN_GRPC_TS_SOURCE), then falls back to
# downloading from GitHub if PROTOC_GEN_GRPC_TS_RELEASE_REPO is set.

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/bin"

# In monorepo: sibling core is ../../neofs-sdk-ts-core from this script
SOURCE_DIR="${PROTOC_GEN_GRPC_TS_SOURCE:-$(cd "$SCRIPT_DIR/../.." && pwd)/neofs-sdk-ts-core/protoc-gen-grpc-ts}"

OS=$(uname -s)
ARCH=$(uname -m)
case "$OS" in
  Linux)   OS=linux ;;
  Darwin)  OS=darwin ;;
  MINGW*)  OS=windows ;;
  *)       echo "Unsupported OS: $OS"; exit 1 ;;
esac
case "$ARCH" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *)       echo "Unsupported arch: $ARCH"; exit 1 ;;
esac

if [ "$OS" = "windows" ]; then
  BINARY="$BIN_DIR/protoc-gen-grpc-ts.exe"
else
  BINARY="$BIN_DIR/protoc-gen-grpc-ts"
fi
if [ -x "$BINARY" ]; then
  exit 0
fi

mkdir -p "$BIN_DIR"

# 1) Build from source
if [ -f "$SOURCE_DIR/Makefile" ] && command -v make >/dev/null 2>&1 && command -v go >/dev/null 2>&1; then
  echo "Building protoc-gen-grpc-ts from source at $SOURCE_DIR"
  (cd "$SOURCE_DIR" && make build)
  if [ -x "$SOURCE_DIR/protoc-gen-grpc-ts" ]; then
    cp "$SOURCE_DIR/protoc-gen-grpc-ts" "$BINARY"
    chmod +x "$BINARY"
    exit 0
  fi
  if [ -x "$SOURCE_DIR/protoc-gen-grpc-ts.exe" ]; then
    cp "$SOURCE_DIR/protoc-gen-grpc-ts.exe" "$BINARY"
    chmod +x "$BINARY"
    exit 0
  fi
fi

# 2) Download from GitHub Releases if repo is set
RELEASE_REPO="${PROTOC_GEN_GRPC_TS_RELEASE_REPO}"
VERSION="${PROTOC_GEN_GRPC_TS_VERSION:-v0.1.0}"
if [ -n "$RELEASE_REPO" ]; then
  NAME="protoc-gen-grpc-ts-${OS}-${ARCH}"
  if [ "$OS" = "windows" ]; then
    NAME="${NAME}.exe"
  fi
  URL="https://github.com/${RELEASE_REPO}/releases/download/${VERSION}/${NAME}"
  echo "Downloading protoc-gen-grpc-ts from $URL"
  if command -v curl >/dev/null 2>&1; then
    curl -sSL -o "$BINARY" "$URL"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$BINARY" "$URL"
  else
    echo "Need curl or wget to download."; exit 1
  fi
  chmod +x "$BINARY"
  exit 0
fi

echo "Could not get protoc-gen-grpc-ts binary."
echo "  Build from source: run 'pnpm run build:plugin' in neofs-sdk-ts-core, or set PROTOC_GEN_GRPC_TS_SOURCE."
echo "  Or set PROTOC_GEN_GRPC_TS_RELEASE_REPO to your GitHub repo (e.g. myorg/neofs-sdk-ts-core)."
exit 1
