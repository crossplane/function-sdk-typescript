import { describe, it, expect } from 'vitest';
import {
  getDesiredCompositeResource,
  getObservedCompositeResource,
  getDesiredComposedResources,
  getObservedComposedResources,
  getInput,
  getContextKey,
  getRequiredResources,
  getCredentials,
  getRequiredResource,
  getRequiredSchema,
  getRequiredSchemas,
  advertiseCapabilities,
  hasCapability,
  getWatchedResource,
} from './request.js';
import type {
  RunFunctionRequest,
  Resource,
  Resources,
  Credentials,
} from '../proto/run_function.js';
import { Capability } from '../proto/run_function.js';

describe('getDesiredCompositeResource', () => {
  it('should return undefined when no desired composite exists', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    const result = getDesiredCompositeResource(req);
    expect(result).toBeUndefined();
  });

  it('should return undefined when desired exists but composite is missing', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: {
        composite: undefined,
        resources: {},
      },
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    const result = getDesiredCompositeResource(req);
    expect(result).toBeUndefined();
  });

  it('should return the desired composite resource when it exists', () => {
    const compositeResource: Resource = {
      resource: {
        apiVersion: 'example.org/v1',
        kind: 'XR',
        metadata: {
          name: 'test-xr',
        },
      },
      connectionDetails: {
        password: Buffer.from('secret'),
      },
      ready: 0,
    };

    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: {
        composite: compositeResource,
        resources: {},
      },
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    const result = getDesiredCompositeResource(req);
    expect(result).toEqual(compositeResource);
    expect(result?.resource?.metadata?.name).toBe('test-xr');
  });
});

describe('getObservedCompositeResource', () => {
  it('should return undefined when no observed composite exists', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    const result = getObservedCompositeResource(req);
    expect(result).toBeUndefined();
  });

  it('should return the observed composite resource when it exists', () => {
    const compositeResource: Resource = {
      resource: {
        apiVersion: 'example.org/v1',
        kind: 'XR',
        metadata: {
          name: 'observed-xr',
        },
      },
      connectionDetails: {
        username: Buffer.from('admin'),
      },
      ready: 0,
    };

    const req: RunFunctionRequest = {
      meta: undefined,
      observed: {
        composite: compositeResource,
        resources: {},
      },
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    const result = getObservedCompositeResource(req);
    expect(result).toEqual(compositeResource);
    expect(result?.resource?.metadata?.name).toBe('observed-xr');
  });
});

describe('getDesiredComposedResources', () => {
  it('should return empty object when no desired composed resources exist', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    const result = getDesiredComposedResources(req);
    expect(result).toEqual({});
    expect(Object.keys(result).length).toBe(0);
  });

  it('should return empty object when desired exists but resources is undefined', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: {
        composite: undefined,
        resources: {},
      },
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    const result = getDesiredComposedResources(req);
    expect(result).toEqual({});
  });

  it('should return desired composed resources when they exist', () => {
    const resources: { [key: string]: Resource } = {
      bucket: {
        resource: {
          apiVersion: 's3.aws.upbound.io/v1beta1',
          kind: 'Bucket',
          metadata: {
            name: 'my-bucket',
          },
        },
        connectionDetails: {},
        ready: 2, // READY_TRUE
      },
      database: {
        resource: {
          apiVersion: 'rds.aws.upbound.io/v1beta1',
          kind: 'Instance',
          metadata: {
            name: 'my-db',
          },
        },
        connectionDetails: {},
        ready: 2,
      },
    };

    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: {
        composite: undefined,
        resources,
      },
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    const result = getDesiredComposedResources(req);
    expect(result).toEqual(resources);
    expect(Object.keys(result).length).toBe(2);
    expect(result['bucket']?.resource?.kind).toBe('Bucket');
    expect(result['database']?.resource?.kind).toBe('Instance');
  });
});

