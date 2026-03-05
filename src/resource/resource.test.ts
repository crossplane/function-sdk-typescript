import { describe, expect, it } from 'vitest';
import {
  asObject,
  asStruct,
  fromModel,
  fromObject,
  getCondition,
  mustStructJSON,
  mustStructObject,
  newDesiredComposed,
  toObject,
  update,
} from './resource.js';
import { Ready, Resource } from '../proto/run_function.js';

describe('fromModel', () => {
  it('should convert a kubernetes-models-like object with toJSON() method', () => {
    // Simulate a kubernetes-models object
    const mockModel = {
      metadata: {
        name: 'my-pod',
        namespace: 'default',
      },
      spec: {
        containers: [{ name: 'app', image: 'nginx:latest' }],
      },
      toJSON() {
        return {
          apiVersion: 'v1',
          kind: 'Pod',
          metadata: this.metadata,
          spec: this.spec,
        };
      },
    };

    const resource = fromModel(mockModel);

    expect(resource.resource).toEqual({
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: 'my-pod', namespace: 'default' },
      spec: { containers: [{ name: 'app', image: 'nginx:latest' }] },
    });
    expect(resource.ready).toBe(Ready.READY_UNSPECIFIED);
    expect(resource.connectionDetails).toEqual({});
  });

  it('should accept connection details and ready status', () => {
    const mockModel = {
      metadata: {
        name: 'my-secret',
      },
      toJSON() {
        return {
          apiVersion: 'v1',
          kind: 'Secret',
          metadata: this.metadata,
        };
      },
    };

    const connectionDetails = { password: Buffer.from('secret') };
    const ready = Ready.READY_TRUE;

    const resource = fromModel(mockModel, connectionDetails, ready);

    expect(resource.resource).toEqual({
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'my-secret' },
    });
    expect(resource.ready).toBe(Ready.READY_TRUE);
    expect(resource.connectionDetails).toEqual(connectionDetails);
  });
});

describe('fromObject', () => {
  it('should create a Resource from a plain object', () => {
    const obj = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: 'my-service' },
    };

    const resource = fromObject(obj);

    expect(resource.resource).toEqual(obj);
    expect(resource.ready).toBe(Ready.READY_UNSPECIFIED);
    expect(resource.connectionDetails).toEqual({});
  });

  it('should accept connection details and ready status', () => {
    const obj = {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: { name: 'my-config' },
      data: { key: 'value' },
    };

    const connectionDetails = { apiKey: Buffer.from('secret') };
    const ready = Ready.READY_TRUE;

    const resource = fromObject(obj, connectionDetails, ready);

    expect(resource.resource).toEqual(obj);
    expect(resource.ready).toBe(Ready.READY_TRUE);
    expect(resource.connectionDetails).toEqual(connectionDetails);
  });
});

describe('toObject', () => {
  it('should extract the resource object from a Resource', () => {
    const obj = {
      apiVersion: 'v1',
      kind: 'Deployment',
      metadata: { name: 'my-deployment' },
    };

    const resource = Resource.fromJSON({
      resource: obj,
      connectionDetails: {},
      ready: Ready.READY_TRUE,
    });

    const extracted = toObject(resource);

    expect(extracted).toEqual(obj);
  });

  it('should return undefined if resource is not present', () => {
    const resource = Resource.fromJSON({
      connectionDetails: {},
      ready: Ready.READY_TRUE,
    });

    const extracted = toObject(resource);

    expect(extracted).toBeUndefined();
  });
});

describe('newDesiredComposed', () => {
  it('should create an empty DesiredComposed resource', () => {
    const desired = newDesiredComposed();

    expect(desired).toBeDefined();
    expect(desired.resource).toEqual(Resource.fromJSON({}));
    expect(desired.ready).toBe(Ready.READY_UNSPECIFIED);
  });
});

describe('asObject', () => {
  it('should return the struct as-is (pass-through)', () => {
    const obj = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: 'test-pod' },
    };

    const result = asObject(obj);

    expect(result).toBe(obj);
    expect(result).toEqual(obj);
  });

  it('should return empty object when struct is undefined', () => {
    const result = asObject(undefined);

    expect(result).toEqual({});
  });

  it('should handle nested objects', () => {
    const obj = {
      spec: {
        containers: [
          { name: 'app', image: 'nginx' },
          { name: 'sidecar', image: 'busybox' },
        ],
      },
    };

    const result = asObject(obj);

    expect(result).toBe(obj);
    expect(result).toEqual(obj);
  });
});

describe('asStruct', () => {
  it('should return the object as-is (pass-through)', () => {
    const obj = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: 'test-service' },
    };

    const result = asStruct(obj);

    expect(result).toBe(obj);
    expect(result).toEqual(obj);
  });

  it('should handle complex nested structures', () => {
    const obj = {
      metadata: { labels: { app: 'test' } },
      spec: {
        ports: [{ port: 80, targetPort: 8080 }],
        selector: { app: 'test' },
      },
    };

    const result = asStruct(obj);

    expect(result).toBe(obj);
    expect(result).toEqual(obj);
  });
});

