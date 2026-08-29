# Function SDK Usage Guide

This document demonstrates how to use the Crossplane Function SDK for TypeScript to build your own functions.

## Installation

```bash
npm install @crossplane-org/function-sdk-typescript
```

## Basic Usage

### 1. Write Your Function

A function is a plain function handed the request and a response to fill in:

```typescript
import {
    Resource,
    normal,
    type ComposeFunction,
} from "@crossplane-org/function-sdk-typescript";

export const compose: ComposeFunction = (req, rsp, logger) => {
    logger?.info("Processing function request");

    rsp.desired.resources["my-config"] = Resource.fromJSON({
        resource: {
            apiVersion: "v1",
            kind: "ConfigMap",
            metadata: { name: "my-config" },
            data: { key: "value" },
        },
    });

    normal(rsp, "Function completed successfully");
    return rsp;
};
```

The response is already initialized from the request, so there is no need to call
`to()`, and its `desired` state is guaranteed to be present — you can write
`rsp.desired.resources[name]` without a non-null assertion. Return the response you
want sent; returning it is required, so forgetting is a compile error rather than an
empty response at runtime.

Note that when the request already carries desired state — as it does for every
function after the first in a pipeline — `rsp.desired` is the same object as
`req.desired`, not a copy.

#### Implementing FunctionHandler Instead

If you would rather implement the full interface, `serve()` accepts that too:

```typescript
import {
    FunctionHandler,
    RunFunctionRequest,
    RunFunctionResponse,
    Resource,
    to,
    normal,
    fatal,
    getObservedCompositeResource,
    getDesiredCompositeResource,
    getDesiredComposedResources,
    setDesiredComposedResources,
} from "@crossplane-org/function-sdk-typescript";
import type { Logger } from "@crossplane-org/function-sdk-typescript";

export class MyFunction implements FunctionHandler {
    async RunFunction(
        req: RunFunctionRequest,
        logger?: Logger,
    ): Promise<RunFunctionResponse> {
        // Initialize response from request
        let rsp = to(req);

        try {
            // Get observed and desired state
            const oxr = getObservedCompositeResource(req);
            const dxr = getDesiredCompositeResource(req);
            let dcds = getDesiredComposedResources(req);

            logger?.info("Processing function request");

            // Your function logic here
            // Example: Create a Deployment resource
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
                        selector: {
                            matchLabels: {
                                app: "my-app",
                            },
                        },
                        template: {
                            metadata: {
                                labels: {
                                    app: "my-app",
                                },
                            },
                            spec: {
                                containers: [
                                    {
                                        name: "my-container",
                                        image: "my-image:latest",
                                    },
                                ],
                            },
                        },
                    },
                },
            });

            // Update response with desired composed resources
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

### 2. Create a Main Entry Point

Create a `main.ts` that hands your function to `serve()`:

```typescript
#!/usr/bin/env node

import { serve } from "@crossplane-org/function-sdk-typescript";
import { compose } from "./my-function.js";

serve(compose);
```

That is the whole entry point. `serve()` parses the standard function flags, builds a
logger from `--debug`, starts the gRPC server, and shuts it down cleanly on `SIGINT`
and `SIGTERM`. It accepts either a `ComposeFunction` or a `FunctionHandler`.

Every function served this way accepts the same flags:

```
Usage: main.js [flags]

A Crossplane composition function.

Flags:
      --address <value>               Address to listen for gRPC connections. Default 0.0.0.0:9443.
  -d, --debug                         Emit debug logs.
      --insecure                      Run without mTLS credentials.
      --tls-server-certs-dir <value>  Directory holding tls.key, tls.crt and ca.crt. Default /tls/server.
  -h, --help                          Show this help.
```

`serve()` takes an options object for the cases where the defaults do not fit:

```typescript
serve(compose, {
    name: "my-function",              // Program name shown in --help
    argv: ["--insecure"],             // Defaults to process.argv.slice(2)
    logger: myLogger,                 // Defaults to a pino logger built from --debug
    serverOptions: { insecure: true } // Overrides applied on top of the parsed flags
});
```

### 3. Build and Run

```bash
# Build your function
npm run build

# Run locally (insecure mode for testing)
node dist/main.js --insecure --debug

# Run with mTLS (production)
node dist/main.js --tls-server-certs-dir /path/to/certs
```

## Advanced Usage

### Building the Server Yourself

`serve()` is the recommended entry point, but the pieces it uses are exported, so a
function that needs to own the process — extra flags, a different logger, its own
signal handling — can assemble them directly:

```typescript
#!/usr/bin/env node

import { pino } from "pino";
import {
    FunctionRunner,
    newGrpcServer,
    parseArgs,
    startServer,
    type ServerOptions,
} from "@crossplane-org/function-sdk-typescript";
import { MyFunction } from "./my-function.js";

// parseArgs handles the standard flags, so your own parser only has to add to them.
const { help, ...opts } = parseArgs(process.argv.slice(2));

const logger = pino({
    level: opts.debug ? "debug" : "info",
    formatters: {
        level: (label) => ({ severity: label.toUpperCase() }),
    },
});

const server = newGrpcServer(new FunctionRunner(new MyFunction(), logger), logger);
startServer(server, opts as ServerOptions, logger);

process.on("SIGTERM", () => {
    server.tryShutdown(() => process.exit(0));
});
```

### Using Kubernetes Models

The SDK works well with the `kubernetes-models` library for type-safe Kubernetes resource creation:

```typescript
import { Pod } from "kubernetes-models/v1";
import { Resource } from "@crossplane-org/function-sdk-typescript";

