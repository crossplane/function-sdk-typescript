import { describe, it, expect } from 'vitest';
import {
  fatal,
  normal,
  setContextKey,
  setDesiredComposedResources,
  setDesiredCompositeResource,
  setDesiredCompositeStatus,
  setDesiredResources,
  setOutput,
  requireSchema,
  requireResource,
  to,
  warning,
} from './response.js';
import type { RunFunctionResponse } from '../proto/run_function.js';
import { Ready, RunFunctionRequest } from '../proto/run_function.js';

describe('setDesiredCompositeStatus', () => {
  it('should set status when desired.composite.resource exists', () => {
    const rsp: RunFunctionResponse = {
      conditions: [],
      context: undefined,
      desired: {
        composite: {
          resource: {
            apiVersion: 'example.org/v1',
            kind: 'XR',
            metadata: {
              name: 'test-xr',
            },
          },
          connectionDetails: {},
          ready: 0,
        },
        resources: {},
      },
      meta: { tag: '', ttl: { seconds: 60, nanos: 0 } },
      requirements: undefined,
      results: [],
    };

    const status = {
      phase: 'Ready',
      conditions: [{ type: 'Synced', status: 'True' }],
    };

    setDesiredCompositeStatus({ rsp, status });

    expect(rsp.desired?.composite?.resource?.status).toEqual(status);
    expect(rsp.desired?.composite?.resource?.apiVersion).toBe('example.org/v1');
    expect(rsp.desired?.composite?.resource?.kind).toBe('XR');
  });

  it('should set status when desired.composite.resource is undefined', () => {
    const rsp: RunFunctionResponse = {
      conditions: [],
      context: undefined,
      desired: {
        composite: {
          resource: undefined,
          connectionDetails: {},
          ready: 0,
        },
        resources: {},
      },
      meta: { tag: '', ttl: { seconds: 60, nanos: 0 } },
      requirements: undefined,
      results: [],
    };

    const status = {
      phase: 'Pending',
      message: 'Waiting for resources',
    };

    setDesiredCompositeStatus({ rsp, status });

    expect(rsp.desired?.composite?.resource?.status).toEqual(status);
    expect(rsp.desired?.composite?.resource).toBeDefined();
  });

  it('should set status when desired.composite is undefined', () => {
    const rsp: RunFunctionResponse = {
      conditions: [],
      context: undefined,
      desired: {
        composite: undefined,
        resources: {},
      },
      meta: { tag: '', ttl: { seconds: 60, nanos: 0 } },
      requirements: undefined,
      results: [],
    };

    const status = {
      observedGeneration: 5,
      conditions: [
        { type: 'Ready', status: 'True', reason: 'Available' },
        { type: 'Synced', status: 'True', reason: 'ReconcileSuccess' },
      ],
    };

    setDesiredCompositeStatus({ rsp, status });

    expect(rsp.desired?.composite?.resource?.status).toEqual(status);
    expect(rsp.desired?.composite).toBeDefined();
    expect(rsp.desired?.composite?.resource).toBeDefined();
  });

  it('should set status when desired is undefined', () => {
    const rsp: RunFunctionResponse = {
      conditions: [],
      context: undefined,
      desired: undefined,
      meta: { tag: '', ttl: { seconds: 60, nanos: 0 } },
      requirements: undefined,
      results: [],
    };

    const status = {
      message: 'Initializing',
      ready: false,
    };

    setDesiredCompositeStatus({ rsp, status });

    expect(rsp.desired).toBeDefined();
    expect(rsp.desired?.composite).toBeDefined();
    expect(rsp.desired?.composite?.resource).toBeDefined();
    expect(rsp.desired?.composite?.resource?.status).toEqual(status);
  });

  it('should merge status with existing status fields', () => {
    const rsp: RunFunctionResponse = {
      conditions: [],
      context: undefined,
      desired: {
        composite: {
          resource: {
            apiVersion: 'example.org/v1',
            kind: 'XR',
            metadata: {
              name: 'test-xr',
            },
            status: {
              existingField: 'preserved',
              conditions: [{ type: 'OldCondition', status: 'False' }],
            },
          },
          connectionDetails: {},
          ready: 0,
        },
        resources: {},
      },
      meta: { tag: '', ttl: { seconds: 60, nanos: 0 } },
      requirements: undefined,
      results: [],
    };

    const status = {
      phase: 'Ready',
      conditions: [{ type: 'NewCondition', status: 'True' }],
    };

    setDesiredCompositeStatus({ rsp, status });

    expect(rsp.desired?.composite?.resource?.status?.existingField).toBe('preserved');
    expect(rsp.desired?.composite?.resource?.status?.phase).toBe('Ready');
    // Note: merge will combine the arrays
    expect(rsp.desired?.composite?.resource?.status?.conditions).toHaveLength(2);
  });

  it('should handle complex nested status objects', () => {
    const rsp: RunFunctionResponse = {
      conditions: [],
      context: undefined,
      desired: undefined,
      meta: { tag: '', ttl: { seconds: 60, nanos: 0 } },
      requirements: undefined,
      results: [],
    };

    const status = {
      phase: 'Running',
      observedGeneration: 10,
      conditions: [
        {
          type: 'DatabaseReady',
          status: 'True',
          lastTransitionTime: '2024-01-01T00:00:00Z',
          reason: 'ProvisioningComplete',
          message: 'Database is ready',
        },
      ],
      atProvider: {
        id: 'db-12345',
        endpoint: 'db.example.com',
        port: 5432,
        connectionPool: {
          maxConnections: 100,
          currentConnections: 45,
        },
      },
    };

    setDesiredCompositeStatus({ rsp, status });

    expect(rsp.desired?.composite?.resource?.status).toEqual(status);
    expect(
      rsp.desired?.composite?.resource?.status?.atProvider?.connectionPool?.maxConnections
    ).toBe(100);
  });

  it('should preserve other resource fields when setting status', () => {
    const rsp: RunFunctionResponse = {
      conditions: [],
      context: undefined,
      desired: {
        composite: {
          resource: {
            apiVersion: 'example.org/v1',
            kind: 'XR',
            metadata: {
              name: 'test-xr',
              namespace: 'production',
              labels: {
                app: 'myapp',
              },
            },
            spec: {
              region: 'us-west-2',
              replicas: 3,
            },
          },
          connectionDetails: {
            password: Buffer.from('secret'),
          },
          ready: Ready.READY_TRUE,
        },
        resources: {},
      },
      meta: { tag: '', ttl: { seconds: 60, nanos: 0 } },
      requirements: undefined,
      results: [],
    };

    const status = {
      phase: 'Ready',
    };

    setDesiredCompositeStatus({ rsp, status });

    // Verify status was set
    expect(rsp.desired?.composite?.resource?.status).toEqual(status);

    // Verify other fields preserved
    expect(rsp.desired?.composite?.resource?.apiVersion).toBe('example.org/v1');
    expect(rsp.desired?.composite?.resource?.kind).toBe('XR');
    expect(rsp.desired?.composite?.resource?.metadata?.name).toBe('test-xr');
    expect(rsp.desired?.composite?.resource?.metadata?.namespace).toBe('production');
    expect(rsp.desired?.composite?.resource?.metadata?.labels?.app).toBe('myapp');
    expect(rsp.desired?.composite?.resource?.spec?.region).toBe('us-west-2');
    expect(rsp.desired?.composite?.resource?.spec?.replicas).toBe(3);

    // Verify connection details and ready status preserved
    expect(rsp.desired?.composite?.connectionDetails?.password).toEqual(Buffer.from('secret'));
    expect(rsp.desired?.composite?.ready).toBe(Ready.READY_TRUE);
  });
});

