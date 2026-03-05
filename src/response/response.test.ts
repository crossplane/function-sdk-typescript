import { describe, it, expect } from 'vitest';
import {
  setDesiredCompositeStatus,
  setDesiredResources,
  requireSchema,
  requireResource,
} from './response.js';
import type { RunFunctionResponse } from '../proto/run_function.js';
import { Ready } from '../proto/run_function.js';

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

    const result = setDesiredCompositeStatus({ rsp, status });

    expect(result.desired?.composite?.resource?.status).toEqual(status);
    expect(result.desired?.composite?.resource?.apiVersion).toBe('example.org/v1');
    expect(result.desired?.composite?.resource?.kind).toBe('XR');
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

    const result = setDesiredCompositeStatus({ rsp, status });

    expect(result.desired?.composite?.resource?.status).toEqual(status);
    expect(result.desired?.composite?.resource).toBeDefined();
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

    const result = setDesiredCompositeStatus({ rsp, status });

    expect(result.desired?.composite?.resource?.status).toEqual(status);
    expect(result.desired?.composite).toBeDefined();
    expect(result.desired?.composite?.resource).toBeDefined();
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

    const result = setDesiredCompositeStatus({ rsp, status });

    expect(result.desired).toBeDefined();
    expect(result.desired?.composite).toBeDefined();
    expect(result.desired?.composite?.resource).toBeDefined();
    expect(result.desired?.composite?.resource?.status).toEqual(status);
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

    const result = setDesiredCompositeStatus({ rsp, status });

    expect(result.desired?.composite?.resource?.status?.existingField).toBe('preserved');
    expect(result.desired?.composite?.resource?.status?.phase).toBe('Ready');
    // Note: merge will combine the arrays
    expect(result.desired?.composite?.resource?.status?.conditions).toHaveLength(2);
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

    const result = setDesiredCompositeStatus({ rsp, status });

    expect(result.desired?.composite?.resource?.status).toEqual(status);
    expect(
      result.desired?.composite?.resource?.status?.atProvider?.connectionPool?.maxConnections
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

    const result = setDesiredCompositeStatus({ rsp, status });

    // Verify status was set
    expect(result.desired?.composite?.resource?.status).toEqual(status);

    // Verify other fields preserved
    expect(result.desired?.composite?.resource?.apiVersion).toBe('example.org/v1');
    expect(result.desired?.composite?.resource?.kind).toBe('XR');
    expect(result.desired?.composite?.resource?.metadata?.name).toBe('test-xr');
    expect(result.desired?.composite?.resource?.metadata?.namespace).toBe('production');
    expect(result.desired?.composite?.resource?.metadata?.labels?.app).toBe('myapp');
    expect(result.desired?.composite?.resource?.spec?.region).toBe('us-west-2');
    expect(result.desired?.composite?.resource?.spec?.replicas).toBe(3);

    // Verify connection details and ready status preserved
    expect(result.desired?.composite?.connectionDetails?.password).toEqual(Buffer.from('secret'));
    expect(result.desired?.composite?.ready).toBe(Ready.READY_TRUE);
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

    const result = setDesiredResources(rsp, resources);

    expect(result.desired?.resources).toBeDefined();
    expect(Object.keys(result.desired?.resources || {})).toHaveLength(2);
    expect(result.desired?.resources?.['my-bucket']?.resource?.kind).toBe('Bucket');
    expect(result.desired?.resources?.['my-db']?.resource?.kind).toBe('Instance');
    expect(result.desired?.resources?.['my-bucket']?.resource?.spec?.forProvider?.region).toBe(
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

    const result = setDesiredResources(rsp, resources);

    expect(result.desired).toBeDefined();
    expect(result.desired?.resources).toBeDefined();
    expect(result.desired?.resources?.['my-resource']?.resource?.kind).toBe('ConfigMap');
    expect(result.desired?.resources?.['my-resource']?.resource?.data?.key).toBe('value');
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

    const result = setDesiredResources(rsp, resources);

    expect(Object.keys(result.desired?.resources || {})).toHaveLength(2);
    expect(result.desired?.resources?.['existing-resource']?.resource?.kind).toBe('Secret');
    expect(result.desired?.resources?.['new-resource']?.resource?.kind).toBe('ConfigMap');
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

    const result = setDesiredResources(rsp, resources);

    expect(result.desired?.resources?.['complex-resource']?.resource?.kind).toBe('Deployment');
    expect(result.desired?.resources?.['complex-resource']?.resource?.spec?.replicas).toBe(3);
    expect(
      result.desired?.resources?.['complex-resource']?.resource?.spec?.template?.spec?.containers[0]
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

    const result = setDesiredResources(rsp, {});

    expect(result.desired?.resources).toBeDefined();
    expect(Object.keys(result.desired?.resources || {})).toHaveLength(0);
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

    const result = requireSchema(rsp, 'xr-schema', 'example.org/v1', 'MyResource');

    expect(result.requirements).toBeDefined();
    expect(result.requirements?.schemas).toBeDefined();
    expect(result.requirements?.schemas?.['xr-schema']).toEqual({
      $type: 'apiextensions.fn.proto.v1.SchemaSelector',
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

    const result = requireSchema(rsp, 'composite-schema', 'database.example.org/v1', 'Database');

    expect(result.requirements?.resources?.['existing-resource']).toBeDefined();
    expect(result.requirements?.schemas?.['composite-schema']).toEqual({
      $type: 'apiextensions.fn.proto.v1.SchemaSelector',
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

    let result = requireSchema(rsp, 'xr-schema', 'example.org/v1', 'XR');
    result = requireSchema(result, 'composed-schema', 'example.org/v1', 'ComposedResource');
    result = requireSchema(result, 'claim-schema', 'example.org/v1', 'Claim');

    expect(Object.keys(result.requirements?.schemas || {})).toHaveLength(3);
    expect(result.requirements?.schemas?.['xr-schema']?.kind).toBe('XR');
    expect(result.requirements?.schemas?.['composed-schema']?.kind).toBe('ComposedResource');
    expect(result.requirements?.schemas?.['claim-schema']?.kind).toBe('Claim');
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

    const result = requireSchema(rsp, 'my-schema', 'new.example.org/v2', 'NewKind');

    expect(result.requirements?.schemas?.['my-schema']).toEqual({
      $type: 'apiextensions.fn.proto.v1.SchemaSelector',
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

    const result = requireResource(rsp, 'app-config', {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      matchName: 'my-app-config',
      namespace: 'production',
    });

    expect(result.requirements).toBeDefined();
    expect(result.requirements?.resources).toBeDefined();
    expect(result.requirements?.resources?.['app-config']).toEqual({
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

    const result = requireResource(rsp, 'db-secrets', {
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

    expect(result.requirements?.resources?.['db-secrets']).toEqual({
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

    let result = requireResource(rsp, 'config', {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      matchName: 'app-config',
    });

    result = requireResource(result, 'secret', {
      apiVersion: 'v1',
      kind: 'Secret',
      matchName: 'app-secret',
    });

    expect(Object.keys(result.requirements?.resources || {})).toHaveLength(2);
    expect(result.requirements?.resources?.['config']?.kind).toBe('ConfigMap');
    expect(result.requirements?.resources?.['secret']?.kind).toBe('Secret');
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

    const result = requireResource(rsp, 'namespaces', {
      apiVersion: 'v1',
      kind: 'Namespace',
      matchLabels: {
        labels: {
          environment: 'production',
        },
      },
    });

    expect(result.requirements?.schemas?.['existing-schema']).toBeDefined();
    expect(result.requirements?.resources?.['namespaces']).toEqual({
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

    const result = requireResource(rsp, 'all-namespaces', {
      apiVersion: 'v1',
      kind: 'Namespace',
      matchLabels: {
        labels: {
          managed: 'true',
        },
      },
    });

    expect(result.requirements?.resources?.['all-namespaces']?.namespace).toBeUndefined();
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

    const result = requireResource(rsp, 'my-resource', {
      apiVersion: 'v1',
      kind: 'Secret',
      matchName: 'new-secret',
    });

    expect(result.requirements?.resources?.['my-resource']).toEqual({
      apiVersion: 'v1',
      kind: 'Secret',
      matchName: 'new-secret',
    });
  });
});
