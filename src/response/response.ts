/**
 * Response utilities for working with RunFunctionResponse
 *
 * This module provides helper functions to build and manipulate RunFunctionResponse objects,
 * including setting desired state, managing results, handling context, and working with
 * composite resources and their status.
 */

import {
  Resource,
  RunFunctionRequest,
  RunFunctionResponse,
  Severity,
  Ready,
  ResourceSelector,
} from '../proto/run_function.js';
import { Duration } from '../proto/google/protobuf/duration.js';
import { merge } from 'ts-deepmerge';

/**
 * Default time-to-live for function responses (60 seconds).
 * Crossplane will call the function again when the TTL expires.
 */
const DEFAULT_TTL: Duration = { seconds: 60, nanos: 0 };

export { DEFAULT_TTL };

/**
 * Bootstrap a response from a request.
 *
 * This function creates a new RunFunctionResponse with the request's tag automatically
 * copied, and initializes the desired state from the request. Using this function is
 * the recommended pattern to ensure proper response initialization.
 *
 * The response will:
 * - Copy the request's tag to the response metadata
 * - Initialize the desired state from the request (or create empty if not present)
 * - Set the TTL (time-to-live) for caching
 * - Initialize empty results and conditions arrays
 *
 * @param req - The RunFunctionRequest to bootstrap from
 * @param ttl - Optional time-to-live duration (defaults to 60 seconds)
 * @returns A new RunFunctionResponse initialized from the request
 *
 * @example
 * ```typescript
 * async RunFunction(req: RunFunctionRequest): Promise<RunFunctionResponse> {
 *   let rsp = to(req);
 *   // Add your logic here
 *   normal(rsp, "Processing complete");
 *   return rsp;
 * }
 * ```
 */
export function to(req: RunFunctionRequest, ttl?: Duration): RunFunctionResponse {
  // Initialize desired state if needed
  let desired = req.desired;

  // If desired is not set, initialize it
  if (!desired) {
    desired = { composite: undefined, resources: {} };
  }

  // If composite is explicitly null, initialize it as an empty resource
  if (desired.composite === null) {
    desired.composite = Resource.fromJSON({});
  }

  return {
    conditions: [],
    context: req.context,
    desired: desired,
    meta: { tag: req.meta?.tag || '', ttl: ttl || DEFAULT_TTL },
    requirements: undefined,
    results: [],
  };
}

type NamedResource = {
  name: string;
  resource: Resource;
};

/**
 * Update a map of desired composed resources by adding or updating a named resource.
 *
 * This is a helper function to add a single resource to a map of composed resources.
 * It's useful when building up desired resources before calling setDesiredComposedResources.
 *
 * @param cds - The current map of composed resources
 * @param res - The named resource to add or update
 * @returns The updated map of composed resources
 *
 * @example
 * ```typescript
 * let dcds = getDesiredComposedResources(req);
 * dcds = updateDesiredComposedResources(dcds, {
 *   name: "my-bucket",
 *   resource: Resource.fromJSON({ resource: bucketConfig })
 * });
 * rsp = setDesiredComposedResources(rsp, dcds);
 * ```
 */
export function updateDesiredComposedResources(
  cds: { [key: string]: Resource },
  res: NamedResource
): { [key: string]: Resource } {
  cds[res.name] = res.resource;
  return cds;
}

/**
 * Add a fatal result to the response.
 *
 * Fatal results cause the function pipeline run to be considered a failure.
 * Subsequent functions may still run, but the first fatal result will be
 * returned as an error. Fatal results should be used for errors that prevent
 * the function from producing valid output.
 *
 * @param rsp - The RunFunctionResponse to add the result to
 * @param message - The error message describing the fatal condition
 * @returns The updated response
 *
 * @example
 * ```typescript
 * if (!requiredInput) {
 *   fatal(rsp, "Required input 'databaseSize' not provided");
 *   return rsp;
 * }
 * ```
 */
export function fatal(rsp: RunFunctionResponse, message: string): RunFunctionResponse {
  if (rsp && rsp.results) {
    rsp.results.push({
      severity: Severity.SEVERITY_FATAL,
      message: message,
    });
  }
  return rsp;
}

/**
 * Add a normal result to the response.
 *
 * Normal results are informational and emitted as normal events and debug logs
 * associated with the composite resource (XR) or operation. They indicate
 * successful processing or expected conditions.
 *
 * @param rsp - The RunFunctionResponse to add the result to
 * @param message - The informational message
 *
 * @example
 * ```typescript
 * normal(rsp, "Successfully configured 3 database replicas");
 * ```
 */