describe('setDesiredResources', () => {
  it('should set resources from unstructured objects', () => {
    const rsp: RunFunctionResponse = {
      conditions: [],
      context: undefined,
      desired: {
        composite: undefined,
        resources: {},
      },
      meta: { tag: '', ttl: { seconds: 60, nanos: 0 } },
      requirements: undefined,
      results: [],
    };

    const resources = {
      'my-bucket': {
        apiVersion: 's3.aws.upbound.io/v1beta1',
        kind: 'Bucket',
        metadata: { name: 'my-bucket' },
        spec: { forProvider: { region: 'us-west-2' } },
      },
      'my-db': {
        apiVersion: 'rds.aws.upbound.io/v1beta1',
        kind: 'Instance',
        metadata: { name: 'my-db' },
        spec: { forProvider: { instanceClass: 'db.t3.micro' } },
      },
    };

    setDesiredResources(rsp, resources);

    expect(rsp.desired?.resources).toBeDefined();
    expect(Object.keys(rsp.desired?.resources || {})).toHaveLength(2);
    expect(rsp.desired?.resources?.['my-bucket']?.resource?.kind).toBe('Bucket');
    expect(rsp.desired?.resources?.['my-db']?.resource?.kind).toBe('Instance');
    expect(rsp.desired?.resources?.['my-bucket']?.resource?.spec?.forProvider?.region).toBe(
      'us-west-2'
    );
  });

  it('should set resources when desired is undefined', () => {
    const rsp: RunFunctionResponse = {
      conditions: [],
      context: undefined,
      desired: undefined,
      meta: { tag: '', ttl: { seconds: 60, nanos: 0 } },
      requirements: undefined,
      results: [],
    };

    const resources = {
      'my-resource': {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: 'my-config' },
        data: { key: 'value' },
      },
    };

    setDesiredResources(rsp, resources);

    expect(rsp.desired).toBeDefined();
    expect(rsp.desired?.resources).toBeDefined();
    expect(rsp.desired?.resources?.['my-resource']?.resource?.kind).toBe('ConfigMap');
    expect(rsp.desired?.resources?.['my-resource']?.resource?.data?.key).toBe('value');
  });

  it('should merge with existing resources', () => {
    const rsp: RunFunctionResponse = {
      conditions: [],
      context: undefined,
      desired: {
        composite: undefined,
        resources: {
          'existing-resource': {
            resource: {
              apiVersion: 'v1',
              kind: 'Secret',
              metadata: { name: 'existing' },
            },
            connectionDetails: {},
            ready: Ready.READY_TRUE,
          },
        },
      },
      meta: { tag: '', ttl: { seconds: 60, nanos: 0 } },
      requirements: undefined,
      results: [],
    };

    const resources = {
      'new-resource': {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: 'new' },
      },
    };

    setDesiredResources(rsp, resources);

    expect(Object.keys(rsp.desired?.resources || {})).toHaveLength(2);
    expect(rsp.desired?.resources?.['existing-resource']?.resource?.kind).toBe('Secret');
    expect(rsp.desired?.resources?.['new-resource']?.resource?.kind).toBe('ConfigMap');
  });

  it('should handle complex nested resource structures', () => {
    const rsp: RunFunctionResponse = {
      conditions: [],
      context: undefined,
      desired: undefined,
      meta: { tag: '', ttl: { seconds: 60, nanos: 0 } },
      requirements: undefined,
      results: [],
    };

    const resources = {
      'complex-resource': {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: {
          name: 'my-app',
          namespace: 'production',
          labels: {
            app: 'myapp',
            version: 'v1',
          },
        },
        spec: {
          replicas: 3,
          selector: {
            matchLabels: {
              app: 'myapp',
            },
          },
          template: {
            metadata: {
              labels: {
                app: 'myapp',
              },
            },
            spec: {
              containers: [
                {
                  name: 'app',
                  image: 'myapp:v1',
                  ports: [{ containerPort: 8080 }],
                },
              ],
            },
          },
        },
      },
    };

    setDesiredResources(rsp, resources);

    expect(rsp.desired?.resources?.['complex-resource']?.resource?.kind).toBe('Deployment');
    expect(rsp.desired?.resources?.['complex-resource']?.resource?.spec?.replicas).toBe(3);
    expect(
      rsp.desired?.resources?.['complex-resource']?.resource?.spec?.template?.spec?.containers[0]
        ?.name
    ).toBe('app');
  });

  it('should handle empty resources object', () => {
    const rsp: RunFunctionResponse = {
      conditions: [],
      context: undefined,
      desired: {
        composite: undefined,
        resources: {},
      },
      meta: { tag: '', ttl: { seconds: 60, nanos: 0 } },
      requirements: undefined,
      results: [],
    };

    setDesiredResources(rsp, {});

    expect(rsp.desired?.resources).toBeDefined();
    expect(Object.keys(rsp.desired?.resources || {})).toHaveLength(0);
  });
});

