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

## Composed Resource Ordering

Crossplane can sequence the composed resources it creates, updates and deletes
if a function tells it what depends on what. Nothing is created until what it
depends on is ready, and nothing is deleted until everything depending on it is
gone.

This is an alpha feature. Check for it before relying on it — an older
Crossplane accepts the dependencies a function returns and ignores them:

```typescript
import { Capability, hasCapability } from "@crossplane-org/function-sdk-typescript";

if (hasCapability(req, Capability.CAPABILITY_DEPENDENCIES)) {
    // Ordering will be honoured.
}
```

### Declaring dependencies

```typescript
import { dependsOn, dependsOnRequired } from "@crossplane-org/function-sdk-typescript";

// subnet is not created until vpc is ready, and vpc is not deleted until
// subnet is gone.
dependsOn(rsp, "subnet", "vpc");

// A replacement that must exist before its predecessor is torn down.
dependsOn(rsp, "new-db", "old-db", { createBeforeDestroy: true });

// Wait on a resource the function requires but does not compose. Crossplane
// never deletes what it did not compose, so this only orders creation.
dependsOnRequired(rsp, "instance", "shared-vpc");
```

Edges accumulate, and duplicates are dropped.

### Referencing fields of other resources

Rather than declaring the edge separately, write where the value comes from and
let the SDK record the dependency:

```typescript
import {
    externalName,
    fromModel,
    named,
    ref,
    resolveRefs,
    setDesiredComposedResources,
} from "@crossplane-org/function-sdk-typescript";
import { Subnet, VPC } from "crossplane-models/ec2.aws.m.upbound.io/v1beta1";

const vpc = named<VPC>("vpc");

const subnet = new Subnet({
    metadata: { name: "sn", namespace: "default" },
    spec: {
        forProvider: {
            region: "us-east-1",
            cidrBlock: "10.0.1.0/24",
            vpcId: externalName(vpc), // instead of vpcIdSelector
        },
    },
});

subnet.validate();
desired["subnet"] = fromModel(subnet);

// Records subnet -> vpc, and fills in the value.
rsp = setDesiredComposedResources(rsp, resolveRefs(req, rsp, desired));
```

`externalName(vpc)` is what a provider's `vpcIdRef` would have resolved to, so
it is the direct replacement for a reference or selector field. For any other
field, read it and wrap it in `ref`:

```typescript
arn: ref(vpc.status.atProvider.arn),
```

`vpc` reads like the resource itself, so your editor completes the fields and
the compiler checks them. `ref` marks where the value comes from.

This also works where no provider reference exists at all — a ConfigMap has no
`addressRef`, and no selector can populate arbitrary data:

```typescript
const db = named<Instance>("db");

desired["app-config"] = {
    resource: {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "app-config", namespace: "default" },
        data: { DB_HOST: ref(db.status.atProvider.address) },
    },
    ready: Ready.READY_UNSPECIFIED,
};
```

For a resource this composite does not compose, name it as a requirement:

```typescript
import { namedRequired, ref } from "@crossplane-org/function-sdk-typescript";

const external = namedRequired<Instance>("external-db");

data: { DB_HOST: ref(external.status.atProvider.address) },
```

Name a specific one — `namedRequired("databases", "primary")` — when a
requirement can match several. Without a name and with more than one match, the
reference declines to resolve rather than guessing, and ordering holds the
resource back.

A reference to something that does not exist yet resolves to nothing and the
field is left out. That is safe because the ordering edge stops Crossplane
creating the resource until the value is there — so this pairs with
`CAPABILITY_DEPENDENCIES` and should not be relied on without it.

### Inferring dependencies from your code

For functions that build plain objects rather than typed models, the SDK can
also infer dependencies from ordinary property reads. This is a poor fit for
typed code — a tracked read is always a truthy object, so an `if (value)` guard
silently stops working — so prefer `ref` above unless your function is
dynamic:

```typescript
import {
    resolveDependencies,
    setDesiredComposedResources,
    trackObservedComposedResources,
} from "@crossplane-org/function-sdk-typescript";

const observed = trackObservedComposedResources(req);

dcds["subnet"] = {
    resource: {
        apiVersion: "ec2.aws.upbound.io/v1beta1",
        kind: "Subnet",
        spec: {
            forProvider: {
                vpcId: observed["vpc"].resource.status.atProvider.id,
            },
        },
    },
    ready: Ready.READY_UNSPECIFIED,
};

// Records that subnet depends on vpc, and substitutes the real value.
rsp = setDesiredComposedResources(rsp, resolveDependencies(rsp, dcds));
```

Reading a resource that does not exist yet is fine, and is the case that
matters most: the value comes back `undefined` and the field is left out, but
the dependency is recorded, so Crossplane waits instead of creating a subnet
with no VPC.

**What it can and cannot see.** A tracked read produces a placeholder that
remembers where it came from, so the value has to survive as a value:

| Written as | Edge recorded |
| --- | --- |
| `vpcId: vpc.status.atProvider.id` | yes |
| `` name: `${vpc.status.atProvider.id}-sn` `` | no — interpolation drops it |
| `if (vpc.status.atProvider.id)` | no — and placeholders are always truthy |

The value is still correct in every case; only the edge is lost. Use
`dependsOn` for those, and `valueOf()` when you need to test the real value.

### Passing dependencies through

`to(req)` carries inherited edges forward, the same way it carries desired
state and context, so declaring an edge adds to what earlier functions declared
rather than replacing it:

```typescript
dependsOn(rsp, "subnet", "vpc");   // added alongside anything inherited
```

To discard what came before, say so:

```typescript
setDependencies(rsp, []);          // no ordering constraints at all
```

That is different from a function never touching the field. When the request
carries no edges, `to(req)` leaves `dependencies` unset, which Crossplane reads
as "no opinion" and carries forward on the function's behalf — so a function
that does not think about ordering needs to do nothing.

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
- `trackObservedComposedResources(req)` - As above, but reads through it record dependencies (see [Composed Resource Ordering](#composed-resource-ordering))
- `getDependencies(req)` - Get ordering constraints declared by earlier functions
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
