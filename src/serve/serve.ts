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
import type { Logger } from 'pino';
import { CLI, newLogger } from '../cli/cli.js';
import { FunctionRunner, type FunctionHandler } from '../function/function.js';
import { newGrpcServer, startServer, type ServerOptions } from '../runtime/runtime.js';
import { to } from '../response/response.js';
import type { RunFunctionRequest, RunFunctionResponse, State } from '../proto/run_function.js';

export { DEFAULT_ADDRESS, DEFAULT_TLS_SERVER_CERTS_DIR } from '../cli/cli.js';

/**
 * A RunFunctionResponse whose desired state is guaranteed to be present.
 *
 * `RunFunctionResponse.desired` is optional in the protobuf schema, but a
 * response built by {@link to} always has it, so a compose function can write
 * `rsp.desired.resources[name]` without a non-null assertion.
 */
export type ComposeResponse = RunFunctionResponse & { desired: State };

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
   * script. Ignored when {@link cli} is given, since the CLI has its own name.
   */
  name?: string;

  /**
   * Arguments to parse, without the node executable or script path.
   * Defaults to process.argv.slice(2). Ignored when {@link cli} is given and
   * has already been parsed.
   */
  argv?: string[];

  /**
   * A {@link CLI} declaring flags of the function's own, alongside the
   * standard ones. serve parses it unless it has been parsed already, and its
   * help text is what --help prints. Defaults to a CLI with only the standard
   * flags.
   */
  cli?: CLI;

  /**
   * Logger to use. One is created from the parsed --debug flag if omitted.
   */
  logger?: Logger;

  /** Overrides applied on top of the parsed flags. */
  serverOptions?: Partial<ServerOptions>;
}

/** The result of {@link parseArgs}: server options, plus whether help was asked for. */
export interface ParsedArgs extends ServerOptions {
  /** Whether --help or -h was given. */
  help: boolean;
}

/**
 * Parse the standard function command line flags and environment variables.
 *
 * A shorthand for parsing a {@link CLI} with no flags of its own. Exported so
 * that it can be tested.
 *
 * @param argv - Arguments without the node executable or script path.
 * @returns The parsed options.
 * @throws If a flag is unrecognised, missing its value, or given a value it
 *   does not take.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const cli = new CLI();
  const values = cli.parse(argv);
  return { ...cli.standardOptions(), help: values.help === true };
}

/** The --help text for a function with only the standard flags. */
export function helpText(name: string): string {
  return new CLI({ name }).helpText();
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
export function serve(fn: ComposeFunction | FunctionHandler, opts: ServeOptions = {}): grpc.Server {
  const cli = opts.cli ?? new CLI({ name: opts.name });

  if (!cli.parsed) {
    try {
      cli.parse(opts.argv ?? process.argv.slice(2));
    } catch (error) {
      // node:util throws a TypeError whose message is exactly what the user
      // needs to see. Without this it reaches the top level and Node prints it
      // under a stack trace through its own internals, which buries it.
      process.stderr.write(`${usageErrorText(cli.name, error)}\n`);
      process.exit(2);
    }
  }

  if (cli.values.help === true) {
    process.stdout.write(`${cli.helpText()}\n`);
    process.exit(0);
  }

  const serverOptions: ServerOptions = { ...cli.standardOptions(), ...opts.serverOptions };

  const logger = opts.logger ?? newLogger(serverOptions.debug === true);

  logger.debug({ options: serverOptions }, 'starting function');

  const handler: FunctionHandler = typeof fn === 'function' ? fromCompose(fn) : fn;
  const server = newGrpcServer(new FunctionRunner(handler, logger), logger, {
    maxRecvMessageSize: serverOptions.maxRecvMessageSize,
    maxSendMessageSize: serverOptions.maxSendMessageSize,
  });
  try {
    startServer(server, serverOptions, logger);
  } catch (error) {
    // grpc-js throws synchronously for an address it cannot parse at all. Let
    // it out and it reaches the top level as a stack trace through grpc-js's
    // own internals; this is a bad value for a flag, so report it as one.
    process.stderr.write(`${usageErrorText(cli.name, error)}\n`);
    process.exit(2);
  }

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