export function normal(rsp: RunFunctionResponse, message: string) {
  if (rsp && rsp.results) {
    rsp.results.push({
      severity: Severity.SEVERITY_NORMAL,
      message: message,
    });
  }
}

/**
 * Add a warning result to the response.
 *
 * Warning results are non-fatal issues that should be brought to attention.
 * The entire pipeline will run to completion, but warning events and debug logs
 * will be emitted. Use warnings for recoverable issues or deprecated usage.
 *
 * @param rsp - The RunFunctionResponse to add the result to
 * @param message - The warning message
 *
 * @example
 * ```typescript
 * if (input.legacyFormat) {
 *   warning(rsp, "Using deprecated input format, please migrate to new format");
 * }
 * ```
 */
export function warning(rsp: RunFunctionResponse, message: string) {
  if (rsp && rsp.results) {
    rsp.results.push({
      severity: Severity.SEVERITY_WARNING,
      message: message,
    });
  }
}

/**
 * Set the desired composed resources in the response.
 *
 * This function sets or merges the desired composed resources in the response.
 * It uses deep merge to combine new resources with any existing resources,
 * allowing functions to add or modify resources while preserving those set
 * by previous functions in the pipeline.
 *
 * If the desired state or resources map don't exist, they will be initialized.
 *
 * @param rsp - The RunFunctionResponse to update
 * @param dcds - A map of resource names to Resource objects to set as desired
 * @returns The updated response
 *
 * @example
 * ```typescript
 * const dcds = getDesiredComposedResources(req);
 * dcds["my-deployment"] = Resource.fromJSON({
 *   resource: { apiVersion: "apps/v1", kind: "Deployment", ... }
 * });
 * rsp = setDesiredComposedResources(rsp, dcds);
 * ```
 */
export function setDesiredComposedResources(
  rsp: RunFunctionResponse,
  dcds: { [key: string]: Resource }
): RunFunctionResponse {
  // Ensure desired state exists
  if (!rsp.desired) {
    rsp.desired = { composite: undefined, resources: {} };
  }

  // Merge the new resources with existing ones
  rsp.desired.resources = merge(rsp.desired.resources || {}, dcds) as {
    [key: string]: Resource;
  };

  return rsp;
}

/**
 * Set desired resources from unstructured Kubernetes objects.
 *
 * This is a simpler alternative to setDesiredComposedResources when you have raw
 * Kubernetes resource objects and don't need to specify readiness or connection details.
 * Each resource is converted to the protobuf Resource format with READY_UNSPECIFIED status.
 *
 * The function merges new resources with any existing resources in the desired state,
 * allowing functions to add or modify resources while preserving those set by
 * previous functions in the pipeline.
 *
 * @param rsp - The RunFunctionResponse to update
 * @param resources - A map of resource names to unstructured Kubernetes objects
 * @returns The updated response
 *
 * @example
 * ```typescript
 * rsp = setDesiredResources(rsp, {
 *   "my-bucket": {
 *     apiVersion: "s3.aws.upbound.io/v1beta1",
 *     kind: "Bucket",
 *     metadata: { name: "my-bucket" },
 *     spec: { forProvider: { region: "us-west-2" } }
 *   },
 *   "my-db": {
 *     apiVersion: "rds.aws.upbound.io/v1beta1",
 *     kind: "Instance",
 *     metadata: { name: "my-db" },
 *     spec: { forProvider: { instanceClass: "db.t3.micro" } }
 *   }
 * });
 * ```
 */
export function setDesiredResources(
  rsp: RunFunctionResponse,
  resources: Record<string, Record<string, unknown>>
): RunFunctionResponse {
  // Ensure desired state exists
  if (!rsp.desired) {
    rsp.desired = { composite: undefined, resources: {} };
  }

  // Convert each resource to Resource format
  const convertedResources: { [key: string]: Resource } = {};
  for (const [name, resource] of Object.entries(resources)) {
    convertedResources[name] = Resource.fromJSON({ resource });
  }

  // Merge the new resources with existing ones
  rsp.desired.resources = merge(rsp.desired.resources || {}, convertedResources) as {
    [key: string]: Resource;
  };

  return rsp;
}

