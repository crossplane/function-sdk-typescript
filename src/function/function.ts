/**
 * Core function interfaces and classes for building Crossplane functions
 *
 * This module provides the fundamental building blocks for creating Crossplane
 * composition functions in TypeScript. It includes the FunctionHandler interface
 * that users implement, the FunctionRunner that wraps handlers, and utilities
 * for creating gRPC servers.
 */

import * as grpc from '@grpc/grpc-js';
import {
  FunctionRunnerServiceService,
  RunFunctionRequest,
  RunFunctionResponse,
} from '../proto/run_function.js';
import type { Logger } from 'pino';
import { fatal, to } from '../response/response.js';

/**
 * FunctionHandler is the interface that users must implement to create a function.
 *
 * Implement this interface to define the logic of your composition function.
 * The RunFunction method will be called by Crossplane for each invocation,
 * receiving the current state and returning the desired state.
 */
export interface FunctionHandler {
  /**
   * RunFunction is called for each function invocation.
   *
   * This method receives the observed state of the composite resource (XR) and
   * any composed resources, along with the desired state accumulated by previous
   * functions in the pipeline. It should return the desired state after applying
   * this function's logic.
   *
   * @param req - The RunFunctionRequest containing:
   *   - observed: Current state of resources in the cluster
   *   - desired: Desired state from previous functions
   *   - input: Function-specific configuration
   *   - context: Data passed from previous functions
   * @param logger - Optional Pino logger instance for structured logging
   * @returns Promise resolving to RunFunctionResponse containing:
   *   - desired: Updated desired state for resources
   *   - results: Status messages (normal, warning, or fatal)
   *   - context: Data to pass to next function
   *
   * @example
   * ```typescript
   * class MyFunction implements FunctionHandler {
   *   async RunFunction(req: RunFunctionRequest, logger?: Logger): Promise<RunFunctionResponse> {
   *     let rsp = to(req);
   *     const oxr = getObservedCompositeResource(req);
   *
   *     // Your logic here
   *
   *     normal(rsp, "Processing complete");
   *     return rsp;
   *   }
   * }
   * ```
   */
  RunFunction(req: RunFunctionRequest, logger?: Logger): Promise<RunFunctionResponse>;
}

/**
 * FunctionRunner wraps a FunctionHandler to provide error handling and logging.
 *
 * This class implements the gRPC service for Crossplane functions. It delegates
 * to the user-provided FunctionHandler and ensures consistent error handling,
 * logging, and response formatting. Most users won't interact with this class
 * directly - it's used internally by the runtime.
 */
export class FunctionRunner {
  private logger?: Logger;
  private handler: FunctionHandler;

  /**
   * Creates a new FunctionRunner.
   *
   * @param handler - User-provided implementation of FunctionHandler
   * @param logger - Optional Pino logger instance for error logging
   *
   * @example
   * ```typescript
   * const myFunction = new MyFunction();
   * const runner = new FunctionRunner(myFunction, logger);
   * ```
   */
  constructor(handler: FunctionHandler, logger?: Logger) {
    this.handler = handler;
    this.logger = logger;
  }

  /**
   * Run the function with error handling and logging.
   *
   * This method wraps the user's RunFunction implementation with error handling.
   * If the handler throws an error, it will be caught, logged, and returned as
   * a fatal result in the response. This ensures Crossplane always receives a
   * valid response even when the function encounters unexpected errors.
   *
   * @param req - The RunFunctionRequest from Crossplane
   * @param logger - Optional logger (overrides constructor logger if provided)
   * @returns Promise resolving to RunFunctionResponse (either from handler or error response)
   */
  async RunFunction(req: RunFunctionRequest, logger?: Logger): Promise<RunFunctionResponse> {
    const startTime = Date.now();
    const log = logger || this.logger;

    try {
      // Delegate to the user-provided handler
      return await this.handler.RunFunction(req, log);
    } catch (error) {
      const duration = Date.now() - startTime;
      log?.error(
        {
          error: error instanceof Error ? error.message : String(error),
          duration: `${duration}ms`,
        },
        'Function invocation failed'
      );

      // Return a minimal error response
      const rsp = to(req);
      fatal(rsp, error instanceof Error ? error.message : String(error));
      return rsp;
    }
  }
}

/**
 * Create a gRPC server configured for Crossplane function handling.
 *
 * This function creates and configures a gRPC server with the FunctionRunner
 * service registered. The server is ready to receive RunFunction requests from
 * Crossplane via the FunctionRunnerService gRPC service definition.
 *
 * This is typically used internally by the runtime. Most users should use
 * newGrpcServer from the runtime module instead.
 *
 * @param functionRunner - The FunctionRunner instance to handle requests
 * @param logger - Logger instance for debug logging
 * @returns A configured gRPC Server with the function service registered
 *
 * @example
 * ```typescript
 * const runner = new FunctionRunner(new MyFunction(), logger);
 * const server = getServer(runner, logger);
 * ```
 */
export function getServer(
  functionRunner: FunctionRunner,
  logger: Logger,
  opts?: { maxRecvMessageSize?: number; maxSendMessageSize?: number }
): grpc.Server {
  const channelOptions: grpc.ServerOptions = {};
  if (opts?.maxRecvMessageSize) {
    channelOptions['grpc.max_receive_message_length'] = opts.maxRecvMessageSize;
  }
  const sendSize = opts?.maxSendMessageSize ?? opts?.maxRecvMessageSize;
  if (sendSize) {
    channelOptions['grpc.max_send_message_length'] = sendSize;
  }
  const server = new grpc.Server(channelOptions);

  // Implement the service using the generated interface
  const implementation = {
    runFunction: (
      call: grpc.ServerUnaryCall<RunFunctionRequest, RunFunctionResponse>,
      callback: grpc.sendUnaryData<RunFunctionResponse>
    ) => {
      functionRunner
        .RunFunction(call.request, logger)
        .then((response) => {
          logger.debug('RunFunction succeeded, sending response');
          callback(null, response);
        })
        .catch((error) => {
          logger.error('RunFunction failed:', error);
          callback(error);
        });
    },
  };

  logger.debug(`adding service to grpc server: ${FunctionRunnerServiceService.runFunction.path}`);
  server.addService(FunctionRunnerServiceService, implementation);
  return server;
}
