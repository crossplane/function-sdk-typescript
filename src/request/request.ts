/**
 * Request utilities for working with RunFunctionRequest
 *
 * This module provides helper functions to extract data from RunFunctionRequest objects,
 * including composite resources, composed resources, input configuration, context values,
 * required resources, and credentials.
 */

import {
  Capability,
  Credentials,
  Resource,
  Resources,
  RunFunctionRequest,
} from '../proto/run_function.js';

/**
 * Get the desired composite resource (XR) from the request.
 *
 * The desired composite resource represents the intended state of the composite resource
 * as determined by the function pipeline up to this point.
 *
 * @param req - The RunFunctionRequest containing the desired state
 * @returns The desired composite Resource, or undefined if not present
 *
 * @example
 * ```typescript
 * const dxr = getDesiredCompositeResource(req);
 * if (dxr?.resource) {
 *   console.log("Composite resource name:", dxr.resource.metadata.name);
 * }
 * ```
 */
export function getDesiredCompositeResource(req: RunFunctionRequest): Resource | undefined {
  return req.desired?.composite;
}

/**
 * Get the observed composite resource (XR) from the request.
 *
 * The observed composite resource represents the actual current state of the composite
 * resource as observed in the cluster. This includes the resource's metadata, spec, and status.
 *
 * @param req - The RunFunctionRequest containing the observed state
 * @returns The observed composite Resource, or undefined if not present
 *
 * @example
 * ```typescript
 * const oxr = getObservedCompositeResource(req);
 * if (oxr?.resource?.status) {
 *   console.log("Current status:", oxr.resource.status);
 * }
 * ```
 */
export function getObservedCompositeResource(req: RunFunctionRequest): Resource | undefined {
  return req.observed?.composite;
}

/**
 * Get the desired composed resources from the request.
 *
 * Desired composed resources represent the intended state of resources that are part of
 * this composition. These are the resources that the function pipeline wants to create
 * or update. The map key is the resource name used to identify it in the pipeline.
 *
 * @param req - The RunFunctionRequest containing desired composed resources
 * @returns A map of resource names to Resource objects, or empty object if none exist
 *
 * @example
 * ```typescript
 * const dcds = getDesiredComposedResources(req);
 * for (const [name, resource] of Object.entries(dcds)) {
 *   console.log(`Resource ${name}: ${resource.resource?.kind}`);
 * }
 * ```
 */
export function getDesiredComposedResources(req: RunFunctionRequest): { [key: string]: Resource } {
  if (req.desired?.resources) {
    return req.desired?.resources;
  }
  return {};
}

/**
 * Get the observed composed resources from the request.
 *
 * Observed composed resources represent the actual current state of resources that are
 * part of this composition. This includes their current status, connection details,
 * and complete resource state as observed in the cluster.
 *
 * @param req - The RunFunctionRequest containing observed composed resources
 * @returns A map of resource names to Resource objects with connection details, or empty object if none exist
 *
 * @example
 * ```typescript
 * const observedComposed = getObservedComposedResources(req);
 * for (const [name, resource] of Object.entries(observedComposed)) {
 *   if (resource.connectionDetails) {
 *     console.log(`Resource ${name} has connection details`);
 *   }
 * }
 * ```
 */
export function getObservedComposedResources(req: RunFunctionRequest): { [key: string]: Resource } {
  if (req.observed?.resources) {
    return req.observed?.resources;
  }
  return {};
}

/**
 * Get the input configuration from the request.
 *
 * The input contains function-specific configuration specified in the Composition's
 * function pipeline. This is the data from the 'input' block of the function's
 * pipeline entry.
 *
 * @param req - The RunFunctionRequest containing input configuration
 * @returns The input object, or undefined if not present
 *
 * @example
 * ```typescript
 * const input = getInput(req);
 * if (input) {
 *   const replicas = input.replicas || 3;
 *   console.log("Desired replicas:", replicas);
 * }
 * ```
 */
export function getInput(req: RunFunctionRequest): Record<string, unknown> | undefined {
  return req.input;
}

/**
 * Get a value from the request context by key.
 *
 * Context is used to pass arbitrary data between functions in a pipeline.
 * Functions can read context set by previous functions and set context for
 * subsequent functions. Crossplane discards all context after the last function
 * in the pipeline completes.
 *
 * @param req - The RunFunctionRequest containing context data
 * @param key - The context key to retrieve
 * @returns A tuple of [value, exists] where exists indicates if the key was found
 *
 * @example
 * ```typescript
 * const [dbEndpoint, exists] = getContextKey(req, "database-endpoint");
 * if (exists) {
 *   console.log("Database endpoint:", dbEndpoint);
 * } else {
 *   console.log("Database endpoint not set by previous function");
 * }
 * ```
 */
export function getContextKey(req: RunFunctionRequest, key: string): [unknown, boolean] {
  if (req.context && key in req.context) {
    return [req.context[key], true];
  }
  return [undefined, false];
}

