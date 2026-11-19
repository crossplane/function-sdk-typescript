import { describe, it, expect, afterEach, vi } from 'vitest';
import * as grpc from '@grpc/grpc-js';
import type { Logger } from 'pino';
import { startServer } from './runtime.js';

/** A logger whose calls can be inspected. */
function stubLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as Logger;
}

describe('startServer', () => {
  const servers: grpc.Server[] = [];

  afterEach(() => {
    for (const server of servers.splice(0)) server.forceShutdown();
  });

  function newServer(): grpc.Server {
    const server = new grpc.Server();
    servers.push(server);
    return server;
  }

  /** Bind a server to a free port and return the port, so it can be collided with. */
  function occupyPort(): Promise<number> {
    return new Promise((resolve, reject) => {
      newServer().bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, port) =>
        err ? reject(err) : resolve(port)
      );
    });
  }

  it('should report a bind failure to onBindError after logging it', async () => {
    const port = await occupyPort();
    const logger = stubLogger();

    const err = await new Promise<Error>((resolve) => {
      startServer(newServer(), { address: `127.0.0.1:${port}`, insecure: true }, logger, resolve);
    });

    expect(err.message).toMatch(/EADDRINUSE/);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('server bind error'));
  });

  it('should only log a bind failure when there is no onBindError', async () => {
    const port = await occupyPort();
    const logger = stubLogger();
    const logged = new Promise<void>((resolve) => {
      vi.mocked(logger.error).mockImplementation(() => resolve());
    });

    // Callers written before onBindError existed keep working: no throw, no
    // exit, just the log line.
    expect(() =>
      startServer(newServer(), { address: `127.0.0.1:${port}`, insecure: true }, logger)
    ).not.toThrow();
    await logged;
  });

  it('should not call onBindError when the server binds', async () => {
    const logger = stubLogger();
    const onBindError = vi.fn();
    const started = new Promise<void>((resolve) => {
      vi.mocked(logger.info).mockImplementation(() => resolve());
    });

    startServer(newServer(), { address: '127.0.0.1:0', insecure: true }, logger, onBindError);
    await started;

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('server started'));
    expect(onBindError).not.toHaveBeenCalled();
  });
});
