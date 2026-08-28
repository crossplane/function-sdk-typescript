import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ADDRESS,
  DEFAULT_TLS_SERVER_CERTS_DIR,
  fromCompose,
  helpText,
  parseArgs,
  usageErrorText,
  type ComposeFunction,
} from './serve.js';
import { Resource, RunFunctionRequest } from '../proto/run_function.js';
import { Severity } from '../proto/run_function.js';
import { fatal, to } from '../response/response.js';

describe('parseArgs', () => {
  it('should default every flag', () => {
    expect(parseArgs([])).toEqual({
      address: DEFAULT_ADDRESS,
      debug: false,
      insecure: false,
      tlsServerCertsDir: DEFAULT_TLS_SERVER_CERTS_DIR,
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
    for (const flag of ['--address', '--debug', '--insecure', '--tls-server-certs-dir', '--help']) {
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

describe('usageErrorText', () => {
  it('should surface the parser message and point at --help', () => {
    let thrown: unknown;
    try {
      parseArgs(['--nope']);
    } catch (error) {
      thrown = error;
    }

    const text = usageErrorText('main.js', thrown);

    expect(text).toBe("main.js: Unknown option '--nope'\nTry 'main.js --help' for the available flags.");
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
