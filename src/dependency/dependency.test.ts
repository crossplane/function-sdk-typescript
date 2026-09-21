import { describe, it, expect } from 'vitest';
import { dependsOn, dependsOnRequired, getDependencies, setDependencies } from './dependency.js';
import { resolveDependencies, trackObservedComposedResources } from './infer.js';
import { to } from '../response/response.js';
import type { RunFunctionRequest } from '../proto/run_function.js';
import { Ready, RunFunctionResponse } from '../proto/run_function.js';

/** edge builds a composed-resource dependency. */
function edge(resource: string, dependsOnResource: string) {
  return {
    resource,
    composedResource: dependsOnResource,
    requiredResource: undefined,
    createResourceBeforeDestroyingDependency: false,
  };
}

/** req builds a minimal request, optionally with observed composed resources. */
function req(observed?: Record<string, unknown>): RunFunctionRequest {
  return {
    meta: { tag: 'test', capabilities: [] },
    observed: { composite: undefined, resources: observed ?? {} },
    desired: { composite: undefined, resources: {} },
    input: undefined,
    context: undefined,
    extraResources: {},
    credentials: {},
    requiredResources: {},
    requiredSchemas: {},
    dependencies: undefined,
  } as unknown as RunFunctionRequest;
}

describe('to', () => {
  it('leaves dependencies unset when the request carries none', () => {
    // Unset means "no opinion". An empty Dependencies would instead mean "I
    // want no ordering constraints", and would clear the graph.
    expect(to(req()).dependencies).toBeUndefined();
  });

  it('carries inherited edges forward, like desired state and context', () => {
    // So that declaring an edge adds to what earlier functions declared,
    // rather than silently replacing it. Forgetting to do this by hand was a
    // way to erase another function's ordering without noticing.
    const r = req();
    r.dependencies = { items: [edge('subnet', 'vpc')] };

    expect(to(r).dependencies?.items).toEqual([edge('subnet', 'vpc')]);
  });

  it('does not alias the request, so the response can be edited freely', () => {
    const r = req();
    r.dependencies = { items: [edge('subnet', 'vpc')] };

    dependsOn(to(r), 'instance', 'subnet');

    expect(r.dependencies.items).toHaveLength(1);
  });
});

describe('dependsOn', () => {
  it('records an edge between two composed resources', () => {
    const rsp = dependsOn(to(req()), 'subnet', 'vpc');

    expect(rsp.dependencies?.items).toEqual([
      {
        resource: 'subnet',
        composedResource: 'vpc',
        requiredResource: undefined,
        createResourceBeforeDestroyingDependency: false,
      },
    ]);
  });

  it('accumulates edges rather than replacing them', () => {
    let rsp = dependsOn(to(req()), 'subnet', 'vpc');
    rsp = dependsOn(rsp, 'instance', 'subnet');

    expect(rsp.dependencies?.items).toHaveLength(2);
  });

  it('drops a duplicate edge', () => {
    let rsp = dependsOn(to(req()), 'subnet', 'vpc');
    rsp = dependsOn(rsp, 'subnet', 'vpc');

    expect(rsp.dependencies?.items).toHaveLength(1);
  });

  it('carries the create-before-destroy flag', () => {
    const rsp = dependsOn(to(req()), 'new', 'old', { createBeforeDestroy: true });

    expect(rsp.dependencies?.items[0].createResourceBeforeDestroyingDependency).toBe(true);
  });
});

describe('dependsOnRequired', () => {
  it('records an edge onto a required resource', () => {
    const rsp = dependsOnRequired(to(req()), 'instance', 'shared-vpc');

    expect(rsp.dependencies?.items[0]).toMatchObject({
      resource: 'instance',
      composedResource: undefined,
      requiredResource: { requirementName: 'shared-vpc' },
    });
  });
});

describe('setDependencies', () => {
  it('clears edges when given an empty set', () => {
    // Meaningfully different from leaving the field unset: this says "I want
    // no ordering", which discards what earlier functions declared.
    const rsp = setDependencies(dependsOn(to(req()), 'subnet', 'vpc'), []);

    expect(rsp.dependencies?.items).toEqual([]);
    expect(rsp.dependencies).toBeDefined();
  });
});

describe('inheriting edges', () => {
  it('adds to inherited edges without any extra call', () => {
    const r = req();
    r.dependencies = { items: [edge('subnet', 'vpc')] };

    const rsp = dependsOn(to(r), 'instance', 'subnet');

    expect(getDependencies(r)).toHaveLength(1);
    expect(rsp.dependencies?.items).toHaveLength(2);
  });

  it('lets a function discard inherited edges deliberately', () => {
    const r = req();
    r.dependencies = { items: [edge('subnet', 'vpc')] };

    const rsp = setDependencies(to(r), []);

    expect(rsp.dependencies?.items).toEqual([]);
  });
});