/**
 * Update a resource by merging source into target.
 *
 * This function performs a deep merge of the source resource into the target resource,
 * allowing you to update specific fields while preserving others. The merge is performed
 * using the ts-deepmerge library.
 *
 * @param src - The source Resource containing updates
 * @param tgt - The target Resource to be updated
 * @returns A new Resource with merged values
 *
 * @example
 * ```typescript
 * const existing = getDesiredComposedResources(req)["my-resource"];
 * const updated = update(
 *   Resource.fromJSON({ resource: { spec: { replicas: 5 } } }),
 *   existing
 * );
 * ```
 */
export function update(src: Resource, tgt: Resource): Resource {
  return merge(tgt, src) as Resource;
}

/**
 * Set the desired composite resource status.
 *
 * This function updates only the status field of the desired composite resource.
 * It merges the provided status with any existing status, allowing partial updates.
 * Note that functions should only set the status of composite resources (XRs),
 * not their metadata or spec.
 *
 * @param params - Object containing the response and status to set
 * @param params.rsp - The RunFunctionResponse to update
 * @param params.status - The status object to merge into the composite resource
 * @returns The updated response
 *
 * @example
 * ```typescript
 * rsp = setDesiredCompositeStatus({
 *   rsp,
 *   status: {
 *     phase: "Ready",
 *     conditions: [{ type: "Synced", status: "True" }]
 *   }
 * });
 * ```
 */
export function setDesiredCompositeStatus({
  rsp,
  status,
}: {
  rsp: RunFunctionResponse;
  status: Record<string, unknown>;
}): RunFunctionResponse {
  // Ensure desired state exists
  if (!rsp.desired) {
    rsp.desired = { composite: undefined, resources: {} };
  }

  // Ensure composite exists
  if (!rsp.desired.composite) {
    rsp.desired.composite = Resource.fromJSON({});
  }

  // Ensure resource exists
  if (!rsp.desired.composite.resource) {
    rsp.desired.composite.resource = {};
  }

  // Merge the status
  rsp.desired.composite.resource = merge(rsp.desired.composite.resource, {
    status: status,
  }) as Record<string, unknown>;

  return rsp;
}

/**
 * Set a context key in the response.
 *
 * Context allows functions to pass arbitrary data to subsequent functions in the
 * pipeline. The context is initialized if it doesn't exist. Crossplane discards
 * all context returned by the last function in the pipeline.
 *
 * @param rsp - The RunFunctionResponse to update
 * @param key - The context key to set
 * @param value - The value to associate with the key (can be any JSON-serializable value)
 * @returns The updated response
 *
 * @example
 * ```typescript
 * // Set context for next function in pipeline
 * rsp = setContextKey(rsp, "database-endpoint", "db.example.com:5432");
 * rsp = setContextKey(rsp, "connection-config", { host: "db.example.com", port: 5432 });
 * ```
 */
export function setContextKey(
  rsp: RunFunctionResponse,
  key: string,
  value: unknown
): RunFunctionResponse {
  if (!rsp.context) {
    rsp.context = {};
  }
  rsp.context[key] = value;
  return rsp;
}

/**
 * Set the desired composite resource in the response.
 *
 * This function sets the entire desired composite resource and optionally its ready status.
 * The ready status can be used to override Crossplane's standard readiness detection,
 * which normally determines the composite's ready state based on composed resources.
 *
 * Note: Ready status is only used for composition functions, not operations.
 *
 * @param rsp - The RunFunctionResponse to update
 * @param resource - The desired composite resource to set
 * @param ready - Optional ready status (READY_TRUE, READY_FALSE, or READY_UNSPECIFIED)
 * @returns The updated response
 *
 * @example
 * ```typescript
 * const composite = getObservedCompositeResource(req);
 * if (composite) {
 *   // Modify and set as desired with ready status
 *   rsp = setDesiredCompositeResource(rsp, composite, Ready.READY_TRUE);
 * }
 * ```
 */
export function setDesiredCompositeResource(
  rsp: RunFunctionResponse,
  resource: Resource,
  ready?: Ready
): RunFunctionResponse {
  if (!rsp.desired) {
    rsp.desired = { composite: undefined, resources: {} };
  }

  // Create a new resource with the specified ready status using fromPartial
  // to ensure proper type handling for the protobuf-generated Resource type
  rsp.desired.composite = Resource.fromPartial({
    resource: resource.resource,
    connectionDetails: resource.connectionDetails,
    ready: ready !== undefined ? ready : Ready.READY_UNSPECIFIED,
  });

  return rsp;
}