describe('getObservedComposedResources', () => {
  it('should return empty object when no observed composed resources exist', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    const result = getObservedComposedResources(req);
    expect(result).toEqual({});
    expect(Object.keys(result).length).toBe(0);
  });

  it('should return observed composed resources when they exist', () => {
    const resources: { [key: string]: Resource } = {
      server: {
        resource: {
          apiVersion: 'ec2.aws.upbound.io/v1beta1',
          kind: 'Instance',
          metadata: {
            name: 'my-server',
            annotations: {
              'crossplane.io/external-name': 'i-1234567890abcdef0',
            },
          },
        },
        connectionDetails: {
          endpoint: Buffer.from('https://server.example.com'),
        },
        ready: 0,
      },
    };

    const req: RunFunctionRequest = {
      meta: undefined,
      observed: {
        composite: undefined,
        resources,
      },
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    const result = getObservedComposedResources(req);
    expect(result).toEqual(resources);
    expect(Object.keys(result).length).toBe(1);
    expect(result['server']?.resource?.metadata?.name).toBe('my-server');
  });
});

describe('getInput', () => {
  it('should return undefined when no input exists', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    const result = getInput(req);
    expect(result).toBeUndefined();
  });

  it('should return the input configuration when it exists', () => {
    const input = {
      apiVersion: 'function.example.org/v1beta1',
      kind: 'Input',
      spec: {
        region: 'us-west-2',
        replicas: 3,
      },
    };

    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    const result = getInput(req);
    expect(result).toEqual(input);
    expect((result as any)?.spec?.region).toBe('us-west-2');
    expect((result as any)?.spec?.replicas).toBe(3);
  });

  it('should handle empty input object', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: {},
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    const result = getInput(req);
    expect(result).toEqual({});
  });
});

describe('getContextKey', () => {
  it('should return [undefined, false] when context does not exist', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    const [value, found] = getContextKey(req, 'apiserver-kind');
    expect(value).toBeUndefined();
    expect(found).toBe(false);
  });

  it('should return [undefined, false] when key does not exist in context', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: {
        'existing-key': 'some-value',
      },
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    const [value, found] = getContextKey(req, 'non-existent-key');
    expect(value).toBeUndefined();
    expect(found).toBe(false);
  });

  it('should return [value, true] when key exists in context', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: {
        'apiserver-kind': 'ConfigMap',
        'apiserver-name': 'my-config',
        'custom-data': {
          nested: {
            value: 42,
          },
        },
      },
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    const [kind, kindFound] = getContextKey(req, 'apiserver-kind');
    expect(kind).toBe('ConfigMap');
    expect(kindFound).toBe(true);

    const [name, nameFound] = getContextKey(req, 'apiserver-name');
    expect(name).toBe('my-config');
    expect(nameFound).toBe(true);

    const [data, dataFound] = getContextKey(req, 'custom-data');
    expect(data).toEqual({ nested: { value: 42 } });
    expect(dataFound).toBe(true);
  });

  it('should handle context with null or undefined values', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: {
        'null-value': null,
        'undefined-value': undefined,
      },
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    const [nullValue, nullFound] = getContextKey(req, 'null-value');
    expect(nullValue).toBeNull();
    expect(nullFound).toBe(true);

    const [undefinedValue, undefinedFound] = getContextKey(req, 'undefined-value');
    expect(undefinedValue).toBeUndefined();
    expect(undefinedFound).toBe(true);
  });
});

describe('getRequiredResources', () => {
  it('should return empty object when no required resources exist', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    const result = getRequiredResources(req);
    expect(result).toEqual({});
    expect(Object.keys(result).length).toBe(0);
  });

  it('should return required resources for cluster-scoped resources', () => {
    const resources: Resources = {
      items: [
        {
          resource: {
            apiVersion: 'v1',
            kind: 'Namespace',
            metadata: {
              name: 'production',
            },
          },
          connectionDetails: {},
          ready: 0,
        },
      ],
    };

    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {
        namespaces: resources,
      },
      requiredSchemas: {},
    };

    const result = getRequiredResources(req);
    expect(Object.keys(result).length).toBe(1);
    expect(result['namespaces']).toEqual(resources);
    expect(result['namespaces']?.items[0]?.resource?.kind).toBe('Namespace');
  });

  it('should return required resources for namespace-scoped resources', () => {
    const resources: Resources = {
      items: [
        {
          resource: {
            apiVersion: 'v1',
            kind: 'ConfigMap',
            metadata: {
              name: 'app-config',
              namespace: 'production',
            },
          },
          connectionDetails: {},
          ready: 0,
        },
        {
          resource: {
            apiVersion: 'v1',
            kind: 'Secret',
            metadata: {
              name: 'app-secret',
              namespace: 'production',
            },
          },
          connectionDetails: {},
          ready: 0,
        },
      ],
    };

    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {
        'config-and-secrets': resources,
      },
      requiredSchemas: {},
    };

    const result = getRequiredResources(req);
    expect(Object.keys(result).length).toBe(1);
    expect(result['config-and-secrets']?.items.length).toBe(2);
    expect(result['config-and-secrets']?.items[0]?.resource?.kind).toBe('ConfigMap');
    expect(result['config-and-secrets']?.items[1]?.resource?.kind).toBe('Secret');
  });

  it('should handle multiple required resource groups', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {
        group1: { items: [] },
        group2: { items: [] },
        group3: { items: [] },
      },
      requiredSchemas: {},
    };

    const result = getRequiredResources(req);
    expect(Object.keys(result).length).toBe(3);
    expect(result['group1']).toBeDefined();
    expect(result['group2']).toBeDefined();
    expect(result['group3']).toBeDefined();
  });
});

