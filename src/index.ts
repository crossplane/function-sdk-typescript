// Main SDK exports for the Crossplane Function SDK

// Core function interfaces and classes
export type { FunctionHandler } from './function/function.js';
export { FunctionRunner, getServer } from './function/function.js';

// Request helpers
export {
  advertiseCapabilities,
  getContextKey,
  getCredentials,
  getDesiredComposedResources,
  getDesiredCompositeResource,
  getInput,
  getObservedComposedResources,
  getObservedCompositeResource,
  getRequiredResource,
  getRequiredResources,
  getRequiredSchema,
  getRequiredSchemas,
  getWatchedResource,
  hasCapability,
} from './request/request.js';

// Response helpers
export {
  DEFAULT_TTL,
  fatal,
  normal,
  requireResource,
  requireSchema,
  setContextKey,
  setDesiredComposedResources,
  setDesiredCompositeResource,
  setDesiredCompositeStatus,
  setDesiredResources,
  setOutput,
  to,
  update,
  updateDesiredComposedResources,
  warning,
} from './response/response.js';

// Resource utilities
export {
  asObject,
  asStruct,
  type Composite,
  type Condition as ResourceCondition,
  type ConnectionDetails,
  type DesiredComposed,
  fromModel,
  fromObject,
  getCondition,
  mustStructJSON,
  mustStructObject,
  newDesiredComposed,
  type ObservedComposed,
  toObject,
  update as updateResource,
} from './resource/resource.js';

// Runtime utilities
export {
  getServerCredentials,
  newGrpcServer,
  type ServerOptions,
  startServer,
} from './runtime/runtime.js';

// Protocol buffer types
export {
  Capability,
  Condition,
  CredentialData,
  Credentials,
  FunctionRunnerServiceService,
  Ready,
  Requirements,
  Resource,
  Resources,
  ResourceSelector,
  Result,
  RunFunctionRequest,
  RunFunctionResponse,
  Schema,
  SchemaSelector,
  Severity,
  State,
  Status,
  Target,
} from './proto/run_function.js';

export type { Logger } from 'pino';