describe('mustStructObject', () => {
  it('should convert object to struct successfully', () => {
    const obj = {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      data: { key: 'value' },
    };

    const result = mustStructObject(obj);

    expect(result).toEqual(obj);
  });

  it('should handle empty object', () => {
    const result = mustStructObject({});

    expect(result).toEqual({});
  });

  it('should handle complex objects', () => {
    const obj = {
      nested: {
        deeply: {
          structure: ['array', 'values'],
        },
      },
    };

    const result = mustStructObject(obj);

    expect(result).toEqual(obj);
  });
});

describe('mustStructJSON', () => {
  it('should parse valid JSON string to struct', () => {
    const json = '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"test"}}';

    const result = mustStructJSON(json);

    expect(result).toEqual({
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: 'test' },
    });
  });

  it('should throw error for invalid JSON', () => {
    const invalidJson = '{invalid json}';

    expect(() => mustStructJSON(invalidJson)).toThrow('Failed to parse JSON to struct');
  });

  it('should handle nested JSON structures', () => {
    const json = '{"spec":{"containers":[{"name":"app","image":"nginx"}]}}';

    const result = mustStructJSON(json);

    expect(result).toEqual({
      spec: {
        containers: [{ name: 'app', image: 'nginx' }],
      },
    });
  });

  it('should handle empty JSON object', () => {
    const json = '{}';

    const result = mustStructJSON(json);

    expect(result).toEqual({});
  });
});

describe('update', () => {
  it('should merge source object into resource', () => {
    const resource = Resource.fromJSON({
      resource: {
        apiVersion: 'v1',
        kind: 'Bucket',
        metadata: { name: 'my-bucket' },
        spec: {
          forProvider: {
            region: 'us-east-1',
          },
        },
      },
    });

    update(resource, {
      spec: {
        forProvider: {
          region: 'us-west-2',
          tags: { environment: 'production' },
        },
      },
    });

    expect(resource.resource).toEqual({
      apiVersion: 'v1',
      kind: 'Bucket',
      metadata: { name: 'my-bucket' },
      spec: {
        forProvider: {
          region: 'us-west-2',
          tags: { environment: 'production' },
        },
      },
    });
  });

  it('should merge from another Resource', () => {
    const resource = Resource.fromJSON({
      resource: {
        metadata: { name: 'test' },
        spec: { field1: 'value1' },
      },
    });

    const sourceResource = Resource.fromJSON({
      resource: {
        spec: { field2: 'value2' },
        status: { ready: true },
      },
    });

    update(resource, sourceResource);

    expect(resource.resource).toEqual({
      metadata: { name: 'test' },
      spec: { field1: 'value1', field2: 'value2' },
      status: { ready: true },
    });
  });

  it('should initialize resource if undefined', () => {
    const resource = Resource.fromJSON({});

    update(resource, {
      apiVersion: 'v1',
      kind: 'Pod',
    });

    expect(resource.resource).toEqual({
      apiVersion: 'v1',
      kind: 'Pod',
    });
  });

  it('should perform deep merge', () => {
    const resource = Resource.fromJSON({
      resource: {
        spec: {
          forProvider: {
            region: 'us-east-1',
            existingField: 'preserved',
          },
        },
      },
    });

    update(resource, {
      spec: {
        forProvider: {
          region: 'us-west-2',
          newField: 'added',
        },
      },
    });

    expect(resource.resource).toEqual({
      spec: {
        forProvider: {
          region: 'us-west-2',
          existingField: 'preserved',
          newField: 'added',
        },
      },
    });
  });

  it('should replace arrays by default (Python SDK behavior)', () => {
    const resource = Resource.fromJSON({
      resource: {
        spec: {
          items: [1, 2, 3],
        },
      },
    });

    update(resource, {
      spec: {
        items: [4, 5],
      },
    });

    // Default behavior: arrays are replaced, not concatenated
    expect(resource.resource).toEqual({
      spec: {
        items: [4, 5],
      },
    });
  });

  it('should concatenate arrays when mergeArrays is true', () => {
    const resource = Resource.fromJSON({
      resource: {
        spec: {
          items: [1, 2, 3],
        },
      },
    });

    update(
      resource,
      {
        spec: {
          items: [4, 5],
        },
      },
      { mergeArrays: true }
    );

    // With mergeArrays: true, arrays are concatenated
    expect(resource.resource).toEqual({
      spec: {
        items: [1, 2, 3, 4, 5],
      },
    });
  });

  it('should replace tags array by default', () => {
    const resource = Resource.fromJSON({
      resource: {
        spec: {
          forProvider: {
            tags: ['env:dev', 'team:backend'],
          },
        },
      },
    });

    update(resource, {
      spec: {
        forProvider: {
          tags: ['env:prod', 'team:platform'],
        },
      },
    });

    expect(resource.resource).toEqual({
      spec: {
        forProvider: {
          tags: ['env:prod', 'team:platform'],
        },
      },
    });
  });

  it('should replace finalizers array', () => {
    const resource = Resource.fromJSON({
      resource: {
        metadata: {
          name: 'test-resource',
          finalizers: ['finalizer.example.com/cleanup'],
        },
      },
    });

    update(resource, {
      metadata: {
        finalizers: ['finalizer.example.com/new-cleanup'],
      },
    });

    expect(resource.resource).toEqual({
      metadata: {
        name: 'test-resource',
        finalizers: ['finalizer.example.com/new-cleanup'],
      },
    });
  });

  it('should handle nested arrays correctly', () => {
    const resource = Resource.fromJSON({
      resource: {
        spec: {
          containers: [
            { name: 'app', image: 'app:v1' },
            { name: 'sidecar', image: 'sidecar:v1' },
          ],
        },
      },
    });

    update(resource, {
      spec: {
        containers: [{ name: 'app', image: 'app:v2' }],
      },
    });

    // Arrays are replaced, not merged
    expect(resource.resource).toEqual({
      spec: {
        containers: [{ name: 'app', image: 'app:v2' }],
      },
    });
  });
});

