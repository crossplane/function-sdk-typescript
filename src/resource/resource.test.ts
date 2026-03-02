import { describe, it, expect } from 'vitest';
import { fromModel, fromObject, toObject } from './resource.js';
import { Resource, Ready } from '../proto/run_function.js';

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
