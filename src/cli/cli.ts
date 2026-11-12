/**
 * A shareable CLI for composition functions.
 *
 * The {@link CLI} class provides the standard flags every composition function
 * accepts, reads environment variables, and lets function authors add custom
 * flags. {@link serve} is built on it, so every function honours the same
 * flags and environment variables whether or not it declares flags of its own.
 *
 * Functions that need extra flags create a CLI and hand it to serve, which
 * parses it, handles --help and reports usage errors:
 *
 * @example
 * ```typescript
 * const cli = new CLI({
 *   flags: {
 *     'my-flag': { type: 'string', default: 'foo', env: 'MY_FLAG', description: 'My custom flag.' },
 *   },
 * });
 *
 * serve(compose, { cli });
 *
 * // serve has parsed the CLI by the time it returns.
 * const myFlag = cli.values['my-flag'];
 * ```
 */

import { basename } from 'node:path';
import { parseArgs as parseNodeArgs } from 'node:util';
import { pino, type Logger } from 'pino';
import type { ServerOptions } from '../runtime/runtime.js';

/** The address a function listens on unless told otherwise. */
export const DEFAULT_ADDRESS = '0.0.0.0:9443';

/**
 * Where the package reconciler mounts the TLS certificates it generates.
 */
export const DEFAULT_TLS_SERVER_CERTS_DIR = '/tls/server';

/** The default maximum size of a received gRPC message, in megabytes. */
export const DEFAULT_MAX_RECV_MESSAGE_SIZE = 4;

/** Specification for a single CLI flag. */
export interface FlagSpec {
  type: 'string' | 'boolean';
  /**
   * Value used when neither the flag nor its environment variable is set.
   * Boolean flags may only default to false, since a boolean flag set on the
   * command line can only turn something on.
   */
  default?: string | boolean;
  short?: string;
  /** Primary environment variable. */
  env?: string;
  /** Fallback environment variables checked when the primary is not set. */
  envAliases?: string[];
  description: string;
}

/** The value of a parsed flag. */
export type FlagValue = string | boolean | undefined;

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

/** Standard flags whose value is a whole number of megabytes. */
const megabyteFlags = ['max-recv-message-size', 'max-send-message-size'];

/**
 * The largest value the gRPC message size channel arguments take: they are
 * passed to grpc-js as int32.
 */
const MAX_MESSAGE_SIZE_BYTES = 2147483647;

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
 * max-recv-message-size, max-send-message-size, help) with environment
 * variable support, and lets function authors register additional flags.
 *
 * Resolution order per flag: CLI argument > environment variable > default.
 * An empty string from either source is treated as unset.
 */
export class CLI {
  private readonly programName: string;
  private readonly allFlags: Record<string, FlagSpec>;
  private parsedValues?: Record<string, FlagValue>;

