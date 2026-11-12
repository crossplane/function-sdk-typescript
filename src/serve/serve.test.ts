import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CLI } from '../cli/cli.js';
import {
  DEFAULT_ADDRESS,
  DEFAULT_TLS_SERVER_CERTS_DIR,
  fromCompose,
  helpText,
  parseArgs,
  serve,
  usageErrorText,
  type ComposeFunction,
} from './serve.js';
import { Resource, RunFunctionRequest } from '../proto/run_function.js';
import { Severity } from '../proto/run_function.js';
import { fatal, to } from '../response/response.js';

// parseArgs reads the standard environment variables, so clear them to keep
// the tests independent of the environment they run in.
const standardEnv = [
  'ADDRESS',
  'DEBUG',
  'INSECURE',
  'TLS_SERVER_CERTS_DIR',
  'MAX_RECV_MESSAGE_SIZE',
  'MAX_GRPC_MESSAGE_SIZE',
  'MAX_SEND_MESSAGE_SIZE',
];

beforeEach(() => {
  for (const key of standardEnv) vi.stubEnv(key, undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('parseArgs', () => {
  it('should default every flag', () => {
    expect(parseArgs([])).toEqual({
      address: DEFAULT_ADDRESS,
      debug: false,
      insecure: false,
      tlsServerCertsDir: DEFAULT_TLS_SERVER_CERTS_DIR,
      maxRecvMessageSize: 4 * 1024 * 1024,
      maxSendMessageSize: undefined,
      help: false,
    });
  });

  it('should read the standard environment variables', () => {
    // serve is built on parseArgs' parser, so this is what lets tooling
    // configure every function the same way, whether or not it declares flags
    // of its own.
    vi.stubEnv('ADDRESS', '127.0.0.1:19999');
    vi.stubEnv('MAX_RECV_MESSAGE_SIZE', '16');
    const opts = parseArgs([]);
    expect(opts.address).toBe('127.0.0.1:19999');
    expect(opts.maxRecvMessageSize).toBe(16 * 1024 * 1024);
  });

  it('should parse the message size flags', () => {
    const opts = parseArgs(['--max-recv-message-size', '16', '--max-send-message-size', '32']);
    expect(opts.maxRecvMessageSize).toBe(16 * 1024 * 1024);
    expect(opts.maxSendMessageSize).toBe(32 * 1024 * 1024);
  });

  it('should treat an empty environment variable as unset', () => {
    // A container that sets value: "" for one of these variables would
    // otherwise take the default away and hand the server an empty address.
    for (const key of standardEnv) vi.stubEnv(key, '');

    expect(parseArgs([])).toEqual({
      address: DEFAULT_ADDRESS,
      debug: false,
      insecure: false,
      tlsServerCertsDir: DEFAULT_TLS_SERVER_CERTS_DIR,
      maxRecvMessageSize: 4 * 1024 * 1024,
      maxSendMessageSize: undefined,
      help: false,
    });
  });

  it('should parse flags given as separate arguments', () => {
    const opts = parseArgs([
      '--address',
      'localhost:1234',
      '--tls-server-certs-dir',
      '/certs',
      '--debug',
      '--insecure',
    ]);
    expect(opts).toEqual({
      address: 'localhost:1234',
      debug: true,
      insecure: true,
      tlsServerCertsDir: '/certs',
      maxRecvMessageSize: 4 * 1024 * 1024,
      maxSendMessageSize: undefined,
      help: false,
    });
  });

  it('should parse flags given as --flag=value', () => {
    const opts = parseArgs(['--address=0.0.0.0:9999', '--tls-server-certs-dir=/certs']);
    expect(opts.address).toBe('0.0.0.0:9999');
    expect(opts.tlsServerCertsDir).toBe('/certs');
  });

  it('should accept the short debug flag', () => {
    expect(parseArgs(['-d']).debug).toBe(true);
  });

  it('should record whether help was asked for', () => {
    expect(parseArgs([]).help).toBe(false);
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
  });

  it('should reject an unrecognised flag', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown option '--nope'/);
  });

  it('should reject a flag missing its value', () => {
    expect(() => parseArgs(['--address'])).toThrow(/argument missing/);
  });

  it('should reject a value given to a boolean flag', () => {
    // The hand-rolled parser this replaced reported this as an unrecognised
    // flag, which misdiagnoses it.
    expect(() => parseArgs(['--debug=false'])).toThrow(/does not take an argument/);
  });
});

describe('helpText', () => {
  it('should name the program and list every flag', () => {
    const help = helpText('my-function');
    expect(help).toContain('Usage: my-function');
    for (const flag of [
      '--address',
      '--debug',
      '--insecure',
      '--max-recv-message-size',
      '--max-send-message-size',
      '--tls-server-certs-dir',
      '--help',
    ]) {
      expect(help).toContain(flag);
    }
  });

  it('should stay in step with the parser', () => {
    // Help is derived from the same flag table the parser uses, so anything
    // it lists must parse.
    const help = helpText('fn');
    const listed = [...help.matchAll(/--([a-z-]+)/g)].map((m) => m[1]);
    expect(listed.length).toBeGreaterThan(0);
    for (const flag of listed) {
      expect(() => parseArgs([`--${flag}`, 'x'])).not.toThrow(/Unknown option/);
    }
  });
});

describe('serve', () => {
  /** Thrown by the stubbed process.exit, so serve stops where the process would. */
  class Exit extends Error {
    constructor(readonly code: number | string | null | undefined) {
      super(`process.exit(${code})`);
    }
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Run serve with argv, returning its exit code and what it wrote to stdout. */
  function run(opts: Parameters<typeof serve>[1]): {
    code: unknown;
    stdout: string;
    stderr: string;
  } {
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Exit(code);
    });
    let stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
    let stderr = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });

    try {
      serve((_req, rsp) => rsp, opts);
    } catch (error) {
      if (error instanceof Exit) return { code: error.code, stdout, stderr };
      throw error;
    }
    throw new Error('serve did not exit');
  }

  it('should print custom flags after the standard ones, leaving those untouched', () => {
    const cli = new CLI({
      name: 'my-fn',
      flags: {
        'cache-size': {
          type: 'string',
          default: '100',
          env: 'CACHE_SIZE',
          description: 'Number of entries to cache.',
        },
        verbose: { type: 'boolean', short: 'v', description: 'Enable verbose output.' },
      },
    });

    const { code, stdout } = run({ cli, argv: ['--help'] });

    expect(code).toBe(0);

    // The standard flags print exactly as they do for a function with no
    // flags of its own: same lines, same order, same alignment.
    const standard = helpText('my-fn').split('\n');
    const printed = stdout.trimEnd().split('\n');
    expect(printed.slice(0, standard.length)).toEqual(standard);

    // The custom flags follow, in declaration order, aligned to the same
    // description column as the standard ones.
    const column = standard.find((l) => l.includes('--address'))!.indexOf('Address');
    expect(printed.slice(standard.length)).toEqual([
      '      --cache-size <value>'.padEnd(column) + 'Number of entries to cache. [env: CACHE_SIZE]',
      '  -v, --verbose'.padEnd(column) + 'Enable verbose output.',
    ]);
  });

  it('should print only the standard flags without a CLI of its own', () => {
    const { code, stdout } = run({ name: 'my-fn', argv: ['--help'] });

    expect(code).toBe(0);
    expect(stdout).toBe(`${helpText('my-fn')}\n`);
  });

  it('should report an address grpc-js cannot parse as a usage error', () => {
    // grpc-js throws this synchronously from bindAsync, so without catching
    // it the process dies with a stack trace through grpc-js's internals.
    const { code, stderr } = run({
      name: 'my-fn',
      argv: [],
      // insecure, so we reach bindAsync instead of reading TLS certs.
      serverOptions: { address: '', insecure: true },
    });

    expect(code).toBe(2);
    expect(stderr).toContain('my-fn: Could not parse port ""');
    expect(stderr).toContain("Try 'my-fn --help' for the available flags.");
  });
});