describe('requireSchema', () => {
  it('should add a schema requirement to an empty response', () => {
    const rsp: RunFunctionResponse = {
      conditions: [],
      context: undefined,
      desired: undefined,
      meta: { tag: '', ttl: { seconds: 60, nanos: 0 } },
      requirements: undefined,
      results: [],
    };

    requireSchema(rsp, 'xr-schema', 'example.org/v1', 'MyResource');

    expect(rsp.requirements).toBeDefined();
    expect(rsp.requirements?.schemas).toBeDefined();
    expect(rsp.requirements?.schemas?.['xr-schema']).toEqual({
      apiVersion: 'example.org/v1',
      kind: 'MyResource',
    });
  });

  it('should add a schema requirement when requirements already exist', () => {
    const rsp: RunFunctionResponse = {
      conditions: [],
      context: undefined,
      desired: undefined,
      meta: { tag: '', ttl: { seconds: 60, nanos: 0 } },
      requirements: {
        extraResources: {},
        resources: {
          'existing-resource': {
            apiVersion: 'v1',
            kind: 'ConfigMap',
            matchName: 'my-config',
          },
        },
        schemas: {},
      },
      results: [],
    };

    requireSchema(rsp, 'composite-schema', 'database.example.org/v1', 'Database');

    expect(rsp.requirements?.resources?.['existing-resource']).toBeDefined();
    expect(rsp.requirements?.schemas?.['composite-schema']).toEqual({
      apiVersion: 'database.example.org/v1',
      kind: 'Database',
    });
  });

  it('should add multiple schema requirements', () => {
    const rsp: RunFunctionResponse = {
      conditions: [],
      context: undefined,
      desired: undefined,
      meta: { tag: '', ttl: { seconds: 60, nanos: 0 } },
      requirements: undefined,
      results: [],
    };

    requireSchema(rsp, 'xr-schema', 'example.org/v1', 'XR');
    requireSchema(rsp, 'composed-schema', 'example.org/v1', 'ComposedResource');
    requireSchema(rsp, 'claim-schema', 'example.org/v1', 'Claim');

    expect(Object.keys(rsp.requirements?.schemas || {})).toHaveLength(3);
    expect(rsp.requirements?.schemas?.['xr-schema']?.kind).toBe('XR');
    expect(rsp.requirements?.schemas?.['composed-schema']?.kind).toBe('ComposedResource');
    expect(rsp.requirements?.schemas?.['claim-schema']?.kind).toBe('Claim');
  });

  it('should overwrite existing schema requirement with same name', () => {
    const rsp: RunFunctionResponse = {
      conditions: [],
      context: undefined,
      desired: undefined,
      meta: { tag: '', ttl: { seconds: 60, nanos: 0 } },
      requirements: {
        extraResources: {},
        resources: {},
        schemas: {
          'my-schema': {
            apiVersion: 'old.example.org/v1',
            kind: 'OldKind',
          },
        },
      },
      results: [],
    };

    requireSchema(rsp, 'my-schema', 'new.example.org/v2', 'NewKind');

    expect(rsp.requirements?.schemas?.['my-schema']).toEqual({
      apiVersion: 'new.example.org/v2',
      kind: 'NewKind',
    });
  });
});