  /**
   * @throws If a custom flag reuses a standard flag's name or another flag's
   *   short alias, or is a boolean flag that defaults to true.
   */
  constructor(opts?: CLIOptions) {
    this.programName = opts?.name ?? defaultName();

    const custom = opts?.flags ?? {};
    for (const name of Object.keys(custom)) {
      if (name in standardFlags) {
        throw new Error(`flag "${name}" conflicts with a standard flag`);
      }
    }
    this.allFlags = { ...standardFlags, ...custom };

    const shorts = new Map<string, string>();
    for (const [name, spec] of Object.entries(this.allFlags)) {
      if (spec.type === 'boolean' && spec.default === true) {
        throw new Error(
          `boolean flag "${name}" cannot default to true, since it could not be turned off`
        );
      }
      if (spec.short === undefined) continue;
      const other = shorts.get(spec.short);
      if (other !== undefined) {
        throw new Error(`flag "${name}" reuses short alias -${spec.short} of flag "${other}"`);
      }
      shorts.set(spec.short, name);
    }
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
  parse(argv?: string[]): Record<string, FlagValue> {
    const args = argv ?? process.argv.slice(2);

    const parseOptions: Record<string, { type: string; short?: string }> = {};
    for (const [name, spec] of Object.entries(this.allFlags)) {
      const opt: { type: string; short?: string } = { type: spec.type };
      if (spec.short) opt.short = spec.short;
      parseOptions[name] = opt;
    }

    const { values } = parseNodeArgs({
      args,
      options: parseOptions as NonNullable<Parameters<typeof parseNodeArgs>[0]>['options'],
      allowPositionals: false,
    });

    const parsed = values as Record<string, FlagValue>;

    const resolved: Record<string, FlagValue> = {};
    for (const [name, spec] of Object.entries(this.allFlags)) {
      resolved[name] = resolveValue(spec, parsed[name]);
    }

    // Check the sizes now, so that a bad value is reported as a usage error
    // rather than silently replaced by a default once the server starts.
    for (const name of megabyteFlags) {
      const value = resolved[name];
      if (value !== undefined) toBytes(name, this.allFlags[name], String(value));
    }

    this.parsedValues = resolved;
    return { ...resolved };
  }

  /**
   * The values from the last call to {@link parse}.
   *
   * @throws If {@link parse} has not been called.
   */
  get values(): Readonly<Record<string, FlagValue>> {
    if (this.parsedValues === undefined) {
      throw new Error('CLI.parse() must be called before reading its values');
    }
    return this.parsedValues;
  }

  /** Whether {@link parse} has been called. */
  get parsed(): boolean {
    return this.parsedValues !== undefined;
  }

  /**
   * Return {@link ServerOptions} derived from the standard flags.
   *
   * @throws If {@link parse} has not been called.
   */
  standardOptions(): ServerOptions {
    const values = this.values;
    const send = values['max-send-message-size'];

    return {
      address: values['address'] as string,
      debug: values['debug'] as boolean,
      insecure: values['insecure'] as boolean,
      tlsServerCertsDir: values['tls-server-certs-dir'] as string,
      maxRecvMessageSize: toBytes(
        'max-recv-message-size',
        this.allFlags['max-recv-message-size'],
        String(values['max-recv-message-size'])
      ),
      maxSendMessageSize:
        send === undefined
          ? undefined
          : toBytes('max-send-message-size', this.allFlags['max-send-message-size'], String(send)),
    };
  }

  /**
   * Return a pino {@link Logger} configured from the --debug flag.
   *
   * @throws If {@link parse} has not been called.
   */
  logger(): Logger {
    return newLogger(this.values['debug'] === true);
  }

  /** Generate help text that includes both standard and custom flags. */
  helpText(): string {
    const rows = Object.entries(this.allFlags).map(([flag, spec]) => {
      const short = spec.short ? `-${spec.short}, ` : '    ';
      const value = spec.type === 'string' ? ' <value>' : '';
      const envKeys = [spec.env, ...(spec.envAliases ?? [])].filter(Boolean);
      const env = envKeys.length > 0 ? ` [env: ${envKeys.join(', ')}]` : '';
      return { usage: `  ${short}--${flag}${value}`, description: spec.description + env };
    });
    // Size the column to the longest flag, so a long custom flag name cannot
    // run into its description.
    const width = Math.max(...rows.map((r) => r.usage.length)) + 2;
    const usage = rows.map((r) => r.usage.padEnd(width) + r.description);
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

/**
 * Create the logger a function uses: JSON, with the level reported as
 * `severity` so that log collectors pick it up.
 */
export function newLogger(debug: boolean): Logger {
  return pino({
    level: debug ? 'debug' : 'info',
    formatters: {
      level: (label: string) => ({ severity: label.toUpperCase() }),
    },
  });
}

function resolveValue(spec: FlagSpec, cliValue: FlagValue): FlagValue {
  // node:util leaves a flag that was not given undefined, and a boolean flag
  // can only be given as true, so undefined means "not on the command line".
  //
  // An empty string means the same thing. A pod spec with `value: ""` and an
  // empty argument both say nothing about the value itself, and letting one
  // through would reach the server as an empty listen address or, for
  // tls-server-certs-dir, silently downgrade TLS to plaintext.
  if (cliValue !== undefined && cliValue !== '') return cliValue;

  const envKeys = [spec.env, ...(spec.envAliases ?? [])].filter(Boolean) as string[];
  for (const key of envKeys) {
    const envValue = process.env[key];
    if (envValue !== undefined && envValue !== '') {
      return spec.type === 'boolean'
        ? envValue === '1' || envValue.toLowerCase() === 'true'
        : envValue;
    }
  }

  return spec.type === 'boolean' ? (spec.default ?? false) : spec.default;
}

/**
 * Convert a size in megabytes to bytes.
 *
 * @throws If the value is not a positive whole number, or is larger than the
 *   32-bit limit grpc-js imposes on the message size channel arguments.
 */
function toBytes(name: string, spec: FlagSpec | undefined, value: string): number {
  const envKeys = [spec?.env, ...(spec?.envAliases ?? [])].filter(Boolean);
  const source = [`--${name}`, ...envKeys].join(' or ');

  // Leading zeros are allowed: 0007 and 7 mean the same thing.
  if (!/^[0-9]+$/.test(value) || Number(value) === 0) {
    throw new Error(
      `${source} must be a positive whole number of megabytes, got ${JSON.stringify(value)}`
    );
  }

  const bytes = Number(value) * 1024 * 1024;
  // grpc-js passes these to its channel as int32, so a larger number would
  // silently overflow into a different limit rather than being honoured.
  if (bytes > MAX_MESSAGE_SIZE_BYTES) {
    const maxMegabytes = Math.floor(MAX_MESSAGE_SIZE_BYTES / 1024 / 1024);
    throw new Error(`${source} must be at most ${maxMegabytes} MB, got ${JSON.stringify(value)}`);
  }
  return bytes;
}

function defaultName(): string {
  const script = process.argv[1];
  return script ? basename(script) : 'function';
}
