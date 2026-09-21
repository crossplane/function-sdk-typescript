/**
 * Ordering constraints derived from typed model fields.
 *
 * Crossplane's providers resolve cross-resource references themselves, through
 * `vpcIdRef` and `vpcIdSelector` fields that the provider turns into a value at
 * reconcile time. That works, but the core engine never sees the relationship:
 * it can't order anything, and a provider that can't resolve a reference yet
 * retries against the cloud API until it can.
 *
 * Writing the reference as a field value instead makes the relationship
 * visible. The function says where the value comes from, the SDK records the
 * dependency, and Crossplane can wait rather than letting the provider
 * discover the problem.
 *
 * ```typescript
 * const vpc = named<VPC>('vpc');
 *
 * const subnet = new Subnet({
 *   spec: { forProvider: {
 *     region: 'us-east-1',
 *     vpcId: vpc.ref((v) => v.status?.atProvider?.id),
 *   } },
 * });
 *
 * subnet.validate();
 * desired['subnet'] = fromModel(subnet);
 *
 * rsp = setDesiredComposedResources(rsp, resolveRefs(req, rsp, desired));
 * ```
 *
 * That records `subnet` depends on `vpc`, and fills in the VPC's id once it
 * exists. No selector, and nothing for the provider to resolve.
 *
 * ## Why a string
 *
 * A reference has to survive a typed model's own validation, which runs before
 * anything the SDK can hook. A placeholder object fails it outright - the
 * schema says `vpcId` is a string - so a reference is encoded as a sentinel
 * string that passes validation and serialisation untouched.
 *
 * The consequence is that this only works for string-typed fields. A reference
 * in a number or boolean field will fail the model's validation, which is at
 * least a loud failure rather than a silent one.
 */
import type { RunFunctionRequest, RunFunctionResponse } from '../proto/run_function.js';
import type { DesiredComposed } from '../resource/resource.js';
import { addDependency } from './dependency.js';

/** Marks a string as a reference the SDK should resolve. */
const PREFIX = '${xp-ref:';
const SUFFIX = '}';

/** Marks a reference to a required, rather than composed, resource. */
const REQUIRED = '@required/';

/** Well-known values that aren't ordinary fields. */
const EXTERNAL_NAME = '@externalName';

/** The annotation a managed resource records its external name under. */
const EXTERNAL_NAME_ANNOTATION = 'crossplane.io/external-name';

/** Carries what a tracked read knows about itself. */
const META = Symbol.for('crossplane.dependency.meta');

interface Meta {
  /** Composed resource name, or a required-resource key. */
  source: string;
  /** The field path that was read. */
  path: string[];
}

/**
 * A stand-in for a resource, which reads like the resource itself.
 *
 * Accessing a field records where it came from. Wrap the result in {@link ref}
 * to turn it into something you can assign.
 */
export type Ref<T> = T;

/**
 * Name a composed resource so its fields can be referenced.
 *
 * ```typescript
 * const vpc = named<VPC>('vpc');
 *
 * vpcId: ref(vpc.status.atProvider.id),
 * ```
 */
export function named<T>(name: string): Ref<T> {
  return track({ source: name, path: [] }) as Ref<T>;
}

/**
 * Name a resource the function requires but doesn't compose.
 *
 * The requirement name is the key used in the function's
 * `requirements.resources`. Pass a resource name too when a requirement can
 * match more than one object.
 *
 * Crossplane never deletes a resource it didn't compose, so these constrain
 * only creation and updates.
 *
 * ```typescript
 * const db = namedRequired<Instance>('external-db');
 *
 * data: { DB_HOST: ref(db.status.atProvider.address) },
 * ```
 */
export function namedRequired<T>(requirementName: string, resourceName?: string): Ref<T> {
  const source = resourceName
    ? `${REQUIRED}${requirementName}/${resourceName}`
    : `${REQUIRED}${requirementName}`;

  return track({ source, path: [] }) as Ref<T>;
}

/**
 * Turn a field read into a reference you can assign.
 *
 * The value keeps its own type, so it goes wherever that type is expected. At
 * runtime it is a placeholder that {@link resolveRefs} swaps for the real
 * value, recording the dependency as it goes.
 *
 * ```typescript
 * vpcId: ref(vpc.status.atProvider.id),
 * ```
 *
 * Throws if given something that isn't a field of a named resource, since that
 * would otherwise silently produce no dependency at all.
 */
export function ref<V>(value: V): V {
  const meta = metaOf(value);

  if (!meta) {
    throw new Error(
      'ref() expects a field of a resource from named() or namedRequired(), ' +
        'for example ref(vpc.status.atProvider.id)'
    );
  }

  if (meta.path.length === 0) {
    throw new Error(
      `ref() needs a field, not the whole ${meta.source} resource. ` +
        'Use externalName() to reference its external name.'
    );
  }

  return encode(meta.source, meta.path) as V;
}

/**
 * Reference a resource's external name - its identifier in the external
 * system.
 *
 * This is what a provider's own `somethingIdRef` would have resolved to, so it
 * is the direct replacement for a reference or selector field:
 *
 * ```typescript
 * vpcId: externalName(vpc),   // instead of vpcIdSelector
 * ```
 */
export function externalName(resource: unknown): string {
  const meta = metaOf(resource);

  if (!meta) {
    throw new Error('externalName() expects a resource from named() or namedRequired()');
  }

  return `${PREFIX}${meta.source}:${EXTERNAL_NAME}${SUFFIX}`;
}

