/**
 * A shareable CLI for composition functions.
 *
 * The {@link CLI} class provides the standard flags every composition function
 * accepts, reads environment variables, and lets function authors add custom
 * flags.
 *
 * Simple functions that need no custom flags can keep using {@link serve}.
 * Functions that need extra flags create a CLI, parse it, then pass the
 * results to serve:
 *
 * @example
 * ```typescript
 * const cli = new CLI({
 *   flags: {
 *     'my-flag': { type: 'string', default: 'foo', env: 'MY_FLAG', description: 'My custom flag.' },
 *   },
 * });
 *
 * const parsed = cli.parse();
 * if (parsed.help) {
 *   process.stdout.write(cli.helpText() + '\n');
 *   process.exit(0);
 * }
 *
 * serve(compose, { argv: [], serverOptions: cli.standardOptions(), logger: cli.logger() });
 * ```
 */

import { basename } from 'node:path';
import { parseArgs as parseNodeArgs } from 'node:util';
import { pino, type Logger } from 'pino';
import type { ServerOptions } from '../runtime/runtime.js';

const DEFAULT_ADDRESS = '0.0.0.0:9443';
const DEFAULT_MAX_RECV_MESSAGE_SIZE = 4;
const DEFAULT_TLS_SERVER_CERTS_DIR = '/tls/server';

/** Specification for a single CLI flag. */
export interface FlagSpec {
  type: 'string' | 'boolean';
  default?: string | boolean;
  short?: string;
  /** Primary environment variable. */
  env?: string;
  /** Fallback environment variables checked when the primary is not set. */
  envAliases?: string[];
  description: string;
}

const standardFlags: Record<string, FlagSpec> = {
  address: {
    type: 'string',
    default: DEFAULT_ADDRESS,
    env: 'ADDRESS',
    description: `Address to listen for gRPC connections. Default ${DEFAULT_ADDRESS}.`,
  },
  debug: {
    type: 'boolean',
    default: false,
    short: 'd',
    env: 'DEBUG',
    description: 'Emit debug logs.',
  },
  insecure: {
    type: 'boolean',
    default: false,
    env: 'INSECURE',
    description: 'Run without mTLS credentials.',
  },
  'max-recv-message-size': {
    type: 'string',
    default: String(DEFAULT_MAX_RECV_MESSAGE_SIZE),
    env: 'MAX_RECV_MESSAGE_SIZE',
    envAliases: ['MAX_GRPC_MESSAGE_SIZE'],
    description: `Maximum size of received gRPC messages in MB. Default ${DEFAULT_MAX_RECV_MESSAGE_SIZE}.`,
  },
  'max-send-message-size': {
    type: 'string',
    env: 'MAX_SEND_MESSAGE_SIZE',
    description: 'Maximum size of sent gRPC messages in MB. Defaults to --max-recv-message-size.',
  },
  'tls-server-certs-dir': {
    type: 'string',
    default: DEFAULT_TLS_SERVER_CERTS_DIR,
    env: 'TLS_SERVER_CERTS_DIR',
    description: `Directory holding tls.key, tls.crt and ca.crt. Default ${DEFAULT_TLS_SERVER_CERTS_DIR}.`,
  },
  help: {
    type: 'boolean',
    default: false,
    short: 'h',
    description: 'Show this help.',
  },
};

/** Options accepted by the {@link CLI} constructor. */
export interface CLIOptions {
  /** Program name shown in help text. Defaults to the running script's basename. */
  name?: string;

  /** Custom flags to register alongside the standard ones. */
  flags?: Record<string, FlagSpec>;
}

/**
 * A shareable, extensible CLI for Crossplane composition functions.
 *
 * Provides the standard flags (address, debug, insecure, tls-server-certs-dir,
 * max-recv-message-size, help) with environment variable support, and lets
 * function authors register additional flags.
 *
 * Resolution order per flag: CLI argument > environment variable > default.
 */
export class CLI {
  private readonly programName: string;
  private readonly allFlags: Record<string, FlagSpec>;
  private values: Record<string, string | boolean | undefined> = {};