describe('inferring dependencies from dataflow', () => {
  const vpc = {
    resource: {
      apiVersion: 'ec2.aws.upbound.io/v1beta1',
      kind: 'VPC',
      status: { atProvider: { id: 'vpc-0123456789' } },
    },
    connectionDetails: {},
  };

  it('records an edge for a value read out of another resource', () => {
    const observed = trackObservedComposedResources(req({ vpc }));
    const rsp = to(req({ vpc }));

    const desired = {
      subnet: {
        resource: {
          apiVersion: 'ec2.aws.upbound.io/v1beta1',
          kind: 'Subnet',
          spec: {
            forProvider: { vpcId: observed['vpc'].resource.status.atProvider.id },
          },
        },
        ready: Ready.READY_UNSPECIFIED,
      },
    };

    const resolved = resolveDependencies(rsp, desired);

    expect(rsp.dependencies?.items).toEqual([
      {
        resource: 'subnet',
        composedResource: 'vpc',
        requiredResource: undefined,
        createResourceBeforeDestroyingDependency: false,
      },
    ]);

    // The placeholder is replaced by the value it stood for.
    expect((resolved.subnet.resource as any).spec.forProvider.vpcId).toBe('vpc-0123456789');
  });

  it('records the edge even when the resource does not exist yet', () => {
    // The case that matters most: there is nothing to read, and the whole
    // point is that Crossplane should wait rather than create.
    const observed = trackObservedComposedResources(req({}));
    const rsp = to(req({}));

    const resolved = resolveDependencies(rsp, {
      subnet: {
        resource: {
          spec: { forProvider: { vpcId: observed['vpc'].resource.status.atProvider.id } },
        },
        ready: Ready.READY_UNSPECIFIED,
      },
    } as never);

    expect(rsp.dependencies?.items?.[0]).toMatchObject({
      resource: 'subnet',
      composedResource: 'vpc',
    });

    // The unavailable field is dropped rather than sent as null.
    expect((resolved.subnet.resource as any).spec.forProvider).toEqual({});
  });

  it('records one edge per source, not per read', () => {
    const observed = trackObservedComposedResources(req({ vpc }));
    const rsp = to(req({ vpc }));

    resolveDependencies(rsp, {
      subnet: {
        resource: {
          spec: {
            a: observed['vpc'].resource.status.atProvider.id,
            b: observed['vpc'].resource.kind,
          },
        },
        ready: Ready.READY_UNSPECIFIED,
      },
    } as never);

    expect(rsp.dependencies?.items).toHaveLength(1);
  });

  it('ignores a resource reading its own observed state', () => {
    const observed = trackObservedComposedResources(req({ vpc }));
    const rsp = to(req({ vpc }));

    resolveDependencies(rsp, {
      vpc: {
        resource: { spec: { id: observed['vpc'].resource.status.atProvider.id } },
        ready: Ready.READY_UNSPECIFIED,
      },
    } as never);

    expect(rsp.dependencies).toBeUndefined();
  });

  it('resolves values inside arrays', () => {
    const observed = trackObservedComposedResources(req({ vpc }));
    const rsp = to(req({ vpc }));

    const resolved = resolveDependencies(rsp, {
      sg: {
        resource: { spec: { vpcIds: [observed['vpc'].resource.status.atProvider.id] } },
        ready: Ready.READY_UNSPECIFIED,
      },
    } as never);

    expect((resolved.sg.resource as any).spec.vpcIds).toEqual(['vpc-0123456789']);
    expect(rsp.dependencies?.items).toHaveLength(1);
  });

  it('loses the edge when a value is interpolated into a string', () => {
    // Documented limitation. Template literals collapse the placeholder to a
    // string, taking its provenance with it. The value is still right.
    const observed = trackObservedComposedResources(req({ vpc }));
    const rsp = to(req({ vpc }));

    const resolved = resolveDependencies(rsp, {
      subnet: {
        resource: {
          spec: { name: `${observed['vpc'].resource.status.atProvider.id}-subnet` },
        },
        ready: Ready.READY_UNSPECIFIED,
      },
    } as never);

    expect((resolved.subnet.resource as any).spec.name).toBe('vpc-0123456789-subnet');
    expect(rsp.dependencies).toBeUndefined();
  });

  it('keeps edges declared explicitly alongside inferred ones', () => {
    const observed = trackObservedComposedResources(req({ vpc }));
    let rsp = to(req({ vpc }));
    rsp = dependsOn(rsp, 'instance', 'subnet');

    resolveDependencies(rsp, {
      subnet: {
        resource: { spec: { vpcId: observed['vpc'].resource.status.atProvider.id } },
        ready: Ready.READY_UNSPECIFIED,
      },
    } as never);

    expect(rsp.dependencies?.items).toHaveLength(2);
  });
});

describe('wire encoding', () => {
  it('keeps unset and empty distinguishable after a round trip', () => {
    // Crossplane reads unset as "no opinion, carry my edges forward" and empty
    // as "I want no edges". A bare repeated field could not express that -
    // both encode to zero bytes - which is why dependencies is a message
    // wrapping a repeated field.
    const unset = to(req());
    const empty = setDependencies(to(req()), []);

    const decode = (r: RunFunctionResponse): RunFunctionResponse =>
      RunFunctionResponse.decode(RunFunctionResponse.encode(r).finish());

    expect(decode(unset).dependencies).toBeUndefined();
    expect(decode(empty).dependencies).toEqual({ items: [] });
  });

  it('round trips edges of both kinds', () => {
    let rsp = dependsOn(to(req()), 'new', 'old', { createBeforeDestroy: true });
    rsp = dependsOnRequired(rsp, 'instance', 'shared-vpc', 'vpc-1');

    const got = RunFunctionResponse.decode(RunFunctionResponse.encode(rsp).finish());

    expect(got.dependencies?.items).toEqual(rsp.dependencies?.items);
  });
});