/** track builds a stand-in that records the fields read through it. */
function track(meta: Meta): unknown {
  return new Proxy(noop, {
    get(_t, prop): unknown {
      if (prop === META) {
        return meta;
      }

      if (typeof prop !== 'string') {
        return undefined;
      }

      return track({ source: meta.source, path: [...meta.path, prop] });
    },
  });
}

/** A callable Proxy target, so a stand-in can appear anywhere a value can. */
const noop = (): void => undefined;

/** metaOf reads what a stand-in knows about itself, if it is one. */
function metaOf(v: unknown): Meta | undefined {
  if ((typeof v !== 'object' && typeof v !== 'function') || v === null) {
    return undefined;
  }

  return (v as Record<symbol, Meta | undefined>)[META];
}

/**
 * Replace references with the values they point at, and record the
 * dependencies they imply.
 *
 * Call this on desired composed resources before handing them to
 * setDesiredComposedResources. Edges are added to the response, alongside
 * anything already declared.
 *
 * A reference to a resource that doesn't exist yet resolves to nothing, and
 * the field is left out. The dependency is still recorded, so Crossplane
 * doesn't create the resource until the value is available.
 */
export function resolveRefs(
  req: RunFunctionRequest,
  rsp: RunFunctionResponse,
  desired: Record<string, DesiredComposed>
): Record<string, DesiredComposed> {
  const lookup: Lookup = {
    observed: req.observed?.resources ?? {},
    required: req.requiredResources ?? {},
  };
  const out: Record<string, DesiredComposed> = {};

  for (const [name, dcd] of Object.entries(desired)) {
    const sources = new Set<string>();
    out[name] = substitute(dcd, lookup, sources) as DesiredComposed;

    for (const source of [...sources].sort()) {
      if (source === name) {
        continue;
      }

      if (source.startsWith(REQUIRED)) {
        const [requirementName, resourceName] = source.slice(REQUIRED.length).split('/');

        addDependency(rsp, {
          resource: name,
          composedResource: undefined,
          requiredResource: { requirementName, name: resourceName },
          createResourceBeforeDestroyingDependency: false,
        });

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

  return out;
}

/** encode renders a reference as a sentinel string. */
function encode(name: string, path: string[]): string {
  return `${PREFIX}${name}:${path.join('.')}${SUFFIX}`;
}

/** decode reads a sentinel string, or returns undefined if it isn't one. */
function decode(v: unknown): { name: string; path: string[] } | undefined {
  if (typeof v !== 'string' || !v.startsWith(PREFIX) || !v.endsWith(SUFFIX)) {
    return undefined;
  }

  const body = v.slice(PREFIX.length, -SUFFIX.length);
  const sep = body.indexOf(':');

  if (sep < 0) {
    return undefined;
  }

  const rest = body.slice(sep + 1);

  return {
    name: body.slice(0, sep),
    path: rest === EXTERNAL_NAME ? [EXTERNAL_NAME] : rest.split('.').filter(Boolean),
  };
}

/** Where a reference can resolve from. */
interface Lookup {
  observed: { [key: string]: unknown };
  required: Record<string, { items?: unknown[] }>;
}

/**
 * resolveSource finds the resource a reference points at, in composed state or
 * among the resources the function required.
 */
function resolveSource(name: string, lookup: Lookup): unknown {
  if (!name.startsWith(REQUIRED)) {
    return body(lookup.observed[name]);
  }

  const [requirementName, resourceName] = name.slice(REQUIRED.length).split('/');
  const items = lookup.required[requirementName]?.items ?? [];

  if (!resourceName) {
    // Requirements commonly match exactly one resource. With several and no
    // name to pick by there is no right answer, so decline rather than guess.
    return items.length === 1 ? body(items[0]) : undefined;
  }

  return items.map(body).find((r) => valueAt(r, ['metadata', 'name']) === resourceName);
}

/**
 * externalNameOf reads a resource's external name, falling back to its
 * metadata name the way Crossplane does when the annotation isn't set.
 */
function externalNameOf(resource: unknown): unknown {
  const annotated = valueAt(resource, ['metadata', 'annotations', EXTERNAL_NAME_ANNOTATION]);

  return annotated ?? valueAt(resource, ['metadata', 'name']);
}

/** body unwraps observed state to the resource itself. */
function body(observed: unknown): unknown {
  if (observed !== null && typeof observed === 'object' && 'resource' in observed) {
    return observed.resource;
  }

  return observed;
}

/** valueAt reads a dotted path out of an object. */
function valueAt(obj: unknown, path: string[]): unknown {
  let cur = obj;

  for (const key of path) {
    if (cur === null || typeof cur !== 'object') {
      return undefined;
    }

    cur = (cur as Record<string, unknown>)[key];
  }

  return cur;
}

/**
 * substitute walks a value, replacing references with what they point at and
 * collecting the resources they came from.
 */
function substitute(value: unknown, lookup: Lookup, sources: Set<string>): unknown {
  const ref = decode(value);

  if (ref) {
    sources.add(ref.name);

    const resource = resolveSource(ref.name, lookup);

    if (ref.path[0] === EXTERNAL_NAME) {
      return externalNameOf(resource);
    }

    // A selector is written against the resource's own type, so its path
    // starts at the resource body rather than at the wrapper observed state
    // stores it in.
    return valueAt(resource, ref.path);
  }

  if (Array.isArray(value)) {
    return value.map((v) => substitute(v, lookup, sources)).filter((v) => v !== undefined);
  }

  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(value)) {
      const r = substitute(v, lookup, sources);

      // Leave out a field whose value isn't available yet, rather than
      // sending an explicit null a provider would try to apply.
      if (r !== undefined) {
        out[k] = r;
      }
    }

    return out;
  }

  return value;
}