  constructor(opts?: CLIOptions) {
    this.programName = opts?.name ?? defaultName();

    const custom = opts?.flags ?? {};
    for (const name of Object.keys(custom)) {
      if (name in standardFlags) {
        throw new Error(`flag "${name}" conflicts with a standard flag`);
      }
    }
    this.allFlags = { ...standardFlags, ...custom };
  }

  /**
   * Parse command-line arguments.
   *
   * For each flag the resolution order is: CLI argument, then environment
   * variable (if configured), then the declared default.
   *
   * @param argv - Arguments without the node executable or script path.
   *   Defaults to `process.argv.slice(2)`.
   * @returns All parsed values keyed by flag name.
   * @throws If a flag is unrecognized, missing its value, or given a value it
   *   does not accept.
   */
  parse(argv?: string[]): Record<string, string | boolean | undefined> {
    const args = argv ?? process.argv.slice(2);

    const parseOptions: Record<string, { type: string; short?: string; default?: boolean }> = {};
    for (const [name, spec] of Object.entries(this.allFlags)) {
      const opt: { type: string; short?: string; default?: boolean } = { type: spec.type };
      if (spec.short) opt.short = spec.short;
      if (spec.type === 'boolean') opt.default = false;
      parseOptions[name] = opt;
    }

    const { values } = parseNodeArgs({
      args,
      options: parseOptions as NonNullable<Parameters<typeof parseNodeArgs>[0]>['options'],
      allowPositionals: false,
    });

    const parsed = values as Record<string, string | boolean | undefined>;

    for (const [name, spec] of Object.entries(this.allFlags)) {
      this.values[name] = resolveValue(spec, parsed[name]);
    }

    return { ...this.values };
  }

  /** Return {@link ServerOptions} derived from the standard flags. */
  standardOptions(): ServerOptions {
    const maxRecvMB = parseInt(String(this.values['max-recv-message-size']), 10);
    const recvBytes = (isNaN(maxRecvMB) ? DEFAULT_MAX_RECV_MESSAGE_SIZE : maxRecvMB) * 1024 * 1024;

    const sendRaw = this.values['max-send-message-size'];
    const maxSendMB = sendRaw !== undefined ? parseInt(String(sendRaw), 10) : NaN;
    const sendBytes = isNaN(maxSendMB) ? undefined : maxSendMB * 1024 * 1024;

    return {
      address: this.values['address'] as string,
      debug: this.values['debug'] as boolean,
      insecure: this.values['insecure'] as boolean,
      tlsServerCertsDir: this.values['tls-server-certs-dir'] as string,
      maxRecvMessageSize: recvBytes,
      maxSendMessageSize: sendBytes,
    };
  }

  /** Return a pino {@link Logger} configured from the --debug flag. */
  logger(): Logger {
    return pino({
      level: this.values['debug'] ? 'debug' : 'info',
      formatters: {
        level: (label: string) => ({ severity: label.toUpperCase() }),
      },
    });
  }

  /** Generate help text that includes both standard and custom flags. */
  helpText(): string {
    const usage = Object.entries(this.allFlags).map(([flag, spec]) => {
      const short = spec.short ? `-${spec.short}, ` : '    ';
      const value = spec.type === 'string' ? ' <value>' : '';
      const env = spec.env ? ` [env: ${spec.env}]` : '';
      return `  ${short}--${flag}${value}`.padEnd(38) + spec.description + env;
    });
    return [
      `Usage: ${this.programName} [flags]`,
      '',
      'A Crossplane composition function.',
      '',
      'Flags:',
      ...usage,
    ].join('\n');
  }

  /** The program name used in help text. */
  get name(): string {
    return this.programName;
  }
}

function resolveValue(
  spec: FlagSpec,
  cliValue: string | boolean | undefined
): string | boolean | undefined {
  const givenOnCli =
    spec.type === 'string' ? cliValue !== undefined : (cliValue as boolean) === true;

  if (givenOnCli) return cliValue;

  const envKeys = [spec.env, ...(spec.envAliases ?? [])].filter(Boolean) as string[];
  for (const key of envKeys) {
    const envValue = process.env[key];
    if (envValue !== undefined) {
      return spec.type === 'boolean'
        ? envValue === '1' || envValue.toLowerCase() === 'true'
        : envValue;
    }
  }

  return spec.default;
}

function defaultName(): string {
  const script = process.argv[1];
  return script ? basename(script) : 'function';
}