/**
 * Get required resources from the request.
 *
 * Required resources are resources that the function specified it needs in its
 * requirements. These are populated by Crossplane based on the ResourceSelector
 * specified in the function's requirements. The map key corresponds to the key
 * in the RunFunctionResponse's requirements.resources field.
 *
 * @param req - The RunFunctionRequest containing required resources
 * @returns A map of required resources by name, or empty object if none exist
 *
 * @example
 * ```typescript
 * const required = getRequiredResources(req);
 * const secrets = required["secrets"];
 * if (secrets?.items) {
 *   console.log(`Found ${secrets.items.length} secrets`);
 * }
 * ```
 */
export function getRequiredResources(req: RunFunctionRequest): { [key: string]: Resources } {
  return req.requiredResources || {};
}

/**
 * Get extra resources from the request.
 *
 * @deprecated Use getRequiredResources instead. This field is deprecated in favor
 * of requiredResources and will be removed in a future version.
 *
 * Extra resources are resources that the function specified it needs in its
 * requirements using the deprecated extra_resources field.
 *
 * @param req - The RunFunctionRequest containing extra resources
 * @returns A map of extra resources by name, or empty object if none exist
 */
export function getExtraResources(req: RunFunctionRequest): { [key: string]: Resources } {
  return req.extraResources || {};
}

/**
 * Get credentials by name from the request.
 *
 * Credentials are provided by Crossplane and typically loaded from Secrets.
 * Functions can use these credentials to authenticate with external systems.
 * The credentials data is a map of keys to binary data (Buffer).
 *
 * @param req - The RunFunctionRequest containing credentials
 * @param name - The credential name to retrieve
 * @returns The Credentials object containing credential data
 * @throws Error if the specified credentials are not found
 *
 * @example
 * ```typescript
 * try {
 *   const creds = getCredentials(req, "aws-credentials");
 *   const accessKey = creds.credentialData?.data["access-key"];
 *   if (accessKey) {
 *     console.log("Access key found");
 *   }
 * } catch (error) {
 *   console.error("Credentials not found:", error.message);
 * }
 * ```
 */
export function getCredentials(req: RunFunctionRequest, name: string): Credentials {
  const creds = req.credentials?.[name];
  if (!creds) {
    throw new Error(`credentials "${name}" not found`);
  }
  return creds;
}

/**
 * Get a required resource from the request by name.
 *
 * Required resources are resources that the function specified it needs using
 * response.requireResource. Crossplane fetches the requested resources and includes
 * them in the next request. The boolean return value indicates whether Crossplane
 * has resolved the requirement.
 *
 * @param req - The RunFunctionRequest containing required resources
 * @param name - The name of the required resource group to retrieve
 * @returns A tuple of [resources, resolved]:
 *   - resources: Array of Resource objects (empty if not found)
 *   - resolved: true if Crossplane attempted to resolve the requirement, false otherwise
 *
 * @example
 * ```typescript
 * // After calling requireResource in a previous function invocation:
 * const [resources, resolved] = getRequiredResource(req, "app-config");
 * if (!resolved) {
 *   console.log("Resource requirement not yet resolved by Crossplane");
 * } else if (resources.length === 0) {
 *   console.log("Resource requirement resolved but no resources found");
 * } else {
 *   console.log("Found resources:", resources);
 *   resources.forEach(r => console.log(r.resource));
 * }
 * ```
 */
export function getRequiredResource(req: RunFunctionRequest, name: string): [Resource[], boolean] {
  if (!req.requiredResources) {
    return [[], false];
  }

  const rrs = req.requiredResources[name];
  if (!rrs) {
    return [[], false];
  }

  const out: Resource[] = [];
  for (const item of rrs.items || []) {
    if (!item || !item.resource) {
      continue;
    }

    out.push(
      Resource.create({
        resource: item.resource,
        connectionDetails: item.connectionDetails || {},
        ready: item.ready || 0,
      })
    );
  }

  return [out, true];
}

/**
 * Get all required schemas from the request.
 *
 * Returns all schemas that were requested using response.requireSchema and
 * resolved by Crossplane. The map key corresponds to the name used in
 * requireSchema. Each value is the OpenAPI v3 schema as an unstructured object,
 * or undefined if the schema could not be found.
 *
 * @param req - The RunFunctionRequest containing required schemas
 * @returns A map of schema names to OpenAPI v3 schema objects (or undefined if not found)
 *
 * @example
 * ```typescript
 * const schemas = getRequiredSchemas(req);
 * for (const [name, schema] of Object.entries(schemas)) {
 *   if (schema) {
 *     console.log(`Schema ${name}:`, schema);
 *   } else {
 *     console.log(`Schema ${name} was requested but not found`);
 *   }
 * }
 * ```
 */
export function getRequiredSchemas(
  req: RunFunctionRequest
): Record<string, Record<string, unknown> | undefined> {
  const out: Record<string, Record<string, unknown> | undefined> = {};

  if (!req.requiredSchemas) {
    return out;
  }

  for (const [name, schema] of Object.entries(req.requiredSchemas)) {
    out[name] = schema?.openapiV3;
  }

  return out;
}

