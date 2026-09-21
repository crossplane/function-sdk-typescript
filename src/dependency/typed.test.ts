import { describe, it, expect } from 'vitest';
import { externalName, named, namedRequired, ref, resolveRefs } from './typed.js';
import { dependsOn } from './dependency.js';
import { to } from '../response/response.js';
import type { RunFunctionRequest } from '../proto/run_function.js';
import { Ready } from '../proto/run_function.js';

/** A stand-in for a typed provider model. */
interface VPC {
  status?: { atProvider?: { id?: string; arn?: string } };
}

function req(
  observed?: Record<string, unknown>,
  required?: Record<string, unknown>
): RunFunctionRequest {
  return {
    meta: { tag: 'test', capabilities: [] },
    observed: { composite: undefined, resources: observed ?? {} },
    desired: { composite: undefined, resources: {} },
    requiredResources: required ?? {},
    dependencies: undefined,
  } as unknown as RunFunctionRequest;
}

/** An observed VPC that has been created and has an id. */
const observedVPC = {
  resource: {
    apiVersion: 'ec2.aws.m.upbound.io/v1beta1',
    kind: 'VPC',
    status: { atProvider: { id: 'vpc-0123456789', arn: 'arn:aws:ec2:vpc/x' } },
  },
  connectionDetails: {},
};

/** desired wraps a resource body as a desired composed resource. */
function desired(resource: Record<string, unknown>): DesiredLike {
  return { resource, ready: Ready.READY_UNSPECIFIED } as DesiredLike;
}

type DesiredLike = Parameters<typeof resolveRefs>[2][string];

describe('ref', () => {
  it('produces a string, so a typed model will accept it', () => {
    // The whole reason references are encoded as strings: a model validates
    // its own fields before the SDK ever sees them, and rejects an object
    // where the schema says string.
    const vpc = named<VPC>('vpc');
    const r = ref(vpc.status.atProvider.id);

    expect(typeof r).toBe('string');
  });

  it('records the field that was read', () => {
    const vpc = named<VPC>('vpc');

    expect(ref(vpc.status.atProvider.id)).toBe('${xp-ref:vpc:status.atProvider.id}');
    expect(ref(vpc.status.atProvider.arn)).toBe('${xp-ref:vpc:status.atProvider.arn}');
  });

  it('rejects a value that is not a field of a named resource', () => {
    // Silently producing no dependency would be worse: the composition would
    // look fine, and be unordered.
    expect(() => ref('just-a-string')).toThrow(/expects a field/);
  });

  it('rejects a whole resource, which has no single value', () => {
    expect(() => ref(named<VPC>('vpc'))).toThrow(/needs a field/);
  });
});