describe('requireResource', () => {
  it('should add a resource requirement by name', () => {
    const rsp: RunFunctionResponse = {
      conditions: [],
      context: undefined,
      desired: undefined,
      meta: { tag: '', ttl: { seconds: 60, nanos: 0 } },
      requirements: undefined,
      results: [],
    };

    requireResource(rsp, 'app-config', {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      matchName: 'my-app-config',
      namespace: 'production',
    });

    expect(rsp.requirements).toBeDefined();
    expect(rsp.requirements?.resources).toBeDefined();
    expect(rsp.requirements?.resources?.['app-config']).toEqual({
      apiVersion: 'v1',
      kind: 'ConfigMap',
      matchName: 'my-app-config',
      namespace: 'production',
    });
  });

  it('should add a resource requirement by labels', () => {
    const rsp: RunFunctionResponse = {
      conditions: [],
      context: undefined,
      desired: undefined,
      meta: { tag: '', ttl: { seconds: 60, nanos: 0 } },
      requirements: undefined,
      results: [],
    };

    requireResource(rsp, 'db-secrets', {
      apiVersion: 'v1',
      kind: 'Secret',
      matchLabels: {
        labels: {
          app: 'database',
          tier: 'backend',
        },
      },
      namespace: 'production',
    });

    expect(rsp.requirements?.resources?.['db-secrets']).toEqual({
      apiVersion: 'v1',
      kind: 'Secret',
      matchLabels: {
        labels: {
          app: 'database',
          tier: 'backend',
        },
      },
      namespace: 'production',
    });
  });

  it('should add multiple resource requirements', () => {
    const rsp: RunFunctionResponse = {
      conditions: [],
      context: undefined,
      desired: undefined,
      meta: { tag: '', ttl: { seconds: 60, nanos: 0 } },
      requirements: undefined,
      results: [],
    };

    requireResource(rsp, 'config', {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      matchName: 'app-config',
    });

    requireResource(rsp, 'secret', {
      apiVersion: 'v1',
      kind: 'Secret',
      matchName: 'app-secret',
    });

    expect(Object.keys(rsp.requirements?.resources || {})).toHaveLength(2);
    expect(rsp.requirements?.resources?.['config']?.kind).toBe('ConfigMap');
    expect(rsp.requirements?.resources?.['secret']?.kind).toBe('Secret');
  });

  it('should add resource requirement when schemas already exist', () => {
    const rsp: RunFunctionResponse = {
      conditions: [],
      context: undefined,
      desired: undefined,
      meta: { tag: '', ttl: { seconds: 60, nanos: 0 } },
      requirements: {
        extraResources: {},
        resources: {},
        schemas: {
          'existing-schema': {
            apiVersion: 'example.org/v1',
            kind: 'MyKind',
          },
        },
      },
      results: [],
    };

    requireResource(rsp, 'namespaces', {
      apiVersion: 'v1',
      kind: 'Namespace',
      matchLabels: {
        labels: {
          environment: 'production',
        },
      },
    });

    expect(rsp.requirements?.schemas?.['existing-schema']).toBeDefined();
    expect(rsp.requirements?.resources?.['namespaces']).toEqual({
      apiVersion: 'v1',
      kind: 'Namespace',
      matchLabels: {
        labels: {
          environment: 'production',
        },
      },
    });
  });

  it('should handle cluster-scoped resources without namespace', () => {
    const rsp: RunFunctionResponse = {
      conditions: [],
      context: undefined,
      desired: undefined,
      meta: { tag: '', ttl: { seconds: 60, nanos: 0 } },
      requirements: undefined,
      results: [],
    };

    requireResource(rsp, 'all-namespaces', {
      apiVersion: 'v1',
      kind: 'Namespace',
      matchLabels: {
        labels: {
          managed: 'true',
        },
      },
    });

    expect(rsp.requirements?.resources?.['all-namespaces']?.namespace).toBeUndefined();
  });

  it('should overwrite existing resource requirement with same name', () => {
    const rsp: RunFunctionResponse = {
      conditions: [],
      context: undefined,
      desired: undefined,
      meta: { tag: '', ttl: { seconds: 60, nanos: 0 } },
      requirements: {
        extraResources: {},
        resources: {
          'my-resource': {
            apiVersion: 'v1',
            kind: 'ConfigMap',
            matchName: 'old-config',
          },
        },
        schemas: {},
      },
      results: [],
    };

    requireResource(rsp, 'my-resource', {
      apiVersion: 'v1',
      kind: 'Secret',
      matchName: 'new-secret',
    });

    expect(rsp.requirements?.resources?.['my-resource']).toEqual({
      apiVersion: 'v1',
      kind: 'Secret',
      matchName: 'new-secret',
    });
  });
});