describe('usageErrorText', () => {
  it('should surface the parser message and point at --help', () => {
    let thrown: unknown;
    try {
      parseArgs(['--nope']);
    } catch (error) {
      thrown = error;
    }

    const text = usageErrorText('main.js', thrown);

    expect(text).toBe(
      "main.js: Unknown option '--nope'\nTry 'main.js --help' for the available flags."
    );
  });

  it('should not leak a stack trace', () => {
    const text = usageErrorText('fn', new Error('boom'));
    expect(text).not.toContain('    at ');
    expect(text.split('\n')).toHaveLength(2);
  });

  it('should cope with something that is not an Error', () => {
    expect(usageErrorText('fn', 'plain string')).toContain('fn: plain string');
  });
});

describe('fromCompose', () => {
  const request = (): RunFunctionRequest =>
    RunFunctionRequest.fromJSON({
      observed: {
        composite: {
          resource: {
            apiVersion: 'example.crossplane.io/v1alpha1',
            kind: 'Example',
            metadata: { name: 'example' },
          },
        },
      },
    });

  it('should hand the compose function a response with desired already populated', async () => {
    const compose: ComposeFunction = (_req, rsp) => {
      // The point of ComposeResponse: no non-null assertion needed here.
      rsp.desired.resources['vpc'] = Resource.fromJSON({
        resource: { apiVersion: 'ec2.aws.upbound.io/v1beta1', kind: 'VPC' },
      });
      return rsp;
    };

    const rsp = await fromCompose(compose).RunFunction(request());

    expect(rsp.desired?.resources['vpc']?.resource).toEqual({
      apiVersion: 'ec2.aws.upbound.io/v1beta1',
      kind: 'VPC',
    });
  });

  it('should await an async compose function', async () => {
    const compose: ComposeFunction = async (_req, rsp) => {
      await Promise.resolve();
      rsp.desired.resources['late'] = Resource.fromJSON({ resource: { kind: 'Late' } });
      return rsp;
    };

    const rsp = await fromCompose(compose).RunFunction(request());

    expect(Object.keys(rsp.desired?.resources ?? {})).toContain('late');
  });

  it('should carry through results the compose function adds', async () => {
    const compose: ComposeFunction = (_req, rsp) => {
      fatal(rsp, 'nope');
      return rsp;
    };

    const rsp = await fromCompose(compose).RunFunction(request());

    expect(rsp.results).toHaveLength(1);
    expect(rsp.results[0]?.severity).toBe(Severity.SEVERITY_FATAL);
    expect(rsp.results[0]?.message).toBe('nope');
  });

  it('should preserve desired state accumulated by earlier functions', async () => {
    const req = RunFunctionRequest.fromJSON({
      desired: {
        resources: {
          existing: { resource: { kind: 'Existing' } },
        },
      },
    });

    const compose: ComposeFunction = (_req, rsp) => {
      rsp.desired.resources['added'] = Resource.fromJSON({ resource: { kind: 'Added' } });
      return rsp;
    };

    const rsp = await fromCompose(compose).RunFunction(req);

    expect(Object.keys(rsp.desired?.resources ?? {}).sort()).toEqual(['added', 'existing']);
  });

  it('should use the response the compose function returns, not the one it was given', async () => {
    // The response is a convenience, not an out parameter — a compose function
    // is free to build and return its own.
    const compose: ComposeFunction = (req) => {
      const own = to(req);
      own.desired = { composite: undefined, resources: {} };
      own.desired.resources['mine'] = Resource.fromJSON({ resource: { kind: 'Mine' } });
      return own;
    };

    const rsp = await fromCompose(compose).RunFunction(request());

    expect(Object.keys(rsp.desired?.resources ?? {})).toEqual(['mine']);
  });

  it('should hand back a response whose desired state aliases the request', async () => {
    // Documented behaviour inherited from to(): when the request already
    // carries desired state, rsp.desired is that same object rather than a
    // copy, so writes through rsp are visible on req. Pinned here so that
    // changing it is a deliberate act rather than an accident.
    const req = RunFunctionRequest.fromJSON({
      desired: { resources: { existing: { resource: { kind: 'Existing' } } } },
    });

    const compose: ComposeFunction = (_req, rsp) => {
      rsp.desired.resources['added'] = Resource.fromJSON({ resource: { kind: 'Added' } });
      return rsp;
    };

    await fromCompose(compose).RunFunction(req);

    expect(Object.keys(req.desired?.resources ?? {}).sort()).toEqual(['added', 'existing']);
  });

  it('should let errors propagate so FunctionRunner can report them', async () => {
    const compose: ComposeFunction = () => {
      throw new Error('boom');
    };

    await expect(fromCompose(compose).RunFunction(request())).rejects.toThrow('boom');
  });
});
