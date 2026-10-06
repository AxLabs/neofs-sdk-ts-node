import * as grpc from '@grpc/grpc-js';

/**
 * Build gRPC call options from a timeout in milliseconds.
 * A positive timeout becomes an absolute deadline. Missing, zero, and
 * negative values leave the call unbounded.
 */
export function grpcCallOptions(timeoutMs?: number): grpc.CallOptions {
  if (timeoutMs == null || timeoutMs <= 0) {
    return {};
  }
  return { deadline: Date.now() + timeoutMs };
}