describe('response helper return contract', () => {
  // Every helper that takes a response mutates it in place and returns nothing,
  // matching the Go and Python SDKs. Pinned here so a helper cannot quietly go
  // back to returning the response and reintroduce the ambiguity of issue #33.
  it('returns undefined from every response mutator', () => {
    const rsp = to(RunFunctionRequest.fromJSON({}));

    expect(fatal(rsp, 'm')).toBeUndefined();
    expect(normal(rsp, 'm')).toBeUndefined();
    expect(warning(rsp, 'm')).toBeUndefined();
    expect(setDesiredComposedResources(rsp, {})).toBeUndefined();
    expect(setDesiredResources(rsp, {})).toBeUndefined();
    expect(
      setDesiredCompositeResource(rsp, {
        resource: {},
        connectionDetails: {},
        ready: Ready.READY_UNSPECIFIED,
      })
    ).toBeUndefined();
    expect(setDesiredCompositeStatus({ rsp, status: {} })).toBeUndefined();
    expect(setContextKey(rsp, 'k', 'v')).toBeUndefined();
    expect(setOutput(rsp, {})).toBeUndefined();
    expect(requireSchema(rsp, 'n', 'example.org/v1', 'Kind')).toBeUndefined();
    expect(requireResource(rsp, 'n', { apiVersion: 'v1', kind: 'ConfigMap' })).toBeUndefined();
  });

  it('applies the mutations to the response it was given', () => {
    const rsp = to(RunFunctionRequest.fromJSON({}));

    normal(rsp, 'created');
    setContextKey(rsp, 'endpoint', 'db.example.com:5432');

    expect(rsp.results).toHaveLength(1);
    expect(rsp.context?.['endpoint']).toBe('db.example.com:5432');
  });
});