describe('getCondition', () => {
  it('should return condition when found', () => {
    const resource = {
      apiVersion: 'v1',
      kind: 'Custom',
      status: {
        conditions: [
          {
            type: 'Ready',
            status: 'True',
            reason: 'Available',
            message: 'Resource is ready',
            lastTransitionTime: '2024-01-01T00:00:00Z',
          },
          {
            type: 'Synced',
            status: 'True',
          },
        ],
      },
    };

    const condition = getCondition(resource, 'Ready');

    expect(condition).toEqual({
      type: 'Ready',
      status: 'True',
      reason: 'Available',
      message: 'Resource is ready',
      lastTransitionTime: '2024-01-01T00:00:00Z',
    });
  });

  it('should return Unknown condition when not found', () => {
    const resource = {
      status: {
        conditions: [
          {
            type: 'Ready',
            status: 'True',
          },
        ],
      },
    };

    const condition = getCondition(resource, 'Synced');

    expect(condition).toEqual({
      type: 'Synced',
      status: 'Unknown',
    });
  });

  it('should return Unknown when resource is undefined', () => {
    const condition = getCondition(undefined, 'Ready');

    expect(condition).toEqual({
      type: 'Ready',
      status: 'Unknown',
    });
  });

  it('should return Unknown when status is missing', () => {
    const resource = {
      apiVersion: 'v1',
      kind: 'Custom',
    };

    const condition = getCondition(resource, 'Ready');

    expect(condition).toEqual({
      type: 'Ready',
      status: 'Unknown',
    });
  });

  it('should return Unknown when conditions array is missing', () => {
    const resource = {
      status: {},
    };

    const condition = getCondition(resource, 'Ready');

    expect(condition).toEqual({
      type: 'Ready',
      status: 'Unknown',
    });
  });

  it('should return Unknown when conditions is not an array', () => {
    const resource = {
      status: {
        conditions: 'not-an-array',
      },
    };

    const condition = getCondition(resource, 'Ready');

    expect(condition).toEqual({
      type: 'Ready',
      status: 'Unknown',
    });
  });

  it('should handle condition without optional fields', () => {
    const resource = {
      status: {
        conditions: [
          {
            type: 'Ready',
            status: 'False',
          },
        ],
      },
    };

    const condition = getCondition(resource, 'Ready');

    expect(condition).toEqual({
      type: 'Ready',
      status: 'False',
    });
    expect(condition.reason).toBeUndefined();
    expect(condition.message).toBeUndefined();
    expect(condition.lastTransitionTime).toBeUndefined();
  });

  it('should convert non-string condition fields to strings', () => {
    const resource = {
      status: {
        conditions: [
          {
            type: 'Ready',
            status: 'True',
            reason: 123,
            message: { error: 'test' },
            lastTransitionTime: 456,
          },
        ],
      },
    };

    const condition = getCondition(resource, 'Ready');

    expect(condition.reason).toBe('123');
    expect(condition.message).toBe('{"error":"test"}');
    expect(condition.lastTransitionTime).toBe('456');
  });

  it('should handle null and undefined condition fields', () => {
    const resource = {
      status: {
        conditions: [
          {
            type: 'Ready',
            status: 'True',
            reason: null,
            message: undefined,
          },
        ],
      },
    };

    const condition = getCondition(resource, 'Ready');

    expect(condition.reason).toBeUndefined();
    expect(condition.message).toBeUndefined();
  });
});
