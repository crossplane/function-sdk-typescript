import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CLI } from './cli.js';

describe('CLI', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const envVars = [
    'ADDRESS',
    'DEBUG',
    'INSECURE',
    'TLS_SERVER_CERTS_DIR',
    'MAX_RECV_MESSAGE_SIZE',
    'MAX_GRPC_MESSAGE_SIZE',
    'MAX_SEND_MESSAGE_SIZE',
    'MY_FLAG',
  ];

  beforeEach(() => {
    for (const key of envVars) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envVars) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  describe('parse', () => {
    it('should default every standard flag', () => {
      const cli = new CLI({ name: 'test' });
      const values = cli.parse([]);

      expect(values).toEqual({
        address: '0.0.0.0:9443',
        debug: false,
        insecure: false,
        'max-recv-message-size': '4',
        'max-send-message-size': undefined,
        'tls-server-certs-dir': '/tls/server',
        help: false,
      });
    });

    it('should parse standard flags', () => {
      const cli = new CLI({ name: 'test' });
      const values = cli.parse([
        '--address',
        'localhost:1234',
        '--debug',
        '--insecure',
        '--tls-server-certs-dir',
        '/certs',
      ]);

      expect(values.address).toBe('localhost:1234');
      expect(values.debug).toBe(true);
      expect(values.insecure).toBe(true);
      expect(values['tls-server-certs-dir']).toBe('/certs');
    });

    it('should accept short flags', () => {
      const cli = new CLI({ name: 'test' });
      expect(cli.parse(['-d']).debug).toBe(true);
      expect(new CLI({ name: 'test' }).parse(['-h']).help).toBe(true);
    });

    it('should reject unrecognized flags', () => {
      const cli = new CLI({ name: 'test' });
      expect(() => cli.parse(['--nope'])).toThrow(/Unknown option '--nope'/);
    });

    it('should parse custom flags alongside standard ones', () => {
      const cli = new CLI({
        name: 'test',
        flags: {
          'my-flag': {
            type: 'string',
            default: 'foo',
            env: 'MY_FLAG',
            description: 'My custom flag.',
          },
          verbose: {
            type: 'boolean',
            default: false,
            description: 'Verbose output.',
          },
        },
      });

      const values = cli.parse(['--my-flag', 'bar', '--verbose', '--debug']);
      expect(values['my-flag']).toBe('bar');
      expect(values.verbose).toBe(true);
      expect(values.debug).toBe(true);
    });

    it('should reject custom flags that conflict with standard flags', () => {
      expect(
        () =>
          new CLI({
            flags: {
              debug: { type: 'boolean', description: 'Conflict.' },
            },
          })
      ).toThrow(/flag "debug" conflicts with a standard flag/);
    });
  });

  describe('environment variables', () => {
    it('should read string flags from env when not given on CLI', () => {
      process.env.ADDRESS = 'env-address:9999';
      const cli = new CLI({ name: 'test' });
      const values = cli.parse([]);

      expect(values.address).toBe('env-address:9999');
    });

    it('should read boolean flags from env', () => {
      process.env.DEBUG = 'true';
      const cli = new CLI({ name: 'test' });

      expect(cli.parse([]).debug).toBe(true);
    });

    it('should accept "1" as truthy for boolean env vars', () => {
      process.env.INSECURE = '1';
      const cli = new CLI({ name: 'test' });

      expect(cli.parse([]).insecure).toBe(true);
    });

    it('should treat other env values as falsy for booleans', () => {
      process.env.DEBUG = 'no';
      const cli = new CLI({ name: 'test' });

      expect(cli.parse([]).debug).toBe(false);
    });

    it('should prefer CLI argument over env var', () => {
      process.env.ADDRESS = 'env-address:9999';
      const cli = new CLI({ name: 'test' });
      const values = cli.parse(['--address', 'cli-address:8888']);

      expect(values.address).toBe('cli-address:8888');
    });

    it('should read custom flag env vars', () => {
      process.env.MY_FLAG = 'from-env';
      const cli = new CLI({
        name: 'test',
        flags: {
          'my-flag': {
            type: 'string',
            default: 'default-val',
            env: 'MY_FLAG',
            description: 'Test.',
          },
        },
      });

      expect(cli.parse([])['my-flag']).toBe('from-env');
    });

    it('should read MAX_GRPC_MESSAGE_SIZE as alias for MAX_RECV_MESSAGE_SIZE', () => {
      process.env.MAX_GRPC_MESSAGE_SIZE = '16';
      const cli = new CLI({ name: 'test' });

      expect(cli.parse([])['max-recv-message-size']).toBe('16');
    });

    it('should prefer MAX_RECV_MESSAGE_SIZE over MAX_GRPC_MESSAGE_SIZE', () => {
      process.env.MAX_RECV_MESSAGE_SIZE = '8';
      process.env.MAX_GRPC_MESSAGE_SIZE = '16';
      const cli = new CLI({ name: 'test' });

      expect(cli.parse([])['max-recv-message-size']).toBe('8');
    });

    it('should prefer env over default but CLI over env', () => {
      process.env.MY_FLAG = 'from-env';
      const cli = new CLI({
        name: 'test',
        flags: {
          'my-flag': {
            type: 'string',
            default: 'default-val',
            env: 'MY_FLAG',
            description: 'Test.',
          },
        },
      });

      expect(cli.parse(['--my-flag', 'from-cli'])['my-flag']).toBe('from-cli');
    });
  });

  describe('standardOptions', () => {
    it('should return ServerOptions from parsed standard flags', () => {
      const cli = new CLI({ name: 'test' });
      cli.parse(['--address', 'localhost:5555', '--debug', '--insecure']);

      expect(cli.standardOptions()).toEqual({
        address: 'localhost:5555',
        debug: true,
        insecure: true,
        tlsServerCertsDir: '/tls/server',
        maxRecvMessageSize: 4 * 1024 * 1024,
      });
    });

    it('should convert max-recv-message-size from MB to bytes', () => {
      const cli = new CLI({ name: 'test' });
      cli.parse(['--max-recv-message-size', '8']);

      expect(cli.standardOptions().maxRecvMessageSize).toBe(8 * 1024 * 1024);
    });

    it('should default maxSendMessageSize to undefined when not set', () => {
      const cli = new CLI({ name: 'test' });
      cli.parse([]);

      expect(cli.standardOptions().maxSendMessageSize).toBeUndefined();
    });

    it('should convert max-send-message-size from MB to bytes', () => {
      const cli = new CLI({ name: 'test' });
      cli.parse(['--max-send-message-size', '16']);

      expect(cli.standardOptions().maxSendMessageSize).toBe(16 * 1024 * 1024);
    });

    it('should reflect env vars in standard options', () => {
      process.env.ADDRESS = 'env:1111';
      process.env.DEBUG = 'true';
      const cli = new CLI({ name: 'test' });
      cli.parse([]);

      const opts = cli.standardOptions();
      expect(opts.address).toBe('env:1111');
      expect(opts.debug).toBe(true);
    });
  });

  describe('logger', () => {
    it('should return info-level logger by default', () => {
      const cli = new CLI({ name: 'test' });
      cli.parse([]);

      expect(cli.logger().level).toBe('info');
    });

    it('should return debug-level logger when --debug is set', () => {
      const cli = new CLI({ name: 'test' });
      cli.parse(['--debug']);

      expect(cli.logger().level).toBe('debug');
    });
  });

  describe('helpText', () => {
    it('should include program name and all standard flags', () => {
      const cli = new CLI({ name: 'my-fn' });
      const help = cli.helpText();

      expect(help).toContain('Usage: my-fn');
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

    it('should include custom flags', () => {
      const cli = new CLI({
        name: 'my-fn',
        flags: {
          'my-flag': {
            type: 'string',
            default: 'foo',
            env: 'MY_FLAG',
            description: 'My custom flag.',
          },
        },
      });
      const help = cli.helpText();

      expect(help).toContain('--my-flag');
      expect(help).toContain('My custom flag.');
      expect(help).toContain('[env: MY_FLAG]');
    });

    it('should show env var hints for standard flags', () => {
      const cli = new CLI({ name: 'test' });
      const help = cli.helpText();

      for (const env of [
        'ADDRESS',
        'DEBUG',
        'INSECURE',
        'MAX_RECV_MESSAGE_SIZE',
        'MAX_SEND_MESSAGE_SIZE',
        'TLS_SERVER_CERTS_DIR',
      ]) {
        expect(help).toContain(`[env: ${env}]`);
      }
    });
  });

  describe('name', () => {
    it('should return the configured program name', () => {
      const cli = new CLI({ name: 'my-function' });
      expect(cli.name).toBe('my-function');
    });
  });
});