const pod = new Pod({
    metadata: {
        name: "my-pod",
        namespace: "default",
    },
    spec: {
        containers: [
            {
                name: "app",
                image: "nginx:latest",
            },
        ],
    },
});

pod.validate();
dcds["my-pod"] = Resource.fromJSON({ resource: pod.toJSON() });
```

### Setting Composite Resource Status

You can update the status of the composite resource:

```typescript
import { setDesiredCompositeStatus } from "@crossplane-org/function-sdk-typescript";

rsp = setDesiredCompositeStatus({
    rsp,
    status: {
        ready: true,
        message: "All resources created successfully",
    },
});
```

### Working with Context

Pass data between functions in a pipeline using context:

```typescript
import { getContextKey, setContextKey } from "@crossplane-org/function-sdk-typescript";

// Read context from previous function
const [resourceId, exists] = getContextKey(req, "resourceId");
if (exists) {
    logger?.info({ resourceId }, "Found resource ID from previous function");
}

// Set context for next function
rsp = setContextKey(rsp, "resourceId", "my-resource-123");
rsp = setContextKey(rsp, "status", { created: true, ready: false });
```

### Working with Credentials

Access credentials passed to the function:

```typescript
import { getCredentials } from "@crossplane-org/function-sdk-typescript";

try {
    const creds = getCredentials(req, "aws-credentials");
    const accessKey = creds.credentialData?.data["access-key-id"];
    const secretKey = creds.credentialData?.data["secret-access-key"];

    if (accessKey && secretKey) {
        logger?.info("Successfully retrieved AWS credentials");
        // Use credentials to interact with AWS
    }
} catch (error) {
    fatal(rsp, `Failed to get credentials: ${error.message}`);
}
```

### Error Handling

Use the result helpers to report errors and warnings:

```typescript
import { fatal, warning, normal } from "@crossplane-org/function-sdk-typescript";

// Report a fatal error (stops pipeline)
fatal(rsp, "Critical error occurred");

// Report a warning (continues pipeline)
warning(rsp, "Non-critical issue detected");

// Report normal completion
normal(rsp, "Function completed successfully");
```

## API Reference

### Core Interfaces

- `ComposeFunction` - A plain function given the request and a response to fill in
- `ComposeResponse` - A `RunFunctionResponse` whose `desired` state is guaranteed present
- `FunctionHandler` - Interface to implement for your function logic
- `FunctionRunner` - Wraps your handler with error handling and logging
- `getServer()` - Creates a gRPC server with your function

### Request Helpers

- `getObservedCompositeResource(req)` - Get the observed composite resource (returns `Resource | undefined`)
- `getDesiredCompositeResource(req)` - Get the desired composite resource (returns `Resource | undefined`)
- `getDesiredComposedResources(req)` - Get map of desired composed resources (returns empty object if none exist)
- `getObservedComposedResources(req)` - Get map of observed composed resources (returns empty object if none exist)
- `getInput(req)` - Get function input configuration (returns `undefined` if not present)
- `getContextKey(req, key)` - Get context value from previous function (returns `[value, exists]` tuple)
- `getRequiredResources(req)` - Get required resources map
- `getCredentials(req, name)` - Get credentials by name (throws error if not found)

### Response Helpers

- `to(req, ttl?)` - Initialize response from request (optional TTL in seconds, defaults to 60)
- `setDesiredComposedResources(rsp, resources)` - Set composed resources (merges with existing)
- `updateDesiredComposedResources(rsp, resources)` - Alias for `setDesiredComposedResources`
- `setDesiredCompositeResource(rsp, resource)` - Set the desired composite resource
- `setDesiredCompositeStatus({ rsp, status })` - Update composite status
- `setContextKey(rsp, key, value)` - Set context for next function in pipeline
- `setOutput(rsp, output)` - Set function output (returned to user)
- `fatal(rsp, message)` - Add fatal error result (stops pipeline)
- `warning(rsp, message)` - Add warning result (continues pipeline)
- `normal(rsp, message)` - Add normal info result
- `update(source, target)` - Deep merge resources using ts-deepmerge

### Runtime

- `serve(fn, opts?)` - Run a `ComposeFunction` or `FunctionHandler` as a gRPC server: parses flags, builds a logger, starts the server, handles shutdown
- `fromCompose(compose)` - Adapt a `ComposeFunction` to the `FunctionHandler` interface
- `parseArgs(argv)` - Parse the standard function flags, for functions adding flags of their own
- `helpText(name)` - The `--help` text for the standard flags
- `DEFAULT_ADDRESS` - `0.0.0.0:9443`
- `DEFAULT_TLS_SERVER_CERTS_DIR` - `/tls/server`
- `newGrpcServer(runner, logger)` - Create gRPC server instance
- `startServer(server, opts, logger)` - Bind and start the server on specified address
- `getServerCredentials(opts)` - Create server credentials (TLS or insecure mode)

### Resource Helpers

- `fromObject(obj)` - Create a Resource from a plain JavaScript object
- `toObject(resource)` - Extract plain object from a Resource
- `asStruct(obj)` - Convert object to protobuf Struct format
- `asObject(struct)` - Convert protobuf Struct to plain object
- `newDesiredComposed()` - Create a new empty DesiredComposed resource
- `mustStructObject(obj)` - Convert object to Struct, throws on error
- `mustStructJSON(json)` - Parse JSON string to Struct, throws on error

## Project Structure

```
my-function/
├── src/
│   ├── main.ts              # Entry point
│   └── my-function.ts       # Your function implementation
├── package.json
├── tsconfig.json
└── dist/                    # Build output
```