/**
 * Set the function output in the response.
 *
 * Function output is specific to operation functions. The output must be a
 * JSON-serializable object. Composite resources (XRs) will discard any function
 * output, as it's only used by operations.
 *
 * @param rsp - The RunFunctionResponse to update
 * @param output - The output object to set (must be JSON-serializable)
 * @returns The updated response
 *
 * @example
 * ```typescript
 * // For operation functions
 * rsp = setOutput(rsp, {
 *   resourcesCreated: 5,
 *   status: "success",
 *   details: { timestamp: new Date().toISOString() }
 * });
 * ```
 */
export function setOutput(
  rsp: RunFunctionResponse,
  output: Record<string, unknown>
): RunFunctionResponse {
  rsp.output = output;
  return rsp;
}

/**
 * Add a schema requirement to the response.
 *
 * This tells Crossplane to fetch the OpenAPI schema for the specified resource kind
 * and include it in the next request's required_schemas field. Use request.getRequiredSchema
 * to retrieve the resolved schema.
 *
 * For CRDs, Crossplane returns the spec.versions[].schema.openAPIV3Schema field.
 * If Crossplane cannot find a schema for the requested kind, the schema will be
 * empty (getRequiredSchema will return null with ok true).
 *
 * @param rsp - The RunFunctionResponse to update
 * @param name - A unique name to identify this schema requirement
 * @param apiVersion - API version of the resource kind (e.g., "example.org/v1")
 * @param kind - Kind of resource (e.g., "MyResource")
 * @returns The updated response
 *
 * @example
 * ```typescript
 * // Request the OpenAPI schema for an XR type
 * rsp = requireSchema(rsp, "xr-schema", "example.org/v1", "MyResource");
 *
 * // In the next function invocation, retrieve the schema:
 * const [schema, ok] = getRequiredSchema(req, "xr-schema");
 * if (ok && schema) {
 *   console.log("Schema properties:", schema.properties);
 * }
 * ```
 */
export function requireSchema(
  rsp: RunFunctionResponse,
  name: string,
  apiVersion: string,
  kind: string
): RunFunctionResponse {
  if (!rsp.requirements) {
    rsp.requirements = {
      extraResources: {},
      resources: {},
      schemas: {},
    };
  }
  if (!rsp.requirements.schemas) {
    rsp.requirements.schemas = {};
  }
  rsp.requirements.schemas[name] = {
    apiVersion,
    kind,
  };
  return rsp;
}

/**
 * Add a resource requirement to the response.
 *
 * This tells Crossplane to fetch resources matching the selector and include them
 * in the next request's required_resources field. Use request.getRequiredResource
 * to retrieve the resolved resources.
 *
 * The selector can match resources by name or by labels. If namespace is omitted,
 * cluster-scoped resources are matched, or namespaced resources across all namespaces
 * when matching by labels.
 *
 * @param rsp - The RunFunctionResponse to update
 * @param name - A unique name to identify this resource requirement
 * @param selector - The resource selector specifying which resources to fetch
 * @returns The updated response
 *
 * @example
 * ```typescript
 * // Match a specific ConfigMap by name
 * rsp = requireResource(rsp, "app-config", {
 *   apiVersion: "v1",
 *   kind: "ConfigMap",
 *   matchName: "my-app-config",
 *   namespace: "production"
 * });
 *
 * // Match all Secrets with specific labels
 * rsp = requireResource(rsp, "db-secrets", {
 *   apiVersion: "v1",
 *   kind: "Secret",
 *   matchLabels: {
 *     labels: {
 *       app: "database",
 *       tier: "backend"
 *     }
 *   },
 *   namespace: "production"
 * });
 *
 * // In the next function invocation, retrieve the resources:
 * const [resources, ok] = getRequiredResource(req, "app-config");
 * if (ok && resources.length > 0) {
 *   console.log("Found config:", resources[0].resource);
 * }
 * ```
 */
export function requireResource(
  rsp: RunFunctionResponse,
  name: string,
  selector: ResourceSelector
): RunFunctionResponse {
  if (!rsp.requirements) {
    rsp.requirements = {
      extraResources: {},
      resources: {},
      schemas: {},
    };
  }
  if (!rsp.requirements.resources) {
    rsp.requirements.resources = {};
  }
  rsp.requirements.resources[name] = selector;
  return rsp;
}