describe('getCredentials', () => {
  it('should throw error when no credentials exist', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    expect(() => getCredentials(req, 'aws-creds')).toThrow('credentials "aws-creds" not found');
  });

  it('should throw error when credential name does not exist', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {
        'azure-creds': {
          credentialData: {
            data: {
              clientId: Buffer.from('azure-client-id'),
            },
          },
        },
      },
      requiredResources: {},
      requiredSchemas: {},
    };

    expect(() => getCredentials(req, 'aws-creds')).toThrow('credentials "aws-creds" not found');
  });

  it('should return credentials when they exist', () => {
    const awsCreds: Credentials = {
      credentialData: {
        data: {
          access_key_id: Buffer.from('AKIAIOSFODNN7EXAMPLE'),
          secret_access_key: Buffer.from('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'),
        },
      },
    };

    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {
        'aws-creds': awsCreds,
      },
      requiredResources: {},
      requiredSchemas: {},
    };

    const result = getCredentials(req, 'aws-creds');
    expect(result).toEqual(awsCreds);
    expect(result?.credentialData?.data['access_key_id']).toEqual(
      Buffer.from('AKIAIOSFODNN7EXAMPLE')
    );
  });

  it('should handle multiple credentials', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {
        'aws-creds': {
          credentialData: {
            data: {
              key: Buffer.from('aws-key'),
            },
          },
        },
        'gcp-creds': {
          credentialData: {
            data: {
              json: Buffer.from('{"type":"service_account"}'),
            },
          },
        },
      },
      requiredResources: {},
      requiredSchemas: {},
    };

    const awsResult = getCredentials(req, 'aws-creds');
    expect(awsResult).toBeDefined();
    expect(awsResult?.credentialData?.data['key']).toEqual(Buffer.from('aws-key'));

    const gcpResult = getCredentials(req, 'gcp-creds');
    expect(gcpResult).toBeDefined();
    expect(gcpResult?.credentialData?.data['json']).toEqual(
      Buffer.from('{"type":"service_account"}')
    );
  });

  it('should handle credentials with empty data', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {
        'empty-creds': {
          credentialData: {
            data: {},
          },
        },
      },
      requiredResources: {},
      requiredSchemas: {},
    };

    const result = getCredentials(req, 'empty-creds');
    expect(result).toBeDefined();
    expect(result?.credentialData?.data).toEqual({});
  });
});

