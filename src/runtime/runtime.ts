/**
 * Runtime utilities for creating and managing gRPC servers
 *
 * This module provides functions to create gRPC servers for Crossplane functions,
 * handle TLS credentials, and manage server lifecycle. It simplifies the process
 * of setting up a production-ready function server with proper security.
 */

import * as grpc from '@grpc/grpc-js';
import type { Logger } from 'pino';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FunctionRunner, getServer } from '../function/function.js';

/**
 * Configuration options for the gRPC server.
 */
export interface ServerOptions {
  /**
   * The address to listen on (e.g., "0.0.0.0:9443" or ":9443")
   * Default is ":9443" when using the CLI
   */
  address: string;

  /**
   * Whether to run without TLS encryption.
   * Set to true for local development only. Production should use TLS.
   * Default: false
   */
  insecure?: boolean;

  /**
   * Enable debug-level logging.
   * Default: false
   */
  debug?: boolean;

  /**
   * Filesystem directory containing TLS certificates.
   * Should contain: tls.key, tls.crt, and ca.crt
   * Ignored if insecure is set to true.
   */
  tlsServerCertsDir?: string;

  /**
   * Maximum size of received gRPC messages in bytes.
   * Default: 4 MB (4 * 1024 * 1024).
   */
  maxRecvMessageSize?: number;
}

/**
 * Create gRPC ServerCredentials from TLS certificate files.
 *
 * This function loads TLS certificates from the filesystem and creates
 * appropriate ServerCredentials for the gRPC server. In insecure mode,
 * it returns insecure credentials (suitable for local development only).
 *
 * For secure mode, it expects three files in tlsServerCertsDir:
 * - tls.key: The server's private key
 * - tls.crt: The server's certificate
 * - ca.crt: The certificate authority certificate
 *
 * @param opts - Server options containing TLS configuration
 * @returns gRPC ServerCredentials (secure or insecure based on options)
 * @throws Error if certificate files cannot be read in secure mode
 *
 * @example
 * ```typescript
 * // Secure mode (production)
 * const creds = getServerCredentials({
 *   address: ":9443",
 *   tlsServerCertsDir: "/tls"
 * });
 *
 * // Insecure mode (development only)
 * const creds = getServerCredentials({
 *   address: ":9443",
 *   insecure: true
 * });
 * ```
 */
export function getServerCredentials(opts?: ServerOptions): grpc.ServerCredentials {
  if (opts?.insecure || opts?.tlsServerCertsDir === '' || opts?.tlsServerCertsDir === undefined) {
    return grpc.ServerCredentials.createInsecure();
  }

  const tlsCertsDir = opts.tlsServerCertsDir;
  if (typeof tlsCertsDir !== 'string' || tlsCertsDir.trim() === '') {
    throw new Error('tlsServerCertsDir must be a non-empty string when TLS is enabled');
  }

  const privateKey = readFileSync(join(tlsCertsDir, 'tls.key'));
  const certChain = readFileSync(join(tlsCertsDir, 'tls.crt'));
  const rootCerts = readFileSync(join(tlsCertsDir, 'ca.crt'));
  return grpc.ServerCredentials.createSsl(
    rootCerts,
    [{ private_key: privateKey, cert_chain: certChain }],
    false // Set to false to make client certificates optional
  );
}

/**
 * Create a new gRPC server with the function runner registered.
 *
 * This function creates a gRPC server instance and registers the provided
 * FunctionRunner to handle incoming RunFunction requests. The server is
 * created but not yet bound to an address - use startServer to bind and start it.
 *
 * @param functionRunner - The FunctionRunner instance that will handle requests
 * @param logger - Logger instance for debug and error logging
 * @returns A configured gRPC Server instance ready to be started
 *
 * @example
 * ```typescript
 * const runner = new FunctionRunner(new MyFunction(), logger);
 * const server = newGrpcServer(runner, logger);
 * startServer(server, { address: ":9443", insecure: false }, logger);
 * ```
 */
export function newGrpcServer(
  functionRunner: FunctionRunner,
  logger: Logger,
  opts?: Pick<ServerOptions, 'maxRecvMessageSize'>
): grpc.Server {
  const server = getServer(functionRunner, logger, opts);
  if (logger) {
    logger.debug('grpc server created');
  }
  return server;
}

/**
 * Bind and start a gRPC server.
 *
 * This function binds the server to the specified address and starts listening
 * for incoming connections. It handles both secure (TLS) and insecure modes
 * based on the provided options. The binding happens asynchronously.
 *
 * The server will log when it successfully starts listening or if an error occurs
 * during binding.
 *
 * @param server - The gRPC Server instance to start
 * @param opts - Server options including address and TLS configuration
 * @param logger - Logger instance for info and error logging
 * @returns The same server instance (now bound and listening)
 *
 * @example
 * ```typescript
 * const server = newGrpcServer(runner, logger);
 * startServer(server, {
 *   address: "0.0.0.0:9443",
 *   tlsServerCertsDir: "/tls",
 *   debug: true
 * }, logger);
 *
 * // For local development
 * startServer(server, {
 *   address: "localhost:9443",
 *   insecure: true
 * }, logger);
 * ```
 */
export function startServer(server: grpc.Server, opts: ServerOptions, logger: Logger): grpc.Server {
  const creds = getServerCredentials(opts);
  logger.debug(`serverCredentials type: ${creds.constructor.name}`);

  server.bindAsync(opts.address, creds, (err) => {
    if (err) {
      logger.error(`server bind error: ${err.message}`);
      return;
    }
    logger.info(`server started and listening on ${opts.address}`);
  });
  return server;
}
