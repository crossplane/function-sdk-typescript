/**
 * Inferring ordering constraints from dataflow.
 *
 * Reading a value out of one composed resource and writing it into another is
 * already a dependency - the second resource can't be correct until the first
 * has produced the value. This module makes Crossplane aware of that without
 * asking the author to declare it twice.
 *
 * ```typescript
 * const observed = trackObservedComposedResources(req);
 *
 * dcds['subnet'] = {
 *   resource: {
 *     apiVersion: 'ec2.aws.upbound.io/v1beta1',
 *     kind: 'Subnet',
 *     spec: {
 *       forProvider: {
 *         vpcId: observed['vpc'].resource.status.atProvider.id,
 *       },
 *     },
 *   },
 *   ready: Ready.READY_UNSPECIFIED,
 * };
 *
 * rsp = setDesiredComposedResources(rsp, resolveDependencies(rsp, dcds));
 * ```
 *
 * That records `subnet` depends on `vpc`, with no dependsOn call.
 *
 * This is the same idea Pulumi uses, where dependencies fall out of resource
 * references rather than being declared. It works here for the same reason:
 * the read happens in a real programming language, so it can be observed.
 *
 * ## What it can and can't see
 *
 * A tracked read produces a placeholder that remembers where it came from.
 * Assigning that placeholder somewhere in a desired resource is what creates
 * the edge, so the value has to survive as a value:
 *
 * - `vpcId: vpc.status.atProvider.id` is tracked.
 * - `` name: `${vpc.status.atProvider.id}-subnet` `` is **not**. Template
 *   literals collapse the placeholder to a string, and the provenance goes
 *   with it. The value is still correct; only the edge is lost.
 * - `if (vpc.status.atProvider.id)` is not tracked either, and placeholders
 *   are always truthy - use `valueOf()` to test the real value.
 *
 * Declare those cases with dependsOn. Inference is a convenience for the
 * common shape, not a replacement for saying what you mean.
 */
import type { RunFunctionResponse } from '../proto/run_function.js';
import type { DesiredComposed } from '../resource/resource.js';
import { addDependency } from './dependency.js';

/** Brands a placeholder produced by a tracked read. */
const REF = Symbol.for('crossplane.dependency.ref');

/** What a placeholder knows about where it came from. */
interface RefTarget {
  /** Name of the observed composed resource that was read. */
  source: string;
  /** Property path that was read, for diagnostics. */
  path: string[];
  /** The value at that path, or undefined if it isn't there yet. */
  value: unknown;
}

/** A placeholder carrying both a value and its provenance. */
interface Ref {
  [REF]: RefTarget;
}

/**
 * Wrap a request's observed composed resources so reads through them are
 * remembered.
 *
 * Reading a resource that doesn't exist yet is fine, and is the case that
 * matters most: the value comes back undefined, but the dependency is still
 * recorded, so Crossplane knows to wait.
 */
export function trackObservedComposedResources(req: {
  observed?: { resources?: { [key: string]: unknown } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): Record<string, any> {
  const resources = req.observed?.resources ?? {};

  return new Proxy(
    {},
    {
      get(_target, prop): unknown {
        if (typeof prop !== 'string') {
          return undefined;
        }

        return track(resources[prop], { source: prop, path: [], value: resources[prop] });
      },
      has(_target, prop) {
        return typeof prop === 'string' && prop in resources;
      },
      ownKeys() {
        return Reflect.ownKeys(resources);
      },
      getOwnPropertyDescriptor() {
        return { enumerable: true, configurable: true };
      },
    }
  );
}

/**
 * Record the dependencies implied by tracked reads, and replace the
 * placeholders with the values they stand for.
 *
 * Call this on desired composed resources before handing them to
 * setDesiredComposedResources. Edges are added to the response; anything
 * already declared with dependsOn is kept.
 *
 * A placeholder whose value isn't available yet resolves to `undefined`, and
 * the field it was assigned to is dropped, leaving a partial resource that
 * fills in once the dependency exists. The edge means Crossplane won't create
 * it in the meantime.
 */
export function resolveDependencies(
  rsp: RunFunctionResponse,
  desired: Record<string, DesiredComposed>
): Record<string, DesiredComposed> {
  const resolved: Record<string, DesiredComposed> = {};

  for (const [name, dcd] of Object.entries(desired)) {
    const sources = new Set<string>();
    resolved[name] = resolve(dcd, sources) as DesiredComposed;

    for (const source of [...sources].sort()) {
      if (source === name) {
        // A resource referring to its own observed state is reading what it
        // already produced, not waiting on anything.
        continue;
      }

      addDependency(rsp, {
        resource: name,
        composedResource: source,
        requiredResource: undefined,
        createResourceBeforeDestroyingDependency: false,
      });
    }
  }

  return resolved;
}

/**
 * A callable Proxy target. Functions are used rather than plain objects so a
 * placeholder can stand in wherever a value is expected without tripping over
 * Proxy's invariants.
 */
const noop = (): void => undefined;

/** track wraps a value so reads through it remember where they came from. */
function track(value: unknown, target: RefTarget): unknown {
  return new Proxy(noop, {
    get(_t, prop): unknown {
      if (prop === REF) {
        return target;
      }

      // Behave like the underlying value where JavaScript expects a
      // primitive, so interpolation and comparison still produce the right
      // answer - they just don't record an edge.
      if (prop === Symbol.toPrimitive) {
        return () => target.value;
      }

      if (prop === 'valueOf') {
        return () => target.value;
      }

      if (prop === 'toString') {
        return () => stringify(target.value);
      }

      if (prop === 'toJSON') {
        return () => target.value;
      }

      if (typeof prop !== 'string') {
        return undefined;
      }

      const next =
        value !== null && typeof value === 'object'
          ? (value as Record<string, unknown>)[prop]
          : undefined;

      return track(next, {
        source: target.source,
        path: [...target.path, prop],
        value: next,
      });
    },
  });
}

/** stringify renders a tracked value the way its own type would. */
function stringify(v: unknown): string {
  if (v === null || v === undefined) {
    return '';
  }

  if (typeof v === 'object') {
    return JSON.stringify(v);
  }

  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(v);
}

/** isRef reports whether a value is a tracked placeholder. */
function isRef(v: unknown): v is Ref {
  return (
    (typeof v === 'object' || typeof v === 'function') &&
    v !== null &&
    (v as Record<symbol, unknown>)[REF] !== undefined
  );
}

/**
 * resolve walks a value, replacing placeholders with what they stand for and
 * collecting the resources they came from.
 */
function resolve(value: unknown, sources: Set<string>): unknown {
  if (isRef(value)) {
    const target = value[REF];
    sources.add(target.source);

    return target.value;
  }

  if (Array.isArray(value)) {
    return value.map((v) => resolve(v, sources));
  }

  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(value)) {
      const r = resolve(v, sources);

      // Drop fields whose value isn't available yet, rather than sending
      // an explicit null the provider would try to apply.
      if (r !== undefined) {
        out[k] = r;
      }
    }

    return out;
  }

  return value;
}
