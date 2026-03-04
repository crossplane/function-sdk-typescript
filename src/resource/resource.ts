// Resource utilities for working with Kubernetes resources and protobuf conversion
import { Ready, Resource } from '../proto/run_function.js';
import { merge } from 'ts-deepmerge';

// Type aliases for better readability
export type ConnectionDetails = { [key: string]: Buffer };

/**
 * Condition represents a status condition of a Kubernetes resource
 */
export interface Condition {
  /** Type of the condition - e.g. Ready, Synced */
  type: string;
  /** Status of the condition - True, False, or Unknown */
  status: string;
  /** Reason for the condition status - typically CamelCase */
  reason?: string;
  /** Optional message providing details about the condition */
  message?: string;
  /** The last time the condition transitioned to this status */
  lastTransitionTime?: string;
}

/**
 * Composite represents a Crossplane composite resource (XR) with its state
 */
export interface Composite {
  resource: Resource;
  connectionDetails: ConnectionDetails;
  ready: Ready;
}

/**
 * ObservedComposed represents the observed state of a composed resource
 */
export interface ObservedComposed {
  resource: Resource;
  connectionDetails: ConnectionDetails;
}

/**
 * DesiredComposed represents the desired state of a composed resource
 */
export interface DesiredComposed {
  resource: Resource;
  ready: Ready;
}

/**
 * Create a new empty DesiredComposed resource
 */
export function newDesiredComposed(): DesiredComposed {
  return {
    resource: Resource.fromJSON({}),
    ready: Ready.READY_UNSPECIFIED,
  };
}

/**
 * Convert a protobuf Struct to a Kubernetes object (plain JavaScript object)
 * This is a more efficient conversion that avoids JSON round-trips when possible
 *
 * Note: This function is ported from the Go SDK for API compatibility.
 * In TypeScript, this is a pass-through operation since JavaScript objects
 * work directly with the protobuf library. This function may be deprecated
 * in a future version once usage patterns are better understood.
 *
 * @param struct - The protobuf Struct to convert
 * @returns A plain JavaScript object representing the Kubernetes resource
 */
export function asObject(struct: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!struct) {
    return {};
  }

  // The struct is already a plain object in our TypeScript implementation
  // In the Go SDK, this does actual protobuf conversion
  return struct;
}

/**
 * Convert a Kubernetes object to a protobuf Struct
 * This is used when creating Resource objects from plain JavaScript objects
 *
 * Note: This function is ported from the Go SDK for API compatibility.
 * In TypeScript, this is a pass-through operation since JavaScript objects
 * work directly with the protobuf library. This function may be deprecated
 * in a future version once usage patterns are better understood.
 *
 * @param obj - The plain JavaScript object to convert
 * @returns A protobuf Struct representation
 */
export function asStruct(obj: Record<string, unknown>): Record<string, unknown> {
  // In our TypeScript implementation, this is essentially a pass-through
  // The actual conversion happens in the protobuf serialization layer
  return obj;
}

/**
 * Helper function for tests: Convert an object to a Struct, panics on failure
 * Only use this in test code
 *
 * Note: This function is ported from the Go SDK for API compatibility.
 * In TypeScript, this simply calls asStruct() which is a pass-through operation.
 * This function may be deprecated in a future version once usage patterns are
 * better understood.
 *
 * @param obj - The object to convert
 * @returns A Struct representation
 * @throws Error if conversion fails
 */
