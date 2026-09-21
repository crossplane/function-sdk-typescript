/**
 * Ordering constraints between composed resources.
 *
 * A function can tell Crossplane that one composed resource depends on
 * another. Crossplane then sequences what it creates, updates and deletes:
 * nothing is created until what it depends on is ready, and nothing is deleted
 * until everything depending on it is gone.
 *
 * Ordering is only honoured by a Crossplane that advertises
 * CAPABILITY_DEPENDENCIES. Against an older one the dependencies a function
 * returns are accepted on the wire and ignored, so check before relying on
 * them.
 */
import type {
  Dependencies,
  Dependency,
  RunFunctionRequest,
  RunFunctionResponse,
} from '../proto/run_function.js';

/**
 * Options for a dependency edge.
 */
export interface DependsOnOptions {
  /**
   * Allow the resource to be created without waiting for the resource it
   * depends on to be deleted. It must still exist and be ready before that
   * resource is deleted.
   *
   * Use this for a replacement that has to exist before its predecessor is
   * torn down. Only meaningful when depending on a composed resource.
   */
  createBeforeDestroy?: boolean;
}

/**
 * Get the ordering constraints accumulated by the functions that ran before
 * this one.
 *
 * Returns an empty array when no function has declared any.
 */
export function getDependencies(req: RunFunctionRequest): Dependency[] {
  return req.dependencies?.items ?? [];
}

/**
 * Declare that a composed resource depends on another composed resource.
 *
 * Both names are keys into desired or observed composed resources - the same
 * names used with setDesiredComposedResources.
 *
 * ```typescript
 * dependsOn(rsp, 'subnet', 'vpc');
 * ```
 *
 * Edges accumulate. Declaring the same pair twice is harmless; the duplicate
 * is dropped.
 */
export function dependsOn(
  rsp: RunFunctionResponse,
  resource: string,
  dependsOnResource: string,
  opts?: DependsOnOptions
): RunFunctionResponse {
  return addDependency(rsp, {
    resource,
    composedResource: dependsOnResource,
    requiredResource: undefined,
    createResourceBeforeDestroyingDependency: opts?.createBeforeDestroy ?? false,
  });
}

/**
 * Declare that a composed resource depends on a resource the function requires
 * but doesn't compose.
 *
 * The requirement name is the key used in the function's
 * `requirements.resources`. Crossplane never deletes a resource it didn't
 * compose, so these constrain only creation and updates.
 *
 * ```typescript
 * dependsOnRequired(rsp, 'instance', 'shared-vpc');
 * ```
 */
export function dependsOnRequired(
  rsp: RunFunctionResponse,
  resource: string,
  requirementName: string,
  resourceName?: string
): RunFunctionResponse {
  return addDependency(rsp, {
    resource,
    composedResource: undefined,
    requiredResource: { requirementName, name: resourceName },
    createResourceBeforeDestroyingDependency: false,
  });
}

/**
 * Add a dependency edge to a response, keeping any edges already there.
 *
 * Prefer dependsOn or dependsOnRequired. This is for edges built
 * programmatically.
 */
export function addDependency(rsp: RunFunctionResponse, dep: Dependency): RunFunctionResponse {
  const items = rsp.dependencies?.items ?? [];

  if (items.some((existing) => sameEdge(existing, dep))) {
    return rsp;
  }

  rsp.dependencies = { items: [...items, dep] };

  return rsp;
}

/**
 * Replace a response's ordering constraints wholesale.
 *
 * Edges inherited from earlier functions are already on the response, since
 * to() carries them forward, so this discards them. Use dependsOn to add.
 *
 * Passing an empty array is meaningful: it means "I want no ordering
 * constraints", and clears edges declared by earlier functions. To express
 * "no opinion" instead, leave the field alone.
 */
export function setDependencies(rsp: RunFunctionResponse, deps: Dependency[]): RunFunctionResponse {
  rsp.dependencies = { items: deps };

  return rsp;
}

/**
 * Get the ordering constraints a response currently declares.
 *
 * Returns `undefined` when the response expresses no opinion, which is
 * different from an empty set - see setDependencies.
 */
export function getResponseDependencies(rsp: RunFunctionResponse): Dependencies | undefined {
  return rsp.dependencies;
}

/** sameEdge reports whether two edges express the same constraint. */
function sameEdge(a: Dependency, b: Dependency): boolean {
  return (
    a.resource === b.resource &&
    a.composedResource === b.composedResource &&
    a.requiredResource?.requirementName === b.requiredResource?.requirementName &&
    a.requiredResource?.name === b.requiredResource?.name
  );
}