describe('getRequiredResource', () => {
  it('should return empty array and false when no required resources exist', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    const [resources, resolved] = getRequiredResource(req, 'test');
    expect(resources).toEqual([]);
    expect(resolved).toBe(false);
  });

  it('should return empty array and false when resource not found', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {
        other: {
          items: [
            {
              resource: {
                apiVersion: 'v1',
                kind: 'ConfigMap',
                metadata: { name: 'other-config' },
              },
              connectionDetails: {},
              ready: 0,
            },
          ],
        },
      },
      requiredSchemas: {},
    };

    const [resources, resolved] = getRequiredResource(req, 'test');
    expect(resources).toEqual([]);
    expect(resolved).toBe(false);
  });

  it('should return resources when found', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {
        test: {
          items: [
            {
              resource: {
                apiVersion: 'v1',
                kind: 'ConfigMap',
                metadata: { name: 'test-config' },
                data: { key: 'value' },
              },
              connectionDetails: {},
              ready: 0,
            },
          ],
        },
      },
      requiredSchemas: {},
    };

    const [resources, resolved] = getRequiredResource(req, 'test');
    expect(resolved).toBe(true);
    expect(resources).toHaveLength(1);
    expect(resources[0]?.resource?.kind).toBe('ConfigMap');
    expect(resources[0]?.resource?.metadata?.name).toBe('test-config');
    expect(resources[0]?.resource?.data?.key).toBe('value');
  });

  it('should return multiple resources when found', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {
        secrets: {
          items: [
            {
              resource: {
                apiVersion: 'v1',
                kind: 'Secret',
                metadata: { name: 'secret-1', namespace: 'default' },
              },
              connectionDetails: {},
              ready: 0,
            },
            {
              resource: {
                apiVersion: 'v1',
                kind: 'Secret',
                metadata: { name: 'secret-2', namespace: 'default' },
              },
              connectionDetails: {},
              ready: 0,
            },
          ],
        },
      },
      requiredSchemas: {},
    };

    const [resources, resolved] = getRequiredResource(req, 'secrets');
    expect(resolved).toBe(true);
    expect(resources).toHaveLength(2);
    expect(resources[0]?.resource?.metadata?.name).toBe('secret-1');
    expect(resources[1]?.resource?.metadata?.name).toBe('secret-2');
  });

  it('should handle empty items array', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {
        empty: {
          items: [],
        },
      },
      requiredSchemas: {},
    };

    const [resources, resolved] = getRequiredResource(req, 'empty');
    expect(resolved).toBe(true);
    expect(resources).toEqual([]);
  });

  it('should preserve connection details and ready status', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {
        test: {
          items: [
            {
              resource: {
                apiVersion: 'v1',
                kind: 'Secret',
                metadata: { name: 'test-secret' },
              },
              connectionDetails: {
                username: Buffer.from('admin'),
                password: Buffer.from('secret'),
              },
              ready: 2, // READY_TRUE
            },
          ],
        },
      },
      requiredSchemas: {},
    };

    const [resources, resolved] = getRequiredResource(req, 'test');
    expect(resolved).toBe(true);
    expect(resources).toHaveLength(1);
    expect(resources[0]?.connectionDetails?.username).toEqual(Buffer.from('admin'));
    expect(resources[0]?.connectionDetails?.password).toEqual(Buffer.from('secret'));
    expect(resources[0]?.ready).toBe(2);
  });
});

describe('getRequiredSchemas', () => {
  it('should return empty object when no required schemas exist', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    const result = getRequiredSchemas(req);
    expect(result).toEqual({});
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('should return all schemas', () => {
    const xrSchema = {
      type: 'object',
      properties: {
        spec: { type: 'object' },
      },
    };

    const composedSchema = {
      type: 'object',
      properties: {
        metadata: { type: 'object' },
      },
    };

    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {
        'xr-schema': {
          openapiV3: xrSchema,
        },
        'composed-schema': {
          openapiV3: composedSchema,
        },
      },
    };

    const result = getRequiredSchemas(req);
    expect(Object.keys(result)).toHaveLength(2);
    expect(result['xr-schema']).toEqual(xrSchema);
    expect(result['composed-schema']).toEqual(composedSchema);
  });

  it('should handle undefined schemas', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {
        'found-schema': {
          openapiV3: { type: 'object' },
        },
        'not-found-schema': {
          openapiV3: undefined,
        },
      },
    };

    const result = getRequiredSchemas(req);
    expect(Object.keys(result)).toHaveLength(2);
    expect(result['found-schema']).toEqual({ type: 'object' });
    expect(result['not-found-schema']).toBeUndefined();
  });
});

