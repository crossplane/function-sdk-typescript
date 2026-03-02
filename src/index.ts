// Main SDK exports for the Crossplane Function SDK

// Core function interfaces and classes
export type { FunctionHandler } from './function/function.js';
export { FunctionRunner, getServer } from './function/function.js';

// Request helpers
export {
  getDesiredCompositeResource,
  getObservedCompositeResource,
  getDesiredComposedResources,
  getObservedComposedResources,
  getInput,
  getContextKey,
  getRequiredResources,
  getCredentials,
} from './request/request.js';

// Response helpers
export {
  to,
  fatal,
  normal,
  warning,
  setDesiredComposedResources,
  setDesiredResources,
  setDesiredCompositeStatus,
  setDesiredCompositeResource,
  updateDesiredComposedResources,
  update,
  setContextKey,
  setOutput,
  DEFAULT_TTL,
} from './response/response.js';

// Resource utilities
export {
  asObject,
  asStruct,
  fromObject,
  fromModel,
  toObject,
  newDesiredComposed,
  mustStructObject,
  mustStructJSON,
  type Composite,
  type ObservedComposed,
  type DesiredComposed,
  type ConnectionDetails,
} from './resource/resource.js';

// Runtime utilities
export {
  newGrpcServer,
  startServer,
  getServerCredentials,
  type ServerOptions,
} from './runtime/runtime.js';

// Protocol buffer types
export {
  RunFunctionRequest,
  RunFunctionResponse,
  Resource,
  Severity,
  Result,
  State,
  Ready,
  Target,
  Status,
  Condition,
  Resources,
  Credentials,
  CredentialData,
  FunctionRunnerServiceService,
} from './proto/run_function.js';

export type { Logger } from 'pino';
