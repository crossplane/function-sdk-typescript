/**
 * A batteries-included entrypoint for composition functions.
 *
 * Writing a function should not require assembling a gRPC server. This module
 * provides {@link serve}, which parses the standard function flags, builds a
 * logger, starts the server and handles shutdown — so a function's entrypoint
 * is a single call, and its author only writes composition logic.
 *
 * It also provides the {@link ComposeFunction} shape: a plain function handed
 * a request and a response to populate, rather than a class implementing
 * {@link FunctionHandler}. Both are accepted, so existing handlers keep
 * working.
 */

import * as grpc from '@grpc/grpc-js';
import { basename } from 'node:path';
import { parseArgs as parseNodeArgs } from 'node:util';
import { pino, type Logger } from 'pino';
import { FunctionRunner, type FunctionHandler } from '../function/function.js';
import { newGrpcServer, startServer, type ServerOptions } from '../runtime/runtime.js';
import { to } from '../response/response.js';
import type { RunFunctionRequest, RunFunctionResponse, State } from '../proto/run_function.js';

/** The address a function listens on unless told otherwise. */
export const DEFAULT_ADDRESS = '0.0.0.0:9443';

/**
 * Where the package reconciler mounts the TLS certificates it generates.
 */
export const DEFAULT_TLS_SERVER_CERTS_DIR = '/tls/server';

/**
 * A RunFunctionResponse whose desired state is guaranteed to be present.
 *
 * `RunFunctionResponse.desired` is optional in the protobuf schema, but a
 * response built by {@link to} always has it, so a compose function can write
 * `rsp.desired.resources[name]` without a non-null assertion.
 */
export type ComposeResponse = RunFunctionResponse & { desired: State };

/**
 * The program name to show in --help when the caller does not supply one.
 *
 * Taken from the script being run, the way most command line tools do it, so
 * the help of a function started as `node dist/main.js` says `main.js` rather
 * than something generic.
 */
function defaultName(): string {
  const script = process.argv[1];
  return script ? basename(script) : 'function';
}

/**
 * A composition function.
 *
 * Receives the request along with a response already initialised from it, so
 * there is no need to call {@link to}, and returns the response to send.
 *
 * The response is passed in as a convenience, not as an out parameter: it is
 * yours to fill in and return, or to ignore in favour of one you build
 * yourself. Returning it is required, so forgetting is a compile error rather
 * than an empty response at runtime.
 *
 * Note that when the request already carries desired state — as it does for
 * every function after the first in a pipeline — `rsp.desired` is the same
 * object as `req.desired`, not a copy. Writing to `rsp.desired.resources`
 * therefore also changes `req.desired.resources`. That is inherited from
 * {@link to} and is usually harmless, since a function reads observed state
 * and writes desired state, but do not rely on `req.desired` still holding
 * what the previous function left once you have started writing.
 *
 * @example
 * ```typescript
 * import { Resource, type ComposeFunction } from '@crossplane-org/function-sdk-typescript';
 * import { VPC } from 'crossplane-models/ec2.aws.m.upbound.io/v1beta1';
 *
 * export const compose: ComposeFunction = (req, rsp) => {
 *   const vpc = new VPC({ spec: { forProvider: { region: 'us-west-2' } } });
 *   vpc.validate();
 *   rsp.desired.resources['vpc'] = Resource.fromJSON({ resource: vpc.toJSON() });
 *   return rsp;
 * };
 * ```
 */
export type ComposeFunction = (
  req: RunFunctionRequest,
  rsp: ComposeResponse,
  logger?: Logger
) => RunFunctionResponse | Promise<RunFunctionResponse>;

/**
 * Adapt a {@link ComposeFunction} to the {@link FunctionHandler} interface.
 *
 * Builds the response from the request, hands it to the compose function, and
 * returns whatever that function returns.
 */
export function fromCompose(compose: ComposeFunction): FunctionHandler {
  return {
    async RunFunction(req: RunFunctionRequest, logger?: Logger): Promise<RunFunctionResponse> {
      // to() always populates desired, so the cast holds.
      const rsp = to(req) as ComposeResponse;
      return await compose(req, rsp, logger);
    },
  };
}

/** Options for {@link serve}. */
export interface ServeOptions {
  /**
   * Program name shown in --help. Defaults to the basename of the running
   * script.
   */
  name?: string;

  /**
   * Arguments to parse, without the node executable or script path.
   * Defaults to process.argv.slice(2).
   */
  argv?: string[];

  /**
   * Logger to use. One is created from the parsed --debug flag if omitted.
   */
  logger?: Logger;

  /** Overrides applied on top of the parsed flags. */
  serverOptions?: Partial<ServerOptions>;
}

/**
 * The flags every composition function accepts.
 *
 * This is the single source of truth: both the parser and the help text are
 * derived from it, so a flag cannot be added to one and forgotten in the
 * other.
 */