describe('resolveRefs', () => {
  it('records the dependency and fills in the value', () => {
    const vpc = named<VPC>('vpc');
    const rsp = to(req({ vpc: observedVPC }));

    const out = resolveRefs(req({ vpc: observedVPC }), rsp, {
      subnet: desired({
        apiVersion: 'ec2.aws.m.upbound.io/v1beta1',
        kind: 'Subnet',
        spec: { forProvider: { vpcId: ref(vpc.status.atProvider.id) } },
      }),
    });

    expect(rsp.dependencies?.items).toEqual([
      {
        resource: 'subnet',
        composedResource: 'vpc',
        requiredResource: undefined,
        createResourceBeforeDestroyingDependency: false,
      },
    ]);

    expect((out.subnet.resource as Record<string, any>).spec.forProvider.vpcId).toBe(
      'vpc-0123456789'
    );
  });

  it('records the dependency even when the resource does not exist yet', () => {
    // The case the whole feature exists for. There is no value to fill in, and
    // Crossplane should wait rather than create a subnet with no VPC.
    const vpc = named<VPC>('vpc');
    const rsp = to(req());

    const out = resolveRefs(req(), rsp, {
      subnet: desired({
        spec: {
          forProvider: { region: 'us-east-1', vpcId: ref(vpc.status.atProvider.id) },
        },
      }),
    });

    expect(rsp.dependencies?.items?.[0]).toMatchObject({
      resource: 'subnet',
      composedResource: 'vpc',
    });

    // The unresolvable field is dropped; the rest of the resource stands.
    expect((out.subnet.resource as Record<string, any>).spec.forProvider).toEqual({
      region: 'us-east-1',
    });
  });

  it('records one edge per source, however many fields are read', () => {
    const vpc = named<VPC>('vpc');
    const rsp = to(req({ vpc: observedVPC }));

    resolveRefs(req({ vpc: observedVPC }), rsp, {
      subnet: desired({
        spec: {
          a: ref(vpc.status.atProvider.id),
          b: ref(vpc.status.atProvider.arn),
        },
      }),
    });

    expect(rsp.dependencies?.items).toHaveLength(1);
  });

  it('resolves references inside arrays', () => {
    const vpc = named<VPC>('vpc');
    const rsp = to(req({ vpc: observedVPC }));

    const out = resolveRefs(req({ vpc: observedVPC }), rsp, {
      sg: desired({ spec: { vpcIds: [ref(vpc.status.atProvider.id)] } }),
    });

    expect((out.sg.resource as Record<string, any>).spec.vpcIds).toEqual(['vpc-0123456789']);
  });

  it('ignores a resource referencing itself', () => {
    const vpc = named<VPC>('vpc');
    const rsp = to(req({ vpc: observedVPC }));

    resolveRefs(req({ vpc: observedVPC }), rsp, {
      vpc: desired({ spec: { id: ref(vpc.status.atProvider.id) } }),
    });

    expect(rsp.dependencies).toBeUndefined();
  });

  it('keeps explicitly declared edges', () => {
    const vpc = named<VPC>('vpc');
    let rsp = to(req({ vpc: observedVPC }));
    rsp = dependsOn(rsp, 'instance', 'subnet');

    resolveRefs(req({ vpc: observedVPC }), rsp, {
      subnet: desired({ spec: { vpcId: ref(vpc.status.atProvider.id) } }),
    });

    expect(rsp.dependencies?.items).toHaveLength(2);
  });

  it('leaves ordinary strings alone', () => {
    const rsp = to(req());

    const out = resolveRefs(req(), rsp, {
      subnet: desired({ spec: { region: 'us-east-1', cidr: '10.0.0.0/16' } }),
    });

    expect((out.subnet.resource as Record<string, any>).spec).toEqual({
      region: 'us-east-1',
      cidr: '10.0.0.0/16',
    });
    expect(rsp.dependencies).toBeUndefined();
  });
});

describe('externalName', () => {
  it('replaces a reference or selector field with one property access', () => {
    // This is what a provider's vpcIdRef would have resolved to, so it is the
    // direct swap for vpcIdSelector - and needs no accessor lambda.
    const vpc = named<VPC>('vpc');

    expect(externalName(vpc)).toBe('${xp-ref:vpc:@externalName}');
  });

  it('resolves from the external-name annotation', () => {
    const vpc = named<VPC>('vpc');
    const observed = {
      vpc: {
        resource: {
          metadata: {
            name: 'network-abc12',
            annotations: { 'crossplane.io/external-name': 'vpc-0123456789' },
          },
        },
        connectionDetails: {},
      },
    };
    const rsp = to(req(observed));

    const out = resolveRefs(req(observed), rsp, {
      subnet: desired({ spec: { forProvider: { vpcId: externalName(vpc) } } }),
    });

    expect((out.subnet.resource as Record<string, any>).spec.forProvider.vpcId).toBe(
      'vpc-0123456789'
    );
    expect(rsp.dependencies?.items?.[0]).toMatchObject({
      resource: 'subnet',
      composedResource: 'vpc',
    });
  });

  it('falls back to the resource name when the annotation is absent', () => {
    // Crossplane defaults external-name to metadata.name, so we do too.
    const vpc = named<VPC>('vpc');
    const observed = {
      vpc: { resource: { metadata: { name: 'network-abc12' } }, connectionDetails: {} },
    };
    const rsp = to(req(observed));

    const out = resolveRefs(req(observed), rsp, {
      subnet: desired({ spec: { forProvider: { vpcId: externalName(vpc) } } }),
    });

    expect((out.subnet.resource as Record<string, any>).spec.forProvider.vpcId).toBe(
      'network-abc12'
    );
  });
});

/** A managed database, as a stand-in for a typed provider model. */
interface DBInstance {
  status?: { atProvider?: { address?: string; port?: number } };
}

