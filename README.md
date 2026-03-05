# Crossplane Function SDK for TypeScript

A TypeScript SDK for building [Crossplane Composition Functions](https://docs.crossplane.io/latest/composition/compositions/). This SDK provides type-safe interfaces and utilities for creating functions that generate and manage Crossplane resources.

A template function built on this SDK is available at <https://github.com/crossplane/function-template-typescript>.

## Overview

This SDK can be used as the base of a Crossplane Composition function.

For complete usage instructions on importing this SDK into your projects, see [USAGE.md](USAGE.md).

## Quick Start (Using as an Importable SDK)

### Installation

```bash
npm install @crossplane-org/function-sdk-typescript
```

### Creating Your Function

Implement the `FunctionHandler` interface:

```typescript
import type {
    FunctionHandler,
    RunFunctionRequest,
    RunFunctionResponse,
    Logger
} from "@crossplane-org/function-sdk-typescript";
import {
    to,
    normal,
    fatal,
    setDesiredComposedResources,
    getDesiredComposedResources,
    getObservedCompositeResource,
    Resource
} from "@crossplane-org/function-sdk-typescript";

export class MyFunction implements FunctionHandler {
    async RunFunction(req: RunFunctionRequest, logger?: Logger): Promise<RunFunctionResponse> {
        let rsp = to(req);

        try {
            // Get observed composite resource and desired composed resources
            const oxr = getObservedCompositeResource(req);
            let dcds = getDesiredComposedResources(req);

            logger?.info("Processing function request");

            // Your function logic here - create a ConfigMap
            dcds["my-resource"] = Resource.fromJSON({
                resource: {
                    apiVersion: "v1",
                    kind: "ConfigMap",
                    metadata: { name: "my-config" },
                    data: { key: "value" }
                }
            });

            rsp = setDesiredComposedResources(rsp, dcds);
            normal(rsp, "Function completed successfully");

            return rsp;
        } catch (error) {
            logger?.error({ error }, "Function failed");
            fatal(rsp, error instanceof Error ? error.message : String(error));
            return rsp;
        }
    }
}
```

See [USAGE.md](USAGE.md) for complete examples and API documentation.

## Development Setup (For SDK Contributors)

### Prerequisites

- Node.js 18+
- npm or yarn
- Docker (for building container images)
- protoc (Protocol Buffer compiler) - `brew install protobuf`

### Setup

```bash
npm install
```

### Testing

The SDK uses [Vitest](https://vitest.dev/) for testing. Tests are located alongside source files with the `.test.ts` extension.

```bash
# Run tests once
npm test

# Run tests in watch mode (for development)
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

Test files are automatically excluded from the build output.

### Running the Example Function

Start the function server in development mode:

```bash
npm run build
npm run local-run
```

The function will listen on `0.0.0.0:9443` by default.

### Testing Your Function

After running `npm run local-run` in another terminal, use the Crossplane CLI to
call your local function using `crossplane render`:

```bash
cd example
./render.sh
```

### Basic Function Structure

The main function logic goes in `src/function/function.ts`:

```typescript
import { Resource, RunFunctionRequest, RunFunctionResponse } from "../proto/run_function.js";
import { to, setDesiredComposedResources, normal } from "../response/response.js";
import { getDesiredComposedResources } from "../request/request.js";

export class FunctionRunner {
    async RunFunction(
        req: RunFunctionRequest,
        logger?: Logger,
    ): Promise<RunFunctionResponse> {
        // Initialize response from request
        let rsp = to(req);

        // Get desired composed resources from request
        let dcds = getDesiredComposedResources(req);

        // Create a new resource using plain JSON
        dcds["my-deployment"] = Resource.fromJSON({
            resource: {
                apiVersion: "apps/v1",
                kind: "Deployment",
                metadata: {
                    name: "my-deployment",
                    namespace: "default",
                },
                spec: {
                    replicas: 3,
                    // ... deployment spec
                },
            },
        });

        // Set desired resources in response
        rsp = setDesiredComposedResources(rsp, dcds);

        // Add a result message
        normal(rsp, "Resources created successfully");

        return rsp;
    }
}
```

### Using Kubernetes Models

You can use type-safe Kubernetes models from the `kubernetes-models` package:

```typescript
import { Deployment } from "kubernetes-models/apps/v1";
import { Pod } from "kubernetes-models/v1";
import { fromModel } from "@crossplane-org/function-sdk-typescript";

// Create a type-safe Pod
const pod = new Pod({
    metadata: {
        name: "my-pod",
        namespace: "default",
    },
    spec: {
        containers: [{
            name: "app",
            image: "nginx:latest",
        }],
    },
});

// Validate the pod
pod.validate();

// Convert to Resource using the simplified helper
dcds["my-pod"] = fromModel(pod);

// Alternative: Using the lower-level API
dcds["my-pod"] = Resource.fromJSON({
    resource: pod.toJSON()
});
```

### Helper Functions

#### Request Helpers

The SDK provides comprehensive request helpers to extract data from RunFunctionRequest:

```typescript
import {
    getObservedCompositeResource,
    getDesiredCompositeResource,
    getDesiredComposedResources,
    getObservedComposedResources,
    getInput,
    getContextKey,
    getRequiredResource,
    getRequiredResources,
    getRequiredSchema,
    getRequiredSchemas,
    getCredentials,
    advertiseCapabilities,
    hasCapability,
    Capability,
} from "@crossplane-org/function-sdk-typescript";

// Get the observed composite resource (XR)
const oxr = getObservedCompositeResource(req);

// Get the desired composite resource
const dxr = getDesiredCompositeResource(req);

// Get desired composed resources
const dcds = getDesiredComposedResources(req);

// Get observed composed resources
const ocds = getObservedComposedResources(req);

// Get function input configuration
const input = getInput(req);

// Get context value from previous function
const [value, exists] = getContextKey(req, "my-key");

// Get a specific required resource by name
const [resources, resolved] = getRequiredResource(req, "app-config");

// Get all required resources
const required = getRequiredResources(req);

// Get a specific required schema by name
const [schema, resolved] = getRequiredSchema(req, "xr-schema");

// Get all required schemas
const schemas = getRequiredSchemas(req);

// Get credentials
const creds = getCredentials(req, "aws-creds");

// Check if Crossplane advertises capabilities (v2.2+)
if (advertiseCapabilities(req)) {
    // Check for specific capability support
    if (hasCapability(req, Capability.CAPABILITY_REQUIRED_RESOURCES)) {
        // Use required resources feature
    }
}
```

#### Response Helpers

The SDK provides response helpers to build and manipulate RunFunctionResponse:

```typescript
import {
    to,
    setDesiredComposedResources,
    setDesiredCompositeResource,
    setDesiredCompositeStatus,
    setContextKey,
    setOutput,
    normal,
    fatal,
    warning,
    requireResource,
    requireSchema,
    DEFAULT_TTL,
} from "@crossplane-org/function-sdk-typescript";

// Initialize response from request (with optional TTL)
let rsp = to(req, DEFAULT_TTL);

// Set desired composed resources (merges with existing)
rsp = setDesiredComposedResources(rsp, dcds);

// Set desired composite resource
rsp = setDesiredCompositeResource(rsp, dxr);

// Update composite resource status
rsp = setDesiredCompositeStatus({ rsp, status: { ready: true } });

// Set context for next function
rsp = setContextKey(rsp, "my-key", "my-value");

// Set output (returned to user)
rsp = setOutput(rsp, { result: "success" });

// Add result messages
normal(rsp, "Success message");
warning(rsp, "Warning message");
fatal(rsp, "Fatal error message");

// Request Crossplane fetch a resource (available in next invocation)
rsp = requireResource(rsp, "app-config", {
    apiVersion: "v1",
    kind: "ConfigMap",
    matchName: "my-config",
    namespace: "default"
});

// Request Crossplane fetch a schema (available in next invocation)
rsp = requireSchema(rsp, "xr-schema", "example.org/v1", "MyResource");
```

#### Resource Helpers

The SDK provides utilities for working with Kubernetes resources:

```typescript
import {
    Resource,
    asObject,
    asStruct,
    fromObject,
    toObject,
    newDesiredComposed,
    update,
    getCondition,
} from "@crossplane-org/function-sdk-typescript";

// Create a Resource from a plain object
const resource = fromObject({
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name: "my-config" }
});

// Extract plain object from Resource
const obj = toObject(resource);

// Convert between struct and object formats
const struct = asStruct(obj);
const plainObj = asObject(struct);

// Create a new empty DesiredComposed resource
const desired = newDesiredComposed();

// Deep merge updates into a resource (arrays replaced by default)
update(resource, {
    resource: {
        spec: {
            forProvider: {
                region: "us-west-2",
                tags: ["env:prod"]  // Replaces existing tags
            }
        }
    }
});

// Or merge with array concatenation
update(resource, {
    resource: {
        spec: {
            forProvider: {
                tags: ["new-tag"]  // Appended to existing tags
            }
        }
    }
}, { mergeArrays: true });

// Get a status condition from a resource
const readyCondition = getCondition(resource.resource, "Ready");
if (readyCondition.status === "True") {
    console.log("Resource is ready");
}
```

### Error Handling

```typescript
try {
    // Your function logic
} catch (error) {
    fatal(rsp, error instanceof Error ? error.message : String(error));
    return rsp;
}
```

## Publishing the SDK

This section is for SDK maintainers who want to publish updates to npm.

### Prepare for Publishing

1. Update version in [package.json](package.json)
2. Build the TypeScript code:

   ```bash
   npm run build
   ```

3. Verify the build output in `dist/`:

   ```bash
   ls -la dist/
   ```

### Test the Package Locally

Before publishing, test the package locally:

```bash
# Create a tarball
npm pack

# This creates function-sdk-typescript-<version>.tgz
# Install it in another project to test
npm install /path/to/function-sdk-typescript-<version>.tgz
```

### Publish to npm

```bash
# Dry run to see what will be published
npm publish --dry-run

# Publish to npm (requires authentication)
npm publish
```

The [package.json](package.json) `files` field ensures only necessary files are included:

- `dist/` - Compiled JavaScript and type definitions
- `README.md` - Documentation

### Building Function Containers

If you're developing a function based on this SDK and need to containerize it:

1. Create a `Dockerfile` for your function
2. Build the image with your function code
3. Package as a Crossplane function package

See the Crossplane docs [Releasing Crossplane Extensions](https://docs.crossplane.io/latest/guides/extensions-release-process/) for details on building and packaging functions.

## Development

### Generating Protobuf Code

This repo uses the Protobuf definitions from [Crossplane](https://github.com/crossplane/crossplane/tree/main/proto/fn). If the upstream definition is updated, copy it into this repo and regenerate the TypeScript code.

#### Protocol Buffers Prerequisites

You need the Protocol Buffer compiler (`protoc`) installed:

```bash
# macOS
brew install protobuf

# Verify installation
protoc --version  # Should be 3.x or higher
```

#### Regenerating Code

To regenerate TypeScript code from the Protobuf definitions:

```bash
./scripts/protoc-gen.sh
```

This script uses [ts-proto](https://github.com/stephenh/ts-proto) to generate:

- Type definitions from protobuf messages
- gRPC service stubs for the FunctionRunner service
- Conversion utilities for Protocol Buffer types

After regenerating, rebuild the project:

```bash
npm run build
```

### Local Development Workflow

For SDK contributors making changes to the SDK itself:

1. Make changes to source files in `src/`
2. Build the SDK: `npm run build`
3. Test locally by creating a tarball: `npm pack`
4. Install the tarball in a test project to verify changes

For testing with an example function:

1. Implement an example function using the SDK
2. Build: `npm run build`
3. Run the function server locally (if you have a main entry point)
4. Test with `crossplane beta render` using example compositions

### Using with Crossplane

Create a `Function` resource in your cluster:

```yaml
apiVersion: pkg.crossplane.io/v1beta1
kind: Function
metadata:
  name: your-registry-function-typescript
spec:
  package: your-registry/function-typescript:v0.1.0
```

Reference it in your Composition:

```yaml
apiVersion: apiextensions.crossplane.io/v1
kind: Composition
metadata:
  name: my-composition
spec:
  mode: Pipeline
  pipeline:
  - step: run-typescript-function
    functionRef:
      name: function-typescript
```

### Creating Resources

Resources can be created from Typescript Objects using `Resource.fromJSON()`:

```typescript
// Plain JSON object automatically converted to Struct
Resource.fromJSON({
    resource: {
        apiVersion: "v1",
        kind: "ConfigMap",
        // ... any valid Kubernetes resource
    }
});
```

## API Reference

### Exported Types and Interfaces

The SDK exports all types and interfaces from a single entry point:

```typescript
import {
    // Core interfaces
    FunctionHandler,
    FunctionRunner,
    Logger,

    // Request/Response types
    RunFunctionRequest,
    RunFunctionResponse,
    Resource,

    // Resource types
    Composite,
    ObservedComposed,
    DesiredComposed,
    ConnectionDetails,
    MergeOptions,

    // Status condition types
    Condition as ResourceCondition,

    // Protocol buffer types
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
    Requirements,
    ResourceSelector,
    SchemaSelector,
    Schema,
    Capability,

    // Runtime types
    ServerOptions,
} from "@crossplane-org/function-sdk-typescript";
```

### Core Functions

#### Response Functions

- **`to(req, ttl?)`** - Initialize a response from a request
- **`normal(rsp, message)`** - Add a normal (info) result
- **`warning(rsp, message)`** - Add a warning result
- **`fatal(rsp, message)`** - Add a fatal error result
- **`setDesiredComposedResources(rsp, resources)`** - Set desired composed resources
- **`setDesiredCompositeStatus({rsp, status})`** - Update XR status
- **`setContextKey(rsp, key, value)`** - Set context for next function
- **`setOutput(rsp, output)`** - Set function output
- **`requireResource(rsp, name, selector)`** - Request Crossplane fetch resources
- **`requireSchema(rsp, name, apiVersion, kind)`** - Request Crossplane fetch schemas

#### Request Functions

- **`getObservedCompositeResource(req)`** - Get the observed XR
- **`getDesiredCompositeResource(req)`** - Get the desired XR
- **`getDesiredComposedResources(req)`** - Get desired composed resources
- **`getObservedComposedResources(req)`** - Get observed composed resources
- **`getContextKey(req, key)`** - Get context from previous function
- **`getInput(req)`** - Get function input configuration
- **`getRequiredResource(req, name)`** - Get a required resource by name
- **`getRequiredResources(req)`** - Get all required resources (deprecated)
- **`getRequiredSchema(req, name)`** - Get a required schema by name
- **`getRequiredSchemas(req)`** - Get all required schemas
- **`getCredentials(req, name)`** - Get credentials by name (throws error if not found)
- **`advertiseCapabilities(req)`** - Check if Crossplane advertises capabilities
- **`hasCapability(req, capability)`** - Check for a specific capability

#### Resource Functions

- **`fromObject(obj, connectionDetails?, ready?)`** - Create Resource from plain object
- **`fromModel(model, connectionDetails?, ready?)`** - Create Resource from kubernetes-models
- **`toObject(resource)`** - Extract plain object from Resource
- **`update(resource, source, options?)`** - Deep merge data into a Resource
- **`getCondition(resource, type)`** - Extract a status condition by type
- **`newDesiredComposed()`** - Create an empty DesiredComposed resource

See [USAGE.md](USAGE.md) for detailed API documentation and examples.

## Dependencies

### Runtime Dependencies

- **`@grpc/grpc-js`** - gRPC implementation for Node.js
- **`@grpc/proto-loader`** - Protocol buffer loader
- **`google-protobuf`** - Google Protocol Buffers runtime
- **`ts-proto`** - TypeScript protobuf code generator
- **`ts-deepmerge`** - Deep merging utility for resources
- **`pino`** - Fast, structured JSON logger
- **`kubernetes-models`** - Type-safe Kubernetes resource models (optional)

### Development Dependencies

- **`typescript`** - TypeScript compiler (v5.7+)
- **`@types/node`** - Node.js type definitions
- **`@types/google-protobuf`** - Google Protobuf type definitions
- **`ts-node`** - TypeScript execution engine
- **`vitest`** - Fast unit test framework
- **`@vitest/coverage-v8`** - Code coverage reporting
- **Protocol Buffer compiler (`protoc`)** - Required for regenerating protobuf code

## Troubleshooting

### Installation Issues

**Problem**: Package not found or installation fails

```bash
# Verify npm registry access
npm ping

# Try installing with verbose output
npm install @crossplane-org/function-sdk-typescript --verbose
```

### Type Errors

**Problem**: TypeScript can't find types from the SDK

**Solution**: Ensure your `tsconfig.json` includes:

```json
{
  "compilerOptions": {
    "moduleResolution": "node",
    "esModuleInterop": true
  }
}
```

### Import Errors

**Problem**: `Cannot find module '@crossplane-org/function-sdk-typescript'`

**Solution**: Verify the package is installed:

```bash
npm list @crossplane-org/function-sdk-typescript
```

If missing, reinstall:

```bash
npm install @crossplane-org/function-sdk-typescript
```

### Port Already in Use (when running functions)

**Problem**: `EADDRINUSE` error when starting function server

**Solution**: Kill the process using the port:

```bash
# Find and kill process on port 9443
lsof -ti:9443 | xargs kill -9
```

### Protocol Buffer Compilation Errors (for SDK contributors)

**Problem**: Errors when running `./scripts/protoc-gen.sh`

**Solution**: Ensure Protocol Buffer compiler is installed:

```bash
# Check version
protoc --version  # Should be 3.x or higher

# macOS installation
brew install protobuf

# After installing, regenerate
./scripts/protoc-gen.sh
npm run build
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable (use `npm test` to run tests)
5. Ensure all tests pass and the build succeeds (`npm run build`)
6. Submit a pull request

## License

Apache 2.0

## Resources

### Crossplane Documentation

- [Crossplane Documentation](https://docs.crossplane.io)
- [Composition Functions](https://docs.crossplane.io/latest/composition/compositions/#use-a-function-in-a-composition)
- [Releasing Crossplane Extensions](https://docs.crossplane.io/latest/guides/extensions-release-process/)


### SDK Documentation

- [USAGE.md](USAGE.md) - Complete usage guide for this SDK

### Related Tools

- [ts-proto](https://github.com/stephenh/ts-proto) - TypeScript protobuf code generator
- [kubernetes-models](https://github.com/tommy351/kubernetes-models-ts) - Type-safe Kubernetes resource models for TypeScript
- [Pino](https://getpino.io/) - Fast JSON logger
- [gRPC-js](https://github.com/grpc/grpc-node/tree/master/packages/grpc-js) - Pure JavaScript gRPC implementation