export function mustStructObject(obj: Record<string, unknown>): Record<string, unknown> {
  try {
    return asStruct(obj);
  } catch (error) {
    throw new Error(
      `Failed to convert object to struct: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Helper function for tests: Parse a JSON string into a Struct, panics on failure
 * Only use this in test code
 *
 * Note: This function is ported from the Go SDK for API compatibility.
 * In TypeScript, this parses JSON and calls asStruct() which is a pass-through operation.
 * Consider using JSON.parse() directly. This function may be deprecated in a future
 * version once usage patterns are better understood.
 *
 * @param json - The JSON string to parse
 * @returns A Struct representation
 * @throws Error if parsing or conversion fails
 */
export function mustStructJSON(json: string): Record<string, unknown> {
  try {
    const obj = JSON.parse(json) as Record<string, unknown>;
    return asStruct(obj);
  } catch (error) {
    throw new Error(
      `Failed to parse JSON to struct: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Create a Resource from a plain JavaScript object
 * This is a convenience wrapper around Resource.fromJSON
 *
 * @param obj - The resource object
 * @param connectionDetails - Optional connection details
 * @param ready - Optional ready status
 * @returns A Resource
 */
export function fromObject(
  obj: Record<string, unknown>,
  connectionDetails?: ConnectionDetails,
  ready?: Ready
): Resource {
  return Resource.fromJSON({
    resource: obj,
    connectionDetails: connectionDetails || {},
    ready: ready !== undefined ? ready : Ready.READY_UNSPECIFIED,
  });
}

/**
 * Get the resource object from a Resource
 * This extracts the plain JavaScript object from the Resource wrapper
 *
 * @param resource - The Resource to extract from
 * @returns The plain JavaScript object, or undefined if not present
 */
export function toObject(resource: Resource): Record<string, unknown> | undefined {
  return resource.resource;
}

/**
 * Create a Resource from a kubernetes-models object
 * This is a convenience function for objects with a toJSON() method
 * (like kubernetes-models objects)
 *
 * For plain JavaScript objects, use fromObject() instead.
 *
 * @param obj - A kubernetes-models object with a toJSON() method
 * @param connectionDetails - Optional connection details
 * @param ready - Optional ready status
 * @returns A Resource
 *
 * @example
 * ```typescript
 * import { Pod } from "kubernetes-models/v1";
 *
 * const pod = new Pod({
 *   metadata: { name: "my-pod" },
 *   spec: { containers: [{ name: "app", image: "nginx" }] }
 * });
 *
 * // Automatically calls toJSON() on the model object
 * const resource = fromModel(pod);
 * ```
 */
export function fromModel<T extends Record<string, unknown>>(
  obj: { toJSON: () => T },
  connectionDetails?: ConnectionDetails,
  ready?: Ready
): Resource {
  // T already extends Record<string, unknown>, so the cast is unnecessary.
  // Pass the result directly to fromObject which accepts T via its signature.
  return fromObject(obj.toJSON(), connectionDetails, ready);
}

/**
 * Update a Resource by merging a source into it.
 *
 * This function performs a deep merge of the source object into the target Resource,
 * allowing you to update specific fields while preserving others. The source can be
 * a plain JavaScript object, a protobuf Struct (Record<string, unknown>), or a
 * Resource object.
 *
 * The merge semantics are similar to a dictionary's update method: fields that don't
 * exist will be added, and fields that exist will be overwritten.
 *
 * @param r - The Resource to update
 * @param source - The source data to merge (plain object, Struct, or Resource)
 *
 * @example
 * ```typescript
 * const bucket = getDesiredComposedResources(req)["my-bucket"];
 * if (bucket) {
 *   // Update specific fields while preserving others
 *   update(bucket, {
 *     resource: {
 *       spec: {
 *         forProvider: {
 *           region: "us-west-2",
 *           tags: { environment: "production" }
 *         }
 *       }
 *     }
 *   });
 * }
 *
 * // You can also merge from another Resource
 * const template = Resource.fromJSON({ resource: templateConfig });
 * update(bucket, template);
 * ```
 */
export function update(r: Resource, source: Record<string, unknown> | Resource): void {
  if (!r.resource) {
    r.resource = {};
  }

  // If source is a Resource, extract its resource field
  const sourceData =
    'resource' in source && typeof source.resource === 'object'
      ? (source as Resource).resource
      : source;

  // Perform deep merge
  r.resource = merge(r.resource, sourceData as Record<string, unknown>) as Record<string, unknown>;
}

/**
 * Get a status condition from a Kubernetes resource.
 *
 * This function extracts a specific status condition from a resource by type.
 * Status conditions follow the Kubernetes standard pattern and are typically
 * found in the resource's status.conditions array.
 *
 * @param resource - A Kubernetes resource object (plain JavaScript object)
 * @param type - The type of status condition to get (e.g., "Ready", "Synced")
 * @returns The requested status condition, or a condition with status "Unknown" if not found
 *
 * @example
 * ```typescript
 * const oxr = getObservedCompositeResource(req);
 * if (oxr?.resource) {
 *   const readyCondition = getCondition(oxr.resource, "Ready");
 *   if (readyCondition.status === "True") {
 *     console.log("Resource is ready");
 *   } else if (readyCondition.status === "False") {
 *     console.log("Resource not ready:", readyCondition.message);
 *   } else {
 *     console.log("Ready status unknown");
 *   }
 * }
 *
 * // Check if a composed resource is synced
 * const bucket = observedResources["my-bucket"];
 * if (bucket?.resource) {
 *   const synced = getCondition(bucket.resource, "Synced");
 *   console.log("Sync status:", synced.status, synced.reason);
 * }
 * ```
 */
export function getCondition(
  resource: Record<string, unknown> | undefined,
  type: string
): Condition {
  const unknown: Condition = { type, status: 'Unknown' };

  if (!resource || !('status' in resource)) {
    return unknown;
  }

  const status = resource.status as Record<string, unknown> | undefined;
  if (!status || !('conditions' in status)) {
    return unknown;
  }

  const conditions = status.conditions as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(conditions)) {
    return unknown;
  }

  for (const c of conditions) {
    if (c.type !== type) {
      continue;
    }

    const condition: Condition = {
      type: String(c.type),
      status: String(c.status),
    };

    if (c.message !== undefined && c.message !== null) {
      condition.message = typeof c.message === 'string' ? c.message : JSON.stringify(c.message);
    }
    if (c.reason !== undefined && c.reason !== null) {
      condition.reason = typeof c.reason === 'string' ? c.reason : JSON.stringify(c.reason);
    }
    if (c.lastTransitionTime !== undefined && c.lastTransitionTime !== null) {
      condition.lastTransitionTime =
        typeof c.lastTransitionTime === 'string'
          ? c.lastTransitionTime
          : JSON.stringify(c.lastTransitionTime);
    }

    return condition;
  }

  return unknown;
}