const flags = {
  address: { type: 'string', default: DEFAULT_ADDRESS },
  debug: { type: 'boolean', short: 'd', default: false },
  insecure: { type: 'boolean', default: false },
  'tls-server-certs-dir': { type: 'string', default: DEFAULT_TLS_SERVER_CERTS_DIR },
  help: { type: 'boolean', short: 'h', default: false },
} as const;

/**
 * What each flag does. Keyed by {@link flags}, so adding a flag without
 * describing it is a compile error.
 */
const descriptions: Record<keyof typeof flags, string> = {
  address: `Address to listen for gRPC connections. Default ${DEFAULT_ADDRESS}.`,
  debug: 'Emit debug logs.',
  insecure: 'Run without mTLS credentials.',
  'tls-server-certs-dir': `Directory holding tls.key, tls.crt and ca.crt. Default ${DEFAULT_TLS_SERVER_CERTS_DIR}.`,
  help: 'Show this help.',
};

/** The result of {@link parseArgs}: server options, plus whether help was asked for. */
export interface ParsedArgs extends ServerOptions {
  /** Whether --help or -h was given. */
  help: boolean;
}

/**
 * Parse the standard function command line flags.
 *
 * Exported so that it can be tested, and so that a function needing extra
 * flags of its own can reuse the standard ones.
 *
 * @param argv - Arguments without the node executable or script path.
 * @returns The parsed options.
 * @throws If a flag is unrecognised, missing its value, or given a value it
 *   does not take.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const { values } = parseNodeArgs({ args: argv, options: flags, allowPositionals: false });
  return {
    address: values.address,
    debug: values.debug,
    insecure: values.insecure,
    tlsServerCertsDir: values['tls-server-certs-dir'],
    help: values.help,
  };
}

/** The --help text, derived from {@link flags} and {@link descriptions}. */
export function helpText(name: string): string {
  const usage = Object.entries(flags).map(([flag, spec]) => {
    const short = 'short' in spec ? `-${spec.short}, ` : '    ';
    const value = spec.type === 'string' ? ' <value>' : '';
    return `  ${short}--${flag}${value}`.padEnd(38) + descriptions[flag as keyof typeof flags];
  });
  return [`Usage: ${name} [flags]`, '', 'A Crossplane composition function.', '', 'Flags:', ...usage].join(
    '\n'
  );
}

/**
 * The message shown when the command line cannot be parsed.
 *
 * Kept separate from {@link serve} so that it can be tested without spawning a
 * process, since serve's own handling ends in process.exit.
 */
export function usageErrorText(name: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${name}: ${message}\nTry '${name} --help' for the available flags.`;
}

/**
 * Run a composition function as a gRPC server.
 *
 * Parses the standard flags, creates a logger, starts the server, and shuts it
 * down cleanly on SIGINT and SIGTERM. This is everything a function's
 * entrypoint needs to do.
 *
 * @param fn - A {@link ComposeFunction}, or a {@link FunctionHandler} for
 *   functions that need the full interface.
 * @param opts - Overrides, mostly useful in tests.
 * @returns The running gRPC server.
 *
 * @example
 * ```typescript
 * #!/usr/bin/env node
 * import { serve } from '@crossplane-org/function-sdk-typescript';
 * import { compose } from './function.js';
 *
 * serve(compose);
 * ```
 */
export function serve(
  fn: ComposeFunction | FunctionHandler,
  opts: ServeOptions = {}
): grpc.Server {
  const name = opts.name ?? defaultName();
  const argv = opts.argv ?? process.argv.slice(2);

  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    // node:util throws a TypeError whose message is exactly what the user
    // needs to see. Without this it reaches the top level and Node prints it
    // under a stack trace through its own internals, which buries it.
    process.stderr.write(`${usageErrorText(name, error)}\n`);
    process.exit(2);
  }

  const { help, ...parsed } = args;
  if (help) {
    process.stdout.write(`${helpText(name)}\n`);
    process.exit(0);
  }

  const serverOptions: ServerOptions = { ...parsed, ...opts.serverOptions };

  const logger =
    opts.logger ??
    pino({
      level: serverOptions.debug ? 'debug' : 'info',
      formatters: {
        level: (label: string) => ({ severity: label.toUpperCase() }),
      },
    });

  logger.debug({ options: serverOptions }, 'starting function');

  const handler: FunctionHandler = typeof fn === 'function' ? fromCompose(fn) : fn;
  const server = newGrpcServer(new FunctionRunner(handler, logger), logger);
  startServer(server, serverOptions, logger);

  const shutdown = (signal: string): void => {
    logger.info(`received ${signal}, shutting down`);
    server.tryShutdown((err?: Error) => {
      if (err) {
        logger.error(err, 'error during shutdown');
        process.exit(1);
      }
      logger.info('server shut down');
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}