describe('getRequiredSchema', () => {
  it('should return undefined and false when no required schemas exist', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    const [schema, resolved] = getRequiredSchema(req, 'test');
    expect(schema).toBeUndefined();
    expect(resolved).toBe(false);
  });

  it('should return undefined and false when schema not found', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {
        other: {
          openapiV3: { type: 'object' },
        },
      },
    };

    const [schema, resolved] = getRequiredSchema(req, 'test');
    expect(schema).toBeUndefined();
    expect(resolved).toBe(false);
  });

  it('should return schema and true when found', () => {
    const xrSchema = {
      type: 'object',
      properties: {
        apiVersion: { type: 'string' },
        kind: { type: 'string' },
        spec: {
          type: 'object',
          properties: {
            region: { type: 'string' },
          },
        },
      },
      required: ['apiVersion', 'kind', 'spec'],
    };

    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {
        'xr-schema': {
          openapiV3: xrSchema,
        },
      },
    };

    const [schema, resolved] = getRequiredSchema(req, 'xr-schema');
    expect(resolved).toBe(true);
    expect(schema).toEqual(xrSchema);
    expect((schema as any)?.type).toBe('object');
    expect((schema as any)?.properties?.spec?.properties?.region?.type).toBe('string');
  });

  it('should return undefined and true when schema was requested but not found', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {
        'not-found': {
          openapiV3: undefined,
        },
      },
    };

    const [schema, resolved] = getRequiredSchema(req, 'not-found');
    expect(resolved).toBe(true);
    expect(schema).toBeUndefined();
  });
});

