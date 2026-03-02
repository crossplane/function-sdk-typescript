// Resource utilities for working with Kubernetes resources and protobuf conversion
import { Ready, Resource } from "../proto/run_function.js";

// Type aliases for better readability
export type ConnectionDetails = { [key: string]: Buffer };

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
export function asObject(
  struct: Record<string, unknown> | undefined,
): Record<string, unknown> {
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
export function asStruct(
  obj: Record<string, unknown>,
): Record<string, unknown> {
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
export function mustStructObject(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  try {
    return asStruct(obj);
  } catch (error) {
    throw new Error(
      `Failed to convert object to struct: ${
        error instanceof Error ? error.message : String(error)
      }`,
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
      `Failed to parse JSON to struct: ${
        error instanceof Error ? error.message : String(error)
      }`,
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
  ready?: Ready,
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
export function toObject(
  resource: Resource,
): Record<string, unknown> | undefined {
  return resource.resource;
}

/**
 * Create a Resource from a kubernetes-models object or plain object
 * This is a convenience function that accepts objects with a toJSON() method
 * (like kubernetes-models) or plain JavaScript objects
 *
 * @param obj - A kubernetes-models object or plain JavaScript object
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
 * // Simple conversion - automatically calls toJSON() if available
 * const resource = fromModel(pod);
 * ```
 */
export function fromModel<T extends Record<string, unknown>>(
  obj: T | { toJSON: () => T },
  connectionDetails?: ConnectionDetails,
  ready?: Ready,
): Resource {
  const resourceObj = typeof obj === "object" &&
      obj !== null &&
      "toJSON" in obj &&
      typeof (obj as any).toJSON === "function"
    ? (obj as any).toJSON()
    : (obj as T);
  return Resource.fromJSON({
    resource: resourceObj as Record<string, unknown>,
    connectionDetails: connectionDetails || {},
    ready: ready !== undefined ? ready : Ready.READY_UNSPECIFIED,
  });
}