/**
 * Get a required schema from the request by name.
 *
 * Returns the OpenAPI v3 schema for a resource kind that was requested using
 * response.requireSchema. The boolean return value indicates whether Crossplane
 * has resolved the requirement.
 *
 * @param req - The RunFunctionRequest containing required schemas
 * @param name - The name of the required schema to retrieve
 * @returns A tuple of [schema, resolved]:
 *   - schema: The OpenAPI v3 schema object, or undefined if not found
 *   - resolved: true if Crossplane attempted to resolve the requirement, false otherwise
 *
 * Note: When resolved is true but schema is undefined, it means Crossplane tried
 * to find the schema but it doesn't exist for that resource kind.
 *
 * @example
 * ```typescript
 * // After calling requireSchema in a previous function invocation:
 * const [schema, resolved] = getRequiredSchema(req, "xr-schema");
 * if (!resolved) {
 *   console.log("Schema not yet resolved by Crossplane");
 * } else if (!schema) {
 *   console.log("Schema resolved but not found (kind may not exist)");
 * } else {
 *   console.log("Schema properties:", schema.properties);
 *   console.log("Required fields:", schema.required);
 * }
 * ```
 */
export function getRequiredSchema(
  req: RunFunctionRequest,
  name: string
): [Record<string, unknown> | undefined, boolean] {
  const schemas = req.requiredSchemas;
  if (!schemas) {
    return [undefined, false];
  }

  const schema = schemas[name];
  if (!schema) {
    return [undefined, false];
  }

  return [schema.openapiV3, true];
}

/**
 * Check whether Crossplane advertises its capabilities.
 *
 * Crossplane v2.2 and later advertise their capabilities in the request
 * metadata. If this returns false, the calling Crossplane predates capability
 * advertisement and hasCapability will always return false, even for features
 * the older Crossplane does support.
 *
 * @param req - The RunFunctionRequest to check
 * @returns true if Crossplane advertises its capabilities
 *
 * @example
 * ```typescript
 * if (!advertiseCapabilities(req)) {
 *   // Pre-v2.2 Crossplane, capabilities are unknown
 *   console.log("Crossplane version predates capability advertisement");
 * } else if (hasCapability(req, Capability.CAPABILITY_REQUIRED_SCHEMAS)) {
 *   requireSchema(rsp, "xr", xrApiVersion, xrKind);
 * }
 * ```
 */
export function advertiseCapabilities(req: RunFunctionRequest): boolean {
  if (!req.meta?.capabilities) {
    return false;
  }
  return req.meta.capabilities.includes(Capability.CAPABILITY_CAPABILITIES);
}

/**
 * Check whether Crossplane advertises a particular capability.
 *
 * Crossplane sends its capabilities in the request metadata. Functions can use
 * this to determine whether Crossplane will honor certain fields in their
 * response, or populate certain fields in their request.
 *
 * Use advertiseCapabilities to check whether Crossplane advertises its
 * capabilities at all. If it doesn't, hasCapability always returns false even
 * for features the older Crossplane does support.
 *
 * @param req - The RunFunctionRequest to check
 * @param cap - The capability to check for (e.g., Capability.CAPABILITY_REQUIRED_SCHEMAS)
 * @returns true if the capability is present in the request metadata
 *
 * @example
 * ```typescript
 * import { Capability } from './proto/run_function.js';
 *
 * if (hasCapability(req, Capability.CAPABILITY_REQUIRED_SCHEMAS)) {
 *   requireSchema(rsp, "xr", xrApiVersion, xrKind);
 * }
 *
 * if (hasCapability(req, Capability.CAPABILITY_CONDITIONS)) {
 *   // Safe to return status conditions
 *   rsp.conditions = [{ type: "Ready", status: "True" }];
 * }
 * ```
 */
export function hasCapability(req: RunFunctionRequest, cap: Capability): boolean {
  if (!req.meta?.capabilities) {
    return false;
  }
  return req.meta.capabilities.includes(cap);
}

/**
 * Get the watched resource that triggered this operation.
 *
 * When a WatchOperation creates an Operation, it injects the resource that
 * changed using the special requirement name 'ops.crossplane.io/watched-resource'.
 * This helper makes it easy to access that resource.
 *
 * @param req - The RunFunctionRequest to check for a watched resource
 * @returns The watched resource object, or undefined if not found
 *
 * @example
 * ```typescript
 * // In an operation function triggered by a WatchOperation
 * const watched = getWatchedResource(req);
 * if (watched) {
 *   console.log("Operation triggered by change to:", watched.metadata?.name);
 *   console.log("Resource kind:", watched.kind);
 * }
 * ```
 */
export function getWatchedResource(req: RunFunctionRequest): Record<string, unknown> | undefined {
  const [resources, resolved] = getRequiredResource(req, 'ops.crossplane.io/watched-resource');
  if (!resolved || resources.length === 0) {
    return undefined;
  }
  return resources[0].resource;
}