describe('advertiseCapabilities', () => {
  it('should return false when meta is undefined', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    expect(advertiseCapabilities(req)).toBe(false);
  });

  it('should return false when meta exists without CAPABILITY_CAPABILITIES', () => {
    const req: RunFunctionRequest = {
      meta: {
        tag: 'test',
        capabilities: [Capability.CAPABILITY_REQUIRED_RESOURCES],
      },
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    expect(advertiseCapabilities(req)).toBe(false);
  });

  it('should return false when capabilities is empty array', () => {
    const req: RunFunctionRequest = {
      meta: {
        tag: 'test',
        capabilities: [],
      },
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    expect(advertiseCapabilities(req)).toBe(false);
  });

  it('should return false when capabilities present but CAPABILITY_CAPABILITIES not included', () => {
    const req: RunFunctionRequest = {
      meta: {
        tag: 'test',
        capabilities: [Capability.CAPABILITY_REQUIRED_RESOURCES, Capability.CAPABILITY_CONDITIONS],
      },
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    expect(advertiseCapabilities(req)).toBe(false);
  });

  it('should return true when CAPABILITY_CAPABILITIES is present', () => {
    const req: RunFunctionRequest = {
      meta: {
        tag: 'test',
        capabilities: [Capability.CAPABILITY_CAPABILITIES],
      },
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    expect(advertiseCapabilities(req)).toBe(true);
  });

  it('should return true when CAPABILITY_CAPABILITIES is present among other capabilities', () => {
    const req: RunFunctionRequest = {
      meta: {
        tag: 'test',
        capabilities: [
          Capability.CAPABILITY_CAPABILITIES,
          Capability.CAPABILITY_REQUIRED_RESOURCES,
          Capability.CAPABILITY_CONDITIONS,
          Capability.CAPABILITY_REQUIRED_SCHEMAS,
        ],
      },
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    expect(advertiseCapabilities(req)).toBe(true);
  });
});

describe('hasCapability', () => {
  it('should return false when meta is undefined', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    expect(hasCapability(req, Capability.CAPABILITY_REQUIRED_RESOURCES)).toBe(false);
  });

  it('should return false when requested capability is absent', () => {
    const req: RunFunctionRequest = {
      meta: {
        tag: 'test',
        capabilities: [Capability.CAPABILITY_CONDITIONS],
      },
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    expect(hasCapability(req, Capability.CAPABILITY_REQUIRED_RESOURCES)).toBe(false);
  });

  it('should return false when capabilities is empty array', () => {
    const req: RunFunctionRequest = {
      meta: {
        tag: 'test',
        capabilities: [],
      },
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    expect(hasCapability(req, Capability.CAPABILITY_REQUIRED_RESOURCES)).toBe(false);
  });

  it('should return false when requested capability is not present', () => {
    const req: RunFunctionRequest = {
      meta: {
        tag: 'test',
        capabilities: [Capability.CAPABILITY_CAPABILITIES, Capability.CAPABILITY_CONDITIONS],
      },
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    expect(hasCapability(req, Capability.CAPABILITY_REQUIRED_RESOURCES)).toBe(false);
  });

  it('should return true when requested capability is present', () => {
    const req: RunFunctionRequest = {
      meta: {
        tag: 'test',
        capabilities: [
          Capability.CAPABILITY_CAPABILITIES,
          Capability.CAPABILITY_REQUIRED_RESOURCES,
        ],
      },
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    expect(hasCapability(req, Capability.CAPABILITY_REQUIRED_RESOURCES)).toBe(true);
  });

  it('should work with all capability types', () => {
    const req: RunFunctionRequest = {
      meta: {
        tag: 'test',
        capabilities: [
          Capability.CAPABILITY_CAPABILITIES,
          Capability.CAPABILITY_REQUIRED_RESOURCES,
          Capability.CAPABILITY_CREDENTIALS,
          Capability.CAPABILITY_CONDITIONS,
          Capability.CAPABILITY_REQUIRED_SCHEMAS,
        ],
      },
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    expect(hasCapability(req, Capability.CAPABILITY_CAPABILITIES)).toBe(true);
    expect(hasCapability(req, Capability.CAPABILITY_REQUIRED_RESOURCES)).toBe(true);
    expect(hasCapability(req, Capability.CAPABILITY_CREDENTIALS)).toBe(true);
    expect(hasCapability(req, Capability.CAPABILITY_CONDITIONS)).toBe(true);
    expect(hasCapability(req, Capability.CAPABILITY_REQUIRED_SCHEMAS)).toBe(true);
    expect(hasCapability(req, Capability.CAPABILITY_UNSPECIFIED)).toBe(false);
  });
});

describe('getWatchedResource', () => {
  it('should return undefined when no required resources exist', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {},
      requiredSchemas: {},
    };

    const result = getWatchedResource(req);
    expect(result).toBeUndefined();
  });

  it('should return undefined when watched resource has no items', () => {
    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {
        'ops.crossplane.io/watched-resource': {
          items: [],
        },
      },
      requiredSchemas: {},
    };

    const result = getWatchedResource(req);
    expect(result).toBeUndefined();
  });

  it('should return the watched resource when present', () => {
    const watchedResource = {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: 'my-config',
        namespace: 'default',
      },
      data: {
        key: 'value',
      },
    };

    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {
        'ops.crossplane.io/watched-resource': {
          items: [
            {
              resource: watchedResource,
              connectionDetails: {},
              ready: 0,
            },
          ],
        },
      },
      requiredSchemas: {},
    };

    const result = getWatchedResource(req);
    expect(result).toEqual(watchedResource);
  });

  it('should return the first resource when multiple resources exist', () => {
    const firstResource = {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: 'first-config',
      },
    };

    const secondResource = {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: 'second-config',
      },
    };

    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {
        'ops.crossplane.io/watched-resource': {
          items: [
            {
              resource: firstResource,
              connectionDetails: {},
              ready: 0,
            },
            {
              resource: secondResource,
              connectionDetails: {},
              ready: 0,
            },
          ],
        },
      },
      requiredSchemas: {},
    };

    const result = getWatchedResource(req);
    expect(result).toEqual(firstResource);
  });

  it('should handle watched resource with complex nested structure', () => {
    const watchedResource = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name: 'my-deployment',
        namespace: 'production',
        labels: {
          app: 'web',
          env: 'prod',
        },
      },
      spec: {
        replicas: 3,
        selector: {
          matchLabels: {
            app: 'web',
          },
        },
        template: {
          spec: {
            containers: [
              {
                name: 'app',
                image: 'nginx:latest',
              },
            ],
          },
        },
      },
      status: {
        readyReplicas: 3,
      },
    };

    const req: RunFunctionRequest = {
      meta: undefined,
      observed: undefined,
      desired: undefined,
      input: undefined,
      context: undefined,
      extraResources: {},
      credentials: {},
      requiredResources: {
        'ops.crossplane.io/watched-resource': {
          items: [
            {
              resource: watchedResource,
              connectionDetails: {},
              ready: 1,
            },
          ],
        },
      },
      requiredSchemas: {},
    };

    const result = getWatchedResource(req);
    expect(result).toEqual(watchedResource);
    expect(result?.metadata).toEqual(watchedResource.metadata);
    expect(result?.spec).toEqual(watchedResource.spec);
    expect(result?.status).toEqual(watchedResource.status);
  });
});