describe('wiring arbitrary fields', () => {
  // No provider reference mechanism exists for this: a ConfigMap has no
  // addressRef, and no selector could ever populate it. This is the case
  // references are uniquely good for, rather than a replacement for something
  // that already works.
  const db = {
    resource: {
      kind: 'Instance',
      status: {
        atProvider: { address: 'db.abc.us-east-1.rds.amazonaws.com', port: 5432 },
      },
    },
    connectionDetails: {},
  };

  it('puts a composed database address into a ConfigMap', () => {
    const database = named<DBInstance>('db');
    const rsp = to(req({ db }));

    const out = resolveRefs(req({ db }), rsp, {
      'app-config': desired({
        apiVersion: 'v1',
        kind: 'ConfigMap',
        data: { DB_HOST: ref(database.status.atProvider.address) },
      }),
    });

    expect((out['app-config'].resource as Record<string, any>).data).toEqual({
      DB_HOST: 'db.abc.us-east-1.rds.amazonaws.com',
    });
    expect(rsp.dependencies?.items?.[0]).toMatchObject({
      resource: 'app-config',
      composedResource: 'db',
    });
  });

  it('reads from a resource the function requires rather than composes', () => {
    // A database that lives outside this XR is a required resource, so the
    // edge has to be a required-resource edge - Crossplane must not try to
    // order the deletion of something it did not compose.
    const external = namedRequired<DBInstance>('external-db');
    const required = {
      'external-db': {
        items: [{ resource: { status: { atProvider: { address: '10.0.0.5' } } } }],
      },
    };
    const rsp = to(req({}, required));

    const out = resolveRefs(req({}, required), rsp, {
      'app-config': desired({
        data: { DB_HOST: ref(external.status.atProvider.address) },
      }),
    });

    expect((out['app-config'].resource as Record<string, any>).data).toEqual({
      DB_HOST: '10.0.0.5',
    });
    expect(rsp.dependencies?.items?.[0]).toMatchObject({
      resource: 'app-config',
      composedResource: undefined,
      requiredResource: { requirementName: 'external-db', name: undefined },
    });
  });

  it('picks a named resource when a requirement matched several', () => {
    const external = namedRequired<DBInstance>('databases', 'primary');
    const required = {
      databases: {
        items: [
          {
            resource: {
              metadata: { name: 'replica' },
              status: { atProvider: { address: '10.0.0.9' } },
            },
          },
          {
            resource: {
              metadata: { name: 'primary' },
              status: { atProvider: { address: '10.0.0.5' } },
            },
          },
        ],
      },
    };
    const rsp = to(req({}, required));

    const out = resolveRefs(req({}, required), rsp, {
      cm: desired({ data: { DB_HOST: ref(external.status.atProvider.address) } }),
    });

    expect((out.cm.resource as Record<string, any>).data.DB_HOST).toBe('10.0.0.5');
  });

  it('declines to guess when a requirement matched several and none was named', () => {
    const external = namedRequired<DBInstance>('databases');
    const required = {
      databases: {
        items: [
          { resource: { status: { atProvider: { address: '10.0.0.9' } } } },
          { resource: { status: { atProvider: { address: '10.0.0.5' } } } },
        ],
      },
    };
    const rsp = to(req({}, required));

    const out = resolveRefs(req({}, required), rsp, {
      cm: desired({ data: { DB_HOST: ref(external.status.atProvider.address) } }),
    });

    // Better to leave it out, and have ordering hold the resource back, than
    // to wire an app to an arbitrary replica.
    expect((out.cm.resource as Record<string, any>).data).toEqual({});
  });

  it('resolves a numeric field as a number, which a ConfigMap will reject', () => {
    // Documented sharp edge. The sentinel passes the model's validation
    // because it is a string, but what it resolves to is whatever the source
    // field holds - and ConfigMap data must be strings. Convert explicitly.
    const database = named<DBInstance>('db');
    const rsp = to(req({ db }));

    const out = resolveRefs(req({ db }), rsp, {
      cm: desired({ data: { DB_PORT: ref(database.status.atProvider.port) } }),
    });

    expect((out.cm.resource as Record<string, any>).data.DB_PORT).toBe(5432);
    expect(typeof (out.cm.resource as Record<string, any>).data.DB_PORT).toBe('number');
  });
});
